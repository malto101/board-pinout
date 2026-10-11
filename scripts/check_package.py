#!/usr/bin/env python3
"""Smoke-test an installed board-pinout distribution."""

from __future__ import annotations

import argparse
from importlib.metadata import version
from pathlib import Path

import board_pinout
from board_pinout import schema_path, static_dir, types_dir


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-version")
    args = parser.parse_args()

    package_version = version("board-pinout")
    assert board_pinout.__version__ == package_version
    if args.expected_version:
        assert package_version == args.expected_version
    assert schema_path("board.schema.json").is_file()
    assert schema_path("soc_pads.schema.json").is_file()
    assert static_dir().is_dir()
    assert types_dir().is_dir()
    print(f"board-pinout {package_version}: package resources OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
