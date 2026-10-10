"""
Project-agnostic Sphinx extension for interactive board pinout diagrams.

Any docs tree can use it by configuring paths,
a vendor, or DT join stubs. Authored metadata in ``pinout.yaml`` is shown as-is.

Directive
---------

.. code-block:: rst

   .. board-pinout::
   .. board-pinout:: my_board
   .. board-pinout::
      :face: top
      :file: pinout.yaml

Config (``conf.py``)
--------------------

- ``board_pinout_types_path`` - part types dir/file (default: types shipped in the pip package)
- ``board_pinout_src_root`` - root used when resolving search globs (default: srcdir)
- ``board_pinout_search_globs`` - globs under src_root for ``*/pinout.yaml``
  (default: ``["**/doc/pinout.yaml", "**/pinout.yaml"]``)
- ``board_pinout_filename`` - default YAML name beside the page (default: ``pinout.yaml``)
- ``board_pinout_static_path`` - directory containing ``board-pinout.js/css``
  (default: static assets shipped in the pip package)
- ``board_pinout_payload_mode`` - ``"inline"`` (default) embeds resolved JSON in
  the page; ``"external"`` writes content-addressed JSON under
  ``board_pinout_data_dir`` that the widget fetches when scrolled into view
- ``board_pinout_data_dir`` - output dir for external payloads
  (default: ``_static/board-pinout-data``)
- ``board_pinout_data_url_prefix`` - optional absolute URL/CDN prefix for payloads
- ``board_pinout_validate`` - ``"full"`` (default) JSON Schema + structural checks;
  ``"structural"`` skips the schema pass (use when CI runs ``board-pinout
  validate``); ``"none"`` skips validation entirely
- ``board_pinout_soc_search_globs`` - globs under src_root for SoC pad tables used
  by ``mux_source: soc`` boards (default: ``["soc/**/doc/pinmux/*.yaml"]``)

Underlay
--------

Each face may set ``underlay`` to an image path relative to ``pinout.yaml``
(WebP/PNG/SVG/JPEG). The extension copies that file into the HTML build and
serves it behind the markers. Optional ``underlay_rotation`` (degrees) sets the
default view. Missing underlay files produce a Sphinx warning.
"""

from __future__ import annotations

import hashlib
import json
import os
import posixpath
import shutil
from html import escape
from pathlib import Path
from typing import Any, ClassVar

from docutils import nodes
from docutils.parsers.rst import directives
from sphinx.application import Sphinx
from sphinx.util import logging
from sphinx.util.docutils import SphinxDirective

from board_pinout import __version__, static_dir, types_dir
from board_pinout.resolve import load_type_library, resolve_board
from board_pinout.soc_pads import SocJoinReport, find_soc_tables, load_soc_index
from board_pinout.validate import load_yaml

logger = logging.getLogger(__name__)

_PAYLOAD_VERSION = 1
_PAYLOAD_MODES = ("inline", "external")
# board_pinout_validate -> resolve_board(validate=...)
_VALIDATE_MODES: dict[str, bool | str] = {"full": True, "structural": "structural", "none": False}
_DEFAULT_DATA_DIR = "_static/board-pinout-data"
_GENERATED_PAYLOAD_SUFFIX = ".board-pinout.json"


def _json_payload(payload: dict[str, Any]) -> tuple[str, str]:
    """Return deterministic JSON text and its content hash."""
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]
    return text, digest


def _payload_relpath(data_dir: str, digest: str) -> str:
    return posixpath.join(data_dir.strip("/"), f"{digest}{_GENERATED_PAYLOAD_SUFFIX}")


def _payload_cache_dir(env) -> Path:
    """Payload store beside the pickled env, so it survives a wiped outdir."""
    return Path(env.doctreedir) / "board-pinout-data"


def _write_payload(directory: Path, name: str, text: str) -> None:
    """Atomically write a content-addressed payload (idempotent across workers)."""
    target = directory / name
    if target.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    temporary.write_text(text, encoding="utf-8")
    try:
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def _payload_mode(config) -> str:
    mode = str(config.board_pinout_payload_mode or "inline").lower()
    if mode not in _PAYLOAD_MODES:
        logger.warning(
            "board-pinout: unknown board_pinout_payload_mode %r; using 'inline'", mode
        )
        return "inline"
    return mode


def _validate_mode(config) -> bool | str:
    mode = str(config.board_pinout_validate or "full").lower()
    if mode not in _VALIDATE_MODES:
        logger.warning(
            "board-pinout: unknown board_pinout_validate %r; using 'full'", mode
        )
        mode = "full"
    return _VALIDATE_MODES[mode]


def _payload_url(config, docname: str, relative: str) -> str:
    """URL for a payload: absolute under a prefix, else relative to the page."""
    prefix = str(config.board_pinout_data_url_prefix or "").rstrip("/")
    if prefix:
        return f"{prefix}/{posixpath.basename(relative)}"
    page_dir = posixpath.dirname(docname)
    return posixpath.relpath(relative, page_dir or ".")


def _as_path(value: Any) -> Path | None:
    if value is None or value == "":
        return None
    return Path(value).expanduser().resolve()


_DEFAULT_SOC_GLOBS = ["soc/**/doc/pinmux/*.yaml"]
# (src_root, globs) -> paths; cleared at builder-inited so each build rescans once.
_soc_table_paths: dict[tuple[str, tuple[str, ...]], list[Path]] = {}
_pinout_paths: dict[tuple[str, tuple[str, ...]], list[Path]] = {}


def _soc_index(env):
    cfg = env.config
    src_root = _as_path(cfg.board_pinout_src_root) or Path(env.srcdir).resolve()
    globs = tuple(cfg.board_pinout_soc_search_globs or ())
    key = (str(src_root), globs)
    if key not in _soc_table_paths:
        _soc_table_paths[key] = find_soc_tables(src_root, globs)
    return load_soc_index(_soc_table_paths[key])


def _find_pinout_yaml(env, board: str | None, filename: str) -> Path | None:
    """Locate pinout YAML relative to the page, then via configured search globs."""
    cfg = env.config
    src_root = _as_path(cfg.board_pinout_src_root) or Path(env.srcdir).resolve()
    page_dir = (Path(env.srcdir) / Path(env.docname).parent).resolve()

    # 1) Same directory as the RST page (most portable)
    beside = page_dir / filename
    if beside.is_file():
        return beside

    # 2) src_root / docname.parent / filename; when the source tree is
    #    mirrored into srcdir, (1) already hits.
    alt = src_root / Path(env.docname).parent / filename
    if alt.is_file():
        return alt

    # A tree-wide glob takes seconds on a large tree; run it once per build.
    key = (str(src_root), tuple(cfg.board_pinout_search_globs or ()))
    if key not in _pinout_paths:
        found = [p for pattern in key[1] for p in src_root.glob(pattern) if p.is_file()]
        _pinout_paths[key] = list(dict.fromkeys(found))
    matches = _pinout_paths[key]

    # Prefer board-id match in path when given
    if board:
        board_hits = [p for p in matches if board in p.parts]
        if len(board_hits) == 1:
            return board_hits[0]
        if len(board_hits) > 1:
            # Prefer .../<board>/doc/<filename>
            preferred = [p for p in board_hits if p.parent.name == "doc"]
            if len(preferred) == 1:
                return preferred[0]
            logger.warning(
                "board-pinout: multiple %s for board %s: %s",
                filename,
                board,
                board_hits,
            )
            return board_hits[0]

    return None


class BoardPinoutDirective(SphinxDirective):
    """Embed a read-only interactive pinout viewer from pinout.yaml."""

    has_content = False
    required_arguments = 0
    optional_arguments = 1
    option_spec: ClassVar[dict[str, Any]] = {
        "board": directives.unchanged,
        "face": directives.unchanged,
        "file": directives.unchanged,
    }

    def run(self) -> list[nodes.Node]:
        env = self.env
        cfg = env.config
        board = self.options.get("board") or (self.arguments[0] if self.arguments else None)
        face = self.options.get("face") or "top"
        filename = self.options.get("file") or cfg.board_pinout_filename or "pinout.yaml"

        types_path = _as_path(cfg.board_pinout_types_path)
        if types_path is None:
            try:
                types_path = types_dir()
            except FileNotFoundError as exc:
                logger.warning("board-pinout: %s", exc, location=self.get_location())
                return []
        if not types_path.exists():
            logger.warning(
                "board-pinout: board_pinout_types_path missing (%s)",
                types_path,
                location=self.get_location(),
            )
            return []

        yaml_path = _find_pinout_yaml(env, board, filename)
        if not yaml_path:
            msg = (
                f"board-pinout: could not find {filename} beside this page "
                f"(or via board_pinout_search_globs)"
                + (f" for board '{board}'" if board else "")
            )
            logger.warning("%s", msg, location=self.get_location())
            return [
                nodes.warning(
                    "",
                    nodes.paragraph(text=msg),
                )
            ]

        doc_dir = yaml_path.parent
        try:
            raw_doc = load_yaml(yaml_path)
            if not board and isinstance(raw_doc, dict):
                board = raw_doc.get("board") or doc_dir.parent.name
            # Resolve the already-parsed document; avoid a second YAML parse.
            uses_soc = isinstance(raw_doc, dict) and raw_doc.get("mux_source") == "soc"
            report = SocJoinReport()
            resolved = resolve_board(
                raw_doc,
                load_type_library(types_path),
                validate=_validate_mode(cfg),
                soc_index=_soc_index(env) if uses_soc else None,
                report=report,
            )
            for table_path in sorted(report.paths):
                env.note_dependency(table_path)
            for warning in report.warnings:
                logger.warning(
                    "board-pinout: %s: %s", yaml_path.name, warning, location=self.get_location()
                )
        except Exception as exc:
            logger.warning(
                "board-pinout: failed to resolve %s: %s",
                yaml_path,
                exc,
                location=self.get_location(),
            )
            return [
                nodes.warning(
                    "",
                    nodes.paragraph(
                        text=f"Board pinout failed to resolve ({yaml_path.name}): {exc}"
                    ),
                )
            ]

        if not board:
            board = resolved.get("board") or doc_dir.parent.name

        face_data = (resolved.get("faces") or {}).get(face)
        if not face_data:
            logger.warning(
                "board-pinout: face '%s' not found in %s",
                face,
                yaml_path,
                location=self.get_location(),
            )
            return []

        underlay = face_data.get("underlay") or ""
        underlay_uri = ""
        underlay_rel = ""
        if underlay:
            src = (doc_dir / underlay).resolve()
            try:
                src.relative_to(doc_dir.resolve())
            except ValueError:
                src = Path()
            if src.is_file():
                page_dir = Path(env.docname).parent
                dest_rel = (page_dir / underlay).as_posix()
                underlay_uri = underlay
                underlay_rel = underlay
                env.note_dependency(str(yaml_path))
                env.note_dependency(str(src))
                assets_by_doc = getattr(env, "board_pinout_assets_by_doc", {})
                assets_by_doc.setdefault(env.docname, set()).add((str(src), dest_rel))
                env.board_pinout_assets_by_doc = assets_by_doc
                # Keep the flat set for compatibility with environments created
                # by older versions of the extension.
                env.board_pinout_assets = getattr(env, "board_pinout_assets", set())
                env.board_pinout_assets.add((str(src), dest_rel))
            else:
                logger.warning(
                    "board-pinout: underlay not found: %s (from %s)",
                    underlay,
                    yaml_path,
                    location=self.get_location(),
                )

        payload = {
            "board": board,
            "face": face,
            "underlay": underlay_uri,
            "doc": resolved,
        }
        env.note_dependency(str(yaml_path))
        if _payload_mode(cfg) == "external":
            text, digest = _json_payload(payload)
            relative = _payload_relpath(cfg.board_pinout_data_dir or _DEFAULT_DATA_DIR, digest)
            _write_payload(_payload_cache_dir(env), posixpath.basename(relative), text)
            by_doc = getattr(env, "board_pinout_payloads_by_doc", {})
            by_doc.setdefault(env.docname, set()).add(relative)
            env.board_pinout_payloads_by_doc = by_doc
            data_attrs = (
                f' data-src="{escape(_payload_url(cfg, env.docname, relative))}"'
                f' data-payload-version="{_PAYLOAD_VERSION}"'
            )
            data_script = ""
        else:
            # ``</`` would terminate the script element early; JSON allows ``<\/``.
            inline = json.dumps(payload, separators=(",", ":")).replace("</", "<\\/")
            data_attrs = ""
            data_script = f'<script type="application/json" class="zbp-data">{inline}</script>'

        uid = f"board-pinout-{board}-{face}".replace("/", "-")
        board_attr = escape(str(board))
        # Neutral class + legacy alias for existing CSS.
        raw = (
            f'<div class="board-pinout" id="{escape(uid)}" '
            f'data-board="{board_attr}" data-face="{escape(face)}" '
            f'data-underlay-rel="{escape(underlay_rel)}"{data_attrs}>'
            f'<div class="zbp-toolbar">'
            f'<div class="zbp-search-wrap">'
            f'<input type="search" class="zbp-search" placeholder="Search parts…" '
            f'aria-label="Search pinout parts" />'
            f'<button type="button" class="zbp-search-clear" hidden title="Clear search" '
            f'aria-label="Clear search">×</button>'
            f"</div>"
            f'<span class="zbp-hint">Click to highlight · hover ℹ for info · '
            f"drag canvas to pan · scroll zoom</span>"
            f"</div>"
            f'<div class="zbp-layout">'
            f'<div class="zbp-stage">'
            f'<img class="zbp-underlay" alt="{board_attr} pinout underlay" />'
            f'<svg class="zbp-overlay" xmlns="http://www.w3.org/2000/svg"></svg>'
            f"</div>"
            f'<div class="zbp-side">'
            f'<div class="zbp-side-tools">'
            f'<label class="zbp-peri-label">Peripheral'
            f'<select class="zbp-peripheral" aria-label="Filter by peripheral">'
            f'<option value="">All peripherals</option>'
            f"</select></label>"
            f'<p class="zbp-peri-hint">Mux filter — highlights matching pins on the board</p>'
            f"</div>"
            f'<div class="zbp-breadcrumb"></div>'
            f'<div class="zbp-detail"></div>'
            f"</div>"
            f"</div>"
            f"{data_script}"
            f"</div>"
        )
        # A non-empty rawsource stops Sphinx copying the payload into it, which
        # would pickle it twice in the doctree.
        node = nodes.raw(self.block_text, raw, format="html")
        env.board_pinout_pages = getattr(env, "board_pinout_pages", set())
        env.board_pinout_pages.add(env.docname)
        return [node]


def _merge_env(
    _app: Sphinx,
    env,
    _docnames: list[str],
    other,
) -> None:
    """Merge board-pinout state collected by a parallel read worker."""
    env.board_pinout_pages = getattr(env, "board_pinout_pages", set())
    env.board_pinout_pages.update(getattr(other, "board_pinout_pages", set()))
    env.board_pinout_assets = getattr(env, "board_pinout_assets", set())
    env.board_pinout_assets.update(getattr(other, "board_pinout_assets", set()))
    assets_by_doc = getattr(env, "board_pinout_assets_by_doc", {})
    for docname, assets in getattr(other, "board_pinout_assets_by_doc", {}).items():
        assets_by_doc.setdefault(docname, set()).update(assets)
    env.board_pinout_assets_by_doc = assets_by_doc
    payloads_by_doc = getattr(env, "board_pinout_payloads_by_doc", {})
    for docname, payloads in getattr(other, "board_pinout_payloads_by_doc", {}).items():
        payloads_by_doc.setdefault(docname, set()).update(payloads)
    env.board_pinout_payloads_by_doc = payloads_by_doc


def _purge_doc(_app: Sphinx, env, docname: str) -> None:
    """Remove bookkeeping for a document removed from the environment."""
    env.board_pinout_pages = getattr(env, "board_pinout_pages", set())
    env.board_pinout_pages.discard(docname)
    assets_by_doc = getattr(env, "board_pinout_assets_by_doc", {})
    assets_by_doc.pop(docname, None)
    env.board_pinout_assets_by_doc = assets_by_doc
    env.board_pinout_assets = {
        asset for assets in assets_by_doc.values() for asset in assets
    }
    getattr(env, "board_pinout_payloads_by_doc", {}).pop(docname, None)


def _copy_assets(app: Sphinx, exception: Exception | None) -> None:
    if exception:
        return
    assets_by_doc = getattr(app.env, "board_pinout_assets_by_doc", {})
    assets = {asset for doc_assets in assets_by_doc.values() for asset in doc_assets}
    assets.update(getattr(app.env, "board_pinout_assets", set()))
    for src, dest_rel in assets:
        dest = Path(app.outdir) / dest_rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
    _publish_payloads(app)


def _publish_payloads(app: Sphinx) -> None:
    """Copy referenced payloads into the output and drop unreferenced ones."""
    by_doc = getattr(app.env, "board_pinout_payloads_by_doc", {})
    referenced = {rel for rels in by_doc.values() for rel in rels}
    cache = _payload_cache_dir(app.env)
    outdir = Path(app.outdir)
    for relative in referenced:
        dest = outdir / relative
        if dest.is_file():
            continue  # content-addressed: an existing file is already correct
        src = cache / posixpath.basename(relative)
        if not src.is_file():
            logger.warning("board-pinout: payload cache entry missing: %s", src)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
    data_dirs = {posixpath.dirname(rel) for rel in referenced}
    data_dirs.add((app.config.board_pinout_data_dir or _DEFAULT_DATA_DIR).strip("/"))
    names = {posixpath.basename(rel) for rel in referenced}
    for data_dir in data_dirs:
        for directory in (outdir / data_dir, cache):
            if not directory.is_dir():
                continue
            for path in directory.glob(f"*{_GENERATED_PAYLOAD_SUFFIX}"):
                if path.name not in names:
                    path.unlink(missing_ok=True)


def _install_static(app: Sphinx, _pagename: str, _templatename, context, _doctree) -> None:
    """Add the bundle only to pages that render a widget.

    Checks the rendered body rather than environment bookkeeping, so it holds
    under parallel writes and incremental builds alike.
    """
    if 'class="board-pinout"' not in (context.get("body") or ""):
        return
    app.add_css_file("board-pinout.css")
    app.add_js_file("board-pinout.js", priority=500)


_STATIC_FILES = ("board-pinout.css", "board-pinout.js")


def _stage_static(app: Sphinx, static: Path) -> None:
    """Copy the bundle into ``_static`` before pages are written.

    Sphinx derives the ``?v=`` cache-buster from the output copy while writing
    each page, but only copies static files at the end of the build, so pages
    would otherwise carry the previous bundle's checksum.
    """
    digest = hashlib.sha256()
    for name in _STATIC_FILES:
        src = static / name
        if not src.is_file():
            continue
        digest.update(src.read_bytes())
        if app.builder.format == "html":
            dest = Path(app.outdir) / "_static" / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
    app.board_pinout_static_digest = digest.hexdigest()


def _outdated_on_static_change(app: Sphinx, env, _added, _changed, _removed) -> list[str]:
    """Rewrite pinout pages when the bundle changes so their ``?v=`` updates."""
    current = getattr(app, "board_pinout_static_digest", None)
    previous = getattr(env, "board_pinout_static_digest", None)
    env.board_pinout_static_digest = current
    if previous is None or previous == current:
        return []
    return sorted(getattr(env, "board_pinout_pages", set()))


def setup(app: Sphinx) -> dict[str, Any]:
    app.add_config_value("board_pinout_types_path", None, "env", [str, Path])
    app.add_config_value("board_pinout_src_root", None, "env", [str, Path])
    app.add_config_value(
        "board_pinout_search_globs",
        ["**/doc/pinout.yaml", "**/pinout.yaml"],
        "env",
    )
    app.add_config_value("board_pinout_filename", "pinout.yaml", "env")
    app.add_config_value("board_pinout_static_path", None, "env", [str, Path])
    # "inline" embeds resolved JSON in each page (compatible default);
    # "external" writes content-addressed JSON fetched lazily by the widget.
    app.add_config_value("board_pinout_payload_mode", "inline", "env", [str])
    app.add_config_value("board_pinout_data_dir", _DEFAULT_DATA_DIR, "env", [str])
    app.add_config_value("board_pinout_data_url_prefix", "", "env", [str])
    app.add_config_value("board_pinout_validate", "full", "env", [str])
    app.add_config_value(
        "board_pinout_soc_search_globs", list(_DEFAULT_SOC_GLOBS), "env", [list, tuple]
    )

    app.add_directive("board-pinout", BoardPinoutDirective)

    def _add_static(a: Sphinx) -> None:
        static = _as_path(a.config.board_pinout_static_path)
        if static is None:
            try:
                static = static_dir()
            except FileNotFoundError as exc:
                logger.warning("board-pinout: %s", exc)
                return
        if static.is_dir():
            a.config.html_static_path.append(static.as_posix())
            _stage_static(a, static)
        else:
            logger.warning("board-pinout: static path missing: %s", static)

    app.connect("builder-inited", _add_static)
    app.connect("env-get-outdated", _outdated_on_static_change)
    app.connect("builder-inited", lambda _a: (_soc_table_paths.clear(), _pinout_paths.clear()))
    app.connect("env-merge-info", _merge_env)
    app.connect("env-purge-doc", _purge_doc)
    app.connect("html-page-context", _install_static)
    app.connect("build-finished", _copy_assets)

    return {
        "version": __version__,
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }
