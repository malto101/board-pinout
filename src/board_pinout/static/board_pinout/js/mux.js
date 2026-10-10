/** Normalize a mux entry; infer peripheral/signal from function like I2C0_SDA. */
export function normalizeMuxEntry(entry) {
  if (!entry || entry.function == null || entry.function === "") return null;
  var fn = String(entry.function).trim();
  var peripheral = String(entry.peripheral || "").trim();
  var signal = String(entry.signal || "").trim();
  // Plain GPIO functions (class: gpio, no peripheral) share one filter row.
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
    source: entry.source,
  };
}

/** Same rule as soc_pads._function_matches: ``PERIPH.*`` or an exact function name. */
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

/**
 * Routing groups for a part: ``part.routing`` ids looked up in ``socRouting``,
 * minus ``part.routing_exclude``. Normalized rule functions are cached per id
 * so parts without excludes share one array.
 */
export function routedEntries(part, socRouting, cache) {
  var ids = (part && part.routing) || [];
  if (!ids.length || !socRouting) return [];
  var excludes = part.routing_exclude || [];
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    var rule = socRouting[ids[i]];
    if (!rule) continue;
    var all = cache && cache.get(ids[i]);
    if (!all) {
      all = (rule.functions || []).map(function (f) {
        return { raw: f, mux: normalizeMuxEntry(Object.assign({ source: "routing" }, f)) };
      }).filter(function (x) {
        return x.mux;
      });
      if (cache) cache.set(ids[i], all);
    }
    var kept = excludes.length
      ? all.filter(function (x) {
          return !excludedBy(excludes, x.raw);
        })
      : all;
    out.push({
      id: ids[i],
      kind: rule.kind,
      label: rule.label || rule.kind,
      notes: rule.notes,
      mux: kept.map(function (x) {
        return x.mux;
      }),
    });
  }
  return out;
}

/** ``part.assignments``: how declared software stacks use the pin. */
export function partAssignments(part) {
  return ((part && part.assignments) || []).filter(Boolean);
}

/**
 * Software id an assignment belongs to: its ``by``, else the only declared
 * software (``""`` when there is none or several).
 */
export function assignmentOwner(a, software) {
  if (a.by) return String(a.by);
  var ids = Object.keys(software || {});
  return ids.length === 1 ? ids[0] : "";
}

/**
 * Predicate over normalized mux entries for one assignment: its ``function``
 * name, else ``owner`` + ``role`` as peripheral + signal.
 */
export function assignmentMatcher(a) {
  if (a.function) {
    var fn = String(a.function).toUpperCase();
    return function (m) {
      return String(m.function).toUpperCase() === fn;
    };
  }
  if (!a.owner || !a.role) return null;
  var owner = String(a.owner).toLowerCase();
  var role = String(a.role).toLowerCase();
  return function (m) {
    return m.peripheral === owner && String(m.signal).toLowerCase() === role;
  };
}

export function partMuxEntries(part) {
  return ((part && part.mux) || []).map(normalizeMuxEntry).filter(Boolean);
}

export function partHasPeripheral(part, peri) {
  if (!peri) return true;
  var key = String(peri).toLowerCase();
  return partMuxEntries(part).some(function (m) {
    return m.peripheral === key;
  });
}

export function muxSignalsForPeripheral(part, peri) {
  var key = String(peri || "").toLowerCase();
  return partMuxEntries(part)
    .filter(function (m) {
      return !key || m.peripheral === key;
    })
    .map(function (m) {
      return m.signal;
    });
}

export function collectPeripherals(parts) {
  var map = {};
  function walk(list) {
    (list || []).forEach(function (p) {
      partMuxEntries(p).forEach(function (m) {
        if (!map[m.peripheral]) {
          map[m.peripheral] = { id: m.peripheral, signals: {}, pinIds: [] };
        }
        map[m.peripheral].signals[m.signal] = true;
        if (map[m.peripheral].pinIds.indexOf(p.id) < 0) {
          map[m.peripheral].pinIds.push(p.id);
        }
      });
      walk(p.children);
    });
  }
  walk(parts);
  return Object.keys(map)
    .sort()
    .map(function (k) {
      var row = map[k];
      return {
        id: row.id,
        signals: Object.keys(row.signals).sort(),
        pinIds: row.pinIds,
      };
    });
}
