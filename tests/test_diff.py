"""``board-pinout diff``: effective mux and pin-field differences between two boards."""

import copy
from pathlib import Path

import pytest

from board_pinout import types_dir
from board_pinout.cli import main as cli_main
from board_pinout.diff import diff_boards, format_diff
from board_pinout.resolve import load_type_library, resolve_board
from board_pinout.soc_pads import load_soc_index
from board_pinout.validate import iter_parts, load_yaml

FIXTURES = Path(__file__).parent / "fixtures"
BOARD = FIXTURES / "boards_v11" / "esp32s3_devkitc.yaml"


@pytest.fixture(scope="module")
def index():
    return load_soc_index(sorted((FIXTURES / "soc_pads").glob("*.yaml")))


@pytest.fixture(scope="module")
def types():
    return load_type_library(types_dir())


def _resolve(doc, index, types):
    return resolve_board(doc, types, soc_index=index, expand_routing=True)


def _raw_part(doc, pid):
    for face in doc["faces"].values():
        for _path, part in iter_parts(face["children"]):
            if part.get("id") == pid:
                return part
    raise KeyError(pid)


def test_identical_boards_have_no_pin_entries(index, types):
    doc = load_yaml(BOARD)
    result = diff_boards(_resolve(doc, index, types), _resolve(copy.deepcopy(doc), index, types))
    assert result["pins"] == {}
    assert result["lost"] == 0
    assert result["gained"] == {}


def test_exclude_and_extend_show_as_lost_and_gained(index, types):
    old = load_yaml(BOARD)
    new = copy.deepcopy(old)
    _raw_part(new, "j1_5").pop("mux_exclude")
    _raw_part(new, "j3_17")["mux"].append({"function": "STATUS_LED", "class": "digital"})
    _raw_part(new, "j3_3")["mux_exclude"] = ["UART0.*"]
    result = diff_boards(_resolve(old, index, types), _resolve(new, index, types))
    assert result["pins"]["j1_5"]["gained"]["pad"] >= 1
    assert result["pins"]["j3_17"]["gained"] == {"board": 1}
    assert result["pins"]["j3_3"]["lost"]
    assert result["lost"] == len(result["pins"]["j3_3"]["lost"])


def test_field_changes_and_missing_parts(index, types):
    old = load_yaml(BOARD)
    new = copy.deepcopy(old)
    _raw_part(new, "j3_20")["net"]["nominal_v"] = 4.8
    top = new["faces"]["top"]["children"]
    top[:] = [p for p in top if p.get("id") != "rgb_led"]
    result = diff_boards(_resolve(old, index, types), _resolve(new, index, types))
    assert result["pins"]["j3_20"]["changed"]["net"]["new"]["nominal_v"] == 4.8
    assert result["pins"]["rgb_led"] == {"only_in": "old"}
    text = format_diff(result)
    assert "rgb_led: only in old" in text
    assert "j3_20: net" in text


def test_cli_diff(tmp_path, capsys):
    new = tmp_path / BOARD.name
    new.write_text(BOARD.read_text().replace('mux_exclude: ["TOUCH.*"]', "mux_exclude: []"))
    args = ["diff", str(BOARD), str(new), "--soc-tables", str(FIXTURES / "soc_pads")]
    assert cli_main(args) == 0
    out = capsys.readouterr().out
    assert " parts; 0 mux entries lost" in out.splitlines()[0]
    assert "j1_5: gained" in out
    assert cli_main([*args, "--json"]) == 0
