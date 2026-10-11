import { state } from "./state.js";
import { escapeAttr } from "./util.js";
import { PART_SYMBOLS as SHARED_PART_SYMBOLS, visualForPart } from "../../src/board_pinout/static/board_pinout/js/visual.js";

export const PART_SYMBOLS = SHARED_PART_SYMBOLS;

/** Roles you can assign to a pin / selection (not groups). */
export const PIN_ROLES = ["io", "gnd", "power", "led", "button", "switch", "sensor", "port", "nc"];

// Fixed nets each role stands for; other roles drive a signal (no net).
const ROLE_NETS = { gnd: "ground", power: "power_out", nc: "nc" };
const NET_ROLES = { ground: "gnd", power_out: "power", power_in: "power", power_bidir: "power", nc: "nc" };

export function applyRoleToPart(part, roleKey) {
  if (!part || roleKey === "group") return;
  const controlRefs = new Set(["led_indicator", "tactile_button", "power_switch"]);
  const portRefs = new Set(["usb_c", "usb_a", "micro_usb", "hdmi", "eth_rj45"]);

  if (part.notes === "sensor") delete part.notes;
  if (ROLE_NETS[roleKey]) {
    part.net = { ...(part.net || {}), role: ROLE_NETS[roleKey] };
  } else if (part.net && NET_ROLES[part.net.role]) {
    delete part.net;
  }

  switch (roleKey) {
    case "gnd":
    case "power":
    case "nc":
      delete part.pad;
      if (controlRefs.has(part.ref) || portRefs.has(part.ref)) delete part.ref;
      if (part.kind === "gpio_control" || part.kind === "receptacle") part.kind = "pin";
      break;
    case "led":
      part.ref = "led_indicator";
      part.kind = "gpio_control";
      break;
    case "button":
      part.ref = "tactile_button";
      part.kind = "gpio_control";
      break;
    case "switch":
      part.ref = "power_switch";
      part.kind = "gpio_control";
      break;
    case "sensor":
      if (controlRefs.has(part.ref) || portRefs.has(part.ref)) delete part.ref;
      if (!part.kind || part.kind === "gpio_control" || part.kind === "receptacle") part.kind = "pin";
      part.notes = "sensor";
      break;
    case "port":
      if (!portRefs.has(part.ref)) part.ref = "usb_c";
      part.kind = "receptacle";
      break;
    case "io":
    default:
      if (controlRefs.has(part.ref) || portRefs.has(part.ref)) delete part.ref;
      if (part.kind === "gpio_control" || part.kind === "receptacle") part.kind = "pin";
      break;
  }
}

export function resolvePartVisual(part) {
  if (!part) return { key: "io", ...PART_SYMBOLS.io };
  return visualForPart(part, state.types);
}

export function partSymBadge(partOrKey) {
  const v =
    typeof partOrKey === "string"
      ? { key: partOrKey, ...(PART_SYMBOLS[partOrKey] || PART_SYMBOLS.io) }
      : resolvePartVisual(partOrKey);
  return `<span class="part-sym" data-sym="${escapeAttr(v.key)}" title="${escapeAttr(
    v.title
  )}" style="--sym:${escapeAttr(v.color)}">${escapeAttr(v.glyph)}</span>`;
}

/** Selection halo: soft fill + contrasting ring (primary vs multi). */
export function selectionHaloMarkup(cx, cy, { primary }) {
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

export function markerSymbolMarkup(cx, cy, visual, { active = false, primary = false } = {}) {
  const c = visual.color;
  const stroke = active ? (primary ? "#2dd4bf" : "#4c8dff") : "#0c0e13";
  const sw = active ? 1.85 : 1.25;
  let shape = "";
  switch (visual.key) {
    case "gnd":
      shape = `
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
      shape = `
        <path d="M${cx} ${cy - 6.5} L${cx + 6} ${cy} L${cx} ${cy + 6.5} L${cx - 6} ${cy} Z"
          fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`;
      break;
    case "button":
      shape = `
        <rect x="${cx - 5.5}" y="${cy - 5.5}" width="11" height="11" rx="2.5"
          fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>
        <circle cx="${cx}" cy="${cy}" r="2" fill="#0c0e13" opacity="0.35"/>`;
      break;
    case "switch":
      shape = `
        <rect x="${cx - 7}" y="${cy - 3.5}" width="14" height="7" rx="3.5"
          fill="#10131a" stroke="${c}" stroke-width="1.4"/>
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
      shape = `
        <path d="M${cx - 6} ${cy - 4.2} H${cx + 3.5} L${cx + 6.5} ${cy} L${cx + 3.5} ${cy + 4.2} H${cx - 6} Z"
          fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`;
      break;
    case "nc":
      shape = `
        <circle cx="${cx}" cy="${cy}" r="5.5" fill="#242a36" stroke="${c}" stroke-width="${sw}"/>
        <path d="M${cx - 3} ${cy - 3} L${cx + 3} ${cy + 3} M${cx + 3} ${cy - 3} L${cx - 3} ${cy + 3}"
          stroke="${c}" stroke-width="1.55" stroke-linecap="round"/>`;
      break;
    default:
      shape = `
        <circle cx="${cx}" cy="${cy}" r="5.5" fill="${c}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }
  const halo = active ? selectionHaloMarkup(cx, cy, { primary }) : "";
  return `<g class="marker-point">${halo}${shape}<circle cx="${cx}" cy="${cy}" r="10" fill="transparent"/></g>`;
}
