import { CENTER_POINT, LABEL_GAP } from "./util.js";

export function uniqueAxisCount(values, eps) {
  var sorted = values.slice().sort(function (a, b) {
    return a - b;
  });
  var count = 0;
  var last = -Infinity;
  sorted.forEach(function (v) {
    if (v - last > eps) {
      count += 1;
      last = v;
    }
  });
  return count;
}

/**
 * Keep label text readable on screen when the underlay view is rotated.
 * Labels live inside the rotator, so screen angle = labelRot + viewRot.
 * If that would be upside-down (|angle| > 90°), flip the label by 180°.
 */
export function screenReadableLabelRot(labelRot, viewRot) {
  var lr = Number(labelRot) || 0;
  var vr = Number(viewRot) || 0;
  var screen = ((lr + vr) % 360 + 360) % 360;
  if (screen > 180) screen -= 360;
  if (screen > 90 || screen < -90) lr += 180;
  return lr;
}

export function estimateLabelWidth(part) {
  var label = (part && (part.silk || part.id)) || "";
  return Math.max(28, String(label).length * 6.2 + 10);
}

/**
 * If a label would render outside the stage, flip dx/dy toward the pin's
 * inward side so overflow:hidden does not clip silk at the underlay edge.
 */
export function fitOffsetInStage(off, pt, tw, th, stageW, stageH, pad) {
  var dx = off.dx;
  var dy = off.dy;
  var rot = off.rotation || 0;
  var vertical = Math.abs(dy) > Math.abs(dx);
  // Rotated labels swap the footprint roughly (use max side).
  var footW = vertical || Math.abs(rot) === 90 || Math.abs(rot) === 270 ? th : tw;
  var footH = vertical || Math.abs(rot) === 90 || Math.abs(rot) === 270 ? tw : th;

  function bounds(tdx, tdy) {
    var lx = pt.x + tdx;
    var ly = pt.y + tdy;
    var rx;
    var ry;
    var vert = Math.abs(tdy) > Math.abs(tdx);
    if (vert) {
      rx = lx - footW / 2;
      ry = tdy >= 0 ? ly : ly - footH;
    } else if (tdx >= 0) {
      rx = lx;
      ry = ly - footH / 2;
    } else {
      rx = lx - footW;
      ry = ly - footH / 2;
    }
    return { rx: rx, ry: ry, rw: footW, rh: footH };
  }

  var b = bounds(dx, dy);
  if (b.rx < pad && dx <= 0) dx = Math.abs(dx) || LABEL_GAP + 42;
  b = bounds(dx, dy);
  if (b.rx + b.rw > stageW - pad && dx >= 0) dx = -(Math.abs(dx) || LABEL_GAP + 42);
  // Dual-row header labels keep their row's side: flipping single pins
  // would mix both rows' labels on one side.
  if (!off.lockSide) {
    b = bounds(dx, dy);
    if (b.ry < pad && dy <= 0) dy = Math.abs(dy) || LABEL_GAP + 26;
    b = bounds(dx, dy);
    if (b.ry + b.rh > stageH - pad && dy >= 0) dy = -(Math.abs(dy) || LABEL_GAP + 26);
  }

  return { dx: dx, dy: dy, rotation: rot, lockSide: off.lockSide };
}

/**
 * Place labels so leaders stay short and parallel.
 * Dual-row headers (2×N like Nordic P0–P2): labels sit just above/below
 * each pin with the SAME −90° rotation (one reading direction — never
 * mirror one row with +90°). 2×2 clusters: outward left/right, no cross.
 * Near stage edges, flip inward so labels are not clipped by overflow
 * (dual-row rows keep their side so each row reads from one edge).
 */
export function computeAutoLabelOffsets(list, box, stageW, stageH) {
  var n = list.length;
  if (!n) return [];
  stageW = stageW || box.left * 2 + box.width;
  stageH = stageH || box.top * 2 + box.height;
  var pad = 8;
  var pts = list.map(function (p) {
    var pt = p.point || CENTER_POINT;
    return {
      x: box.left + Number(pt[0]) * box.width,
      y: box.top + Number(pt[1]) * box.height,
    };
  });
  var minX = Infinity;
  var maxX = -Infinity;
  var minY = Infinity;
  var maxY = -Infinity;
  pts.forEach(function (pt) {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minY = Math.min(minY, pt.y);
    maxY = Math.max(maxY, pt.y);
  });
  var midX = (minX + maxX) / 2;
  var midY = (minY + maxY) / 2;
  var spanX = Math.max(maxX - minX, 1);
  var spanY = Math.max(maxY - minY, 1);
  var nX = uniqueAxisCount(
    pts.map(function (p) {
      return p.x;
    }),
    4
  );
  var nY = uniqueAxisCount(
    pts.map(function (p) {
      return p.y;
    }),
    4
  );
  // Wide dual-row pin header (e.g. 2×10): vertical labels stacked per column.
  var dualRowHeader = nY === 2 && nX >= 4;
  var tallStrip = spanX < 14 && spanY > spanX * 1.2;
  var gap = LABEL_GAP + 42;
  var vGap = LABEL_GAP + 26;

  return pts.map(function (pt, i) {
    var authored = list[i].label_offset;
    var authoredRot = list[i].label_rotation;
    var rotAuth =
      authoredRot !== undefined &&
      authoredRot !== null &&
      authoredRot !== "" &&
      isFinite(Number(authoredRot));
    var tw = estimateLabelWidth(list[i]);
    if (authored && authored.length === 2) {
      return fitOffsetInStage(
        {
          dx: Number(authored[0]) * box.width,
          dy: Number(authored[1]) * box.height,
          rotation: rotAuth ? Number(authoredRot) : 0,
        },
        pt,
        tw,
        16,
        stageW,
        stageH,
        pad
      );
    }
    if (dualRowHeader) {
      var up = pt.y <= midY;
      return fitOffsetInStage(
        {
          dx: 0,
          dy: up ? -vGap : vGap,
          rotation: rotAuth ? Number(authoredRot) : -90,
          lockSide: true,
        },
        pt,
        tw,
        16,
        stageW,
        stageH,
        pad
      );
    }
    if (tallStrip) {
      return fitOffsetInStage(
        {
          dx: gap,
          dy: 0,
          rotation: rotAuth ? Number(authoredRot) : 0,
        },
        pt,
        tw,
        16,
        stageW,
        stageH,
        pad
      );
    }
    var side = pt.x <= midX ? -1 : 1;
    return fitOffsetInStage(
      {
        dx: side * gap,
        dy: 0,
        rotation: rotAuth ? Number(authoredRot) : 0,
      },
      pt,
      tw,
      16,
      stageW,
      stageH,
      pad
    );
  });
}

export function layoutLabelBox(cx, cy, off, tw, th) {
  var lx = cx + off.dx;
  var ly = cy + off.dy;
  var vertical = Math.abs(off.dy) > Math.abs(off.dx);
  var side = vertical ? (off.dy >= 0 ? "bottom" : "top") : off.dx >= 0 ? "right" : "left";
  var rx;
  var ry;
  var textX;
  var textY;
  var anchor;
  var tipX = lx;
  var tipY = ly;
  if (vertical) {
    if (off.dy >= 0) {
      rx = lx - tw / 2;
      ry = ly;
      textX = lx;
      textY = ly + th / 2 + 3.5;
      anchor = "middle";
    } else {
      rx = lx - tw / 2;
      ry = ly - th;
      textX = lx;
      textY = ly - th / 2 + 3.5;
      anchor = "middle";
    }
  } else if (off.dx >= 0) {
    rx = lx;
    ry = ly - th / 2;
    textX = lx + 5;
    textY = ly + 3.5;
    anchor = "start";
  } else {
    rx = lx - tw;
    ry = ly - th / 2;
    textX = lx - 5;
    textY = ly + 3.5;
    anchor = "end";
  }
  return {
    side: side,
    lx: lx,
    ly: ly,
    rx: rx,
    ry: ry,
    textX: textX,
    textY: textY,
    anchor: anchor,
    tipX: tipX,
    tipY: tipY,
  };
}
