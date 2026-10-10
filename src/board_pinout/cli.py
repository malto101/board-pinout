"""CLI for board-pinout validate / resolve / status-defaults."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from board_pinout import __version__
from board_pinout.join import ensure_status_defaults
from board_pinout.resolve import resolve_file, summarize_tree
from board_pinout.validate import load_yaml, validate_file


def _write_json(path: Path | None, data: object) -> None:
    text = json.dumps(data, indent=2, sort_keys=False) + "\n"
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)


def cmd_validate(args: argparse.Namespace) -> int:
    result = validate_file(Path(args.board))
    if result.ok:
        print(f"OK: {args.board}")
        return 0
    print(f"FAIL: {args.board}", file=sys.stderr)
    for err in result.errors:
        print(f"  - {err}", file=sys.stderr)
    return 1


def cmd_resolve(args: argparse.Namespace) -> int:
    resolved = resolve_file(Path(args.board), Path(args.types))
    if args.status_defaults:
        resolved = ensure_status_defaults(resolved)
    _write_json(Path(args.output) if args.output else None, resolved)
    if args.summary:
        summary_path = Path(args.summary)
        _write_json(summary_path, summarize_tree(resolved))
    return 0


def cmd_status_defaults(args: argparse.Namespace) -> int:
    path = Path(args.input)
    if path.suffix in {".yaml", ".yml"}:
        doc = load_yaml(path)
    else:
        doc = json.loads(path.read_text(encoding="utf-8"))
    _write_json(Path(args.output) if args.output else None, ensure_status_defaults(doc))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="board-pinout")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_val = sub.add_parser("validate", help="Validate a pinout.yaml / board document")
    p_val.add_argument("board")
    p_val.set_defaults(func=cmd_validate)

    p_res = sub.add_parser("resolve", help="Resolve part-type refs")
    p_res.add_argument("types", help="Part types directory or YAML file")
    p_res.add_argument("board", help="pinout.yaml path")
    p_res.add_argument("-o", "--output", help="Write resolved JSON to path")
    p_res.add_argument(
        "--status-defaults",
        action="store_true",
        help="Fill missing status fields with 'unknown' (no invented bindings)",
    )
    p_res.add_argument("--summary", help="Also write flat summary JSON")
    p_res.set_defaults(func=cmd_resolve)

    p_join = sub.add_parser(
        "status-defaults",
        help="Fill missing status fields with 'unknown'",
    )
    p_join.add_argument("input")
    p_join.add_argument("-o", "--output")
    p_join.set_defaults(func=cmd_status_defaults)

    # Deprecated alias
    p_old = sub.add_parser("join-stub", help=argparse.SUPPRESS)
    p_old.add_argument("input")
    p_old.add_argument("-o", "--output")
    p_old.set_defaults(func=cmd_status_defaults)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
