export function imageBox(stage, img) {
  var sw = stage.clientWidth || 1;
  var sh = stage.clientHeight || 1;
  var natW = img.naturalWidth || sw;
  var natH = img.naturalHeight || sh;
  var scale = Math.min(sw / natW, sh / natH);
  var width = natW * scale;
  var height = natH * scale;
  return {
    left: (sw - width) / 2,
    top: (sh - height) / 2,
    width: width,
    height: height,
  };
}

export function resolveUnderlay(payload, root) {
  if (!payload.underlay) return "";
  var path = payload.underlay.replace(/^\/+/, "");
  var urlRoot =
    (window.DOCUMENTATION_OPTIONS && DOCUMENTATION_OPTIONS.URL_ROOT) || "";
  var candidates = [];
  if (urlRoot) candidates.push(urlRoot + path);
  candidates.push(path);
  // Page is often boards/<vendor>/<board>/doc/index.html → 4 levels up
  candidates.push("../../../../" + path);
  candidates.push("../../../" + path);
  candidates.push("../../" + path);
  // Absolute from site root when served from docs html root
  if (path.indexOf("_static/") === 0) candidates.push("/" + path);
  // data-relative attribute set by injector
  var rel = root.getAttribute("data-underlay-rel");
  if (rel) candidates.unshift(rel);
  return candidates;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function reducedMotion() {
  return !!(
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Animate a pan/zoom view {tx, ty, scale} from `from` to `to`.
 * The board point at the stage centre moves in a straight line while the
 * scale changes geometrically, so the target glides in instead of swooping.
 * `apply(view)` is called every frame; returns a function that cancels.
 */
export function tweenView(from, to, stageW, stageH, apply, opts) {
  opts = opts || {};
  var s0 = from.scale;
  var s1 = to.scale;
  var cx = stageW / 2;
  var cy = stageH / 2;
  // Board-space point under the stage centre at each end.
  var w0x = (cx - from.tx) / s0;
  var w0y = (cy - from.ty) / s0;
  var w1x = (cx - to.tx) / s1;
  var w1y = (cy - to.ty) / s1;
  var dist = Math.hypot((w1x - w0x) * s1, (w1y - w0y) * s1);
  var zoomSteps = Math.abs(Math.log(s1 / s0));
  if (reducedMotion() || (dist < 1 && zoomSteps < 0.01)) {
    apply({ tx: to.tx, ty: to.ty, scale: s1 });
    if (opts.done) opts.done();
    return function () {};
  }
  var duration =
    opts.duration != null
      ? opts.duration
      : Math.min(650, 260 + dist * 0.35 + zoomSteps * 120);
  var start = null;
  var raf = 0;
  function frame(now) {
    if (start === null) start = now;
    var t = Math.min(1, (now - start) / duration);
    var e = easeInOutCubic(t);
    if (t >= 1) {
      apply({ tx: to.tx, ty: to.ty, scale: s1 });
      raf = 0;
      if (opts.done) opts.done();
      return;
    }
    var s = s0 * Math.pow(s1 / s0, e);
    var wx = w0x + (w1x - w0x) * e;
    var wy = w0y + (w1y - w0y) * e;
    apply({ tx: cx - wx * s, ty: cy - wy * s, scale: s });
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return function () {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}
