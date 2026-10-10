import { state, els, pushHistory } from "./state.js";
import {
  findPart,
  visibleMarkers,
  partHasPeripheral,
  partMuxEntries,
} from "./model.js";
import { markerSymbolMarkup, resolvePartVisual } from "./symbols.js";
import {
  computeAutoLabelOffsets,
  labelOffset,
  bakeLabelOffset,
  layoutLabelBox,
  estimateLabelWidth,
  screenReadableLabelRot,
} from "./labels.js";
import {
  imageBox,
  clientToNorm,
  clientToWorld,
} from "./view.js";
import { escapeAttr } from "./util.js";
import {
  beginCanvasRename,
  toggleMultiSelect,
  selectMarkerRange,
  renderTree,
} from "./tree.js";
import {
  refresh,
  renderMeta,
  selectPart,
  showContextMenu,
  setHasUnderlay,
} from "./ui.js";

/**
 * Norm-space X/Y targets from points, labels, and leader vertices.
 * excludePointIds — skip those nodes (still include their labels unless skipped)
 * skipLabelIds — skip those parts' label tips (e.g. the label being dragged)
 */
export function collectAlignTargets(excludePointIds = new Set(), skipLabelIds = new Set()) {
  const xs = [];
  const ys = [];
  const box = imageBox();
  const markers = visibleMarkers();
  markers.forEach((p, idx) => {
    if (!p.point) return;
    if (!excludePointIds.has(p.id)) {
      xs.push(p.point[0]);
      ys.push(p.point[1]);
    }
    if (!skipLabelIds.has(p.id)) {
      const off = labelOffset(idx, markers.length, p, box);
      xs.push(p.point[0] + off.dx / Math.max(box.width, 1));
      ys.push(p.point[1] + off.dy / Math.max(box.height, 1));
    }
    for (const v of p.leader_vertices || []) {
      if (Array.isArray(v) && v.length >= 2) {
        xs.push(v[0]);
        ys.push(v[1]);
      }
    }
  });
  return { xs, ys };
}

export function nearestAlign(value, candidates, thresh) {
  let best = null;
  let bestDist = thresh;
  for (const c of candidates) {
    const d = Math.abs(c - value);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * Axis lock (Shift) + object align + optional grid.
 * Returns clamped norm coords and guide lines (norm) for overlay.
 */
export function resolveDragNorm(
  x,
  y,
  {
    startX,
    startY,
    shiftKey = false,
    excludePointIds = new Set(),
    skipLabelIds = new Set(),
  } = {}
) {
  let nx = x;
  let ny = y;
  // "h" = horizontal move (Y locked); "v" = vertical move (X locked)
  let axisLock = null;
  if (shiftKey && startX != null && startY != null) {
    if (Math.abs(nx - startX) >= Math.abs(ny - startY)) {
      axisLock = "h";
      ny = startY;
    } else {
      axisLock = "v";
      nx = startX;
    }
  }

  let guideX = null;
  let guideY = null;
  if (state.snapObjects) {
    const box = imageBox();
    const px = 8 / Math.max(state.view.zoom || 1, 0.01);
    const tx = px / Math.max(box.width, 1);
    const ty = px / Math.max(box.height, 1);
    const { xs, ys } = collectAlignTargets(excludePointIds, skipLabelIds);
    if (axisLock !== "v") {
      const ax = nearestAlign(nx, xs, tx);
      if (ax != null) {
        nx = ax;
        guideX = ax;
      }
    }
    if (axisLock !== "h") {
      const ay = nearestAlign(ny, ys, ty);
      if (ay != null) {
        ny = ay;
        guideY = ay;
      }
    }
  }

  // Keep axis lock after align (guides on locked axis show the rail)
  if (axisLock === "h") {
    ny = startY;
    guideY = startY;
  } else if (axisLock === "v") {
    nx = startX;
    guideX = startX;
  }

  if (state.snap) {
    // Grid-snap free axes only; object-aligned or axis-locked coords stay put
    if (axisLock !== "v" && guideX == null) nx = snapValue(nx);
    else nx = Number(nx.toFixed(4));
    if (axisLock !== "h" && guideY == null) ny = snapValue(ny);
    else ny = Number(ny.toFixed(4));
  } else {
    nx = Number(nx.toFixed(4));
    ny = Number(ny.toFixed(4));
  }

  nx = Math.min(1, Math.max(0, nx));
  ny = Math.min(1, Math.max(0, ny));
  return { x: nx, y: ny, guideX, guideY };
}

export function setAlignGuides(guideX, guideY) {
  if (guideX == null && guideY == null) {
    state.alignGuides = null;
    return;
  }
  state.alignGuides = { x: guideX, y: guideY };
}

export function clearAlignGuides() {
  state.alignGuides = null;
}

export function alignGuidesMarkup(box) {
  if (!state.alignGuides) return "";
  const { x, y } = state.alignGuides;
  const parts = [];
  if (x != null) {
    const px = box.left + x * box.width;
    parts.push(
      `<line class="align-guide" x1="${px}" y1="${box.top}" x2="${px}" y2="${box.top + box.height}" />`
    );
  }
  if (y != null) {
    const py = box.top + y * box.height;
    parts.push(
      `<line class="align-guide" x1="${box.left}" y1="${py}" x2="${box.left + box.width}" y2="${py}" />`
    );
  }
  return parts.join("");
}


export function leaderVerticesPx(part, box) {
  const verts = Array.isArray(part.leader_vertices) ? part.leader_vertices : [];
  return verts
    .filter((v) => Array.isArray(v) && v.length >= 2)
    .map((v) => [box.left + v[0] * box.width, box.top + v[1] * box.height]);
}

export function leaderPolylineMarkup(cx, cy, tipX, tipY, verticesPx, stroke, width) {
  const pts = [[cx, cy], ...verticesPx, [tipX, tipY]];
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ");
  return `<path class="marker-leader" d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="0.95" stroke-linejoin="round" stroke-linecap="round" />`;
}

export function beginPlaceLeaderVertex(id) {
  const found = findPart(id);
  if (!found?.part.point) return;
  bakeLabelOffset(found.part, 0, 1, imageBox());
  state.placingLeaderVertexFor = id;
  state.selectedId = id;
  state.selectedIds = new Set([id]);
  els.canvasStage.classList.add("placing-vertex");
  els.canvasStage.title = "Click to place a leader vertex · Esc to cancel";
  refresh();
}

export function cancelPlaceLeaderVertex() {
  state.placingLeaderVertexFor = null;
  els.canvasStage.classList.remove("placing-vertex");
  setHasUnderlay(state.hasUnderlay);
}

export function addLeaderVertexAtClient(id, clientX, clientY) {
  const found = findPart(id);
  if (!found?.part.point) return;
  pushHistory();
  const [nx, ny] = clientToNorm(clientX, clientY);
  found.part.leader_vertices = found.part.leader_vertices || [];
  found.part.leader_vertices.push([nx, ny]);
  cancelPlaceLeaderVertex();
  refresh();
}

export function clearLeaderVertices(id) {
  const part = findPart(id)?.part;
  if (!part?.leader_vertices?.length) return;
  pushHistory();
  delete part.leader_vertices;
  refresh();
}

export function onLeaderVertexDragStart(e, id, vertexIndex) {
  if (state.previewMode || state.renaming) return;
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  state.selectedId = id;
  state.selectedIds = new Set([id]);
  state.draggingVertex = { id, index: vertexIndex };
  let historyPushed = false;
  const startVert = findPart(id)?.part?.leader_vertices?.[vertexIndex];
  const startX = startVert?.[0];
  const startY = startVert?.[1];
  const move = (ev) => {
    const found = findPart(id);
    if (!found?.part.leader_vertices?.[vertexIndex]) return;
    if (!historyPushed) {
      pushHistory();
      historyPushed = true;
    }
    const [rx, ry] = clientToNorm(ev.clientX, ev.clientY, { snap: false });
    const resolved = resolveDragNorm(rx, ry, {
      startX,
      startY,
      shiftKey: ev.shiftKey,
      excludePointIds: new Set(),
      skipLabelIds: new Set(),
    });
    found.part.leader_vertices[vertexIndex] = [resolved.x, resolved.y];
    setAlignGuides(resolved.guideX, resolved.guideY);
    renderOverlay();
  };
  const up = () => {
    state.draggingVertex = null;
    clearAlignGuides();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (historyPushed) refresh();
    else renderOverlay();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

export function syncOverlaySize() {
  const stage = els.canvasStage;
  const w = Math.max(1, Math.round(stage.clientWidth));
  const h = Math.max(1, Math.round(stage.clientHeight));
  els.overlay.setAttribute("width", String(w));
  els.overlay.setAttribute("height", String(h));
  els.overlay.setAttribute("viewBox", `0 0 ${w} ${h}`);
  els.overlay.style.width = "100%";
  els.overlay.style.height = "100%";
}


export function renderOverlay() {
  syncOverlaySize();
  const box = imageBox();
  const markers = visibleMarkers();
  const autoOffs = computeAutoLabelOffsets(markers, box);
  const parts = markers
    .map((p, idx) => {
      const [nx, ny] = p.point;
      const cx = box.left + nx * box.width;
      const cy = box.top + ny * box.height;
      const off = labelOffset(idx, markers.length, p, box, autoOffs);
      const primary = p.id === state.selectedId;
      const inMulti = state.selectedIds.has(p.id);
      const muxHit = state.peripheralFilter && partHasPeripheral(p, state.peripheralFilter);
      const dimmed = state.peripheralFilter && !partHasPeripheral(p, state.peripheralFilter);
      const active = primary || inMulti || !!muxHit;
      const visual = resolvePartVisual(p);
      const label = p.silk || p.id;
      const tw = estimateLabelWidth(p);
      const th = 16;
      const lay = layoutLabelBox(cx, cy, off, tw, th);
      const ring = primary
        ? "#2dd4bf"
        : muxHit
          ? "#2dd4bf"
          : inMulti
            ? "#4c8dff"
            : "rgba(255,255,255,0.12)";
      const labelFill = active ? "rgba(12,14,19,0.95)" : "rgba(12,14,19,0.88)";
      const line = active ? (primary || muxHit ? "#2dd4bf" : "#4c8dff") : "var(--line)";
      const vertsPx = leaderVerticesPx(p, box);
      const vertexHandles =
        active && !state.previewMode && !dimmed
          ? vertsPx
              .map(
                (v, vi) => `
            <g class="leader-vertex" data-vertex="${vi}">
              <circle cx="${v[0]}" cy="${v[1]}" r="5.5" fill="#10131a" stroke="${line}" stroke-width="1.6"/>
              <circle cx="${v[0]}" cy="${v[1]}" r="2.2" fill="${line}"/>
            </g>`
              )
              .join("")
          : "";
      const muxSig =
        muxHit && state.peripheralFilter
          ? partMuxEntries(p)
              .filter((m) => m.peripheral === state.peripheralFilter)
              .map((m) => m.signal)
              .join(",")
          : "";
      return `
        <g class="marker-hit${active ? " is-selected" : ""}${primary ? " is-primary" : ""}${
          muxHit ? " mux-hit" : ""
        }${dimmed ? " is-dimmed" : ""}" data-id="${p.id}" data-idx="${idx}" data-sym="${visual.key}" data-side="${lay.side}"${
          muxSig ? ` data-mux-sig="${escapeAttr(muxSig)}"` : ""
        } opacity="${dimmed ? "0.18" : "1"}">
          ${leaderPolylineMarkup(cx, cy, lay.tipX, lay.tipY, vertsPx, line, active ? 1.6 : 1)}
          ${markerSymbolMarkup(cx, cy, visual, { active, primary: primary || !!muxHit })}
          ${vertexHandles}
          <g class="marker-label"${(() => {
            let rot = Number(
              p.label_rotation != null && p.label_rotation !== ""
                ? p.label_rotation
                : off.rotation
            );
            if (!Number.isFinite(rot)) rot = 0;
            rot = screenReadableLabelRot(rot, state.view.rotation);
            rot = ((rot % 360) + 360) % 360;
            if (rot > 180) rot -= 360;
            if (Math.abs(rot) < 1e-6) return "";
            const px = lay.rx + tw / 2;
            const py = lay.ry + th / 2;
            return ` transform="rotate(${rot} ${px} ${py})"`;
          })()}>
            <rect x="${lay.rx}" y="${lay.ry}" width="${tw}" height="${th}"
              rx="3" fill="${labelFill}" stroke="${ring}" stroke-width="${active ? 1.5 : 1}" />
            <text x="${lay.textX}" y="${lay.textY}" fill="#f3f6fb" font-size="10"
              font-family="system-ui,sans-serif" font-weight="${active ? 600 : 400}" text-anchor="${lay.anchor}">${escapeAttr(
                label
              )}</text>
          </g>
        </g>`;
    })
    .join("");
  els.overlay.innerHTML = parts + alignGuidesMarkup(box);
  els.overlay.querySelectorAll(".marker-hit").forEach((g) => {
    const id = g.dataset.id;
    const idx = Number(g.dataset.idx);
    g.querySelector(".marker-point")?.addEventListener("pointerdown", (e) =>
      onMarkerDragStart(e, id, "point", idx)
    );
    const labelEl = g.querySelector(".marker-label");
    labelEl?.addEventListener("pointerdown", (e) =>
      onMarkerDragStart(e, id, "label", idx)
    );
    labelEl?.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginCanvasRename(id);
    });
    g.querySelectorAll(".leader-vertex").forEach((vh) => {
      const vi = Number(vh.dataset.vertex);
      vh.addEventListener("pointerdown", (e) => onLeaderVertexDragStart(e, id, vi));
      vh.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const part = findPart(id)?.part;
        if (!part?.leader_vertices?.[vi]) return;
        pushHistory();
        part.leader_vertices.splice(vi, 1);
        if (!part.leader_vertices.length) delete part.leader_vertices;
        refresh();
      });
    });
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.marquee?.moved || state.renaming) return;
      if (state.placingLeaderVertexFor) {
        addLeaderVertexAtClient(state.placingLeaderVertexFor, e.clientX, e.clientY);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        toggleMultiSelect(id);
        state.selectedId = id;
        refresh();
      } else if (e.shiftKey && state.selectedId) {
        selectMarkerRange(state.selectedId, id);
        state.selectedId = id;
        refresh();
      } else {
        state.selectedIds = new Set([id]);
        selectPart(id);
        if (state.previewMode) openDrill(id);
      }
    });
    g.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".leader-vertex")) return;
      e.preventDefault();
      e.stopPropagation();
      if (!state.selectedIds.has(id)) {
        state.selectedIds = new Set([id]);
        state.selectedId = id;
      }
      showContextMenu(e.clientX, e.clientY, id);
      renderTree();
      renderMeta();
      renderOverlay();
    });
  });
}

export function onMarkerDragStart(e, id, kind, idx) {
  if (state.previewMode || state.renaming) return;
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.metaKey || e.ctrlKey) {
    toggleMultiSelect(id);
    state.selectedId = id;
    refresh();
    return;
  }
  if (!state.selectedIds.has(id)) {
    state.selectedIds = new Set([id]);
  }
  state.draggingId = id;
  state.draggingKind = kind;
  selectPart(id);

  const box = imageBox();
  const markers = visibleMarkers();
  const found0 = findPart(id);
  if (kind === "label" && found0) {
    bakeLabelOffset(found0.part, idx, markers.length, box);
  }

  const originX = e.clientX;
  const originY = e.clientY;
  let historyPushed = false;
  const startNorm = clientToNorm(e.clientX, e.clientY, { snap: false });
  const primary = findPart(id)?.part;
  const startPrimary = primary?.point ? [...primary.point] : null;
  const startLabel =
    kind === "label" && primary?.point && primary.label_offset
      ? [primary.point[0] + primary.label_offset[0], primary.point[1] + primary.label_offset[1]]
      : null;
  const excludePointIds = kind === "point" ? new Set(state.selectedIds) : new Set();
  const skipLabelIds = kind === "label" ? new Set([id]) : new Set();
  const multiPoint =
    kind === "point"
      ? [...state.selectedIds]
          .map((sid) => findPart(sid)?.part)
          .filter((p) => p?.point)
          .map((p) => ({ part: p, start: [...p.point] }))
      : null;

  const move = (ev) => {
    if (!historyPushed) {
      if (Math.hypot(ev.clientX - originX, ev.clientY - originY) < 4) return;
      pushHistory();
      historyPushed = true;
    }
    const found = findPart(state.draggingId);
    if (!found?.part.point) return;
    const [rx, ry] = clientToNorm(ev.clientX, ev.clientY, { snap: false });
    if (state.draggingKind === "point") {
      if (multiPoint && multiPoint.length > 1 && startPrimary) {
        // Axis-lock & snap the primary, then apply the same delta to the group
        const rawDx = rx - startNorm[0];
        const rawDy = ry - startNorm[1];
        let tentative = [startPrimary[0] + rawDx, startPrimary[1] + rawDy];
        const resolved = resolveDragNorm(tentative[0], tentative[1], {
          startX: startPrimary[0],
          startY: startPrimary[1],
          shiftKey: ev.shiftKey,
          excludePointIds,
          skipLabelIds,
        });
        const ddx = resolved.x - startPrimary[0];
        const ddy = resolved.y - startPrimary[1];
        for (const item of multiPoint) {
          item.part.point = [
            Math.min(1, Math.max(0, Number((item.start[0] + ddx).toFixed(4)))),
            Math.min(1, Math.max(0, Number((item.start[1] + ddy).toFixed(4)))),
          ];
        }
        setAlignGuides(resolved.guideX, resolved.guideY);
      } else {
        const resolved = resolveDragNorm(rx, ry, {
          startX: startPrimary?.[0],
          startY: startPrimary?.[1],
          shiftKey: ev.shiftKey,
          excludePointIds,
          skipLabelIds,
        });
        found.part.point = [resolved.x, resolved.y];
        setAlignGuides(resolved.guideX, resolved.guideY);
      }
    } else if (state.draggingKind === "label") {
      const [px, py] = found.part.point;
      const resolved = resolveDragNorm(rx, ry, {
        startX: startLabel?.[0] ?? px,
        startY: startLabel?.[1] ?? py,
        shiftKey: ev.shiftKey,
        excludePointIds,
        skipLabelIds,
      });
      found.part.label_offset = [
        Number((resolved.x - px).toFixed(4)),
        Number((resolved.y - py).toFixed(4)),
      ];
      setAlignGuides(resolved.guideX, resolved.guideY);
    }
    renderOverlay();
    renderMeta();
  };
  const up = () => {
    state.draggingId = null;
    state.draggingKind = null;
    clearAlignGuides();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (historyPushed) refresh();
    else renderOverlay();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

export function markersInRect(x0, y0, x1, y1) {
  const [ax, ay] = clientToWorld(x0, y0);
  const [bx, by] = clientToWorld(x1, y1);
  const left = Math.min(ax, bx);
  const right = Math.max(ax, bx);
  const top = Math.min(ay, by);
  const bottom = Math.max(ay, by);
  const box = imageBox();
  const hits = [];
  for (const p of visibleMarkers()) {
    const cx = box.left + p.point[0] * box.width;
    const cy = box.top + p.point[1] * box.height;
    if (cx >= left && cx <= right && cy >= top && cy <= bottom) hits.push(p.id);
  }
  return hits;
}

export function updateMarqueeEl(x0, y0, x1, y1) {
  const stage = els.canvasStage.getBoundingClientRect();
  const el = els.marquee;
  if (!el) return;
  el.hidden = false;
  el.style.left = `${Math.min(x0, x1) - stage.left}px`;
  el.style.top = `${Math.min(y0, y1) - stage.top}px`;
  el.style.width = `${Math.abs(x1 - x0)}px`;
  el.style.height = `${Math.abs(y1 - y0)}px`;
}

export function hideMarquee() {
  if (els.marquee) els.marquee.hidden = true;
  state.marquee = null;
}

