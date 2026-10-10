"""Phase 1: SoC table loader, board join (materialize mode) and 1.0 compatibility."""

import copy
import json
import os
import time
from pathlib import Path

import pytest

from board_pinout import types_dir
from board_pinout.cli import main as cli_main
from board_pinout.resolve import load_type_library, resolve_board
from board_pinout.soc_pads import (
    SocIndex,
    SocJoinReport,
    SocTableError,
    clear_soc_index_cache,
    load_soc_index,
)
from board_pinout.validate import iter_parts, load_yaml

ROOT = Path(__file__).parents[1]
FIXTURES = Path(__file__).parent / "fixtures"
TABLES = sorted((FIXTURES / "soc_pads").glob("*.yaml"))
BOARDS_V11 = sorted((FIXTURES / "boards_v11").glob("*.yaml"))
GOLDEN = FIXTURES / "golden"
# Boards whose joined output is pinned for the later Python/JS parity check.
GOLDEN_V11 = ("esp32s3_devkitc", "nucleo_f401re", "nrf9160dk")


@pytest.fixture(scope="module")
def index():
    return load_soc_index(TABLES)


@pytest.fixture(scope="module")
def types():
    return load_type_library(types_dir())


def _resolve(name, index, types, report=None, doc=None):
    doc = doc if doc is not None else load_yaml(FIXTURES / "boards_v11" / f"{name}.yaml")
    return resolve_board(doc, types, soc_index=index, report=report)


def _part(resolved, pid):
    for face in (resolved.get("faces") or {}).values():
        for _path, part in iter_parts(face["children"]):
            if part.get("id") == pid:
                return part
    raise KeyError(pid)


def _functions(part):
    return [e["function"] for e in part["mux"]]


def _dump(data):
    return json.dumps(data, indent=2) + "\n"


# --- inline mux boards ------------------------------------------------------------

def test_inline_golden(types):
    doc = load_yaml(ROOT / "schema" / "fixtures" / "nrf_shaped.yaml")
    out = _dump(resolve_board(doc, types))
    golden = GOLDEN / "v10_nrf_shaped.json"
    if os.environ.get("BOARD_PINOUT_UPDATE_GOLDEN"):
        golden.write_text(out, encoding="utf-8")
    assert out == golden.read_text(encoding="utf-8")


def test_v10_ignores_soc_index(index, types):
    doc = load_yaml(ROOT / "schema" / "fixtures" / "nrf_shaped.yaml")
    assert resolve_board(copy.deepcopy(doc), types, soc_index=index) == resolve_board(doc, types)


def test_v10_electrical_aliases_are_kept():
    doc = load_yaml(ROOT / "schema" / "fixtures" / "nrf_shaped.yaml")
    raw = _dump(doc)
    resolve_board(doc, load_type_library(types_dir()))
    assert _dump(doc) == raw


# --- every phase-0 fixture resolves -----------------------------------------------

@pytest.mark.parametrize("path", BOARDS_V11, ids=[p.stem for p in BOARDS_V11])
def test_v11_fixture_resolves_without_warnings(path, index, types):
    report = SocJoinReport()
    resolve_board(load_yaml(path), types, soc_index=index, report=report)
    assert report.warnings == []


@pytest.mark.parametrize("name", GOLDEN_V11)
def test_v11_golden(name, index, types):
    golden = GOLDEN / f"v11_{name}.json"
    out = _dump(_resolve(name, index, types))
    if os.environ.get("BOARD_PINOUT_UPDATE_GOLDEN"):
        golden.write_text(out, encoding="utf-8")
    assert out == golden.read_text(encoding="utf-8")


def test_join_records_table_paths(index, types):
    report = SocJoinReport()
    _resolve("nrf9160dk", index, types, report)
    assert {Path(p).name for p in report.paths} == {"nrf9160.yaml", "nrf52840.yaml"}


# --- mux delta --------------------------------------------------------------------

def test_mux_from_table(index, types):
    part = _part(_resolve("esp32s3_devkitc", index, types), "j3_3")
    assert part["mux"]
    assert {e["source"] for e in part["mux"]} <= {"pad", "routing"}
    assert part["pad_info"]["pad"] == "GPIO44"
    assert "functions" not in part["pad_info"]


def test_mux_exclude_peripheral_wildcard(index, types):
    resolved = _resolve("esp32s3_devkitc", index, types)
    assert not any(f.startswith("TOUCH") for f in _functions(_part(resolved, "j1_5")))


def test_mux_extend_appends_board_entries(index, types):
    mux = _part(_resolve("esp32s3_devkitc", index, types), "j3_17")["mux"]
    assert mux[-1] == {"function": "RGB_LED", "class": "digital", "direction": "out",
                       "source": "board"}
    assert any(e["source"] != "board" for e in mux)


def test_mux_replace_is_inline_only(index, types):
    doc = load_yaml(FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml")
    pin = _part({"faces": doc["faces"]}, "j3_3")
    pin["mux"] = [{"function": "ONLY"}]
    assert _part(_resolve(None, index, types, doc=doc), "j3_3")["mux"] == [{"function": "ONLY"}]


def test_mux_routable_false_drops_routing(index, types):
    resolved = _resolve("esp32s3_devkitc", index, types)
    boot = _part(resolved, "boot_btn")
    pin = _part(resolved, "j1_11")
    assert "routing" not in boot
    assert pin["routing"] == ["esp32s3/0"]


def test_routing_is_shared_not_copied(index, types):
    resolved = _resolve("esp32s3_devkitc", index, types)
    rule = resolved["soc_routing"]["esp32s3/0"]
    assert rule["kind"] == "any_pin"
    assert any(f["function"] == "U1TXD" for f in rule["functions"])
    assert all(e["source"] != "routing" for e in _part(resolved, "j1_11")["mux"])


def test_expand_routing_copies_rule_functions(index, types):
    doc = load_yaml(FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml")
    resolved = resolve_board(doc, types, soc_index=index, expand_routing=True)
    pin = _part(resolved, "j1_11")
    assert "soc_routing" not in resolved and "routing" not in pin
    assert any(e["source"] == "routing" for e in pin["mux"])


def test_exclude_hitting_routed_entries_is_recorded(index, types):
    doc = load_yaml(FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml")
    _part({"faces": doc["faces"]}, "j1_11")["mux_exclude"] = ["LEDC.*"]
    report = SocJoinReport()
    pin = _part(_resolve(None, index, types, report, doc=doc), "j1_11")
    assert pin["routing_exclude"] == ["LEDC.*"]
    assert report.warnings == []


def test_exclude_matching_nothing_warns(index, types):
    doc = load_yaml(FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml")
    _part({"faces": doc["faces"]}, "j1_5")["mux_exclude"] = ["NOPE.*"]
    report = SocJoinReport()
    _resolve(None, index, types, report, doc=doc)
    assert any("mux_exclude 'NOPE.*' matches nothing" in w for w in report.warnings)


# --- table semantics --------------------------------------------------------------

def test_package_limited_function(index):
    table = index.get("stm32f401xe")
    assert "SDIO_D4" in [e["function"] for e in table.mux("PB8", "LQFP64")]
    assert "SDIO_D4" not in [e["function"] for e in table.mux("PB8", "UFQFPN48")]


def test_package_functions_exclude(index):
    table = index.get("stm32f401xe")
    assert "TIM5_CH1" in [e["function"] for e in table.mux("PA0", "LQFP64")]
    assert "TIM5_CH1" not in [e["function"] for e in table.mux("PA0", "WLCSP49")]


def test_package_pad_info(index):
    table = index.get("stm32f401xe")
    assert table.pad_info("PA0", "LQFP64")["package"] == {"name": "LQFP64", "pin": "14"}
    assert table.pad_info("PA0", "WLCSP49")["package"] == {"name": "WLCSP49", "ball": "E5"}
    assert table.pad_info("PA0", None)["tolerance"]["class"] == "TC"
    assert table.pad_info("PA2", None)["tolerance"]["class"] == "FT"  # from pad_defaults


def test_remap_package_limited(index):
    table = index.get("stm32f103xb")
    lqfp48 = [e["remap"]["value"] for e in table.mux("PB10", "LQFP48") if e["function"] == "USART3_TX"]
    assert lqfp48 == [0]
    assert not table.in_package("PD8", "LQFP48")
    pd8 = table.mux("PD8", "LQFP100")
    assert {"function": "USART3_TX", "source": "remap"}.items() <= pd8[-1].items()


def test_based_on_applies_deltas(index):
    table = index.get("mimxrt1061")
    assert table.canonical("GPIO_SD_B0_00") is None
    assert all(not f.startswith("LCDIF") for p in table.pads for f in
               [e["function"] for e in table.mux(p, None)])
    assert [Path(p).name for p in table.paths] == ["mimxrt1061.yaml", "mimxrt1062.yaml"]


def test_alias_resolves_to_canonical(index):
    table = index.get("nrf52840")
    assert table.canonical("AIN0") == "P0.02"
    assert table.canonical("P0.02") == "P0.02"
    assert table.canonical("AIN9") is None


def test_analog_bus_parity(index):
    table = index.get("efr32mg24b210f1536im48")
    even = [e for e in table.mux("PA00", None) if e.get("bus") == "AEVEN0"]
    assert even and even[0]["source"] == "routing"
    assert not [e for e in table.mux("PA03", None) if e.get("bus") == "AEVEN0"]


def test_signal_select(index):
    table = index.get("npcx9m6f")
    gp10 = [e for e in table.mux("GP10", None) if e["source"] == "signal_select"]
    gp64 = [e for e in table.mux("GP64", None) if e["source"] == "signal_select"]
    assert (gp10[0]["function"], gp10[0]["set"]) == ("UART1_SIN", "SL1")
    assert (gp64[0]["function"], gp64[0]["set"]) == ("UART1_SIN", "SL2")


# --- hard errors ------------------------------------------------------------------

def test_unknown_soc_lists_known(index, types):
    doc = load_yaml(FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml")
    doc["soc"] = "esp32s4"
    with pytest.raises(SocTableError, match=r"unknown soc 'esp32s4' \(known: .*esp32s3"):
        _resolve(None, index, types, doc=doc)


def test_unknown_pad(index, types):
    doc = load_yaml(FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml")
    _part({"faces": doc["faces"]}, "j1_5")["pad"] = "GPIO99"
    with pytest.raises(SocTableError, match="unknown pad 'GPIO99'"):
        _resolve(None, index, types, doc=doc)


def test_unknown_package(index, types):
    doc = load_yaml(FIXTURES / "boards_v11" / "nucleo_f401re.yaml")
    doc["soc_package"] = "BGA999"
    with pytest.raises(SocTableError, match="BGA999"):
        _resolve(None, index, types, doc=doc)


def test_pad_not_in_package(index, types):
    doc = load_yaml(FIXTURES / "boards_v11" / "nucleo_f401re.yaml")
    doc["soc_package"] = "WLCSP49"
    with pytest.raises(SocTableError, match="not bonded out in package 'WLCSP49'"):
        _resolve(None, index, types, doc=doc)


def test_mux_source_soc_needs_index(types):
    doc = load_yaml(FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml")
    with pytest.raises(SocTableError, match="needs SoC pad tables"):
        resolve_board(doc, types)


def test_duplicate_soc_id(tmp_path):
    src = (FIXTURES / "soc_pads" / "esp32s3.yaml").read_text(encoding="utf-8")
    (tmp_path / "a.yaml").write_text(src, encoding="utf-8")
    (tmp_path / "b.yaml").write_text(src, encoding="utf-8")
    index = SocIndex(sorted(tmp_path.glob("*.yaml")))
    with pytest.raises(SocTableError, match=r"a\.yaml.*b\.yaml|b\.yaml.*a\.yaml"):
        index.get("esp32s3")


def test_circular_based_on(tmp_path):
    for soc, base in (("x1", "x2"), ("x2", "x1")):
        (tmp_path / f"{soc}.yaml").write_text(
            f'schema_version: "1.0"\nsoc: {soc}\nbased_on: {base}\n', encoding="utf-8"
        )
    with pytest.raises(SocTableError, match="circular based_on"):
        SocIndex(sorted(tmp_path.glob("*.yaml"))).get("x1")


# --- electrical -------------------------------------------------------------------

def test_drive_strength_not_an_option_warns(index, types):
    doc = load_yaml(FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml")
    pin = _part({"faces": doc["faces"]}, "j3_3")
    pin["electrical"] = {"drive_strength": {"value": 7, "unit": "mA"}}
    report = SocJoinReport()
    _resolve(None, index, types, report, doc=doc)
    assert any("drive_strength 7mA is not a drive option of GPIO44" in w for w in report.warnings)


def test_removed_electrical_aliases_are_rejected():
    from board_pinout.validate import validate_document

    doc = load_yaml(FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml")
    _part({"faces": doc["faces"]}, "j3_3")["electrical"] = {"default_bias": "pd"}
    assert not validate_document(doc).ok


# --- loader cache -----------------------------------------------------------------

def test_index_cache_invalidates_on_edit(tmp_path):
    clear_soc_index_cache()
    path = tmp_path / "t.yaml"
    path.write_text('schema_version: "1.0"\nsoc: t1\npads: {A: {}}\n', encoding="utf-8")
    first = load_soc_index([path])
    assert load_soc_index([path]) is first
    time.sleep(0.01)
    path.write_text('schema_version: "1.0"\nsoc: t2\npads: {A: {}}\n', encoding="utf-8")
    os.utime(path, ns=(time.time_ns(), time.time_ns() + 1_000_000))
    second = load_soc_index([path])
    assert second is not first
    assert "t2" in second and "t1" not in second


# --- CLI --------------------------------------------------------------------------

def test_cli_soc_pads_validate(capsys):
    assert cli_main(["soc-pads", "validate", str(FIXTURES / "soc_pads")]) == 0


def test_cli_soc_pads_validate_rejects_bad_table(tmp_path):
    bad = tmp_path / "bad.yaml"
    bad.write_text('schema_version: "1.0"\npads: {}\n', encoding="utf-8")
    assert cli_main(["soc-pads", "validate", str(bad)]) != 0


def test_cli_resolve_with_tables(tmp_path, capsys):
    board = FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml"
    assert cli_main(["resolve", str(types_dir()), str(board),
                     "--soc-tables", str(FIXTURES / "soc_pads")]) == 0
    assert '"pad_info"' in capsys.readouterr().out
    assert cli_main(["resolve", str(types_dir()), str(board)]) == 1
