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
    var baseValue = base && base[key];
    var overrideValue = override && override[key];
    if (baseValue === undefined && overrideValue === undefined) return;
    if (baseValue && typeof baseValue === "object" && !Array.isArray(baseValue) &&
        overrideValue && typeof overrideValue === "object" && !Array.isArray(overrideValue)) {
      out[key] = Object.assign({}, baseValue, overrideValue);
    } else {
      out[key] = overrideValue !== undefined ? overrideValue : baseValue;
    }
  });
  return out;
}

function excludedBy(patterns, entry) {
  return (patterns || []).some(function (pattern) {
    if (String(pattern).endsWith(".*")) {
      var prefix = String(pattern).slice(0, -2);
      return entry.peripheral
        ? String(entry.peripheral) === prefix
        : String(entry.function || "").startsWith(prefix + "_");
    }
    return String(entry.function || "") === String(pattern);
  });
}

function canonicalPad(table, padName) {
  if (!table || !padName) return null;
  if (table.pads && table.pads[padName]) return padName;
  return Object.keys(table.pads || {}).find(function (name) {
    return (table.pads[name].aliases || []).indexOf(padName) >= 0;
  }) || null;
}

function packageInfo(table, packageName) {
  return packageName && table && table.packages && table.packages[packageName]
    ? table.packages[packageName]
    : null;
}

function inPackage(table, padName, packageName) {
  var pkg = packageInfo(table, packageName);
  if (!pkg || !pkg.pads) return true;
  return Object.prototype.hasOwnProperty.call(pkg.pads, padName);
}

function packageFunctions(table, entries, packageName) {
  var pkg = packageInfo(table, packageName);
  var excluded = (table && table.functions_exclude || []).concat((pkg && pkg.functions_exclude) || []);
  return entries.filter(function (entry) {
    return !(packageName && entry.packages && entry.packages.indexOf(packageName) < 0) &&
      !excludedBy(excluded, entry);
  });
}

function remapCandidates(table, padName, packageName) {
  var out = [];
  Object.keys((table && table.remaps) || {}).forEach(function (peripheral) {
    (table.remaps[peripheral] || []).forEach(function (option) {
      Object.keys(option.pads || {}).forEach(function (signal) {
        if (canonicalPad(table, option.pads[signal]) !== padName) return;
        var entry = {
          function: peripheral + "_" + signal,
          peripheral: peripheral,
          signal: signal,
          source: "remap",
          remap: { value: option.value },
        };
        if (option.label) entry.remap.label = option.label;
        if (option.vendor) entry.vendor = option.vendor;
        if (option.packages) entry.packages = option.packages;
        out.push(entry);
      });
    });
  });
  return packageFunctions(table, out, packageName);
}

function signalSelectCandidates(table, padName, packageName) {
  var out = [];
  Object.keys((table && table.signal_select) || {}).forEach(function (fn) {
    (table.signal_select[fn] || []).forEach(function (option) {
      if (canonicalPad(table, option.pad) !== padName) return;
      var entry = { function: fn, source: "signal_select" };
      ["set", "mode", "requires", "vendor", "packages"].forEach(function (key) {
        if (option[key] !== undefined) entry[key] = option[key];
      });
      out.push(entry);
    });
  });
  return packageFunctions(table, out, packageName);
}

function routingCandidates(table, padName, packageName) {
  var out = [];
  (table.routing || []).forEach(function (rule, index) {
    var selector = rule.pads || {};
    var selected = selector.list || [];
    var included = !selected.length && !selector.range;
    if (selected.some(function (name) { return canonicalPad(table, name) === padName; })) included = true;
    if (selector.range && selector.range.length === 2) {
      var names = Object.keys(table.pads || {});
      var lo = names.indexOf(canonicalPad(table, selector.range[0]));
      var hi = names.indexOf(canonicalPad(table, selector.range[1]));
      if (lo >= 0 && hi >= lo && names.slice(lo, hi + 1).indexOf(padName) >= 0) included = true;
    }
    if (selector.ports && selector.ports.indexOf((table.pads[padName] || {}).port) < 0) included = false;
    if (selector.parity) {
      var parity = (table.pads[padName] || {}).index;
      if (typeof parity !== "number" || parity % 2 !== (selector.parity === "odd" ? 1 : 0)) included = false;
    }
    if ((selector.exclude || []).some(function (name) { return canonicalPad(table, name) === padName; })) included = false;
    if (!included) return;
    (rule.functions || []).forEach(function (fn) {
      out.push(Object.assign({}, fn, {
        source: "routing",
        routing: rule.kind,
        routing_label: rule.label,
        routing_index: index,
      }));
    });
  });
  return packageFunctions(table, out, packageName);
}

export function padInfo(table, padName, packageName) {
  var canonical = canonicalPad(table, padName);
  if (!canonical || !inPackage(table, canonical, packageName)) return null;
  var raw = table.pads[canonical] || {};
  var info = merge(table.pad_defaults, raw);
  info.soc = table.soc;
  info.pad = canonical;
  var pkg = packageInfo(table, packageName);
  if (pkg) {
    info.package = Object.assign({ name: packageName }, pkg.pads && pkg.pads[canonical] || {});
    info.package_name = packageName;
  }
  return info;
}

export function buildSocIndex(table, packageName) {
  var pads = new Map();
  var functions = new Map();
  Object.keys((table && table.pads) || {}).forEach(function (name) {
    if (!inPackage(table, name, packageName)) return;
    var raw = table.pads[name] || {};
    var fixed = (raw.functions || []).map(function (fn) {
      return Object.assign({}, fn, { pad: name, source: "soc" });
    });
    var list = packageFunctions(table, fixed, packageName)
      .concat(remapCandidates(table, name, packageName))
      .concat(signalSelectCandidates(table, name, packageName))
      .concat(routingCandidates(table, name, packageName));
    var info = padInfo(table, name, packageName);
    pads.set(name, { name: name, info: info, functions: list, aliases: raw.aliases || [] });
    list.forEach(function (fn) {
      var key = String(fn.function || "");
      if (!key) return;
      if (!functions.has(key)) functions.set(key, []);
      functions.get(key).push(Object.assign({}, fn, { pad: name }));
    });
  });
  var aliases = new Map();
  pads.forEach(function (row) {
    row.aliases.forEach(function (alias) { aliases.set(alias, row.name); });
  });
  return {
    soc: table && table.soc,
    package: packageName || "",
    diagnostics: socDiagnostics(table),
    pads: pads,
    functions: functions,
    canonical: function (name) { return pads.has(name) ? name : aliases.get(name) || null; },
    pad: function (name) {
      var canonical = this.canonical(name);
      return canonical ? pads.get(canonical) || null : null;
    },
    candidates: function (name, options) {
      var row = this.pad(name);
      if (!row) return [];
      options = options || {};
      return row.functions.filter(function (entry) {
        return options.expandRouting || entry.source !== "routing";
      }).slice();
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
