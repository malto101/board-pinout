"""Optional binding-metadata helpers (vendor-neutral).

Docs and Sphinx do **not** call this. Prefer authoring any binding/status fields
directly on parts in ``pinout.yaml``.

``ensure_status_defaults`` only fills missing ``zephyr.status`` / generic
``status`` with ``unknown`` — it never invents DT nodes or board-specific stubs.
"""

from __future__ import annotations

import copy
from typing import Any


def _walk_ensure(parts: list[dict[str, Any]]) -> None:
    for part in parts:
        # Prefer a neutral "status" if present; keep optional zephyr.* as authored.
        if "status" not in part:
            z = dict(part.get("zephyr") or {})
            z.setdefault("status", "unknown")
            part["zephyr"] = z
        _walk_ensure(part.get("children") or [])


def ensure_status_defaults(resolved: dict[str, Any]) -> dict[str, Any]:
    """Return a copy with missing status fields defaulted to ``unknown``."""
    out = copy.deepcopy(resolved)
    for face in (out.get("faces") or {}).values():
        _walk_ensure(face.get("children") or [])
    out["binding_join"] = {"mode": "defaults_only", "board": out.get("board")}
    return out


# Back-compat alias — no board-specific stubs.
def join_zephyr_stub(resolved: dict[str, Any]) -> dict[str, Any]:
    """Deprecated alias for :func:`ensure_status_defaults`."""
    return ensure_status_defaults(resolved)
