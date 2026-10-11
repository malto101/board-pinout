# Board Pinout Editor

Visual authoring tool for board pinout YAML and SoC pad-table documents.
The exported board format is compatible with Zephyr's out-of-tree integration.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173. The published editor is at
https://malto101.github.io/board-pinout/editor/.

`npm run sync-types` (also run automatically via `predev` / `prebuild`) regenerates `public/types.bundle.json` from the repo-root `types/` YAML. That bundle is gitignored and fetched at boot.

## Underlay

The canvas background is the face **underlay** — the same image docs will show.

1. Toolbar **Underlay** → pick WebP/PNG/SVG/JPEG (or load **ESP32 sample**).
2. Place markers; coordinates are normalized 0..1 on that image.
3. Optional **Underlay °** on the Board panel → `faces.<face>.underlay_rotation`.
4. **Export** writes `underlay: <filename>` (or a relative path you set). When
   committing to a board tree, put that file next to `pinout.yaml` (Zephyr:
   usually `doc/img/<board>.webp` and `underlay: img/<board>.webp`).

## Sample

**ESP32 sample** loads [`examples/esp32s3_devkitc/pinout.yaml`](public/examples/esp32s3_devkitc/pinout.yaml)
and the matching WebP in that folder.

## Source layout

Vite entry remains `index.html` → `src/main.js` (`boot()`). Runtime asset URLs
use Vite's base path, so the same build works below `/board-pinout/editor/`.
Logic is split under `src/`:

| Module | Role |
|--------|------|
| `state.js` | App state, DOM refs, library catalog, history push/snapshot |
| `model.js` | Tree walk, ids, points, mux helpers, visible markers |
| `symbols.js` | Part symbols / roles / marker SVG |
| `labels.js` | Label offset, fit, layout, screen-readable rotation |
| `view.js` | Pan/zoom/rotate transforms, `clientToNorm`, snap UI |
| `overlay.js` | Canvas overlay render + marker drag |
| `tree.js` | Parts tree, rename, nest/group/duplicate |
| `ui.js` | Meta form, library, peripherals, context menu, grid picker, `bindUi` |
| `util.js` | Shared HTML escaping |
| `main.js` | Boot wiring only |

## Features

- **Underlay** — board photo behind markers (see above)
- **＋ / Group** — add parts from the type library (`types/` + `editor:` metadata)
- **Drag circle / label** — set `point` and `label_offset` independently
- **Parts tree** — drag to nest, multi-select, right-click menu, ⌘G to group
- **Preview** — top-level markers + drill-down (docs UX)
- **Export** — downloads `pinout.yaml` (+ remember to ship the underlay image)
- **SoC references** — link a SoC pad table, choose a package, and select pads on
  board parts so inherited mux and electrical details are shown automatically.

## Board + SoC authoring flow

Use two documents: the board `pinout.yaml` describes physical parts and the
SoC `socpad.yaml` describes the chip's pads and mux capabilities.

1. Switch **Document → SoC pad table**.
2. Set the SoC id, description, and reference. Use **＋ Pad** to add a canonical
   pad name, aliases (for example `IO36`), type, domain, intrinsic electrical
   data, and function entries. Keep routing, remaps, `signal_select`, packages,
   and future fields in the advanced YAML editor; those fields are preserved.
3. Export **socpad.yaml**. Canonical pad names are the source-of-truth; aliases
   are accepted for lookup but are normalized when a board part is saved.
4. Switch back to **Board pinout**, set **SoC**, choose an optional **SoC
   package**, and select **Load/link SoC table** to open the exported table.
   Set **Mux source → SoC table**.
5. Create a part from **New part** (or choose an existing part). In **Selected**,
   edit `id`, `silk`, `ref`, and `kind`, then choose **SoC pad**. The selector
   searches canonical names and aliases and stores the canonical pad on the
   part. The inspector immediately shows the pad's electrical data and fixed,
   remap, signal-select, and routing mux candidates.
6. Treat inherited SoC rows as read-only previews. Add an authored mux entry only
   when the board needs an explicit override; use `mux_policy`, `mux_exclude`,
   and `mux_routable` to control how the effective choices are presented.
7. Export **pinout.yaml**. Ship the board file, underlay image, and SoC table at
   the consuming project's expected paths (for Zephyr, commonly
   `boards/<vendor>/<board>/doc/pinout.yaml` and
   `soc/<vendor>/<soc>/doc/pinmux/<soc>.yaml`).

If the board SoC and loaded table do not match, or a selected package is absent,
the inspector reports that state instead of showing stale inherited data. The
editor does not materialize derived `pad_info` or inherited mux entries into the
board YAML.

The current visual controls focus on board layout and pad/mux metadata. Advanced
SoC table fields should be edited as YAML and validated with
`board-pinout soc-pads validate`; the editor must not silently discard fields it
does not understand.

For the shortest first experiment, click **ESP32 sample**, select a pin marker,
and inspect its inherited SoC pad and mux details before editing the board.
