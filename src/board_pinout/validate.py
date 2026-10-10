"""Validate board pinout documents against JSON Schema + structural rules."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Iterator

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from board_pinout import schema_path


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def raise_if_failed(self) -> None:
        if not self.ok:
            raise ValueError("\n".join(self.errors))


# libyaml's C loader is ~5x faster on large boards and builds identical data.
_YamlLoader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)


def load_yaml(path: Path) -> Any:
    with path.open(encoding="utf-8") as fh:
        return yaml.load(fh, Loader=_YamlLoader)  # noqa: S506 - safe loader


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def _board_validator() -> Draft202012Validator:
    """Return the cached validator for the packaged board schema."""
    schema = load_json(schema_path("board.schema.json"))
    return Draft202012Validator(schema)


# Keywords whose 2020-12 semantics fastjsonschema (draft-07) would not honour.
_DRAFT2020_ONLY = ("prefixItems", "unevaluatedProperties", "unevaluatedItems",
                   "$dynamicRef", "$dynamicAnchor", "dependentSchemas",
                   "dependentRequired", "minContains", "maxContains")


@lru_cache(maxsize=1)
def _fast_validator() -> Callable[[Any], Any] | None:
    """Optional compiled validator (~10x faster); ``None`` when unavailable.

    Only used as an accept-fast path: any failure is re-checked by
    ``jsonschema`` so error messages are unchanged.
    """
    try:
        import fastjsonschema
    except ImportError:
        return None
    text = schema_path("board.schema.json").read_text(encoding="utf-8")
    if any(f'"{kw}"' in text for kw in _DRAFT2020_ONLY):
        return None
    schema = json.loads(text)
    schema["$schema"] = "http://json-schema.org/draft-07/schema#"
    try:
        return fastjsonschema.compile(schema, use_default=False, detailed_exceptions=False)
    except Exception:  # pragma: no cover - fall back to the reference validator
        return None


def _schema_is_valid_fast(doc: Any) -> bool:
    fast = _fast_validator()
    if fast is None:
        return False
    try:
        fast(doc)
    except Exception:
        return False
    return True


def _iter_parts(
    parts: list[dict[str, Any]] | None, path: str = ""
) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield parts lazily for structural validation and indexing."""
    for part in parts or []:
        pid = part.get("id", "<missing>")
        current = f"{path}/{pid}" if path else pid
        yield current, part
        yield from _iter_parts(part.get("children") or [], current)


def iter_parts(
    parts: list[dict[str, Any]] | None, path: str = ""
) -> list[tuple[str, dict[str, Any]]]:
    """Return a flat part list, preserving the legacy public API."""
    return list(_iter_parts(parts, path))


def clear_validator_cache() -> None:
    """Clear the cached schema validator after schema changes."""
    _board_validator.cache_clear()
    _fast_validator.cache_clear()




_PIN_SOURCES = ("pad", "module_pin", "expander", "net")


def _soc_ids(doc: dict[str, Any]) -> list[str]:
    soc = doc.get("soc")
    if isinstance(soc, str):
        return [soc]
    return [s.get("id") for s in soc or [] if isinstance(s, dict)]


def _check_sources(
    doc: dict[str, Any], where: str, item: dict[str, Any], errors: list[str]
) -> None:
    """1.1 rules for a pin's signal source (pad, module_pin, expander or net)."""
    sources = [key for key in _PIN_SOURCES if key in item]
    if len(sources) > 1:
        errors.append(f"{where}: more than one source ({', '.join(sources)})")
    socs = _soc_ids(doc)
    if "pad" in item:
        soc = item.get("soc")
        if soc and socs and soc not in socs:
            errors.append(f"{where}: soc '{soc}' is not listed in the document's soc")
        if not soc and len(socs) > 1:
            errors.append(f"{where}: pad needs 'soc' on a multi-SoC board")
    module = (item.get("module_pin") or {}).get("module")
    if module and module not in (doc.get("modules") or {}):
        errors.append(f"{where}: unknown module instance '{module}'")
    expander = (item.get("expander") or {}).get("id")
    if expander and expander not in (doc.get("expanders") or {}):
        errors.append(f"{where}: unknown expander '{expander}'")


def _check_assignments(
    doc: dict[str, Any], where: str, item: dict[str, Any], errors: list[str],
    warnings: list[str] | None,
) -> None:
    """``by`` must name a declared software; flag pins two softwares enable."""
    assignments = item.get("assignments") or []
    if not assignments:
        return
    software = doc.get("software") or {}
    enabled: set[str] = set()
    for a in assignments:
        by = a.get("by")
        if by is None:
            if len(software) > 1:
                errors.append(f"{where}: assignment needs 'by' (several software declared)")
            by = next(iter(software), "")
        elif by not in software:
            known = ", ".join(sorted(software)) or "none declared"
            errors.append(f"{where}: unknown software '{by}' (known: {known})")
        if a.get("status") == "enabled":
            enabled.add(by)
    if warnings is not None and len(enabled) > 1:
        warnings.append(f"{where}: enabled by more than one software ({', '.join(sorted(enabled))})")


def _check_nexus(
    face_name: str, parts: list[dict[str, Any]], errors: list[str], owner: str | None = None,
    seen: dict[int, str] | None = None,
) -> None:
    """``nexus_index`` must be unique within the nearest enclosing connector."""
    for part in parts or []:
        if "connector" in part:
            _check_nexus(face_name, part.get("children") or [], errors, part.get("id"), {})
            continue
        index = part.get("nexus_index")
        if index is not None:
            if owner is None:
                errors.append(f"{face_name}:{part.get('id')}: nexus_index outside a connector")
            elif index in seen:
                errors.append(
                    f"{face_name}:{owner}: nexus_index {index} used by "
                    f"{seen[index]} and {part.get('id')}"
                )
            else:
                seen[index] = part.get("id")
        _check_nexus(face_name, part.get("children") or [], errors, owner, seen)


def _check_patches(doc: dict[str, Any], ids: set[str], errors: list[str]) -> None:
    for section in ("revisions", "variants", "host_overrides"):
        patches = doc.get(section) or {}
        added = {
            add.get("part", {}).get("id")
            for patch in patches.values()
            for add in patch.get("add") or []
        }
        known = ids | added
        for name, patch in patches.items():
            for pid in patch.get("remove") or []:
                if pid not in known:
                    errors.append(f"{section}.{name}.remove: unknown part '{pid}'")
            for pid in patch.get("set") or {}:
                if pid not in known:
                    errors.append(f"{section}.{name}.set: unknown part '{pid}'")
            for add in patch.get("add") or []:
                parent = add.get("parent", "")
                if parent.startswith("face:"):
                    if parent[5:] not in (doc.get("faces") or {}):
                        errors.append(f"{section}.{name}.add: unknown {parent}")
                elif parent not in known:
                    errors.append(f"{section}.{name}.add: unknown parent '{parent}'")


def structural_check(
    doc: dict[str, Any],
    *,
    require_level0_points: bool = True,
    warnings: list[str] | None = None,
) -> list[str]:
    """Extra rules beyond JSON Schema; non-fatal findings go to ``warnings``."""
    errors: list[str] = []
    if doc.get("kind") == "module":
        for pin, entry in (doc.get("pins") or {}).items():
            _check_sources(doc, f"pins.{pin}", entry or {}, errors)
        return errors
    faces = doc.get("faces") or {}
    if not faces:
        errors.append("faces: at least one face is required")
        return errors

    all_ids: set[str] = set()
    for face_name, face in faces.items():
        children = face.get("children") or []
        if not children:
            errors.append(f"faces.{face_name}.children: must not be empty")
        for path, part in _iter_parts(children):
            pid = part.get("id")
            if not pid:
                errors.append(f"{face_name}:{path}: missing id")
                continue
            if pid in all_ids:
                errors.append(f"duplicate part id '{pid}' (at {face_name}:{path})")
            all_ids.add(pid)

            if "ref" not in part and "kind" not in part:
                errors.append(f"{face_name}:{path}: need 'ref' or 'kind'")

            if require_level0_points and "/" not in path and "point" not in part:
                errors.append(
                    f"{face_name}:{path}: level-0 part must have a point "
                    "(place it in the editor)"
                )

            if "point" in part:
                pt = part["point"]
                if not (isinstance(pt, list) and len(pt) == 2):
                    errors.append(f"{face_name}:{path}: point must be [x, y]")

            _check_sources(doc, f"{face_name}:{path}", part, errors)
            _check_assignments(doc, f"{face_name}:{path}", part, errors, warnings)

        _check_nexus(face_name, children, errors)

        outline = face.get("outline")
        if outline and "polygon" in outline and len(outline["polygon"]) < 3:
            errors.append(f"faces.{face_name}.outline.polygon: need >= 3 points")

    _check_patches(doc, all_ids, errors)
    return errors


def validate_document(
    doc: dict[str, Any],
    *,
    require_level0_points: bool = True,
    schema: bool = True,
) -> ValidationResult:
    """Validate ``doc``; ``schema=False`` runs only the cheap structural rules."""
    errors: list[str] = []
    if schema and not _schema_is_valid_fast(doc):
        try:
            _board_validator().validate(doc)
        except ValidationError as exc:
            errors.append(f"schema: {exc.message} (at {list(exc.absolute_path)})")

    warnings: list[str] = []
    errors.extend(
        structural_check(doc, require_level0_points=require_level0_points, warnings=warnings)
    )
    return ValidationResult(ok=not errors, errors=errors, warnings=warnings)


def validate_file(path: Path, **kwargs: Any) -> ValidationResult:
    doc = load_yaml(path)
    if not isinstance(doc, dict):
        return ValidationResult(ok=False, errors=[f"{path}: root must be a mapping"])
    return validate_document(doc, **kwargs)
