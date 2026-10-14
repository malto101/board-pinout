"""Regression coverage for the documentation pinmux archetype samples."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

pytest.importorskip("sphinx")
from sphinx.application import Sphinx

from board_pinout import types_dir
from board_pinout.resolve import load_type_library, resolve_board
from board_pinout.soc_pads import find_soc_tables, load_soc_index, validate_soc_file
from board_pinout.validate import iter_parts, load_yaml, validate_file

_BOARD_DIRECTIVE = re.compile(r"^\s*\.\.\s+board-pinout::\s+(\S+)", re.MULTILINE)
ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


def _sample_path(name: str) -> Path:
    return DOCS / "example" / name / "pinout.yaml"


def _sample_paths() -> list[Path]:
    return sorted((DOCS / "example").glob("*/pinout.yaml"))


def _soc_sample_paths() -> list[Path]:
    return [path for path in _sample_paths() if load_yaml(path).get("mux_source") == "soc"]


def _board_paths() -> dict[str, Path]:
    return {load_yaml(path)["board"]: path for path in _sample_paths()}


def _directive_boards(path: Path) -> list[str]:
    return _BOARD_DIRECTIVE.findall(path.read_text(encoding="utf-8"))


def _directive_pages() -> list[Path]:
    return sorted(path for path in DOCS.rglob("*.rst") if _directive_boards(path))


def _parts(resolved: dict) -> list[dict]:
    return [part for _path, part in iter_parts(resolved["faces"]["top"]["children"])]


def _part(resolved: dict, pad: str) -> dict:
    for part in _parts(resolved):
        if part.get("pad") == pad:
            return part
    raise AssertionError(f"sample does not contain pad {pad!r}")


def _functions(part: dict) -> set[str]:
    return {entry["function"] for entry in part.get("mux") or []}


def test_documentation_samples_validate_and_resolve() -> None:
    """Every checked-in sample must use the public board/SoC join path."""
    table_paths = find_soc_tables(DOCS, ["soc/**/doc/pinmux/*.yaml"])
    assert table_paths
    for path in table_paths:
        result = validate_soc_file(path)
        assert result.ok, f"{path}: {result.errors}"

    index = load_soc_index(table_paths)
    types = load_type_library(types_dir())
    for board_path in _sample_paths():
        document = load_yaml(board_path)
        result = validate_file(board_path)
        assert result.ok, f"{board_path}: {result.errors}"
        resolved = resolve_board(document, types, soc_index=index)
        assert resolved["resolved"] is True
        if document.get("mux_source") == "soc":
            assert all("pad_info" in part for part in _parts(resolved) if part.get("pad"))

    assert {load_yaml(path)["soc"] for path in _soc_sample_paths()} <= set(index.ids())


def test_sample_layouts_use_image_aligned_points() -> None:
    for board_path in _sample_paths():
        document = load_yaml(board_path)
        parts = iter_parts(document["faces"]["top"]["children"])
        assert all(0 <= value <= 1 for _path, part in parts for value in part.get("point", []))


def test_sample_soc_references_match_available_tables() -> None:
    table_paths = find_soc_tables(DOCS, ["soc/**/doc/pinmux/*.yaml"])
    table_ids = {load_yaml(path)["soc"] for path in table_paths}
    assert table_ids
    for board_path in _soc_sample_paths():
        document = load_yaml(board_path)
        assert document["soc"] in table_ids
        assert document.get("mux_source") == "soc"


def test_sample_directives_reference_known_boards() -> None:
    board_paths = _board_paths()
    directives = [board for path in _directive_pages() for board in _directive_boards(path)]
    assert directives
    assert set(directives) <= set(board_paths)


def test_fixed_mode_sample_preserves_j721e_modes() -> None:
    index = load_soc_index(find_soc_tables(DOCS, ["soc/**/doc/pinmux/*.yaml"]))
    types = load_type_library(types_dir())
    resolved = resolve_board(
        load_yaml(_sample_path("beaglebone_ai64_fixed_mux")), types, soc_index=index
    )
    assert {entry["mode"] for entry in _part(resolved, "P8_34")["mux"]} >= {7, 14}
    assert {entry["mode"] for entry in _part(resolved, "P9_18")["mux"]} >= {2, 7}
    assert "UART2_RXD" in _functions(_part(resolved, "P8_22"))
    assert "I2C6_SCL" in _functions(_part(resolved, "P9_17"))


def test_ai64_headers_follow_photographed_contacts() -> None:
    """P8/P9 contacts sit on the measured 2x23 socket grid of front.png."""
    document = load_yaml(_sample_path("beaglebone_ai64_fixed_mux"))
    headers = {part["id"]: part for part in document["faces"]["top"]["children"]}
    for name, (even_y, odd_y) in {"p8": (0.0236, 0.0543), "p9": (0.6048, 0.6356)}.items():
        pins = headers[name]["children"]
        assert [pin["contact"] for pin in pins] == [str(n) for n in range(1, 47)]
        for pin in pins:
            contact = int(pin["contact"])
            assert pin["point"][1] == pytest.approx(odd_y if contact % 2 else even_y, abs=0.002)
        xs = [pin["point"][0] for pin in pins[::2]]
        assert xs == sorted(xs)
        assert xs[-1] - xs[0] == pytest.approx(22 * 56.1 / 2202, abs=0.002)
    contacts = {pin["id"]: pin for pin in headers["p8"]["children"] + headers["p9"]["children"]}
    assert contacts["p8_01"]["net"]["role"] == "ground"
    assert contacts["p9_03"]["net"]["rail"] == "VOUT_3V3"
    assert contacts["p8_22"]["silk"] == "UART2_RXD"
    assert contacts["p9_18"]["silk"] == "I2C6_SDA"


def test_alt_daisy_sample_preserves_input_select() -> None:
    index = load_soc_index(find_soc_tables(DOCS, ["soc/**/doc/pinmux/*.yaml"]))
    types = load_type_library(types_dir())
    resolved = resolve_board(
        load_yaml(_sample_path("mimxrt1062_alt_daisy")), types, soc_index=index
    )
    entry = next(e for e in _part(resolved, "GPIO_AD_B1_06")["mux"] if e["function"] == "LPUART3_TX")
    assert entry["mode"] == "ALT2"
    assert entry["input_select"] == {
        "register": "IOMUXC_LPUART3_TX_SELECT_INPUT",
        "value": 0,
    }


def test_remap_sample_keeps_multiple_peripheral_options() -> None:
    index = load_soc_index(find_soc_tables(DOCS, ["soc/**/doc/pinmux/*.yaml"]))
    types = load_type_library(types_dir())
    resolved = resolve_board(
        load_yaml(_sample_path("stm32f103xb_remap")), types, soc_index=index
    )
    pa9 = _part(resolved, "PA9")["mux"]
    pb6 = _part(resolved, "PB6")["mux"]
    assert pa9[0]["source"] == pb6[0]["source"] == "remap"
    assert pa9[0]["remap"]["value"] == 0
    assert pb6[0]["remap"]["value"] == 1


def test_signal_select_sample_keeps_selector_provenance() -> None:
    index = load_soc_index(find_soc_tables(DOCS, ["soc/**/doc/pinmux/*.yaml"]))
    types = load_type_library(types_dir())
    resolved = resolve_board(
        load_yaml(_sample_path("npcx9m6f_signal_select")), types, soc_index=index
    )
    gp10 = next(e for e in _part(resolved, "GP10")["mux"] if e["function"] == "UART1_SIN")
    gp64 = next(e for e in _part(resolved, "GP64")["mux"] if e["function"] == "UART1_SIN")
    assert gp10["source"] == gp64["source"] == "signal_select"
    assert (gp10["set"], gp64["set"]) == ("SL1", "SL2")


def test_psel_sample_keeps_shared_routing_and_fixed_functions() -> None:
    index = load_soc_index(find_soc_tables(DOCS, ["soc/**/doc/pinmux/*.yaml"]))
    types = load_type_library(types_dir())
    resolved = resolve_board(
        load_yaml(_sample_path("nrf52840_psel")), types, soc_index=index
    )
    assert resolved["soc_routing"]["nrf52840/0"]["kind"] == "any_pin"
    assert _part(resolved, "P0.13")["routing"] == ["nrf52840/0"]
    assert "AIN0" in _functions(_part(resolved, "P0.02"))
    assert "NFC1" in _functions(_part(resolved, "P0.09"))


def test_new_real_board_samples_keep_soc_mux_details() -> None:
    index = load_soc_index(find_soc_tables(DOCS, ["soc/**/doc/pinmux/*.yaml"]))
    types = load_type_library(types_dir())

    pocket = resolve_board(
        load_yaml(_sample_path("pocketbeagle2_am6254")), types, soc_index=index
    )
    csn3 = _part(pocket, "GPMC0_CSn3")
    assert csn3["pad_info"]["soc"] == "am6254"
    assert {entry["function"] for entry in csn3["mux"]} >= {
        "I2C2_SDA",
        "GPIO0_44",
    }
    assert next(e for e in csn3["mux"] if e["function"] == "I2C2_SDA")["mode"] == 1

    beagley = resolve_board(
        load_yaml(_sample_path("beagley_ai_j722s")), types, soc_index=index
    )
    tx = _part(beagley, "MCASP0_ACLKR")
    rx = _part(beagley, "MCASP0_AFSR")
    assert tx["pad_info"]["soc"] == "j722s"
    assert "UART1_TXD" in _functions(tx)
    assert "UART1_RXD" in _functions(rx)

    zed = resolve_board(
        load_yaml(_sample_path("zedboard_zynq7000")), types, soc_index=index
    )
    assert "UART1_TXD" in _functions(_part(zed, "MIO48"))
    assert "UART1_RXD" in _functions(_part(zed, "MIO49"))
    assert _part(zed, "MIO48")["pad_info"]["package"]["name"] == "xc7z020"
    assert _part(zed, "MIO48")["mux"][0]["group"] == "uart1_10_grp"


def test_documentation_build_copies_all_zephyr_underlays(tmp_path: Path) -> None:
    out = tmp_path / "html"
    doctrees = tmp_path / "doctrees"
    app = Sphinx(
        str(DOCS),
        str(DOCS),
        str(out),
        str(doctrees),
        buildername="html",
        freshenv=True,
        warningiserror=True,
        status=None,
        warning=None,
    )
    app.build(force_all=True)

    board_paths = _board_paths()
    directive_pages = _directive_pages()
    rendered_boards: set[str] = set()
    for source_page in directive_pages:
        page_rel = source_page.relative_to(DOCS).with_suffix(".html")
        output_page = out / page_rel
        assert output_page.is_file()
        page_text = output_page.read_text(encoding="utf-8")
        boards = _directive_boards(source_page)
        assert boards
        for board in boards:
            rendered_boards.add(board)
            assert f'data-board="{board}"' in page_text
            assert 'class="board-pinout"' in page_text

            document = load_yaml(board_paths[board])
            underlay = Path(document["faces"]["top"]["underlay"])
            source_asset = board_paths[board].parent / underlay
            output_asset = output_page.parent / underlay
            assert source_asset.is_file(), source_asset
            assert output_asset.is_file(), output_asset
            assert output_asset.read_bytes() == source_asset.read_bytes()

    # The landing page intentionally embeds only its featured boards; the
    # remaining samples are rendered on the hidden-toctree example pages.
    index_html = (out / "index.html").read_text(encoding="utf-8")
    assert rendered_boards >= set(_directive_boards(DOCS / "index.rst"))
    assert set(_directive_boards(DOCS / "index.rst")) <= set(board_paths)
    assert 'class="board-pinout"' in index_html

    assert rendered_boards == set(
        board for page in directive_pages for board in _directive_boards(page)
    )
