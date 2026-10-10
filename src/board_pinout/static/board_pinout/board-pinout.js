(() => {
  // ../src/board_pinout/static/board_pinout/js/util.js
  var MARKER_R = 3.25;
  var LABEL_GAP = 14;
  var CENTER_POINT = [0.5, 0.5];
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function hasChildren(part) {
    return !!(part && part.children && part.children.length);
  }
  function ensurePoint(part, fallback) {
    fallback = fallback || CENTER_POINT;
    if (!part) return part;
    var pt = part.point;
    if (!Array.isArray(pt) || pt.length < 2 || !isFinite(Number(pt[0])) || !isFinite(Number(pt[1]))) {
      part.point = [fallback[0], fallback[1]];
    }
    return part;
  }

  // ../src/board_pinout/static/board_pinout/js/mux.js
  function normalizeMuxEntry(entry) {
    if (!entry || entry.function == null || entry.function === "") return null;
    var fn = String(entry.function).trim();
    var peripheral = String(entry.peripheral || "").trim();
    var signal = String(entry.signal || "").trim();
    if (!peripheral && entry.class === "gpio") peripheral = "gpio";
    if (!peripheral) {
      var m = fn.match(/^([A-Za-z][A-Za-z0-9]*)[_./-](.+)$/);
      if (m) {
        peripheral = m[1];
        if (!signal) signal = m[2];
      } else {
        peripheral = fn;
      }
    }
    return {
      mode: entry.mode,
      function: fn,
      peripheral: peripheral.toLowerCase(),
      signal: signal || fn,
      source: entry.source
    };
  }
  function excludedBy(patterns, raw) {
    for (var i = 0; i < patterns.length; i++) {
      var pat = patterns[i];
      if (pat.slice(-2) === ".*") {
        var prefix = pat.slice(0, -2);
        if (raw.peripheral ? raw.peripheral === prefix : String(raw.function).indexOf(prefix + "_") === 0) {
          return true;
        }
      } else if (raw.function === pat) {
        return true;
      }
    }
    return false;
  }
  function routedEntries(part, socRouting, cache) {
    var ids = part && part.routing || [];
    if (!ids.length || !socRouting) return [];
    var excludes = part.routing_exclude || [];
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var rule = socRouting[ids[i]];
      if (!rule) continue;
      var all = cache && cache.get(ids[i]);
      if (!all) {
        all = (rule.functions || []).map(function(f) {
          return { raw: f, mux: normalizeMuxEntry(Object.assign({ source: "routing" }, f)) };
        }).filter(function(x) {
          return x.mux;
        });
        if (cache) cache.set(ids[i], all);
      }
      var kept = excludes.length ? all.filter(function(x) {
        return !excludedBy(excludes, x.raw);
      }) : all;
      out.push({
        id: ids[i],
        kind: rule.kind,
        label: rule.label || rule.kind,
        notes: rule.notes,
        mux: kept.map(function(x) {
          return x.mux;
        })
      });
    }
    return out;
  }
  function partAssignments(part) {
    return (part && part.assignments || []).filter(Boolean);
  }
  function assignmentOwner(a, software) {
    if (a.by) return String(a.by);
    var ids = Object.keys(software || {});
    return ids.length === 1 ? ids[0] : "";
  }
  function assignmentMatcher(a) {
    if (a.function) {
      var fn = String(a.function).toUpperCase();
      return function(m) {
        return String(m.function).toUpperCase() === fn;
      };
    }
    if (!a.owner || !a.role) return null;
    var owner = String(a.owner).toLowerCase();
    var role = String(a.role).toLowerCase();
    return function(m) {
      return m.peripheral === owner && String(m.signal).toLowerCase() === role;
    };
  }

  // ../src/board_pinout/static/board_pinout/js/model.js
  function buildIndex(topParts, socRouting, software) {
    var byId = /* @__PURE__ */ new Map();
    var order = [];
    var periRows = {};
    var ruleCache = /* @__PURE__ */ new Map();
    var routedRuleCount = 0;
    function addPeri(peris, m, id) {
      peris.add(m.peripheral);
      var row = periRows[m.peripheral];
      if (!row) {
        row = periRows[m.peripheral] = {
          id: m.peripheral,
          signals: {},
          pinIds: [],
          seen: /* @__PURE__ */ new Set()
        };
      }
      row.signals[m.signal] = true;
      if (!row.seen.has(id)) {
        row.seen.add(id);
        row.pinIds.push(id);
      }
    }
    function assignmentPicks(p, mux, routed) {
      var fns = /* @__PURE__ */ new Map();
      var by = /* @__PURE__ */ new Set();
      var added = [];
      function pick(fn, owner) {
        if (!fns.has(fn)) fns.set(fn, []);
        if (fns.get(fn).indexOf(owner) < 0) fns.get(fn).push(owner);
      }
      partAssignments(p).forEach(function(a) {
        var owner = assignmentOwner(a, software);
        by.add(owner);
        var match = assignmentMatcher(a);
        if (!match) return;
        var hit = mux.find(match);
        if (hit) {
          pick(hit.function, owner);
          return;
        }
        for (var g = 0; g < routed.length; g++) {
          hit = routed[g].mux.find(match);
          if (hit) {
            pick(hit.function, owner);
            if (!added.some(function(m) {
              return m.function === hit.function;
            })) {
              added.push(Object.assign({}, hit, { mode: routed[g].label }));
            }
            return;
          }
        }
      });
      return { fns, by, added };
    }
    function walk(list, parent, trail) {
      for (var i = 0; i < (list || []).length; i++) {
        var p = list[i];
        if (!p || p.id == null) continue;
        var path = trail.concat([p.id]);
        var all = (p.mux || []).map(normalizeMuxEntry).filter(Boolean);
        var mux = all.filter(function(m) {
          return m.source !== "routing";
        });
        var peris = /* @__PURE__ */ new Set();
        for (var j = 0; j < mux.length; j++) addPeri(peris, mux[j], p.id);
        var routed = routedEntries(p, socRouting, ruleCache);
        if (mux.length !== all.length) {
          routed = routed.concat([{
            id: null,
            kind: "routing",
            label: "Routable",
            notes: null,
            mux: all.filter(function(m) {
              return m.source === "routing";
            })
          }]);
        }
        if (routed.length) routedRuleCount += 1;
        var picks = assignmentPicks(p, mux, routed);
        picks.added.forEach(function(m) {
          addPeri(peris, m, p.id);
        });
        mux = mux.concat(picks.added);
        var entry = {
          part: p,
          parent,
          path,
          mux,
          routed,
          peris,
          assignedFns: picks.fns,
          usedBy: picks.by,
          hay: null
        };
        if (!byId.has(p.id)) byId.set(p.id, entry);
        order.push(entry);
        walk(p.children, p, path);
      }
    }
    walk(topParts, null, []);
    var peripherals = Object.keys(periRows).sort().map(function(k) {
      var row = periRows[k];
      return {
        id: row.id,
        signals: Object.keys(row.signals).sort(),
        pinIds: row.pinIds
      };
    });
    var periById = /* @__PURE__ */ new Map();
    peripherals.forEach(function(p) {
      periById.set(p.id, p);
    });
    function entryFor(partOrId) {
      if (partOrId == null) return null;
      var id = typeof partOrId === "object" ? partOrId.id : partOrId;
      return byId.get(id) || null;
    }
    function haystack(entry) {
      if (entry.hay === null) {
        var part = entry.part;
        var aHay = partAssignments(part).map(function(a) {
          var sw = (software || {})[assignmentOwner(a, software)];
          var cfg = Object.keys(a.config || {}).map(function(k) {
            var v = a.config[k];
            return typeof v === "object" ? JSON.stringify(v) : String(v);
          });
          return [sw && sw.name, a.owner, a.role, a.function].concat(cfg).filter(Boolean).join(" ");
        }).join(" ");
        var muxHay = entry.mux.map(function(m) {
          return [m.peripheral, m.signal, m.function, m.mode].filter(Boolean).join(" ");
        }).join(" ");
        entry.hay = [part.id, part.silk, part.pad, part.ref, part.kind, part.notes, aHay, muxHay].filter(Boolean).join(" ").toLowerCase();
      }
      return entry.hay;
    }
    return {
      size: order.length,
      /** { part, parent } for an id, or null. */
      find: function(id) {
        var e = byId.get(id);
        return e ? { part: e.part, parent: e.parent } : null;
      },
      /** Ids from the top-level ancestor down to ``id`` (empty when unknown). */
      path: function(id) {
        var e = byId.get(id);
        return e ? e.path.slice() : [];
      },
      mux: function(part) {
        var e = entryFor(part);
        if (e) return e.mux;
        return (part && part.mux || []).map(normalizeMuxEntry).filter(Boolean);
      },
      hasPeripheral: function(part, peri) {
        if (!peri) return true;
        var e = entryFor(part);
        return !!e && e.peris.has(String(peri).toLowerCase());
      },
      /** ``[{id, kind, label, notes, mux}]`` routing groups that apply to ``part``. */
      routed: function(part) {
        var e = entryFor(part);
        return e ? e.routed : routedEntries(part, socRouting, ruleCache);
      },
      /** ``Map<function, softwareId[]>`` of functions software selects on ``part``. */
      assignedFunctions: function(part) {
        var e = entryFor(part);
        return e ? e.assignedFns : /* @__PURE__ */ new Map();
      },
      /** True when ``part`` has an assignment by software ``id`` (any when empty). */
      usedBy: function(part, id) {
        if (!id) return true;
        var e = entryFor(part);
        return !!e && e.usedBy.has(id);
      },
      signalsFor: function(part, peri) {
        var key = String(peri || "").toLowerCase();
        return this.mux(part).filter(function(m) {
          return !key || m.peripheral === key;
        }).map(function(m) {
          return m.signal;
        });
      },
      /** Number of parts that have routing groups (crossbar etc.). */
      routedParts: function() {
        return routedRuleCount;
      },
      /** Same shape and order as collectPeripherals(). */
      peripherals: function() {
        return peripherals;
      },
      peripheral: function(id) {
        return periById.get(id) || null;
      },
      /** ``query`` must already be lower-cased. */
      matchesQuery: function(part, query) {
        if (!query) return true;
        var e = entryFor(part);
        if (!e) return false;
        return haystack(e).indexOf(query) !== -1;
      },
      /**
       * Ids of every part whose subtree (itself included) satisfies ``pred``.
       * One pass plus an ancestor walk that stops at the first marked ancestor.
       */
      subtreeMatches: function(pred) {
        var hits = /* @__PURE__ */ new Set();
        for (var i = 0; i < order.length; i++) {
          var e = order[i];
          if (!pred(e.part)) continue;
          for (var k = e.path.length - 1; k >= 0; k--) {
            if (hits.has(e.path[k])) break;
            hits.add(e.path[k]);
          }
        }
        return hits;
      }
    };
  }

  // ../src/board_pinout/static/board_pinout/js/labels.js
  function uniqueAxisCount(values, eps) {
    var sorted = values.slice().sort(function(a, b) {
      return a - b;
    });
    var count = 0;
    var last = -Infinity;
    sorted.forEach(function(v) {
      if (v - last > eps) {
        count += 1;
        last = v;
      }
    });
    return count;
  }
  function screenReadableLabelRot(labelRot, viewRot) {
    var lr = Number(labelRot) || 0;
    var vr = Number(viewRot) || 0;
    var screen = ((lr + vr) % 360 + 360) % 360;
    if (screen > 180) screen -= 360;
    if (screen > 90 || screen < -90) lr += 180;
    return lr;
  }
  function estimateLabelWidth(part) {
    var label = part && (part.silk || part.id) || "";
    return Math.max(28, String(label).length * 6.2 + 10);
  }
  function fitOffsetInStage(off, pt, tw, th, stageW, stageH, pad) {
    var dx = off.dx;
    var dy = off.dy;
    var rot = off.rotation || 0;
    var vertical = Math.abs(dy) > Math.abs(dx);
    var footW = vertical || Math.abs(rot) === 90 || Math.abs(rot) === 270 ? th : tw;
    var footH = vertical || Math.abs(rot) === 90 || Math.abs(rot) === 270 ? tw : th;
    function bounds(tdx, tdy) {
      var lx = pt.x + tdx;
      var ly = pt.y + tdy;
      var rx;
      var ry;
      var vert = Math.abs(tdy) > Math.abs(tdx);
      if (vert) {
        rx = lx - footW / 2;
        ry = tdy >= 0 ? ly : ly - footH;
      } else if (tdx >= 0) {
        rx = lx;
        ry = ly - footH / 2;
      } else {
        rx = lx - footW;
        ry = ly - footH / 2;
      }
      return { rx, ry, rw: footW, rh: footH };
    }
    var b = bounds(dx, dy);
    if (b.rx < pad && dx <= 0) dx = Math.abs(dx) || LABEL_GAP + 42;
    b = bounds(dx, dy);
    if (b.rx + b.rw > stageW - pad && dx >= 0) dx = -(Math.abs(dx) || LABEL_GAP + 42);
    if (!off.lockSide) {
      b = bounds(dx, dy);
      if (b.ry < pad && dy <= 0) dy = Math.abs(dy) || LABEL_GAP + 26;
      b = bounds(dx, dy);
      if (b.ry + b.rh > stageH - pad && dy >= 0) dy = -(Math.abs(dy) || LABEL_GAP + 26);
    }
    return { dx, dy, rotation: rot, lockSide: off.lockSide };
  }
  function computeAutoLabelOffsets(list, box, stageW, stageH) {
    var n = list.length;
    if (!n) return [];
    stageW = stageW || box.left * 2 + box.width;
    stageH = stageH || box.top * 2 + box.height;
    var pad = 8;
    var pts = list.map(function(p) {
      var pt = p.point || CENTER_POINT;
      return {
        x: box.left + Number(pt[0]) * box.width,
        y: box.top + Number(pt[1]) * box.height
      };
    });
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    pts.forEach(function(pt) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    });
    var midX = (minX + maxX) / 2;
    var midY = (minY + maxY) / 2;
    var spanX = Math.max(maxX - minX, 1);
    var spanY = Math.max(maxY - minY, 1);
    var nX = uniqueAxisCount(
      pts.map(function(p) {
        return p.x;
      }),
      4
    );
    var nY = uniqueAxisCount(
      pts.map(function(p) {
        return p.y;
      }),
      4
    );
    var dualRowHeader = nY === 2 && nX >= 4;
    var tallStrip = spanX < 14 && spanY > spanX * 1.2;
    var gap = LABEL_GAP + 42;
    var vGap = LABEL_GAP + 26;
    return pts.map(function(pt, i) {
      var authored = list[i].label_offset;
      var authoredRot = list[i].label_rotation;
      var rotAuth = authoredRot !== void 0 && authoredRot !== null && authoredRot !== "" && isFinite(Number(authoredRot));
      var tw = estimateLabelWidth(list[i]);
      if (authored && authored.length === 2) {
        return fitOffsetInStage(
          {
            dx: Number(authored[0]) * box.width,
            dy: Number(authored[1]) * box.height,
            rotation: rotAuth ? Number(authoredRot) : 0
          },
          pt,
          tw,
          16,
          stageW,
          stageH,
          pad
        );
      }
      if (dualRowHeader) {
        var up = pt.y <= midY;
        return fitOffsetInStage(
          {
            dx: 0,
            dy: up ? -vGap : vGap,
            rotation: rotAuth ? Number(authoredRot) : -90,
            lockSide: true
          },
          pt,
          tw,
          16,
          stageW,
          stageH,
          pad
        );
      }
      if (tallStrip) {
        return fitOffsetInStage(
          {
            dx: gap,
            dy: 0,
            rotation: rotAuth ? Number(authoredRot) : 0
          },
          pt,
          tw,
          16,
          stageW,
          stageH,
          pad
        );
      }
      var side = pt.x <= midX ? -1 : 1;
      return fitOffsetInStage(
        {
          dx: side * gap,
          dy: 0,
          rotation: rotAuth ? Number(authoredRot) : 0
        },
        pt,
        tw,
        16,
        stageW,
        stageH,
        pad
      );
    });
  }
  function layoutLabelBox(cx, cy, off, tw, th) {
    var lx = cx + off.dx;
    var ly = cy + off.dy;
    var vertical = Math.abs(off.dy) > Math.abs(off.dx);
    var side = vertical ? off.dy >= 0 ? "bottom" : "top" : off.dx >= 0 ? "right" : "left";
    var rx;
    var ry;
    var textX;
    var textY;
    var anchor;
    var tipX = lx;
    var tipY = ly;
    if (vertical) {
      if (off.dy >= 0) {
        rx = lx - tw / 2;
        ry = ly;
        textX = lx;
        textY = ly + th / 2 + 3.5;
        anchor = "middle";
      } else {
        rx = lx - tw / 2;
        ry = ly - th;
        textX = lx;
        textY = ly - th / 2 + 3.5;
        anchor = "middle";
      }
    } else if (off.dx >= 0) {
      rx = lx;
      ry = ly - th / 2;
      textX = lx + 5;
      textY = ly + 3.5;
      anchor = "start";
    } else {
      rx = lx - tw;
      ry = ly - th / 2;
      textX = lx - 5;
      textY = ly + 3.5;
      anchor = "end";
    }
    return {
      side,
      lx,
      ly,
      rx,
      ry,
      textX,
      textY,
      anchor,
      tipX,
      tipY
    };
  }

  // ../src/board_pinout/static/board_pinout/js/view.js
  function imageBox(stage, img) {
    var sw = stage.clientWidth || 1;
    var sh = stage.clientHeight || 1;
    var natW = img.naturalWidth || sw;
    var natH = img.naturalHeight || sh;
    var scale = Math.min(sw / natW, sh / natH);
    var width = natW * scale;
    var height = natH * scale;
    return {
      left: (sw - width) / 2,
      top: (sh - height) / 2,
      width,
      height
    };
  }
  function resolveUnderlay(payload, root) {
    if (!payload.underlay) return "";
    var path = payload.underlay.replace(/^\/+/, "");
    var urlRoot = window.DOCUMENTATION_OPTIONS && DOCUMENTATION_OPTIONS.URL_ROOT || "";
    var candidates = [];
    if (urlRoot) candidates.push(urlRoot + path);
    candidates.push(path);
    candidates.push("../../../../" + path);
    candidates.push("../../../" + path);
    candidates.push("../../" + path);
    if (path.indexOf("_static/") === 0) candidates.push("/" + path);
    var rel = root.getAttribute("data-underlay-rel");
    if (rel) candidates.unshift(rel);
    return candidates;
  }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function tweenView(from, to, stageW, stageH, apply, opts) {
    opts = opts || {};
    var s0 = from.scale;
    var s1 = to.scale;
    var cx = stageW / 2;
    var cy = stageH / 2;
    var w0x = (cx - from.tx) / s0;
    var w0y = (cy - from.ty) / s0;
    var w1x = (cx - to.tx) / s1;
    var w1y = (cy - to.ty) / s1;
    var dist = Math.hypot((w1x - w0x) * s1, (w1y - w0y) * s1);
    var zoomSteps = Math.abs(Math.log(s1 / s0));
    if (reducedMotion() || dist < 1 && zoomSteps < 0.01) {
      apply({ tx: to.tx, ty: to.ty, scale: s1 });
      if (opts.done) opts.done();
      return function() {
      };
    }
    var duration = opts.duration != null ? opts.duration : Math.min(650, 260 + dist * 0.35 + zoomSteps * 120);
    var start = null;
    var raf = 0;
    function frame(now) {
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / duration);
      var e = easeInOutCubic(t);
      if (t >= 1) {
        apply({ tx: to.tx, ty: to.ty, scale: s1 });
        raf = 0;
        if (opts.done) opts.done();
        return;
      }
      var s = s0 * Math.pow(s1 / s0, e);
      var wx = w0x + (w1x - w0x) * e;
      var wy = w0y + (w1y - w0y) * e;
      apply({ tx: cx - wx * s, ty: cy - wy * s, scale: s });
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return function() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
  }

  // ../src/board_pinout/static/board_pinout/js/widget.js
  var PAYLOAD_VERSION = 1;
  var SEARCH_DEBOUNCE_MS = 150;
  function showLoadMessage(root, text) {
    var detail = root.querySelector(".zbp-detail");
    var html = '<p class="zbp-hint zbp-load-msg">' + escapeHtml(text) + "</p>";
    var old = root.querySelector(".zbp-load-msg");
    if (old) old.remove();
    if (detail) detail.innerHTML = html;
    else root.insertAdjacentHTML("beforeend", html);
  }
  function whenVisible(el, fn) {
    if (typeof IntersectionObserver === "undefined") {
      fn();
      return;
    }
    var io = new IntersectionObserver(
      function(entries) {
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
    showLoadMessage(root, "Loading pinout\u2026");
    fetch(src, { credentials: "same-origin" }).then(function(resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    }).then(
      function(payload) {
        var msg = root.querySelector(".zbp-load-msg");
        if (msg) msg.remove();
        mountWidget(root, payload);
      },
      function(err) {
        showLoadMessage(
          root,
          "Pinout data failed to load (" + (err && err.message ? err.message : err) + ")."
        );
      }
    );
  }
  function initWidget(root) {
    if (root.__zbpInit) return;
    root.__zbpInit = true;
    var src = root.getAttribute("data-src");
    if (src) {
      whenVisible(root, function() {
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
  function mountWidget(root, payload) {
    var doc = payload.doc || {};
    var face = (doc.faces || {})[payload.face || "top"] || { children: [] };
    (face.children || []).forEach(function(p) {
      ensurePoint(p);
    });
    var software = doc.software || {};
    var softwareIds = Object.keys(software);
    var index = buildIndex(face.children || [], doc.soc_routing, software);
    var findPart = function(_parts, id) {
      return index.find(id);
    };
    var partMuxEntries = function(part) {
      return index.mux(part);
    };
    var defaultFunction = function(part) {
      var reset = part && part.pad_info && part.pad_info.reset;
      if (!reset) return null;
      if (reset.function) return String(reset.function);
      if (reset.mode !== "input" && reset.mode !== "output") return null;
      var gpio = partMuxEntries(part).find(function(m) {
        return m.peripheral === "gpio";
      });
      return gpio ? gpio.function : null;
    };
    var softwareName = function(id) {
      var sw = software[id];
      return sw && sw.name || id || "software";
    };
    var softwareTags = function(part, fns) {
      var seen = {};
      return fns.reduce(function(ids, fn) {
        return ids.concat(index.assignedFunctions(part).get(fn) || []);
      }, []).filter(function(id) {
        if (seen[id]) return false;
        seen[id] = true;
        return true;
      }).map(function(id) {
        var name = softwareName(id);
        return '<span class="zbp-tag-default zbp-tag-software" title="Selected by ' + escapeHtml(name) + ' on this board">' + escapeHtml(name) + "</span>";
      }).join("");
    };
    var RESET_TAG = '<span class="zbp-tag-default" title="Function the SoC selects at power-on reset, before software configures the pin">reset</span>';
    var routingNote = function() {
      var rules = doc.soc_routing || {};
      return Object.keys(rules).map(function(id) {
        var r = rules[id];
        var n = (r.functions || []).length;
        return (r.label || r.kind) + ": " + n + " more signal(s) can be routed to " + (r.kind === "any_pin" ? "any GPIO" : "some pins") + ". The filter lists fixed pad (IO_MUX) functions only.";
      }).join(" ");
    };
    var partHasPeripheral = function(part, peri) {
      return index.hasPeripheral(part, peri);
    };
    var muxSignalsForPeripheral = function(part, peri) {
      return index.signalsFor(part, peri);
    };
    var collectPeripherals = function() {
      return index.peripherals();
    };
    var layoutCache = /* @__PURE__ */ new Map();
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
        searchClear.textContent = "\xD7";
        wrap.appendChild(searchClear);
      }
    }
    var sideTools = side && side.querySelector(".zbp-side-tools");
    if (side && !sideTools) {
      sideTools = document.createElement("div");
      sideTools.className = "zbp-side-tools";
      sideTools.innerHTML = '<label class="zbp-peri-label">Peripheral<select class="zbp-peripheral" aria-label="Filter by peripheral"><option value="">All peripherals</option></select></label><p class="zbp-peri-hint">Select a peripheral to highlight and zoom to its pins</p>';
      side.insertBefore(sideTools, side.firstChild);
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
    var softwareSelect = null;
    if (sideTools && softwareIds.length > 1) {
      var swLabel = document.createElement("label");
      swLabel.className = "zbp-peri-label zbp-software-label";
      swLabel.textContent = "Software";
      softwareSelect = document.createElement("select");
      softwareSelect.className = "zbp-software";
      softwareSelect.setAttribute("aria-label", "Filter by software");
      softwareSelect.innerHTML = '<option value="">All software</option>' + softwareIds.map(function(id) {
        return '<option value="' + escapeHtml(id) + '">' + escapeHtml(softwareName(id)) + "</option>";
      }).join("");
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
      panStart: null
    };
    function refreshPeripheralOptions() {
      if (!periSelect) return;
      var peris = collectPeripherals(topParts());
      var prev = state.peripheral;
      periSelect.innerHTML = '<option value="">All peripherals</option>' + peris.map(function(p) {
        return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.id) + " (" + p.pinIds.length + ")</option>";
      }).join("");
      periSelect.disabled = peris.length === 0;
      if (periHint) {
        periHint.textContent = peris.length ? "Select a peripheral to highlight and zoom to its pins" : "No mux peripherals yet \u2014 add mux entries on pins in pinout.yaml";
        var note = routingNote();
        if (note) {
          var noteEl = document.createElement("span");
          noteEl.className = "zbp-peri-routing";
          noteEl.textContent = note;
          periHint.appendChild(noteEl);
        }
      }
      if (prev && peris.some(function(p) {
        return p.id === prev;
      })) {
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
      if (!state.peripheral) {
        var path = pathToId(id);
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
    var faceRotInit = Number(face.underlay_rotation);
    if (isFinite(faceRotInit)) {
      state.view.rotation = (Math.round(faceRotInit / 90) % 4 + 4) % 4 * 90;
    }
    var controls = stage.querySelector(".zbp-view-controls");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "zbp-view-controls";
      controls.innerHTML = '<button type="button" class="zbp-view-btn" data-view="clear" title="Clear selection">\u2715</button><button type="button" class="zbp-view-btn" data-view="focus" title="Focus on selection">\u25CE</button><button type="button" class="zbp-view-btn" data-view="rot-ccw" title="Rotate underlay \u221290\xB0">\u21BA</button><button type="button" class="zbp-view-btn" data-view="rot-cw" title="Rotate underlay +90\xB0">\u21BB</button><button type="button" class="zbp-view-btn" data-view="out" title="Zoom out">\u2212</button><button type="button" class="zbp-view-btn" data-view="in" title="Zoom in">+</button><button type="button" class="zbp-view-btn" data-view="reset" title="Reset view">\u27F2</button>';
      stage.appendChild(controls);
    } else {
      let ensureViewBtn = function(act, title, text, beforeAct) {
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
      };
      ensureViewBtn("clear", "Clear selection", "\u2715", "focus");
      ensureViewBtn("focus", "Focus on selection", "\u25CE", "rot-ccw");
      ensureViewBtn("rot-ccw", "Rotate underlay \u221290\xB0", "\u21BA", "out");
      ensureViewBtn("rot-cw", "Rotate underlay +90\xB0", "\u21BB", "out");
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
      d = (Math.round(d / 90) % 4 + 4) % 4 * 90;
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
      viewport.style.transform = "translate(" + v.tx + "px, " + v.ty + "px) scale(" + v.scale + ")";
      rotator.style.transform = v.rotation ? "rotate(" + v.rotation + "deg)" : "";
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
      state.view.tx = x - (x - state.view.tx) * scale / prev;
      state.view.ty = y - (y - state.view.ty) * scale / prev;
      state.view.scale = scale;
      applyViewTransform();
    }
    function rotateView(deltaDeg) {
      stopViewTween();
      state.view.rotation = normalizeRotation(
        (state.view.rotation || 0) + deltaDeg
      );
      applyViewTransform();
      renderOverlay();
    }
    function resetView() {
      stopViewTween();
      var faceRot = Number(face.underlay_rotation);
      state.view = {
        scale: 1,
        tx: 0,
        ty: 0,
        rotation: isFinite(faceRot) ? normalizeRotation(faceRot) : 0
      };
      applyViewTransform();
      renderOverlay();
    }
    function displayPointFor(id) {
      var found = findPart(topParts(), id);
      if (!found) return CENTER_POINT.slice();
      var part = found.part;
      if (!found.parent) return ensurePoint(part).point;
      if (hasChildren(found.parent)) {
        var laid = layoutExpandedChildren(found.parent);
        var kids = found.parent.children;
        var at = kids.indexOf(found.part);
        if (at >= 0 && laid[at] && laid[at].id === id && laid[at].point) {
          return laid[at].point;
        }
        for (var i = 0; i < laid.length; i++) {
          if (laid[i].id === id && laid[i].point) return laid[i].point;
        }
      }
      return part.point && part.point.length === 2 ? part.point : CENTER_POINT.slice();
    }
    function rotatedStagePoint(x, y, sw, sh) {
      var deg = normalizeRotation(state.view.rotation || 0);
      if (!deg) return [x, y];
      var rad = deg * Math.PI / 180;
      var cos = Math.round(Math.cos(rad));
      var sin = Math.round(Math.sin(rad));
      var dx = x - sw / 2;
      var dy = y - sh / 2;
      return [sw / 2 + dx * cos - dy * sin, sh / 2 + dx * sin + dy * cos];
    }
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
        scale,
        tx: sw / 2 - c[0] * scale,
        ty: sh / 2 - c[1] * scale
      };
      stopViewTween();
      cancelTween = tweenView(state.view, target, sw, sh, function(v) {
        state.view.scale = v.scale;
        state.view.tx = v.tx;
        state.view.ty = v.ty;
        applyViewTransform();
      }, {
        done: function() {
          cancelTween = null;
        }
      });
    }
    var periPartsCache = /* @__PURE__ */ new Map();
    function partsForPeripheral(periId) {
      if (!periId) return [];
      var cached = periPartsCache.get(periId);
      if (cached) return cached;
      var peri = index.peripheral(String(periId).toLowerCase());
      var out = [];
      (peri ? peri.pinIds : []).forEach(function(id) {
        var found = index.find(id);
        if (!found) return;
        var pt = displayPointFor(id);
        out.push(
          Object.assign({}, found.part, {
            point: pt && pt.length === 2 ? pt : CENTER_POINT.slice()
          })
        );
      });
      periPartsCache.set(periId, out);
      return out;
    }
    function focusOnPoints(points, opts) {
      opts = opts || {};
      if (!points || !points.length) return;
      var minX = Infinity;
      var minY = Infinity;
      var maxX = -Infinity;
      var maxY = -Infinity;
      points.forEach(function(p) {
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
      if (points.length === 1 || maxX - minX < 1e-6 && maxY - minY < 1e-6) {
        focusOnNorm(cx, cy, { scale: opts.scale != null ? opts.scale : 1.75 });
        return;
      }
      var box = imageBox(stage, img);
      var sw = stage.clientWidth || 1;
      var sh = stage.clientHeight || 1;
      var pad = opts.pad != null ? opts.pad : 0.1;
      var spanW = (Math.max(maxX - minX, 0.02) + pad * 2) * box.width;
      var spanH = (Math.max(maxY - minY, 0.02) + pad * 2) * box.height;
      if (normalizeRotation(state.view.rotation || 0) % 180) {
        var t = spanW;
        spanW = spanH;
        spanH = t;
      }
      var scaleX = sw * 0.78 / Math.max(spanW, 1);
      var scaleY = sh * 0.78 / Math.max(spanH, 1);
      var scale = clampScale(
        Math.min(scaleX, scaleY, opts.maxScale != null ? opts.maxScale : 4)
      );
      focusOnNorm(cx, cy, { scale });
    }
    function focusOnPeripheral(periId) {
      if (!periId) return;
      var parts = partsForPeripheral(periId);
      focusOnPoints(
        parts.map(function(p) {
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
      var root2 = expandRoot();
      if (root2) {
        ensurePoint(root2);
        focusOnNorm(root2.point[0], root2.point[1]);
      }
    }
    var candidates = resolveUnderlay(payload, root);
    var candIdx = 0;
    function tryUnderlay() {
      if (candIdx >= candidates.length) return;
      img.src = candidates[candIdx++];
    }
    img.addEventListener("error", tryUnderlay);
    img.addEventListener("load", function() {
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
        return { rows, cols };
      }
      if (n >= 16) {
        return nearVert ? { rows: Math.ceil(n / 2), cols: 2 } : { rows: 2, cols: Math.ceil(n / 2) };
      }
      cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      rows = Math.max(1, Math.ceil(n / cols));
      return { rows, cols };
    }
    function layoutExpandedChildren(parent) {
      var kids = parent && parent.children || [];
      if (!kids.length) return [];
      var cached = layoutCache.get(parent);
      if (cached) return cached;
      var laid = computeExpandedLayout(parent, kids);
      layoutCache.set(parent, laid);
      return laid;
    }
    function computeExpandedLayout(parent, kids) {
      var allAuthored = kids.every(function(p) {
        return p.point && p.point.length === 2;
      });
      if (allAuthored) return kids;
      var origin = parent.point && parent.point.length === 2 ? parent.point : [0.5, 0.5];
      var grid = inferExpandGrid(parent, kids.length);
      var rows = grid.rows;
      var cols = grid.cols;
      var maxSpanX = 0.22;
      var maxSpanY = 0.28;
      var spacingX = cols > 1 ? Math.min(0.032, maxSpanX / (cols - 1)) : 0;
      var spacingY = rows > 1 ? Math.min(0.032, maxSpanY / (rows - 1)) : 0;
      var ox = origin[0] - (cols - 1) * spacingX / 2;
      var oy = origin[1] - (rows - 1) * spacingY / 2;
      var numbering = parent.numbering || "row_major";
      return kids.map(function(p, i) {
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
          label_offset: p.label_offset || [0.01, -0.014]
        });
      });
    }
    function expandRoot() {
      for (var i = state.stack.length - 1; i >= 0; i--) {
        var f = findPart(topParts(), state.stack[i]);
        if (f && hasChildren(f.part)) return f.part;
      }
      return null;
    }
    function selectedSiblingsLayout() {
      if (!state.selected) return null;
      var found = index.find(state.selected);
      if (!found || !found.parent) return null;
      var shown = expandRoot();
      if (shown && shown.id === found.parent.id) return null;
      var kids = layoutExpandedChildren(found.parent);
      if (!kids.length) return null;
      return kids.map(function(p) {
        return ensurePoint(p);
      });
    }
    function markers() {
      if (state.peripheral) {
        var periList = partsForPeripheral(state.peripheral);
        if (periList.length) return periList;
      }
      var list;
      var siblings = selectedSiblingsLayout();
      if (siblings) {
        list = siblings;
      } else if (!state.stack.length) {
        list = topParts().map(function(p) {
          return ensurePoint(p);
        });
      } else {
        var root2 = expandRoot();
        if (root2) {
          var kids = layoutExpandedChildren(root2);
          list = kids.length ? kids.map(function(p) {
            return ensurePoint(p);
          }) : null;
        }
        if (!list) {
          var cur = currentPart();
          list = cur ? [cur.point && cur.point.length === 2 ? cur : Object.assign({}, cur, { point: displayPointFor(cur.id) })] : topParts().map(function(p) {
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
    var softwareHits = null;
    var softwareKey = null;
    function usedBySoftware(part) {
      if (!state.software) return true;
      if (softwareKey !== state.software) {
        softwareKey = state.software;
        softwareHits = index.subtreeMatches(function(p) {
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
          label: "\u25B8 Expand parts",
          run: function() {
            doExpand(part);
          }
        });
      }
      actions.push({
        act: "info",
        label: "\u2139 View info",
        run: function() {
          doInfo(part);
        }
      });
      var rect = stage.getBoundingClientRect();
      var pop = document.createElement("div");
      pop.className = "zbp-popover";
      var x = clientX - rect.left + 8;
      var y = clientY - rect.top + 8;
      pop.style.left = Math.min(x, Math.max(8, stage.clientWidth - 150)) + "px";
      pop.style.top = Math.min(y, Math.max(8, stage.clientHeight - 90)) + "px";
      pop.innerHTML = actions.map(function(a) {
        return '<button type="button" data-act="' + a.act + '">' + a.label + "</button>";
      }).join("");
      stage.appendChild(pop);
      actions.forEach(function(a) {
        pop.querySelector('[data-act="' + a.act + '"]').addEventListener("click", function(e) {
          e.stopPropagation();
          a.run();
        });
      });
    }
    function groupLabelOffsets(list, box, stageW, stageH) {
      var byGroup = /* @__PURE__ */ new Map();
      return list.map(function(p) {
        var found = index.find(p.id);
        var parent = found && found.parent;
        var offs = byGroup.get(parent);
        if (!offs) {
          var siblings = parent ? layoutExpandedChildren(parent) : topParts().map(function(q) {
            return ensurePoint(q);
          });
          var all = computeAutoLabelOffsets(siblings, box, stageW, stageH);
          offs = /* @__PURE__ */ new Map();
          siblings.forEach(function(q, i) {
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
      var html = list.map(function(p, idx) {
        var cx = box.left + p.point[0] * box.width;
        var cy = box.top + p.point[1] * box.height;
        var off = offsets[idx] || { dx: LABEL_GAP + 42, dy: 0 };
        var label = p.silk || p.id;
        var dim = partIsDimmed(p);
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
        verts.forEach(function(v) {
          if (Array.isArray(v) && v.length >= 2) {
            pts.push([box.left + v[0] * box.width, box.top + v[1] * box.height]);
          }
        });
        pts.push([tipX, tipY]);
        var d = pts.map(function(pt, i) {
          return (i === 0 ? "M" : "L") + pt[0] + " " + pt[1];
        }).join(" ");
        var rot = Number(
          p.label_rotation !== void 0 && p.label_rotation !== null && p.label_rotation !== "" ? p.label_rotation : off.rotation
        );
        if (!isFinite(rot)) rot = 0;
        rot = screenReadableLabelRot(rot, state.view.rotation);
        if (Math.abs(rot) < 1e-6) rot = 0;
        rot = (rot % 360 + 360) % 360;
        if (rot > 180) rot -= 360;
        if (Math.abs(rot) < 1e-6) rot = 0;
        var pivotX = rx + tw / 2;
        var pivotY = ry + th / 2;
        var labelXform = rot ? ' transform="rotate(' + rot + " " + pivotX + " " + pivotY + ')"' : "";
        return '<g class="zbp-hit' + (state.query && matchesQuery(p) ? " zbp-match" : "") + '" data-id="' + escapeHtml(p.id) + '" opacity="' + (dim ? "0.18" : "1") + '"><path d="' + d + '" fill="none" stroke="var(--zbp-line, rgba(245,166,35,0.75))" stroke-width="1" stroke-linejoin="round" /><circle cx="' + cx + '" cy="' + cy + '" r="' + MARKER_R + '" fill="' + fill + '" stroke="#0b1016" stroke-width="1.25" /><g class="zbp-label"' + labelXform + '><rect class="zbp-label-bg" x="' + rx + '" y="' + ry + '" width="' + tw + '" height="' + th + '" rx="3" /><text x="' + textX + '" y="' + textY + '" fill="#f3f6fb" font-size="10" font-family="system-ui,sans-serif" text-anchor="' + anchor + '">' + escapeHtml(label) + "</text></g></g>";
      }).join("");
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
    function hitId(ev) {
      var g = ev.target.closest && ev.target.closest(".zbp-hit");
      return g && overlay.contains(g) ? g.getAttribute("data-id") : null;
    }
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
      return ev.detail >= 2 && lastHit.id && ev.timeStamp - lastHit.t < DOUBLE_CLICK_MS ? lastHit.id : null;
    }
    overlay.addEventListener("click", function(ev) {
      var id = hitId(ev);
      if (!id) return;
      ev.stopPropagation();
      var paired = pairedHit(ev);
      if (paired) {
        openMarkerPopover(paired, ev);
        return;
      }
      lastHit = { id, t: ev.timeStamp };
      selectPartHighlight(id);
    });
    overlay.addEventListener("dblclick", function(ev) {
      var id = hitId(ev);
      if (!id) return;
      ev.stopPropagation();
      if (state.popoverId !== id) openMarkerPopover(id, ev);
    });
    function netText(net) {
      if (!net || !net.role) return "";
      return [
        net.role.replace(/_/g, " "),
        net.rail,
        net.nominal_v != null ? net.nominal_v + " V" : ""
      ].filter(Boolean).join(" \xB7 ");
    }
    function gatingText(g) {
      if (!g || !g.kind) return "";
      return [g.kind.replace(/_/g, " "), g.ref, g.default ? "(" + g.default + ")" : ""].filter(Boolean).join(" ");
    }
    function metaRow(label, value) {
      if (value === void 0 || value === null || value === "") return "";
      return '<div class="zbp-meta-row"><dt>' + escapeHtml(label) + "</dt><dd>" + escapeHtml(String(value)) + "</dd></div>";
    }
    function metaSection(title, bodyHtml) {
      if (!bodyHtml) return "";
      return '<section class="zbp-meta-sec">' + (title ? '<h5 class="zbp-meta-h">' + escapeHtml(title) + "</h5>" : "") + bodyHtml + "</section>";
    }
    function metaHtml(part) {
      var mux = partMuxEntries(part);
      var identity = '<dl class="zbp-meta-dl">' + metaRow("ID", part.id) + metaRow("Silk", part.silk && part.silk !== part.id ? part.silk : "") + metaRow("Kind", part.kind) + metaRow("Ref", part.ref) + metaRow("Pad", part.pad) + metaRow("Net", netText(part.net)) + metaRow("Gated by", gatingText(part.gating)) + "</dl>";
      var muxBody = "";
      var dflt = defaultFunction(part);
      if (mux.length) {
        muxBody = '<ul class="zbp-meta-mux zbp-meta-mux-grid"><li class="zbp-meta-mux-head" aria-hidden="true"><span>Peripheral</span><span>Signal</span><span>Mode</span></li>' + mux.map(function(m) {
          var hasMode = m.mode !== void 0 && m.mode !== null && m.mode !== "";
          var squash = function(v) {
            return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          };
          var showFn = m.function && squash(m.function) !== squash(m.signal) && squash(m.function) !== squash(m.peripheral + m.signal);
          var title = [m.function, hasMode ? "mode " + m.mode : ""].filter(Boolean).join(" \xB7 ");
          return '<li title="' + escapeHtml(title) + '"><span class="zbp-chip">' + escapeHtml(m.peripheral) + '</span><span class="zbp-meta-mux-main"><span class="zbp-meta-mux-sig">' + escapeHtml(m.signal) + "</span>" + (dflt && m.function === dflt ? RESET_TAG : "") + softwareTags(part, [m.function]) + (showFn ? '<span class="zbp-meta-mux-fn">' + escapeHtml(m.function) + "</span>" : "") + '</span><span class="zbp-meta-mux-mode">' + (hasMode ? escapeHtml(m.mode) : "") + "</span></li>";
        }).join("") + "</ul>";
      }
      index.routed(part).forEach(function(g) {
        if (!g.mux.length) return;
        var byPeri = {};
        g.mux.forEach(function(m) {
          (byPeri[m.peripheral] = byPeri[m.peripheral] || []).push(m.signal);
        });
        muxBody += '<details class="zbp-meta-routed"><summary>' + escapeHtml(g.label) + ": " + g.mux.length + " more signal(s) routable to this pin</summary>" + (g.notes ? '<p class="zbp-meta-notes">' + escapeHtml(g.notes) + "</p>" : "") + '<ul class="zbp-meta-mux">' + Object.keys(byPeri).sort().map(function(k) {
          return '<li><span class="zbp-chip">' + escapeHtml(k) + '</span><span class="zbp-meta-mux-sig">' + escapeHtml(byPeri[k].join(", ")) + "</span></li>";
        }).join("") + "</ul></details>";
      });
      var configRows = function(cfg) {
        return Object.keys(cfg || {}).map(function(k) {
          var v = cfg[k];
          return metaRow(k, typeof v === "object" ? JSON.stringify(v) : v);
        }).join("");
      };
      var assignments = partAssignments(part).map(function(a) {
        return '<dl class="zbp-meta-dl">' + metaRow("Software", softwareName(assignmentOwner(a, software))) + metaRow("Status", a.status || "unknown") + metaRow("Owner", a.owner) + metaRow("Role", a.role) + metaRow("Function", a.function) + configRows(a.config) + "</dl>";
      }).join("");
      var notes = part.notes ? '<p class="zbp-meta-notes">' + escapeHtml(part.notes) + "</p>" : "";
      return '<div class="zbp-meta">' + metaSection("Identity", identity) + metaSection("Mux", muxBody || '<p class="zbp-meta-empty">No mux entries</p>') + metaSection("Software", assignments) + metaSection("Notes", notes) + "</div>";
    }
    function infoCardHtml(part) {
      if (!part) return "";
      var title = part.silk || part.id;
      var sub = [];
      if (part.kind) sub.push(part.kind);
      if (part.ref) sub.push(part.ref);
      if (part.id && part.silk && part.silk !== part.id) sub.push(part.id);
      return '<div class="zbp-info-card"><div class="zbp-info-head"><div class="zbp-info-titles"><strong>' + escapeHtml(title) + "</strong>" + (sub.length ? '<span class="zbp-info-sub">' + escapeHtml(sub.join(" \xB7 ")) + "</span>" : "") + '</div><div class="zbp-actions zbp-actions-inline">' + (hasChildren(part) ? '<button type="button" class="zbp-act" data-act="expand">\u25B8 Expand</button>' : "") + '<button type="button" class="zbp-act" data-act="close-info">\u2715 Close</button>' + (state.stack.length && !state.peripheral ? '<button type="button" class="zbp-act" data-act="up">\u2191 Up</button>' : "") + "</div></div>" + metaHtml(part) + "</div>";
    }
    function peripheralDetailHtml(periId) {
      var peri = collectPeripherals(topParts()).find(function(p) {
        return p.id === periId;
      });
      if (!peri) return '<p class="zbp-mux-empty">No pins for this peripheral.</p>';
      var items = peri.pinIds.map(function(id) {
        var found = findPart(topParts(), id);
        if (!found) return "";
        var part = found.part;
        var sigs = muxSignalsForPeripheral(part, periId);
        var active = id === state.selected;
        var dflt = defaultFunction(part);
        var periMux = partMuxEntries(part).filter(function(m) {
          return m.peripheral === periId;
        });
        var isDefault = !!dflt && periMux.some(function(m) {
          return m.function === dflt;
        });
        return '<li class="zbp-mux-row' + (active ? " active" : "") + '"><button type="button" class="zbp-tlabel' + (active ? " active" : "") + '" data-focus="' + escapeHtml(id) + '">' + escapeHtml(part.silk || part.id) + '</button><span class="zbp-mux-sig">' + escapeHtml(sigs.join(", ")) + "</span>" + (isDefault ? RESET_TAG : "") + softwareTags(
          part,
          periMux.map(function(m) {
            return m.function;
          })
        ) + '<button type="button" class="zbp-info" data-info="' + escapeHtml(id) + '" title="View info" aria-label="View info">\u2139</button></li>';
      }).filter(Boolean).join("");
      return '<div class="zbp-peri-block"><div class="zbp-peri-head"><strong>' + escapeHtml(periId) + '</strong><span class="zbp-info-sub">' + peri.pinIds.length + " pin(s)" + (peri.signals.length ? " \xB7 " + escapeHtml(peri.signals.join(", ")) : "") + '</span></div><ul class="zbp-mux-list">' + items + "</ul></div>";
    }
    var subtreeHits = null;
    var subtreeKey = null;
    function subtreeMatches(p) {
      var key = state.query + "\0" + state.peripheral + "\0" + state.software;
      if (subtreeKey !== key) {
        subtreeKey = key;
        subtreeHits = index.subtreeMatches(matchesFilters);
      }
      return subtreeHits.has(p.id);
    }
    function renderTree(parts, depth) {
      if (!parts || !parts.length) return "";
      var html = '<ul class="zbp-tree">';
      parts.forEach(function(p) {
        if (state.query && !subtreeMatches(p)) return;
        var open = state.treeOpen[p.id] === true;
        var kids = p.children || [];
        html += "<li>";
        html += '<div class="zbp-tree-row">';
        if (kids.length) {
          html += '<button type="button" class="zbp-twisty" data-toggle="' + escapeHtml(p.id) + '" aria-expanded="' + (open ? "true" : "false") + '" title="Expand / collapse">' + (open ? "\u25BE" : "\u25B8") + "</button>";
        } else {
          html += '<span class="zbp-leaf">\u2022</span>';
        }
        html += '<button type="button" class="zbp-tlabel' + (p.id === state.selected ? " active" : "") + '" data-id="' + escapeHtml(p.id) + '" title="' + escapeHtml(p.id) + '">' + escapeHtml(p.silk || p.id) + "</button>";
        if (p.kind || p.ref) {
          html += '<span class="zbp-kind">' + escapeHtml(p.kind || p.ref) + "</span>";
        }
        html += '<button type="button" class="zbp-info" data-info="' + escapeHtml(p.id) + '" title="View info" aria-label="View info for ' + escapeHtml(p.silk || p.id) + '">\u2139</button>';
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
        state.stack.map(function(id) {
          var f = findPart(topParts(), id);
          return f && (f.part.silk || f.part.id) || id;
        })
      );
      var crumbHtml = stackLabels.map(function(label, i) {
        if (i === 0) {
          return '<button type="button" class="zbp-crumb" data-up="all">Board</button>';
        }
        if (i === stackLabels.length - 1) return "<span>" + escapeHtml(label) + "</span>";
        return '<button type="button" class="zbp-crumb" data-up="' + (i - 1) + '">' + escapeHtml(label) + "</button>";
      }).join(" <span>\u203A</span> ");
      if (crumbHtml !== lastCrumbHtml) {
        lastCrumbHtml = crumbHtml;
        crumb.innerHTML = crumbHtml;
      }
      detailRegions();
      var html = "";
      var infoPart = null;
      if (state.selected) {
        var infoFound = findPart(topParts(), state.selected);
        var sel = infoFound ? infoFound.part : null;
        if (sel && (state.infoOpen || !hasChildren(sel))) {
          infoPart = sel;
        }
      }
      if (infoPart) {
        html += infoCardHtml(infoPart);
      } else if (part && !state.peripheral) {
        html += '<div class="zbp-browse-head"><strong>' + escapeHtml(part.silk || part.id) + '</strong><div class="zbp-actions zbp-actions-inline">' + (hasChildren(part) ? '<button type="button" class="zbp-act" data-act="expand">\u25B8 Expand</button>' : "") + '<button type="button" class="zbp-act" data-act="info">\u2139 Info</button>' + (state.stack.length ? '<button type="button" class="zbp-act" data-act="up">\u2191 Up</button>' : "") + "</div></div>";
      } else if (!state.peripheral && !part) {
        html += '<p class="zbp-hint">Click a part \xB7 use \u2139 for details</p>';
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
      detail.innerHTML = '<div class="zbp-detail-head"></div><div class="zbp-detail-list"></div>';
      detailHead = detail.firstChild;
      detailList = detail.lastChild;
      listKey = null;
    }
    function openTreeKey() {
      return Object.keys(state.treeOpen).filter(function(id) {
        return state.treeOpen[id] === true;
      }).join("");
    }
    function detailListKey(part) {
      var sep = "\0";
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
    function syncActive() {
      activeEls.forEach(function(el) {
        el.classList.remove("active");
      });
      activeEls = [];
      if (!state.selected || !detailList.firstChild) return;
      var v = attrValue(state.selected);
      detailList.querySelectorAll(
        '.zbp-tlabel[data-id="' + v + '"], .zbp-pin[data-id="' + v + '"], .zbp-tlabel[data-focus="' + v + '"]'
      ).forEach(function(el) {
        el.classList.add("active");
        activeEls.push(el);
        var row = el.closest(".zbp-mux-row");
        if (row) {
          row.classList.add("active");
          activeEls.push(row);
        }
      });
    }
    function toggleTreeRow(btn, id, open) {
      var li = btn.closest("li");
      var found = index.find(id);
      if (!li || !found || !detailList.contains(li)) return false;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.textContent = open ? "\u25BE" : "\u25B8";
      var sub = li.lastElementChild;
      if (sub && sub.tagName === "UL") sub.remove();
      if (open) li.insertAdjacentHTML("beforeend", renderTree(found.part.children, 1));
      listKey = detailListKey(detailCtx.part);
      activeEls = activeEls.filter(function(el) {
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
        html += '<p class="zbp-list-label">Pins</p><div class="zbp-pin-grid">' + part.children.map(function(c) {
          return '<button type="button" class="zbp-pin' + (c.id === state.selected ? " active" : "") + '" data-id="' + escapeHtml(c.id) + '">' + escapeHtml(c.silk || c.id) + "</button>";
        }).join("") + "</div>";
      } else if (part && hasChildren(part) && part.kind !== "pin_array") {
        html += '<p class="zbp-list-label">Children</p>';
        html += renderTree(part.children, 0);
      } else if (!state.peripheral && !part) {
        html += renderTree(topParts(), 0);
      }
      return html;
    }
    var detailCtx = { part: null, infoPart: null };
    crumb.addEventListener("click", function(ev) {
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
        if (state.peripheral || infoPart && !hasChildren(infoPart)) {
          state.selected = null;
        }
        render();
      } else if (act === "up") {
        state.stack.pop();
        state.infoOpen = false;
        render();
      }
    }
    detail.addEventListener("click", function(ev) {
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
    stage.addEventListener("selectstart", function(ev) {
      ev.preventDefault();
    });
    stage.addEventListener("dblclick", function(ev) {
      if (ev.target.closest(".zbp-hit, .zbp-popover, .zbp-view-controls")) return;
      ev.preventDefault();
      if (window.getSelection) {
        var sel = window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
      }
    });
    stage.addEventListener("click", function(ev) {
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
      hidePopover();
    });
    controls.querySelectorAll("[data-view]").forEach(function(btn) {
      btn.addEventListener("click", function(ev) {
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
      function(ev) {
        if (ev.target.closest(".zbp-side")) return;
        ev.preventDefault();
        var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
        zoomAt(ev.clientX, ev.clientY, state.view.scale * factor);
      },
      { passive: false }
    );
    stage.addEventListener("pointerdown", function(ev) {
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
        ty: state.view.ty
      };
      stage.classList.add("zbp-panning");
      try {
        stage.setPointerCapture(ev.pointerId);
      } catch (e) {
      }
    });
    stage.addEventListener("pointermove", function(ev) {
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
      }
    }
    stage.addEventListener("pointerup", endPan);
    stage.addEventListener("pointercancel", endPan);
    var searchTimer = null;
    function applySearch() {
      searchTimer = null;
      state.query = search.value.trim();
      if (state.query) {
        index.subtreeMatches(matchesFilters).forEach(function(id) {
          state.treeOpen[id] = true;
        });
      }
      render();
    }
    if (search) {
      search.addEventListener("input", function() {
        updateSearchClear();
        if (searchTimer !== null) clearTimeout(searchTimer);
        searchTimer = setTimeout(applySearch, SEARCH_DEBOUNCE_MS);
      });
    }
    if (searchClear) {
      searchClear.addEventListener("click", function(ev) {
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
      periSelect.addEventListener("change", function() {
        state.peripheral = periSelect.value || "";
        state.selected = null;
        state.infoOpen = false;
        if (state.peripheral) state.stack = [];
        hidePopover();
        render();
        if (state.peripheral) {
          requestAnimationFrame(function() {
            focusOnPeripheral(state.peripheral);
          });
        } else {
          resetView();
        }
      });
    }
    if (softwareSelect) {
      softwareSelect.addEventListener("change", function() {
        state.software = softwareSelect.value || "";
        hidePopover();
        render();
      });
    }
    var resizeFrame = 0;
    window.addEventListener("resize", function() {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(function() {
        resizeFrame = 0;
        renderOverlay();
      });
    });
    applyViewTransform();
    refreshPeripheralOptions();
    render();
  }
  function boot() {
    document.querySelectorAll(".board-pinout").forEach(initWidget);
  }

  // ../src/board_pinout/static/board_pinout/js/index.js
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
