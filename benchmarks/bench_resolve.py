#!/usr/bin/env python3
"""Measure validation/resolution/serialization cost on synthetic boards.

Usage::

    python benchmarks/bench_resolve.py                 # size/mux matrix
    python benchmarks/bench_resolve.py --batch 5000    # 5000 x 1000-part x 10-mux

Timings are wall-clock medians and are machine-dependent; use them to compare
revisions on the same host, not as absolute limits.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import statistics
import time

from board_pinout import types_dir
from board_pinout.fixtures import count_parts, generate_board
from board_pinout.resolve import clear_type_library_cache, load_type_library, resolve_board
from board_pinout.validate import clear_validator_cache, validate_document


def _time(fn, repeat):
    samples = []
    result = None
    for _ in range(repeat):
        start = time.perf_counter()
        result = fn()
        samples.append(time.perf_counter() - start)
    return statistics.median(samples), result


def _ser(payload):
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def matrix(repeat: int) -> None:
    clear_validator_cache()
    clear_type_library_cache()
    start = time.perf_counter()
    validate_document(generate_board(10, 0))
    cold_validator = time.perf_counter() - start
    start = time.perf_counter()
    load_type_library(types_dir())
    cold_types = time.perf_counter() - start
    warm_types, types = _time(lambda: load_type_library(types_dir()), repeat)
    print(f"cold validator+validate(10 parts): {cold_validator * 1e3:.1f} ms")
    print(f"type library: cold {cold_types * 1e3:.2f} ms, warm {warm_types * 1e3:.3f} ms")
    header = f"{'parts':>6} {'mux':>4} {'actual':>7} {'validate':>9} {'resolve':>9} " \
             f"{'json':>8} {'bytes':>9} {'gzip':>8}  sha256[:12]"
    print(header)
    for parts in (10, 100, 1000):
        for mux in (0, 1, 10):
            doc = generate_board(parts, mux, seed=parts * 31 + mux)
            t_val, _ = _time(lambda: validate_document(doc), repeat)
            t_res, resolved = _time(lambda: resolve_board(doc, types, validate=False), repeat)
            payload = {"board": doc["board"], "face": "top", "underlay": "", "doc": resolved}
            t_ser, text = _time(lambda: _ser(payload), repeat)
            raw = text.encode()
            print(
                f"{parts:>6} {mux:>4} {count_parts(resolved):>7} {t_val * 1e3:>7.2f}ms "
                f"{t_res * 1e3:>7.2f}ms {t_ser * 1e3:>6.2f}ms {len(raw):>9} "
                f"{len(gzip.compress(raw, 6)):>8}  {hashlib.sha256(raw).hexdigest()[:12]}"
            )


def batch(boards: int, parts: int, mux: int) -> None:
    types = load_type_library(types_dir())
    t_val = t_res = t_ser = 0.0
    total = gz = 0
    wall = time.perf_counter()
    for i in range(boards):
        doc = generate_board(parts, mux, board=f"b{i}", seed=i)
        t = time.perf_counter()
        validate_document(doc).raise_if_failed()
        t_val += time.perf_counter() - t
        t = time.perf_counter()
        resolved = resolve_board(doc, types, validate=False)
        t_res += time.perf_counter() - t
        t = time.perf_counter()
        raw = _ser({"board": doc["board"], "face": "top", "underlay": "", "doc": resolved}).encode()
        t_ser += time.perf_counter() - t
        total += len(raw)
        if i < 50:
            gz += len(gzip.compress(raw, 6))
    wall = time.perf_counter() - wall
    sample = min(boards, 50)
    print(f"boards={boards} parts={parts} mux={mux}")
    print(f"  validate  {t_val:8.1f} s total  {t_val / boards * 1e3:7.2f} ms/board")
    print(f"  resolve   {t_res:8.1f} s total  {t_res / boards * 1e3:7.2f} ms/board")
    print(f"  serialize {t_ser:8.1f} s total  {t_ser / boards * 1e3:7.2f} ms/board")
    print(f"  wall (incl. fixture generation) {wall:.1f} s")
    print(f"  payload {total / boards / 1024:.0f} KiB/board raw, "
          f"{gz / sample / 1024:.0f} KiB/board gzip (sampled), "
          f"{total / 2**30:.2f} GiB total raw")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repeat", type=int, default=5)
    parser.add_argument("--batch", type=int, default=0, help="boards in batch mode")
    parser.add_argument("--parts", type=int, default=1000)
    parser.add_argument("--mux", type=int, default=10)
    args = parser.parse_args()
    if args.batch:
        batch(args.batch, args.parts, args.mux)
    else:
        matrix(args.repeat)


if __name__ == "__main__":
    main()
