#!/usr/bin/env bash
# Validate every Zephyr boards/*/doc/pinout.yaml against the pip package.
# Schema/types/static are NOT copied into Zephyr — use the board-pinout package.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ZEPHYR_BASE="${ZEPHYR_BASE:-$ROOT/../zephyr}"

"$ROOT/scripts/sync_package_data.sh"

if ! command -v board-pinout >/dev/null 2>&1; then
  pip install -e "$ROOT"
fi

echo "Validating board doc/pinout.yaml files under $ZEPHYR_BASE/boards …"
fail=0
while IFS= read -r -d '' yaml; do
  echo "validate ${yaml#"$ZEPHYR_BASE/"}"
  if ! board-pinout validate "$yaml"; then
    fail=1
  fi
done < <(find "$ZEPHYR_BASE/boards" -type f -path '*/doc/pinout.yaml' -print0 | sort -z)

if [[ "$fail" -ne 0 ]]; then
  echo "One or more pinout.yaml files failed validation" >&2
  exit 1
fi

echo "OK — Zephyr uses pip package types/schema/static; no doc/_data/board_pinout needed"
