import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const BUNDLE = resolve(ROOT, "src/board_pinout/static/board_pinout/board-pinout.js");

function payload() {
  return {
    board: "runtime-smoke",
    face: "top",
    underlay: "",
    doc: {
      resolved: true,
      faces: {
        top: {
          children: [
            {
              id: "smoke-pin",
              silk: "IO0",
              pad: "IO0",
              point: [0.4, 0.6],
              kind: "pin",
              electrical: { io_v: 3.3, pull: "up" },
              pad_info: { domain: "VDD3P3", tolerance: "3.6 V" },
              mux: [
                {
                  function: "UART0_TX",
                  peripheral: "uart0",
                  signal: "TX",
                  class: "digital",
                  direction: "output",
                  source: "pad",
                },
              ],
            },
          ],
        },
      },
      software: {},
      soc_routing: {},
    },
  };
}

function scaffold(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html><html><body>
    <div class="board-pinout" data-underlay-rel="">
      <div class="zbp-toolbar"><input class="zbp-search" type="search" /></div>
      <div class="zbp-layout">
        <div class="zbp-stage"><img class="zbp-underlay" alt="board" /><svg class="zbp-overlay"></svg></div>
        <div class="zbp-side"><div class="zbp-breadcrumb"></div><div class="zbp-detail"></div></div>
      </div>
      <script type="application/json" class="zbp-data">${json}</script>
    </div>
  </body></html>`;
}

test("checked-in widget bundle mounts and renders mux details", async () => {
  const bundle = await readFile(BUNDLE, "utf8");
  const dom = new JSDOM(scaffold(payload()), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://example.test/docs/",
  });
  dom.window.eval(bundle);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded", { bubbles: true }));

  const root = dom.window.document.querySelector(".board-pinout");
  assert.ok(root.querySelector(".zbp-viewport"));
  assert.ok(root.querySelector(".zbp-view-controls"));
  const help = root.querySelector(".zbp-help-btn");
  const dialog = root.querySelector(".zbp-help-dialog");
  assert.ok(help);
  assert.ok(dialog?.hidden);
  assert.match(dialog.textContent, /drill/i);
  assert.match(dialog.textContent, /pan/i);
  assert.match(dialog.textContent, /zoom/i);
  assert.match(dialog.textContent, /search/i);
  assert.ok(root.querySelector('.zbp-hit[data-id="smoke-pin"]'));
  assert.equal(root.querySelector('.zbp-hit[data-id="smoke-pin"]').dataset.sym, "io");
  assert.ok(root.querySelector('.zbp-hit[data-id="smoke-pin"] .marker-point'));

  help.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(dialog.hidden, false);
  assert.equal(help.getAttribute("aria-expanded"), "true");
  dialog.querySelector(".zbp-help-close").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(dialog.hidden, true);
  assert.equal(help.getAttribute("aria-expanded"), "false");

  const peripheral = root.querySelector(".zbp-peripheral");
  assert.ok(peripheral);
  assert.equal(peripheral.disabled, false);
  assert.equal(peripheral.querySelector('option[value="uart0"]').textContent, "uart0 (1)");

  const info = root.querySelector('.zbp-info[data-info="smoke-pin"]');
  assert.ok(info);
  info.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.match(root.querySelector(".zbp-detail").textContent, /TX/);
  assert.match(root.querySelector(".zbp-detail").textContent, /digital/);
  assert.match(root.querySelector(".zbp-detail").textContent, /Domain/);

  peripheral.value = "uart0";
  peripheral.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.match(root.querySelector(".zbp-detail").textContent, /uart0/);

  dom.window.close();
});
