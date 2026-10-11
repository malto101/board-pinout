"""Phase-0 spec fixtures: SoC pad tables and board/shield/module schema 1.1."""

import copy
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from board_pinout import schema_path
from board_pinout.soc_pads import validate_soc_file, validate_soc_table
from board_pinout.validate import (
    _board_validator,
    _fast_validator,
    load_json,
    load_yaml,
    validate_document,
    validate_file,
)

FIXTURES = Path(__file__).parent / "fixtures"
SOC_TABLES = sorted((FIXTURES / "soc_pads").glob("*.yaml"))
BOARDS_V11 = sorted((FIXTURES / "boards_v11").glob("*.yaml"))
BOARDS_V10 = sorted((Path(__file__).parents[1] / "schema" / "fixtures").glob("*.yaml"))


def _ids(paths):
    return [p.stem for p in paths]


def test_schemas_are_valid_draft_2020_12():
    Draft202012Validator.check_schema(load_json(schema_path("soc_pads.schema.json")))
    Draft202012Validator.check_schema(load_json(schema_path("board.schema.json")))


@pytest.mark.parametrize("path", SOC_TABLES, ids=_ids(SOC_TABLES))
def test_soc_table_fixture_validates(path):
    result = validate_soc_file(path)
    assert result.ok, result.errors


@pytest.mark.parametrize("path", BOARDS_V11 + BOARDS_V10, ids=_ids(BOARDS_V11 + BOARDS_V10))
def test_board_fixture_validates(path):
    result = validate_file(path)
    assert result.ok, result.errors


@pytest.mark.parametrize("path", BOARDS_V11 + BOARDS_V10, ids=_ids(BOARDS_V11 + BOARDS_V10))
def test_fast_and_reference_validators_agree(path):
    fast = _fast_validator()
    if fast is None:
        pytest.skip("fastjsonschema unavailable or schema uses 2020-only keywords")
    doc = load_yaml(path)
    fast(doc)
    _board_validator().validate(doc)


def test_board_soc_ids_have_tables():
    tables = {load_yaml(p)["soc"] for p in SOC_TABLES}
    for path in BOARDS_V11:
        soc = load_yaml(path).get("soc")
        ids = [soc] if isinstance(soc, str) else [s["id"] for s in soc or []]
        for sid in ids:
            assert sid in tables, f"{path.name}: no fixture table for {sid}"


# --- SoC table negatives ----------------------------------------------------------

def _table(name):
    return load_yaml(FIXTURES / "soc_pads" / f"{name}.yaml")


def _soc_errors(table):
    result = validate_soc_table(table)
    assert not result.ok
    return "\n".join(result.errors)


def test_soc_requires_soc_id():
    table = _table("esp32s3")
    del table["soc"]
    assert "'soc' is a required property" in _soc_errors(table)


def test_soc_rejects_unknown_pad_key():
    table = _table("esp32s3")
    table["pads"]["GPIO0"]["bogus"] = 1
    assert "bogus" in _soc_errors(table)


def test_soc_unknown_pad_in_remap():
    table = _table("stm32f103xb")
    table["remaps"]["USART1"][0]["pads"]["TX"] = "PZ99"
    assert "unknown pad 'PZ99'" in _soc_errors(table)


def test_soc_unknown_pad_in_routing():
    table = _table("esp32s3")
    table["routing"][0]["pads"]["exclude"] = ["GPIO999"]
    assert "unknown pad 'GPIO999'" in _soc_errors(table)


def test_soc_alias_collision():
    table = _table("nrf52840")
    first, second = list(table["pads"])[:2]
    table["pads"][second]["aliases"] = [first]
    assert "is also a pad name" in _soc_errors(table)


def test_soc_duplicate_remap_value():
    table = _table("stm32f103xb")
    opts = table["remaps"]["USART1"]
    opts.append(copy.deepcopy(opts[0]))
    assert "duplicate remap value" in _soc_errors(table)


def test_soc_unknown_package_in_function():
    table = _table("stm32f401xe")
    pad = next(p for p in table["pads"].values() if p.get("functions"))
    pad["functions"][0]["packages"] = ["BGA999"]
    assert "unknown package 'BGA999'" in _soc_errors(table)


def test_soc_based_on_skips_pad_lookup():
    table = _table("mimxrt1061")
    assert table["based_on"]
    assert validate_soc_table(table).ok


# --- Board 1.1 negatives ----------------------------------------------------------

def _board(name):
    return load_yaml(FIXTURES / "boards_v11" / f"{name}.yaml")


def _errors(doc):
    result = validate_document(doc)
    assert not result.ok
    return "\n".join(result.errors)


def _pins(doc, connector):
    part = next(p for p in doc["faces"]["top"]["children"] if p["id"] == connector)
    return part["children"]


def test_board_multiple_sources():
    doc = _board("nucleo_f401re")
    _pins(doc, "cn10")[0]["net"] = {"role": "ground"}
    assert "more than one source" in _errors(doc)


def test_board_nexus_collision():
    doc = _board("nucleo_f401re")
    _pins(doc, "cn5")[1]["nexus_index"] = 20
    assert "nexus_index 20 used by" in _errors(doc)


def test_board_nexus_outside_connector():
    doc = _board("nucleo_f401re")
    doc["faces"]["top"]["children"][-1]["nexus_index"] = 3
    assert "nexus_index outside a connector" in _errors(doc)


def test_board_mux_source_soc_requires_soc():
    doc = _board("esp32s3_devkitc")
    del doc["soc"]
    assert "'soc' is a required property" in _errors(doc)


def test_board_requires_board_name():
    doc = _board("rpi_pico")
    del doc["board"]
    assert "'board' is a required property" in _errors(doc)


def test_multi_soc_pad_needs_soc():
    doc = _board("nrf9160dk")
    del _pins(doc, "p6")[0]["soc"]
    assert "pad needs 'soc' on a multi-SoC board" in _errors(doc)


def test_pad_soc_must_be_listed():
    doc = _board("nrf9160dk")
    _pins(doc, "p6")[0]["soc"] = "nrf5340"
    assert "soc 'nrf5340' is not listed" in _errors(doc)


def test_unknown_expander():
    doc = _board("nrf9160dk")
    doc["revisions"]["0.14.0"]["add"][0]["part"]["expander"]["id"] = "u9"
    doc["faces"]["top"]["children"].append(doc["revisions"]["0.14.0"]["add"][0]["part"])
    assert "unknown expander 'u9'" in _errors(doc)


def test_unknown_module_instance():
    doc = _board("nina_carrier")
    _pins(doc, "j1")[0]["module_pin"]["module"] = "u7"
    assert "unknown module instance 'u7'" in _errors(doc)


def test_module_pin_sources_checked():
    doc = _board("ublox_nina_b3")
    doc["pins"]["J2"]["net"] = {"role": "ground"}
    assert "pins.J2: more than one source" in _errors(doc)


def test_bad_revision_patch_target():
    doc = _board("nrf9160dk")
    doc["revisions"]["0.7.0"]["remove"] = ["no_such_part"]
    assert "revisions.0.7.0.remove: unknown part 'no_such_part'" in _errors(doc)


def test_bad_patch_face_parent():
    doc = _board("nrf9160dk")
    doc["revisions"]["0.14.0"]["add"][0]["parent"] = "face:bottom"
    assert "unknown face:bottom" in _errors(doc)


def test_shield_requires_plugs_into():
    doc = _board("x_nucleo_iks01a3")
    del doc["plugs_into"]
    assert "'plugs_into' is a required property" in _errors(doc)


def test_module_requires_pins():
    doc = _board("ublox_nina_b3")
    del doc["pins"]
    assert "'pins' is a required property" in _errors(doc)


def test_invalid_net_role():
    doc = _board("rpi_pico")
    _pins(doc, "right")[-1]["net"]["role"] = "vcc"
    assert "schema:" in _errors(doc)
