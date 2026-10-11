// Parity + timing check for the widget's flat index (js/model.js).
//
// Usage: node benchmarks/bench_widget_index.mjs resolved.json
// Compares buildIndex() against the recursive mux.js helpers it replaces and
// prints JSON timings. Exits non-zero on any mismatch.
import { readFileSync } from "node:fs";
import { buildIndex } from "../src/board_pinout/static/board_pinout/js/model.js";
import {
  collectPeripherals,
  partHasPeripheral,
  muxSignalsForPeripheral,
} from "../src/board_pinout/static/board_pinout/js/mux.js";
import { findPart } from "../src/board_pinout/static/board_pinout/js/util.js";

const doc = JSON.parse(readFileSync(process.argv[2], "utf8"));
const face = Object.values(doc.faces)[0];
const parts = face.children || [];

function ms(fn) {
  const t = performance.now();
  const out = fn();
  return [out, performance.now() - t];
}

const [idx, buildMs] = ms(() => buildIndex(parts));
const [oldPeris, oldPeriMs] = ms(() => collectPeripherals(parts));
const [newPeris, newPeriMs] = ms(() => idx.peripherals());

const fail = [];
if (JSON.stringify(oldPeris) !== JSON.stringify(newPeris)) fail.push("peripherals differ");

const all = [];
(function walk(list) {
  for (const p of list || []) {
    all.push(p);
    walk(p.children);
  }
})(parts);
if (idx.size !== all.length) fail.push(`size ${idx.size} != ${all.length}`);

const peri = oldPeris.length ? oldPeris[0].id : "";
for (const p of all) {
  const f = findPart(parts, p.id);
  const g = idx.find(p.id);
  if (!g || g.part !== f.part || g.parent !== f.parent) fail.push(`find ${p.id}`);
  if (partHasPeripheral(p, peri) !== idx.hasPeripheral(p, peri)) fail.push(`hasPeri ${p.id}`);
  if (
    JSON.stringify(muxSignalsForPeripheral(p, peri)) !==
    JSON.stringify(idx.signalsFor(p, peri))
  )
    fail.push(`signals ${p.id}`);
  if (fail.length > 10) break;
}

// Search: old recursive "subtree matches" vs. index.subtreeMatches.
const q = "sda";
const hit = (p) => idx.matchesQuery(p, q);
const [oldOpen, oldSearchMs] = ms(() => {
  const open = new Set();
  (function openMatches(list) {
    (list || []).forEach((p) => {
      let childHit = false;
      (p.children || []).forEach(function walk(c) {
        if (hit(c)) childHit = true;
        (c.children || []).forEach(walk);
      });
      if (hit(p) || childHit) open.add(p.id);
      openMatches(p.children || []);
    });
  })(parts);
  return open;
});
const [newOpen, newSearchMs] = ms(() => idx.subtreeMatches(hit));
if (oldOpen.size !== newOpen.size || [...oldOpen].some((id) => !newOpen.has(id)))
  fail.push(`search open set ${oldOpen.size} vs ${newOpen.size}`);

// Old per-click findPart cost vs index lookup across every id.
const [, oldFindMs] = ms(() => all.forEach((p) => findPart(parts, p.id)));
const [, newFindMs] = ms(() => all.forEach((p) => idx.find(p.id)));

console.log(
  JSON.stringify({
    parts: all.length,
    peripherals: newPeris.length,
    build_index_ms: +buildMs.toFixed(2),
    peripherals_ms: { old: +oldPeriMs.toFixed(2), new: +newPeriMs.toFixed(3) },
    search_ms: { old: +oldSearchMs.toFixed(2), new: +newSearchMs.toFixed(2) },
    find_all_ms: { old: +oldFindMs.toFixed(2), new: +newFindMs.toFixed(2) },
    ok: fail.length === 0,
    failures: fail,
  })
);
process.exit(fail.length ? 1 : 0);
