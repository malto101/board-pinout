import { state, els } from "./state.js";
import { findPart, ensurePoint } from "./model.js";
import {
  imageBox as stageImageBox,
  tweenView,
} from "../../src/board_pinout/static/board_pinout/js/view.js";

export function snapValue(v) {
  if (!state.snap) return Number(Number(v).toFixed(4));
  const s = state.snapStep || 0.025;
  return Number((Math.round(Number(v) / s) * s).toFixed(4));
}

export function updateSnapToggle() {
  if (els.snapToggle) {
    els.snapToggle.classList.toggle("active", !!state.snap);
    els.snapToggle.setAttribute("aria-pressed", state.snap ? "true" : "false");
    els.snapToggle.title = state.snap
      ? `Grid snap on (${state.snapStep}) — click or ⌘; to turn off`
      : "Grid snap off — click or ⌘; to turn on";
  }
  if (els.snapObjectsToggle) {
    els.snapObjectsToggle.classList.toggle("active", !!state.snapObjects);
    els.snapObjectsToggle.setAttribute("aria-pressed", state.snapObjects ? "true" : "false");
    els.snapObjectsToggle.title = state.snapObjects
      ? "Snap to other points & labels — click to turn off"
      : "Snap to objects off — click to turn on";
  }
  if (els.snapStep) {
    const step = String(state.snapStep);
    if (![...els.snapStep.options].some((o) => o.value === step)) {
      const opt = document.createElement("option");
      opt.value = step;
      opt.textContent = step;
      els.snapStep.appendChild(opt);
    }
    els.snapStep.value = step;
    els.snapStep.disabled = !state.snap;
  }
  document.querySelector(".snap-cluster")?.classList.toggle("snap-on", !!(state.snap || state.snapObjects));
}

export function normalizeViewRotation(deg) {
  const d = Number(deg) || 0;
  return ((((Math.round(d / 90) % 4) + 4) % 4) * 90);
}

let cancelTween = null;

/** Stop an in-flight focus animation (call before any manual pan/zoom). */
export function stopViewTween() {
  if (cancelTween) cancelTween();
  cancelTween = null;
}

export function applyViewTransform() {
  if (!els.canvasWorld) return;
  const { zoom, x, y } = state.view;
  state.view.rotation = normalizeViewRotation(state.view.rotation);
  els.canvasWorld.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  if (els.canvasRotator) {
    els.canvasRotator.style.transform = state.view.rotation
      ? `rotate(${state.view.rotation}deg)`
      : "";
  }
}

/** Pan/zoom so normalized board point sits at stage center. */
export function focusOnNorm(nx, ny, { minZoom = 1.5 } = {}) {
  const box = imageBox();
  const wx = box.left + Number(nx) * box.width;
  const wy = box.top + Number(ny) * box.height;
  const sw = els.canvasStage.clientWidth || 1;
  const sh = els.canvasStage.clientHeight || 1;
  const zoom = Math.min(8, Math.max(state.view.zoom, minZoom));
  const { x, y } = state.view;
  stopViewTween();
  cancelTween = tweenView(
    { tx: x, ty: y, scale: state.view.zoom },
    { tx: sw / 2 - wx * zoom, ty: sh / 2 - wy * zoom, scale: zoom },
    sw,
    sh,
    (v) => {
      state.view.zoom = v.scale;
      state.view.x = v.tx;
      state.view.y = v.ty;
      applyViewTransform();
    },
    { done: () => (cancelTween = null) }
  );
}

/** Focus canvas on current selection (average of selected points). */
export function focusOnSelection() {
  const ids = state.selectedIds.size
    ? [...state.selectedIds]
    : state.selectedId
      ? [state.selectedId]
      : [];
  const pts = [];
  for (const id of ids) {
    const found = findPart(id);
    if (!found) continue;
    ensurePoint(found.part);
    pts.push(found.part.point);
  }
  if (!pts.length) return;
  const nx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const ny = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  focusOnNorm(nx, ny);
}

export function zoomAtClient(clientX, clientY, factor) {
  const stage = els.canvasStage.getBoundingClientRect();
  const sx = clientX - stage.left;
  const sy = clientY - stage.top;
  const prev = state.view.zoom;
  const next = Math.min(8, Math.max(0.25, Number((prev * factor).toFixed(4))));
  if (next === prev) return;
  stopViewTween();
  const wx = (sx - state.view.x) / prev;
  const wy = (sy - state.view.y) / prev;
  state.view.zoom = next;
  state.view.x = sx - wx * next;
  state.view.y = sy - wy * next;
  applyViewTransform();
}

export function clientToWorld(clientX, clientY) {
  const stage = els.canvasStage.getBoundingClientRect();
  const sx = clientX - stage.left;
  const sy = clientY - stage.top;
  const { zoom, x, y } = state.view;
  return [(sx - x) / zoom, (sy - y) / zoom];
}

export function imageBox() {
  return stageImageBox(els.canvasStage, els.underlayImg);
}

export function clientToNorm(clientX, clientY, { snap = true } = {}) {
  const [wx, wy] = clientToWorld(clientX, clientY);
  const box = imageBox();
  let x = (wx - box.left) / box.width;
  let y = (wy - box.top) / box.height;
  if (snap) {
    x = snapValue(x);
    y = snapValue(y);
  } else {
    x = Number(x.toFixed(4));
    y = Number(y.toFixed(4));
  }
  return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
}
