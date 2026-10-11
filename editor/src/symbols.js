import { state } from "./state.js";
import { escapeAttr } from "./util.js";
import {
  PART_SYMBOLS as SHARED_PART_SYMBOLS,
  visualForPart,
  markerSymbolMarkup,
  selectionHaloMarkup,
} from "../../src/board_pinout/static/board_pinout/js/visual.js";

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

export { markerSymbolMarkup, selectionHaloMarkup };
