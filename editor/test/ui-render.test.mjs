import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  PART_SYMBOL_ORDER,
  PART_SYMBOLS,
  markerSymbolMarkup,
  visualForPart,
} from "../../src/board_pinout/static/board_pinout/js/visual.js";
import {
  estimateLabelWidth,
  labelMetrics,
} from "../../src/board_pinout/static/board_pinout/js/labels.js";


test("shared visual contract classifies semantic parts and renders symbols", () => {
  assert.deepEqual(PART_SYMBOL_ORDER, ["group", "gnd", "power", "led", "button", "switch", "sensor", "port", "io", "nc"]);
  assert.equal(visualForPart({ kind: "group" }).key, "group");
  assert.equal(visualForPart({ net: { role: "ground" } }).key, "gnd");
  assert.equal(visualForPart({ net: { role: "power_out" } }).key, "power");
  assert.equal(visualForPart({ control_type: "led" }).key, "led");
  assert.equal(visualForPart({ ref: "tactile_button" }).key, "button");
  assert.equal(visualForPart({ ref: "power_switch" }).key, "switch");
  assert.equal(visualForPart({ notes: "temperature sensor" }).key, "sensor");
  assert.equal(visualForPart({ kind: "receptacle" }).key, "port");
  assert.equal(visualForPart({ silk: "NC" }).key, "nc");
  assert.equal(visualForPart({}).key, "io");
  for (const key of PART_SYMBOL_ORDER) {
    const markup = markerSymbolMarkup(10, 20, { key, ...PART_SYMBOLS[key] });
    assert.match(markup, new RegExp(`data-sym="${key}"`));
    assert.match(markup, /class="marker-point"/);
  }
  assert.match(markerSymbolMarkup(10, 20, { key: "gnd", ...PART_SYMBOLS.gnd }), /marker-gnd-backdrop/);
  assert.match(markerSymbolMarkup(10, 20, { key: "gnd", ...PART_SYMBOLS.gnd }), /fill="#fff"/);
  assert.match(markerSymbolMarkup(10, 20, { key: "gnd", ...PART_SYMBOLS.gnd }), /stroke="#0c0e13"/);
  assert.match(
    markerSymbolMarkup(10, 20, { key: "gnd", ...PART_SYMBOLS.gnd }, { active: true, primary: true }),
    /stroke="#4c8dff"/
  );
  assert.doesNotMatch(
    markerSymbolMarkup(10, 20, { key: "gnd", ...PART_SYMBOLS.gnd }, { active: true }),
    /marker-halo-/
  );
  const activeIo = markerSymbolMarkup(10, 20, { key: "io", ...PART_SYMBOLS.io }, { active: true });
  assert.match(activeIo, /stroke="#4c8dff"/);
  assert.doesNotMatch(activeIo, /marker-halo-/);
});

test("shared visual metrics scale markers and labels", () => {
  const marker = markerSymbolMarkup(10, 20, { key: "io", ...PART_SYMBOLS.io }, { part: { node_scale: 1.5 } });
  assert.match(marker, /scale\(1\.5\)/);
  const metrics = labelMetrics({ label_scale: 1.25 });
  assert.equal(metrics.fontSize, 12.5);
  assert.equal(estimateLabelWidth({ id: "IO0", label_scale: 1.25 }, metrics), 35.75);
});



const dom = new JSDOM(`<!doctype html><body><div id="metaForm"></div></body>`, { url: "https://editor.test/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const [{ state }, ui] = await Promise.all([
  import("../src/state.js"),
  import("../src/ui.js"),
]);

function setup() {
  state.documentMode = "board";
  state.board = {
    schema_version: "1.1",
    board: "demo",
    soc: "demo-soc",
    soc_package: "qfn",
    mux_source: "soc",
    faces: { top: { children: [] } },
  };
  state.socTable = {
    soc: "demo-soc",
    packages: { qfn: { pads: { IO0: {} } } },
    pads: {
      IO0: {
        aliases: ["GPIO0"],
        type: "io",
        pull: { pu_ohm: 45000 },
        functions: [{ function: "UART0_TX", peripheral: "uart0", signal: "TX", source: "soc" }],
      },
    },
  };
}

test("selected part rendering offers canonical SoC pad and formatted details", () => {
  setup();
  const part = {
    id: "pin0",
    node_scale: 1.4,
    label_scale: 1.25,
    pad: "GPIO0",
    electrical: { pull: { mode: "up", ohm: 45000 } },
    net: { role: "signal" },
  };
  const picker = ui.socPadPickerHtml(part);
  assert.match(picker, /value="IO0"/);
  assert.match(picker, /GPIO0/);
  assert.match(picker, /Linked demo-soc/);

  const details = ui.effectiveDetailsHtml(part);
  assert.match(details, /Board override · pull/);
  assert.match(details, /&quot;ohm&quot;: 45000/);
  assert.match(details, /SoC table · type/);

  const mux = ui.muxEditorHtml(part);
  assert.match(mux, /Inherited from the active SoC table/);
  assert.match(mux, /UART0_TX/);
  assert.match(mux, /mux-cell-label/);
});

test("selected part rendering diagnoses a stale linked table", () => {
  setup();
  state.socTable.soc = "other-soc";
  const html = ui.socPadPickerHtml({ id: "pin0", pad: "IO0" });
  assert.match(html, /Loaded SoC other-soc; expected demo-soc/);
  assert.match(html, /not found in linked table/);
});

test("set-as roles are grouped behind one disclosure", () => {
  const html = ui.rolePickerHtml("io");
  const fragment = JSDOM.fragment(html);
  assert.equal(fragment.querySelectorAll(":scope > button").length, 0);
  assert.equal(fragment.querySelectorAll(".role-picker-toggle").length, 1);
  assert.equal(fragment.querySelectorAll(".role-btn").length, 9);
  assert.match(html, /Choose the specific part kind/);
});

dom.window.close();
