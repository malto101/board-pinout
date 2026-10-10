import {
  MARKER_R,
  LABEL_GAP,
  CENTER_POINT,
  escapeHtml,
  hasChildren,
  ensurePoint,
} from "./util.js";
import { buildIndex } from "./model.js";
import { assignmentOwner, partAssignments } from "./mux.js";
import {
  screenReadableLabelRot,
  estimateLabelWidth,
  computeAutoLabelOffsets,
  layoutLabelBox,
} from "./labels.js";
import { imageBox, resolveUnderlay, tweenView } from "./view.js";

/** Highest external payload schema version this widget understands. */
export var PAYLOAD_VERSION = 1;
var SEARCH_DEBOUNCE_MS = 150;

function showLoadMessage(root, text) {
  var detail = root.querySelector(".zbp-detail");
  var html = '<p class="zbp-hint zbp-load-msg">' + escapeHtml(text) + "</p>";
  var old = root.querySelector(".zbp-load-msg");
  if (old) old.remove();
  if (detail) detail.innerHTML = html;
  else root.insertAdjacentHTML("beforeend", html);
}

/** Run ``fn`` once ``el`` is near the viewport (immediately without IO). */
function whenVisible(el, fn) {
  if (typeof IntersectionObserver === "undefined") {
    fn();
    return;
  }
  var io = new IntersectionObserver(
    function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          io.disconnect();
          fn();
          return;
        }
      }
    },
    { rootMargin: "400px 0px" }
  );
  io.observe(el);
}

function loadExternal(root, src) {
  var version = Number(root.getAttribute("data-payload-version") || PAYLOAD_VERSION);
  if (version > PAYLOAD_VERSION) {
    showLoadMessage(
      root,
      "Pinout data version " + version + " is newer than this viewer supports."
    );
    return;
  }
  showLoadMessage(root, "Loading pinout…");
  fetch(src, { credentials: "same-origin" })
    .then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    })
    .then(
      function (payload) {
        var msg = root.querySelector(".zbp-load-msg");
        if (msg) msg.remove();
        mountWidget(root, payload);
      },
      function (err) {
        showLoadMessage(
          root,
          "Pinout data failed to load (" + (err && err.message ? err.message : err) + ")."
        );
      }
    );
}

export function initWidget(root) {
  if (root.__zbpInit) return;
  root.__zbpInit = true;
  var src = root.getAttribute("data-src");
  if (src) {
    whenVisible(root, function () {
      loadExternal(root, src);
    });
    return;
  }
  var dataEl = root.querySelector(".zbp-data");
  if (!dataEl) return;
  var payload;
  try {
    payload = JSON.parse(dataEl.textContent);
  } catch (e) {
    root.insertAdjacentHTML(
      "beforeend",
      '<p class="zbp-hint">Pinout data JSON failed to parse.</p>'
    );
    return;
  }
  mountWidget(root, payload);
}

export function mountWidget(root, payload) {
  var doc = payload.doc || {};
  var face = (doc.faces || {})[payload.face || "top"] || { children: [] };
  // Top-level markers always have a point (default center); nested pins
  // stay point-less until expand synthesizes a grid (or author sets one).
  (face.children || []).forEach(function (p) {
    ensurePoint(p);
  });
  var software = doc.software || {};
  var softwareIds = Object.keys(software);
  var index = buildIndex(face.children || [], doc.soc_routing, software);
  var findPart = function (_parts, id) {
    return index.find(id);
  };
  var partMuxEntries = function (part) {
    return index.mux(part);
  };
  // Function the pad comes out of reset in: the table's reset.function, else
  // its plain GPIO entry when reset leaves the pad as a GPIO input/output.
  var defaultFunction = function (part) {
    var reset = part && part.pad_info && part.pad_info.reset;
    if (!reset) return null;
    if (reset.function) return String(reset.function);
    if (reset.mode !== "input" && reset.mode !== "output") return null;
    var gpio = partMuxEntries(part).find(function (m) {
      return m.peripheral === "gpio";
    });
    return gpio ? gpio.function : null;
  };
  var softwareName = function (id) {
    var sw = software[id];
    return (sw && sw.name) || id || "software";
  };
  // One tag per software stack that selects ``fn`` on ``part``.
  var softwareTags = function (part, fns) {
    var seen = {};
    return fns
      .reduce(function (ids, fn) {
        return ids.concat(index.assignedFunctions(part).get(fn) || []);
      }, [])
      .filter(function (id) {
        if (seen[id]) return false;
        seen[id] = true;
        return true;
      })
      .map(function (id) {
        var name = softwareName(id);
        return (
          '<span class="zbp-tag-default zbp-tag-software" title="Selected by ' +
          escapeHtml(name) +
          ' on this board">' +
          escapeHtml(name) +
          "</span>"
        );
      })
      .join("");
  };
  var RESET_TAG =
    '<span class="zbp-tag-default" title="Function the SoC selects at power-on reset, before software configures the pin">reset</span>';
  // One line per SoC routing rule (GPIO matrix, PSEL, ...); its signals are
  // left out of the peripheral filter, so say that they exist.
  var routingNote = function () {
    var rules = doc.soc_routing || {};
    return Object.keys(rules)
      .map(function (id) {
        var r = rules[id];
        var n = (r.functions || []).length;
        return (
          (r.label || r.kind) +
          ": " +
          n +
          " more signal(s) can be routed to " +
          (r.kind === "any_pin" ? "any GPIO" : "some pins") +
          ". The filter lists fixed pad (IO_MUX) functions only."
        );
      })
      .join(" ");
  };

  var partHasPeripheral = function (part, peri) {
    return index.hasPeripheral(part, peri);
  };
  var muxSignalsForPeripheral = function (part, peri) {
    return index.signalsFor(part, peri);
  };
  var collectPeripherals = function () {
    return index.peripherals();
  };
  // Expanded-group layout is a pure function of the (static) parent.
  var layoutCache = new Map();
  var stage = root.querySelector(".zbp-stage");
  var img = root.querySelector(".zbp-underlay");
  var overlay = root.querySelector(".zbp-overlay");
  var detail = root.querySelector(".zbp-detail");
  var crumb = root.querySelector(".zbp-breadcrumb");
  var toolbar = root.querySelector(".zbp-toolbar");
  var side = root.querySelector(".zbp-side");
  var search = root.querySelector(".zbp-search");
  var searchClear = root.querySelector(".zbp-search-clear");
  var periSelect = root.querySelector(".zbp-peripheral");

  // Search clear (×) — wrap input if older HTML
  if (search) {
    var wrap = search.closest(".zbp-search-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "zbp-search-wrap";
      search.parentNode.insertBefore(wrap, search);
      wrap.appendChild(search);
    }
    if (!searchClear) {
      searchClear = document.createElement("button");
      searchClear.type = "button";
      searchClear.className = "zbp-search-clear";
      searchClear.title = "Clear search";
      searchClear.setAttribute("aria-label", "Clear search");
      searchClear.hidden = true;
      searchClear.textContent = "×";
      wrap.appendChild(searchClear);
    }
  }

  // Peripheral filter lives in the right board panel
  var sideTools = side && side.querySelector(".zbp-side-tools");
  if (side && !sideTools) {
    sideTools = document.createElement("div");
    sideTools.className = "zbp-side-tools";
    sideTools.innerHTML =
      '<label class="zbp-peri-label">Peripheral' +
      '<select class="zbp-peripheral" aria-label="Filter by peripheral">' +
      '<option value="">All peripherals</option></select></label>' +
      '<p class="zbp-peri-hint">Select a peripheral to highlight and zoom to its pins</p>';
    side.insertBefore(sideTools, side.firstChild);
    // Drop legacy toolbar peripheral if present
    var oldPeri = toolbar && toolbar.querySelector(".zbp-peri-label");
    if (oldPeri) oldPeri.remove();
    periSelect = sideTools.querySelector(".zbp-peripheral");
  } else if (sideTools) {
    periSelect = sideTools.querySelector(".zbp-peripheral") || periSelect;
    var toolbarPeri = toolbar && toolbar.querySelector(".zbp-peri-label");
    if (toolbarPeri && toolbarPeri !== sideTools.querySelector(".zbp-peri-label")) {
      toolbarPeri.remove();
    }
  }

  var periHint = sideTools && sideTools.querySelector(".zbp-peri-hint");

  // Software filter: only when several stacks share the board's pins.
  var softwareSelect = null;
  if (sideTools && softwareIds.length > 1) {
    var swLabel = document.createElement("label");
    swLabel.className = "zbp-peri-label zbp-software-label";
    swLabel.textContent = "Software";
    softwareSelect = document.createElement("select");
    softwareSelect.className = "zbp-software";
    softwareSelect.setAttribute("aria-label", "Filter by software");
    softwareSelect.innerHTML =
      '<option value="">All software</option>' +
      softwareIds
        .map(function (id) {
          return '<option value="' + escapeHtml(id) + '">' + escapeHtml(softwareName(id)) + "</option>";
        })
        .join("");
    swLabel.appendChild(softwareSelect);
    sideTools.insertBefore(swLabel, periHint);
  }

  var state = {
    stack: [],
    selected: null,
    query: "",
    peripheral: "",
    software: "",
    infoOpen: false,
    popoverId: null,
    treeOpen: {},
    view: { scale: 1, tx: 0, ty: 0, rotation: 0 },
    panning: false,
    panMoved: false,
    panStart: null,
  };

  function refreshPeripheralOptions() {
    if (!periSelect) return;
    var peris = collectPeripherals(topParts());
    var prev = state.peripheral;
    periSelect.innerHTML =
      '<option value="">All peripherals</option>' +
      peris
        .map(function (p) {
          return (
            '<option value="' +
            escapeHtml(p.id) +
            '">' +
            escapeHtml(p.id) +
            " (" +
            p.pinIds.length +
            ")</option>"
          );
        })
        .join("");
    periSelect.disabled = peris.length === 0;
    if (periHint) {
      periHint.textContent = peris.length
        ? "Select a peripheral to highlight and zoom to its pins"
        : "No mux peripherals yet — add mux entries on pins in pinout.yaml";
      var note = routingNote();
      if (note) {
        var noteEl = document.createElement("span");
        noteEl.className = "zbp-peri-routing";
        noteEl.textContent = note;
        periHint.appendChild(noteEl);
      }
    }
    if (prev && peris.some(function (p) { return p.id === prev; })) {
      periSelect.value = prev;
      state.peripheral = prev;
    } else {
      periSelect.value = "";
      state.peripheral = "";
    }
  }

  function updateSearchClear() {
    if (!searchClear || !search) return;
    searchClear.hidden = !search.value;
  }

  function selectPartHighlight(id, opts) {
    opts = opts || {};
    state.selected = id;
    state.infoOpen = false;
    hidePopover();
    render();
    if (opts.focus !== false) focusOnPart(id);
  }

  function openPartInfo(id) {
    var found = findPart(topParts(), id);
    if (!found) return;
    state.selected = id;
    // Keep drill stack when browsing the board tree; leave it alone under a
    // peripheral filter so Up/Expand don't fight the mux pin list.
    if (!state.peripheral) {
      var path = pathToId(id);
      // Stack ancestors only (not the leaf itself) so crumb/Up match expand.
      state.stack = path.length > 1 ? path.slice(0, -1) : path.slice(0, 1);
      if (hasChildren(found.part)) {
        state.stack = path.slice();
        state.treeOpen[id] = true;
      }
    }
    state.infoOpen = true;
    hidePopover();
    render();
    focusOnPart(id);
  }

  // Wrap underlay + overlay so pan/zoom/rotate transform them together.
  var viewport = stage.querySelector(".zbp-viewport");
  if (!viewport) {
    viewport = document.createElement("div");
    viewport.className = "zbp-viewport";
    stage.insertBefore(viewport, stage.firstChild);
  }
  var rotator = viewport.querySelector(".zbp-rotator");
  if (!rotator) {
    rotator = document.createElement("div");
    rotator.className = "zbp-rotator";
    viewport.appendChild(rotator);
  }
  if (img && img.parentElement !== rotator) rotator.appendChild(img);
  if (overlay && overlay.parentElement !== rotator) rotator.appendChild(overlay);
  if (img) {
    img.draggable = false;
    img.setAttribute("draggable", "false");
  }

  // Optional authored default underlay rotation (degrees, 90° steps).
  var faceRotInit = Number(face.underlay_rotation);
  if (isFinite(faceRotInit)) {
    state.view.rotation = ((Math.round(faceRotInit / 90) % 4) + 4) % 4 * 90;
  }

  var controls = stage.querySelector(".zbp-view-controls");
  if (!controls) {
    controls = document.createElement("div");
    controls.className = "zbp-view-controls";
    controls.innerHTML =
      '<button type="button" class="zbp-view-btn" data-view="clear" title="Clear selection">✕</button>' +
      '<button type="button" class="zbp-view-btn" data-view="focus" title="Focus on selection">◎</button>' +
      '<button type="button" class="zbp-view-btn" data-view="rot-ccw" title="Rotate underlay −90°">↺</button>' +
      '<button type="button" class="zbp-view-btn" data-view="rot-cw" title="Rotate underlay +90°">↻</button>' +
      '<button type="button" class="zbp-view-btn" data-view="out" title="Zoom out">−</button>' +
      '<button type="button" class="zbp-view-btn" data-view="in" title="Zoom in">+</button>' +
      '<button type="button" class="zbp-view-btn" data-view="reset" title="Reset view">⟲</button>';
    stage.appendChild(controls);
  } else {
    function ensureViewBtn(act, title, text, beforeAct) {
      if (controls.querySelector('[data-view="' + act + '"]')) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "zbp-view-btn";
      btn.setAttribute("data-view", act);
      btn.title = title;
      btn.textContent = text;
      var before = beforeAct && controls.querySelector('[data-view="' + beforeAct + '"]');
      if (before) controls.insertBefore(btn, before);
      else controls.appendChild(btn);
    }
    ensureViewBtn("clear", "Clear selection", "✕", "focus");
    ensureViewBtn("focus", "Focus on selection", "◎", "rot-ccw");
    ensureViewBtn("rot-ccw", "Rotate underlay −90°", "↺", "out");
    ensureViewBtn("rot-cw", "Rotate underlay +90°", "↻", "out");
  }

  function clearSelection() {
    state.stack = [];
    state.selected = null;
    state.infoOpen = false;
    state.popoverId = null;
    hidePopover();
    if (periSelect) {
      periSelect.value = "";
      state.peripheral = "";
    }
    render();
  }

  function normalizeRotation(deg) {
    var d = Number(deg) || 0;
    d = ((Math.round(d / 90) % 4) + 4) % 4 * 90;
    return d;
  }

  var cancelTween = null;
  function stopViewTween() {
    if (cancelTween) cancelTween();
    cancelTween = null;
  }

  function applyViewTransform() {
    var v = state.view;
    v.rotation = normalizeRotation(v.rotation);
    viewport.style.transform =
      "translate(" + v.tx + "px, " + v.ty + "px) scale(" + v.scale + ")";
    rotator.style.transform =
      v.rotation ? "rotate(" + v.rotation + "deg)" : "";
    stage.classList.toggle(
      "zbp-zoomed",
      v.scale > 1.01 || v.tx !== 0 || v.ty !== 0 || v.rotation !== 0
    );
  }

  function clampScale(s) {
    return Math.min(6, Math.max(0.5, s));
  }

  function zoomAt(clientX, clientY, nextScale) {
    var rect = stage.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    var prev = state.view.scale;
    var scale = clampScale(nextScale);
    if (scale === prev) return;
    stopViewTween();
    // Keep the board point under the cursor stable.
    state.view.tx = x - ((x - state.view.tx) * scale) / prev;
    state.view.ty = y - ((y - state.view.ty) * scale) / prev;
    state.view.scale = scale;
    applyViewTransform();
  }

  function rotateView(deltaDeg) {
    stopViewTween();
    state.view.rotation = normalizeRotation(
      (state.view.rotation || 0) + deltaDeg
    );
    applyViewTransform();
    // Re-layout labels so screenReadableLabelRot can keep text upright.
    renderOverlay();
  }

  function resetView() {
    stopViewTween();
    var faceRot = Number(face.underlay_rotation);
    state.view = {
      scale: 1,
      tx: 0,
      ty: 0,
      rotation: isFinite(faceRot) ? normalizeRotation(faceRot) : 0,
    };
    applyViewTransform();
    renderOverlay();
  }

  /** Normalized point used for focusing a part (authored or layout). */
  function displayPointFor(id) {
    var found = findPart(topParts(), id);
    if (!found) return CENTER_POINT.slice();
    var part = found.part;
    if (!found.parent) return ensurePoint(part).point;
    if (hasChildren(found.parent)) {
      var laid = layoutExpandedChildren(found.parent);
      var kids = found.parent.children;
      // Layout preserves child order, so the sibling index maps directly.
      var at = kids.indexOf(found.part);
      if (at >= 0 && laid[at] && laid[at].id === id && laid[at].point) {
        return laid[at].point;
      }
      for (var i = 0; i < laid.length; i++) {
        if (laid[i].id === id && laid[i].point) return laid[i].point;
      }
    }
    // Never write a fallback onto a nested part: it would read as authored.
    return part.point && part.point.length === 2 ? part.point : CENTER_POINT.slice();
  }

  /**
   * Where a stage-space point lands after the rotator's rotate() about the
   * stage centre (the viewport's pan/zoom is applied on top of this).
   */
  function rotatedStagePoint(x, y, sw, sh) {
    var deg = normalizeRotation(state.view.rotation || 0);
    if (!deg) return [x, y];
    var rad = (deg * Math.PI) / 180;
    var cos = Math.round(Math.cos(rad));
    var sin = Math.round(Math.sin(rad));
    var dx = x - sw / 2;
    var dy = y - sh / 2;
    return [sw / 2 + dx * cos - dy * sin, sh / 2 + dx * sin + dy * cos];
  }

  /** Pan/zoom so (nx,ny) sits at stage center. */
  function focusOnNorm(nx, ny, opts) {
    opts = opts || {};
    var box = imageBox(stage, img);
    var scale = clampScale(
      opts.scale != null ? opts.scale : Math.max(state.view.scale, 1.75)
    );
    var sw = stage.clientWidth || 1;
    var sh = stage.clientHeight || 1;
    var c = rotatedStagePoint(
      box.left + Number(nx) * box.width,
      box.top + Number(ny) * box.height,
      sw,
      sh
    );
    var target = {
      scale: scale,
      tx: sw / 2 - c[0] * scale,
      ty: sh / 2 - c[1] * scale,
    };
    stopViewTween();
    cancelTween = tweenView(state.view, target, sw, sh, function (v) {
      state.view.scale = v.scale;
      state.view.tx = v.tx;
      state.view.ty = v.ty;
      applyViewTransform();
    }, {
      done: function () {
        cancelTween = null;
      },
    });
  }

  /** All parts (any depth) that declare mux for the given peripheral. */
  var periPartsCache = new Map();
  function partsForPeripheral(periId) {
    if (!periId) return [];
    var cached = periPartsCache.get(periId);
    if (cached) return cached;
    var peri = index.peripheral(String(periId).toLowerCase());
    var out = [];
    (peri ? peri.pinIds : []).forEach(function (id) {
      var found = index.find(id);
      if (!found) return;
      var pt = displayPointFor(id);
      out.push(
        Object.assign({}, found.part, {
          point: pt && pt.length === 2 ? pt : CENTER_POINT.slice(),
        })
      );
    });
    periPartsCache.set(periId, out);
    return out;
  }

  /**
   * Fit the view so all normalized points are visible, centered on their
   * bounding-box midpoint (with padding).
   */
  function focusOnPoints(points, opts) {
    opts = opts || {};
    if (!points || !points.length) return;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    points.forEach(function (p) {
      if (!p || p.length < 2) return;
      var x = Number(p[0]);
      var y = Number(p[1]);
      if (!isFinite(x) || !isFinite(y)) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    if (!isFinite(minX)) return;
    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;
    if (points.length === 1 || (maxX - minX < 1e-6 && maxY - minY < 1e-6)) {
      focusOnNorm(cx, cy, { scale: opts.scale != null ? opts.scale : 1.75 });
      return;
    }
    var box = imageBox(stage, img);
    var sw = stage.clientWidth || 1;
    var sh = stage.clientHeight || 1;
    var pad = opts.pad != null ? opts.pad : 0.1;
    var spanW = (Math.max(maxX - minX, 0.02) + pad * 2) * box.width;
    var spanH = (Math.max(maxY - minY, 0.02) + pad * 2) * box.height;
    // A quarter turn swaps which board extent runs along the stage's x axis.
    if (normalizeRotation(state.view.rotation || 0) % 180) {
      var t = spanW;
      spanW = spanH;
      spanH = t;
    }
    var scaleX = (sw * 0.78) / Math.max(spanW, 1);
    var scaleY = (sh * 0.78) / Math.max(spanH, 1);
    var scale = clampScale(
      Math.min(scaleX, scaleY, opts.maxScale != null ? opts.maxScale : 4)
    );
    focusOnNorm(cx, cy, { scale: scale });
  }

  function focusOnPeripheral(periId) {
    if (!periId) return;
    var parts = partsForPeripheral(periId);
    focusOnPoints(
      parts.map(function (p) {
        return p.point;
      })
    );
  }

  function focusOnPart(id) {
    if (!id) return;
    var pt = displayPointFor(id);
    focusOnNorm(pt[0], pt[1]);
  }

  function focusOnSelection() {
    if (state.selected) {
      focusOnPart(state.selected);
      return;
    }
    if (state.peripheral) {
      focusOnPeripheral(state.peripheral);
      return;
    }
    var root = expandRoot();
    if (root) {
      ensurePoint(root);
      focusOnNorm(root.point[0], root.point[1]);
    }
  }

  var candidates = resolveUnderlay(payload, root);
  var candIdx = 0;
  function tryUnderlay() {
    if (candIdx >= candidates.length) return;
    img.src = candidates[candIdx++];
  }
  img.addEventListener("error", tryUnderlay);
  img.addEventListener("load", function () {
    render();
  });
  tryUnderlay();

  function topParts() {
    return face.children || [];
  }

  function currentPart() {
    if (!state.stack.length) return null;
    var f = findPart(topParts(), state.stack[state.stack.length - 1]);
    return f ? f.part : null;
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
  }

  /**
   * Choose rows×cols for an expanded group. Prefer authored rows/cols, but
   * re-orient wide 2-row headers when the parent sits on a vertical board edge
   * (e.g. Raspberry Pi HAT) so the grid reads as 2 columns × N rows.
   */
  function inferExpandGrid(parent, n) {
    var rows = Number(parent.rows) || 0;
    var cols = Number(parent.cols) || 0;
    var ox = parent.point && parent.point.length === 2 ? parent.point[0] : 0.5;
    var nearVert = ox < 0.28 || ox > 0.72;
    if (rows >= 1 && cols >= 1) {
      if (nearVert && rows === 2 && cols > 2) {
        return { rows: cols, cols: rows };
      }
      if (!nearVert && cols === 2 && rows > 2) {
        return { rows: cols, cols: rows };
      }
      return { rows: rows, cols: cols };
    }
    if (n >= 16) {
      return nearVert
        ? { rows: Math.ceil(n / 2), cols: 2 }
        : { rows: 2, cols: Math.ceil(n / 2) };
    }
    cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    rows = Math.max(1, Math.ceil(n / cols));
    return { rows: rows, cols: cols };
  }

  /**
   * Children to draw while drilled into a group/pin_array.
   * Authored points win; otherwise synthesize a compact grid around the parent.
   */
  function layoutExpandedChildren(parent) {
    var kids = (parent && parent.children) || [];
    if (!kids.length) return [];
    var cached = layoutCache.get(parent);
    if (cached) return cached;
    var laid = computeExpandedLayout(parent, kids);
    layoutCache.set(parent, laid);
    return laid;
  }

  function computeExpandedLayout(parent, kids) {
    var allAuthored = kids.every(function (p) {
      return p.point && p.point.length === 2;
    });
    if (allAuthored) return kids;

    var origin =
      parent.point && parent.point.length === 2 ? parent.point : [0.5, 0.5];
    var grid = inferExpandGrid(parent, kids.length);
    var rows = grid.rows;
    var cols = grid.cols;
    var maxSpanX = 0.22;
    var maxSpanY = 0.28;
    var spacingX = cols > 1 ? Math.min(0.032, maxSpanX / (cols - 1)) : 0;
    var spacingY = rows > 1 ? Math.min(0.032, maxSpanY / (rows - 1)) : 0;
    var ox = origin[0] - ((cols - 1) * spacingX) / 2;
    var oy = origin[1] - ((rows - 1) * spacingY) / 2;
    var numbering = parent.numbering || "row_major";

    return kids.map(function (p, i) {
      if (p.point && p.point.length === 2) return p;
      var r;
      var c;
      if (numbering === "col_major") {
        r = i % rows;
        c = Math.floor(i / Math.max(rows, 1));
      } else {
        r = Math.floor(i / Math.max(cols, 1));
        c = i % cols;
      }
      return Object.assign({}, p, {
        point: [clamp01(ox + c * spacingX), clamp01(oy + r * spacingY)],
        label_offset: p.label_offset || [0.01, -0.014],
      });
    });
  }

  /** Deepest drilled ancestor that still has children (for canvas expand). */
  function expandRoot() {
    for (var i = state.stack.length - 1; i >= 0; i--) {
      var f = findPart(topParts(), state.stack[i]);
      if (f && hasChildren(f.part)) return f.part;
    }
    return null;
  }

  /**
   * A part picked from the tree below the current drill level is drawn with
   * its siblings (its parent's expanded layout) so the marker is visible.
   */
  function selectedSiblingsLayout() {
    if (!state.selected) return null;
    var found = index.find(state.selected);
    if (!found || !found.parent) return null;
    var shown = expandRoot();
    if (shown && shown.id === found.parent.id) return null;
    var kids = layoutExpandedChildren(found.parent);
    if (!kids.length) return null;
    return kids.map(function (p) {
      return ensurePoint(p);
    });
  }

  function markers() {
    // Peripheral filter: draw every matching pin (any depth) so the canvas
    // highlights the whole group without requiring a drill-in first.
    if (state.peripheral) {
      var periList = partsForPeripheral(state.peripheral);
      if (periList.length) return periList;
    }
    var list;
    var siblings = selectedSiblingsLayout();
    if (siblings) {
      list = siblings;
    } else if (!state.stack.length) {
      list = topParts().map(function (p) {
        return ensurePoint(p);
      });
    } else {
      var root = expandRoot();
      if (root) {
        var kids = layoutExpandedChildren(root);
        list = kids.length
          ? kids.map(function (p) {
              return ensurePoint(p);
            })
          : null;
      }
      if (!list) {
        var cur = currentPart();
        list = cur
          ? [cur.point && cur.point.length === 2 ? cur : Object.assign({}, cur, { point: displayPointFor(cur.id) })]
          : topParts().map(function (p) {
              return ensurePoint(p);
            });
      }
    }
    return list;
  }

  function matchesQuery(part) {
    if (!state.query) return true;
    return index.matchesQuery(part, state.query.toLowerCase());
  }

  // Parts whose subtree has a pin the selected software uses, so a header
  // stays lit while it holds one of that software's pins.
  var softwareHits = null;
  var softwareKey = null;
  function usedBySoftware(part) {
    if (!state.software) return true;
    if (softwareKey !== state.software) {
      softwareKey = state.software;
      softwareHits = index.subtreeMatches(function (p) {
        return index.usedBy(p, state.software);
      });
    }
    return softwareHits.has(part.id);
  }

  function matchesFilters(part) {
    if (state.peripheral && !partHasPeripheral(part, state.peripheral)) return false;
    if (state.software && !index.usedBy(part, state.software)) return false;
    return matchesQuery(part);
  }

  function partIsDimmed(part) {
    if (state.peripheral && !partHasPeripheral(part, state.peripheral)) return true;
    if (!usedBySoftware(part)) return true;
    if (state.query && !matchesQuery(part)) return true;
    return false;
  }

  function hidePopover() {
    var old = root.querySelector(".zbp-popover");
    if (old) old.remove();
    state.popoverId = null;
  }

  function doExpand(part) {
    state.selected = part.id;
    state.stack.push(part.id);
    state.infoOpen = false;
    state.treeOpen[part.id] = true;
    hidePopover();
    render();
    focusOnPart(part.id);
  }

  function doInfo(part) {
    state.selected = part.id;
    state.infoOpen = true;
    hidePopover();
    renderDetail(part);
    renderOverlay();
  }

  function showPopover(part, clientX, clientY) {
    hidePopover();
    state.popoverId = part.id;
    state.selected = part.id;

    var actions = [];
    if (hasChildren(part)) {
      actions.push({
        act: "expand",
        label: "▸ Expand parts",
        run: function () {
          doExpand(part);
        },
      });
    }
    actions.push({
      act: "info",
      label: "ℹ View info",
      run: function () {
        doInfo(part);
      },
    });

    var rect = stage.getBoundingClientRect();
    var pop = document.createElement("div");
    pop.className = "zbp-popover";
    var x = clientX - rect.left + 8;
    var y = clientY - rect.top + 8;
    pop.style.left = Math.min(x, Math.max(8, stage.clientWidth - 150)) + "px";
    pop.style.top = Math.min(y, Math.max(8, stage.clientHeight - 90)) + "px";
    pop.innerHTML = actions
      .map(function (a) {
        return (
          '<button type="button" data-act="' + a.act + '">' + a.label + "</button>"
        );
      })
      .join("");
    stage.appendChild(pop);
    actions.forEach(function (a) {
      pop.querySelector('[data-act="' + a.act + '"]').addEventListener("click", function (e) {
        e.stopPropagation();
        a.run();
      });
    });
  }

  /**
   * Label offsets for ``list``, each laid out within its full sibling group
   * (the parent's expanded children, or the top level). A pin's label then
   * looks the same in every view: drilled in, peripheral filter or selection.
   */
  function groupLabelOffsets(list, box, stageW, stageH) {
    var byGroup = new Map();
    return list.map(function (p) {
      var found = index.find(p.id);
      var parent = found && found.parent;
      var offs = byGroup.get(parent);
      if (!offs) {
        var siblings = parent
          ? layoutExpandedChildren(parent)
          : topParts().map(function (q) {
              return ensurePoint(q);
            });
        var all = computeAutoLabelOffsets(siblings, box, stageW, stageH);
        offs = new Map();
        siblings.forEach(function (q, i) {
          offs.set(q.id, all[i]);
        });
        byGroup.set(parent, offs);
      }
      return offs.get(p.id) || computeAutoLabelOffsets([p], box, stageW, stageH)[0];
    });
  }

  function renderOverlay() {
    var box = imageBox(stage, img);
    var list = markers();
    var stageW = stage.clientWidth || 1;
    var stageH = stage.clientHeight || 1;
    var offsets = groupLabelOffsets(list, box, stageW, stageH);
    var html = list
      .map(function (p, idx) {
        var cx = box.left + p.point[0] * box.width;
        var cy = box.top + p.point[1] * box.height;
        var off = offsets[idx] || { dx: LABEL_GAP + 42, dy: 0 };
        var label = p.silk || p.id;
        var dim = partIsDimmed(p);
        // The peripheral filter already limits markers to its pins, so they
        // keep the normal style and only the selected pin stands out. That
        // is applied after the markup so a selection-only change produces
        // identical markup and skips the rebuild.
        var fill = MARKER_FILL;
        var tw = estimateLabelWidth(p);
        var th = 16;
        var lay = layoutLabelBox(cx, cy, off, tw, th);
        var rx = lay.rx;
        var ry = lay.ry;
        var textX = lay.textX;
        var textY = lay.textY;
        var anchor = lay.anchor;
        var tipX = lay.tipX;
        var tipY = lay.tipY;
        var verts = Array.isArray(p.leader_vertices) ? p.leader_vertices : [];
        var pts = [[cx, cy]];
        verts.forEach(function (v) {
          if (Array.isArray(v) && v.length >= 2) {
            pts.push([box.left + v[0] * box.width, box.top + v[1] * box.height]);
          }
        });
        pts.push([tipX, tipY]);
        var d = pts
          .map(function (pt, i) {
            return (i === 0 ? "M" : "L") + pt[0] + " " + pt[1];
          })
          .join(" ");
        var rot = Number(
          p.label_rotation !== undefined &&
            p.label_rotation !== null &&
            p.label_rotation !== ""
            ? p.label_rotation
            : off.rotation
        );
        if (!isFinite(rot)) rot = 0;
        rot = screenReadableLabelRot(rot, state.view.rotation);
        if (Math.abs(rot) < 1e-6) rot = 0;
        // Normalize near-equivalents like 360 → 0 for a clean attribute.
        rot = ((rot % 360) + 360) % 360;
        if (rot > 180) rot -= 360;
        if (Math.abs(rot) < 1e-6) rot = 0;
        var pivotX = rx + tw / 2;
        var pivotY = ry + th / 2;
        var labelXform = rot
          ? ' transform="rotate(' + rot + " " + pivotX + " " + pivotY + ')"'
          : "";
        return (
          '<g class="zbp-hit' +
          (state.query && matchesQuery(p) ? " zbp-match" : "") +
          '" data-id="' +
          escapeHtml(p.id) +
          '" opacity="' +
          (dim ? "0.18" : "1") +
          '">' +
          '<path d="' +
          d +
          '" fill="none" stroke="var(--zbp-line, rgba(245,166,35,0.75))" stroke-width="1" stroke-linejoin="round" />' +
          '<circle cx="' +
          cx +
          '" cy="' +
          cy +
          '" r="' +
          MARKER_R +
          '" fill="' +
          fill +
          '" stroke="' +
          "#0b1016" +
          '" stroke-width="' +
          "1.25" +
          '" />' +
          '<g class="zbp-label"' +
          labelXform +
          ">" +
          '<rect class="zbp-label-bg" x="' +
          rx +
          '" y="' +
          ry +
          '" width="' +
          tw +
          '" height="' +
          th +
          '" rx="3" />' +
          '<text x="' +
          textX +
          '" y="' +
          textY +
          '" fill="#f3f6fb" font-size="10" font-family="system-ui,sans-serif" text-anchor="' +
          anchor +
          '">' +
          escapeHtml(label) +
          "</text></g></g>"
        );
      })
      .join("");
    if (html !== overlayHtml) {
      overlayHtml = html;
      overlay.innerHTML = html;
      activeCircle = null;
    }
    if (activeCircle) {
      activeCircle.setAttribute("fill", activeCircle.getAttribute("data-fill"));
      activeCircle.parentNode.classList.remove("zbp-selected");
      activeCircle = null;
    }
    if (!state.selected) return;
    var g = overlay.querySelector('.zbp-hit[data-id="' + attrValue(state.selected) + '"]');
    var circle = g && g.querySelector("circle");
    if (circle) {
      circle.setAttribute("data-fill", circle.getAttribute("fill"));
      circle.setAttribute("fill", MARKER_ACTIVE_FILL);
      g.classList.add("zbp-selected");
      activeCircle = circle;
    }
  }

  var MARKER_FILL = "var(--zbp-marker, #f5a623)";
  var MARKER_ACTIVE_FILL = "var(--zbp-marker-active, #2dd4bf)";
  var overlayHtml = null;
  var activeCircle = null;

  // Delegated marker handlers: bound once, survive overlay re-renders.
  function hitId(ev) {
    var g = ev.target.closest && ev.target.closest(".zbp-hit");
    return g && overlay.contains(g) ? g.getAttribute("data-id") : null;
  }
  // The first click re-renders and pans to the marker, so the second click of
  // a double-click usually lands on a new node or empty canvas and the native
  // dblclick never fires on the marker. Pair clicks ourselves instead.
  var DOUBLE_CLICK_MS = 450;
  var lastHit = { id: null, t: 0 };
  function openMarkerPopover(id, ev) {
    lastHit.id = null;
    var found = findPart(topParts(), id);
    if (!found) return;
    showPopover(found.part, ev.clientX, ev.clientY);
    renderOverlay();
  }
  function pairedHit(ev) {
    return ev.detail >= 2 && lastHit.id && ev.timeStamp - lastHit.t < DOUBLE_CLICK_MS
      ? lastHit.id
      : null;
  }
  overlay.addEventListener("click", function (ev) {
    var id = hitId(ev);
    if (!id) return;
    ev.stopPropagation();
    var paired = pairedHit(ev);
    if (paired) {
      openMarkerPopover(paired, ev);
      return;
    }
    lastHit = { id: id, t: ev.timeStamp };
    selectPartHighlight(id);
  });
  overlay.addEventListener("dblclick", function (ev) {
    var id = hitId(ev);
    if (!id) return;
    ev.stopPropagation();
    if (state.popoverId !== id) openMarkerPopover(id, ev);
  });

  // "power_out · 3V3 · 3.3 V" for a fixed net (power, ground, reset, NC).
  function netText(net) {
    if (!net || !net.role) return "";
    return [
      net.role.replace(/_/g, " "),
      net.rail,
      net.nominal_v != null ? net.nominal_v + " V" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  // "solder bridge SB62 (open)" for a pin reached through board options.
  function gatingText(g) {
    if (!g || !g.kind) return "";
    return [g.kind.replace(/_/g, " "), g.ref, g.default ? "(" + g.default + ")" : ""]
      .filter(Boolean)
      .join(" ");
  }

  function metaRow(label, value) {
    if (value === undefined || value === null || value === "") return "";
    return (
      '<div class="zbp-meta-row">' +
      '<dt>' +
      escapeHtml(label) +
      "</dt>" +
      "<dd>" +
      escapeHtml(String(value)) +
      "</dd></div>"
    );
  }

  function metaSection(title, bodyHtml) {
    if (!bodyHtml) return "";
    return (
      '<section class="zbp-meta-sec">' +
      (title ? '<h5 class="zbp-meta-h">' + escapeHtml(title) + "</h5>" : "") +
      bodyHtml +
      "</section>"
    );
  }

  function metaHtml(part) {
    var mux = partMuxEntries(part);
    var identity =
      "<dl class=\"zbp-meta-dl\">" +
      metaRow("ID", part.id) +
      metaRow("Silk", part.silk && part.silk !== part.id ? part.silk : "") +
      metaRow("Kind", part.kind) +
      metaRow("Ref", part.ref) +
      metaRow("Pad", part.pad) +
      metaRow("Net", netText(part.net)) +
      metaRow("Gated by", gatingText(part.gating)) +
      "</dl>";

    var muxBody = "";
    var dflt = defaultFunction(part);
    if (mux.length) {
      muxBody =
        '<ul class="zbp-meta-mux zbp-meta-mux-grid">' +
        '<li class="zbp-meta-mux-head" aria-hidden="true"><span>Peripheral</span>' +
        "<span>Signal</span><span>Mode</span></li>" +
        mux
          .map(function (m) {
            var hasMode = m.mode !== undefined && m.mode !== null && m.mode !== "";
            // The function name is only worth a line when it is not just
            // peripheral + signal (ADC1_CH3), e.g. U0TXD or TOUCH4.
            var squash = function (v) {
              return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            };
            var showFn =
              m.function &&
              squash(m.function) !== squash(m.signal) &&
              squash(m.function) !== squash(m.peripheral + m.signal);
            var title = [m.function, hasMode ? "mode " + m.mode : ""].filter(Boolean).join(" · ");
            return (
              '<li title="' +
              escapeHtml(title) +
              '">' +
              '<span class="zbp-chip">' +
              escapeHtml(m.peripheral) +
              "</span>" +
              '<span class="zbp-meta-mux-main">' +
              '<span class="zbp-meta-mux-sig">' +
              escapeHtml(m.signal) +
              "</span>" +
              (dflt && m.function === dflt ? RESET_TAG : "") +
              softwareTags(part, [m.function]) +
              (showFn
                ? '<span class="zbp-meta-mux-fn">' + escapeHtml(m.function) + "</span>"
                : "") +
              "</span>" +
              '<span class="zbp-meta-mux-mode">' +
              (hasMode ? escapeHtml(m.mode) : "") +
              "</span>" +
              "</li>"
            );
          })
          .join("") +
        "</ul>";
    }
    // Routed signals (GPIO matrix, PSEL, ...) collapse to one group per rule.
    index.routed(part).forEach(function (g) {
      if (!g.mux.length) return;
      var byPeri = {};
      g.mux.forEach(function (m) {
        (byPeri[m.peripheral] = byPeri[m.peripheral] || []).push(m.signal);
      });
      muxBody +=
        '<details class="zbp-meta-routed"><summary>' +
        escapeHtml(g.label) +
        ": " +
        g.mux.length +
        " more signal(s) routable to this pin</summary>" +
        (g.notes ? '<p class="zbp-meta-notes">' + escapeHtml(g.notes) + "</p>" : "") +
        '<ul class="zbp-meta-mux">' +
        Object.keys(byPeri)
          .sort()
          .map(function (k) {
            return (
              "<li>" +
              '<span class="zbp-chip">' +
              escapeHtml(k) +
              "</span>" +
              '<span class="zbp-meta-mux-sig">' +
              escapeHtml(byPeri[k].join(", ")) +
              "</span></li>"
            );
          })
          .join("") +
        "</ul></details>";
    });

    var configRows = function (cfg) {
      return Object.keys(cfg || {})
        .map(function (k) {
          var v = cfg[k];
          return metaRow(k, typeof v === "object" ? JSON.stringify(v) : v);
        })
        .join("");
    };
    var assignments = partAssignments(part)
      .map(function (a) {
        return (
          "<dl class=\"zbp-meta-dl\">" +
          metaRow("Software", softwareName(assignmentOwner(a, software))) +
          metaRow("Status", a.status || "unknown") +
          metaRow("Owner", a.owner) +
          metaRow("Role", a.role) +
          metaRow("Function", a.function) +
          configRows(a.config) +
          "</dl>"
        );
      })
      .join("");

    var notes = part.notes
      ? '<p class="zbp-meta-notes">' + escapeHtml(part.notes) + "</p>"
      : "";

    return (
      '<div class="zbp-meta">' +
      metaSection("Identity", identity) +
      metaSection("Mux", muxBody || '<p class="zbp-meta-empty">No mux entries</p>') +
      metaSection("Software", assignments) +
      metaSection("Notes", notes) +
      "</div>"
    );
  }

  function infoCardHtml(part) {
    if (!part) return "";
    var title = part.silk || part.id;
    var sub = [];
    if (part.kind) sub.push(part.kind);
    if (part.ref) sub.push(part.ref);
    if (part.id && part.silk && part.silk !== part.id) sub.push(part.id);
    return (
      '<div class="zbp-info-card">' +
      '<div class="zbp-info-head">' +
      '<div class="zbp-info-titles">' +
      "<strong>" +
      escapeHtml(title) +
      "</strong>" +
      (sub.length
        ? '<span class="zbp-info-sub">' + escapeHtml(sub.join(" · ")) + "</span>"
        : "") +
      "</div>" +
      '<div class="zbp-actions zbp-actions-inline">' +
      (hasChildren(part)
        ? '<button type="button" class="zbp-act" data-act="expand">▸ Expand</button>'
        : "") +
      '<button type="button" class="zbp-act" data-act="close-info">✕ Close</button>' +
      (state.stack.length && !state.peripheral
        ? '<button type="button" class="zbp-act" data-act="up">↑ Up</button>'
        : "") +
      "</div></div>" +
      metaHtml(part) +
      "</div>"
    );
  }

  function peripheralDetailHtml(periId) {
    var peri = collectPeripherals(topParts()).find(function (p) {
      return p.id === periId;
    });
    if (!peri) return '<p class="zbp-mux-empty">No pins for this peripheral.</p>';
    var items = peri.pinIds
      .map(function (id) {
        var found = findPart(topParts(), id);
        if (!found) return "";
        var part = found.part;
        var sigs = muxSignalsForPeripheral(part, periId);
        var active = id === state.selected;
        var dflt = defaultFunction(part);
        var periMux = partMuxEntries(part).filter(function (m) {
          return m.peripheral === periId;
        });
        var isDefault = !!dflt && periMux.some(function (m) {
          return m.function === dflt;
        });
        return (
          '<li class="zbp-mux-row' +
          (active ? " active" : "") +
          '">' +
          '<button type="button" class="zbp-tlabel' +
          (active ? " active" : "") +
          '" data-focus="' +
          escapeHtml(id) +
          '">' +
          escapeHtml(part.silk || part.id) +
          '</button><span class="zbp-mux-sig">' +
          escapeHtml(sigs.join(", ")) +
          "</span>" +
          (isDefault ? RESET_TAG : "") +
          softwareTags(
            part,
            periMux.map(function (m) {
              return m.function;
            })
          ) +
          '<button type="button" class="zbp-info" data-info="' +
          escapeHtml(id) +
          '" title="View info" aria-label="View info">ℹ</button></li>'
        );
      })
      .filter(Boolean)
      .join("");
    return (
      '<div class="zbp-peri-block">' +
      '<div class="zbp-peri-head">' +
      "<strong>" +
      escapeHtml(periId) +
      "</strong>" +
      '<span class="zbp-info-sub">' +
      peri.pinIds.length +
      " pin(s)" +
      (peri.signals.length ? " · " + escapeHtml(peri.signals.join(", ")) : "") +
      "</span></div>" +
      '<ul class="zbp-mux-list">' +
      items +
      "</ul></div>"
    );
  }

  // Ids whose subtree matches the active query; recomputed once per filter
  // change instead of re-walking every subtree for every rendered row.
  var subtreeHits = null;
  var subtreeKey = null;
  function subtreeMatches(p) {
    var key = state.query + "\u0000" + state.peripheral + "\u0000" + state.software;
    if (subtreeKey !== key) {
      subtreeKey = key;
      subtreeHits = index.subtreeMatches(matchesFilters);
    }
    return subtreeHits.has(p.id);
  }

  function renderTree(parts, depth) {
    if (!parts || !parts.length) return "";
    var html = '<ul class="zbp-tree">';
    parts.forEach(function (p) {
      if (state.query && !subtreeMatches(p)) return;
      // Explicit open flag only — never force-open, so collapse always works.
      var open = state.treeOpen[p.id] === true;
      var kids = p.children || [];
      html += "<li>";
      html += '<div class="zbp-tree-row">';
      if (kids.length) {
        html +=
          '<button type="button" class="zbp-twisty" data-toggle="' +
          escapeHtml(p.id) +
          '" aria-expanded="' +
          (open ? "true" : "false") +
          '" title="Expand / collapse">' +
          (open ? "▾" : "▸") +
          "</button>";
      } else {
        html += '<span class="zbp-leaf">•</span>';
      }
      html +=
        '<button type="button" class="zbp-tlabel' +
        (p.id === state.selected ? " active" : "") +
        '" data-id="' +
        escapeHtml(p.id) +
        '" title="' +
        escapeHtml(p.id) +
        '">' +
        escapeHtml(p.silk || p.id) +
        "</button>";
      if (p.kind || p.ref) {
        html +=
          '<span class="zbp-kind">' +
          escapeHtml(p.kind || p.ref) +
          "</span>";
      }
      html +=
        '<button type="button" class="zbp-info" data-info="' +
        escapeHtml(p.id) +
        '" title="View info" aria-label="View info for ' +
        escapeHtml(p.silk || p.id) +
        '">ℹ</button>';
      html += "</div>";
      if (kids.length && open) html += renderTree(kids, depth + 1);
      html += "</li>";
    });
    html += "</ul>";
    return html;
  }

  function pathToId(id) {
    return index.path(id);
  }

  function renderDetail(focusPart) {
    var part = focusPart || currentPart();
    var stackLabels = ["Board"].concat(
      state.stack.map(function (id) {
        var f = findPart(topParts(), id);
        return (f && (f.part.silk || f.part.id)) || id;
      })
    );
    var crumbHtml = stackLabels
      .map(function (label, i) {
        if (i === 0) {
          return '<button type="button" class="zbp-crumb" data-up="all">Board</button>';
        }
        if (i === stackLabels.length - 1) return "<span>" + escapeHtml(label) + "</span>";
        return (
          '<button type="button" class="zbp-crumb" data-up="' +
          (i - 1) +
          '">' +
          escapeHtml(label) +
          "</button>"
        );
      })
      .join(" <span>›</span> ");
    if (crumbHtml !== lastCrumbHtml) {
      lastCrumbHtml = crumbHtml;
      crumb.innerHTML = crumbHtml;
    }

    // Uniform panel order:
    //   1) info card (when ℹ / Info is open)
    //   2) contextual list (peripheral pins, children, or board tree)
    // Never stack a full board tree under a peripheral filter.
    // The list can be thousands of nodes, so it is only rebuilt when its
    // content key changes; selection alone just moves the .active class.
    detailRegions();
    var html = "";
    var infoPart = null;
    if (state.selected) {
      var infoFound = findPart(topParts(), state.selected);
      var sel = infoFound ? infoFound.part : null;
      if (sel && (state.infoOpen || !hasChildren(sel))) {
        // Same card for ℹ / Info and for leaf picks (leaves have nowhere to drill).
        infoPart = sel;
      }
    }

    if (infoPart) {
      html += infoCardHtml(infoPart);
    } else if (part && !state.peripheral) {
      html +=
        '<div class="zbp-browse-head">' +
        "<strong>" +
        escapeHtml(part.silk || part.id) +
        "</strong>" +
        '<div class="zbp-actions zbp-actions-inline">' +
        (hasChildren(part)
          ? '<button type="button" class="zbp-act" data-act="expand">▸ Expand</button>'
          : "") +
        '<button type="button" class="zbp-act" data-act="info">ℹ Info</button>' +
        (state.stack.length
          ? '<button type="button" class="zbp-act" data-act="up">↑ Up</button>'
          : "") +
        "</div></div>";
    } else if (!state.peripheral && !part) {
      html += '<p class="zbp-hint">Click a part · use ℹ for details</p>';
    }
    detailHead.innerHTML = html;

    var key = detailListKey(part);
    if (key !== listKey) {
      listKey = key;
      detailList.innerHTML = detailListHtml(part);
      activeEls = [];
    }
    syncActive();
    detailCtx.part = part;
    detailCtx.infoPart = infoPart;
  }

  var lastCrumbHtml = null;
  var detailHead = null;
  var detailList = null;
  var listKey = null;
  var activeEls = [];

  function detailRegions() {
    if (detailHead && detailHead.parentNode === detail) return;
    detail.innerHTML =
      '<div class="zbp-detail-head"></div><div class="zbp-detail-list"></div>';
    detailHead = detail.firstChild;
    detailList = detail.lastChild;
    listKey = null;
  }

  function openTreeKey() {
    return Object.keys(state.treeOpen)
      .filter(function (id) {
        return state.treeOpen[id] === true;
      })
      .join("\u0001");
  }

  /** Everything the contextual list depends on except the selection. */
  function detailListKey(part) {
    var sep = "\u0000";
    if (state.peripheral) return "p" + sep + state.peripheral;
    if (part && hasChildren(part)) {
      if (part.kind === "pin_array") return "a" + sep + part.id;
      return "c" + sep + part.id + sep + state.query + sep + openTreeKey();
    }
    if (!part) return "t" + sep + state.query + sep + openTreeKey();
    return "";
  }

  function attrValue(id) {
    return String(id).replace(/["\\]/g, "\\$&");
  }

  /** Move .active in the list to the current selection without rebuilding. */
  function syncActive() {
    activeEls.forEach(function (el) {
      el.classList.remove("active");
    });
    activeEls = [];
    if (!state.selected || !detailList.firstChild) return;
    var v = attrValue(state.selected);
    detailList
      .querySelectorAll(
        '.zbp-tlabel[data-id="' + v + '"], .zbp-pin[data-id="' + v + '"], ' +
          '.zbp-tlabel[data-focus="' + v + '"]'
      )
      .forEach(function (el) {
        el.classList.add("active");
        activeEls.push(el);
        var row = el.closest(".zbp-mux-row");
        if (row) {
          row.classList.add("active");
          activeEls.push(row);
        }
      });
  }

  /** Open/close one tree row in place; false when a full render is needed. */
  function toggleTreeRow(btn, id, open) {
    var li = btn.closest("li");
    var found = index.find(id);
    if (!li || !found || !detailList.contains(li)) return false;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.textContent = open ? "▾" : "▸";
    var sub = li.lastElementChild;
    if (sub && sub.tagName === "UL") sub.remove();
    if (open) li.insertAdjacentHTML("beforeend", renderTree(found.part.children, 1));
    listKey = detailListKey(detailCtx.part);
    activeEls = activeEls.filter(function (el) {
      return el.isConnected;
    });
    syncActive();
    return true;
  }

  function detailListHtml(part) {
    var html = "";
    if (state.peripheral) {
      html += peripheralDetailHtml(state.peripheral);
    } else if (part && hasChildren(part) && part.kind === "pin_array") {
      html +=
        '<p class="zbp-list-label">Pins</p>' +
        '<div class="zbp-pin-grid">' +
        part.children
          .map(function (c) {
            return (
              '<button type="button" class="zbp-pin' +
              (c.id === state.selected ? " active" : "") +
              '" data-id="' +
              escapeHtml(c.id) +
              '">' +
              escapeHtml(c.silk || c.id) +
              "</button>"
            );
          })
          .join("") +
        "</div>";
    } else if (part && hasChildren(part) && part.kind !== "pin_array") {
      html += '<p class="zbp-list-label">Children</p>';
      html += renderTree(part.children, 0);
    } else if (!state.peripheral && !part) {
      html += renderTree(topParts(), 0);
    }
    return html;
  }

  // What the delegated detail handlers act on (set by the last renderDetail).
  var detailCtx = { part: null, infoPart: null };

  crumb.addEventListener("click", function (ev) {
    var btn = ev.target.closest(".zbp-crumb");
    if (!btn || !crumb.contains(btn)) return;
    var up = btn.getAttribute("data-up");
    if (up === "all") state.stack = [];
    else state.stack = state.stack.slice(0, Number(up) + 1);
    state.infoOpen = false;
    hidePopover();
    render();
  });

  function runDetailAction(act) {
    var part = detailCtx.part;
    var infoPart = detailCtx.infoPart;
    var target = infoPart || part;
    if (act === "expand" && target && hasChildren(target)) {
      if (state.stack[state.stack.length - 1] !== target.id) {
        state.stack.push(target.id);
      }
      state.treeOpen[target.id] = true;
      state.infoOpen = false;
      render();
      focusOnPart(target.id);
    } else if (act === "info" && target) {
      state.infoOpen = true;
      renderDetail(target);
    } else if (act === "close-info") {
      state.infoOpen = false;
      // Closing on a leaf (or under a peri filter) clears selection so the
      // card actually goes away instead of reappearing as a leaf default.
      if (state.peripheral || (infoPart && !hasChildren(infoPart))) {
        state.selected = null;
      }
      render();
    } else if (act === "up") {
      state.stack.pop();
      state.infoOpen = false;
      render();
    }
  }

  detail.addEventListener("click", function (ev) {
    var btn = ev.target.closest("button");
    if (!btn || !detail.contains(btn)) return;
    var id;
    if (btn.hasAttribute("data-act")) {
      runDetailAction(btn.getAttribute("data-act"));
    } else if (btn.hasAttribute("data-toggle")) {
      ev.preventDefault();
      ev.stopPropagation();
      id = btn.getAttribute("data-toggle");
      state.treeOpen[id] = state.treeOpen[id] !== true;
      if (!toggleTreeRow(btn, id, state.treeOpen[id])) renderDetail(detailCtx.part);
    } else if (btn.classList.contains("zbp-info")) {
      ev.preventDefault();
      ev.stopPropagation();
      id = btn.getAttribute("data-info");
      if (id) openPartInfo(id);
    } else if (btn.classList.contains("zbp-tlabel") || btn.classList.contains("zbp-pin")) {
      ev.preventDefault();
      id = btn.getAttribute("data-focus") || btn.getAttribute("data-id");
      if (id) selectPartHighlight(id);
    }
  });

  function render() {
    renderOverlay();
    renderDetail();
  }

  // Kill browser image/text selection flash (white box) on double-click / drag.
  stage.addEventListener("selectstart", function (ev) {
    ev.preventDefault();
  });
  stage.addEventListener("dblclick", function (ev) {
    if (ev.target.closest(".zbp-hit, .zbp-popover, .zbp-view-controls")) return;
    ev.preventDefault();
    if (window.getSelection) {
      var sel = window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    }
  });

  stage.addEventListener("click", function (ev) {
    if (state.panMoved) {
      state.panMoved = false;
      return;
    }
    if (ev.target.closest(".zbp-view-controls, .zbp-popover")) return;
    var paired = pairedHit(ev);
    if (paired) {
      openMarkerPopover(paired, ev);
      return;
    }
    // Pan / empty-canvas click must not clear highlight, expand, or peripheral.
    hidePopover();
  });

  controls.querySelectorAll("[data-view]").forEach(function (btn) {
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var act = btn.getAttribute("data-view");
      if (act === "clear") {
        clearSelection();
        return;
      }
      if (act === "focus") {
        focusOnSelection();
        return;
      }
      var rect = stage.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      if (act === "in") zoomAt(cx, cy, state.view.scale * 1.25);
      else if (act === "out") zoomAt(cx, cy, state.view.scale / 1.25);
      else if (act === "rot-cw") rotateView(90);
      else if (act === "rot-ccw") rotateView(-90);
      else if (act === "reset") resetView();
    });
  });

  stage.addEventListener(
    "wheel",
    function (ev) {
      if (ev.target.closest(".zbp-side")) return;
      ev.preventDefault();
      var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomAt(ev.clientX, ev.clientY, state.view.scale * factor);
    },
    { passive: false }
  );

  stage.addEventListener("pointerdown", function (ev) {
    if (ev.button !== 0) return;
    if (ev.target.closest(".zbp-hit, .zbp-popover, .zbp-view-controls")) return;
    hidePopover();
    stopViewTween();
    state.panning = true;
    state.panMoved = false;
    state.panStart = {
      x: ev.clientX,
      y: ev.clientY,
      tx: state.view.tx,
      ty: state.view.ty,
    };
    stage.classList.add("zbp-panning");
    try {
      stage.setPointerCapture(ev.pointerId);
    } catch (e) {
      /* ignore */
    }
  });

  stage.addEventListener("pointermove", function (ev) {
    if (!state.panning || !state.panStart) return;
    var dx = ev.clientX - state.panStart.x;
    var dy = ev.clientY - state.panStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) state.panMoved = true;
    state.view.tx = state.panStart.tx + dx;
    state.view.ty = state.panStart.ty + dy;
    applyViewTransform();
  });

  function endPan(ev) {
    if (!state.panning) return;
    state.panning = false;
    state.panStart = null;
    stage.classList.remove("zbp-panning");
    try {
      if (ev && ev.pointerId != null) stage.releasePointerCapture(ev.pointerId);
    } catch (e) {
      /* ignore */
    }
  }
  stage.addEventListener("pointerup", endPan);
  stage.addEventListener("pointercancel", endPan);

  // Typing is debounced so a 1000-part filter isn't re-run per keystroke.
  var searchTimer = null;
  function applySearch() {
    searchTimer = null;
    state.query = search.value.trim();
    if (state.query) {
      // Open every branch that is, or contains, a match.
      index.subtreeMatches(matchesFilters).forEach(function (id) {
        state.treeOpen[id] = true;
      });
    }
    render();
  }

  if (search) {
    search.addEventListener("input", function () {
      updateSearchClear();
      if (searchTimer !== null) clearTimeout(searchTimer);
      searchTimer = setTimeout(applySearch, SEARCH_DEBOUNCE_MS);
    });
  }

  if (searchClear) {
    searchClear.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (!search) return;
      if (searchTimer !== null) clearTimeout(searchTimer);
      searchTimer = null;
      search.value = "";
      state.query = "";
      updateSearchClear();
      search.focus();
      render();
    });
  }
  updateSearchClear();

  if (periSelect) {
    periSelect.addEventListener("change", function () {
      state.peripheral = periSelect.value || "";
      state.selected = null;
      state.infoOpen = false;
      // Show peri pins on the top-level overlay (not inside a drilled group).
      if (state.peripheral) state.stack = [];
      hidePopover();
      render();
      if (state.peripheral) {
        // Zoom after layout so imageBox / stage size are current.
        requestAnimationFrame(function () {
          focusOnPeripheral(state.peripheral);
        });
      } else {
        resetView();
      }
    });
  }

  if (softwareSelect) {
    softwareSelect.addEventListener("change", function () {
      state.software = softwareSelect.value || "";
      hidePopover();
      render();
    });
  }

  var resizeFrame = 0;
  window.addEventListener("resize", function () {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(function () {
      resizeFrame = 0;
      renderOverlay();
    });
  });

  applyViewTransform();
  refreshPeripheralOptions();
  // First paint even before image loads (placeholders)
  render();
}

export function boot() {
  document.querySelectorAll(".board-pinout").forEach(initWidget);
}
