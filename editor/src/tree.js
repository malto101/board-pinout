import { state, els, pushHistory } from "./state.js";
import {
  face,
  walk,
  findPart,
  uniqueId,
  ensurePoint,
  pointForNewPart,
  partMatchesSearch,
  visibleMarkers,
  isOpen,
  CENTER_POINT,
} from "./model.js";
import { resolvePartVisual, partSymBadge } from "./symbols.js";
import { escapeAttr, escapeRegExp } from "./util.js";
import { renderOverlay } from "./overlay.js";
import { refresh, renderMeta, selectPart, showContextMenu } from "./ui.js";

export function renderTree() {
  function renderList(parts) {
    if (!parts?.length) return "";
    let html = `<ul class="tree-root">`;
    for (const part of parts) {
      if (state.search && !partMatchesSearch(part) && !(part.children || []).some(function walkKids(c) {
        return partMatchesSearch(c) || (c.children || []).some(walkKids);
      })) {
        continue;
      }
      const kids = part.children || [];
      const open = isOpen(part.id);
      const active = part.id === state.selectedId ? "active" : "";
      const selected = state.selectedIds.has(part.id) ? "selected" : "";
      const visual = resolvePartVisual(part);
      html += `<li>`;
      html += `<div class="tree-row ${active} ${selected}" data-id="${part.id}" draggable="true">`;
      if (kids.length) {
        html += `<button type="button" class="tree-twisty" data-toggle="${part.id}" aria-expanded="${open}">${
          open ? "▾" : "▸"
        }</button>`;
      } else {
        html += `<span class="tree-leaf">•</span>`;
      }
      html += partSymBadge(part);
      html += `<span class="tree-label">${escapeAttr(part.silk || part.id)}</span>`;
      html += `<span class="tree-kind">${escapeAttr(visual.title)}</span>`;
      html += `</div>`;
      if (kids.length && open) html += renderList(kids);
      html += `</li>`;
    }
    html += `</ul>`;
    return html;
  }

  els.partTree.innerHTML = renderList(face().children) || `<p class="muted">No parts yet</p>`;
  bindTreeEvents();
}

export function bindTreeEvents() {
  els.partTree.querySelectorAll(".tree-twisty").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.toggle;
      state.treeOpen[id] = !isOpen(id);
      renderTree();
    });
  });

  els.partTree.querySelectorAll(".tree-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".tree-twisty")) return;
      if (e.target.closest(".rename-input")) return;
      const id = row.dataset.id;
      if (e.metaKey || e.ctrlKey) {
        toggleMultiSelect(id);
      } else if (e.shiftKey && state.selectedId) {
        selectTreeRange(state.selectedId, id);
      } else {
        state.selectedIds = new Set([id]);
        selectPart(id);
        return;
      }
      state.selectedId = id;
      refresh();
    });

    row.querySelector(".tree-label")?.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginTreeRename(row.dataset.id);
    });

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const id = row.dataset.id;
      if (!state.selectedIds.has(id)) {
        state.selectedIds = new Set([id]);
        state.selectedId = id;
      }
      showContextMenu(e.clientX, e.clientY, id);
      renderTree();
      renderMeta();
    });

    row.addEventListener("dragstart", (e) => {
      if (state.renaming || e.target.closest(".rename-input")) {
        e.preventDefault();
        return;
      }
      const id = row.dataset.id;
      if (!state.selectedIds.has(id)) {
        state.selectedIds = new Set([id]);
        state.selectedId = id;
      }
      state.treeDragIds = [...state.selectedIds];
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", state.treeDragIds.join(","));
    });

    row.addEventListener("dragend", () => {
      state.treeDragIds = null;
      els.partTree.querySelectorAll(".drop-target,.dragging").forEach((el) => {
        el.classList.remove("drop-target", "dragging");
      });
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      row.classList.add("drop-target");
    });

    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drop-target");
      const parentId = row.dataset.id;
      const ids = state.treeDragIds || (e.dataTransfer.getData("text/plain") || "").split(",").filter(Boolean);
      nestPartsUnder(ids, parentId);
    });
  });

  els.partTree.addEventListener("dragover", (e) => {
    if (e.target === els.partTree) e.preventDefault();
  });
  els.partTree.addEventListener("drop", (e) => {
    if (e.target !== els.partTree) return;
    e.preventDefault();
    const ids = state.treeDragIds || [];
    movePartsToRoot(ids);
  });
}

export function toggleMultiSelect(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
}

export function commitRename(id, raw) {
  const found = findPart(id);
  if (!found) return;
  const next = String(raw ?? "").trim();
  const prev = found.part.silk || "";
  if (next === prev || (next === "" && !prev)) {
    refresh();
    return;
  }
  pushHistory();
  if (!next) delete found.part.silk;
  else found.part.silk = next;
  state.selectedId = id;
  state.selectedIds = new Set([id]);
  refresh();
}

export function beginTreeRename(id) {
  if (state.previewMode || state.renaming) return;
  const found = findPart(id);
  if (!found) return;
  state.renaming = true;
  state.selectedId = id;
  state.selectedIds = new Set([id]);
  renderTree();
  renderMeta();
  renderOverlay();

  const row = els.partTree.querySelector(`.tree-row[data-id="${CSS.escape(id)}"]`);
  const target = row?.querySelector(".tree-label");
  if (!target) {
    state.renaming = false;
    return;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input tree-rename";
  input.value = found.part.silk || found.part.id;
  input.setAttribute("aria-label", "Rename part");
  target.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    state.renaming = false;
    const value = input.value;
    if (save) commitRename(id, value);
    else refresh();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
}

export function beginCanvasRename(id) {
  if (state.previewMode || state.renaming) return;
  const found = findPart(id);
  if (!found) return;
  state.renaming = true;
  state.selectedId = id;
  state.selectedIds = new Set([id]);
  renderOverlay();
  renderTree();
  renderMeta();

  const g = els.overlay.querySelector(`.marker-hit[data-id="${CSS.escape(id)}"]`);
  const labelGroup = g?.querySelector(".marker-label");
  const rect = labelGroup?.querySelector("rect");
  const bounds = (rect || labelGroup)?.getBoundingClientRect?.();
  if (!bounds || bounds.width === 0) {
    state.renaming = false;
    return;
  }

  document.querySelectorAll(".canvas-rename").forEach((el) => el.remove());
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input canvas-rename";
  input.value = found.part.silk || found.part.id;
  input.setAttribute("aria-label", "Rename part");
  input.style.left = `${bounds.left}px`;
  input.style.top = `${bounds.top}px`;
  input.style.width = `${Math.max(bounds.width, 72)}px`;
  document.body.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    state.renaming = false;
    input.remove();
    if (save) commitRename(id, input.value);
    else refresh();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

export function flattenVisibleIds(parts = face().children, out = []) {
  for (const p of parts || []) {
    out.push(p.id);
    if (isOpen(p.id) && p.children?.length) flattenVisibleIds(p.children, out);
  }
  return out;
}

export function selectTreeRange(fromId, toId) {
  const ids = flattenVisibleIds();
  const a = ids.indexOf(fromId);
  const b = ids.indexOf(toId);
  if (a < 0 || b < 0) {
    state.selectedIds = new Set([toId]);
    return;
  }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  state.selectedIds = new Set(ids.slice(lo, hi + 1));
}

export function selectMarkerRange(fromId, toId) {
  const ids = visibleMarkers().map((p) => p.id);
  const a = ids.indexOf(fromId);
  const b = ids.indexOf(toId);
  if (a < 0 || b < 0) {
    state.selectedIds = new Set([toId]);
    return;
  }
  const [lo, hi] = a < b ? [a, b] : [b, a];
  state.selectedIds = new Set(ids.slice(lo, hi + 1));
}

export function isDescendant(ancestorId, maybeChildId) {
  const found = findPart(ancestorId);
  if (!found) return false;
  let hit = false;
  walk(found.part.children || [], (p) => {
    if (p.id === maybeChildId) hit = true;
  });
  return hit;
}

export function detachPart(id) {
  const found = findPart(id);
  if (!found) return null;
  const idx = found.siblings.indexOf(found.part);
  found.siblings.splice(idx, 1);
  return found.part;
}

export function topmostIds(ids) {
  return ids.filter((id) => !ids.some((other) => other !== id && isDescendant(other, id)));
}

export function nestPartsUnder(childIds, parentId) {
  const parent = findPart(parentId);
  if (!parent) return;
  if (childIds.includes(parentId) || childIds.some((id) => isDescendant(id, parentId))) {
    return;
  }
  pushHistory();
  const moving = topmostIds(childIds.filter((id) => id && id !== parentId));
  const parts = [];
  for (const id of moving) {
    const p = detachPart(id);
    if (p) parts.push(p);
  }
  parent.part.children = parent.part.children || [];
  parent.part.children.push(...parts);
  if (!parent.part.kind && !parent.part.ref) parent.part.kind = "group";
  state.treeOpen[parentId] = true;
  state.selectedId = parentId;
  state.selectedIds = new Set([parentId]);
  refresh();
}

export function movePartsToRoot(ids) {
  if (!ids?.length) return;
  pushHistory();
  const parts = [];
  for (const id of ids) {
    const p = detachPart(id);
    if (p) parts.push(p);
  }
  face().children.push(...parts);
  refresh();
}

export function groupSelected() {
  const ids = topmostIds([...state.selectedIds]);
  if (ids.length < 1) return;
  const first = findPart(ids[0]);
  if (!first) return;
  pushHistory();
  const parentList = first.siblings;
  const insertAt = parentList.indexOf(first.part);
  const groupId = uniqueId("group");
  const parts = [];
  for (const id of ids) {
    const p = detachPart(id);
    if (p) parts.push(p);
  }
  const group = ensurePoint(
    { id: groupId, kind: "group", silk: "Group", children: parts },
    pointForNewPart(parts)
  );
  parentList.splice(Math.min(Math.max(insertAt, 0), parentList.length), 0, group);
  state.treeOpen[groupId] = true;
  state.selectedId = groupId;
  state.selectedIds = new Set([groupId]);
  refresh();
}

/** "Header" → "Header 2"; "Header 2" → "Header 3" among sibling labels. */
export function nextNumberedLabel(label, siblings) {
  const raw = String(label || "part").trim() || "part";
  const stemMatch = raw.match(/^(.*?)(?:\s+(\d+))?$/);
  const stem = (stemMatch?.[1] ?? raw).trimEnd() || raw;
  const re = new RegExp(`^${escapeRegExp(stem)}(?:\\s+(\\d+))?$`);
  let max = 1;
  for (const s of siblings || []) {
    const text = String(s.silk || s.id || "").trim();
    const m = text.match(re);
    if (!m) continue;
    const n = m[1] ? Number(m[1]) : 1;
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${stem} ${max + 1}`;
}

export function duplicatePart(id) {
  const found = findPart(id);
  if (!found) return;
  pushHistory();
  const clone = structuredClone(found.part);
  const remap = (node, prefix) => {
    node.id = uniqueId(prefix || node.id);
    ensurePoint(node);
    (node.children || []).forEach((c, i) => remap(c, `${node.id}_${i + 1}`));
  };
  remap(clone, found.part.id);
  const baseLabel = found.part.silk || found.part.id;
  clone.silk = nextNumberedLabel(baseLabel, found.siblings);
  // Nudge copy so it is visible beside the original
  if (clone.point) {
    clone.point = [
      Math.min(1, Number((clone.point[0] + 0.03).toFixed(4))),
      clone.point[1],
    ];
  }
  const idx = found.siblings.indexOf(found.part);
  found.siblings.splice(idx + 1, 0, clone);
  state.selectedId = clone.id;
  state.selectedIds = new Set([clone.id]);
  refresh();
}

export function duplicateSelected() {
  const id = state.selectedId || [...state.selectedIds][0];
  if (!id) return;
  duplicatePart(id);
}

