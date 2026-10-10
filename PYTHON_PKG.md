# board-pinout Python package

Validate / resolve pinout YAML and embed an interactive viewer in **any** Sphinx
docs tree. Ships **schema**, **types**, and **widget JS/CSS** inside the wheel —
consumers do not need a `doc/_data` copy.

```bash
pip install -e ".[sphinx]"
board-pinout validate path/to/pinout.yaml
board-pinout resolve "$(python -c 'from board_pinout import types_dir; print(types_dir())')" path/to/pinout.yaml
```

## Underlay (required for a useful diagram)

Each face’s `underlay` is a path **relative to that `pinout.yaml`** to a board
image (WebP/PNG/SVG/JPEG). Marker coordinates are normalized 0..1 over that
image. Optional `underlay_rotation` (degrees, 90° steps) sets the default view.

```yaml
faces:
  top:
    underlay: img/my_board.webp
    underlay_rotation: 0
    children: […]
```

Sphinx resolves the file beside the YAML, copies it into the HTML build, and
warns if it is missing. Keep underlays next to the authored YAML (e.g.
`boards/<vendor>/<board>/doc/img/…`).

## Sphinx

```python
extensions = ["board_pinout.sphinx_ext"]
# types + static default to the package
board_pinout_src_root = "…"
board_pinout_search_globs = ["**/doc/pinout.yaml"]
```
