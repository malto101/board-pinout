"""Parity check of the widget's flat JS index against the recursive helpers."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from board_pinout import types_dir
from board_pinout.fixtures import generate_board
from board_pinout.resolve import load_type_library, resolve_board

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "benchmarks" / "bench_widget_index.mjs"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


@pytest.mark.parametrize("parts,mux", [(100, 1), (1000, 10)])
def test_widget_index_matches_recursive_helpers(tmp_path: Path, parts: int, mux: int) -> None:
    resolved = resolve_board(generate_board(parts, mux), load_type_library(types_dir()))
    data = tmp_path / "board.json"
    data.write_text(json.dumps(resolved), encoding="utf-8")
    proc = subprocess.run(
        ["node", str(SCRIPT), str(data)], capture_output=True, text=True, timeout=60
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    report = json.loads(proc.stdout)
    assert report["ok"], report["failures"]
    assert report["parts"] >= parts
