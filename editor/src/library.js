/** Build New-part palette rows from `state.types` (types/*.yaml → types.bundle.json). */

import { state } from "./state.js";

/**
 * Expand child silk templates from types YAML.
 * `{n}` = 1-based index, `{i}` = 0-based, `{r}`/`{c}` = 1-based row/col.
 */
export function formatChildSilk(template, i, r, c) {
  const tpl = template == null || template === "" ? "{n}" : String(template);
  return tpl
    .replaceAll("{n}", String(i + 1))
    .replaceAll("{i}", String(i))
    .replaceAll("{r}", String(r + 1))
    .replaceAll("{c}", String(c + 1));
}

function titleCaseKey(key) {
  return String(key)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Normalize one type's `editor` block into a palette item (or null if hidden).
 */
export function paletteItemFromType(key, typ) {
  const ed = typ?.editor;
  if (!ed || ed.palette === false) return null;

  const item = {
    key,
    ref: key,
    label: ed.label || titleCaseKey(key),
    silk: ed.silk || ed.label || titleCaseKey(key),
    sym: ed.sym || "io",
    order: Number.isFinite(ed.order) ? ed.order : 1000,
  };
  if (ed.notes || typ.notes) item.notes = ed.notes || typ.notes;

  if (ed.group) {
    const g = ed.group;
    item.group = {
      label: g.label || `${item.label} group`,
      ref: g.ref || "group",
      silk: g.silk || item.silk,
      childKind: g.child_kind || g.childKind || "pin",
      childSilk: g.child_silk || g.childSilk || "{n}",
      sourceKey: key,
    };
    if (g.child_ref || g.childRef) item.group.childRef = g.child_ref || g.childRef;
    if (g.child_notes || g.childNotes) {
      item.group.childNotes = g.child_notes || g.childNotes;
    }
  } else if (ed.fixed_group || ed.fixedGroup) {
    item.fixedGroup = true;
  }

  return item;
}

/** Sorted palette rows derived from the loaded type library. */
export function libraryParts() {
  const types = state.types || {};
  const items = [];
  for (const [key, typ] of Object.entries(types)) {
    const item = paletteItemFromType(key, typ);
    if (item) items.push(item);
  }
  items.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  return items;
}

export function libraryPartByKey(key) {
  return libraryParts().find((item) => item.key === key) || null;
}
