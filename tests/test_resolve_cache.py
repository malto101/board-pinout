import copy
import json
import os
from pathlib import Path

import pytest

from board_pinout import resolve
from board_pinout.resolve import (
    clear_type_library_cache,
    load_type_library,
    resolve_board,
    resolve_file,
)
from board_pinout.validate import load_yaml

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "schema" / "fixtures" / "nrf_shaped.yaml"
TYPES = ROOT / "types"


def _doc(children, types_inline=None):
    doc = {
        "schema_version": "1.0",
        "board": "demo",
        "faces": {"top": {"children": children}},
    }
    if types_inline is not None:
        doc["types_inline"] = types_inline
    return doc


def test_type_library_cache_hit_returns_detached_copy():
    clear_type_library_cache()
    first = load_type_library(TYPES)
    first["pin"]["kind"] = "mutated"
    second = load_type_library(TYPES)
    assert second["pin"]["kind"] != "mutated"
    assert resolve._load_type_library_cached.cache_info().hits >= 1


def test_type_library_cache_invalidates_on_change(tmp_path):
    clear_type_library_cache()
    lib = tmp_path / "types"
    lib.mkdir()
    path = lib / "a.yaml"
    path.write_text("types:\n  thing:\n    kind: pin\n")
    assert load_type_library(lib)["thing"]["kind"] == "pin"
    path.write_text("types:\n  thing:\n    kind: group\n  other:\n    kind: pin\n")
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    assert load_type_library(lib)["thing"]["kind"] == "group"


def test_duplicate_type_across_files_raises(tmp_path):
    clear_type_library_cache()
    (tmp_path / "a.yaml").write_text("types:\n  x:\n    kind: pin\n")
    (tmp_path / "b.yaml").write_text("types:\n  x:\n    kind: pin\n")
    with pytest.raises(ValueError, match="Duplicate part type 'x'"):
        load_type_library(tmp_path)


def test_inline_type_overrides_library_and_inherits():
    types = {"base": {"kind": "pin_array", "rows": 1, "cols": 4}}
    doc = _doc(
        [{"id": "h", "ref": "base", "point": [0.5, 0.5]},
         {"id": "k", "ref": "child", "point": [0.1, 0.1]}],
        types_inline={
            "base": {"kind": "pin_array", "rows": 1, "cols": 2},
            "child": {"based_on": "base", "cols": 3},
        },
    )
    out = resolve_board(doc, types, validate=False)
    h, k = out["faces"]["top"]["children"]
    assert len(h["children"]) == 2
    assert k["kind"] == "pin_array" and len(k["children"]) == 3
    assert out["types_used"] == ["base", "child"]


def test_instance_fields_win_over_type_defaults():
    types = {"hdr": {"kind": "pin_array", "rows": 1, "cols": 4,
                     "default_electrical": {"io_voltage": 3.3}}}
    doc = _doc([{"id": "h", "ref": "hdr", "cols": 2, "point": [0, 0],
                 "electrical": {"io_voltage": 1.8}}])
    h = resolve_board(doc, types, validate=False)["faces"]["top"]["children"][0]
    assert h["cols"] == 2 and len(h["children"]) == 2
    assert h["electrical"] == {"io_voltage": 1.8}


def test_circular_based_on_raises():
    types = {"a": {"based_on": "b"}, "b": {"based_on": "a"}}
    doc = _doc([{"id": "x", "ref": "a", "point": [0, 0]}])
    with pytest.raises(ValueError, match="Circular part type ref"):
        resolve_board(doc, types, validate=False)


def test_circular_default_children_raises():
    types = {"loop": {"kind": "group", "default_children": [{"id": "c", "ref": "loop"}]}}
    doc = _doc([{"id": "x", "ref": "loop", "point": [0, 0]}])
    with pytest.raises(ValueError, match="Circular part type ref"):
        resolve_board(doc, types, validate=False)


def test_unknown_ref_raises():
    doc = _doc([{"id": "x", "ref": "nope", "point": [0, 0]}])
    with pytest.raises(ValueError, match="Unknown part type ref 'nope'"):
        resolve_board(doc, {}, validate=False)


def test_resolution_does_not_mutate_or_alias_inputs():
    doc = load_yaml(FIXTURE)
    types = load_type_library(TYPES)
    doc_before, types_before = copy.deepcopy(doc), copy.deepcopy(types)
    first = resolve_board(doc, types)
    second = resolve_board(doc, types)
    assert doc == doc_before and types == types_before
    # Mutating one result must not leak into another (shared type templates).
    first["faces"]["top"]["children"][0]["children"][0]["children"].clear()
    assert second["faces"]["top"]["children"][0]["children"][0]["children"]
    assert resolve_board(doc, types) == second


def test_resolve_file_matches_resolve_board():
    assert resolve_file(FIXTURE, TYPES) == resolve_board(
        load_yaml(FIXTURE), load_type_library(TYPES)
    )


def test_types_used_lists_refs_and_ancestors_only():
    out = resolve_file(FIXTURE, TYPES)
    used = set(out["types_used"])
    assert {"nordic_header_10x2", "header_pin_array", "tactile_button"} <= used
    assert "hdmi" not in used  # library type not referenced by the board


def test_validate_flag_skips_validation():
    doc = _doc([{"id": "x", "kind": "pin"}])  # level-0 part without a point
    with pytest.raises(ValueError):
        resolve_board(doc, {})
    assert resolve_board(doc, {}, validate=False)["faces"]["top"]["children"][0]["id"] == "x"


def test_resolved_output_is_json_serializable_and_deterministic():
    a = json.dumps(resolve_file(FIXTURE, TYPES), sort_keys=True)
    clear_type_library_cache()
    b = json.dumps(resolve_file(FIXTURE, TYPES), sort_keys=True)
    assert a == b


def test_fast_and_reference_validators_agree():
    pytest.importorskip("fastjsonschema")
    import random

    from board_pinout.fixtures import generate_board
    from board_pinout.validate import _board_validator, _schema_is_valid_fast

    rng = random.Random(7)
    base = generate_board(60, 3)
    mutations = [
        lambda p: p.update(id="9bad"),
        lambda p: p.update(bogus=1),
        lambda p: p.update(point=[1]),
        lambda p: p.setdefault("mux", []).append({"mode": 1}),
        lambda p: p.update(gating={"kind": "maybe"}),
        lambda p: p.update(assignments=[{"status": "nope"}]),
        lambda p: None,
    ]
    for _ in range(150):
        doc = copy.deepcopy(base)
        parts, stack = [], list(doc["faces"]["top"]["children"])
        while stack:
            part = stack.pop()
            parts.append(part)
            stack.extend(part.get("children") or [])
        rng.choice(mutations)(rng.choice(parts))
        assert _schema_is_valid_fast(doc) == _board_validator().is_valid(doc)


def test_validation_does_not_inject_schema_defaults():
    from board_pinout.validate import validate_document

    doc = load_yaml(FIXTURE)
    before = copy.deepcopy(doc)
    assert validate_document(doc).ok
    assert doc == before


def test_structural_validation_skips_schema_but_keeps_structure():
    bad_schema = _doc([{"id": "x", "kind": "pin", "point": [0.5, 0.5], "bogus": 1}])
    with pytest.raises(ValueError, match="schema"):
        resolve_board(bad_schema, {})
    assert resolve_board(bad_schema, {}, validate="structural")["faces"]["top"]["children"]
    no_point = _doc([{"id": "x", "kind": "pin"}])
    with pytest.raises(ValueError, match="level-0 part must have a point"):
        resolve_board(no_point, {}, validate="structural")


def test_load_yaml_matches_pure_python_safe_load(tmp_path):
    import yaml

    from board_pinout.fixtures import generate_board

    path = tmp_path / "b.yaml"
    path.write_text(yaml.safe_dump(generate_board(50, 3, board="b", seed=3), sort_keys=False))
    assert load_yaml(path) == yaml.safe_load(path.read_text())
    assert load_yaml(FIXTURE) == yaml.safe_load(FIXTURE.read_text())
