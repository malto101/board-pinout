"""Compare two resolved boards: effective mux and pin fields per part id."""

from __future__ import annotations

from collections import Counter
from typing import Any

from board_pinout.validate import iter_parts

# Pin fields that change what the widget shows besides the mux list.
_FIELDS = ("pad", "net", "gating", "electrical")


def _parts(resolved: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for face in (resolved.get("faces") or {}).values():
        for _path, part in iter_parts(face.get("children") or []):
            if part.get("id") is not None:
                out.setdefault(part["id"], part)
    return out


def _functions(part: dict[str, Any]) -> dict[str, str]:
    """``{function: source}``; inline 1.0 entries have no source and count as ``board``."""
    return {e["function"]: e.get("source", "board") for e in part.get("mux") or []}


def diff_boards(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """Per-part differences. Both inputs must be resolved with routing expanded."""
    a, b = _parts(old), _parts(new)
    pins: dict[str, dict[str, Any]] = {}
    gained_by_source: Counter[str] = Counter()
    lost_total = 0
    for pid in sorted(a.keys() | b.keys()):
        pa, pb = a.get(pid), b.get(pid)
        if pa is None or pb is None:
            pins[pid] = {"only_in": "new" if pa is None else "old"}
            continue
        fa, fb = _functions(pa), _functions(pb)
        entry: dict[str, Any] = {}
        lost = sorted(fa.keys() - fb.keys())
        if lost:
            entry["lost"] = lost
            lost_total += len(lost)
        gained = Counter(fb[f] for f in fb.keys() - fa.keys())
        if gained:
            entry["gained"] = dict(sorted(gained.items()))
            gained_by_source.update(gained)
        changed = {
            k: {"old": pa.get(k), "new": pb.get(k)} for k in _FIELDS if pa.get(k) != pb.get(k)
        }
        if changed:
            entry["changed"] = changed
        if entry:
            pins[pid] = entry
    return {
        "parts": len(a.keys() | b.keys()),
        "lost": lost_total,
        "gained": dict(sorted(gained_by_source.items())),
        "pins": pins,
    }


def format_diff(result: dict[str, Any]) -> str:
    lines = [
        f"{result['parts']} parts; {result['lost']} mux entries lost; gained: "
        + (", ".join(f"{n} {src}" for src, n in result["gained"].items()) or "none")
    ]
    for pid, entry in result["pins"].items():
        if "only_in" in entry:
            lines.append(f"{pid}: only in {entry['only_in']}")
            continue
        bits = []
        if entry.get("lost"):
            bits.append("lost " + ", ".join(entry["lost"]))
        if entry.get("gained"):
            bits.append("gained " + ", ".join(f"{n} {s}" for s, n in entry["gained"].items()))
        for key, change in (entry.get("changed") or {}).items():
            bits.append(f"{key} {change['old']!r} -> {change['new']!r}")
        lines.append(f"{pid}: " + "; ".join(bits))
    return "\n".join(lines) + "\n"
