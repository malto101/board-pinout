import { normalizeMuxEntry } from "./mux.js";

/**
 * Flat, read-only index over a resolved part tree, built once after load.
 *
 * Lookups are keyed by part id (not object identity) so the layout copies
 * made for drawing (Object.assign({}, part, {point})) resolve to the same
 * cached mux/search data as the authored part.
 */
export function buildIndex(topParts) {
  var byId = new Map();
  var order = [];
  var periRows = {};

  function walk(list, parent, trail) {
    for (var i = 0; i < (list || []).length; i++) {
      var p = list[i];
      if (!p || p.id == null) continue;
      var path = trail.concat([p.id]);
      var mux = (p.mux || []).map(normalizeMuxEntry).filter(Boolean);
      var peris = new Set();
      for (var j = 0; j < mux.length; j++) {
        var m = mux[j];
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
        if (!row.seen.has(p.id)) {
          row.seen.add(p.id);
          row.pinIds.push(p.id);
        }
      }
      var entry = {
        part: p,
        parent: parent,
        path: path,
        mux: mux,
        peris: peris,
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
      var z = part.zephyr || {};
      var muxHay = entry.mux
        .map(function (m) {
          return [m.peripheral, m.signal, m.function, m.mode].filter(Boolean).join(" ");
        })
        .join(" ");
      entry.hay = [part.id, part.silk, part.pad, part.ref, part.kind, part.notes, z.compatible, muxHay]
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
