import json
import re
import shutil
from pathlib import Path

import pytest

pytest.importorskip("sphinx")
from sphinx.application import Sphinx  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "schema" / "fixtures" / "nrf_shaped.yaml"
DATA_DIR = "_static/board-pinout-data"


def _make_project(tmp_path, boards=("demo",), extra_conf=""):
    src = tmp_path / "src"
    src.mkdir(parents=True, exist_ok=True)
    (src / "conf.py").write_text(
        "extensions = ['board_pinout.sphinx_ext']\n"
        f"board_pinout_src_root = {str(src)!r}\n"
        "master_doc = 'index'\n" + extra_conf
    )
    toc = "\n".join(f"   boards/{b}/doc/index" for b in boards)
    (src / "index.rst").write_text(f"Root\n====\n\n.. toctree::\n\n{toc}\n")
    (src / "plain.rst").write_text("Plain\n=====\n\nNo pinout here.\n")
    for board in boards:
        board_dir = src / "boards" / board / "doc"
        (board_dir / "img").mkdir(parents=True)
        (board_dir / "index.rst").write_text(f"{board}\n{'=' * len(board)}\n\n.. board-pinout::\n")
        (board_dir / "pinout.yaml").write_text(
            FIXTURE.read_text()
            .replace("board: nrf54l15dk_fixture", f"board: {board}")
            .replace("underlay: nrf54l15dk_nrf54l15.webp", "underlay: img/underlay.webp")
        )
        (board_dir / "img" / "underlay.webp").write_bytes(f"img-{board}".encode())
    return src


def _build(tmp_path, src, parallel=1, freshenv=False):
    out, doctrees = tmp_path / "out", tmp_path / "doctrees"
    app = Sphinx(
        str(src), str(src), str(out), str(doctrees),
        buildername="html", freshenv=freshenv, parallel=parallel,
        status=None, warningiserror=False,
    )
    app.build()
    return out, app


def _data_src(page: str) -> str | None:
    match = re.search(r'data-src="([^"]+)"', page)
    return match.group(1) if match else None


def _inline_payload(page: str) -> dict:
    match = re.search(r'<script type="application/json" class="zbp-data">(.*?)</script>', page)
    assert match, "inline payload missing"
    return json.loads(match.group(1))


def _payload_files(out: Path) -> set[str]:
    return {p.name for p in (out / DATA_DIR).glob("*.board-pinout.json")}


@pytest.mark.parametrize("parallel", [1, 2])
def test_inline_mode_default(tmp_path, parallel):
    src = _make_project(tmp_path)
    out, _ = _build(tmp_path, src, parallel=parallel, freshenv=True)
    page = (out / "boards/demo/doc/index.html").read_text()
    assert "board-pinout.css" in page and "board-pinout.js" in page
    assert 'class="board-pinout"' in page
    assert _data_src(page) is None
    payload = _inline_payload(page)
    assert payload["board"] == "demo" and payload["doc"]["resolved"] is True
    assert (out / "boards/demo/doc/img/underlay.webp").read_bytes() == b"img-demo"
    assert not (out / DATA_DIR).exists()


@pytest.mark.parametrize("parallel", [1, 2])
def test_external_mode_writes_content_addressed_payloads(tmp_path, parallel):
    src = _make_project(
        tmp_path, boards=("alpha", "beta"),
        extra_conf="board_pinout_payload_mode = 'external'\n",
    )
    out, _ = _build(tmp_path, src, parallel=parallel, freshenv=True)
    seen = {}
    for board in ("alpha", "beta"):
        page_path = out / f"boards/{board}/doc/index.html"
        page = page_path.read_text()
        assert 'class="zbp-data"' not in page
        assert 'data-payload-version="1"' in page
        url = _data_src(page)
        assert url and url.startswith("../../../_static/board-pinout-data/")
        payload_path = (page_path.parent / url).resolve()
        payload = json.loads(payload_path.read_text())
        assert payload["board"] == board
        assert payload["underlay"] == "img/underlay.webp"
        seen[board] = payload_path.name
    assert seen["alpha"] != seen["beta"]
    assert _payload_files(out) == set(seen.values())
    plain = (out / "plain.html").read_text()
    assert 'class="board-pinout' not in plain
    assert "board-pinout.js" not in plain and "board-pinout.css" not in plain


def test_external_payload_is_deterministic_across_parallelism(tmp_path):
    hashes = []
    for parallel in (1, 2):
        sub = tmp_path / f"j{parallel}"
        src = _make_project(sub, extra_conf="board_pinout_payload_mode = 'external'\n")
        out, _ = _build(sub, src, parallel=parallel, freshenv=True)
        hashes.append(_payload_files(out))
    assert hashes[0] == hashes[1] and len(hashes[0]) == 1


def test_external_incremental_rebuild_replaces_stale_payload(tmp_path):
    src = _make_project(tmp_path, extra_conf="board_pinout_payload_mode = 'external'\n")
    out, _ = _build(tmp_path, src, freshenv=True)
    before = _payload_files(out)

    yaml_path = src / "boards/demo/doc/pinout.yaml"
    yaml_path.write_text(yaml_path.read_text().replace("soc: nrf54l15", "soc: nrf54l15_rev2"))
    out, _ = _build(tmp_path, src)
    after = _payload_files(out)
    assert after and after != before
    page = (out / "boards/demo/doc/index.html").read_text()
    assert _data_src(page).endswith(next(iter(after)))
    payload = json.loads((out / DATA_DIR / next(iter(after))).read_text())
    assert payload["doc"]["soc"] == "nrf54l15_rev2"


def test_external_payload_restored_after_outdir_wipe(tmp_path):
    src = _make_project(tmp_path, extra_conf="board_pinout_payload_mode = 'external'\n")
    out, _ = _build(tmp_path, src, freshenv=True)
    names = _payload_files(out)
    shutil.rmtree(out / DATA_DIR)
    out, _ = _build(tmp_path, src)  # env is up to date; no docs re-read
    assert _payload_files(out) == names


def test_external_payload_removed_when_page_drops_directive(tmp_path):
    src = _make_project(
        tmp_path, boards=("alpha", "beta"),
        extra_conf="board_pinout_payload_mode = 'external'\n",
    )
    out, _ = _build(tmp_path, src, freshenv=True)
    assert len(_payload_files(out)) == 2
    (src / "boards/beta/doc/index.rst").write_text("beta\n====\n\nNo widget.\n")
    out, _ = _build(tmp_path, src)
    assert len(_payload_files(out)) == 1


def test_inline_payload_stored_once_in_doctree(tmp_path):
    src = _make_project(tmp_path)
    _build(tmp_path, src, freshenv=True)
    doctree = (tmp_path / "doctrees/boards/demo/doc/index.doctree").read_bytes()
    assert doctree.count(b'class="zbp-data"') == 1


def test_inline_payload_escapes_script_terminator(tmp_path):
    src = _make_project(tmp_path)
    yaml_path = src / "boards/demo/doc/pinout.yaml"
    yaml_path.write_text(yaml_path.read_text().replace(
        "soc: nrf54l15", "soc: 'nrf</script><b>x</b>'", 1))
    out, _ = _build(tmp_path, src, freshenv=True)
    page = (out / "boards/demo/doc/index.html").read_text()
    assert "</script><b>" not in page
    assert _inline_payload(page)["doc"]["soc"] == "nrf</script><b>x</b>"


@pytest.mark.parametrize("mode", ["structural", "none"])
def test_validate_mode_controls_schema_pass(tmp_path, mode):
    src = _make_project(tmp_path, extra_conf=f"board_pinout_validate = {mode!r}\n")
    yaml_path = src / "boards" / "demo" / "doc" / "pinout.yaml"
    # An unknown top-level key fails the schema but not the structural rules.
    yaml_path.write_text(yaml_path.read_text() + "x_unknown_key: 1\n")
    out, _ = _build(tmp_path, src)
    page = (out / "boards" / "demo" / "doc" / "index.html").read_text()
    assert _inline_payload(page)["board"] == "demo"


def test_full_validation_rejects_schema_errors(tmp_path):
    src = _make_project(tmp_path)
    yaml_path = src / "boards" / "demo" / "doc" / "pinout.yaml"
    yaml_path.write_text(yaml_path.read_text() + "x_unknown_key: 1\n")
    out, _ = _build(tmp_path, src)
    page = (out / "boards" / "demo" / "doc" / "index.html").read_text()
    assert "failed to resolve" in page


SOC_FIXTURES = ROOT / "tests" / "fixtures"


def _make_soc_project(tmp_path):
    src = _make_project(tmp_path)
    board_dir = src / "boards" / "demo" / "doc"
    (board_dir / "pinout.yaml").write_text(
        (SOC_FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml").read_text()
    )
    table_dir = src / "soc" / "espressif" / "esp32s3" / "doc" / "pinmux"
    table_dir.mkdir(parents=True)
    (table_dir / "esp32s3.yaml").write_text(
        (SOC_FIXTURES / "soc_pads" / "esp32s3.yaml").read_text()
    )
    return src, table_dir / "esp32s3.yaml"


def _pin(payload, pid):
    stack = list(payload["doc"]["faces"]["top"]["children"])
    while stack:
        part = stack.pop()
        if part.get("id") == pid:
            return part
        stack.extend(part.get("children") or [])
    raise KeyError(pid)


def test_soc_table_join_and_incremental_rebuild(tmp_path):
    src, table = _make_soc_project(tmp_path)
    out, _ = _build(tmp_path, src, freshenv=True)
    page = out / "boards/demo/doc/index.html"
    pin = _pin(_inline_payload(page.read_text()), "j3_3")
    assert pin["pad_info"]["soc"] == "esp32s3"
    assert "U0RXD" in [e["function"] for e in pin["mux"]]

    # Editing only the SoC table must rebuild the board page.
    table.write_text(table.read_text().replace("U0RXD", "U0RXD_EDITED"))
    out, _ = _build(tmp_path, src)
    pin = _pin(_inline_payload(page.read_text()), "j3_3")
    assert "U0RXD_EDITED" in [e["function"] for e in pin["mux"]]


def test_soc_board_without_tables_warns(tmp_path):
    src, table = _make_soc_project(tmp_path)
    table.unlink()
    out, _ = _build(tmp_path, src, freshenv=True)
    page = (out / "boards/demo/doc/index.html").read_text()
    assert "failed to resolve" in page and "unknown soc" in page
