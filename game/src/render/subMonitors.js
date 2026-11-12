// Physical sub-monitors in front of the pilot, after the anime reference (01 / 05 / 07): ONE console strip of three
// backlit indigo-violet panels (centre + left + right), same height, same tilt, same plane, tops and bottoms aligned.
// R2 look (one family): deep indigo backlight, pale lavender line work, cyan = system OK, amber = caution, red = lost.
// Every screen uses the same grid: 14 px outer frame with corner brackets, darker chamfered "cards" for each block
// (header / body / footer on the side screens, hero / rows / target on the centre), framed gauges, outlined status
// chips, and a cached glass layer on top (scan structure, edge glow, diagonal sheen, vignette).
// Live content: centre = weapons + target parts, left = threat radar + speed, right = own-suit line art + parts + hull.
// Each screen is an emissive canvas texture redrawn at ~15 Hz; frame art, radar grid and glass are cached offscreen,
// the tinted suit art is cached and only rebuilt when a part status / flash / blink phase changes.
// The housing (gunmetal back shell, thin bevelled frame around a recessed screen, dark gasket, pale top lip) is built
// here in makeScreen(). READS state only.
import * as THREE from 'three';
import { clamp, saturate, num, isVec, hash1, DEG, perfCount, decodeSRGBInShader } from './util.js';
import { XI_LINEART, XI_LINEART_SIZE } from './img/xiLineart.js';
import { GUSTAV_LINEART, GUSTAV_LINEART_SIZE } from './img/gustavLineart.js';
import { PENELOPE_LINEART, PENELOPE_LINEART_SIZE } from './img/penelopeLineart.js';

// Xi line art (front view, suit faces the viewer: its RIGHT arm is on the image LEFT). Part regions are polygons in
// normalised image coordinates; later entries paint over earlier ones.
const XI_REGIONS = [
  ['legs', [[0.10, 0.50], [0.92, 0.50], [0.94, 1.0], [0.04, 1.0]]],
  ['rArm', [[0.02, 0.29], [0.27, 0.29], [0.28, 0.52], [0.04, 0.54]]],
  ['lArm', [[0.68, 0.29], [0.92, 0.29], [0.98, 0.54], [0.70, 0.54]]],
  ['pack', [[0.00, 0.08], [0.33, 0.12], [0.30, 0.33], [0.03, 0.34]]],
  ['pack', [[0.55, 0.07], [1.00, 0.06], [0.97, 0.30], [0.58, 0.30]]],
  ['pods', [[0.20, 0.0], [0.34, 0.0], [0.31, 0.13], [0.20, 0.13]]],
  ['pods', [[0.66, 0.0], [0.86, 0.0], [0.80, 0.12], [0.64, 0.12]]],
  ['pods', [[0.80, 0.52], [1.00, 0.52], [0.98, 0.78], [0.80, 0.78]]],
  ['core', [[0.27, 0.30], [0.70, 0.30], [0.72, 0.52], [0.30, 0.54]]],
  ['head', [[0.30, 0.06], [0.62, 0.06], [0.64, 0.29], [0.32, 0.30]]],
];
const XI_MARKS = { head: [0.46, 0.17], rArm: [0.15, 0.42], lArm: [0.82, 0.42], legs: [0.45, 0.76], pack: [0.15, 0.2], pods: [0.9, 0.65], core: [0.5, 0.42] };
// Gustav Karl front view (reference 18), same part names as the player's parts. Image left = the suit's right (rifle) arm,
// image right = the shield arm. pack = shoulder armour, pods = the grey missile pod block on the shield side.
const GUSTAV_REGIONS = [
  ['legs', [[0.06, 0.37], [0.96, 0.37], [0.96, 1.0], [0.0, 1.0]]],
  ['rArm', [[0.10, 0.20], [0.29, 0.22], [0.31, 0.52], [0.10, 0.56]]],
  ['lArm', [[0.60, 0.0], [1.0, 0.0], [1.0, 0.52], [0.60, 0.52]]],
  ['pack', [[0.09, 0.10], [0.33, 0.10], [0.33, 0.23], [0.09, 0.25]]],
  ['pack', [[0.56, 0.10], [0.84, 0.10], [0.84, 0.24], [0.56, 0.24]]],
  ['pods', [[0.66, 0.25], [0.89, 0.25], [0.89, 0.47], [0.66, 0.47]]],
  ['core', [[0.27, 0.14], [0.63, 0.14], [0.64, 0.37], [0.28, 0.38]]],
  ['head', [[0.36, 0.0], [0.56, 0.0], [0.56, 0.145], [0.36, 0.145]]],
];
const GUSTAV_MARKS = { head: [0.45, 0.10], rArm: [0.19, 0.40], lArm: [0.9, 0.3], legs: [0.4, 0.72], pack: [0.2, 0.17], pods: [0.77, 0.36], core: [0.45, 0.26] };
// Penelope front view (owner line art, reference 19): viewer's left = the suit's right arm.
const PENELOPE_REGIONS = [
  ['legs', [[0.04, 0.52], [0.96, 0.52], [0.96, 1.0], [0.04, 1.0]]],
  ['rArm', [[0.05, 0.30], [0.31, 0.30], [0.31, 0.56], [0.05, 0.56]]],
  ['lArm', [[0.62, 0.33], [0.90, 0.33], [0.90, 0.56], [0.62, 0.56]]],
  ['pack', [[0.0, 0.03], [0.30, 0.03], [0.30, 0.30], [0.0, 0.30]]],
  ['pack', [[0.56, 0.03], [1.0, 0.03], [1.0, 0.32], [0.56, 0.32]]],
  ['pods', [[0.16, 0.14], [0.32, 0.14], [0.32, 0.30], [0.16, 0.30]]],
  ['pods', [[0.56, 0.14], [0.72, 0.14], [0.72, 0.30], [0.56, 0.30]]],
  ['core', [[0.30, 0.28], [0.68, 0.28], [0.68, 0.52], [0.30, 0.52]]],
  ['head', [[0.33, 0.08], [0.58, 0.08], [0.58, 0.28], [0.33, 0.28]]],
];
const PENELOPE_MARKS = { head: [0.45, 0.19], rArm: [0.17, 0.43], lArm: [0.76, 0.45], legs: [0.5, 0.75], pack: [0.12, 0.15], pods: [0.24, 0.22], core: [0.49, 0.4] };
const loadImg = (src, name) => { const img = new Image(); img.onerror = () => console.warn('line art failed to load:', name); img.src = src; return { img }; };
const ART = {
  xi: { ...loadImg(XI_LINEART, 'xi'), size: XI_LINEART_SIZE, regions: XI_REGIONS, marks: XI_MARKS },
  penelope: { ...loadImg(PENELOPE_LINEART, 'penelope'), size: PENELOPE_LINEART_SIZE, regions: PENELOPE_REGIONS, marks: PENELOPE_MARKS },
  gustav: { ...loadImg(GUSTAV_LINEART, 'gustav'), size: GUSTAV_LINEART_SIZE, regions: GUSTAV_REGIONS, marks: GUSTAV_MARKS },
};

// ---- LOOK KNOBS -------------------------------------------------------------------------------------------
// palette (one family for all three screens)
const BG0 = '#39399c', BG1 = '#151548';                 // backlight centre / edge (deep indigo-violet)
const CARD = 'rgba(6,6,34,0.38)';                       // darker block behind each readout group (contrast)
const LINE = '#dcdbff', DIMC = '#a09fe8', BRIGHT = '#f7f6ff';
const FAINT = 'rgba(220,219,255,0.24)', HAIR = 'rgba(220,219,255,0.13)';
const OFF = 'rgba(165,164,255,0.13)';                    // unlit gauge cell / 7-seg segment
const OKC = '#8cf6ff', AMB = '#ffd24a', RED = '#ff6274', ALLY = '#6effc8';
const AMB_LO = 'rgba(255,210,74,0.42)', RED_LO = 'rgba(255,98,116,0.42)';
export const SCREEN_H = 0.30;                                // all three screens share this height (m)
export const CENTER_SIZE = { w: 0.46, h: SCREEN_H };
export const SIDE_SIZE = { w: 0.30, h: SCREEN_H };
// strip placement in the seat/console frame (eye at the origin): plane centre, tilt (deg, negative = faces the eye
// from below), gap between neighbouring bezels (m)
export const STRIP = { y: -0.395, z: -0.50, tiltDeg: -31, gap: 0.066, scale: 0.56 };   // CR-002b: row <= ~20% of the screen height, low, as in refs 01/05/12
// -------------------------------------------------------------------------------------------------------------

const FONT = '"Roboto Mono", Consolas, "Courier New", monospace';
const TAU = Math.PI * 2;

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function mkTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  return t;
}
function roundedShape(w, h, r, S = THREE.Shape) {
  const s = new S();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function screenGeo(w, h, r) {
  const g = new THREE.ShapeGeometry(roundedShape(w, h, r), 6);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w / 2) / w, (p.getY(i) + h / 2) / h);
  return g;
}
function ringShape(ow, oh, or, iw, ih, ir) {
  const s = roundedShape(ow, oh, or);
  s.holes.push(roundedShape(iw, ih, ir, THREE.Path));
  return s;
}

// ---- canvas drawing helpers -------------------------------------------------------------------------------
// READABILITY (CR-003 UI pass): the console is tilted back and small on screen (centre ~190 x 155 css px at 1280x720, so
// canvas px are drawn at ~0.18 horizontally and ~0.23 vertically). All text is stretched KX horizontally to undo the squash.
// Rule of thumb: informative text >= 52 canvas px on the centre screen, >= 38 px on the side screens (~12 css px at 720p).
const KX = 1.25;
function txt(c, s, x, y, size, color = LINE, align = 'left', weight = 500) {
  c.font = `${weight} ${size}px ${FONT}`;
  c.fillStyle = color; c.textAlign = align;
  c.save(); c.translate(x, y); c.scale(KX, 1); c.fillText(s, 0, 0); c.restore();
}
function txtW(c, s, size, weight = 500) { c.font = `${weight} ${size}px ${FONT}`; return c.measureText(s).width * KX; }
// outlined status chip (DMG / LOST / JAM ...): text inside a small chamfered box, baseline y
function chip(c, s, x, y, size, color, align = 'left', filled = false) {
  const w = txtW(c, s, size, 600) + size * 0.5, h = size * 1.02;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  const y0 = y - size * 0.86;
  chamPath(c, x0, y0, w, h, size * 0.18);
  if (filled) { c.fillStyle = color; c.fill(); }
  else { c.fillStyle = 'rgba(6,6,34,0.45)'; c.fill(); c.strokeStyle = color; c.lineWidth = 2.5; c.stroke(); }
  txt(c, s, x0 + w / 2, y, size, filled ? '#14143f' : color, 'center', 600);
  return w;
}
function chamPath(c, x, y, w, h, cut) {
  c.beginPath();
  c.moveTo(x + cut, y); c.lineTo(x + w - cut, y); c.lineTo(x + w, y + cut); c.lineTo(x + w, y + h - cut);
  c.lineTo(x + w - cut, y + h); c.lineTo(x + cut, y + h); c.lineTo(x, y + h - cut); c.lineTo(x, y + cut); c.closePath();
}
function card(c, x, y, w, h, cut = 12) {
  chamPath(c, x, y, w, h, cut);
  c.fillStyle = CARD; c.fill();
  c.strokeStyle = FAINT; c.lineWidth = 1.6; c.stroke();
  // short bright ticks on the top-left / bottom-right chamfers (the line-art "corner" language)
  c.beginPath();
  c.moveTo(x, y + cut + 18); c.lineTo(x, y + cut); c.lineTo(x + cut, y); c.lineTo(x + cut + 18, y);
  c.moveTo(x + w, y + h - cut - 18); c.lineTo(x + w, y + h - cut); c.lineTo(x + w - cut, y + h); c.lineTo(x + w - cut - 18, y + h);
  c.strokeStyle = 'rgba(220,219,255,0.62)'; c.lineWidth = 2.4; c.stroke();
}
function hline(c, x0, x1, y, color = HAIR, lw = 1.5) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.strokeStyle = color; c.lineWidth = lw; c.stroke(); }
function ring(c, x, y, r, color, lw = 2) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.strokeStyle = color; c.lineWidth = lw; c.stroke(); }
function ticksRing(c, x, y, r0, r1, n, color, a0 = 0, a1 = TAU, lw = 2) {
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / n, ca = Math.cos(a), sa = Math.sin(a);
    c.moveTo(x + ca * r0, y + sa * r0); c.lineTo(x + ca * r1, y + sa * r1);
  }
  c.strokeStyle = color; c.lineWidth = lw; c.stroke();
}

// framed gauge: n cells (segmented when n <= 16, else a continuous bar with quarter marks), f = fill 0..1.
// `ghost` (0..1) draws a second, translucent fill on top (reload progress, smoothing trail).
function gauge(c, x, y, w, h, n, f, color, ghost = -1, ghostColor = AMB) {
  chamPath(c, x, y, w, h, Math.min(8, h * 0.25));
  c.fillStyle = 'rgba(6,6,34,0.42)'; c.fill();
  c.strokeStyle = FAINT; c.lineWidth = 2; c.stroke();
  const p = Math.max(4, Math.round(h * 0.14)), ix = x + p, iy = y + p, iw = w - 2 * p, ih = h - 2 * p;
  f = saturate(f);
  if (n <= 16) {
    const gap = Math.max(3, Math.min(6, iw / n * 0.18)), cw = (iw - (n - 1) * gap) / n;
    for (let i = 0; i < n; i++) {
      const on = f > (i + 0.5) / n;
      c.fillStyle = on ? color : OFF;
      c.fillRect(ix + i * (cw + gap), iy, cw, ih);
    }
  } else {
    c.fillStyle = OFF; c.fillRect(ix, iy, iw, ih);
    c.fillStyle = color; c.fillRect(ix, iy, iw * f, ih);
    c.fillStyle = 'rgba(6,6,34,0.55)';
    for (let i = 1; i < 4; i++) c.fillRect(Math.round(ix + (iw * i) / 4) - 1.5, iy, 3, ih);
  }
  if (ghost >= 0) {                                    // progress overlay (reload): translucent body + solid lower edge
    const gw = iw * saturate(ghost), eh = Math.max(4, ih * 0.2);
    c.fillStyle = ghostColor;
    c.globalAlpha = 0.38; c.fillRect(ix, iy, gw, ih - eh);
    c.globalAlpha = 1; c.fillRect(ix, iy + ih - eh, gw, eh);
    c.fillRect(ix + gw - 2, iy - 3, 4, ih + 6);
  }
}
const OK = 'ok';
function partColor(status, time) {
  if (status === 'destroyed') return RED;
  if (status === 'damaged') return Math.sin(time * 7) > -0.2 ? AMB : AMB_LO;
  return OKC;
}
function poly(c, pts, color, lw = 3, fillA = 0.18) {
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.closePath();
  c.globalAlpha = fillA; c.fillStyle = color; c.fill(); c.globalAlpha = 1;
  c.strokeStyle = color; c.lineWidth = lw; c.stroke();
}
function crossX(c, x, y, r, color) {
  c.beginPath(); c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r);
  c.strokeStyle = 'rgba(6,6,34,0.8)'; c.lineWidth = 8; c.stroke();
  c.strokeStyle = color; c.lineWidth = 4; c.stroke();
}
function staticNoise(c, x, y, w, h, t, amt) {
  c.fillStyle = 'rgba(220,219,255,0.5)';
  const n = Math.round(14 * amt), k = Math.floor(t * 20);
  for (let i = 0; i < n; i++) {
    const yy = y + hash1(k + i * 3.3) * h;
    c.fillRect(x + hash1(i + k) * w * 0.4, yy, w * (0.2 + 0.6 * hash1(i * 2.1 + k)), 2);
  }
}

// 7-segment digits ----------------------------------------------------------------------------------------------
const SEG = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g',
};
function seg7(c, x, y, h, str, color, dim) {
  const w = h * 0.52, t = h * 0.12, g = t * 0.25;
  const hx = (xx, yy) => [[xx + g + t * 0.4, yy], [xx + w - g - t * 0.4, yy], [xx + w - g - t, yy + t], [xx + g + t, yy + t]];
  const hm = (xx, yy) => [[xx + g + t * 0.5, yy + t / 2], [xx + g + t, yy], [xx + w - g - t, yy], [xx + w - g - t * 0.5, yy + t / 2], [xx + w - g - t, yy + t], [xx + g + t, yy + t]];
  const hb = (xx, yy) => [[xx + g + t, yy], [xx + w - g - t, yy], [xx + w - g - t * 0.4, yy + t], [xx + g + t * 0.4, yy + t]];
  const vx = (xx, yy, hh, top) => top
    ? [[xx, yy + g + t * 0.4], [xx + t, yy + g + t], [xx + t, yy + hh - g - t * 0.5], [xx + t / 2, yy + hh - g], [xx, yy + hh - g - t * 0.5]]
    : [[xx, yy + g + t * 0.5], [xx + t / 2, yy + g], [xx + t, yy + g + t * 0.5], [xx + t, yy + hh - g - t], [xx, yy + hh - g - t * 0.4]];
  const vr = (xx, yy, hh, top) => vx(xx, yy, hh, top).map((p) => [2 * xx + t - p[0], p[1]]);
  const fillP = (pts) => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill(); };
  const half = h / 2;
  let cx = x;
  for (const ch of str) {
    if (ch === '.') { c.fillStyle = color; c.fillRect(cx + t * 0.2, y + h - t, t, t); cx += t * 2.2; continue; }
    const on = SEG[ch] || '';
    const segs = {
      a: () => hx(cx, y), g: () => hm(cx, y + half - t / 2), d: () => hb(cx, y + h - t),
      f: () => vx(cx, y, half, true), b: () => vr(cx + w - t, y, half, true), e: () => vx(cx, y + half, half, false), c: () => vr(cx + w - t, y + half, half, false),
    };
    for (const k of 'abcdefg') {
      c.fillStyle = on.includes(k) ? color : dim;
      fillP(segs[k]());
    }
    cx += w + h * 0.16;
  }
}
// seg7 with the same stretch; advance per digit = 0.68 * h * KX
function seg7x(c, x, y, h, str, color, dim = OFF) {
  c.save(); c.translate(x, y); c.scale(KX, 1); seg7(c, 0, 0, h, str, color, dim); c.restore();
}

// ---- cached screen layers ----------------------------------------------------------------------------------------
// backlight + dot grid + outer frame with corner brackets (bottom layer)
function baseLayer(w, h) {
  const cv = mkCanvas(w, h), c = cv.getContext('2d');
  const g = c.createRadialGradient(w / 2, h * 0.42, h * 0.08, w / 2, h * 0.5, Math.max(w, h) * 0.72);
  g.addColorStop(0, BG0); g.addColorStop(1, BG1);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(220,219,255,0.07)';
  for (let y = 32; y < h - 20; y += 32) for (let x = 32; x < w - 20; x += 32) c.fillRect(x - 1, y - 1, 2, 2);
  c.lineJoin = 'miter';
  const m = 14, cut = 22;
  chamPath(c, m, m, w - 2 * m, h - 2 * m, cut);
  c.strokeStyle = FAINT; c.lineWidth = 2; c.stroke();
  const L = 34;
  c.beginPath();
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x0 = sx > 0 ? m : w - m, y0 = sy > 0 ? m : h - m;
    c.moveTo(x0, y0 + sy * (cut + L)); c.lineTo(x0, y0 + sy * cut); c.lineTo(x0 + sx * cut, y0); c.lineTo(x0 + sx * (cut + L), y0);
  }
  c.strokeStyle = 'rgba(220,219,255,0.75)'; c.lineWidth = 3.5; c.stroke();
  // centre index ticks on the frame (top / bottom)
  c.beginPath(); c.moveTo(w / 2 - 14, m); c.lineTo(w / 2 + 14, m); c.moveTo(w / 2 - 14, h - m); c.lineTo(w / 2 + 14, h - m);
  c.strokeStyle = 'rgba(220,219,255,0.75)'; c.lineWidth = 5; c.stroke();
  return { cv, c };
}
// glass layer (top): scan structure, vignette, soft edge glow, diagonal sheen
function glassLayer(w, h) {
  const cv = mkCanvas(w, h), c = cv.getContext('2d');
  c.fillStyle = 'rgba(4,4,26,0.11)';
  for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
  const v = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.38, w / 2, h / 2, Math.hypot(w, h) * 0.56);
  v.addColorStop(0, 'rgba(4,4,26,0)'); v.addColorStop(1, 'rgba(4,4,26,0.42)');
  c.fillStyle = v; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {                            // backlight bleeding at the glass edge
    c.strokeStyle = `rgba(190,188,255,${0.10 - i * 0.022})`; c.lineWidth = 3;
    c.strokeRect(1.5 + i * 3, 1.5 + i * 3, w - 3 - i * 6, h - 3 - i * 6);
  }
  const s = c.createLinearGradient(0, 0, w * 0.55, h * 0.9);
  s.addColorStop(0, 'rgba(255,255,255,0.10)'); s.addColorStop(0.55, 'rgba(255,255,255,0.035)'); s.addColorStop(1, 'rgba(255,255,255,0.0)');
  c.fillStyle = s;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.78, 0); c.lineTo(w * 0.30, h); c.lineTo(0, h); c.closePath(); c.fill();
  const t = c.createLinearGradient(0, 0, 0, h * 0.12);           // thin bright reflection under the top bezel lip
  t.addColorStop(0, 'rgba(255,255,255,0.10)'); t.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = t; c.fillRect(0, 0, w, h * 0.12);
  return cv;
}

export function createSubMonitors(state) {
  const group = new THREE.Group();

  // ---- screens + housing ---------------------------------------------------------------------------------------
  const matShell = new THREE.MeshLambertMaterial({ color: 0x1b1e24 });
  const matFrame = new THREE.MeshLambertMaterial({ color: 0x2a2d36 });
  const matGasket = new THREE.MeshBasicMaterial({ color: 0x05050a });
  const matLip = new THREE.MeshBasicMaterial({ color: 0x8486a8 });
  function makeScreen(w, h, cw, ch) {
    const canvas = mkCanvas(cw, ch);
    const tex = mkTex(canvas);
    const mat = decodeSRGBInShader(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const rr = Math.min(w, h) * 0.05;
    const screen = new THREE.Mesh(screenGeo(w, h, rr), mat);
    const bw = Math.min(w, h) * 0.05;                  // thin frame
    const gap = bw * 0.22;                             // dark gasket between glass and frame
    // gunmetal back shell (solid), recessed screen sits on it
    const shell = new THREE.Mesh(
      new THREE.ExtrudeGeometry(roundedShape(w + bw * 2.2, h + bw * 2.2, rr + bw), { depth: 0.03, bevelEnabled: false, curveSegments: 6 }),
      matShell,
    );
    shell.position.z = -0.0335;
    // gasket ring right around the glass
    const gasket = new THREE.Mesh(new THREE.ShapeGeometry(ringShape(w + gap * 2, h + gap * 2, rr + gap, w, h, rr), 6), matGasket);
    gasket.position.z = -0.0004;
    // bevelled front frame; its inner edge stands proud of the glass so the screen reads as recessed
    const frame = new THREE.Mesh(
      new THREE.ExtrudeGeometry(ringShape(w + bw * 2, h + bw * 2, rr + bw, w + gap * 2, h + gap * 2, rr + gap),
        { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 6 }),
      matFrame,
    );
    frame.position.z = -0.0035;
    // thin pale lip along the top edge of the frame (catches light, sells "glass display")
    const lip = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.86, bw * 0.16), matLip);
    lip.position.set(0, h / 2 + gap + (bw - gap) * 0.55, 0.0045);
    const g = new THREE.Group();
    g.add(shell, frame, gasket, lip, screen);
    return { g, canvas, ctx: canvas.getContext('2d'), tex, mat, cw, ch };
  }
  const CW = 1024, CH = Math.round(1024 * SCREEN_H / CENTER_SIZE.w);     // 667
  const centre = makeScreen(CENTER_SIZE.w, CENTER_SIZE.h, CW, CH);
  const left = makeScreen(SIDE_SIZE.w, SIDE_SIZE.h, 512, 512);
  const right = makeScreen(SIDE_SIZE.w, SIDE_SIZE.h, 512, 512);
  group.add(centre.g, left.g, right.g);

  // ---- LAYOUT KNOBS: one flat console strip. All three share y / z / tilt, so tops and bottoms line up. ----------
  {
    const dx = (CENTER_SIZE.w / 2 + STRIP.gap + SIDE_SIZE.w / 2) * STRIP.scale;
    const rows = [[centre, 0], [left, -dx], [right, dx]];
    for (const [s, x] of rows) {
      s.g.position.set(x, STRIP.y, STRIP.z);
      s.g.rotation.set(STRIP.tiltDeg * DEG, 0, 0);
      s.g.scale.setScalar(STRIP.scale);
    }
  }

  // ---- static frame art (cached) -----------------------------------------------------------------------------------
  // CENTRE grid (1024 x 667): content x 52..972. hero card y 34..238, rows card y 250..460, target card y 472..642.
  const CX0 = 52, CX1 = 972;
  const cStatic = (() => {
    const { cv, c } = baseLayer(CW, CH);
    card(c, 34, 34, CW - 68, 204);
    card(c, 34, 250, CW - 68, 210);
    card(c, 34, 472, CW - 68, 170);
    c.beginPath(); c.moveTo(520, 54); c.lineTo(520, 218); c.strokeStyle = HAIR; c.lineWidth = 1.5; c.stroke();
    for (let i = 1; i < 3; i++) hline(c, CX0, CX1, 260 + i * 66 - 2, HAIR, 1.2);
    hline(c, CX0, CX1, 532, HAIR, 1.2);
    c.beginPath(); c.moveTo(512, 544); c.lineTo(512, 632); c.strokeStyle = HAIR; c.lineWidth = 1.5; c.stroke();
    return cv;
  })();
  // SIDE grid (512 x 512): header card y 32..92, body y 104..378, footer card y 390..480. content x 40..472.
  const SX0 = 40, SX1 = 472;
  function sideBase() {
    const b = baseLayer(512, 512);
    card(b.c, 30, 32, 452, 60, 10);
    card(b.c, 30, 390, 452, 90, 10);
    return b;
  }
  // radar grid (static part of the left screen)
  const RCX = 256, RCY = 240, RR = 124;
  const SE = Math.sin(50 * DEG), CE = Math.cos(50 * DEG);
  const lStatic = (() => {
    const { cv, c } = sideBase();
    c.lineJoin = 'round';
    c.beginPath(); c.arc(RCX, RCY, RR, 0, TAU); c.fillStyle = 'rgba(6,6,34,0.30)'; c.fill();
    ring(c, RCX, RCY, RR, LINE, 3);
    ring(c, RCX, RCY, RR * 0.5, 'rgba(220,219,255,0.42)', 1.8);
    c.strokeStyle = 'rgba(220,219,255,0.40)'; c.lineWidth = 1.8;
    c.beginPath(); c.ellipse(RCX, RCY, RR, RR * SE, 0, 0, TAU); c.stroke();
    c.beginPath(); c.ellipse(RCX, RCY, RR * 0.5, RR * 0.5 * SE, 0, 0, TAU); c.stroke();
    c.beginPath(); c.ellipse(RCX, RCY, RR, RR * CE, 0, 0, TAU); c.stroke();
    c.strokeStyle = 'rgba(220,219,255,0.26)'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(RCX, RCY - RR); c.lineTo(RCX, RCY + RR); c.moveTo(RCX - RR, RCY); c.lineTo(RCX + RR, RCY); c.stroke();
    ticksRing(c, RCX, RCY, RR - 8, RR, 72, 'rgba(220,219,255,0.5)', 0, TAU, 1.6);
    ticksRing(c, RCX, RCY, RR - 14, RR, 12, 'rgba(220,219,255,0.8)', -Math.PI / 2, TAU - Math.PI / 2, 2.4);
    // forward index (nose) above the ring
    c.beginPath(); c.moveTo(RCX - 9, RCY - RR - 16); c.lineTo(RCX, RCY - RR - 5); c.lineTo(RCX + 9, RCY - RR - 16);
    c.strokeStyle = LINE; c.lineWidth = 2.6; c.stroke();
    c.beginPath(); c.moveTo(300, 404); c.lineTo(300, 466); c.strokeStyle = HAIR; c.lineWidth = 1.5; c.stroke();
    return cv;
  })();
  const rStatic = sideBase().cv;
  const gC = glassLayer(CW, CH), gS = glassLayer(512, 512);

  // ---- dynamic drawing -----------------------------------------------------------------------------------------------
  const v = new THREE.Vector3(), qI = new THREE.Quaternion();
  const flash = { head: 0, rArm: 0, lArm: 0, legs: 0, pack: 0, pods: 0, core: 0, shield: 0 };
  function onEvent(e) {
    if ((e.type === 'playerHit' || e.type === 'partDamaged' || e.type === 'partDestroyed') && typeof e.part === 'string' && e.part in flash) flash[e.part] = 0.2;
    else if (e.type === 'partDamaged' || e.type === 'partDestroyed') flash.core = 0.2;
    else if (e.type === 'playerHit') flash.core = 0.2;
    if (e.type === 'shieldBlock') flash.shield = 0.25;
  }
  const entById = (id) => {
    const ents = Array.isArray(state.entities) ? state.entities : [];
    for (let i = 0; i < ents.length; i++) if (ents[i] && ents[i].id === id && ents[i].alive !== false) return ents[i];
    return null;
  };
  // smoothed display values (gauges ease toward the live value; counts stay exact)
  const sm = {};
  const ease = (k, target, rate = 0.42) => {
    if (!(k in sm) || !Number.isFinite(sm[k])) sm[k] = target;
    sm[k] += (target - sm[k]) * rate;
    if (Math.abs(target - sm[k]) < 1e-3) sm[k] = target;
    return sm[k];
  };

  // CENTRE SCREEN = weapons. hero (active weapon, E-Pack digits + gauge, reload state), three rows (FUNNEL|PODS,
  // VULCAN, FLARE), target parts.
  const STAT_TAG = { damaged: 'DMG', destroyed: 'LOST' };
  function drawWeapons(c, p, time) {
    const w = p.weapons || {}, rifle = w.rifle || {}, fun = w.funnel || {}, vul = w.vulcan || {}, fl = w.flares || {};
    const mods = p.mods || {};
    const parts = p.parts || {};
    const stOf = (k) => (parts[k] && parts[k].status) || OK;
    const gustav = p.suit === 'gustav';
    const blink = Math.sin(time * 10) > -0.2;
    c.lineJoin = 'miter';
    // ---- hero: active weapon + E-Pack ----
    const saber = w.active === 'saber';
    const per = Math.max(1, Math.round(num(rifle.perPack, 15)));
    const shots = Math.max(0, Math.round(num(rifle.shots, per)));
    const rifleLost = mods.rifleOk === false || stOf('rArm') === 'destroyed';
    const saberLost = mods.saberOk === false;
    const reloading = !!rifle.reloading;
    // active-weapon marker: small filled chevron before the name
    const nameCol = saber ? (saberLost ? RED : OKC) : (rifleLost ? RED : BRIGHT);
    c.beginPath(); c.moveTo(CX0, 66); c.lineTo(CX0 + 16, 80); c.lineTo(CX0, 94); c.closePath(); c.fillStyle = nameCol; c.fill();
    if (saber) txt(c, saberLost ? 'SABER LOST' : 'BEAM SABER', CX0 + 30, 98, 56, nameCol, 'left', 600);
    else txt(c, rifleLost ? 'RIFLE LOST' : 'BEAM RIFLE', CX0 + 30, 98, 56, nameCol, 'left', 600);
    const low = shots <= 3 && !rifleLost;
    const dcol = rifleLost ? RED_LO : low ? (blink ? RED : RED_LO) : saber ? DIMC : BRIGHT;
    seg7x(c, CX0 + 4, 116, 102, String(rifleLost ? 0 : shots).padStart(2, ' '), dcol);
    txt(c, '/' + per, CX0 + 4 + 2 * 0.68 * 102 * KX + 10, 216, 52, DIMC, 'left', 500);
    // right column: E-PACK gauge + state
    const RX0 = 548, RX1 = CX1 - 4;
    txt(c, 'E-PACK', RX0, 98, 52, saber ? DIMC : LINE, 'left', 500);
    const dmgR = stOf('rArm') === 'damaged' && !rifleLost;
    if (dmgR) chip(c, 'DMG', RX1, 98, 50, AMB, 'right');
    const ef = ease('epack', rifleLost ? 0 : shots / per, 0.5);
    const ecol = low ? RED : saber ? DIMC : OKC;
    gauge(c, RX0, 116, RX1 - RX0, 52, per, ef, ecol, reloading && !rifleLost ? ease('reload', saturate(num(rifle.reload, 0)), 0.6) : -1);
    if (rifleLost) chip(c, 'NO RIFLE', RX0, 216, 52, RED, 'left');
    else if (reloading) {
      txt(c, 'RELOADING', RX0, 216, 52, blink ? AMB : AMB_LO, 'left', 600);
    } else if (shots <= 0) chip(c, 'EMPTY [R]', RX0, 216, 52, blink ? RED : RED_LO, 'left');
    else if (low) chip(c, 'LOW', RX0, 216, 52, RED, 'left');
    else {                                                       // graduation under the gauge when nothing to report
      c.beginPath();
      const iw = RX1 - RX0 - 14;
      for (let i = 0; i <= per; i++) { const x = RX0 + 7 + (iw * i) / per; c.moveTo(x, 178); c.lineTo(x, i % 5 === 0 ? 194 : 186); }
      c.strokeStyle = FAINT; c.lineWidth = 2; c.stroke();
    }
    // ---- rows (y 260..458, pitch 66) ----
    const rows = [];
    const fc = Math.round(num(fun.count, 0)), fm = Math.max(1, Math.round(num(fun.max, 24)));
    const fLost = mods.funnelOk === false || stOf('pods') === 'destroyed';
    rows.push({ k: 'fun', label: gustav ? 'PODS' : 'FUNNEL', val: fLost ? 'LOST' : String(fc), lost: fLost, tag: !fLost && stOf('pods') === 'damaged' ? 'DMG' : '', n: Math.min(fm, 24), f: fc / Math.min(fm, 24), col: fc <= 0 ? RED : OKC });
    const va = num(vul.ammo, 0), vm = Math.max(1, num(vul.max, 800));
    const vLost = mods.vulcanOk === false;
    rows.push({ k: 'vul', label: 'VULCAN', val: vLost ? 'LOST' : String(Math.round(va)), lost: vLost, tag: !vLost && stOf('head') === 'damaged' ? 'DMG' : '', n: 24, f: va / vm, col: va / vm < 0.15 ? RED : OKC });
    const fn = Math.round(num(fl.count, 0)), fmx = Math.max(1, Math.min(12, Math.round(num(fl.max, 12))));
    rows.push({ k: 'flr', label: 'FLARE', val: String(fn), lost: false, tag: '', n: fmx, f: fn / fmx, col: fn <= 2 ? AMB : OKC });
    for (let i = 0; i < 3; i++) {
      const r = rows[i], top = 260 + i * 66, base = top + 47;
      const warn = r.lost || r.col === RED;
      txt(c, r.label, CX0, base, 52, warn ? RED : LINE, 'left', 600);
      if (r.tag) chip(c, r.tag, 300, base - 1, 50, AMB, 'left');
      const vc = r.lost ? (blink ? RED : RED_LO) : r.col === OKC ? BRIGHT : r.col;
      txt(c, r.val, 604, base + 2, 62, vc, 'right', 600);
      gauge(c, 628, top + 10, CX1 - 4 - 628, 42, r.n, r.lost ? 0 : ease(r.k, r.f), r.lost ? RED : r.col);
    }
  }

  // target part readout: name + 4 coloured parts, short names, no percentages
  const TPARTS = {
    gustav: [['head', 'HEAD'], ['gunArm', 'GUN'], ['pod', 'POD'], ['thrusters', 'THRUST']],
    penelope: [['head', 'HEAD'], ['rifleArm', 'RIFLE'], ['salvoArm', 'SALVO'], ['wingPack', 'WINGS']],
  };
  function drawTargetParts(c, p, time) {
    const mods = p.mods || {};
    const tg = p.target || {};
    const e = tg.id != null ? entById(tg.id) : null;
    const tw = chip(c, 'TGT', CX0, 518, 50, e && TPARTS[e.type] ? AMB : DIMC, 'left');
    if (!e || !TPARTS[e.type]) { txt(c, 'NO TARGET', 512, 600, 52, DIMC, 'center', 500); return; }
    txt(c, String(e.name || e.type).toUpperCase().slice(0, 20), CX0 + tw + 20, 518, 52, BRIGHT, 'left', 600);
    if (mods.targetReadable === false) {
      c.save(); c.beginPath(); c.rect(40, 540, 944, 96); c.clip();
      staticNoise(c, 44, 544, 936, 88, time, 1);
      c.restore();
      chip(c, 'DATA LOST', 512, 604, 54, AMB, 'center');
      return;
    }
    const names = TPARTS[e.type];
    const parts = e.parts || {};
    for (let i = 0; i < 4; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const x = CX0 + col * 470, y = 582 + row * 50, xr = x + (col ? CX1 - 4 - x : 452);
      const pr = parts[names[i][0]] || { status: OK };
      const stt = pr.status || OK;
      const cc = partColor(stt, time);
      // status marker: small diamond, filled when not OK
      c.beginPath(); c.moveTo(x + 10, y - 32); c.lineTo(x + 21, y - 19); c.lineTo(x + 10, y - 6); c.lineTo(x - 1, y - 19); c.closePath();
      if (stt === OK) { c.strokeStyle = cc; c.lineWidth = 2.5; c.stroke(); } else { c.fillStyle = cc; c.fill(); }
      txt(c, names[i][1], x + 34, y, 52, stt === OK ? LINE : cc, 'left', 500);
      if (stt !== OK) chip(c, STAT_TAG[stt] || 'DMG', xr, y - 1, 48, cc, 'right');
      else txt(c, 'OK', xr - 8, y, 50, 'rgba(140,246,255,0.7)', 'right', 600);
    }
  }

  function drawCentre(time, p) {
    const c = centre.ctx;
    c.drawImage(cStatic, 0, 0);
    c.lineCap = 'butt';
    drawWeapons(c, p, time);
    drawTargetParts(c, p, time);
    c.drawImage(gC, 0, 0);
    centre.tex.needsUpdate = true; perfCount.uploads++;
  }

  // CR-013 story Chapter 2: the left screen becomes a heading-up NAV map (flat, linear, zoom chosen so Seawrack stays on
  // it): the pickets with their radar circles (red, painted ones pulse), Seawrack (green; amber once found), hostiles.
  function drawNav(time, p) {
    const c = left.ctx, st = state.story, sw = st.seawrack, pos = p.position;
    c.drawImage(lStatic, 0, 0);
    const cx = RCX, cy = RCY, r = RR;
    if (!isVec(pos) || !p.quaternion) { c.drawImage(gS, 0, 0); left.tex.needsUpdate = true; return; }
    v.set(0, 0, -1).applyQuaternion(p.quaternion);
    const yaw = Math.atan2(v.x, -v.z), fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
    const dShip = Math.hypot(sw.position.x - pos.x, sw.position.z - pos.z);
    const range = dShip > 26000 ? 60000 : dShip > 12000 ? 30000 : dShip > 5000 ? 15000 : 6000;
    const k = (r * 0.96) / range;
    const P2 = (wx, wz) => { const dx = wx - pos.x, dz = wz - pos.z; return [cx + (dx * rx + dz * rz) * k, cy - (dx * fx + dz * fz) * k * SE]; };
    c.save();
    c.beginPath(); c.ellipse(cx, cy, r, r * SE, 0, 0, TAU); c.clip();
    for (const pk of st.pickets || []) {
      if (!isVec(pk.position)) continue;
      const [px, py] = P2(pk.position.x, pk.position.z);
      const pr = pk.radius * k;
      c.beginPath(); c.ellipse(px, py, pr, pr * SE, 0, 0, TAU);
      c.fillStyle = pk.painted ? `rgba(255,98,116,${0.22 + 0.12 * Math.sin(time * 12)})` : 'rgba(255,98,116,0.10)'; c.fill();
      c.strokeStyle = RED_LO; c.lineWidth = 2; c.stroke();
      c.fillStyle = RED; c.fillRect(px - 5, py - 5, 10, 10);
    }
    if (isVec(sw.position)) {
      const [sx, sy] = P2(sw.position.x, sw.position.z);
      const col = sw.alive === false ? RED : sw.found ? AMB : ALLY;
      c.save(); c.translate(sx, sy); c.rotate(sw.heading - yaw); c.scale(1, 1);
      c.beginPath(); c.moveTo(0, -14); c.lineTo(6, -6); c.lineTo(6, 12); c.lineTo(-6, 12); c.lineTo(-6, -6); c.closePath();
      c.fillStyle = col; c.fill(); c.restore();
    }
    const ents = Array.isArray(state.entities) ? state.entities : [];
    for (const e of ents) {
      if (!e || e.alive === false || e.faction !== 'enemy' || !isVec(e.position) || (e.type !== 'gustav' && e.type !== 'penelope')) continue;
      const [ex, ey] = P2(e.position.x, e.position.z);
      c.beginPath(); c.moveTo(ex - 7, ey + 5); c.lineTo(ex, ey - 6); c.lineTo(ex + 7, ey + 5); c.strokeStyle = RED; c.lineWidth = 3; c.stroke();
    }
    c.restore();
    c.fillStyle = BRIGHT; c.beginPath(); c.moveTo(cx, cy - 11); c.lineTo(cx + 8, cy + 8); c.lineTo(cx, cy + 4); c.lineTo(cx - 8, cy + 8); c.closePath(); c.fill();
    // header: map scale + radar state; footer: distance to Seawrack
    txt(c, 'NAV', SX0, 76, 38, DIMC, 'left', 500);
    txt(c, `${range / 1000}K`, SX0 + 92, 76, 40, BRIGHT, 'left', 600);
    const rd = st.radar || {};
    if (rd.state === 'painted') chip(c, 'PAINT', SX1, 76, 38, RED, 'right', Math.sin(time * 10) > 0);
    else if (rd.state === 'hidden') chip(c, 'LOW', SX1, 76, 38, ALLY, 'right', false);
    seg7x(c, SX0 + 4, 406, 58, (dShip / 1000).toFixed(1).padStart(5, ' '), sw.found ? AMB : BRIGHT);
    txt(c, 'KM', SX1, 430, 38, DIMC, 'right', 500);
    txt(c, 'SEAWRACK', SX1, 470, 34, sw.found ? AMB : ALLY, 'right', 600);
    c.drawImage(gS, 0, 0);
    left.tex.needsUpdate = true; perfCount.uploads++;
  }

  // Chapter 3 (sim/missions/oenbili.js): NAV map - the waypoint (coast, the rebels' pad; the signal only as a bearing),
  // Circe in red, the rebels in green, Seawrack, and the town as a dashed keep-clear ring (it is never a battlefield)
  function drawNav3(time, p) {
    const c = left.ctx, st = state.story, ob = st.ob || {}, pos = p.position;
    c.drawImage(lStatic, 0, 0);
    const cx = RCX, cy = RCY, r = RR;
    if (!isVec(pos) || !p.quaternion) { c.drawImage(gS, 0, 0); left.tex.needsUpdate = true; return; }
    v.set(0, 0, -1).applyQuaternion(p.quaternion);
    const yaw = Math.atan2(v.x, -v.z), fx = Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = Math.sin(yaw);
    const w = ob.waypoint;
    const dW = w ? Math.hypot(w.x - pos.x, w.z - pos.z) : 0;
    const range = dW > 26000 ? 60000 : dW > 12000 ? 30000 : dW > 5000 ? 15000 : 6000;
    const k = (r * 0.96) / range;
    const P2 = (wx, wz) => { const dx = wx - pos.x, dz = wz - pos.z; return [cx + (dx * rx + dz * rz) * k, cy - (dx * fx + dz * fz) * k * SE]; };
    c.save();
    c.beginPath(); c.ellipse(cx, cy, r, r * SE, 0, 0, TAU); c.clip();
    // the town: keep clear
    { const [tx, ty] = P2(0, 0), tr = 6000 * k;
      c.setLineDash([8, 7]); c.beginPath(); c.ellipse(tx, ty, tr, tr * SE, 0, 0, TAU); c.strokeStyle = 'rgba(200,210,220,0.45)'; c.lineWidth = 2; c.stroke(); c.setLineDash([]);
      c.fillStyle = 'rgba(200,210,220,0.6)'; c.fillRect(tx - 4, ty - 4, 8, 8); }
    if (st.seawrack && isVec(st.seawrack.position)) {
      const [sx, sy] = P2(st.seawrack.position.x, st.seawrack.position.z);
      c.save(); c.translate(sx, sy); c.rotate(st.seawrack.heading - yaw);
      c.beginPath(); c.moveTo(0, -14); c.lineTo(6, -6); c.lineTo(6, 12); c.lineTo(-6, 12); c.lineTo(-6, -6); c.closePath();
      c.fillStyle = ALLY; c.fill(); c.restore();
    }
    if (w && !w.vague) {
      const [wx, wy] = P2(w.x, w.z);
      c.beginPath(); c.moveTo(wx, wy - 12); c.lineTo(wx + 12, wy); c.lineTo(wx, wy + 12); c.lineTo(wx - 12, wy); c.closePath();
      c.strokeStyle = w.label === 'PAD' ? ALLY : BRIGHT; c.lineWidth = 3; c.stroke();
    }
    const ents = Array.isArray(state.entities) ? state.entities : [];
    for (const e of ents) {
      if (!e || e.alive === false || !isVec(e.position) || e.type !== 'gustav') continue;
      const [ex, ey] = P2(e.position.x, e.position.z);
      const friend = e.paint === 'rebel';
      if (!friend && e.faction !== 'enemy') continue;
      c.beginPath(); c.moveTo(ex - 7, ey + 5); c.lineTo(ex, ey - 6); c.lineTo(ex + 7, ey + 5); c.strokeStyle = friend ? ALLY : RED; c.lineWidth = 3; c.stroke();
    }
    c.restore();
    // the signal: a bearing only
    if (w && w.vague) {
      const a = Math.atan2((w.x - pos.x) * rx + (w.z - pos.z) * rz, (w.x - pos.x) * fx + (w.z - pos.z) * fz);
      const L = r * 0.8;
      c.setLineDash([10, 8]); c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(a) * L, cy - Math.cos(a) * L * SE);
      c.strokeStyle = AMB; c.lineWidth = 3; c.stroke(); c.setLineDash([]);
    }
    c.fillStyle = BRIGHT; c.beginPath(); c.moveTo(cx, cy - 11); c.lineTo(cx + 8, cy + 8); c.lineTo(cx, cy + 4); c.lineTo(cx - 8, cy + 8); c.closePath(); c.fill();
    txt(c, 'NAV', SX0, 76, 38, DIMC, 'left', 500);
    txt(c, `${range / 1000}K`, SX0 + 92, 76, 40, BRIGHT, 'left', 600);
    if (w && w.vague) {
      seg7x(c, SX0 + 4, 406, 58, String(Math.round((ob.signal || 0) * 100)).padStart(5, ' '), AMB);
      txt(c, '%', SX1, 430, 38, DIMC, 'right', 500);
      txt(c, 'SIGNAL', SX1, 470, 34, AMB, 'right', 600);
    } else if (w) {
      seg7x(c, SX0 + 4, 406, 58, (dW / 1000).toFixed(1).padStart(5, ' '), BRIGHT);
      txt(c, 'KM', SX1, 430, 38, DIMC, 'right', 500);
      txt(c, w.label, SX1, 470, 34, w.label === 'PAD' ? ALLY : BRIGHT, 'right', 600);
    } else txt(c, 'OENBILI', SX1, 470, 34, DIMC, 'right', 600);
    c.drawImage(gS, 0, 0);
    left.tex.needsUpdate = true; perfCount.uploads++;
  }

  // LEFT: stylised threat radar + speed
  function drawRadar(time, p, dens) {
    if (state.story && state.story.chapter === 2 && state.story.seawrack) { drawNav(time, p); return; }
    if (state.story && state.story.chapter === 3 && state.story.ob && state.phase === 'flight' && !(state.story.stage === 'defend' || state.story.stage === 'intercept')) { drawNav3(time, p); return; }
    const c = left.ctx;
    c.drawImage(lStatic, 0, 0);
    const cx = RCX, cy = RCY, r = RR;
    c.lineJoin = 'round';
    ticksRing(c, cx, cy, r + 7, r + 13, 24, 'rgba(220,219,255,0.42)', time * 0.15, time * 0.15 + TAU, 1.6);
    const mods = p.mods || {};
    const headSt = (p.parts && p.parts.head && p.parts.head.status) || OK;
    const range = (dens < 0.5 ? 8000 : dens < 0.8 ? 3000 : 1500) * clamp(num(mods.radarRange, 1), 0.1, 1);
    const jam = dens > 0.8;
    const sw = time * 2.0;
    for (let i = 0; i < 5; i++) {                       // sweep wedge with a soft trailing fade
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r - 1, sw - (i + 1) * 0.11, sw - i * 0.11); c.closePath();
      c.fillStyle = `rgba(140,246,255,${0.15 * (1 - i / 5)})`; c.fill();
    }
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(sw) * r, cy + Math.sin(sw) * r); c.strokeStyle = 'rgba(140,246,255,0.65)'; c.lineWidth = 2; c.stroke();
    // own suit
    c.fillStyle = BRIGHT; c.beginPath(); c.moveTo(cx, cy - 11); c.lineTo(cx + 8, cy + 8); c.lineTo(cx, cy + 4); c.lineTo(cx - 8, cy + 8); c.closePath(); c.fill();
    const pos = p.position;
    const sel = p.target && p.target.id != null ? p.target.id : (p.lock && p.lock.targetId);
    if (pos && p.quaternion) {
      qI.copy(p.quaternion).invert();
      const ents = Array.isArray(state.entities) ? state.entities : [];
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (!e || e.alive === false || !isVec(e.position) || e.faction === 'player') continue;
        const ship = e.type === 'gustav' || e.type === 'penelope' || e.type === 'remote', msl = e.type === 'missile' || e.type === 'funnelMissile';
        if (!ship && !msl) continue;
        const ally = e.faction === 'ally';
        if (ally && msl) continue;
        if (e.type === 'remote' && e.dead) continue;
        v.set(e.position.x - pos.x, e.position.y - pos.y, e.position.z - pos.z);
        const d = v.length();
        if (d > range * 1.05 && !msl) continue;
        if (msl && d > Math.min(range, 5000)) continue;
        if ((jam || headSt === 'damaged') && hash1(Math.floor(time * 10) + i * 7.3) < (jam ? 0.35 : 0.2)) continue;
        v.applyQuaternion(qI).multiplyScalar(1 / Math.max(d, 1));
        const s = Math.sqrt(Math.min(d, range) / range) * r * 0.96;
        let sx = cx + v.x * s, sy = cy - ((-v.z) * SE + v.y * CE) * s;
        if (headSt === 'destroyed') { sx += (hash1(Math.floor(time * 20) + i) - 0.5) * 24; sy += (hash1(Math.floor(time * 17) + i * 3) - 0.5) * 24; }
        const gy = cy - ((-v.z) * SE) * s;
        const col = ally ? ALLY : RED;
        c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx, gy); c.strokeStyle = ally ? 'rgba(110,255,200,0.5)' : 'rgba(255,98,116,0.5)'; c.lineWidth = 1.6; c.stroke();
        c.fillStyle = col; c.fillRect(sx - 3, gy - 1.5, 6, 3);   // ground foot of the drop line
        if (ship) {
          c.beginPath(); c.moveTo(sx - 12, sy + 9); c.lineTo(sx, sy - 10); c.lineTo(sx + 12, sy + 9);
          c.strokeStyle = 'rgba(6,6,34,0.7)'; c.lineWidth = 8; c.stroke();
          c.strokeStyle = col; c.lineWidth = 4.5; c.stroke();
          if (e.id === sel) {                             // selected: amber corner brackets
            const b = 18, k = 7;
            c.beginPath();
            for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.moveTo(sx + qx * b, sy + qy * (b - k)); c.lineTo(sx + qx * b, sy + qy * b); c.lineTo(sx + qx * (b - k), sy + qy * b); }
            c.strokeStyle = AMB; c.lineWidth = 3; c.stroke();
          }
        } else {
          const pz = 8 + 4 * (0.5 + 0.5 * Math.sin(time * 14));
          c.beginPath(); c.moveTo(sx, sy - pz); c.lineTo(sx + pz, sy); c.lineTo(sx, sy + pz); c.lineTo(sx - pz, sy); c.closePath();
          c.fillStyle = RED; c.fill();
        }
      }
    }
    if (headSt !== OK) staticNoise(c, 120, 110, 272, 260, time, headSt === 'destroyed' ? 1 : 0.4);
    if (jam) { c.fillStyle = RED; for (let i = 0; i < 6; i++) c.fillRect(150 + hash1(i + Math.floor(time * 8)) * 200, 110 + hash1(i * 3 + Math.floor(time * 8)) * 260, 30 + hash1(i) * 50, 2); }
    // header: radar range / jam
    txt(c, 'RNG', SX0, 76, 38, DIMC, 'left', 500);
    txt(c, `${(range / 1000).toFixed(1)}K`, SX0 + 92, 76, 40, BRIGHT, 'left', 600);
    if (jam) chip(c, 'JAM', SX1, 76, 38, RED, 'right', Math.sin(time * 8) > 0);
    // footer: speed (7-seg), m/s and Mach
    const spd = Math.round(ease('spd', clamp(num(p.speed, 0), 0, 9999), 0.55));
    seg7x(c, SX0 + 4, 406, 58, String(spd).padStart(4, ' '), BRIGHT);
    txt(c, 'M/S', SX1, 430, 38, DIMC, 'right', 500);
    const mach = num(p.mach, 0);
    txt(c, 'M' + mach.toFixed(2), SX1, 470, 40, mach >= 1 ? AMB : LINE, 'right', 600);
    c.drawImage(gS, 0, 0);
    left.tex.needsUpdate = true; perfCount.uploads++;
  }

  // RIGHT: player suit line art (cyan ok / amber damaged / red lost) + part list + hull gauge; transformation
  // diagnostic while it runs. The tinted + glowing art is cached and rebuilt only when its look changes.
  const artC = mkCanvas(280, 340), tintC = mkCanvas(280, 340), glowC = mkCanvas(300, 360);
  let artKey = '';
  const PART_KEYS = ['head', 'rArm', 'lArm', 'legs', 'pack', 'pods', 'core'];
  function buildArt(art, stOf, time) {
    const XW = art.size[0], XH = art.size[1], img = art.img, regions = art.regions;
    const a = artC.getContext('2d'), t = tintC.getContext('2d');
    a.globalCompositeOperation = 'source-over'; a.clearRect(0, 0, artC.width, artC.height);
    a.drawImage(img, 0, 0, XW, XH);
    const path = (g, pts) => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0] * XW, q[1] * XH) : g.moveTo(q[0] * XW, q[1] * XH))); g.closePath(); };
    for (const [k, pts] of regions) {
      const flashing = flash[k] > 0 || (k === 'lArm' && flash.shield > 0);
      const stt = stOf(k);
      if (stt === OK && !flashing) continue;
      t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, tintC.width, tintC.height);
      t.save(); path(t, pts); t.clip();
      t.drawImage(img, 0, 0, XW, XH);
      t.globalCompositeOperation = 'source-atop';
      t.fillStyle = flashing ? '#ffffff' : stt === 'destroyed' ? RED : (Math.sin(time * 7) > -0.2 ? AMB : 'rgba(255,210,74,0.45)');
      t.fillRect(0, 0, XW, XH);
      t.restore();
      a.save(); path(a, pts); a.clip(); a.globalCompositeOperation = 'destination-out'; a.drawImage(img, 0, 0, XW, XH); a.restore();
      a.globalCompositeOperation = 'source-over'; a.drawImage(tintC, 0, 0);
    }
    // glow pass, baked once per look change
    const g = glowC.getContext('2d');
    g.clearRect(0, 0, glowC.width, glowC.height);
    g.save(); g.shadowColor = 'rgba(120,240,255,0.85)'; g.shadowBlur = 7; g.drawImage(artC, 10, 10); g.restore();
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.2; g.drawImage(artC, 10, 10);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }
  const PART_ROWS = [['head', 'HEAD'], ['rArm', 'RARM'], ['lArm', 'LARM'], ['legs', 'LEGS'], ['pack', 'PACK'], ['pods', 'PODS']];
  const ART_X1 = 200, LIST_X0 = 222;                      // art box x 36..200 | divider | part list x 222..472
  function drawPartList(c, p, time, top, bottom) {
    const parts = p.parts || {};
    const pitch = Math.min(44, (bottom - top) / PART_ROWS.length);
    const x0 = LIST_X0, x1 = SX1;
    for (let i = 0; i < PART_ROWS.length; i++) {
      const [k, label] = PART_ROWS[i];
      const sk = (parts[k] && parts[k].status) || OK;
      const y = top + (i + 1) * pitch - 9;
      const col = sk === OK ? DIMC : partColor(sk, time);
      c.fillStyle = sk === OK ? 'rgba(140,246,255,0.55)' : col;
      c.fillRect(x0 - 12, y - 27, 4, 28);
      txt(c, label, x0, y, 38, sk === OK ? LINE : col, 'left', 600);
      txt(c, sk === 'destroyed' ? 'LOST' : sk === 'damaged' ? 'DMG' : 'OK', x1, y, 38, sk === OK ? 'rgba(140,246,255,0.7)' : col, 'right', 600);
    }
  }
  function drawSuitArt(c, p, time, top, bottom) {
    const art = ART[p.suit === 'gustav' || p.suit === 'penelope' ? p.suit : 'xi'];
    const parts = p.parts || {};
    const st = (k) => (parts[k] && parts[k].status) || OK;
    const hullV = saturate(num(p.hull, 1));
    const stOf = (k) => (k === 'core' ? (hullV < 0.3 ? 'destroyed' : hullV < 0.6 ? 'damaged' : OK) : st(k));
    // box for the art: x 36..248
    const bx0 = 34, bx1 = ART_X1, bh = bottom - top;
    if (art.img.complete && art.img.naturalWidth > 0) {
      const XW = art.size[0], XH = art.size[1];
      const blinkOn = Math.sin(time * 7) > -0.2;
      let key = (p.suit || 'xi') + (blinkOn ? '1' : '0');
      for (const k of PART_KEYS) key += stOf(k)[0] + (flash[k] > 0 ? '!' : '');
      key += flash.shield > 0 ? 'S' : '';
      if (key !== artKey) { buildArt(art, stOf, time); artKey = key; }
      const sc = Math.min((bx1 - bx0) / XW, bh / XH), dw = XW * sc, dh = XH * sc;
      const dx = (bx0 + bx1) / 2 - dw / 2, dy = top + (bh - dh) / 2;
      // stand: floor line + centre index under the suit
      c.beginPath(); c.moveTo(bx0 + 6, dy + dh + 4); c.lineTo(bx1 - 6, dy + dh + 4); c.strokeStyle = HAIR; c.lineWidth = 1.5; c.stroke();
      c.globalAlpha = 0.95 + 0.05 * Math.sin(time * 30);
      c.drawImage(glowC, 0, 0, glowC.width, glowC.height, dx - 10 * sc, dy - 10 * sc, glowC.width * sc, glowC.height * sc);
      c.globalAlpha = 1;
      for (const k of PART_KEYS) {
        if (stOf(k) !== 'destroyed') continue;
        const m = art.marks[k];
        crossX(c, dx + m[0] * dw, dy + m[1] * dh, 9, RED);
      }
    } else if (!art.img.complete) {                         // still decoding: simple placeholder outline
      const col = (k) => (flash[k] > 0 ? '#ffffff' : partColor(stOf(k), time));
      const cx = (bx0 + bx1) / 2, y0 = top + 10;
      poly(c, [[cx - 18, y0 + 30], [cx, y0], [cx + 18, y0 + 30], [cx + 10, y0 + 44], [cx - 10, y0 + 44]], col('head'), 3, 0.2);
      poly(c, [[cx - 38, y0 + 52], [cx + 38, y0 + 52], [cx + 28, y0 + 140], [cx - 28, y0 + 140]], col('core'), 3, 0.16);
      poly(c, [[cx + 42, y0 + 56], [cx + 72, y0 + 60], [cx + 76, y0 + 170], [cx + 54, y0 + 170]], col('lArm'), 3, 0.2);
      poly(c, [[cx - 42, y0 + 56], [cx - 72, y0 + 60], [cx - 76, y0 + 170], [cx - 54, y0 + 170]], col('rArm'), 3, 0.2);
      poly(c, [[cx - 28, y0 + 146], [cx + 28, y0 + 146], [cx + 30, bottom - 12], [cx - 30, bottom - 12]], col('legs'), 3, 0.18);
    }
  }
  function drawTransform(c, p, time, ft, top) {
    const t = saturate(num(ft.t, 0));
    const to = ft.state === 'toFlight';
    const cx = 256, cy = 190;
    c.lineJoin = 'round'; c.lineCap = 'round';
    const fold = saturate(t / 0.3), wing = saturate((t - 0.3) / 0.5), drive = saturate((t - 0.8) / 0.2);
    // wireframe, top view (in the art box): fuselage + shoulder armour vectoring + wing flaps deploying + drive output
    c.save(); c.translate((34 + ART_X1) / 2, top + 118); c.scale(0.5, 0.5); c.translate(-cx, -cy);
    c.strokeStyle = LINE; c.lineWidth = 5;
    c.beginPath();
    c.moveTo(cx, cy - 120); c.lineTo(cx + 26, cy - 60); c.lineTo(cx + 22, cy + 70); c.lineTo(cx + 12, cy + 110);
    c.lineTo(cx - 12, cy + 110); c.lineTo(cx - 22, cy + 70); c.lineTo(cx - 26, cy - 60); c.closePath(); c.stroke();
    for (const sx of [-1, 1]) {
      const ang = (1 - fold) * 70 * DEG;
      const shx = cx + sx * 30, shy = cy - 40;
      c.beginPath(); c.moveTo(shx, shy); c.lineTo(shx + sx * 54 * Math.cos(ang), shy + 54 * Math.sin(ang)); c.strokeStyle = 'rgba(220,219,255,0.8)'; c.stroke();
      const wl = 30 + 110 * wing;
      c.beginPath(); c.moveTo(cx + sx * 22, cy + 20); c.lineTo(cx + sx * (22 + wl), cy + 70 - 20 * wing); c.lineTo(cx + sx * (22 + wl * 0.7), cy + 96); c.lineTo(cx + sx * 20, cy + 76);
      c.strokeStyle = OKC; c.stroke();
    }
    const flick = 0.7 + 0.3 * Math.sin(time * 40);
    c.beginPath(); c.moveTo(cx - 12, cy + 112); c.lineTo(cx, cy + 112 + 60 * drive * flick); c.lineTo(cx + 12, cy + 112);
    c.strokeStyle = drive > 0.05 ? AMB : 'rgba(220,219,255,0.25)'; c.stroke();
    c.restore();
    c.lineCap = 'butt';
    // progress column
    const x0 = LIST_X0, w = SX1 - x0;
    txt(c, to ? 'TRANSFORM' : 'REVERT', SX1, top + 40, 38, AMB, 'right', 600);
    const rowsT = [['FOLD', fold, OKC], ['WING', wing, OKC], ['DRIVE', drive, AMB]];
    for (let i = 0; i < 3; i++) {
      const y = top + 104 + i * 64;
      txt(c, rowsT[i][0], x0, y, 38, LINE, 'left', 500);
      gauge(c, x0, y + 8, w, 26, 10, rowsT[i][1], rowsT[i][2]);
    }
  }
  function drawVisual(time, p, dens) {
    const c = right.ctx;
    c.drawImage(rStatic, 0, 0);
    c.lineJoin = 'round';
    const ft = p.flightTransition || {};
    const xf = ft.state && ft.state !== 'idle';
    for (const k in flash) if (flash[k] > 0) flash[k] = Math.max(0, flash[k] - 1 / 15);
    // header: suit + form (Gustav has no flight unit)
    const gustav = p.suit === 'gustav';
    const name = gustav ? 'FD-03' : p.suit === 'penelope' ? 'RX-104FF' : 'RX-105';
    txt(c, name, SX0, 76, 40, BRIGHT, 'left', 600);
    let top = 108;
    if (gustav) {
      txt(c, 'FLIGHT', SX1, 76, 38, DIMC, 'right', 500);
      chip(c, 'NOT EQUIPPED', SX0, 142, 38, AMB, 'left');
      top = 158;
    } else {
      const fl = p.flightMode === 'minovsky';
      txt(c, fl ? 'FLIGHT' : 'HOVER', SX1, 76, 38, fl ? AMB : DIMC, 'right', 600);
    }
    const bottom = 378;
    if (xf) drawTransform(c, p, time, ft, top);
    else {
      drawSuitArt(c, p, time, top, bottom);
      c.beginPath(); c.moveTo(ART_X1 + 4, top + 6); c.lineTo(ART_X1 + 4, bottom - 6); c.strokeStyle = HAIR; c.lineWidth = 1.5; c.stroke();
      drawPartList(c, p, time, top, bottom);
    }
    // footer: hull gauge
    const hull = saturate(num(p.hull, 1));
    const hc = hull < 0.3 ? RED : hull < 0.6 ? AMB : OKC;
    const blink = hull < 0.3 && Math.sin(time * 9) < -0.1;
    const tc = blink ? RED_LO : hull < 0.6 ? hc : LINE;
    txt(c, 'HULL', SX0 + 4, 428, 40, tc, 'left', 600);
    txt(c, Math.round(hull * 100) + '%', SX1 - 4, 428, 40, blink ? RED_LO : hull < 0.6 ? hc : BRIGHT, 'right', 600);
    gauge(c, SX0 + 4, 440, SX1 - SX0 - 8, 30, 20, ease('hull', hull), hc);
    c.drawImage(gS, 0, 0);
    right.tex.needsUpdate = true; perfCount.uploads++;
  }

  let acc = 0, wasOn = false;
  // ctx: { time, power 0..1, stage }
  function update(dt, ctxv) {
    const power = saturate(num(ctxv.power, 1));
    const col = power * (0.92 + 0.08 * hash1(Math.floor(ctxv.time * 14)));
    for (const s of [centre, left, right]) s.mat.color.setScalar(col);
    group.visible = true;
    if (power <= 0.01) { wasOn = false; return; }
    acc -= dt;
    if (acc > 0 && wasOn) return;
    acc = 1 / 15; wasOn = true;
    const p = state.player || {};
    const dens = saturate(num(state.world && state.world.minovskyDensity, 0));
    drawCentre(ctxv.time, p);
    drawRadar(ctxv.time, p, dens);
    drawVisual(ctxv.time, p, dens);
  }

  // initial dark fill so the screens never show garbage
  for (const s of [centre, left, right]) { s.ctx.fillStyle = '#05050f'; s.ctx.fillRect(0, 0, s.cw, s.ch); s.tex.needsUpdate = true; }

  return { group, update, onEvent };
}
