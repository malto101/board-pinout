/** Browser-safe SoC table normalization and lookup helpers.
 *
 * This module intentionally has no DOM or application-state dependencies. The
 * editor uses it while authoring and the Sphinx widget can use the same index
 * for read-only presentation of resolved documents.
 */

export function socDiagnostics(table) {
  var errors = [];
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    return ["SoC table must be a mapping"];
  }
  if (!String(table.soc || "").trim()) errors.push("soc is required");
  if (table.pads !== undefined && (!table.pads || typeof table.pads !== "object" || Array.isArray(table.pads))) {
    errors.push("pads must be a mapping");
  }
  Object.keys(table.pads || {}).forEach(function (pad) {
    var entry = table.pads[pad];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push("pads." + pad + " must be a mapping");
      return;
    }
    if (entry.functions !== undefined && !Array.isArray(entry.functions)) {
      errors.push("pads." + pad + ".functions must be a list");
      return;
    }
    (entry.functions || []).forEach(function (fn, i) {
      if (!fn || typeof fn !== "object" || !String(fn.function || "").trim()) {
        errors.push("pads." + pad + ".functions[" + i + "].function is required");
      }
    });
  });
  return errors;
}

function merge(base, override) {
  var out = Object.assign({}, base || {}, override || {});
  ["pull", "reset", "strap", "tolerance"].forEach(function (key) {
    if ((base && base[key]) || (override && override[key])) {
      out[key] = Object.assign({}, base && base[key], override && override[key]);
    }
  });
  return out;
}

export function padInfo(table, padName, packageName) {
  if (!table || !padName) return null;
  var raw = table.pads && table.pads[padName];
  if (!raw) {
    var aliases = Object.keys(table.pads || {}).find(function (name) {
      return (table.pads[name].aliases || []).indexOf(padName) >= 0;
    });
    if (aliases) {
      padName = aliases;
      raw = table.pads[padName];
    }
  }
  if (!raw) return null;
  var info = merge(table.pad_defaults, raw);
  info.soc = table.soc;
  info.pad = padName;
  if (packageName && table.packages && table.packages[packageName]) {
    info.package = table.packages[packageName].pads && table.packages[packageName].pads[padName];
    info.package_name = packageName;
  }
  return info;
}

export function buildSocIndex(table) {
  var pads = new Map();
  var functions = new Map();
  Object.keys((table && table.pads) || {}).forEach(function (name) {
    var raw = table.pads[name] || {};
    var info = padInfo(table, name);
    var list = (raw.functions || []).map(function (fn) {
      return Object.assign({}, fn, { pad: name, source: "soc" });
    });
    pads.set(name, { name: name, info: info, functions: list, aliases: raw.aliases || [] });
    list.forEach(function (fn) {
      var key = String(fn.function || "");
      if (!key) return;
      if (!functions.has(key)) functions.set(key, []);
      functions.get(key).push(Object.assign({}, fn, { pad: name }));
    });
  });
  return {
    soc: table && table.soc,
    diagnostics: socDiagnostics(table),
    pads: pads,
    functions: functions,
    pad: function (name) { return pads.get(name) || null; },
    candidates: function (name) {
      var row = pads.get(name);
      return row ? row.functions.slice() : [];
    },
    peripherals: function () {
      var ids = new Set();
      functions.forEach(function (list) {
        list.forEach(function (fn) { if (fn.peripheral) ids.add(String(fn.peripheral).toLowerCase()); });
      });
      return Array.from(ids).sort();
    },
  };
}

export function classifyDocument(doc) {
  if (doc && doc.soc && doc.pads && !doc.faces) return "soc";
  if (doc && doc.faces) return "board";
  return "unknown";
}
