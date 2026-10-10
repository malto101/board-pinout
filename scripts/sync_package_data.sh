#!/usr/bin/env bash
# Refresh generated editor types bundle from repo-root types/*.yaml.
# Schema/types are single-sourced at repo root (packaged via hatch force-include).
# Vendor-specific types live in consuming repos via pinout.yaml types_inline.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

python3 - <<PY
from pathlib import Path
import json
import yaml

root = Path("$ROOT")
types: dict = {}
for p in sorted((root / "types").glob("*.yaml")):
    doc = yaml.safe_load(p.read_text()) or {}
    chunk = doc.get("types") or {}
    for key, value in chunk.items():
        if key in types:
            raise SystemExit(f"duplicate type {key!r} from {p}")
        types[key] = value

out = root / "editor/public/types.bundle.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"schema_version": "1.0", "types": types}, indent=2) + "\n")
print(f"updated {out} ({len(types)} types)")
PY
