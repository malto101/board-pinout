#!/usr/bin/env bash
# Debug-only: build a standalone HTML preview for one board's doc/pinout.yaml.
#
# Usage:
#   ./scripts/preview_board.sh --debug [board_name] [outdir]
#
# Opt-in only — not part of normal sync/docs flow.
# Default outdir: $ZEPHYR_BASE/doc/_build/pinout_preview (build tree, not committed)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZEPHYR_BASE="${ZEPHYR_BASE:-$ROOT/../zephyr}"

usage() {
  cat <<EOF
Debug-only pinout HTML preview (not needed for docs builds).

  $0 --debug [board_name] [outdir]

Env: BOARD_PINOUT_PREVIEW=1 is accepted instead of --debug.
EOF
}

DEBUG=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --debug|-d) DEBUG=1 ;;
    -h|--help) usage; exit 0 ;;
    *) ARGS+=("$arg") ;;
  esac
done

if [[ "$DEBUG" -ne 1 && "${BOARD_PINOUT_PREVIEW:-}" != "1" ]]; then
  usage >&2
  echo "Refusing to run without --debug (preview is for debugging only)." >&2
  exit 2
fi

BOARD="${ARGS[0]:-nrf54l15dk}"
OUT="${ARGS[1]:-$ZEPHYR_BASE/doc/_build/pinout_preview}"

"$ROOT/scripts/sync_package_data.sh"

if ! command -v board-pinout >/dev/null 2>&1; then
  pip install -e "$ROOT"
fi

YAML="$(find "$ZEPHYR_BASE/boards" -type f -path "*/${BOARD}/doc/pinout.yaml" | head -1)"
if [[ -z "$YAML" ]]; then
  echo "No boards/*/${BOARD}/doc/pinout.yaml found" >&2
  exit 1
fi
DOC_DIR="$(dirname "$YAML")"

mkdir -p "$OUT"

python3 - <<PY
from pathlib import Path
import json, shutil
from board_pinout import static_dir, types_dir
from board_pinout.resolve import resolve_file

doc_dir = Path("$DOC_DIR")
out = Path("$OUT")
yaml_path = doc_dir / "pinout.yaml"
resolved = resolve_file(yaml_path, types_dir())
face = "top"
underlay = (resolved.get("faces") or {}).get(face, {}).get("underlay") or ""
underlay_name = Path(underlay).name if underlay else ""
if underlay:
    src = doc_dir / underlay
    if src.is_file():
        shutil.copy2(src, out / underlay_name)
        underlay_name = src.name

static = static_dir()
shutil.copy2(static / "board-pinout.js", out / "board-pinout.js")
shutil.copy2(static / "board-pinout.css", out / "board-pinout.css")

payload = {
    "board": resolved.get("board") or "$BOARD",
    "face": face,
    "underlay": underlay_name,
    "doc": resolved,
}
html = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><title>{payload['board']} pinout preview</title>
<link rel="stylesheet" href="board-pinout.css"/>
</head><body style="margin:1rem;font-family:system-ui,sans-serif;background:#111;color:#eee">
<h1 style="font-size:1.1rem;font-weight:600">{payload['board']} pinout</h1>
<div class="board-pinout zephyr-board-pinout" id="board-pinout-{payload['board']}-top" data-underlay-rel="{underlay_name}">
<div class="zbp-toolbar"><input type="search" class="zbp-search" placeholder="Search parts…"/>
<span class="zbp-hint">Drag to pan · scroll to zoom · marker Expand/Info · empty click = top</span></div>
<div class="zbp-layout"><div class="zbp-stage"><img class="zbp-underlay" alt="board"/>
<svg class="zbp-overlay" xmlns="http://www.w3.org/2000/svg"></svg></div>
<div class="zbp-side"><div class="zbp-breadcrumb"></div><div class="zbp-detail"></div></div></div>
<script type="application/json" class="zbp-data">{json.dumps(payload, separators=(',', ':'))}</script>
</div>
<script src="board-pinout.js"></script>
</body></html>
"""
(out / f"{payload['board']}.html").write_text(html)
print(f"wrote {out / (payload['board'] + '.html')}")
PY
