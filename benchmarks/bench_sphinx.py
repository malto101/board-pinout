"""Measure a real Sphinx HTML build over generated boards, inline vs external.

Usage: python benchmarks/bench_sphinx.py [--boards N] [--parts P] [--mux M] [-j J]
Reports build time, total HTML bytes, payload bytes and the largest page.
"""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import tempfile
import time
from pathlib import Path

import yaml
from sphinx.application import Sphinx

from board_pinout.fixtures import generate_board


def make_project(root: Path, boards: int, parts: int, mux: int, mode: str) -> Path:
    src = root / "src"
    src.mkdir(parents=True)
    (src / "conf.py").write_text(
        "extensions = ['board_pinout.sphinx_ext']\n"
        f"board_pinout_src_root = {str(src)!r}\n"
        f"board_pinout_payload_mode = {mode!r}\n"
        "master_doc = 'index'\n"
    )
    toc = "\n".join(f"   b/{i}/doc/index" for i in range(boards))
    (src / "index.rst").write_text(f"Root\n====\n\n.. toctree::\n\n{toc}\n")
    for i in range(boards):
        d = src / "b" / str(i) / "doc"
        d.mkdir(parents=True)
        (d / "index.rst").write_text(f"B{i}\n{'=' * (len(str(i)) + 1)}\n\n.. board-pinout::\n")
        doc = generate_board(parts, mux, board=f"b{i}", seed=i)
        (d / "pinout.yaml").write_text(yaml.safe_dump(doc, sort_keys=False))
    return src


def sizes(out: Path, pattern: str) -> tuple[int, int, int]:
    files = list(out.rglob(pattern))
    total = sum(f.stat().st_size for f in files)
    largest = max((f.stat().st_size for f in files), default=0)
    return len(files), total, largest


def run(args: argparse.Namespace, mode: str) -> dict:
    root = Path(tempfile.mkdtemp(prefix=f"bp-{mode}-", dir=args.tmp))
    try:
        src = make_project(root, args.boards, args.parts, args.mux, mode)
        out, dt = root / "out", root / "dt"
        t = time.perf_counter()
        Sphinx(str(src), str(src), str(out), str(dt), "html", status=None,
               warningiserror=False, parallel=args.j, freshenv=True).build()
        cold = time.perf_counter() - t
        t = time.perf_counter()
        Sphinx(str(src), str(src), str(out), str(dt), "html", status=None,
               warningiserror=False, parallel=args.j).build()
        noop = time.perf_counter() - t
        n_html, html_total, html_max = sizes(out, "b/*/doc/index.html")
        _, data_total, data_max = sizes(out / "_static", "*.json")
        sample = next(out.rglob("b/0/doc/index.html")).read_bytes()
        return {
            "mode": mode,
            "cold_s": round(cold, 1),
            "noop_rebuild_s": round(noop, 1),
            "board_pages": n_html,
            "board_html_MiB": round(html_total / 2**20, 1),
            "largest_board_page_KiB": html_max // 1024,
            "board_page_gzip_KiB": len(gzip.compress(sample)) // 1024,
            "payload_MiB": round(data_total / 2**20, 1),
            "largest_payload_KiB": data_max // 1024,
        }
    finally:
        shutil.rmtree(root, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--boards", type=int, default=50)
    ap.add_argument("--parts", type=int, default=1000)
    ap.add_argument("--mux", type=int, default=10)
    ap.add_argument("-j", type=int, default=1)
    ap.add_argument("--tmp", default=None)
    ap.add_argument("--modes", default="inline,external")
    args = ap.parse_args()
    for mode in args.modes.split(","):
        print(json.dumps(run(args, mode)), flush=True)


if __name__ == "__main__":
    main()
