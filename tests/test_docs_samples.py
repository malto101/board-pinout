"""Regression coverage for the documentation pinmux archetype samples."""

from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("sphinx")
from sphinx.application import Sphinx

from board_pinout import types_dir
from board_pinout.resolve import load_type_library, resolve_board
from board_pinout.soc_pads import find_soc_tables, load_soc_index, validate_soc_file
from board_pinout.validate import iter_parts, load_yaml, validate_file

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SAMPLE_NAMES = (
    "beaglebone_ai64_fixed_mux",
    "mimxrt1062_alt_daisy",
    "stm32f103xb_remap",
    "npcx9m6f_signal_select",
    "nrf52840_psel",
    "pocketbeagle2_am6254",
    "beagley_ai_j722s",
    "zedboard_zynq7000",
)


def _sample_path(name: str) -> Path:
    return DOCS / "example" / name / "pinout.yaml"


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
    assert {path.stem for path in table_paths} >= {
        "j721e",
        "mimxrt1062",
        "npcx9m6f",
        "nrf52840",
        "stm32f103xb",
        "am6254",
        "j722s",
        "xc7z020",
    }
    for path in table_paths:
        result = validate_soc_file(path)
        assert result.ok, f"{path}: {result.errors}"

    index = load_soc_index(table_paths)
    types = load_type_library(types_dir())
    for name in SAMPLE_NAMES:
        board_path = _sample_path(name)
        result = validate_file(board_path)
        assert result.ok, f"{board_path}: {result.errors}"
        resolved = resolve_board(load_yaml(board_path), types, soc_index=index)
        assert resolved["resolved"] is True
        assert all("pad_info" in part for part in _parts(resolved) if part.get("pad"))


def test_fixed_mode_sample_preserves_j721e_modes() -> None:
    index = load_soc_index(find_soc_tables(DOCS, ["soc/**/doc/pinmux/*.yaml"]))
    types = load_type_library(types_dir())
    resolved = resolve_board(
        load_yaml(_sample_path("beaglebone_ai64_fixed_mux")), types, soc_index=index
    )
    assert {entry["mode"] for entry in _part(resolved, "P8_34")["mux"]} >= {7, 14}
    assert {entry["mode"] for entry in _part(resolved, "P9_18")["mux"]} >= {2, 7}


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

    index_html = (out / "index.html").read_text(encoding="utf-8")
    for name in SAMPLE_NAMES:
        assert f'data-board="{name}"' in index_html
        sample_html = out / "example" / name / "index.html"
        assert sample_html.is_file()
        assert 'class="board-pinout"' in sample_html.read_text(encoding="utf-8")

    expected_assets = {
        "example/beaglebone_ai64_fixed_mux/beaglebone_ai_64.webp",
        "example/mimxrt1062_alt_daisy/mimxrt1062_fmurt6.webp",
        "example/npcx9m6f_signal_select/npcx9m6f_evb.webp",
        "example/nrf52840_psel/others_promicro_nrf52840.webp",
        "example/stm32f103xb_remap/stm32f103_mini_blue.webp",
        "example/pocketbeagle2_am6254/pocketbeagle_2.webp",
        "example/beagley_ai_j722s/assets/beagley_ai_top.webp",
        "example/zedboard_zynq7000/zedboard.webp",
    }
    assert all((out / asset).is_file() for asset in expected_assets)
