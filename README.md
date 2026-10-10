# Board Pinout

Author and publish interactive board pinout diagrams from YAML. The project
includes a visual editor for placing parts, a Python CLI for validating and
resolving board data, and a Sphinx extension that embeds the interactive
viewer in any Sphinx documentation site.

> **Status:** Alpha (`0.1.0`). There is no hosted demo yet. The repository
> includes a complete local ESP32-S3 example and a Sphinx demo site so you can
> see the result before integrating it.

![Board Pinout preview](gif/board-pinout-preview.gif)

The GIF is a compact visual preview. For the interactive version, build the
[local Sphinx demo](#try-the-interactive-demo) or run the editor.

## What it does

A board pinout is more useful when the image, physical parts, pads, and
software-facing information can be explored together. Board Pinout provides:

- a normalized YAML format for board faces, underlays, parts, pins, headers,
  mux functions, and optional software/Zephyr metadata;
- a visual editor that imports and exports `pinout.yaml` files;
- schema and structural validation before the data reaches documentation;
- type references, `based_on` inheritance, default children, and automatic
  pin-array synthesis during resolution;
- an interactive Sphinx widget with search, marker selection, pan/zoom/rotate,
  hierarchical drill-down, and peripheral filtering; and
- packaged schema, base types, JavaScript, and CSS, so a consuming docs tree
  does not need to copy a private `_data` directory.

The current release does **not** automatically import or join a reusable SoC
pad database. Author each board pin's `mux` entries directly in its YAML;
`join.py` only fills missing software status values with `unknown`.

## Choose your path

| You want to… | Start here |
| --- | --- |
| See a working diagram | [Try the interactive demo](#try-the-interactive-demo) |
| Place parts visually | [Use the editor](#use-the-editor) |
| Embed a diagram in Sphinx | [Integrate with Sphinx](#integrate-with-sphinx) |
| Add a board or custom part | [Author board data](#author-board-data) |
| Modify the project | [Develop the project](#develop-the-project) |

## Try the interactive demo

The checked-in ESP32-S3 DevKitC example includes both its `pinout.yaml` and
matching board image. Build the Sphinx demo from the repository root:

```bash
python -m pip install -e ".[sphinx]"
sphinx-build -b html docs docs/_build/html
```

Open `docs/_build/html/index.html`. The page uses the real
`board_pinout.sphinx_ext` directive and the same widget that a consuming Sphinx
site loads. It demonstrates underlay copying, resolved parts, nested groups,
mux data, search, and the documentation-style detail panel.

The source example is at:

```text
docs/example/esp32s3_devkitc/pinout.yaml
docs/example/esp32s3_devkitc/esp32s3_devkitc.webp
```

For a visual authoring preview, start the editor instead:

```bash
cd editor
npm install
npm run dev
```

Open <http://localhost:5173>, then choose **ESP32 sample**. This loads the
matching YAML and WebP from `editor/public/examples/esp32s3_devkitc/`.

## Integrate with Sphinx

Install this checkout into the environment used to build your documentation:

```bash
python -m pip install ".[sphinx]"
```

For an editable checkout during development:

```bash
uv pip install -e ".[dev,sphinx]"
```

Enable the extension in `conf.py`:

```python
extensions = [
    "board_pinout.sphinx_ext",
]
```

Place a `pinout.yaml` where the extension can find it and add the directive to
an RST page:

```rst
.. board-pinout::
```

You can select a board, face, or file explicitly:

```rst
.. board-pinout:: my_board
   :face: top
   :file: pinout.yaml
```

By default, the extension searches beside the current page and then uses these
globs under the Sphinx source directory:

```python
board_pinout_search_globs = [
    "**/doc/pinout.yaml",
    "**/pinout.yaml",
]
```

If your boards live elsewhere, set `board_pinout_src_root` and adjust the
globs. Types and static assets default to the copies shipped in the package;
`board_pinout_types_path` and `board_pinout_static_path` are available when a
site needs overrides.

For a large documentation tree, externalize the resolved JSON payload instead
of embedding it in every HTML page:

```python
board_pinout_payload_mode = "external"
```

The default `"inline"` mode is simplest and remains compatible with small
sites.

## Author board data

A minimal board document looks like this:

```yaml
schema_version: "1.0"
board: my_board

faces:
  top:
    underlay: img/my_board.webp
    underlay_rotation: 0
    children:
      - id: usb
        ref: usb_c
        silk: USB-C
        point: [0.20, 0.50]
```

Important authoring rules:

- `board` and at least one `faces` entry are required.
- Each face has a `children` list; every top-level part needs a `point`.
- Part IDs are unique and a part provides either `ref` or `kind`.
- `point` and `label_offset` use normalized `[x, y]` coordinates in underlay
  space, normally between `0` and `1`.
- `underlay` is relative to `pinout.yaml`. Keep the image beside the YAML,
  commonly in `doc/img/`; WebP, PNG, SVG, and JPEG are supported.
- `underlay_rotation` is optional and uses 90-degree steps.

The editor writes the underlay path into YAML but does not embed or copy the
image. Commit the image at that path alongside the board YAML. During a Sphinx
build, the extension copies an existing underlay into the generated site and
warns if it cannot find the file.

Validate and resolve a board from the checkout with:

```bash
uv run board-pinout validate schema/fixtures/nrf_shaped.yaml
uv run board-pinout resolve \
  types/ schema/fixtures/nrf_shaped.yaml \
  -o /tmp/resolved.json --summary /tmp/summary.json
```

`resolve` expands type references and `based_on` chains, merges defaults, and
synthesizes children for pin arrays.

### Add reusable and board-specific parts

Use a packaged type by referencing it from a part:

```yaml
- id: debug
  ref: header_2x5_swd
  silk: SWD
  point: [0.15, 0.88]
```

A board- or vendor-specific part belongs in that board's `types_inline`, not in
the shared package library:

```yaml
types_inline:
  expansion_header:
    kind: pin_array
    based_on: header_pin_array
    rows: 2
    cols: 10
    numbering: row_major
    description: Board-specific 2x10 header

faces:
  top:
    children:
      - id: expansion
        ref: expansion_header
        silk: EXPANSION
        point: [0.55, 0.30]
```

A `pin_array` without explicit `children` gets synthesized pins from `rows`,
`cols`, `numbering`, and optional `pin_ids`. Synthesized IDs are prefixed with
the parent ID. A type appears in the editor's **New part** palette when it has
an `editor:` block; use `editor.palette: false` for a type that should remain
available to resolution but hidden from the palette.

### Add pad and mux information

A board can identify its SoC and describe how its pads are used:

```yaml
soc: esp32s3
mux_source: inline
faces:
  top:
    children:
      - id: gpio4
        kind: pin
        silk: "4"
        pad: GPIO4
        point: [0.30, 0.25]
        mux:
          - function: I2C1_SDA
            peripheral: i2c1
            signal: SDA
            mode: 0
```

Peripheral filtering in the widget is derived from these authored `mux`
entries. There is no separate SoC pad-table file or automatic SoC database join
in this release; add the pad and mux rows directly to each board YAML.

## Use the editor

Start it from the repository root:

```bash
cd editor
npm install
npm run sync-types
npm run dev
```

`npm run dev` also synchronizes the generated type catalog. In the browser:

1. Choose **ESP32 sample**, or use **Import** for an existing YAML file.
2. Use **Underlay** to upload or reselect the board image.
3. Add parts from **New part** and choose a grid for pin arrays.
4. Drag marker circles to set points and drag labels independently.
5. Nest, group, rename, duplicate, or delete parts in the parts tree.
6. Edit board name, SoC, mux source, and underlay rotation in **Board**.
7. Add pad, mux, notes, and other part metadata in **Selected**.
8. Use **Preview** to inspect the docs-style top-level view and drill down.
9. Choose **Export** to download `pinout.yaml`.

The editor also provides grid/object snapping, pan/zoom/rotate, focus, leader
vertices, undo/redo, search, and peripheral grouping. Importing YAML does not
load a local image into the browser automatically; use **Underlay** to upload
or reselect that image before editing. Export still only records its path, so
ship the image beside the YAML.

## What the viewer shows

When the corresponding data is present, the Sphinx widget provides:

- a board underlay with normalized markers and readable labels;
- pan, scroll-wheel zoom, focus, reset, and 90-degree rotation controls;
- click-to-highlight markers and hierarchical breadcrumb navigation;
- expandable groups and pin-array child grids;
- search over part ID, silk, pad, reference, kind, notes, compatible values,
  and mux fields;
- peripheral filtering with matching pin/signal lists and automatic focus;
- part details including ID, silk, kind, ref, pad, net, and gating metadata;
- mux peripheral, signal, function, and mode details; and
- optional Zephyr status, devicetree node, compatible, binding, and notes.

Electrical correctness is not inferred from the schema: the viewer displays
what the board YAML author provides. Missing software status values are shown
as `unknown`.

## Develop the project

Set up the Python package and its development dependencies:

```bash
uv sync --extra dev --extra sphinx
uv run pytest
uv run ruff check src/ tests/
uv run board-pinout --help
```

Useful focused commands:

```bash
uv run board-pinout validate schema/fixtures/nrf_shaped.yaml
uv run board-pinout resolve types/ schema/fixtures/nrf_shaped.yaml \
  -o /tmp/nrf-resolved.json
```

The editor uses Vite and its source is under `editor/src/`. After changing the
editor or widget source, rebuild the checked-in widget bundle:

```bash
cd editor
npm install
npm run sync-types
npm run build
npm run build:widget
```

`npm run build:widget` writes the production IIFE to
`src/board_pinout/static/board_pinout/board-pinout.js`. The source modules live
under `src/board_pinout/static/board_pinout/js/`; do not hand-edit the bundle.

For a Zephyr checkout, validate board pinouts with:

```bash
ZEPHYR_BASE=/path/to/zephyr ./scripts/sync_to_zephyr.sh
```

The standalone board preview script is debug-only and requires an external
Zephyr board:

```bash
ZEPHYR_BASE=/path/to/zephyr \
  ./scripts/preview_board.sh --debug nrf54l15dk
```

## Package contents

A built wheel includes the Python package, widget CSS/JavaScript, JSON Schema,
and base types. The package metadata targets Python 3.10 or newer. The Sphinx
extra installs Sphinx; the optional `fast` extra installs `fastjsonschema` for
faster validation on large docs trees.

For deeper reference, see:

- [`schema/board.schema.json`](schema/board.schema.json) — authoritative board schema
- [`schema/fixtures/nrf_shaped.yaml`](schema/fixtures/nrf_shaped.yaml) — advanced YAML example
- [`editor/README.md`](editor/README.md) — editor-specific details
- [`PYTHON_PKG.md`](PYTHON_PKG.md) — package and Sphinx notes
