"""Validate SoC pad tables (``soc_pads.schema.json``) and their internal references."""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from board_pinout import schema_path
from board_pinout.resolve import _copy_tree
from board_pinout.validate import ValidationResult, load_json, load_yaml


@lru_cache(maxsize=1)
def _soc_validator() -> Draft202012Validator:
    return Draft202012Validator(load_json(schema_path("soc_pads.schema.json")))


def clear_soc_validator_cache() -> None:
    _soc_validator.cache_clear()


def _pad_names(table: dict[str, Any]) -> dict[str, str]:
    """Map every pad name and alias to its canonical pad name."""
    names: dict[str, str] = {}
    for name, pad in (table.get("pads") or {}).items():
        names[name] = name
        for alias in (pad or {}).get("aliases") or []:
            names.setdefault(alias, name)
    return names


def structural_check_soc(table: dict[str, Any]) -> list[str]:
    """Cross-references JSON Schema cannot express.

    Tables using ``based_on`` may reference pads they inherit, so pad lookups
    are skipped for them until the base table is resolved.
    """
    errors: list[str] = []
    pads = table.get("pads") or {}
    domains = table.get("domains") or {}
    packages = table.get("packages") or {}
    inherited = bool(table.get("based_on"))
    names = _pad_names(table)

    seen_alias: dict[str, str] = {}
    for name, pad in pads.items():
        pad = pad or {}
        for alias in pad.get("aliases") or []:
            if alias in pads and alias != name:
                errors.append(f"pads.{name}: alias '{alias}' is also a pad name")
            if alias in seen_alias and seen_alias[alias] != name:
                errors.append(
                    f"pads.{name}: alias '{alias}' already used by {seen_alias[alias]}"
                )
            seen_alias[alias] = name
        domain = pad.get("domain")
        if domain and domains and domain not in domains:
            errors.append(f"pads.{name}: unknown domain '{domain}'")
        for i, fn in enumerate(pad.get("functions") or []):
            for pkg in fn.get("packages") or []:
                if pkg not in packages:
                    errors.append(f"pads.{name}.functions[{i}]: unknown package '{pkg}'")

    def check_pad(where: str, pad: str | None) -> None:
        if pad is None or inherited:
            return
        if pad not in names:
            errors.append(f"{where}: unknown pad '{pad}'")

    for pkg_name, pkg in packages.items():
        for pad in (pkg or {}).get("pads") or {}:
            check_pad(f"packages.{pkg_name}.pads", pad)

    for i, rule in enumerate(table.get("routing") or []):
        sel = rule.get("pads") or {}
        for pad in sel.get("list") or []:
            check_pad(f"routing[{i}].pads.list", pad)
        for pad in sel.get("range") or []:
            check_pad(f"routing[{i}].pads.range", pad)
        for pad in sel.get("exclude") or []:
            check_pad(f"routing[{i}].pads.exclude", pad)
        if rule.get("kind") == "analog_bus" and not rule.get("bus"):
            errors.append(f"routing[{i}]: analog_bus rule needs 'bus'")
        if rule.get("kind") == "port_restricted" and not sel.get("ports"):
            errors.append(f"routing[{i}]: port_restricted rule needs pads.ports")

    for periph, options in (table.get("remaps") or {}).items():
        values = [opt.get("value") for opt in options]
        if len(values) != len(set(map(str, values))):
            errors.append(f"remaps.{periph}: duplicate remap value")
        for opt in options:
            for signal, pad in (opt.get("pads") or {}).items():
                check_pad(f"remaps.{periph}[{opt.get('value')}].{signal}", pad)

    for fn, options in (table.get("signal_select") or {}).items():
        for opt in options:
            check_pad(f"signal_select.{fn}", opt.get("pad"))

    return errors


def validate_soc_table(table: Any, *, schema: bool = True) -> ValidationResult:
    if not isinstance(table, dict):
        return ValidationResult(ok=False, errors=["root must be a mapping"])
    errors: list[str] = []
    if schema:
        for exc in sorted(_soc_validator().iter_errors(table), key=lambda e: list(e.path)):
            errors.append(f"schema: {exc.message} (at {list(exc.absolute_path)})")
    if not errors:
        errors.extend(structural_check_soc(table))
    return ValidationResult(ok=not errors, errors=errors)


def validate_soc_file(path: Path, **kwargs: Any) -> ValidationResult:
    return validate_soc_table(load_yaml(path), **kwargs)


# --- Loading and resolving tables ------------------------------------------------

_Fingerprint = tuple[tuple[str, int, int], ...]


class SocTableError(ValueError):
    """A board references a SoC table that is missing, ambiguous or invalid."""


def find_soc_tables(root: Path, globs: list[str] | tuple[str, ...]) -> list[Path]:
    """Return table files under ``root`` matching ``globs`` (deduplicated, sorted)."""
    found: set[Path] = set()
    for pattern in globs:
        found.update(p.resolve() for p in root.glob(pattern) if p.is_file())
    return sorted(found)


def _fingerprint(paths: list[Path] | tuple[Path, ...]) -> _Fingerprint:
    out = []
    for path in sorted({Path(p).expanduser().resolve() for p in paths}):
        st = path.stat()
        out.append((str(path), st.st_mtime_ns, st.st_size))
    return tuple(out)


def _function_matches(pattern: str, entry: dict[str, Any]) -> bool:
    """``PERIPH.*`` matches a peripheral; anything else matches a function name."""
    if pattern.endswith(".*"):
        prefix = pattern[:-2]
        peripheral = entry.get("peripheral")
        if peripheral:
            return peripheral == prefix
        return str(entry.get("function", "")).startswith(f"{prefix}_")
    return entry.get("function") == pattern


def _excluded(entry: dict[str, Any], patterns: list[str]) -> bool:
    return any(_function_matches(p, entry) for p in patterns)


def _merge_tables(base: dict[str, Any], child: dict[str, Any]) -> dict[str, Any]:
    """Overlay a ``based_on`` child on its (already merged) base table."""
    out = copy.deepcopy(base)
    for key in ("pads", "packages", "domains", "remaps", "signal_select"):
        if key in child:
            merged = dict(out.get(key) or {})
            merged.update(copy.deepcopy(child[key]))
            out[key] = merged
    if "pad_defaults" in child:
        defaults = dict(out.get("pad_defaults") or {})
        defaults.update(copy.deepcopy(child["pad_defaults"]))
        out["pad_defaults"] = defaults
    if "routing" in child:
        out["routing"] = list(out.get("routing") or []) + copy.deepcopy(child["routing"])
    out["functions_exclude"] = list(base.get("functions_exclude") or []) + list(
        child.get("functions_exclude") or []
    )
    for key in ("soc", "description", "reference", "schema_version"):
        if key in child:
            out[key] = copy.deepcopy(child[key])
    pads = out.get("pads") or {}
    if child.get("pads_include"):
        keep = set(child["pads_include"]) | set(child.get("pads") or {})
        pads = {k: v for k, v in pads.items() if k in keep}
    for name in child.get("pads_exclude") or []:
        pads.pop(name, None)
    out["pads"] = pads
    return out


class SocTable:
    """A fully resolved SoC table: ``based_on`` merged, defaults applied, indexed."""

    def __init__(self, raw: dict[str, Any], paths: tuple[str, ...]):
        self.soc: str = raw["soc"]
        self.paths = paths
        self.packages: dict[str, Any] = raw.get("packages") or {}
        self.domains: dict[str, Any] = raw.get("domains") or {}
        self.functions_exclude: list[str] = list(raw.get("functions_exclude") or [])
        defaults = raw.get("pad_defaults") or {}
        self.pads: dict[str, dict[str, Any]] = {}
        for name, pad in (raw.get("pads") or {}).items():
            merged = copy.deepcopy(defaults)
            merged.update(copy.deepcopy(pad or {}))
            merged["functions"] = [
                fn for fn in merged.get("functions") or []
                if not _excluded(fn, self.functions_exclude)
            ]
            self.pads[name] = merged
        self.names = _pad_names({"pads": self.pads})
        self._order = {name: i for i, name in enumerate(self.pads)}
        self._extra: dict[str, list[dict[str, Any]]] = {}
        self.routing: list[dict[str, Any]] = list(raw.get("routing") or [])
        self._routes: dict[str, list[int]] = {}
        self._index_routing(self.routing)
        self._index_remaps(raw.get("remaps") or {})
        self._index_signal_select(raw.get("signal_select") or {})

    # -- indexing ---------------------------------------------------------------

    def _select(self, sel: dict[str, Any]) -> list[str]:
        """Expand a pad selector: (list + range, or every pad) -> ports -> parity -> exclude."""
        pool = [self.names[p] for p in sel.get("list") or [] if p in self.names]
        if sel.get("range"):
            lo, hi = (self._order.get(self.names.get(p, p)) for p in sel["range"])
            if lo is not None and hi is not None:
                pool += [n for n, i in self._order.items() if lo <= i <= hi]
        if not sel.get("list") and not sel.get("range"):
            pool = list(self.pads)
        if sel.get("ports"):
            ports = set(sel["ports"])
            pool = [n for n in pool if self.pads[n].get("port") in ports]
        if sel.get("parity"):
            want = 0 if sel["parity"] == "even" else 1
            pool = [
                n for n in pool
                if isinstance(self.pads[n].get("index"), int) and self.pads[n]["index"] % 2 == want
            ]
        excluded = {self.names.get(p, p) for p in sel.get("exclude") or []}
        return list(dict.fromkeys(n for n in pool if n not in excluded))

    def _add(self, pad: str | None, entry: dict[str, Any]) -> None:
        name = self.names.get(pad or "")
        if name and not _excluded(entry, self.functions_exclude):
            self._extra.setdefault(name, []).append(entry)

    @staticmethod
    def _routing_tag(rule: dict[str, Any]) -> dict[str, Any]:
        tag = {"source": "routing", "routing": rule.get("kind")}
        if rule.get("label"):
            tag["routing_label"] = rule["label"]
        if rule.get("bus"):
            tag["bus"] = rule["bus"]
        return tag

    def _index_routing(self, rules: list[dict[str, Any]]) -> None:
        for i, rule in enumerate(rules):
            tag = self._routing_tag(rule)
            for pad in self._select(rule.get("pads") or {}):
                self._routes.setdefault(pad, []).append(i)
                for fn in rule.get("functions") or []:
                    self._add(pad, {**copy.deepcopy(fn), **tag})

    def _index_remaps(self, remaps: dict[str, Any]) -> None:
        for periph, options in remaps.items():
            for opt in options:
                remap = {"value": opt.get("value")}
                if opt.get("label"):
                    remap["label"] = opt["label"]
                for signal, pad in (opt.get("pads") or {}).items():
                    entry = {
                        "function": f"{periph}_{signal}",
                        "peripheral": periph,
                        "signal": signal,
                        "source": "remap",
                        "remap": dict(remap),
                    }
                    if opt.get("vendor"):
                        entry["vendor"] = copy.deepcopy(opt["vendor"])
                    if opt.get("packages"):
                        entry["packages"] = list(opt["packages"])
                    self._add(pad, entry)

    def _index_signal_select(self, selects: dict[str, Any]) -> None:
        for fn, options in selects.items():
            for opt in options:
                entry: dict[str, Any] = {"function": fn, "source": "signal_select"}
                for key in ("set", "mode", "requires", "vendor"):
                    if key in opt:
                        entry[key] = copy.deepcopy(opt[key])
                self._add(opt.get("pad"), entry)

    # -- queries ----------------------------------------------------------------

    def canonical(self, pad: str) -> str | None:
        return self.names.get(pad)

    def check_package(self, package: str | None) -> None:
        if package and package not in self.packages:
            known = ", ".join(sorted(self.packages)) or "none"
            raise SocTableError(
                f"soc '{self.soc}': unknown package '{package}' (known: {known})"
            )

    def in_package(self, pad: str, package: str | None) -> bool:
        if not package:
            return True
        pads = (self.packages.get(package) or {}).get("pads")
        return pads is None or pad in pads

    def mux(
        self,
        pad: str,
        package: str | None = None,
        *,
        routable: bool = True,
        expand_routing: bool = True,
    ) -> list[dict]:
        """Effective table mux for a canonical pad name (pad, routing, remap, select).

        ``expand_routing=False`` leaves routing-rule entries out; use
        :meth:`routes` and :meth:`routing_rule` to reference them instead.
        """
        out: list[dict[str, Any]] = []
        for fn in self.pads[pad].get("functions") or []:
            out.append({**_copy_tree(fn), "source": "pad"})
        for entry in self._extra.get(pad) or []:
            if entry.get("source") == "routing" and not (routable and expand_routing):
                continue
            out.append(_copy_tree(entry))
        return self._package_filter(out, package)

    def routes(self, pad: str) -> list[int]:
        """Indices of the routing rules that reach a canonical pad."""
        return list(self._routes.get(pad) or [])

    def routing_rule(self, i: int, package: str | None = None) -> dict[str, Any]:
        """Routing rule ``i`` as shared data: kind/label/bus plus its functions."""
        rule = self.routing[i]
        out: dict[str, Any] = {"kind": rule.get("kind")}
        for key in ("label", "bus", "notes"):
            if rule.get(key):
                out[key] = rule[key]
        functions = [
            _copy_tree(fn)
            for fn in rule.get("functions") or []
            if not _excluded(fn, self.functions_exclude)
        ]
        out["functions"] = self._package_filter(functions, package)
        return out

    def _package_filter(self, out: list[dict[str, Any]], package: str | None) -> list[dict]:
        pkg = (self.packages.get(package) or {}) if package else {}
        pkg_exclude = list(pkg.get("functions_exclude") or [])
        kept = []
        for entry in out:
            limits = entry.pop("packages", None)
            if package and limits and package not in limits:
                continue
            if pkg_exclude and _excluded(entry, pkg_exclude):
                continue
            kept.append(entry)
        return kept

    def pad_info(self, pad: str, package: str | None = None) -> dict[str, Any]:
        """Intrinsic pad facts for display (functions omitted; see :meth:`mux`)."""
        info: dict[str, Any] = {"soc": self.soc, "pad": pad}
        for key, value in self.pads[pad].items():
            if key not in ("functions", "aliases"):
                info[key] = _copy_tree(value)
        domain = self.domains.get(info.get("domain") or "")
        if domain:
            info["domain_info"] = _copy_tree(domain)
        if package:
            pins = ((self.packages.get(package) or {}).get("pads") or {}).get(pad)
            info["package"] = {"name": package, **_copy_tree(pins or {})}
        return info


class SocIndex:
    """SoC id -> table file; tables are resolved (and validated) on first use."""

    def __init__(self, paths: list[str]):
        self.paths = list(paths)
        self._raw: dict[str, tuple[str, dict[str, Any]]] = {}
        self._errors: dict[str, list[str]] = {}
        self._resolved: dict[str, SocTable] = {}
        for path in self.paths:
            try:
                table = load_yaml(Path(path))
            except Exception as exc:  # noqa: BLE001 - reported when the soc is used
                self._errors.setdefault(f"<file:{path}>", []).append(f"{path}: {exc}")
                continue
            soc = table.get("soc") if isinstance(table, dict) else None
            if not isinstance(soc, str):
                continue
            if soc in self._raw:
                self._errors.setdefault(soc, []).append(
                    f"soc '{soc}' is defined by both {self._raw[soc][0]} and {path}"
                )
                continue
            self._raw[soc] = (path, table)

    def ids(self) -> list[str]:
        return sorted(self._raw)

    def __contains__(self, soc: str) -> bool:
        return soc in self._raw

    def get(self, soc: str) -> SocTable:
        if soc in self._resolved:
            return self._resolved[soc]
        raw, paths = self._merged(soc, [])
        table = SocTable(raw, tuple(paths))
        self._resolved[soc] = table
        return table

    def _merged(self, soc: str, stack: list[str]) -> tuple[dict[str, Any], list[str]]:
        if soc in self._errors:
            raise SocTableError("; ".join(self._errors[soc]))
        if soc not in self._raw:
            known = ", ".join(self.ids()) or "none found"
            raise SocTableError(f"unknown soc '{soc}' (known: {known})")
        if soc in stack:
            raise SocTableError(f"circular based_on: {' -> '.join(stack + [soc])}")
        path, table = self._raw[soc]
        result = validate_soc_table(table)
        if not result.ok:
            raise SocTableError(f"{path}: " + "; ".join(result.errors))
        base_id = table.get("based_on")
        if not base_id:
            return copy.deepcopy(table), [path]
        base, chain = self._merged(base_id, stack + [soc])
        return _merge_tables(base, table), [path, *chain]


@lru_cache(maxsize=8)
def _load_soc_index_cached(fingerprint: _Fingerprint) -> SocIndex:
    return SocIndex([item[0] for item in fingerprint])


def load_soc_index(paths: list[Path] | tuple[Path, ...]) -> SocIndex:
    """Index table files with stat-aware process caching (edits invalidate it)."""
    return _load_soc_index_cached(_fingerprint(paths))


def clear_soc_index_cache() -> None:
    _load_soc_index_cached.cache_clear()


# --- Board join (materialize) ----------------------------------------------------

@dataclass
class SocJoinReport:
    """Side results of a join: non-fatal warnings and the table files it read."""

    warnings: list[str] = field(default_factory=list)
    paths: set[str] = field(default_factory=set)


def _soc_refs(doc: dict[str, Any]) -> dict[str, str | None]:
    """SoC id -> selected package for the document."""
    soc = doc.get("soc")
    if isinstance(soc, str):
        return {soc: doc.get("soc_package")}
    return {
        ref["id"]: ref.get("package")
        for ref in soc or []
        if isinstance(ref, dict) and ref.get("id")
    }


def _quantity_key(q: dict[str, Any]) -> tuple[str, str]:
    return (str(q.get("value")), str(q.get("unit")))


def _check_electrical(
    where: str, table: SocTable, pad: str, electrical: dict[str, Any], report: SocJoinReport
) -> None:
    info = table.pads[pad]
    strength = electrical.get("drive_strength")
    options = info.get("drive_options")
    if strength and options and _quantity_key(strength) not in {_quantity_key(o) for o in options}:
        allowed = ", ".join(f"{o.get('value')}{o.get('unit')}" for o in options)
        report.warnings.append(
            f"{where}: drive_strength {strength.get('value')}{strength.get('unit')} "
            f"is not a drive option of {pad} ({allowed})"
        )
    domain = table.domains.get(info.get("domain") or "") or {}
    volts = electrical.get("io_voltage")
    if volts is not None and domain:
        lo_hi = domain.get("range")
        levels = domain.get("io_voltages")
        if lo_hi and not (lo_hi[0] <= volts <= lo_hi[1]):
            report.warnings.append(
                f"{where}: io_voltage {volts} V is outside domain {info['domain']} {lo_hi}"
            )
        elif levels and not lo_hi and volts not in levels:
            report.warnings.append(
                f"{where}: io_voltage {volts} V is not a level of domain {info['domain']} {levels}"
            )


def _uses_table(part: dict[str, Any]) -> bool:
    """False for ``mux_policy: replace`` (explicit, or implied by inline ``mux``)."""
    inline = part.get("mux")
    policy = part.get("mux_policy") or ("replace" if inline is not None else "extend")
    return not (inline is not None and policy == "replace")


def _apply_mux_delta(
    where: str,
    part: dict[str, Any],
    table_mux: list[dict[str, Any]],
    report: SocJoinReport,
    routed: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Effective mux, and the ``mux_exclude`` patterns that hit referenced ``routed`` entries."""
    inline = part.get("mux")
    if not _uses_table(part):
        return inline, []
    entries = table_mux
    routed_excludes: list[str] = []
    for pattern in part.get("mux_exclude") or []:
        kept = [e for e in entries if not _function_matches(pattern, e)]
        hits_routed = any(_function_matches(pattern, e) for e in routed or [])
        if hits_routed:
            routed_excludes.append(pattern)
        if len(kept) == len(entries) and not hits_routed:
            report.warnings.append(f"{where}: mux_exclude '{pattern}' matches nothing")
        entries = kept
    return entries + [{**e, "source": "board"} for e in inline or []], routed_excludes


def join_soc(
    doc: dict[str, Any],
    parts: list[tuple[str, dict[str, Any]]],
    index: SocIndex,
    report: SocJoinReport | None = None,
    *,
    expand_routing: bool = False,
) -> SocJoinReport:
    """Write effective ``mux`` and ``pad_info`` onto every pad-sourced part (in place).

    Routing rules (crossbars, port/bus routing) are stored once, in the
    document's ``soc_routing`` map; a part lists the rules that reach it in
    ``routing`` (plus ``routing_exclude`` patterns from ``mux_exclude``).
    ``expand_routing=True`` copies every routed entry into each ``mux``
    instead (large; for diffs).

    Raises :class:`SocTableError` for an unknown soc, package or pad, or a pad
    not bonded out in the selected package. Softer problems go to ``report``.
    """
    report = report or SocJoinReport()
    refs = _soc_refs(doc)
    tables: dict[str, SocTable] = {}
    for soc, package in refs.items():
        table = index.get(soc)
        table.check_package(package)
        tables[soc] = table
        report.paths.update(table.paths)
    sole = next(iter(tables)) if len(tables) == 1 else None
    errors: list[str] = []
    shared: dict[str, dict[str, Any]] = {}
    for where, part in parts:
        if "pad" not in part:
            continue
        soc = part.get("soc") or sole
        table = tables.get(soc or "")
        if table is None:
            errors.append(f"{where}: no SoC table for soc '{soc}'")
            continue
        pad = table.canonical(part["pad"])
        if pad is None:
            errors.append(f"{where}: unknown pad '{part['pad']}' on soc '{soc}'")
            continue
        package = refs.get(soc)
        if not table.in_package(pad, package):
            errors.append(f"{where}: pad '{pad}' is not bonded out in package '{package}'")
            continue
        routable = part.get("mux_routable", True)
        table_mux = table.mux(pad, package, routable=routable, expand_routing=expand_routing)
        rule_ids: list[str] = []
        routed: list[dict[str, Any]] = []
        if routable and not expand_routing and _uses_table(part):
            for i in table.routes(pad):
                rid = f"{table.soc}/{i}"
                if rid not in shared:
                    shared[rid] = table.routing_rule(i, package)
                rule_ids.append(rid)
                routed.extend(shared[rid]["functions"])
        part["mux"], routed_excludes = _apply_mux_delta(where, part, table_mux, report, routed)
        if rule_ids:
            part["routing"] = rule_ids
            if routed_excludes:
                part["routing_exclude"] = routed_excludes
        part["pad_info"] = table.pad_info(pad, package)
        if part.get("electrical"):
            _check_electrical(where, table, pad, part["electrical"], report)
    if errors:
        raise SocTableError("\n".join(errors))
    if shared:
        doc["soc_routing"] = shared
    return report
