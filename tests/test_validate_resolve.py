import json
from pathlib import Path

import pytest

from board_pinout.join import ensure_status_defaults
from board_pinout.resolve import resolve_file
from board_pinout.validate import validate_document, validate_file

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "schema" / "fixtures" / "nrf_shaped.yaml"
TYPES = ROOT / "types"


def test_fixture_validates():
    result = validate_file(FIXTURE)
    assert result.ok, result.errors


def test_resolve_synthesizes_pins():
    resolved = resolve_file(FIXTURE, TYPES)
    p0 = resolved["faces"]["top"]["children"][0]
    assert p0["id"] == "port_p0"
    assert p0["kind"] == "group"
    header = p0["children"][0]
    assert header["id"] == "port_p0_header"
    assert len(header["children"]) == 20


def test_visual_scale_schema_accepts_bounded_values():
    doc = {
        "board": "b",
        "faces": {"top": {"children": [{
            "id": "p1", "kind": "pin", "point": [0.1, 0.1],
            "node_scale": 0.5, "label_scale": 2,
        }]}},
    }
    result = validate_document(doc)
    assert result.ok, result.errors


@pytest.mark.parametrize(("field", "value"), [
    ("node_scale", 0.49),
    ("node_scale", 3.01),
    ("label_scale", 0.74),
    ("label_scale", 2.01),
    ("node_scale", "large"),
])
def test_visual_scale_schema_rejects_invalid_values(field, value):
    doc = {
        "board": "b",
        "faces": {"top": {"children": [{
            "id": "p1", "kind": "pin", "point": [0.1, 0.1], field: value,
        }]}},
    }
    assert not validate_document(doc).ok


def test_visual_scale_defaults_inherit_and_instance_wins():
    from board_pinout.resolve import resolve_board

    types = {
        "scaled": {
            "kind": "pin",
            "node_scale": 1.8,
            "label_scale": 1.25,
        }
    }
    doc = {
        "board": "b",
        "faces": {"top": {"children": [
            {"id": "inherited", "ref": "scaled", "point": [0.1, 0.1]},
            {"id": "override", "ref": "scaled", "point": [0.2, 0.1], "node_scale": 0.8},
        ]}},
    }
    parts = resolve_board(doc, types)["faces"]["top"]["children"]
    assert parts[0]["node_scale"] == 1.8
    assert parts[0]["label_scale"] == 1.25
    assert parts[1]["node_scale"] == 0.8
    assert parts[1]["label_scale"] == 1.25


def test_visual_scale_omission_does_not_inject_defaults():
    from board_pinout.resolve import resolve_board

    doc = {"board": "b", "faces": {"top": {"children": [
        {"id": "plain", "kind": "pin", "point": [0.1, 0.1]},
    ]}}}
    part = resolve_board(doc, {})["faces"]["top"]["children"][0]
    assert "node_scale" not in part
    assert "label_scale" not in part


def test_type_default_net_fills_fixed_pins_only():
    from board_pinout.resolve import load_type_library, resolve_board

    doc = {"schema_version": "1.1", "board": "b", "faces": {"top": {"children": [
        {"id": "g1", "ref": "gnd", "point": [0.1, 0.1]},
        {"id": "v1", "ref": "power", "point": [0.2, 0.1], "net": {"role": "power_in", "rail": "VIN"}},
    ]}}}
    parts = resolve_board(doc, load_type_library(TYPES))["faces"]["top"]["children"]
    assert parts[0]["net"] == {"role": "ground"}
    assert parts[1]["net"] == {"role": "power_in", "rail": "VIN"}


def test_status_defaults_are_vendor_neutral():
    resolved = resolve_file(FIXTURE, TYPES)
    joined = ensure_status_defaults(resolved)
    assert joined["binding_join"]["mode"] == "defaults_only"
    assert "assignments" not in json.dumps(joined)


def test_status_defaults_fill_assignments():
    doc = {"faces": {"top": {"children": [
        {"id": "p1", "kind": "pin", "assignments": [{"owner": "uart0"}, {"status": "enabled"}]},
    ]}}}
    pin = ensure_status_defaults(doc)["faces"]["top"]["children"][0]
    assert [a["status"] for a in pin["assignments"]] == ["unknown", "enabled"]


def _assigned_doc(software, assignments):
    return {
        "board": "b",
        "software": software,
        "faces": {"top": {"children": [
            {"id": "p1", "kind": "pin", "point": [0.5, 0.5], "assignments": assignments},
        ]}},
    }


def test_assignment_by_must_name_declared_software():
    sw = {"os_a": {"name": "A"}, "os_b": {"name": "B"}}
    ok = validate_document(_assigned_doc(sw, [{"by": "os_a", "function": "U0TXD"}]))
    assert ok.ok, ok.errors
    bad = validate_document(_assigned_doc(sw, [{"by": "os_c"}]))
    assert any("unknown software 'os_c'" in e for e in bad.errors)
    implicit = validate_document(_assigned_doc(sw, [{"function": "U0TXD"}]))
    assert any("needs 'by'" in e for e in implicit.errors)


def test_assignment_by_is_optional_with_one_software():
    result = validate_document(_assigned_doc({"rtos": {"name": "R"}}, [{"owner": "i2c0"}]))
    assert result.ok, result.errors


def test_pin_enabled_by_two_software_warns():
    sw = {"os_a": {"name": "A"}, "os_b": {"name": "B"}}
    result = validate_document(_assigned_doc(sw, [
        {"by": "os_a", "status": "enabled"},
        {"by": "os_b", "status": "enabled"},
    ]))
    assert result.ok
    assert any("more than one software (os_a, os_b)" in w for w in result.warnings)


def test_assignment_status_is_an_enum():
    result = validate_document(_assigned_doc({"r": {"name": "R"}}, [{"status": "supported"}]))
    assert not result.ok
