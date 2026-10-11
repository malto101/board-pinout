/** Shared semantic node visuals used by editor and read-only widgets. */
export const PART_SYMBOLS = {
  group: { title: "Group", color: "#a78bfa", glyph: "▦" },
  gnd: { title: "GND", color: "#9aa3b5", glyph: "⊥" },
  power: { title: "Power", color: "#e35d6a", glyph: "+" },
  led: { title: "LED", color: "#fbbf24", glyph: "◆" },
  button: { title: "Button", color: "#2dd4bf", glyph: "■" },
  switch: { title: "Switch", color: "#60a5fa", glyph: "◗" },
  sensor: { title: "Sensor", color: "#34d399", glyph: "◎" },
  port: { title: "Port", color: "#38bdf8", glyph: "▣" },
  io: { title: "I/O", color: "#f5a623", glyph: "●" },
  nc: { title: "NC", color: "#6b7280", glyph: "×" },
};

export const PART_SYMBOL_ORDER = [
  "group", "gnd", "power", "led", "button", "switch", "sensor", "port", "io", "nc",
];

export function visualForPart(part, types) {
  part = part || {};
  types = types || {};
  const type = types[part.ref || ""] || {};
  const kind = part.kind || type.kind || "";
  const controlType = part.control_type || type.control_type || "";
  const receptacleType = part.receptacle_type || type.receptacle_type || "";
  const text = [part.silk, part.id, part.ref, part.pad, part.notes, controlType, receptacleType].filter(Boolean).join(" ").toLowerCase();
  const role = (part.net || type.default_net || {}).role || "";
  let key = "io";
  if (role === "ground" || /\bgnd\b|\bground\b/.test(text)) key = "gnd";
  else if (["power_out", "power_in", "power_bidir"].includes(role) || /\b(vcc|vdd|vbus|vin|3v3|5v|pwr|power)\b/.test(text)) key = "power";
  else if (role === "nc" || /(^|\b)nc(\b|$)/.test(text)) key = "nc";
  else if (kind === "group" || kind === "pin_array") key = "group";
  else if (controlType === "led" || part.ref === "led_indicator" || /\bleds?\b/.test(text)) key = "led";
  else if (controlType === "button" || part.ref === "tactile_button" || /\b(btn|button)\b/.test(text)) key = "button";
  else if (controlType === "switch" || part.ref === "power_switch" || /\bswitch|\bsw\d*/.test(text)) key = "switch";
  else if (kind === "receptacle" || receptacleType || /usb|hdmi|eth|rj45/.test(text)) key = "port";
  else if (/sensor|imu|temp|accel|gyro|humid|press/.test(text)) key = "sensor";
  return { key, ...(PART_SYMBOLS[key] || PART_SYMBOLS.io) };
}

/** Selection halo shared by the editor and read-only widget. */
export function selectionHaloMarkup(cx, cy, { primary = false } = {}) {
  const ring = primary ? "#2dd4bf" : "#4c8dff";
  const glow = primary ? "rgba(45, 212, 191, 0.28)" : "rgba(76, 141, 255, 0.28)";
  return `
    <circle class="marker-halo-glow" cx="${cx}" cy="${cy}" r="13.5" fill="${glow}"/>
    <circle class="marker-halo-ring" cx="${cx}" cy="${cy}" r="11.5"
      fill="none" stroke="${ring}" stroke-width="2.4"/>
    <circle class="marker-halo-outer" cx="${cx}" cy="${cy}" r="14.5"
      fill="none" stroke="${ring}" stroke-width="1" opacity="0.5" stroke-dasharray="2.5 2"/>
  `;
}

/** Render a semantic marker while keeping a transparent, forgiving hit target. */
export function markerSymbolMarkup(cx, cy, visual, { active = false, primary = false } = {}) {
  visual = visual || PART_SYMBOLS.io;
  const c = visual.color;
  const stroke = active ? (primary ? "#2dd4bf" : "#4c8dff") : "#0c0e13";
  const sw = active ? 1.85 : 1.25;
  let shape = "";
  switch (visual.key) {
    case "gnd":
      shape = `
        <circle class="marker-gnd-backdrop" cx="${cx}" cy="${cy + 1}" r="8" fill="#fff" stroke="#0c0e13" stroke-width="1.4"/>
        <line x1="${cx - 6}" y1="${cy - 2}" x2="${cx + 6}" y2="${cy - 2}" stroke="${c}" stroke-width="1.7" stroke-linecap="round"/>
        <line x1="${cx - 4}" y1="${cy + 1}" x2="${cx + 4}" y2="${cy + 1}" stroke="${c}" stroke-width="1.45" stroke-linecap="round"/>
        <line x1="${cx - 2}" y1="${cy + 4}" x2="${cx + 2}" y2="${cy + 4}" stroke="${c}" stroke-width="1.25" stroke-linecap="round"/>`;
      break;
    case "power":
      shape = `
        <circle cx="${cx}" cy="${cy}" r="6" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>
        <path d="M${cx} ${cy - 3.2} V${cy + 3.2} M${cx - 3.2} ${cy} H${cx + 3.2}" stroke="#0c0e13" stroke-width="1.6" stroke-linecap="round"/>`;
      break;
    case "led":
      shape = `<path d="M${cx} ${cy - 6.5} L${cx + 6} ${cy} L${cx} ${cy + 6.5} L${cx - 6} ${cy} Z" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`;
      break;
    case "button":
      shape = `
        <rect x="${cx - 5.5}" y="${cy - 5.5}" width="11" height="11" rx="2.5" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>
        <circle cx="${cx}" cy="${cy}" r="2" fill="#0c0e13" opacity="0.35"/>`;
      break;
    case "switch":
      shape = `
        <rect x="${cx - 7}" y="${cy - 3.5}" width="14" height="7" rx="3.5" fill="#10131a" stroke="${c}" stroke-width="1.4"/>
        <circle cx="${cx + 3}" cy="${cy}" r="2.7" fill="${c}"/>`;
      break;
    case "sensor":
      shape = `
        <circle cx="${cx}" cy="${cy}" r="2.8" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>
        <path d="M${cx - 6.5} ${cy} A6.5 6.5 0 0 1 ${cx + 6.5} ${cy}" fill="none" stroke="${c}" stroke-width="1.25"/>
        <path d="M${cx - 4.2} ${cy - 1.2} A4.4 4.4 0 0 1 ${cx + 4.2} ${cy - 1.2}" fill="none" stroke="${c}" stroke-width="1.1"/>`;
      break;
    case "group":
      shape = `
        <rect x="${cx - 6.5}" y="${cy - 6.5}" width="8" height="8" rx="1.5" fill="none" stroke="${c}" stroke-width="1.35"/>
        <rect x="${cx - 2}" y="${cy - 2}" width="8.5" height="8.5" rx="1.5" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`;
      break;
    case "port":
      shape = `<path d="M${cx - 6} ${cy - 4.2} H${cx + 3.5} L${cx + 6.5} ${cy} L${cx + 3.5} ${cy + 4.2} H${cx - 6} Z" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`;
      break;
    case "nc":
      shape = `
        <circle cx="${cx}" cy="${cy}" r="5.5" fill="#242a36" stroke="${c}" stroke-width="${sw}"/>
        <path d="M${cx - 3} ${cy - 3} L${cx + 3} ${cy + 3} M${cx + 3} ${cy - 3} L${cx - 3} ${cy + 3}" stroke="${c}" stroke-width="1.55" stroke-linecap="round"/>`;
      break;
    default:
      shape = `<circle cx="${cx}" cy="${cy}" r="5.5" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  const halo = active ? selectionHaloMarkup(cx, cy, { primary }) : "";
  return `<g class="marker-point" data-sym="${visual.key}">${halo}${shape}<circle cx="${cx}" cy="${cy}" r="10" fill="transparent"/></g>`;
}
