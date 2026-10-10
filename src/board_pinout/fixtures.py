"""Deterministic, schema-valid synthetic boards for scale tests and benchmarks."""

from __future__ import annotations

import random
from typing import Any

_PERIPHERALS = (
    ("uart", ("TX", "RX", "RTS", "CTS")),
    ("i2c", ("SDA", "SCL")),
    ("spi", ("SCK", "MOSI", "MISO", "CS")),
    ("pwm", ("OUT0", "OUT1")),
    ("adc", ("AIN",)),
    ("i2s", ("SCK", "WS", "SD")),
    ("can", ("TX", "RX")),
    ("qspi", ("IO0", "IO1", "IO2", "IO3")),
)


def _mux(rng: random.Random, count: int) -> list[dict[str, Any]]:
    entries = []
    for mode in range(count):
        name, signals = _PERIPHERALS[rng.randrange(len(_PERIPHERALS))]
        instance = rng.randrange(4)
        signal = signals[rng.randrange(len(signals))]
        entries.append(
            {
                "mode": mode,
                "function": f"{name.upper()}{instance}_{signal}",
                "peripheral": f"{name}{instance}",
                "signal": signal,
            }
        )
    return entries


def _pin(rng: random.Random, pid: str, silk: str, mux: int, point: list[float]):
    part: dict[str, Any] = {
        "id": pid,
        "kind": "pin",
        "silk": silk,
        "pad": f"P{rng.randrange(4)}.{rng.randrange(32):02d}",
        "point": point,
        "assignments": [{"status": "enabled" if rng.random() < 0.5 else "unknown"}],
    }
    if mux:
        part["mux"] = _mux(rng, mux)
    return part


def generate_board(
    parts: int = 1000,
    mux_per_pin: int = 10,
    *,
    board: str = "synthetic",
    group_size: int = 20,
    pin_array_every: int = 5,
    seed: int = 0,
) -> dict[str, Any]:
    """Return a board with roughly ``parts`` parts in total.

    Parts are spread across level-0 groups of ``group_size``; every
    ``pin_array_every``-th group is a synthesized ``pin_array`` header (exercising
    ``ref`` expansion) instead of explicit pins with ``mux`` entries.
    """
    rng = random.Random(seed)
    children: list[dict[str, Any]] = []
    made = 0
    group_index = 0
    while made < parts:
        gid = f"g{group_index}"
        gx = 0.05 + 0.9 * rng.random()
        gy = 0.05 + 0.9 * rng.random()
        remaining = parts - made
        if pin_array_every and group_index % pin_array_every == pin_array_every - 1 and remaining > 2:
            cols = max(1, min(group_size, remaining - 1) // 2)
            children.append(
                {"id": gid, "ref": "header_pin_array", "rows": 2, "cols": cols,
                 "silk": f"J{group_index}", "point": [round(gx, 4), round(gy, 4)]}
            )
            made += 1 + 2 * cols
        else:
            count = max(1, min(group_size, remaining - 1))
            pins = [
                _pin(rng, f"{gid}_p{i}", f"D{group_index}.{i}", mux_per_pin,
                     [round(gx + 0.002 * i, 4), round(gy, 4)])
                for i in range(count)
            ]
            children.append(
                {"id": gid, "kind": "group", "silk": f"GROUP {group_index}",
                 "point": [round(gx, 4), round(gy, 4)], "children": pins}
            )
            made += 1 + count
        group_index += 1
    return {
        "schema_version": "1.0",
        "board": board,
        "soc": "synthetic_soc",
        "faces": {"top": {"underlay": "board.webp", "children": children}},
    }


def count_parts(doc: dict[str, Any]) -> int:
    total = 0
    stack = [c for face in (doc.get("faces") or {}).values() for c in face.get("children") or []]
    while stack:
        part = stack.pop()
        total += 1
        stack.extend(part.get("children") or [])
    return total
