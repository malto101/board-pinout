#!/usr/bin/env bash
# Validate every Zephyr boards/*/doc/pinout.yaml against the pip package.
# Schema/types/static are NOT copied into Zephyr — use the board-pinout package.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZEPHYR_BASE="${ZEPHYR_BASE:-$ROOT/../zephyr}"

if [[ ! -d "$ZEPHYR_BASE/boards" ]]; then
  echo "ZEPHYR_BASE must point to a Zephyr checkout containing boards/: $ZEPHYR_BASE" >&2
  exit 2
fi
if ! command -v board-pinout >/dev/null 2>&1; then
  echo "board-pinout is not installed; run 'uv sync' or 'python -m pip install -e $ROOT' first" >&2
  exit 2
fi

"$ROOT/scripts/sync_package_data.sh"

echo "Validating SoC tables under $ZEPHYR_BASE/soc …"
if [[ -d "$ZEPHYR_BASE/soc" ]]; then
  board-pinout soc-pads validate "$ZEPHYR_BASE/soc"
else
  echo "No Zephyr soc/ directory found; skipping SoC table validation" >&2
fi

echo "Validating board doc/pinout.yaml files under $ZEPHYR_BASE/boards …"
fail=0
soc_tables=()
if [[ -d "$ZEPHYR_BASE/soc" ]]; then
  soc_tables=(--soc-tables "$ZEPHYR_BASE/soc")
fi
while IFS= read -r -d '' yaml; do
  echo "validate ${yaml#"$ZEPHYR_BASE/"}"
  if ! board-pinout validate "$yaml"; then
    fail=1
  elif grep -q '^mux_source:[[:space:]]*soc[[:space:]]*$' "$yaml"; then
    if ! board-pinout resolve "$ROOT/types" "$yaml" "${soc_tables[@]}" >/dev/null; then
      echo "SoC resolution failed for ${yaml#"$ZEPHYR_BASE/"}" >&2
      fail=1
    fi
  fi
done < <(find "$ZEPHYR_BASE/boards" -type f -path '*/doc/pinout.yaml' -print0 | sort -z)

if [[ "$fail" -ne 0 ]]; then
  echo "One or more pinout.yaml files failed validation" >&2
  exit 1
fi

echo "OK — Zephyr uses pip package types/schema/static; no doc/_data/board_pinout needed"
