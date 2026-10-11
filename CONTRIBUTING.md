# Contributing

Thanks for improving Board Pinout. Contributions should preserve the YAML and
JSON Schema contracts used by downstream documentation projects, including the
Zephyr integration.

## Development setup

Use Python 3.10 or newer and Node.js 18 or newer:

```bash
uv sync --extra dev --extra sphinx
cd editor && npm ci && cd ..
```

Run the checks before opening a pull request:

```bash
uv run pytest
uv run ruff check src tests
sphinx-build -W --keep-going -b html docs docs/_build/html
cd editor && npm run build
```

The widget bundle at `src/board_pinout/static/board_pinout/board-pinout.js` is
generated. Rebuild it with `cd editor && npm run build:widget` and include the
result when source widget modules change. Do not hand-edit generated files.

## Adding board and SoC data

- Put reusable part types in `types/` and include editor metadata only when a
  type should appear in the palette.
- Validate board files with `board-pinout validate path/to/pinout.yaml`.
- Validate SoC tables with `board-pinout soc-pads validate path/to/table-or-dir`.
- For `mux_source: soc`, resolve with `--soc-tables` and keep the table separate.
- Zephyr's canonical table location is
  `soc/<vendor>/<soc>/doc/pinmux/<soc>.yaml`.
- Update golden fixtures only when the output change is intentional:
  `BOARD_PINOUT_UPDATE_GOLDEN=1 uv run pytest tests/test_soc_join.py`.

## Pull requests

Keep changes focused, explain schema or generated-output changes, and include
regression tests. CI must pass before merge. Do not commit secrets, generated
build directories, `node_modules`, or local documentation output.

## Releases

The canonical version is in `src/board_pinout/_version.py`. Update it and the
changelog together, then use a matching `v<version>` tag. Releases are built
once, checked, and published to TestPyPI before production PyPI; see the
release workflow and `CHANGELOG.md`.
