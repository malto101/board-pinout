import yaml from "js-yaml";
import {
  state,
  els,
  history,
  GRID_EXTENT_START,
  GRID_EXTENT_CAP,
  pushHistory,
  takeSnapshot,
  updateHistoryButtons,
} from "./state.js";
import { libraryParts, libraryPartByKey, formatChildSilk } from "./library.js";
import {
  face,
  findPart,
  allIds,
  uniqueId,
  ensurePoint,
  level0Parts,
  collectPeripherals,
  CENTER_POINT,
  isOpen,
} from "./model.js";
import {
  PART_SYMBOLS,
  PIN_ROLES,
  applyRoleToPart,
  resolvePartVisual,
  partSymBadge,
} from "./symbols.js";
import {
  applyViewTransform,
  normalizeViewRotation,
  focusOnSelection,
  stopViewTween,
  zoomAtClient,
  clientToNorm,
  snapValue,
  updateSnapToggle,
} from "./view.js";
import { escapeAttr } from "./util.js";
import {
  renderOverlay,
  markersInRect,
  updateMarqueeEl,
  hideMarquee,
  beginPlaceLeaderVertex,
  cancelPlaceLeaderVertex,
  addLeaderVertexAtClient,
  clearLeaderVertices,
} from "./overlay.js";
import {
  renderTree,
  groupSelected,
  movePartsToRoot,
  duplicatePart,
  duplicateSelected,
  detachPart,
} from "./tree.js";


export function restoreSnapshot(snap) {
  history.pausing = true;
  state.board = structuredClone(snap.board);
  state.selectedId = snap.selectedId;
  state.selectedIds = new Set(snap.selectedIds);
  state.treeOpen = { ...snap.treeOpen };
  applyUnderlayFromBoard();
  refresh();
  history.pausing = false;
}

export function undo() {
  if (!history.past.length) return;
  history.future.push(takeSnapshot());
  restoreSnapshot(history.past.pop());
  updateHistoryButtons();
}

export function redo() {
  if (!history.future.length) return;
  history.past.push(takeSnapshot());
  restoreSnapshot(history.future.pop());
  updateHistoryButtons();
}


export function applyRoleToSelection(roleKey) {
  const ids = state.selectedIds.size
    ? [...state.selectedIds]
    : state.selectedId
      ? [state.selectedId]
      : [];
  if (!ids.length) return;
  pushHistory();
  for (const id of ids) {
    const part = findPart(id)?.part;
    if (!part) continue;
    if (part.kind === "group" || part.kind === "pin_array") continue;
    applyRoleToPart(part, roleKey);
  }
  refresh();
}

export function rolePickerHtml(activeKey) {
  return `
    <div class="role-picker">
      <div class="panel-title" style="margin-bottom:0.3rem">Set as</div>
      <div class="role-picker-grid">
        ${PIN_ROLES.map((key) => {
          const meta = PART_SYMBOLS[key];
          const on = key === activeKey ? "active" : "";
          return `<button type="button" class="role-btn ${on}" data-role="${key}" title="${escapeAttr(
            meta.title
          )}">${partSymBadge(key)}<span>${escapeAttr(meta.title)}</span></button>`;
        }).join("")}
      </div>
      <p class="hint-mini">Applies to selection · use on pins inside a group</p>
    </div>
  `;
}

export function bindRolePicker(root) {
  root.querySelectorAll("[data-role]").forEach((btn) => {
    btn.addEventListener("click", () => applyRoleToSelection(btn.dataset.role));
  });
}


export function rotateView(deltaDeg) {
  stopViewTween();
  state.view.rotation = normalizeViewRotation((state.view.rotation || 0) + deltaDeg);
  applyViewTransform();
  renderOverlay();
}

export function resetView() {
  stopViewTween();
  const faceRot = Number(face().underlay_rotation);
  state.view = {
    zoom: 1,
    x: 0,
    y: 0,
    rotation: Number.isFinite(faceRot) ? normalizeViewRotation(faceRot) : 0,
  };
  applyViewTransform();
  renderOverlay();
}

export function rotateSelectedLabels(deltaDeg) {
  const ids = [...state.selectedIds];
  if (!ids.length && state.selectedId) ids.push(state.selectedId);
  if (!ids.length) return;
  pushHistory();
  ids.forEach((id) => {
    const part = findPart(id)?.part;
    if (!part) return;
    const cur = Number(part.label_rotation) || 0;
    const next = cur + deltaDeg;
    if (Math.abs(next % 360) < 1e-6) delete part.label_rotation;
    else part.label_rotation = next;
  });
  refresh();
}


export function hideContextMenu() {
  const menu = document.getElementById("ctxMenu");
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = "";
  }
}

export function showContextMenu(x, y, id) {
  const menu = document.getElementById("ctxMenu");
  if (!menu) return;
  const count = state.selectedIds.size;
  const found = findPart(id);
  const hasKids = !!(found?.part.children?.length);
  const hasLabel = !!(
    found?.part.label_offset ||
    (found?.part.label_rotation != null && Number(found.part.label_rotation) !== 0)
  );
  const hasVerts = !!(found?.part.leader_vertices?.length);
  const roleBtns = PIN_ROLES.map(
    (key) =>
      `<button type="button" data-ctx-role="${key}">Set as ${escapeAttr(PART_SYMBOLS[key].title)}</button>`
  ).join("");
  menu.innerHTML = `
    <button type="button" data-ctx="expand" ${hasKids ? "" : "disabled"}>Expand / collapse</button>
    <button type="button" data-ctx="add-child">Add child group</button>
    <div class="sep"></div>
    <button type="button" data-ctx="group" ${count < 1 ? "disabled" : ""}>Group selection (${count})</button>
    <button type="button" data-ctx="ungroup">Move to root</button>
    <button type="button" data-ctx="reset-label" ${hasLabel ? "" : "disabled"}>Reset label offset</button>
    <button type="button" data-ctx="add-vertex">Add leader vertex…</button>
    <button type="button" data-ctx="clear-vertices" ${hasVerts ? "" : "disabled"}>Clear leader vertices</button>
    <div class="sep"></div>
    ${roleBtns}
    <div class="sep"></div>
    <button type="button" data-ctx="duplicate">Duplicate</button>
    <button type="button" data-ctx="delete">Delete</button>
  `;
  menu.hidden = false;
  menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - 420)}px`;
  menu.querySelectorAll("[data-ctx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.ctx;
      hideContextMenu();
      if (act === "expand") {
        state.treeOpen[id] = !isOpen(id);
        renderTree();
      } else if (act === "add-child") {
        pushHistory();
        const childId = uniqueId(`${id}_child`);
        const parent = findPart(id);
        if (!parent) return;
        parent.part.children = parent.part.children || [];
        const near = Array.isArray(parent.part.point) ? parent.part.point : CENTER_POINT;
        parent.part.children.push(
          ensurePoint({ id: childId, kind: "group", silk: "Child" }, near)
        );
        if (!parent.part.kind && !parent.part.ref) parent.part.kind = "group";
        ensurePoint(parent.part);
        state.treeOpen[id] = true;
        state.selectedId = childId;
        state.selectedIds = new Set([childId]);
        refresh();
      } else if (act === "group") {
        groupSelected();
      } else if (act === "ungroup") {
        movePartsToRoot([...state.selectedIds]);
      } else if (act === "reset-label") {
        const part = findPart(id)?.part;
        if (part) {
          pushHistory();
          delete part.label_offset;
          delete part.label_rotation;
          refresh();
        }
      } else if (act === "add-vertex") {
        beginPlaceLeaderVertex(id);
      } else if (act === "clear-vertices") {
        clearLeaderVertices(id);
      } else if (act === "duplicate") {
        duplicatePart(id);
      } else if (act === "delete") {
        deleteSelected();
      }
    });
  });
  menu.querySelectorAll("[data-ctx-role]").forEach((btn) => {
    btn.addEventListener("click", () => {
      hideContextMenu();
      if (!state.selectedIds.has(id)) {
        state.selectedIds = new Set([id]);
        state.selectedId = id;
      }
      applyRoleToSelection(btn.dataset.ctxRole);
    });
  });
}


export function selectedPartsWithPoints() {
  return [...state.selectedIds]
    .map((id) => findPart(id)?.part)
    .filter((p) => p && Array.isArray(p.point) && p.point.length === 2);
}

export function nudgeSelection(dx, dy) {
  const parts = selectedPartsWithPoints();
  if (!parts.length) return;
  pushHistory();
  const step = state.snap ? state.snapStep : dx || dy;
  const adx = state.snap ? Math.sign(dx || 0) * step : dx;
  const ady = state.snap ? Math.sign(dy || 0) * step : dy;
  for (const p of parts) {
    p.point = [
      Math.min(1, Math.max(0, snapValue(p.point[0] + adx))),
      Math.min(1, Math.max(0, snapValue(p.point[1] + ady))),
    ];
  }
  refresh();
}

export let spacingHistoryReady = true;
export let spacingHistoryTimer = null;

export function scaleSelection(factor, { recordHistory = true } = {}) {
  const parts = selectedPartsWithPoints();
  if (parts.length < 2) return;
  if (recordHistory) pushHistory();
  const cx = parts.reduce((s, p) => s + p.point[0], 0) / parts.length;
  const cy = parts.reduce((s, p) => s + p.point[1], 0) / parts.length;
  for (const p of parts) {
    p.point = [
      Math.min(1, Math.max(0, Number((cx + (p.point[0] - cx) * factor).toFixed(4)))),
      Math.min(1, Math.max(0, Number((cy + (p.point[1] - cy) * factor).toFixed(4)))),
    ];
  }
  refresh();
}

/** Alt/⌥ + scroll pack/spread; one undo step per gesture. */
export function scaleSelectionFromWheel(deltaY) {
  if (state.previewMode || state.selectedIds.size < 2) return false;
  const factor = deltaY > 0 ? 0.94 : 1.06;
  scaleSelection(factor, { recordHistory: spacingHistoryReady });
  spacingHistoryReady = false;
  clearTimeout(spacingHistoryTimer);
  spacingHistoryTimer = setTimeout(() => {
    spacingHistoryReady = true;
  }, 450);
  return true;
}


export function bindSelectionTools(root) {
  root.querySelectorAll("[data-spread]").forEach((btn) => {
    btn.addEventListener("click", () => scaleSelection(Number(btn.dataset.spread)));
  });
  root.querySelectorAll("[data-nudge]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [dx, dy] = btn.dataset.nudge.split(",").map(Number);
      nudgeSelection(dx, dy);
    });
  });
  root.querySelectorAll("[data-focus-sel]").forEach((btn) => {
    btn.addEventListener("click", () => focusOnSelection());
  });
  bindRolePicker(root);
}

export function selectionToolsHtml(count) {
  if (count < 2) return "";
  return `
    <div class="sel-tools">
      <button type="button" class="text-btn" data-spread="0.85" title="Pack spacing (⌥/Alt+scroll)">Pack</button>
      <button type="button" class="text-btn" data-spread="1.15" title="Spread spacing (⌥/Alt+scroll)">Spread</button>
      <button type="button" class="text-btn" data-nudge="-0.01,0" title="Nudge left">←</button>
      <button type="button" class="text-btn" data-nudge="0.01,0" title="Nudge right">→</button>
      <button type="button" class="text-btn" data-nudge="0,-0.01" title="Nudge up">↑</button>
      <button type="button" class="text-btn" data-nudge="0,0.01" title="Nudge down">↓</button>
    </div>
    <p class="hint-mini">Drag to move all · ⌥scroll pack/spread · [ ] keys · F focus · scroll zooms</p>
    <button type="button" class="btn small" data-focus-sel title="Pan/zoom to selection (F)">Focus</button>
  `;
}

export function renderMeta() {
  const found = state.selectedId ? findPart(state.selectedId) : null;
  if (!found) {
    if (state.selectedIds.size > 1) {
      els.metaForm.innerHTML = `
        <p class="muted">${state.selectedIds.size} selected — ⌘G to group</p>
        ${rolePickerHtml("io")}
        ${selectionToolsHtml(state.selectedIds.size)}
      `;
      bindSelectionTools(els.metaForm);
      return;
    }
    els.metaForm.innerHTML = `<p class="muted">Nothing selected</p>`;
    return;
  }
  const p = found.part;
  const visual = resolvePartVisual(p);
  const isLeaf = p.kind !== "group" && p.kind !== "pin_array";
  const multiNote =
    state.selectedIds.size > 1
      ? `<p class="hint-mini">${state.selectedIds.size} selected · editing primary · ⌘G group</p>${selectionToolsHtml(
          state.selectedIds.size
        )}`
      : "";
  els.metaForm.innerHTML = `
    ${multiNote}
    <p class="sym-meta">${partSymBadge(p)} <span>${escapeAttr(visual.title)}</span></p>
    ${isLeaf || state.selectedIds.size > 1 ? rolePickerHtml(visual.key) : ""}
    <label>id <input data-field="id" value="${escapeAttr(p.id)}" /></label>
    <label>silk <input data-field="silk" value="${escapeAttr(p.silk || "")}" /></label>
    <label>ref <input data-field="ref" value="${escapeAttr(p.ref || "")}" /></label>
    <label>kind
      <select data-field="kind">
        ${["", "group", "pin", "pin_array", "receptacle", "gpio_control"]
          .map(
            (k) =>
              `<option value="${k}" ${p.kind === k || (!p.kind && k === "") ? "selected" : ""}>${
                k || "(from ref)"
              }</option>`
          )
          .join("")}
      </select>
    </label>
    <label>point x <input data-field="px" type="number" step="0.001" value="${escapeAttr(
      ensurePoint(p).point[0]
    )}" /></label>
    <label>point y <input data-field="py" type="number" step="0.001" value="${escapeAttr(
      ensurePoint(p).point[1]
    )}" /></label>
    <button type="button" class="btn small" id="focusSelectionBtn" title="Pan/zoom canvas to this part">Focus on canvas</button>
    <label>label dx <input data-field="ldx" type="number" step="0.001" value="${escapeAttr(
      p.label_offset ? p.label_offset[0] : ""
    )}" title="Normalized label offset from point (drag label on canvas)" /></label>
    <label>label dy <input data-field="ldy" type="number" step="0.001" value="${escapeAttr(
      p.label_offset ? p.label_offset[1] : ""
    )}" title="Normalized label offset from point (drag label on canvas)" /></label>
    <label>label rotation <input data-field="lrot" type="number" step="15" value="${escapeAttr(
      p.label_rotation != null && p.label_rotation !== "" ? p.label_rotation : 0
    )}" title="Degrees (SVG; positive = clockwise). Try 90 / -90 for vertical labels." /></label>
    <div class="btn-row">
      <button type="button" class="btn small" id="labelRotCcwBtn" title="Rotate label −90° (selection)">↺ −90°</button>
      <button type="button" class="btn small" id="labelRotCwBtn" title="Rotate label +90° (selection)">↻ +90°</button>
    </div>
    <button type="button" class="btn small" id="resetLabelOffset" ${
      p.label_offset || (p.label_rotation != null && Number(p.label_rotation) !== 0)
        ? ""
        : "disabled"
    }>Reset label offset / rotation</button>
    <label>rows <input data-field="rows" type="number" value="${escapeAttr(p.rows ?? "")}" /></label>
    <label>cols <input data-field="cols" type="number" value="${escapeAttr(p.cols ?? "")}" /></label>
    <label>pad <input data-field="pad" value="${escapeAttr(p.pad || "")}" /></label>
    ${muxEditorHtml(p)}
    <label>notes <textarea data-field="notes" rows="3">${escapeAttr(p.notes || "")}</textarea></label>
  `;
  els.metaForm.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("change", () => applyMetaField(p, input));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") applyMetaField(p, input);
    });
  });
  document.getElementById("resetLabelOffset")?.addEventListener("click", () => {
    pushHistory();
    delete p.label_offset;
    delete p.label_rotation;
    refresh();
  });
  document.getElementById("labelRotCcwBtn")?.addEventListener("click", () => {
    rotateSelectedLabels(-90);
  });
  document.getElementById("labelRotCwBtn")?.addEventListener("click", () => {
    rotateSelectedLabels(90);
  });
  document.getElementById("focusSelectionBtn")?.addEventListener("click", () => {
    focusOnSelection();
  });
  bindMuxEditor(p);
  bindSelectionTools(els.metaForm);
}

export function muxEditorHtml(part) {
  const rows = (part.mux || [])
    .map(
      (m, i) => `
    <div class="mux-row" data-mux-i="${i}">
      <input data-mux="peripheral" placeholder="i2c0" value="${escapeAttr(m.peripheral || "")}" title="Peripheral" />
      <input data-mux="signal" placeholder="SDA" value="${escapeAttr(m.signal || "")}" title="Signal" />
      <input data-mux="function" placeholder="I2C0_SDA" value="${escapeAttr(m.function || "")}" title="Function name" />
      <input data-mux="mode" placeholder="mode" value="${escapeAttr(m.mode ?? "")}" title="Mux mode" class="mux-mode" />
      <button type="button" class="icon-btn mux-del" title="Remove">×</button>
    </div>`
    )
    .join("");
  return `
    <div class="mux-editor">
      <div class="panel-head"><span class="panel-title">Mux</span>
        <button type="button" class="btn small" id="muxAddBtn" title="Add mux function">＋</button>
      </div>
      <p class="hint-mini">e.g. peripheral i2c0 · signal SDA · or function I2C0_SDA</p>
      <div class="mux-rows">${rows || '<p class="muted">No mux entries</p>'}</div>
    </div>`;
}

export function bindMuxEditor(part) {
  document.getElementById("muxAddBtn")?.addEventListener("click", () => {
    pushHistory();
    part.mux = part.mux || [];
    part.mux.push({ function: "FUNC", peripheral: "", signal: "" });
    refresh();
  });
  els.metaForm.querySelectorAll(".mux-row").forEach((row) => {
    const i = Number(row.dataset.muxI);
    row.querySelectorAll("[data-mux]").forEach((input) => {
      const commit = () => {
        if (!part.mux?.[i]) return;
        pushHistory();
        const key = input.dataset.mux;
        const val = input.value.trim();
        if (key === "mode") {
          if (val === "") delete part.mux[i].mode;
          else if (/^-?\d+$/.test(val)) part.mux[i].mode = Number(val);
          else part.mux[i].mode = val;
        } else if (!val) {
          if (key === "function") {
            part.mux.splice(i, 1);
            if (!part.mux.length) delete part.mux;
          } else {
            delete part.mux[i][key];
          }
        } else {
          part.mux[i][key] = val;
        }
        refresh();
      };
      input.addEventListener("change", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
      });
    });
    row.querySelector(".mux-del")?.addEventListener("click", () => {
      pushHistory();
      part.mux.splice(i, 1);
      if (!part.mux.length) delete part.mux;
      refresh();
    });
  });
}

export function renderPeripherals() {
  if (!els.periList) return;
  const peris = collectPeripherals();
  if (!peris.length) {
    els.periList.innerHTML = `<p class="muted">Add mux on pins to group by peripheral</p>`;
    return;
  }
  els.periList.innerHTML = `
    <button type="button" class="peri-item${state.peripheralFilter ? "" : " active"}" data-peri="">
      All <span class="peri-count">—</span>
    </button>
    ${peris
      .map(
        (p) => `
      <button type="button" class="peri-item${
        state.peripheralFilter === p.id ? " active" : ""
      }" data-peri="${escapeAttr(p.id)}" title="${escapeAttr(p.signals.join(", "))}">
        <span class="peri-id">${escapeAttr(p.id)}</span>
        <span class="peri-count">${p.pinIds.length}</span>
      </button>`
      )
      .join("")}
  `;
  els.periList.querySelectorAll("[data-peri]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-peri") || "";
      state.peripheralFilter = id;
      if (id) {
        const peri = peris.find((x) => x.id === id);
        if (peri?.pinIds.length) {
          state.selectedIds = new Set(peri.pinIds);
          state.selectedId = peri.pinIds[0];
          refresh();
          focusOnSelection();
          return;
        }
      }
      refresh();
    });
  });
}

export function applyMetaField(part, input) {
  pushHistory();
  const field = input.dataset.field;
  const value = input.value;
  if (field === "id") {
    const prev = part.id;
    const next = value.trim();
    if (!next || (next !== prev && allIds().has(next))) {
      alert("Invalid or duplicate id");
      input.value = prev;
      history.past.pop();
      updateHistoryButtons();
      return;
    }
    part.id = next;
    state.selectedId = next;
    state.selectedIds = new Set([...state.selectedIds].map((x) => (x === prev ? next : x)));
  } else if (field === "px" || field === "py") {
    ensurePoint(part);
    const raw = value === "" || value == null ? NaN : Number(value);
    let x = field === "px" ? (Number.isFinite(raw) ? raw : 0.5) : part.point[0];
    let y = field === "py" ? (Number.isFinite(raw) ? raw : 0.5) : part.point[1];
    if (Number.isFinite(x) && Number.isFinite(y)) {
      part.point = [snapValue(x), snapValue(y)];
    }
  } else if (field === "ldx" || field === "ldy") {
    if (value === "") {
      delete part.label_offset;
    } else {
      let dx = field === "ldx" ? Number(value) : part.label_offset?.[0] ?? 0.05;
      let dy = field === "ldy" ? Number(value) : part.label_offset?.[1] ?? 0;
      if (Number.isFinite(dx) && Number.isFinite(dy)) {
        dx = snapValue(dx);
        dy = snapValue(dy);
        part.label_offset = [dx, dy];
      }
    }
  } else if (field === "lrot") {
    if (value === "" || value == null) {
      delete part.label_rotation;
    } else {
      const rot = Number(value);
      if (Number.isFinite(rot)) {
        if (Math.abs(rot) < 1e-6) delete part.label_rotation;
        else part.label_rotation = rot;
      }
    }
  } else if (field === "rows" || field === "cols") {
    if (value === "") delete part[field];
    else part[field] = Number(value);
  } else if (field === "kind") {
    if (!value) delete part[field];
    else part[field] = value;
  } else if (field === "ref" || field === "silk" || field === "pad" || field === "notes") {
    if (!value) delete part[field];
    else part[field] = value;
  }
  refresh();
}


export function selectPart(id, { focus = true } = {}) {
  state.selectedId = id;
  if (!state.selectedIds.has(id) && state.selectedIds.size <= 1) {
    state.selectedIds = new Set(id ? [id] : []);
  }
  if (state.previewMode) {
    state.drillStack = [];
  }
  refresh();
  if (focus && id) focusOnSelection();
}


export function openDrill(id) {
  const found = findPart(id);
  if (!found) return;
  state.drillStack = [id];
  renderDrill();
}

export function renderDrill() {
  if (!state.previewMode) {
    els.drillPanel.hidden = true;
    return;
  }
  els.drillPanel.hidden = false;
  if (!state.drillStack.length) {
    els.breadcrumb.textContent = "Board (top-level)";
    els.drillContent.innerHTML = `<p class="muted">Click a marker to drill in.</p>`;
    return;
  }
  const id = state.drillStack[state.drillStack.length - 1];
  const found = findPart(id);
  if (!found) return;
  const part = found.part;
  els.breadcrumb.innerHTML = `Board &gt; ${state.drillStack
    .map((x) => escapeAttr(findPart(x)?.part?.silk || x))
    .join(" &gt; ")}
    <button class="btn small" type="button" id="drillUp">Up</button>`;
  document.getElementById("drillUp")?.addEventListener("click", () => {
    state.drillStack.pop();
    renderDrill();
    renderOverlay();
  });

  const children = part.children || [];
  const kind = part.kind || state.types[part.ref || ""]?.kind;
  let html = `<p><strong>${escapeAttr(part.silk || part.id)}</strong> · ${escapeAttr(
    part.ref || kind || ""
  )}</p>`;

  if (kind === "pin_array" || (children.length && children.every((c) => c.kind === "pin" || !c.children))) {
    const pins = children.length > 0 ? children : synthesizePins(part);
    html += `<div class="pin-grid">${pins
      .map(
        (c) =>
          `<div class="pin-cell" data-id="${escapeAttr(c.id)}">${escapeAttr(c.silk || c.id)}</div>`
      )
      .join("")}</div>`;
  } else if (children.length) {
    html += `<div class="child-list">${children
      .map(
        (c) =>
          `<button class="btn" type="button" data-drill="${escapeAttr(c.id)}">${escapeAttr(
            c.silk || c.id
          )} (${escapeAttr(c.ref || c.kind || "")})</button>`
      )
      .join("")}</div>`;
  } else {
    html += `<pre class="muted">${escapeAttr(JSON.stringify(part, null, 2))}</pre>`;
  }
  els.drillContent.innerHTML = html;
  els.drillContent.querySelectorAll("[data-drill]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.drillStack.push(btn.dataset.drill);
      renderDrill();
      renderOverlay();
    });
  });
  els.drillContent.querySelectorAll(".pin-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      selectPart(cell.dataset.id);
      const p = findPart(cell.dataset.id)?.part;
      els.drillContent.insertAdjacentHTML(
        "beforeend",
        `<pre>${escapeAttr(JSON.stringify(p, null, 2))}</pre>`
      );
    });
  });
}

export function synthesizePins(part) {
  const typ = state.types[part.ref || ""] || {};
  const rows = part.rows || typ.rows || 0;
  const cols = part.cols || typ.cols || 0;
  const pins = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pins.push({ id: `${part.id}_r${r}c${c}`, silk: `r${r}c${c}`, kind: "pin" });
    }
  }
  return pins;
}


export function refresh() {
  els.boardName.value = state.board.board || "";
  els.boardSoc.value = state.board.soc || "";
  if (els.underlayRotation) {
    const ur = Number(face().underlay_rotation);
    els.underlayRotation.value = Number.isFinite(ur) ? ur : 0;
  }
  renderTree();
  renderPeripherals();
  renderMeta();
  renderOverlay();
  renderDrill();
  els.previewToggle.textContent = state.previewMode ? "Edit mode" : "Preview";
  updateHistoryButtons();
  updateToolUi();
}


export function addPart(partial) {
  pushHistory();
  const id = uniqueId(partial.id || "part");
  const { children, ...rest } = partial;
  const part = ensurePoint({ ...rest, id });
  if (!part.ref && !part.kind) part.kind = "group";
  if (children?.length) {
    const used = allIds();
    used.add(id);
    part.children = children.map((c, i) => {
      let cid = c.id || `${id}_${i + 1}`;
      if (used.has(cid)) {
        let n = 2;
        while (used.has(`${cid}_${n}`)) n += 1;
        cid = `${cid}_${n}`;
      }
      used.add(cid);
      return ensurePoint({ ...c, id: cid }, part.point);
    });
  }
  face().children.push(part);
  state.selectedId = id;
  state.selectedIds = new Set([id]);
  state.treeOpen[id] = true;
  refresh();
  return part;
}

export function setLibraryOpen(open) {
  state.libraryOpen = !!open;
  if (els.libraryBody) els.libraryBody.hidden = !state.libraryOpen;
  if (els.libraryToggle) {
    els.libraryToggle.classList.toggle("open", state.libraryOpen);
    els.libraryToggle.setAttribute("aria-expanded", state.libraryOpen ? "true" : "false");
    els.libraryToggle.innerHTML = state.libraryOpen
      ? `<span class="library-toggle-plus">−</span> New part`
      : `<span class="library-toggle-plus">+</span> New part`;
  }
}

export function renderSymLegend() {
  if (!els.symLegend) return;
  const order = ["group", "io", "gnd", "power", "led", "button", "switch", "sensor", "port", "nc"];
  els.symLegend.innerHTML = order
    .map((key) => {
      const meta = PART_SYMBOLS[key];
      return `<span class="sym-legend-item" title="${escapeAttr(meta.title)}">${partSymBadge(key)}<span>${escapeAttr(
        meta.title
      )}</span></span>`;
    })
    .join("");
}

export function renderLibrary() {
  if (!els.libraryList) return;
  let html = "";
  for (const item of libraryParts()) {
    const active = state.libraryPick?.sourceKey === item.key ? "active" : "";
    const groupBtn = item.group
      ? `<button type="button" class="library-group" data-lib-group="${escapeAttr(
          item.key
        )}" title="Add ${escapeAttr(item.label)} group">Group</button>`
      : "";
    html += `
      <div class="library-row ${active}">
        <button type="button" class="library-main" data-lib-add="${escapeAttr(item.key)}" title="Add ${escapeAttr(
          item.label
        )}">${partSymBadge(item.sym || "io")}<span>${escapeAttr(item.label)}</span></button>
        ${groupBtn}
      </div>`;
  }
  els.libraryList.innerHTML = html;
  els.libraryList.querySelectorAll("[data-lib-add]").forEach((btn) => {
    btn.addEventListener("click", () => addSingleFromLibrary(btn.dataset.libAdd));
  });
  els.libraryList.querySelectorAll("[data-lib-group]").forEach((btn) => {
    btn.addEventListener("click", () => openGroupFromLibrary(btn.dataset.libGroup));
  });
}

export function addSingleFromLibrary(key) {
  const item = libraryPartByKey(key);
  if (!item) return;
  closeGridPicker();
  const typ = state.types[item.ref] || {};
  if (item.fixedGroup || (typ.kind === "pin_array" && typ.rows && typ.cols && !item.group)) {
    const rows = clampGrid(typ.rows);
    const cols = clampGrid(typ.cols);
    const groupItem = {
      label: item.label,
      ref: item.ref,
      silk: item.silk || item.label,
      childKind: "pin",
      childSilk: "{n}",
      sourceKey: item.key,
    };
    addPart({
      ref: item.ref,
      silk: item.silk || item.label,
      kind: typ.kind || "pin_array",
      rows,
      cols,
      children: buildGridChildren(groupItem, rows, cols),
      point: [...CENTER_POINT],
    });
    return;
  }
  const partial = {
    ref: item.ref,
    silk: item.silk || item.label,
    kind: typ.kind || "pin",
  };
  if (item.notes) partial.notes = item.notes;
  addPart(partial);
}

export function openGroupFromLibrary(key) {
  const item = libraryPartByKey(key);
  if (!item?.group) return;
  openGridPicker({ ...item.group, sourceKey: item.key });
}

export function closeGridPicker() {
  state.libraryPick = null;
  state.gridExtent = GRID_EXTENT_START;
  if (els.gridPicker) els.gridPicker.hidden = true;
  renderLibrary();
}

export function openGridPicker(item) {
  state.libraryPick = item;
  state.gridExtent = GRID_EXTENT_START;
  state.gridRows = 1;
  state.gridCols = 1;
  if (els.gridPicker) els.gridPicker.hidden = false;
  if (els.gridPickerTitle) els.gridPickerTitle.textContent = `${item.label || "Group"} size`;
  if (els.gridRows) els.gridRows.value = "1";
  if (els.gridCols) els.gridCols.value = "1";
  renderLibrary();
  renderGridMatrix();
  updateGridSizeLabel();
}

export function clampGrid(n) {
  return Math.min(40, Math.max(1, Number(n) || 1));
}

export function maybeGrowExtent(rows, cols) {
  let extent = state.gridExtent;
  let grown = false;
  while (extent < GRID_EXTENT_CAP && (rows >= extent - 1 || cols >= extent - 1)) {
    extent = Math.min(GRID_EXTENT_CAP, extent + 2);
    grown = true;
  }
  if (grown) state.gridExtent = extent;
  return grown;
}

export function setGridSize(rows, cols, { syncInputs = true, rebuild = true } = {}) {
  state.gridRows = clampGrid(rows);
  state.gridCols = clampGrid(cols);
  const grown = maybeGrowExtent(state.gridRows, state.gridCols);
  if (syncInputs) {
    if (els.gridRows) els.gridRows.value = String(state.gridRows);
    if (els.gridCols) els.gridCols.value = String(state.gridCols);
  }
  updateGridSizeLabel();
  if (rebuild || grown) renderGridMatrix();
  else paintGridMatrix();
}

export function updateGridSizeLabel() {
  if (els.gridSizeLabel) {
    els.gridSizeLabel.textContent = `${state.gridRows} × ${state.gridCols}`;
  }
}

export function paintGridMatrix() {
  const host = els.gridPickerMatrix;
  if (!host) return;
  host.querySelectorAll(".grid-cell").forEach((cell) => {
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    cell.classList.toggle("on", r <= state.gridRows && c <= state.gridCols);
  });
}

export function renderGridMatrix() {
  const host = els.gridPickerMatrix;
  if (!host) return;
  const extent = state.gridExtent;
  host.style.gridTemplateColumns = `repeat(${extent}, 1fr)`;
  const cells = [];
  for (let r = 1; r <= extent; r++) {
    for (let c = 1; c <= extent; c++) {
      const on = r <= state.gridRows && c <= state.gridCols ? "on" : "";
      cells.push(
        `<button type="button" class="grid-cell ${on}" data-r="${r}" data-c="${c}" aria-label="${r} by ${c}"></button>`
      );
    }
  }
  host.innerHTML = cells.join("");
  host.querySelectorAll(".grid-cell").forEach((cell) => {
    const r = Number(cell.dataset.r);
    const c = Number(cell.dataset.c);
    cell.addEventListener("mouseenter", () => setGridSize(r, c, { rebuild: false }));
    cell.addEventListener("click", () => {
      setGridSize(r, c);
      confirmGridPicker();
    });
  });
}

export function buildGridChildren(item, rows, cols) {
  const children = [];
  const spacingX = Math.min(0.06, 0.35 / Math.max(cols, 1));
  const spacingY = Math.min(0.06, 0.35 / Math.max(rows, 1));
  const originX = 0.5 - ((cols - 1) * spacingX) / 2;
  const originY = 0.5 - ((rows - 1) * spacingY) / 2;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const silk = formatChildSilk(item.childSilk || item.childLabel, i, r, c);
      const child = {
        id: `c${i + 1}`,
        kind: item.childKind || "pin",
        silk,
        point: [
          Number((originX + c * spacingX).toFixed(4)),
          Number((originY + r * spacingY).toFixed(4)),
        ],
      };
      if (item.childRef) child.ref = item.childRef;
      if (item.childNotes) child.notes = item.childNotes;
      children.push(child);
      i += 1;
    }
  }
  return children;
}

export function confirmGridPicker() {
  const item = state.libraryPick;
  if (!item) return;
  const rows = clampGrid(state.gridRows);
  const cols = clampGrid(state.gridCols);
  const typ = state.types[item.ref] || {};
  const children = buildGridChildren(item, rows, cols);
  addPart({
    ref: item.ref === "group" ? undefined : item.ref,
    silk: item.silk || item.label,
    kind: typ.kind || "group",
    rows,
    cols,
    children,
    point: [...CENTER_POINT],
  });
  closeGridPicker();
}

export function deleteSelected() {
  const ids = state.selectedIds.size ? [...state.selectedIds] : state.selectedId ? [state.selectedId] : [];
  if (!ids.length) return;
  pushHistory();
  for (const id of ids) detachPart(id);
  state.selectedId = null;
  state.selectedIds = new Set();
  refresh();
}

export function scrubMuxForExport(parts) {
  for (const part of parts || []) {
    if (Array.isArray(part.mux)) {
      part.mux = part.mux
        .map((m) => {
          if (!m || !String(m.function || "").trim()) return null;
          const out = { function: String(m.function).trim() };
          if (m.peripheral) out.peripheral = String(m.peripheral).trim();
          if (m.signal) out.signal = String(m.signal).trim();
          if (m.mode !== undefined && m.mode !== null && m.mode !== "") out.mode = m.mode;
          return out;
        })
        .filter(Boolean);
      if (!part.mux.length) delete part.mux;
    }
    scrubMuxForExport(part.children);
  }
}


export function exportYaml() {
  const doc = structuredClone(state.board);
  for (const face of Object.values(doc.faces || {})) {
    scrubMuxForExport(face.children);
  }
  const text = yaml.dump(doc, { lineWidth: 100, noRefs: true });
  const blob = new Blob([text], { type: "text/yaml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pinout.yaml";
  a.click();
}

export function importYamlText(text, { recordHistory = true } = {}) {
  const doc = yaml.load(text);
  if (!doc?.faces?.top) throw new Error("Invalid board document");
  if (recordHistory) pushHistory();
  state.board = doc;
  level0Parts().forEach((p) => ensurePoint(p));
  state.selectedId = null;
  state.selectedIds = new Set();
  state.drillStack = [];
  applyUnderlayFromBoard();
  refresh();
}

export function isUsableUnderlaySrc(src) {
  return !!(src && /^(blob:|data:|https?:|\/)/i.test(src));
}

/**
 * Resolve underlay for the canvas.
 * Never assign a bare filename (e.g. board.webp) — the browser 404s and the
 * <img> paints white, which also used to block box-select.
 */
export function applyUnderlayFromBoard() {
  const name = (face().underlay || "").trim();

  els.underlayImg.onerror = () => {
    if (state.underlayObjectUrl) {
      els.underlayImg.onerror = null;
      els.underlayImg.src = state.underlayObjectUrl;
      setHasUnderlay(true);
      return;
    }
    setPlaceholderUnderlay();
  };
  els.underlayImg.onload = () => {
    setHasUnderlay(true);
    renderOverlay();
  };

  if (isUsableUnderlaySrc(name)) {
    if (els.underlayImg.getAttribute("src") !== name) {
      els.underlayImg.src = name;
    }
    return;
  }

  if (state.underlayObjectUrl) {
    if (els.underlayImg.src !== state.underlayObjectUrl) {
      els.underlayImg.src = state.underlayObjectUrl;
    }
    setHasUnderlay(true);
    return;
  }

  // Empty or bare filename with no session blob — dark placeholder, never white 404
  setPlaceholderUnderlay();
}

export function setTool(tool) {
  state.tool = tool === "hand" ? "hand" : "select";
  updateToolUi();
}

export function updateToolUi() {
  els.toolSelectBtn?.classList.toggle("active", state.tool === "select");
  els.toolHandBtn?.classList.toggle("active", state.tool === "hand");
  updateCanvasCursor();
}

export function updateCanvasCursor() {
  const panningTool = state.tool === "hand" || state.spacePan;
  els.canvasStage.classList.toggle("tool-hand", panningTool && state.hasUnderlay);
  els.canvasStage.classList.toggle("can-pan", panningTool && state.hasUnderlay);
  if (state.placingLeaderVertexFor) return;
  if (!state.hasUnderlay) {
    els.canvasStage.title = "Click canvas to upload an underlay image";
    return;
  }
  els.canvasStage.title = panningTool
    ? "Hand: drag to pan · V for select · scroll zoom"
    : "Select: box-select · drag markers to move · Shift=H/V lock · Space/H pan · scroll zoom";
}

export function setHasUnderlay(yes) {
  state.hasUnderlay = !!yes;
  els.canvasStage.classList.toggle("needs-underlay", !state.hasUnderlay);
  updateCanvasCursor();
}

function modLabel() {
  return /Mac|iPhone|iPad/.test(navigator.platform || "") ||
    (navigator.userAgentData?.platform || "").includes("mac")
    ? "⌘"
    : "Ctrl";
}

function shortcutSections(mod) {
  return [
    {
      title: "Tools & view",
      rows: [
        ["V", "Select tool"],
        ["H", "Hand (pan) tool"],
        ["Space (hold)", "Temporary pan"],
        ["Scroll", "Zoom toward cursor"],
        ["Middle-drag", "Pan canvas"],
        [`${mod}+0`, "Reset pan / zoom / rotation"],
        ["F", "Focus selection on canvas"],
        [`${mod}+P`, "Toggle preview mode"],
      ],
    },
    {
      title: "Edit",
      rows: [
        [`${mod}+Z`, "Undo"],
        [`${mod}+⇧Z / ${mod}+Y`, "Redo"],
        [`${mod}+N`, "Add empty group"],
        [`${mod}+G`, "Group selection"],
        [`${mod}+D`, "Duplicate selection"],
        ["⌫ / Delete", "Delete selection"],
        ["Esc", "Cancel place / close menus"],
        ["?", "Open this cheat sheet"],
      ],
    },
    {
      title: "Selection & move",
      rows: [
        ["Drag empty", "Box-select"],
        [`${mod}+click / ${mod}+box`, "Add to selection"],
        ["⇧+click (tree)", "Range-select in tree"],
        ["Arrow keys", "Nudge 0.01"],
        ["⇧+Arrows", "Nudge 0.02"],
        ["[ / ]", "Pack / spread multi-selection"],
        ["⌥/Alt+scroll", "Pack / spread multi-selection"],
        ["⇧+drag marker", "Lock move to H or V"],
      ],
    },
    {
      title: "Canvas & snap",
      rows: [
        [`${mod}+;`, "Toggle grid snap"],
        ["Alt+click", "Place selected part point"],
        ["Double-click label", "Rename part"],
        ["Double-click tree name", "Rename part"],
      ],
    },
  ];
}

function kbdMarkup(combo) {
  const parts = String(combo)
    .split(" / ")
    .map((branch) =>
      branch
        .split("+")
        .map((bit) => `<span>${escapeAttr(bit.trim())}</span>`)
        .join("")
    );
  return parts.join('<span class="cheat-or">/</span>');
}

export function renderCheatSheet() {
  if (!els.cheatSheetBody) return;
  const mod = modLabel();
  els.cheatSheetBody.innerHTML = shortcutSections(mod)
    .map(
      (sec) => `
    <section class="cheat-section">
      <h3>${escapeAttr(sec.title)}</h3>
      <div class="cheat-rows">
        ${sec.rows
          .map(
            ([keys, desc]) => `
          <div class="cheat-row">
            <kbd>${kbdMarkup(keys)}</kbd>
            <span class="cheat-desc">${escapeAttr(desc)}</span>
          </div>`
          )
          .join("")}
      </div>
    </section>`
    )
    .join("");
}

export function openCheatSheet() {
  renderCheatSheet();
  if (els.cheatSheet) els.cheatSheet.hidden = false;
}

export function closeCheatSheet() {
  if (els.cheatSheet) els.cheatSheet.hidden = true;
}

export function toggleCheatSheet() {
  if (!els.cheatSheet || els.cheatSheet.hidden) openCheatSheet();
  else closeCheatSheet();
}

export function promptUnderlayUpload() {
  document.getElementById("underlayInput")?.click();
}

export function isTypingTarget(el) {
  return el?.matches?.("input,textarea,select") || el?.isContentEditable;
}


export function setPlaceholderUnderlay() {
  els.underlayImg.onerror = null;
  els.underlayImg.src =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">
        <rect width="100%" height="100%" fill="#1b2735"/>
        <path d="M40 40 H760 V420 H680 V460 H40 Z" fill="#243447" stroke="#5b7c99" stroke-width="3"/>
        <text x="400" y="240" fill="#8b9bb0" font-size="22" text-anchor="middle" font-family="sans-serif">Click to upload underlay</text>
        <text x="400" y="275" fill="#6a7a8e" font-size="14" text-anchor="middle" font-family="sans-serif">or use Underlay in the toolbar · Import pinout.yaml anytime</text>
      </svg>`
    );
  if (!face().underlay || face().underlay === "placeholder.svg") face().underlay = "";
  setHasUnderlay(false);
  els.underlayImg.onload = () => renderOverlay();
}


export function bindUi() {
  els.boardName.addEventListener("change", () => {
    pushHistory();
    state.board.board = els.boardName.value.trim();
  });
  els.boardSoc.addEventListener("change", () => {
    pushHistory();
    state.board.soc = els.boardSoc.value.trim();
  });
  els.underlayRotation?.addEventListener("change", () => {
    pushHistory();
    const v = Number(els.underlayRotation.value);
    if (!Number.isFinite(v) || Math.abs(v) < 1e-6) delete face().underlay_rotation;
    else face().underlay_rotation = normalizeViewRotation(v);
    state.view.rotation = normalizeViewRotation(face().underlay_rotation || 0);
    applyViewTransform();
    refresh();
  });
  els.viewRotCcwBtn?.addEventListener("click", () => rotateView(-90));
  els.viewRotCwBtn?.addEventListener("click", () => rotateView(90));
  els.viewResetBtn?.addEventListener("click", () => resetView());

  document.getElementById("addPartBtn").addEventListener("click", () => {
    addPart({ kind: "group", silk: "New part" });
  });
  els.libraryToggle?.addEventListener("click", () => setLibraryOpen(!state.libraryOpen));
  document.getElementById("gridPickerClose")?.addEventListener("click", closeGridPicker);
  document.getElementById("gridPickerAdd")?.addEventListener("click", confirmGridPicker);
  els.gridRows?.addEventListener("input", () => {
    setGridSize(els.gridRows.value, state.gridCols, { syncInputs: false });
  });
  els.gridCols?.addEventListener("input", () => {
    setGridSize(state.gridRows, els.gridCols.value, { syncInputs: false });
  });
  document.getElementById("deletePartBtn").addEventListener("click", deleteSelected);
  document.getElementById("groupSelectedBtn").addEventListener("click", groupSelected);
  document.getElementById("exportBtn").addEventListener("click", exportYaml);
  document.getElementById("loadEsp32SampleBtn")?.addEventListener("click", async () => {
    try {
      await loadEsp32Sample();
    } catch (err) {
      alert(String(err));
    }
  });
  els.undoBtn?.addEventListener("click", undo);
  els.redoBtn?.addEventListener("click", redo);

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#ctxMenu")) hideContextMenu();
  });

  els.cheatSheetBtn?.addEventListener("click", () => openCheatSheet());
  els.cheatSheet?.querySelectorAll("[data-cheat-close]").forEach((el) => {
    el.addEventListener("click", () => closeCheatSheet());
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (els.cheatSheet && !els.cheatSheet.hidden) {
        closeCheatSheet();
        return;
      }
      hideContextMenu();
      if (state.libraryPick) closeGridPicker();
      if (state.placingLeaderVertexFor) cancelPlaceLeaderVertex();
    }
    const typing = isTypingTarget(e.target);
    const mod = e.metaKey || e.ctrlKey;

    if (!typing && !mod && (e.key === "?" || (e.key === "/" && e.shiftKey))) {
      e.preventDefault();
      toggleCheatSheet();
      return;
    }

    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      if (typing) return;
      e.preventDefault();
      undo();
      return;
    }
    if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      if (typing) return;
      e.preventDefault();
      redo();
      return;
    }
    if (mod && e.key.toLowerCase() === "g") {
      if (typing) return;
      e.preventDefault();
      groupSelected();
      return;
    }
    if (mod && e.key.toLowerCase() === "n") {
      if (typing) return;
      e.preventDefault();
      addPart({ kind: "group", silk: "New part" });
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      if (typing) return;
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if (mod && e.key === "0") {
      if (typing) return;
      e.preventDefault();
      resetView();
      return;
    }
    if (!typing && !mod && (e.key === "f" || e.key === "F") && (state.selectedId || state.selectedIds.size)) {
      e.preventDefault();
      focusOnSelection();
      return;
    }
    if (mod && e.key === ";") {
      if (typing) return;
      e.preventDefault();
      state.snap = !state.snap;
      updateSnapToggle();
      return;
    }
    if (mod && e.key.toLowerCase() === "p") {
      if (typing) return;
      e.preventDefault();
      state.previewMode = !state.previewMode;
      state.drillStack = [];
      refresh();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
      e.preventDefault();
      deleteSelected();
      return;
    }
    if (!typing && state.selectedIds.size >= 1 && !mod) {
      const step = e.shiftKey ? 0.02 : 0.01;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        nudgeSelection(-step, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nudgeSelection(step, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nudgeSelection(0, -step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nudgeSelection(0, step);
      } else if (e.key === "[" && state.selectedIds.size >= 2) {
        e.preventDefault();
        scaleSelection(0.9);
      } else if (e.key === "]" && state.selectedIds.size >= 2) {
        e.preventDefault();
        scaleSelection(1.1);
      }
    }
  });

  els.previewToggle.addEventListener("click", () => {
    state.previewMode = !state.previewMode;
    state.drillStack = [];
    refresh();
  });
  els.snapToggle?.addEventListener("click", () => {
    state.snap = !state.snap;
    updateSnapToggle();
  });
  els.snapObjectsToggle?.addEventListener("click", () => {
    state.snapObjects = !state.snapObjects;
    updateSnapToggle();
  });
  els.snapStep?.addEventListener("change", () => {
    const next = Number(els.snapStep.value);
    if (!Number.isFinite(next) || next <= 0) return;
    state.snapStep = next;
    if (!state.snap) state.snap = true;
    updateSnapToggle();
  });

  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    refresh();
  });

  document.getElementById("underlayInput").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    pushHistory();
    if (state.underlayObjectUrl) URL.revokeObjectURL(state.underlayObjectUrl);
    state.underlayObjectUrl = URL.createObjectURL(file);
    state.underlayFileName = file.name;
    face().underlay = file.name;
    els.underlayImg.onerror = () => setPlaceholderUnderlay();
    els.underlayImg.onload = () => {
      setHasUnderlay(true);
      renderOverlay();
    };
    els.underlayImg.src = state.underlayObjectUrl;
    setHasUnderlay(true);
  });

  els.toolSelectBtn?.addEventListener("click", () => setTool("select"));
  els.toolHandBtn?.addEventListener("click", () => setTool("hand"));

  document.getElementById("importInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      importYamlText(text);
    } catch (err) {
      alert(String(err));
    }
  });

  // Grabbing the canvas mid-glide hands control straight back to the user.
  els.canvasStage.addEventListener("pointerdown", () => stopViewTween(), true);

  // Scroll = zoom; ⌥/Alt+scroll = pack/spread when multi-selected
  els.canvasStage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.altKey && scaleSelectionFromWheel(e.deltaY)) return;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      zoomAtClient(e.clientX, e.clientY, factor);
    },
    { passive: false }
  );

  function beginCanvasPan(e) {
    e.preventDefault();
    stopViewTween();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = state.view.x;
    const origY = state.view.y;
    els.canvasStage.classList.add("panning");
    const move = (ev) => {
      state.view.x = origX + (ev.clientX - startX);
      state.view.y = origY + (ev.clientY - startY);
      applyViewTransform();
    };
    const up = () => {
      els.canvasStage.classList.remove("panning");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Middle-mouse pan always
  els.canvasStage.addEventListener("pointerdown", (e) => {
    if (e.button !== 1) return;
    beginCanvasPan(e);
  });
  els.canvasStage.addEventListener("auxclick", (e) => {
    if (e.button === 1) e.preventDefault();
  });

  // Space = temporary hand (draw.io); V/H switch tools
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !isTypingTarget(e.target) && !e.repeat) {
      e.preventDefault();
      state.spacePan = true;
      updateCanvasCursor();
    }
    if (isTypingTarget(e.target)) return;
    if (e.key.toLowerCase() === "v" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setTool("select");
    } else if (e.key.toLowerCase() === "h" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setTool("hand");
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      state.spacePan = false;
      updateCanvasCursor();
    }
  });

  els.canvasStage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".marker-hit")) return;
    if (state.previewMode) return;
    if (e.altKey) return; // place on click via pointerup path below
    if (state.placingLeaderVertexFor) return; // click handler places vertex

    // draw.io: Hand / Space → pan; Select → box-select (even if underlay failed)
    if (state.spacePan || state.tool === "hand") {
      state.skipNextCanvasClick = true;
      beginCanvasPan(e);
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    state.marquee = { startX, startY, moved: false, additive: e.metaKey || e.ctrlKey };
    els.canvasStage.setPointerCapture?.(e.pointerId);

    const onMove = (ev) => {
      if (!state.marquee) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.hypot(dx, dy) > 4) state.marquee.moved = true;
      if (state.marquee.moved) updateMarqueeEl(startX, startY, ev.clientX, ev.clientY);
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const mq = state.marquee;
      if (!mq) return;

      if (mq.moved) {
        state.skipNextCanvasClick = true;
        const hits = markersInRect(mq.startX, mq.startY, ev.clientX, ev.clientY);
        if (mq.additive) {
          for (const id of hits) state.selectedIds.add(id);
        } else {
          state.selectedIds = new Set(hits);
        }
        state.selectedId = hits[0] || null;
        hideMarquee();
        refresh();
        return;
      }

      hideMarquee();
      // plain click on empty canvas: clear selection (upload handled in click)
      if (state.hasUnderlay && (state.selectedId || state.selectedIds.size)) {
        state.selectedId = null;
        state.selectedIds = new Set();
        refresh();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  els.canvasStage.addEventListener("click", (e) => {
    if (state.skipNextCanvasClick) {
      state.skipNextCanvasClick = false;
      return;
    }
    if (state.draggingId || state.draggingVertex) return;
    if (e.target.closest(".marker-hit")) return;

    if (state.placingLeaderVertexFor) {
      addLeaderVertexAtClient(state.placingLeaderVertexFor, e.clientX, e.clientY);
      return;
    }

    if (!state.hasUnderlay && !state.previewMode) {
      promptUnderlayUpload();
      return;
    }

    if (state.previewMode) {
      if (state.drillStack.length || state.selectedId) {
        state.drillStack = [];
        state.selectedId = null;
        state.selectedIds = new Set();
        refresh();
      }
      return;
    }

    // Alt+click places the primary selected part's point
    if (e.altKey && state.selectedId) {
      const found = findPart(state.selectedId);
      if (!found) return;
      pushHistory();
      found.part.point = clientToNorm(e.clientX, e.clientY);
      refresh();
    }
  });

  window.addEventListener("resize", () => renderOverlay());
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => renderOverlay());
    ro.observe(els.canvasStage);
  }
}


export async function loadEsp32Sample() {
  const resp = await fetch("/examples/esp32s3_devkitc/pinout.yaml");
  if (!resp.ok) throw new Error(`Failed to load sample (${resp.status})`);
  const text = await resp.text();
  importYamlText(text);
  if (state.underlayObjectUrl) {
    URL.revokeObjectURL(state.underlayObjectUrl);
    state.underlayObjectUrl = null;
    state.underlayFileName = null;
  }
  face().underlay = "/examples/esp32s3_devkitc/esp32s3_devkitc.webp";
  applyUnderlayFromBoard();
  refresh();
}
