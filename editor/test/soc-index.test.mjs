import assert from "node:assert/strict";
import test from "node:test";
import { buildSocIndex } from "../../src/board_pinout/static/board_pinout/js/soc.js";

function table() {
  return {
    schema_version: "1.1",
    soc: "demo-soc",
    packages: {
      qfn: { pads: { IO0: {}, IO1: {} }, functions_exclude: ["spi0.*"] },
    },
    pad_defaults: { type: "io", tolerance: "3.6 V" },
    pads: {
      IO0: {
        aliases: ["GPIO0"],
        functions: [
          { function: "GPIO0", peripheral: "gpio", signal: "GPIO0", packages: ["qfn"] },
          { function: "SPI0_MOSI", peripheral: "spi0", signal: "MOSI", packages: ["qfn"] },
        ],
      },
      IO1: {
        functions: [{ function: "UART0_TX", peripheral: "uart0", signal: "TX" }],
      },
    },
  };
}

test("SoC browser index canonicalizes aliases and filters package functions", () => {
  const index = buildSocIndex(table(), "qfn");
  assert.equal(index.canonical("GPIO0"), "IO0");
  assert.equal(index.pad("GPIO0").info.pad, "IO0");
  assert.deepEqual(index.candidates("GPIO0").map((entry) => entry.function), ["GPIO0"]);
  assert.equal(index.pad("IO1").info.pad, "IO1");
});

test("SoC browser index preserves candidate provenance", () => {
  const index = buildSocIndex({
    soc: "routing-soc",
    pads: { IO0: { functions: [] } },
    routing: [{ kind: "matrix", functions: [{ function: "UART0_TX", peripheral: "uart0", signal: "TX" }] }],
  });
  assert.equal(index.candidates("IO0").length, 0);
  assert.equal(index.candidates("IO0", { expandRouting: true })[0].source, "routing");
});
