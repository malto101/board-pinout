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
