/**
 * Editor glue over the widget's label layout, so the editor and the docs
 * place labels identically.
 */
import { els } from "./state.js";
import { LABEL_GAP } from "../../src/board_pinout/static/board_pinout/js/util.js";
import { computeAutoLabelOffsets as layoutOffsets } from "../../src/board_pinout/static/board_pinout/js/labels.js";

export {
  screenReadableLabelRot,
  estimateLabelWidth,
  layoutLabelBox,
} from "../../src/board_pinout/static/board_pinout/js/labels.js";

const DEFAULT_GAP = LABEL_GAP + 42;

export function computeAutoLabelOffsets(markers, box) {
  const stage = els.canvasStage;
  return layoutOffsets(markers, box, stage?.clientWidth, stage?.clientHeight);
}

export function labelOffset(index, total, part, box, precomputed) {
  if (precomputed && precomputed[index]) return precomputed[index];
  if (part.label_offset && part.label_offset.length === 2) {
    return {
      dx: part.label_offset[0] * box.width,
      dy: part.label_offset[1] * box.height,
      rotation: Number(part.label_rotation) || 0,
    };
  }
  return { dx: DEFAULT_GAP, dy: 0, rotation: Number(part.label_rotation) || 0 };
}

export function bakeLabelOffset(part, index, total, box, markers) {
  if (part.label_offset && part.label_offset.length === 2) return;
  const offs = computeAutoLabelOffsets(markers || [part], box);
  const off = offs[index] || offs[0] || { dx: DEFAULT_GAP, dy: 0, rotation: 0 };
  part.label_offset = [
    Number((off.dx / Math.max(box.width, 1)).toFixed(4)),
    Number((off.dy / Math.max(box.height, 1)).toFixed(4)),
  ];
  if (off.rotation && part.label_rotation == null) {
    part.label_rotation = off.rotation;
  }
}
