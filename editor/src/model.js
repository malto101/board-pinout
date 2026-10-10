import { state } from "./state.js";
import { CENTER_POINT, ensurePoint } from "../../src/board_pinout/static/board_pinout/js/util.js";
import {
  collectPeripherals as collectPeripheralsIn,
  partHasPeripheral,
  partMuxEntries,
} from "../../src/board_pinout/static/board_pinout/js/mux.js";

export { CENTER_POINT, ensurePoint, partHasPeripheral, partMuxEntries };

export function face() {
  return state.board.faces.top;
}

export function walk(parts, fn, parent = null, path = []) {
  for (const part of parts || []) {
    fn(part, parent, path);
    walk(part.children || [], fn, part, path.concat(part.id));
  }
}

export function findPart(id, parts = face().children, parent = null) {
  for (const part of parts || []) {
    if (part.id === id) return { part, parent, siblings: parts };
    const nested = findPart(id, part.children || [], part);
    if (nested) return nested;
  }
  return null;
}

export function allIds() {
  const ids = new Set();
  walk(face().children, (p) => ids.add(p.id));
  return ids;
}

export function uniqueId(base) {
  const ids = allIds();
  if (!ids.has(base)) return base;
  let i = 2;
  while (ids.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

/** Walk the face tree and fill any missing/invalid points. */
export function ensureAllPoints(parts = face().children) {
  walk(parts, (p) => ensurePoint(p));
}

/** Average of member points (or descendants); else board center. */
export function pointForNewPart(fromParts) {
  const pts = [];
  for (const p of fromParts || []) {
    if (Array.isArray(p?.point) && p.point.length === 2) pts.push(p.point);
  }
  if (!pts.length) {
    for (const p of fromParts || []) {
      walk(p?.children || [], (c) => {
        if (Array.isArray(c.point) && c.point.length === 2) pts.push(c.point);
      });
    }
  }
  if (!pts.length) return [...CENTER_POINT];
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [Number(x.toFixed(4)), Number(y.toFixed(4))];
}

export function level0Parts() {
  return face().children || [];
}

export function collectPeripherals() {
  return collectPeripheralsIn(face().children);
}

export function partMatchesSearch(p) {
  if (!state.search) return true;
  const q = state.search.toLowerCase();
  const muxHay = partMuxEntries(p)
    .map((m) => [m.peripheral, m.signal, m.function, m.mode].filter(Boolean).join(" "))
    .join(" ");
  return [p.id, p.silk, p.pad, p.ref, p.kind, p.notes, muxHay]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(q);
}

export function visibleMarkers() {
  // Top-level parts always get a point (center if missing). Nested parts only
  // draw when they already have an authored point (edit) or preview drill.
  level0Parts().forEach((p) => ensurePoint(p));
  let out;
  if (!state.previewMode) {
    out = [];
    walk(face().children, (p, parent) => {
      if (!parent) {
        out.push(ensurePoint(p));
        return;
      }
      if (
        Array.isArray(p.point) &&
        p.point.length >= 2 &&
        Number.isFinite(p.point[0]) &&
        Number.isFinite(p.point[1])
      ) {
        out.push(p);
      }
    });
  } else if (state.drillStack.length === 0) {
    out = level0Parts().map((p) => ensurePoint(p));
  } else {
    const current = findPart(state.drillStack[state.drillStack.length - 1])?.part;
    out = (current?.children || []).map((p) => ensurePoint(p));
  }
  if (state.search) out = out.filter(partMatchesSearch);
  return out;
}

export function isOpen(id) {
  return state.treeOpen[id] === true;
}
