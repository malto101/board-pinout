# Board Pinout Editor

Visual authoring tool for Zephyr board pinout YAML (out of tree).

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173

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

Vite entry remains `index.html` → `/src/main.js` (`boot()`). Logic is split under `src/`:

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
