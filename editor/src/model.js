import { state } from "./state.js";
import { CENTER_POINT, ensurePoint } from "../../src/board_pinout/static/board_pinout/js/util.js";
import {
  collectPeripherals as collectPeripheralsIn,
  normalizeMuxEntry,
  partHasPeripheral,
  partMuxEntries,
} from "../../src/board_pinout/static/board_pinout/js/mux.js";
import { buildSocIndex } from "../../src/board_pinout/static/board_pinout/js/soc.js";

export { CENTER_POINT, ensurePoint, partHasPeripheral, partMuxEntries };

export function muxEntriesForView(part) {
  return effectivePartMuxEntries(part);
}

let cachedSocIndex = null;
let cachedSocTable = null;
let cachedSocPackage = null;

function boardSocRefs() {
  const soc = state.board.soc;
  if (typeof soc === "string" && soc) return [{ id: soc, package: state.board.soc_package }];
  return Array.isArray(soc) ? soc.filter((ref) => typeof ref === "string" ? ref : ref?.id).map((ref) =>
    typeof ref === "string" ? { id: ref, package: undefined } : ref
  ) : [];
}

export function activeSocIndex(part = null) {
  if (state.documentMode !== "board" || state.board.mux_source !== "soc") return null;
  const refs = boardSocRefs();
  const requested = part?.soc;
  const ref = requested
    ? refs.find((item) => item.id === requested)
    : refs.find((item) => item.id === state.socTable?.soc);
  const table = state.socTable;
  if (!table || (requested && table.soc !== requested) || (!requested && !ref)) return null;
  const selected = ref || { id: table.soc, package: state.board.soc_package };
  const packageName = selected.package || state.board.soc_package;
  if (cachedSocTable !== table || cachedSocPackage !== packageName) {
    cachedSocTable = table;
    cachedSocPackage = packageName;
    cachedSocIndex = buildSocIndex(table, packageName);
  }
  return cachedSocIndex;
}

export function activeSocStatus(part = null) {
  if (state.documentMode !== "board" || state.board.mux_source !== "soc") {
    return { kind: "inline", message: "Inline mux authoring is active." };
  }
  const refs = boardSocRefs();
  const requested = part?.soc;
  const expected = requested || refs.find((ref) => ref.id === state.socTable?.soc)?.id || refs[0]?.id || state.board.soc;
  if (!expected) return { kind: "missing", message: "Set a board SoC before linking a pad table." };
  if (!state.socTable) return { kind: "missing", message: `Load the ${expected} SoC pad table.` };
  if (state.socTable.soc !== expected) {
    return { kind: "mismatch", message: `Loaded SoC ${state.socTable.soc || "(unnamed)"}; expected ${expected}.` };
  }
  const packageName = part?.soc_package || state.board.soc_package || refs.find((ref) => ref.id === expected)?.package;
  if (packageName && state.socTable.packages && !state.socTable.packages[packageName]) {
    return { kind: "package", message: `SoC table has no package named ${packageName}.` };
  }
  return { kind: "linked", message: `Linked ${expected}${packageName ? ` · package ${packageName}` : ""}.` };
}

export function socPadOptions(part = null) {
  const index = activeSocIndex(part);
  if (!index) return [];
  return [...index.pads.values()].map((row) => ({
    name: row.name,
    aliases: row.aliases || [],
    info: row.info || {},
    functions: row.functions || [],
  }));
}

export function canonicalSocPad(part, value) {
  const index = activeSocIndex(part);
  return index?.canonical(value) || null;
}

export function resetSocIndexCache() {
  cachedSocIndex = null;
  cachedSocTable = null;
  cachedSocPackage = null;
}

export function boardSocReferences() {
  return boardSocRefs();
}

function excludedMuxEntry(entry, patterns) {
  return (patterns || []).some((pattern) => {
    if (String(pattern).endsWith(".*")) {
      const prefix = String(pattern).slice(0, -2);
      return entry.peripheral ? String(entry.peripheral) === prefix : String(entry.function || "").startsWith(`${prefix}_`);
    }
    return String(entry.function || "") === String(pattern);
  });
}

/** Effective mux choices for authoring/preview; authored entries remain raw. */
export function effectivePartMuxEntries(part) {
  const authored = partMuxEntries(part);
  const index = activeSocIndex(part);
  if (!index || !part?.pad) return authored;
  const useTable = part.mux_policy !== "replace" && part.mux === undefined;
  const extendTable = part.mux_policy === "extend";
  const candidates = index.candidates(part.pad, { expandRouting: part.mux_routable !== false })
    .filter((entry) => !excludedMuxEntry(entry, part.mux_exclude))
    .map(normalizeMuxEntry)
    .filter(Boolean);
  if (!useTable && !extendTable) return authored;
  if (extendTable) return candidates.concat(authored);
  return candidates;
}

export function effectivePartPadInfo(part) {
  const index = activeSocIndex(part);
  return index && part?.pad ? index.pad(part.pad)?.info || null : null;
}

export function socPadCandidates(part) {
  const index = activeSocIndex(part);
  return index && part?.pad ? index.candidates(part.pad, { expandRouting: part.mux_routable !== false }) : [];
}

export function effectivePartHasPeripheral(part, peri) {
  if (!peri) return true;
  return effectivePartMuxEntries(part).some((m) => m.peripheral === String(peri).toLowerCase());
}

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
  if (state.documentMode !== "board" || state.board.mux_source !== "soc") {
    return collectPeripheralsIn(face().children);
  }
  const map = new Map();
  walk(face().children, (part) => {
    for (const mux of effectivePartMuxEntries(part)) {
      if (!map.has(mux.peripheral)) map.set(mux.peripheral, { id: mux.peripheral, signals: new Set(), pinIds: [] });
      const row = map.get(mux.peripheral);
      row.signals.add(mux.signal);
      if (!row.pinIds.includes(part.id)) row.pinIds.push(part.id);
    }
  });
  return [...map.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => ({ id: row.id, signals: [...row.signals].sort(), pinIds: row.pinIds }));
}

export function partMatchesSearch(p) {
  if (!state.search) return true;
  const q = state.search.toLowerCase();
  const muxHay = muxEntriesForView(p)
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
