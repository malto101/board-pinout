import {
  assignmentMatcher,
  assignmentOwner,
  normalizeMuxEntry,
  partAssignments,
  routedEntries,
} from "./mux.js";

/**
 * Flat, read-only index over a resolved part tree, built once after load.
 *
 * Lookups are keyed by part id (not object identity) so the layout copies
 * made for drawing (Object.assign({}, part, {point})) resolve to the same
 * cached mux/search data as the authored part.
 *
 * ``socRouting`` is the resolved document's ``soc_routing`` map: crossbar and
 * other routing rules stored once and referenced by id from ``part.routing``.
 * Routed signals feed neither the peripheral filter nor free-text search: on a
 * crossbar SoC they would put every routable pin under every peripheral. Only
 * pad (IO_MUX) and board entries do; ``routing()`` reports which rules exist.
 * Entries already copied onto parts (``source: routing``, expand mode) are
 * moved back into a routed group for the same reason.
 *
 * ``software`` is the document's ``software`` map; pin ``assignments`` name
 * one of its keys in ``by`` (implicit when only one is declared).
 */
export function buildIndex(topParts, socRouting, software) {
  var byId = new Map();
  var order = [];
  var periRows = {};
  var ruleCache = new Map();
  var routedRuleCount = 0;

  function addPeri(peris, m, id) {
    peris.add(m.peripheral);
    var row = periRows[m.peripheral];
    if (!row) {
      row = periRows[m.peripheral] = {
        id: m.peripheral,
        signals: {},
        pinIds: [],
        seen: new Set(),
      };
    }
    row.signals[m.signal] = true;
    if (!row.seen.has(id)) {
      row.seen.add(id);
      row.pinIds.push(id);
    }
  }

  // Mux entries the board's software selects. Each assignment names its
  // ``function`` (e.g. SPIM2_MISO) or, failing that, owner + role matching
  // peripheral + signal. A routed hit is a real assignment, not just a
  // possibility, so it joins the pad's own mux list and the peripheral
  // filter. Returns ``{fns, by, added}``: function -> software ids, the set
  // of software ids using the pin, and the promoted routed entries.
  function assignmentPicks(p, mux, routed) {
    var fns = new Map();
    var by = new Set();
    var added = [];
    function pick(fn, owner) {
      if (!fns.has(fn)) fns.set(fn, []);
      if (fns.get(fn).indexOf(owner) < 0) fns.get(fn).push(owner);
    }
    partAssignments(p).forEach(function (a) {
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
          if (!added.some(function (m) { return m.function === hit.function; })) {
            added.push(Object.assign({}, hit, { mode: routed[g].label }));
          }
          return;
        }
      }
    });
    return { fns: fns, by: by, added: added };
  }

  function walk(list, parent, trail) {
    for (var i = 0; i < (list || []).length; i++) {
      var p = list[i];
      if (!p || p.id == null) continue;
      var path = trail.concat([p.id]);
      var all = (p.mux || []).map(normalizeMuxEntry).filter(Boolean);
      var mux = all.filter(function (m) {
        return m.source !== "routing";
      });
      var peris = new Set();
      for (var j = 0; j < mux.length; j++) addPeri(peris, mux[j], p.id);
      var routed = routedEntries(p, socRouting, ruleCache);
      if (mux.length !== all.length) {
        routed = routed.concat([{
          id: null,
          kind: "routing",
          label: "Routable",
          notes: null,
          mux: all.filter(function (m) {
            return m.source === "routing";
          }),
        }]);
      }
      if (routed.length) routedRuleCount += 1;
      var picks = assignmentPicks(p, mux, routed);
      picks.added.forEach(function (m) {
        addPeri(peris, m, p.id);
      });
      mux = mux.concat(picks.added);
      var entry = {
        part: p,
        parent: parent,
        path: path,
        mux: mux,
        routed: routed,
        peris: peris,
        assignedFns: picks.fns,
        usedBy: picks.by,
        hay: null,
      };
      // First match wins, like the depth-first findPart() it replaces.
      if (!byId.has(p.id)) byId.set(p.id, entry);
      order.push(entry);
      walk(p.children, p, path);
    }
  }
  walk(topParts, null, []);

  var peripherals = Object.keys(periRows)
    .sort()
    .map(function (k) {
      var row = periRows[k];
      return {
        id: row.id,
        signals: Object.keys(row.signals).sort(),
        pinIds: row.pinIds,
      };
    });
  var periById = new Map();
  peripherals.forEach(function (p) {
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
      var aHay = partAssignments(part)
        .map(function (a) {
          var sw = (software || {})[assignmentOwner(a, software)];
          var cfg = Object.keys(a.config || {}).map(function (k) {
            var v = a.config[k];
            return typeof v === "object" ? JSON.stringify(v) : String(v);
          });
          return [sw && sw.name, a.owner, a.role, a.function].concat(cfg).filter(Boolean).join(" ");
        })
        .join(" ");
      var muxHay = entry.mux
        .map(function (m) {
          return [m.peripheral, m.signal, m.function, m.mode].filter(Boolean).join(" ");
        })
        .join(" ");
      entry.hay = [part.id, part.silk, part.pad, part.ref, part.kind, part.notes, aHay, muxHay]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    }
    return entry.hay;
  }

  return {
    size: order.length,

    /** { part, parent } for an id, or null. */
    find: function (id) {
      var e = byId.get(id);
      return e ? { part: e.part, parent: e.parent } : null;
    },

    /** Ids from the top-level ancestor down to ``id`` (empty when unknown). */
    path: function (id) {
      var e = byId.get(id);
      return e ? e.path.slice() : [];
    },

    mux: function (part) {
      var e = entryFor(part);
      if (e) return e.mux;
      return ((part && part.mux) || []).map(normalizeMuxEntry).filter(Boolean);
    },

    hasPeripheral: function (part, peri) {
      if (!peri) return true;
      var e = entryFor(part);
      return !!e && e.peris.has(String(peri).toLowerCase());
    },

    /** ``[{id, kind, label, notes, mux}]`` routing groups that apply to ``part``. */
    routed: function (part) {
      var e = entryFor(part);
      return e ? e.routed : routedEntries(part, socRouting, ruleCache);
    },

    /** ``Map<function, softwareId[]>`` of functions software selects on ``part``. */
    assignedFunctions: function (part) {
      var e = entryFor(part);
      return e ? e.assignedFns : new Map();
    },

    /** True when ``part`` has an assignment by software ``id`` (any when empty). */
    usedBy: function (part, id) {
      if (!id) return true;
      var e = entryFor(part);
      return !!e && e.usedBy.has(id);
    },

    signalsFor: function (part, peri) {
      var key = String(peri || "").toLowerCase();
      return this.mux(part)
        .filter(function (m) {
          return !key || m.peripheral === key;
        })
        .map(function (m) {
          return m.signal;
        });
    },

    /** Number of parts that have routing groups (crossbar etc.). */
    routedParts: function () {
      return routedRuleCount;
    },

    /** Same shape and order as collectPeripherals(). */
    peripherals: function () {
      return peripherals;
    },

    peripheral: function (id) {
      return periById.get(id) || null;
    },

    /** ``query`` must already be lower-cased. */
    matchesQuery: function (part, query) {
      if (!query) return true;
      var e = entryFor(part);
      if (!e) return false;
      return haystack(e).indexOf(query) !== -1;
    },

    /**
     * Ids of every part whose subtree (itself included) satisfies ``pred``.
     * One pass plus an ancestor walk that stops at the first marked ancestor.
     */
    subtreeMatches: function (pred) {
      var hits = new Set();
      for (var i = 0; i < order.length; i++) {
        var e = order[i];
        if (!pred(e.part)) continue;
        for (var k = e.path.length - 1; k >= 0; k--) {
          if (hits.has(e.path[k])) break;
          hits.add(e.path[k]);
        }
      }
      return hits;
    },
  };
}
