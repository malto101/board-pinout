"""CLI for board-pinout validate / resolve / diff / status-defaults."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from board_pinout import __version__, types_dir
from board_pinout.diff import diff_boards, format_diff
from board_pinout.join import ensure_status_defaults
from board_pinout.resolve import resolve_file, summarize_tree
from board_pinout.soc_pads import (
    SocJoinReport,
    SocTableError,
    find_soc_tables,
    load_soc_index,
    validate_soc_file,
)
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
    for warning in result.warnings:
        print(f"warning: {args.board}: {warning}", file=sys.stderr)
    if result.ok:
        print(f"OK: {args.board}")
        return 0
    print(f"FAIL: {args.board}", file=sys.stderr)
    for err in result.errors:
        print(f"  - {err}", file=sys.stderr)
    return 1


def _soc_paths(values: list[str] | None) -> list[Path]:
    """Expand ``--soc-tables`` values: table files, or dirs searched for YAML."""
    paths: list[Path] = []
    for value in values or []:
        path = Path(value)
        if path.is_dir():
            paths.extend(find_soc_tables(path, ["**/*.yaml", "**/*.yml"]))
        else:
            paths.append(path)
    return paths


def cmd_resolve(args: argparse.Namespace) -> int:
    paths = _soc_paths(args.soc_tables)
    index = load_soc_index(paths) if paths else None
    report = SocJoinReport()
    try:
        resolved = resolve_file(
            Path(args.board),
            Path(args.types),
            soc_index=index,
            report=report,
            expand_routing=args.expand_routing,
        )
    except SocTableError as exc:
        print(f"FAIL: {args.board}\n  - {exc}", file=sys.stderr)
        return 1
    for warning in report.warnings:
        print(f"warning: {warning}", file=sys.stderr)
    if args.status_defaults:
        resolved = ensure_status_defaults(resolved)
    _write_json(Path(args.output) if args.output else None, resolved)
    if args.summary:
        _write_json(Path(args.summary), summarize_tree(resolved))
    return 0


def cmd_diff(args: argparse.Namespace) -> int:
    paths = _soc_paths(args.soc_tables)
    index = load_soc_index(paths) if paths else None
    types = Path(args.types) if args.types else types_dir()
    resolved: list[dict] = []
    for board in (args.old, args.new):
        report = SocJoinReport()
        try:
            resolved.append(
                resolve_file(
                    Path(board),
                    types,
                    soc_index=index,
                    report=report,
                    expand_routing=True,
                )
            )
        except SocTableError as exc:
            print(f"FAIL: {board}\n  - {exc}", file=sys.stderr)
            return 1
        for warning in report.warnings:
            print(f"warning: {board}: {warning}", file=sys.stderr)
    result = diff_boards(*resolved)
    if args.json:
        _write_json(None, result)
    else:
        sys.stdout.write(format_diff(result))
    return 0


def cmd_soc_validate(args: argparse.Namespace) -> int:
    paths = _soc_paths(args.tables)
    if not paths:
        print("FAIL: no SoC table files found", file=sys.stderr)
        return 1
    failed = 0
    for path in paths:
        result = validate_soc_file(path)
        if result.ok:
            print(f"OK: {path}")
            continue
        failed += 1
        print(f"FAIL: {path}", file=sys.stderr)
        for err in result.errors:
            print(f"  - {err}", file=sys.stderr)
    index = load_soc_index(paths)
    for soc in index.ids():
        try:
            index.get(soc)
        except SocTableError as exc:
            failed += 1
            print(f"FAIL: {soc}: {exc}", file=sys.stderr)
    return 1 if failed else 0


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
    p_res.add_argument(
        "--soc-tables",
        action="append",
        metavar="PATH",
        help="SoC pad table file or directory (repeatable); needed for mux_source: soc",
    )
    p_res.add_argument(
        "--expand-routing",
        action="store_true",
        help="Copy routing-rule entries into every pad's mux instead of sharing soc_routing",
    )
    p_res.set_defaults(func=cmd_resolve)

    p_diff = sub.add_parser(
        "diff", help="Compare the effective mux and pin fields of two boards (for migrations)"
    )
    p_diff.add_argument("old", help="Original pinout.yaml")
    p_diff.add_argument("new", help="Changed pinout.yaml")
    p_diff.add_argument("--types", help="Part types directory (default: package types)")
    p_diff.add_argument(
        "--soc-tables", action="append", metavar="PATH", help="SoC table file or directory"
    )
    p_diff.add_argument("--json", action="store_true", help="Print the diff as JSON")
    p_diff.set_defaults(func=cmd_diff)

    p_soc = sub.add_parser("soc-pads", help="SoC pad table tools")
    soc_sub = p_soc.add_subparsers(dest="soc_cmd", required=True)
    p_soc_val = soc_sub.add_parser(
        "validate", help="Validate SoC pad tables (files or directories), including based_on"
    )
    p_soc_val.add_argument("tables", nargs="+")
    p_soc_val.set_defaults(func=cmd_soc_validate)

    p_join = sub.add_parser("status-defaults", help="Fill missing status fields with 'unknown'")
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
