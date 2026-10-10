"""Expand part type refs and synthesize pin_array children into resolved JSON."""

from __future__ import annotations

import copy
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any

from board_pinout.validate import iter_parts, load_yaml, validate_document

if TYPE_CHECKING:
    from board_pinout.soc_pads import SocIndex, SocJoinReport

_TypeFingerprint = tuple[tuple[str, int, int], ...]


def _type_fingerprint(types_path: Path) -> _TypeFingerprint:
    """Return a cheap fingerprint that invalidates cached type YAML safely."""
    path = types_path.expanduser().resolve()
    paths = [path] if path.is_file() else sorted(path.glob("*.yaml"))
    return tuple(
        (str(item), item.stat().st_mtime_ns, item.stat().st_size)
        for item in paths
    )


@lru_cache(maxsize=16)
def _load_type_library_cached(
    canonical_path: str, fingerprint: _TypeFingerprint
) -> dict[str, Any]:
    types_path = Path(canonical_path)
    types: dict[str, Any] = {}
    if types_path.is_file():
        doc = load_yaml(types_path)
        return dict(doc.get("types") or doc)
    for path in sorted(types_path.glob("*.yaml")):
        doc = load_yaml(path)
        if not isinstance(doc, dict):
            continue
        chunk = doc.get("types") or doc
        for key, value in chunk.items():
            if key in types:
                raise ValueError(f"Duplicate part type '{key}' from {path}")
            types[key] = value
    return types


def load_type_library(types_dir: Path) -> dict[str, Any]:
    """Load vendor-neutral type YAML with stat-aware process caching.

    Board- or vendor-specific types belong in the consuming docs tree via
    ``types_inline`` on ``pinout.yaml`` (or a separate local types dir), not
    in this package.  A detached copy is returned so callers cannot mutate the
    cached templates.
    """
    path = types_dir.expanduser().resolve()
    cached = _load_type_library_cached(str(path), _type_fingerprint(path))
    return _copy_tree(cached)


def clear_type_library_cache() -> None:
    """Clear cached type YAML, useful for long-running authoring processes."""
    _load_type_library_cached.cache_clear()


def _copy_tree(value: Any) -> Any:
    """Deep-copy a plain YAML/JSON tree (dict/list/scalars) much faster than deepcopy.

    Any other container type falls back to :func:`copy.deepcopy`.
    """
    if isinstance(value, dict):
        return {k: _copy_tree(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_copy_tree(v) for v in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return copy.deepcopy(value)


def _merge_type(instance: dict[str, Any], typ: dict[str, Any]) -> dict[str, Any]:
    # ``instance`` is already detached from the input document; mutate it to
    # avoid the second full copy performed by the old implementation.
    instance.setdefault("kind", typ.get("kind"))
    for key in (
        "rows",
        "cols",
        "numbering",
        "pin_ids",
        "receptacle_type",
        "control_type",
    ):
        if key in typ and key not in instance:
            instance[key] = _copy_tree(typ[key])
    if "default_electrical" in typ and "electrical" not in instance:
        instance["electrical"] = _copy_tree(typ["default_electrical"])
    # A fixed net (GND, VCC) is the pin's source; an explicit one wins.
    if "default_net" in typ and not any(
        k in instance for k in ("pad", "module_pin", "expander", "net")
    ):
        instance["net"] = _copy_tree(typ["default_net"])
    # `editor` is authoring UI metadata only — never merge onto board parts.
    return instance


def _prefix_child_ids(parent_id: str, children: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Make default child ids unique under a parent (port_p0/header → port_p0_header)."""
    out = []
    for child in children:
        c = _copy_tree(child)
        cid = c.get("id", "child")
        if not cid.startswith(f"{parent_id}_"):
            c["id"] = f"{parent_id}_{cid}"
        out.append(c)
    return out


def _pin_ids(rows: int, cols: int, numbering: str = "row_major") -> list[str]:
    ids: list[str] = []
    if numbering == "col_major":
        for c in range(cols):
            for r in range(rows):
                ids.append(f"r{r}c{c}")
    else:
        for r in range(rows):
            for c in range(cols):
                ids.append(f"r{r}c{c}")
    return ids


def _synthesize_pins(part: dict[str, Any]) -> None:
    if part.get("kind") != "pin_array":
        return
    if part.get("children"):
        return
    rows = int(part.get("rows") or 0)
    cols = int(part.get("cols") or 0)
    if rows < 1 or cols < 1:
        return
    numbering = part.get("numbering") or "row_major"
    custom = part.get("pin_ids")
    ids = list(custom) if custom else _pin_ids(rows, cols, numbering)
    part["children"] = [
        {
            "id": f"{part['id']}_{pid}",
            "kind": "pin",
            "silk": pid,
        }
        for pid in ids
    ]


def _resolve_part(
    part: dict[str, Any],
    types: dict[str, Any],
    *,
    type_cache: dict[str, dict[str, Any]],
    stack: list[str] | None = None,
    used_types: set[str] | None = None,
) -> dict[str, Any]:
    """Resolve ``part`` in place; callers pass an already-detached copy."""
    stack = stack or []
    out = part
    ref = out.get("ref")
    if ref:
        if ref in stack:
            raise ValueError(f"Circular part type ref: {' -> '.join(stack + [ref])}")
        if ref not in types:
            raise ValueError(f"Unknown part type ref '{ref}' on part '{out.get('id')}'")
        if used_types is not None:
            # Record the ref plus its ``based_on`` ancestors.
            chain = ref
            while chain and chain not in used_types and chain in types:
                used_types.add(chain)
                chain = types[chain].get("based_on")
        typ = _resolve_type(ref, types, type_cache, stack)
        out = _merge_type(out, typ)
        defaults = typ.get("default_children") or []
        if defaults and not out.get("children"):
            out["children"] = _prefix_child_ids(out["id"], defaults)

    _synthesize_pins(out)
    children = out.get("children") or []
    out["children"] = [
        _resolve_part(
            child,
            types,
            type_cache=type_cache,
            stack=stack + ([ref] if ref else []),
            used_types=used_types,
        )
        for child in children
    ]
    return out


def _resolve_type(
    ref: str,
    types: dict[str, Any],
    cache: dict[str, dict[str, Any]],
    stack: list[str],
) -> dict[str, Any]:
    """Resolve one type and its inheritance chain on demand."""
    if ref in cache:
        return cache[ref]
    if ref in stack:
        raise ValueError(f"Circular part type ref: {' -> '.join(stack + [ref])}")
    if ref not in types:
        raise ValueError(f"Unknown part type ref '{ref}'")
    typ = types[ref]
    base_ref = typ.get("based_on")
    if base_ref:
        base = _resolve_type(base_ref, types, cache, stack + [ref])
        resolved = _copy_tree(base)
        resolved.update({k: _copy_tree(v) for k, v in typ.items() if k != "based_on"})
    else:
        resolved = _copy_tree(typ)
    cache[ref] = resolved
    return resolved


def _resolved_type_map(types: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Resolve all types (kept as a small compatibility helper)."""
    cache: dict[str, dict[str, Any]] = {}
    for ref in types:
        _resolve_type(ref, types, cache, [])
    return cache


def _is_v11(doc: dict[str, Any]) -> bool:
    return doc.get("schema_version") == "1.1" or doc.get("mux_source") == "soc"


def resolve_board(
    doc: dict[str, Any],
    types: dict[str, Any] | None = None,
    *,
    validate: bool | str = True,
    soc_index: SocIndex | None = None,
    report: SocJoinReport | None = None,
    expand_routing: bool = False,
) -> dict[str, Any]:
    """Return a resolved board document with refs expanded and pins synthesized.

    ``validate``: ``True`` (schema + structural), ``"structural"`` (skip the
    JSON Schema pass, e.g. when CI already validated), or ``False``.

    With ``mux_source: soc`` the effective mux and pad facts are joined from
    ``soc_index`` onto every part with a ``pad`` (materialize mode); pass
    ``report`` to collect join warnings and the table files read.  1.0
    documents are returned exactly as before.
    """
    if validate:
        result = validate_document(doc, schema=validate != "structural")
        result.raise_if_failed()
        if report is not None:
            report.warnings.extend(result.warnings)

    type_map = dict(types or {})
    type_map.update(doc.get("types_inline") or {})
    resolved_types: dict[str, dict[str, Any]] = {}
    used_types: set[str] = set()

    # One detached copy up front; parts are then resolved in place.
    resolved = _copy_tree(doc)
    resolved["resolved"] = True
    parts: list[tuple[str, dict[str, Any]]] = []
    for face_name, face in (resolved.get("faces") or {}).items():
        face["children"] = [
            _resolve_part(
                child,
                type_map,
                type_cache=resolved_types,
                used_types=used_types,
            )
            for child in (face.get("children") or [])
        ]
        if _is_v11(doc):
            parts.extend(
                (f"{face_name}:{path}", part)
                for path, part in iter_parts(face["children"])
            )
    resolved["types_used"] = sorted(used_types)

    if _is_v11(doc):
        from board_pinout.soc_pads import SocJoinReport, SocTableError, join_soc

        pins = [(f"pins.{k}", v) for k, v in (resolved.get("pins") or {}).items() if v]
        if doc.get("mux_source") == "soc":
            if soc_index is None:
                raise SocTableError(
                    "mux_source: soc needs SoC pad tables (board_pinout_soc_search_globs "
                    "or --soc-tables)"
                )
            join_soc(
                resolved, parts + pins, soc_index, report or SocJoinReport(),
                expand_routing=expand_routing,
            )
    return resolved


def resolve_file(
    board_path: Path,
    types_path: Path,
    *,
    validate: bool | str = True,
    soc_index: SocIndex | None = None,
    report: SocJoinReport | None = None,
    expand_routing: bool = False,
) -> dict[str, Any]:
    doc = load_yaml(board_path)
    types = load_type_library(types_path)
    return resolve_board(
        doc, types, validate=validate, soc_index=soc_index, report=report,
        expand_routing=expand_routing,
    )


def _assignment_status(part: dict[str, Any]) -> str | None:
    """Strongest status among the part's software assignments."""
    found = {a.get("status") for a in part.get("assignments") or []}
    for status in ("enabled", "available", "unused", "unknown"):
        if status in found:
            return status
    return None


def summarize_tree(resolved: dict[str, Any]) -> list[dict[str, Any]]:
    """Flat summary useful for docs / search indexes."""
    rows: list[dict[str, Any]] = []
    for face_name, face in (resolved.get("faces") or {}).items():
        for path, part in iter_parts(face.get("children") or []):
            rows.append(
                {
                    "face": face_name,
                    "path": path,
                    "id": part.get("id"),
                    "kind": part.get("kind"),
                    "silk": part.get("silk"),
                    "point": part.get("point"),
                    "pad": part.get("pad"),
                    "net": (part.get("net") or {}).get("role"),
                    "status": _assignment_status(part),
                }
            )
    return rows
