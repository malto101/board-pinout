from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

project = "Board Pinout"
copyright = "2026, Board Pinout contributors"
author = "Board Pinout contributors"
release = "0.1.0"

extensions = ["board_pinout.sphinx_ext"]
templates_path: list[str] = []
exclude_patterns = ["_build"]

board_pinout_src_root = str(Path(__file__).resolve().parent)
board_pinout_search_globs = ["**/pinout.yaml"]
html_theme = "alabaster"
html_title = "Board Pinout demo"
html_static_path: list[str] = []
