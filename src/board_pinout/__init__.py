"""Board pinout schema validation, resolve, and Sphinx helpers."""

from __future__ import annotations

from pathlib import Path

__version__ = "0.1.0"

_PKG = Path(__file__).resolve().parent
# Checkout: repo/src/board_pinout → parents[2]; installed wheel: data lives under _PKG
_REPO = _PKG.parents[2] if (_PKG.parents[2] / "pyproject.toml").is_file() else _PKG.parents[1]


def schema_dir() -> Path:
    """Directory of shipped JSON Schema files (package data or repo ``schema/``)."""
    for candidate in (_PKG / "schema", _REPO / "schema"):
        if candidate.is_dir() and (candidate / "board.schema.json").is_file():
            return candidate
    raise FileNotFoundError(
        "board-pinout schema not found (install the package or use a full checkout)"
    )


def types_dir() -> Path:
    """Directory of shipped vendor-neutral part-type YAML (``types/*.yaml``)."""
    for candidate in (_PKG / "types", _REPO / "types"):
        if candidate.is_dir() and (
            (candidate / "base.yaml").is_file() or any(candidate.glob("*.yaml"))
        ):
            return candidate
    raise FileNotFoundError(
        "board-pinout types not found (install the package or use a full checkout)"
    )


def static_dir() -> Path:
    """Directory containing board-pinout.js / board-pinout.css."""
    candidate = _PKG / "static" / "board_pinout"
    if candidate.is_dir() and (candidate / "board-pinout.js").is_file():
        return candidate
    raise FileNotFoundError("board-pinout static assets not found in package")


def schema_path(name: str = "board.schema.json") -> Path:
    """Return path to a shipped JSON Schema file."""
    path = schema_dir() / name
    if not path.is_file():
        raise FileNotFoundError(path)
    return path
