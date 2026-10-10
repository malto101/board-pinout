export var MARKER_R = 3.25;
export var LABEL_GAP = 14;
export var CENTER_POINT = [0.5, 0.5];

export function findPart(parts, id, parent) {
  for (var i = 0; i < (parts || []).length; i++) {
    var part = parts[i];
    if (part.id === id) return { part: part, parent: parent || null };
    var nested = findPart(part.children || [], id, part);
    if (nested) return nested;
  }
  return null;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function hasChildren(part) {
  return !!(part && part.children && part.children.length);
}

/** Ensure part.point is a finite [x,y]; default board center. Mutates part. */
export function ensurePoint(part, fallback) {
  fallback = fallback || CENTER_POINT;
  if (!part) return part;
  var pt = part.point;
  if (
    !Array.isArray(pt) ||
    pt.length < 2 ||
    !isFinite(Number(pt[0])) ||
    !isFinite(Number(pt[1]))
  ) {
    part.point = [fallback[0], fallback[1]];
  }
  return part;
}

export function ensurePointsDeep(parts) {
  (parts || []).forEach(function (p) {
    ensurePoint(p);
    ensurePointsDeep(p.children);
  });
}
