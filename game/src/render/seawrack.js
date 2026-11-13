// CR-013 story Chapter 2: the carrier ship Seawrack (after the owner's reference picture, assets/images/
// seawrack_reference.webp) and the three enemy radar pickets. Drawn in the world pass with the game's toon + outline
// shaders, positioned from state.story (sim/missions/seawrack.js). Units: metres. Model frame: bow toward -Z, +Y up,
// waterline at y = 0. Ship-local z in the sim runs toward the bow, so sim z = -model z.
// CR-013b (owner): the picture's shape and colours in the armour style of the Chapter 1 cargo container: hull panel rows
// with recessed seams and alternating shades, a raised rubbing strake, frame ribs, hazard edges, greebles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, toonOutline } from './shaders.js';
import { outlineGeometry } from './models.js';
import { SEAWRACK as C } from '../sim/tuning.js';

// ---- geometry helpers: non-indexed, vertex-coloured -----------------------------------------------------------------
const flat = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k); return n; };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Vector3();
// colour: a hex, or (centroid, normal) => hex, evaluated per triangle
function paint(g, color) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3), p = g.attributes.position.array;
  const fixed = typeof color === 'function' ? null : new THREE.Color(color);
  const tmp = new THREE.Color();
  for (let t = 0; t < n; t += 3) {
    let c = fixed;
    if (!c) {
      _a.fromArray(p, t * 3); _b.fromArray(p, t * 3 + 3); _c.fromArray(p, t * 3 + 6);
      _n.subVectors(_c, _b).cross(_m.subVectors(_a, _b)).normalize();
      _m.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3);
      c = tmp.set(color(_m, _n));
    }
    for (let k = 0; k < 3; k++) { a[(t + k) * 3] = c.r; a[(t + k) * 3 + 1] = c.g; a[(t + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
// box from min/max corners
function box(x0, y0, z0, x1, y1, z1, color) {
  const g = flat(new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return paint(g, color);
}
// box by centre / size, optionally rotated about Y then X
function cbox(x, y, z, w, h, d, color, ry = 0, rx = 0) {
  const g = flat(new THREE.BoxGeometry(w, h, d));
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, color);
}
function cyl(r, h, x, y, z, color, seg = 8, axis = 'y', r2 = r) {
  const g = flat(new THREE.CylinderGeometry(r2, r, h, seg));
  if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}
// bar between two points with a square section s
function bar(x0, y0, z0, x1, y1, z1, s, color) {
  const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), d = b.clone().sub(a);
  const g = flat(new THREE.BoxGeometry(s, s, d.length()));
  g.lookAt(d);                                   // local +Z along the bar
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return paint(g, color);
}
// rail with posts along a polyline of [x, z] points at height y (post spacing ~6 m)
function railing(P, pts, y, h = 1.6, color = 0xf0f2f4) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    P.push(bar(x0, y + h, z0, x1, y + h, z1, 0.22, color));
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 6));
    for (let k = 0; k <= n; k++) { const t = k / n; P.push(box(x0 + (x1 - x0) * t - 0.12, y, z0 + (z1 - z0) * t - 0.12, x0 + (x1 - x0) * t + 0.12, y + h, z0 + (z1 - z0) * t + 0.12, color)); }
  }
}
// grid of small dark windows on a wall: wall plane x = const (side) or z = const (front), facing `face` (+1 / -1)
function windows(P, axis, at, face, u0, u1, y0, y1, cols, rows, w, h, color) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = u0 + (u1 - u0) * (c + 0.5) / cols, y = y0 + (y1 - y0) * (r + 0.5) / rows;
    if (axis === 'x') P.push(box(at - 0.15 * face, y - h / 2, u - w / 2, at + 0.25 * face, y + h / 2, u + w / 2, color));
    else P.push(box(u - w / 2, y - h / 2, at - 0.15 * face, u + w / 2, y + h / 2, at + 0.25 * face, color));
  }
}
const merge = (list) => { const g = mergeGeometries(list, false); g.computeVertexNormals(); g.computeBoundingSphere(); return g; };
// hold two (CR-014): the hatch over it opens like a clamshell and the Xi goes down inside to hide (model frame)
export const HOLD = { z0: -C.portalZ + 9, z1: -C.bridgeZ - C.bridgeHalf - 4, w: C.shipBeam / 2 - 4.6, floor: -8 };
const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

// Ship hull: lofted through stations { z, w (half width at the deck edge), wb (half width of the lower hull), keel }.
// Cross-section from the keel up: rounded bilge, red lower side, dark band, raised rubbing strake (light grey), dark upper
// band, bulwark, then down its inner face to the deck at D, across the deck, and mirrored. Every triangle faces outward.
export function hullSection(s, D) {
  const { z, w, wb, keel } = s;
  const raw = [[wb * 0.62, keel], [wb * 0.95, keel + 2.6], [wb + (w - wb) * 0.4, 3], [w, 11],
    [w, 18.2], [w + 0.45, 18.5], [w + 0.45, 20.3], [w, 20.6], [w, D + 2.8], [w - 1.3, D + 2.8], [w - 1.3, D], [Math.min(HOLD.w + 0.8, w - 1.35), D]];
  // the outer profile only climbs (near the bow the raised keel sits above the chine). The bulwark top, its inner face and
  // the deck (the last three points) keep their heights: the deck is at D, not lifted onto the bulwark.
  let lastY = keel;
  const right = raw.map(([x, y], i) => { const yy = i < raw.length - 3 ? Math.max(y, lastY + 0.02 * (i + 1)) : y; lastY = yy; return new THREE.Vector3(x, yy, z); });
  const left = right.slice().reverse().map((v) => new THREE.Vector3(-v.x, v.y, z));
  return [new THREE.Vector3(0, keel, z), ...right, ...left];
}
function shipHull(stations, D, colorFn, skip = null) {
  const R = stations.map((s) => hullSection(s, D)), pos = [];
  const _o = new THREE.Vector3();
  // wind (a, b, c) to face `out`
  const tri = (a, b, c, out) => {
    _a.subVectors(b, a); _b.subVectors(c, a); _n.crossVectors(_a, _b);
    if (_n.dot(out) < 0) { const t = b; b = c; c = t; }
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let i = 0; i < R.length - 1; i++) {
    const A = R[i], B = R[i + 1], n = A.length;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      // the open hold: no deck plating over it (the hatch lids and the hold pit are separate meshes)
      if (skip && skip((A[j].x + A[k].x + B[j].x + B[k].x) / 4, (A[j].y + A[k].y + B[j].y + B[k].y) / 4, (A[j].z + B[j].z) / 2)) continue;
      // each section is one counter-clockwise loop seen from +z (up the starboard side, across, down to port), so the
      // edge j -> k faces (dy, -dx): right for the concave parts too (the bulwark's inner face looks onto the deck)
      _o.set(A[k].y - A[j].y + B[k].y - B[j].y, -(A[k].x - A[j].x + B[k].x - B[j].x), 0);
      if (_o.lengthSq() < 1e-10) continue;                 // a degenerate strip (coincident points)
      tri(A[j], B[j], B[k], _o); tri(A[j], B[k], A[k], _o);
    }
  }
  // bow and stern caps: the section is not convex (the bulwarks rise above the deck), so ear-clip it, not a fan
  for (const ri of [0, R.length - 1]) {
    const r = R[ri];
    _o.set(0, 0, ri === 0 ? -1 : 1);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(r.map((v) => new THREE.Vector2(v.x, v.y)), [])) tri(r[a], r[b], r[c], _o);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return paint(g, colorFn);
}

// ---- palette: the picture's colours, brightened (the toon shader writes linear values raw, which darkens mid tones) -----
const COL = {
  red: 0xc8384f, red2: 0xb8324a, redDeep: 0xa02c40, band: 0x69707a, band2: 0x60676f, top: 0x575d66, top2: 0x50565e,
  strake: 0xcde4fb, seam: 0x2b2f35, bulwark: 0x4d535b, deck: 0x9ba2a9, deck2: 0x8f969d,
  hatch: 0xb2c8a9, hatch2: 0xa6bd9d, hatchSeam: 0x6c8664, coaming: 0x5a6068, haz: 0xd9a636, hazDark: 0x1d1d1d, mark: 0xe7c34a,
  crane: 0x9a6a3d, crane2: 0x8d6137, craneDark: 0x5e4227, steel: 0x6a727b, steelDark: 0x3b4047,
  // light greys are pre-cooled: the dusk-lit toon band multiplies by (1.25, 1.0, 0.82), which turns plain white peach
  super: 0xd6ebff, super2: 0xcae0f6, superShade: 0xb8cde4, window: 0x28303a, rail: 0xe6f3ff, boat: 0xff7a2a, mast: 0xbcd0e6,
  picket: 0x8fa3ba, picket2: 0x8397ae, picketDark: 0x5c6a7c, picketDeck: 0xa3b6cc, light: 0xff3030,
};

function buildSeawrack() {
  const L = C.shipLength / 2, B = C.shipBeam / 2, D = C.deckY;
  const P = [];
  // ---- stations: a rounded blunt bow (plan is a quarter circle, the stem rakes back below), a parallel middle body with
  // a recessed seam every 12.5 m, a square transom stern
  const st = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8, a = t * Math.PI / 2;
    const w = 2 + (B - 2) * Math.sin(a), z = -L + B * 0.92 * (1 - Math.cos(a));
    st.push({ z, w, wb: w * (0.3 + 0.7 * t * t), keel: -12 + 17 * (1 - t) * (1 - t) });
  }
  const SEAMS = [];
  const z0 = st[st.length - 1].z;
  for (let z = z0 + 12.5; z < L - 12; z += 12.5) {
    SEAMS.push(z);
    for (const [dz, k] of [[-0.35, 1], [-0.2, 0], [0.2, 0], [0.35, 1]]) st.push({ z: z + dz, w: B - (k ? 0 : 0.3), wb: B * 0.94 - (k ? 0 : 0.3), keel: -12 });
  }
  st.push({ z: L - 8, w: B, wb: B * 0.94, keel: -12 }, { z: L - 2, w: B * 0.97, wb: B * 0.86, keel: -10 }, { z: L, w: B * 0.95, wb: B * 0.8, keel: -8 });
  // stations on hold two's ends, so the deck cut over it follows the opening exactly (no slots fore and aft of it)
  for (const z of [HOLD.z0, HOLD.z1]) if (!st.some((q) => Math.abs(q.z - z) < 0.05)) st.push({ z, w: B, wb: B * 0.94, keel: -12 });
  st.sort((a, b) => a.z - b.z);
  const rowOf = (z) => Math.floor((z + L) / 12.5);
  const nearSeam = (z) => SEAMS.some((s) => Math.abs(z - s) < 0.22);
  P.push(shipHull(st, D, (c, n) => {
    if (n.y > 0.7 && c.y > D - 0.5 && c.y < D + 0.5) return rowOf(c.z) % 2 ? COL.deck : COL.deck2;   // deck plating
    if (c.y > D && Math.abs(c.x) < B - 0.6) return COL.bulwark;                                    // bulwark top / inner face
    if (nearSeam(c.z) && c.y > -1) return COL.seam;                                               // recessed panel seams
    const alt = (rowOf(c.z) + (c.y > 11 ? 1 : 0) + (c.x > 0 ? 1 : 0)) % 2;
    if (c.y < 11) return alt ? COL.red : COL.red2;
    if (c.y > 18.3 && c.y < 20.5) return COL.strake;
    if (c.y < 18.3) return alt ? COL.band : COL.band2;
    return alt ? COL.top : COL.top2;
  }, (x, y, z) => Math.abs(y - D) < 0.05 && Math.abs(x) < HOLD.w + 0.7 && z > HOLD.z0 && z < HOLD.z1));
  // bulbous bow
  { const g = flat(new THREE.SphereGeometry(1, 12, 8)); g.scale(4.2, 4.8, 15); g.translate(0, -5.5, -L + 5); P.push(paint(g, COL.redDeep)); }
  // hull detail on both sides: frame ribs on the dark band at every seam, recessed hatches / doors, a hazard-edged
  // side port amidships (the cargo door of the picture), pale draught marks at the bow, vents in the upper band
  for (const s of [-1, 1]) {
    const x = s * (B + 0.05);
    for (const z of SEAMS) if (z > -L + 30 && z < L - 15) P.push(box(x - s * 0.1, 11.4, z - 0.45, x + s * 0.5, 17.8, z + 0.45, COL.steelDark));
    for (let i = 0; i < 9; i++) {
      const z = -L + 52 + i * 24 + hash(i, s) * 6;
      if (z > L - 20) break;
      P.push(box(x - s * 0.1, 21.5, z - 2.2, x + s * 0.3, 24.2, z + 2.2, COL.steelDark));                // recessed openings
      P.push(box(x - s * 0.1, 12.6, z + 5, x + s * 0.35, 16.6, z + 7.5, COL.band2));                     // door slabs
    }
    // side port: raised slab with hazard-striped edges
    P.push(box(x - s * 0.1, 11.8, -18, x + s * 0.55, 17.6, 18, COL.steel));
    for (let i = 0; i < 18; i++) P.push(box(x + s * 0.5, 11.8, -18 + i * 2, x + s * 0.7, 12.4, -16 + i * 2, i % 2 ? COL.hazDark : COL.haz));
    for (let i = 0; i < 18; i++) P.push(box(x + s * 0.5, 17.0, -18 + i * 2, x + s * 0.7, 17.6, -16 + i * 2, i % 2 ? COL.hazDark : COL.haz));
    for (let k = 0; k < 6; k++) P.push(box(x + s * 0.0, 1 + k * 1.6, -L + 18, x + s * 0.3, 1.5 + k * 1.6, -L + 20.5, COL.strake));
    for (let i = 0; i < 10; i++) P.push(box(x - s * 0.1, 22.4, -L + 40 + i * 27, x + s * 0.4, 23.6, -L + 43 + i * 27, COL.steel));
  }
  // ---- bow deck: curved bulwark is the hull's; deckhouse, bow mast with radar arms, bollards, winches, anchor gear
  P.push(box(-9, D, -L + 26, 9, D + 6, -L + 40, COL.super));
  P.push(box(-7, D + 6, -L + 28, 7, D + 9.5, -L + 38, COL.super2));
  windows(P, 'z', -L + 26, -1, -7, 7, D + 2.5, D + 4.5, 6, 1, 1.4, 1.2, COL.window);
  P.push(box(-1.1, D + 9.5, -L + 32, 1.1, D + 34, -L + 34, COL.mast));
  P.push(box(-7, D + 28, -L + 32.4, 7, D + 29.2, -L + 33.6, COL.mast));
  P.push(box(-4.5, D + 23, -L + 32.4, 4.5, D + 23.8, -L + 33.6, COL.mast));
  P.push(cbox(0, D + 31, -L + 33, 6, 1.2, 1.2, COL.steelDark));
  for (const s of [-1, 1]) {
    P.push(cyl(2.2, 2.4, s * 8, D + 1.2, -L + 14, COL.steel, 10));
    P.push(cyl(1.0, 3.2, s * 8, D + 1.6, -L + 14, COL.steelDark, 8, 'x'));
    for (const z of [-L + 46, -L + 60]) P.push(cyl(0.8, 1.6, s * (B - 3.5), D + 0.8, z, COL.steelDark, 8));
    P.push(box(s * 13 - 2, D, -L + 20, s * 13 + 2, D + 2.4, -L + 26, COL.steel));
  }
  railing(P, [[-B + 1.4, -L + 44], [-B + 1.4, -L + 26], [-12, -L + 9], [0, -L + 3], [12, -L + 9], [B - 1.4, -L + 26], [B - 1.4, -L + 44]], D + 2.8, 1.5);
  // ---- hatch covers: shallow pitched lids in panels (alternating shades, dark seams), coamings, hinge blocks
  const portalZ = -C.portalZ, bridgeZ = -C.bridgeZ, bh = C.bridgeHalf;
  const hatches = [[-L + 48, portalZ - 9], [portalZ + 9, bridgeZ - bh - 4], [bridgeZ + bh + 6, L - 10]];
  for (const [h0, h1] of hatches) {
    if (h0 === HOLD.z0) {                         // hold two (CR-014): an open coaming rim; its lids and pit are separate meshes
      for (const s of [-1, 1]) P.push(box(s * (B - 4) - 0.6, D, h0 - 1, s * (B - 4) + 0.6, D + 1.6, h1 + 1, COL.coaming));
      for (const z of [h0 - 1, h1 + 1]) P.push(box(-B + 4, D, z - 0.6, B - 4, D + 1.6, z + 0.6, COL.coaming));
      continue;
    }
    P.push(box(-B + 4, D, h0 - 1, B - 4, D + 1.6, h1 + 1, COL.coaming));
    const n = Math.max(1, Math.round((h1 - h0) / 12)), len = (h1 - h0) / n;
    for (let i = 0; i < n; i++) {
      const a = h0 + i * len + 0.25, b = h0 + (i + 1) * len - 0.25, sh = i % 2 ? COL.hatch : COL.hatch2;
      const lid = new THREE.BufferGeometry();
      const W2 = B - 4.6, Y0 = D + 1.6, Y1 = D + 3.4, YR = D + 4.6;
      const q = [[-W2, Y0], [-W2, Y1], [0, YR], [W2, Y1], [W2, Y0]];
      const pos = [];
      const quad = (p, r, s2, t) => pos.push(...p, ...r, ...s2, ...p, ...s2, ...t);
      for (let k = 0; k < q.length - 1; k++) quad([q[k][0], q[k][1], a], [q[k + 1][0], q[k + 1][1], a], [q[k + 1][0], q[k + 1][1], b], [q[k][0], q[k][1], b]);
      for (const zz of [a, b]) for (let k = 1; k < q.length - 1; k++) pos.push(q[0][0], q[0][1], zz, q[k][0], q[k][1], zz, q[k + 1][0], q[k + 1][1], zz);
      lid.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      // wind every face outward from the lid's centre line
      const ctr = new THREE.Vector3(0, D + 1.5, (a + b) / 2), pa = lid.attributes.position.array;
      for (let t = 0; t < pa.length; t += 9) {
        _a.fromArray(pa, t); _b.fromArray(pa, t + 3); _c.fromArray(pa, t + 6);
        _n.subVectors(_b, _a).cross(_m.subVectors(_c, _a));
        if (_n.dot(_m.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3).sub(ctr)) < 0) for (let k = 0; k < 3; k++) { const tt = pa[t + 3 + k]; pa[t + 3 + k] = pa[t + 6 + k]; pa[t + 6 + k] = tt; }
      }
      P.push(paint(lid, sh));
      P.push(box(-0.35, YR - 0.05, a, 0.35, YR + 0.35, b, COL.hatchSeam));                   // ridge cap
      for (const s of [-1, 1]) P.push(box(s * (W2 + 0.1) - 0.5, Y0 - 0.2, (a + b) / 2 - 1, s * (W2 + 0.1) + 0.5, Y0 + 1.2, (a + b) / 2 + 1, COL.steelDark));
    }
  }
  // deck-edge rails for the cranes and the deck railing
  for (const s of [-1, 1]) {
    P.push(box(s * (B - 2.6) - 0.6, D, -L + 46, s * (B - 2.6) + 0.6, D + 0.6, bridgeZ - bh - 2, COL.steelDark));
    railing(P, [[s * (B - 1.4), -L + 44], [s * (B - 1.4), L - 2]], D + 2.8, 1.5);
  }
  // ---- portal crane (the big brown gantry of the picture): boxy legs with a kink, a deep top girder with a railed
  // platform and a trolley house, rail bogies with hazard-striped skirts, diagonal braces, panel seams
  {
    const z = portalZ, top = C.portalTop - D;
    for (const s of [-1, 1]) {
      const x = s * (B - 2.6);
      P.push(box(x - 2.6, D, z - 7, x + 2.6, D + 3, z + 7, COL.craneDark));                         // bogie
      for (let i = 0; i < 7; i++) P.push(box(x - 2.7, D + 0.2, z - 7 + i * 2, x + 2.7, D + 1.2, z - 6 + i * 2, i % 2 ? COL.hazDark : COL.haz));
      P.push(box(x - 2.2, D + 3, z - 5, x + 2.2, D + 18, z + 5, COL.crane));                         // lower leg (wide)
      P.push(box(x - 1.9, D + 18, z - 3.6, x + 1.9, D + top - 6, z + 3.6, COL.crane2));              // upper leg
      P.push(bar(x, D + 4, z - 4.6, x, D + 17, z + 4.6, 0.7, COL.craneDark));                       // brace
      for (const y of [D + 18, D + 30]) P.push(box(x - 2.3, y - 0.3, z - 5.1, x + 2.3, y + 0.3, z + 5.1, COL.craneDark));
    }
    P.push(box(-B - 4, D + top - 7, z - 4.6, B + 4, D + top, z + 4.6, COL.crane));                   // girder
    for (let i = -3; i <= 3; i++) P.push(box(i * 7.4 - 0.25, D + top - 7, z - 4.7, i * 7.4 + 0.25, D + top, z + 4.7, COL.craneDark));
    P.push(box(-14, D + top, z - 8, 14, D + top + 0.8, z + 8, COL.steel));                          // platform deck
    railing(P, [[-14, z - 8], [14, z - 8], [14, z + 8], [-14, z + 8], [-14, z - 8]], D + top + 0.8, 1.4);
    P.push(box(-6, D + top + 0.8, z - 4, 4, D + top + 5.5, z + 4, COL.super2));                      // trolley house
    windows(P, 'z', z - 4, -1, -5, 3, D + top + 2.6, D + top + 4.2, 3, 1, 1.6, 1.2, COL.window);
    P.push(box(5, D + top + 0.8, z - 2, 9, D + top + 3, z + 2, COL.steelDark));                       // winch block
  }
  // ---- superstructure: stepped light-grey decks with window rows and rails, a wide bridge with wings, mast with radar,
  // lifeboats in davits, wall panel seams
  {
    const zf = bridgeZ - bh, za = bridgeZ + bh;
    const level = (x, y0, y1, zA, zB, col) => P.push(box(-x, y0, zA, x, y1, zB, col));
    level(B - 2, D, D + 12, zf, za, COL.super);
    level(B - 4, D + 12, D + 22, zf + 1.5, za - 1, COL.super2);
    level(B - 6, D + 22, D + 31, zf + 3, za - 3, COL.super);
    level(B - 8, D + 31, D + 39, zf + 3, za - 8, COL.super2);
    P.push(box(-B - 3, D + 39, zf + 1, B + 3, D + 47, zf + 15, COL.super));                           // bridge with wings
    // wrap-around bridge windows: single outward-facing panes, so from inside Command (render/aboard.js) they are glass
    { const q = flat(new THREE.PlaneGeometry(2 * B + 6.4, 3.4)); q.rotateY(Math.PI); q.translate(0, D + 43.7, zf + 0.95); P.push(paint(q, COL.window)); }
    for (const s of [-1, 1]) { const q = flat(new THREE.PlaneGeometry(13, 3.4)); q.rotateY(s * Math.PI / 2); q.translate(s * (B + 3.05), D + 43.7, zf + 7.5); P.push(paint(q, COL.window)); }
    P.push(box(-B + 8, D + 47, zf + 3, B - 8, D + 50, zf + 13, COL.superShade));                     // roof house
    windows(P, 'z', zf, -1, -B + 4, B - 4, D + 2, D + 11, 9, 2, 1.8, 1.6, COL.window);
    windows(P, 'z', zf + 1.5, -1, -B + 6, B - 6, D + 14, D + 21, 8, 2, 1.8, 1.6, COL.window);
    windows(P, 'z', zf + 3, -1, -B + 8, B - 8, D + 24, D + 30, 7, 2, 1.8, 1.6, COL.window);
    windows(P, 'z', zf + 3, -1, -B + 10, B - 10, D + 33, D + 38, 6, 1, 1.8, 1.6, COL.window);
    for (const s of [-1, 1]) {
      windows(P, 'x', s * (B - 2), s, zf + 3, za - 3, D + 2, D + 11, 9, 2, 1.6, 1.6, COL.window);
      windows(P, 'x', s * (B - 4), s, zf + 4, za - 4, D + 14, D + 21, 8, 2, 1.6, 1.6, COL.window);
      windows(P, 'x', s * (B - 6), s, zf + 5, za - 5, D + 24, D + 30, 7, 2, 1.6, 1.6, COL.window);
      for (let i = 0; i < 6; i++) P.push(box(s * (B - 2) - 0.1, D, zf + 6 + i * 5.5, s * (B - 2) + 0.15 * s, D + 12, zf + 6.3 + i * 5.5, COL.superShade));
      // lifeboat in its davit, aft on each side
      P.push(cyl(2.3, 9, s * (B - 0.6), D + 17, za - 6, COL.boat, 10, 'z'));
      P.push(box(s * (B - 0.6) - 1.2, D + 19, za - 6.5, s * (B - 0.6) + 1.2, D + 19.8, za - 5.5, COL.boat));
      for (const dz of [-3.5, 3.5]) P.push(bar(s * (B - 4), D + 22, za - 6 + dz, s * (B - 0.6), D + 20.5, za - 6 + dz, 0.6, COL.steelDark));
      railing(P, [[s * (B - 2), zf], [s * (B - 2), za]], D + 12, 1.3);
      railing(P, [[s * (B - 4), zf + 1.5], [s * (B - 4), za - 1]], D + 22, 1.3);
      railing(P, [[s * (B - 6), zf + 3], [s * (B - 6), za - 3]], D + 31, 1.3);
    }
    railing(P, [[-B - 3, zf + 1], [B + 3, zf + 1]], D + 47, 1.3);
    // mast with radar arms, aerials and a radar dish on the roof
    P.push(box(-1.3, D + 50, zf + 7, 1.3, D + 68, zf + 9.5, COL.mast));
    P.push(box(-8, D + 62, zf + 7.6, 8, D + 63.2, zf + 8.9, COL.mast));
    P.push(cbox(0, D + 60, zf + 8.2, 7, 1.0, 1.0, COL.steelDark, 0.8));
    P.push(cbox(0, D + 66, zf + 8.2, 5, 0.8, 0.8, COL.steelDark, -0.4));
    for (const s of [-1, 1]) P.push(bar(s * 6, D + 63, zf + 8.2, s * 6.5, D + 71, zf + 8.2, 0.3, COL.mast));
    P.push(cyl(2.4, 1.6, 6, D + 51, zf + 11, COL.white || COL.rail, 12));
    // exhaust stack behind the bridge, dark cap
    P.push(box(-4, D + 39, za - 12, 4, D + 50, za - 6, COL.super2));
    P.push(box(-4.3, D + 50, za - 12.3, 4.3, D + 52, za - 5.7, COL.steelDark));
  }
  // ---- aft boom cranes (the brown booms of the picture): pedestals at the aft deck edges, booms rising to the
  // superstructure roof line and reaching out over the aft hatch
  for (const s of [-1, 1]) {
    const x = s * (B - 5), zb = bridgeZ + bh + 4;
    P.push(box(x - 3, D, zb - 3, x + 3, D + 12, zb + 3, COL.crane));
    for (let i = 0; i < 4; i++) P.push(box(x - 3.1, D + 0.3, zb - 3 + i * 1.5, x + 3.1, D + 1.1, zb - 2.2 + i * 1.5, i % 2 ? COL.hazDark : COL.haz));
    P.push(bar(x, D + 12, zb, x, D + 34, zb + 14, 3.8, COL.crane2));
    P.push(bar(x, D + 34, zb + 14, x * 0.7, D + 30, zb + 52, 3.2, COL.crane));
    P.push(box(x * 0.7 - 1.2, D + 22, zb + 51, x * 0.7 + 1.2, D + 30, zb + 53, COL.craneDark));          // hook block
    P.push(cyl(1.8, 2.4, x, D + 34, zb + 14, COL.craneDark, 10, 'x'));
  }
  // stern: mooring winches and bollards
  for (const s of [-1, 1]) { P.push(cyl(1.8, 2.2, s * 10, D + 1.1, L - 6, COL.steel, 10)); P.push(cyl(0.8, 1.6, s * (B - 4), D + 0.8, L - 12, COL.steelDark, 8)); }
  details(P, L, B, D);
  return merge(P);
}

// ---- detail pass (owner: "refine the models"): outside stairways and bridge-wing struts on the superstructure, a funnel
// band, ladders, a hanging cab and lamps on the portal crane, double bitts, mushroom vents, life-ring stations and fire
// boxes along the deck, fairleads in the bulwark, a stern flagstaff
function stair(P, x, y0, y1, z0, z1, w = 1.3) {
  const n = Math.max(3, Math.round(Math.abs(y1 - y0) / 0.75));
  for (const s of [-1, 1]) P.push(bar(x + s * w / 2, y0, z0, x + s * w / 2, y1, z1, 0.22, COL.steelDark));          // stringers
  for (let i = 1; i < n; i++) {
    const t = i / n, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
    P.push(box(x - w / 2, y - 0.08, z - 0.3, x + w / 2, y + 0.04, z + 0.3, COL.steel));                               // treads
  }
  for (const s of [-1, 1]) P.push(bar(x + s * w / 2, y0 + 1.1, z0, x + s * w / 2, y1 + 1.1, z1, 0.12, COL.rail));     // handrails
}
function ladder(P, x, z, y0, y1, along = 'z', w = 0.9, color = COL.steelDark) {
  for (const s of [-1, 1]) {
    const dx = along === 'x' ? s * w / 2 : 0, dz = along === 'z' ? s * w / 2 : 0;
    P.push(box(x + dx - 0.07, y0, z + dz - 0.07, x + dx + 0.07, y1, z + dz + 0.07, color));
  }
  for (let y = y0 + 0.4; y < y1; y += 0.5) P.push(along === 'z' ? box(x - 0.05, y - 0.04, z - w / 2, x + 0.05, y + 0.04, z + w / 2, color) : box(x - w / 2, y - 0.04, z - 0.05, x + w / 2, y + 0.04, z + 0.05, color));
}
function bitts(P, x, z, D) {
  P.push(box(x - 0.9, D, z - 2.2, x + 0.9, D + 0.25, z + 2.2, COL.steelDark));
  for (const dz of [-1.2, 1.2]) { P.push(cyl(0.55, 1.5, x, D + 1.0, z + dz, COL.steel, 8)); P.push(cyl(0.75, 0.2, x, D + 1.8, z + dz, COL.steel, 8)); }
}
function vent(P, x, z, D, h = 2.6) {
  P.push(cyl(0.45, h, x, D + h / 2, z, COL.steel, 8));
  P.push(cyl(0.8, 0.7, x, D + h + 0.2, z, COL.super2, 10, 'y', 0.3));          // mushroom cap
}
function details(P, L, B, D) {
  const bridgeZ = -C.bridgeZ, bh = C.bridgeHalf, zf = bridgeZ - bh, za = bridgeZ + bh, portalZ = -C.portalZ;
  // superstructure: outside stairways between the open decks, aft-facing; a door at the foot of each flight
  for (const s of [-1, 1]) {
    stair(P, s * (B - 3), D + 12, D + 22, za - 3, za - 15);
    stair(P, s * (B - 5), D + 22, D + 31, za - 5, za - 16);
    stair(P, s * (B - 7.2), D + 31, D + 39, za - 9, za - 17, 1.1);
    P.push(box(s * (B - 4) - 0.25 * s, D + 22, za - 18.4, s * (B - 4) + 0.15 * s, D + 24.4, za - 16.8, COL.superShade));
    P.push(box(s * (B - 6) - 0.25 * s, D + 31, za - 19, s * (B - 6) + 0.15 * s, D + 33.4, za - 17.4, COL.superShade));
    // bridge-wing struts: the wings overhang the deck below, braced back to its wall
    for (const dz of [3, 13]) P.push(bar(s * (B - 8), D + 31.5, zf + dz, s * (B + 2), D + 38.8, zf + dz, 0.7, COL.superShade));
    P.push(box(s * (B + 2.6) - 0.6, D + 47, zf + 1.4, s * (B + 2.6) + 0.6, D + 48.2, zf + 2.6, COL.steelDark));   // lamp housings on the wing ends
    // lifeboat davit arms, upright
    for (const dz of [-3.5, 3.5]) P.push(bar(s * (B - 4), D + 12, za - 6 + dz, s * (B - 4), D + 22, za - 6 + dz + 0.01, 0.5, COL.steelDark));
  }
  // funnel: a company band and a white stripe below the dark cap
  P.push(box(-4.25, D + 46, za - 12.25, 4.25, D + 48.6, za - 5.75, 0x2f6fb2), box(-4.27, D + 48.6, za - 12.27, 4.27, D + 49.3, za - 5.73, COL.rail));
  // portal crane: ladders up the outer face of each leg with landing rings, a hanging operator cab, lamps under the girder
  {
    const top = C.portalTop - D;
    for (const s of [-1, 1]) {
      const x = s * (B - 2.6) + s * 2.35;
      ladder(P, x, portalZ + 2.8, D + 3, D + 18, 'z');
      ladder(P, x - s * 0.3, portalZ + 2.2, D + 18, D + top - 7, 'z');
      for (const y of [D + 18, D + 30]) P.push(box(x - 0.7 * s, y - 0.12, portalZ + 1.4, x + 0.8 * s, y + 0.12, portalZ + 4.2, COL.steel));
      for (let i = 0; i < 4; i++) P.push(box(i * 9 - 13.7 - 0.5, D + top - 7.7, portalZ - 0.5, i * 9 - 13.7 + 0.5, D + top - 7, portalZ + 0.5, COL.steelDark));
    }
    P.push(box(B - 9, D + top - 12, portalZ - 2.6, B - 4.5, D + top - 7, portalZ + 2.6, COL.super2));               // cab
    P.push(box(B - 9.2, D + top - 10.5, portalZ - 2.7, B - 4.3, D + top - 8.4, portalZ - 2.5, COL.window));
    P.push(box(B - 9.15, D + top - 10.5, portalZ - 2.2, B - 8.95, D + top - 8.4, portalZ + 2.2, COL.window));
    for (let k = 0; k < 4; k++) P.push(box(-1.2, D + top - 7 - k * 2.4 - 2.2, portalZ - 0.15, 1.2, D + top - 7 - k * 2.4, portalZ + 0.15, k % 2 ? COL.craneDark : COL.steelDark));   // hook block and falls
  }
  // main deck: double bitts and fairleads at each end of the cargo deck, vents in the gaps between hatches, life-ring
  // stations and fire boxes along both rails, a hydrant pipe run
  for (const s of [-1, 1]) {
    for (const z of [-L + 72, portalZ + 2, bridgeZ + bh + 14, L - 26]) {
      bitts(P, s * (B - 4.6), z, D);
      P.push(box(s * (B - 0.2) - 0.5, D + 1.4, z - 0.8, s * (B - 0.2) + 0.5, D + 2.6, z + 0.8, COL.steelDark));         // fairlead
    }
    for (const z of [portalZ - 5, portalZ + 5]) vent(P, s * 8.5, z, D);
    vent(P, s * 6, bridgeZ - bh - 1.6, D, 2.2);
    for (const z of [-L + 56, -L + 110, -L + 160, L - 40]) {
      if (Math.abs(z - portalZ) < 10) continue;
      const x = s * (B - 1.4);
      P.push(box(x - 0.15, D + 1.6, z - 0.7, x + 0.15, D + 3.4, z + 0.7, COL.rail));                                      // ring board
      const ring = flat(new THREE.TorusGeometry(0.62, 0.18, 6, 12)); ring.rotateY(Math.PI / 2); ring.translate(x + s * 0.12, D + 2.5, z); P.push(paint(ring, COL.boat));
      P.push(box(x - s * 0.9 - 0.4, D, z + 2, x - s * 0.9 + 0.4, D + 1.4, z + 3, 0xd23a3a));                             // fire box
    }
    P.push(cyl(0.22, (portalZ - 9) - (-L + 48), s * (B - 3.6), D + 0.5, ((portalZ - 9) + (-L + 48)) / 2, COL.mark, 6, 'z'));   // hydrant main
  }
  // stern flagstaff
  P.push(bar(0, D + 1, L - 1.5, 0, D + 12, L + 0.5, 0.3, COL.rail));
}

function buildPicket() {
  const P = [];
  const st = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5, a = t * Math.PI / 2; st.push({ z: -45 + 9 * (1 - Math.cos(a)), w: 0.6 + 7.4 * Math.sin(a), wb: (0.6 + 7.4 * Math.sin(a)) * (0.3 + 0.7 * t), keel: -5 + 6 * (1 - t) * (1 - t) }); }
  for (let z = -30; z <= 36; z += 11) st.push({ z, w: 8, wb: 7, keel: -5 });
  st.push({ z: 44, w: 7.4, wb: 6, keel: -4 });
  // reuse the ship hull profile at a smaller scale: it bands at fixed heights, so scale the result into place
  const hull = shipHull(st.map((s) => ({ ...s, w: s.w * 2.5, wb: s.wb * 2.5, z: s.z * 2.5, keel: s.keel * 2.5 })), 25,
    (c, n) => (n.y > 0.7 && c.y > 24 ? COL.picketDeck : c.y < 11 ? COL.picketDark : c.y > 18.3 && c.y < 20.5 ? COL.strake : (Math.floor(c.z / 22) % 2 ? COL.picket : COL.picket2)));
  hull.scale(0.4, 0.34, 0.4);
  P.push(hull);
  P.push(box(-5, 8.5, -8, 5, 15, 14, COL.picket));
  P.push(box(-4.2, 15, -6, 4.2, 20, 7, COL.picket2));
  P.push(box(-4.4, 17, -6.3, 4.4, 18.4, -5.9, COL.window));
  windows(P, 'x', 5, 1, -6, 12, 10, 13.5, 6, 1, 1.2, 1.2, COL.window);
  windows(P, 'x', -5, -1, -6, 12, 10, 13.5, 6, 1, 1.2, 1.2, COL.window);
  P.push(box(-0.8, 20, -1, 0.8, 34, 1, COL.picketDark));          // radar mast (the array rotates, see createSeawrack)
  P.push(box(-4, 27, -0.5, 4, 27.8, 0.5, COL.picketDark));
  P.push(cyl(2.4, 2.6, 0, 10, 26, COL.picketDark, 10));           // aft gun turret
  P.push(bar(0, 10.6, 26, 0, 11.4, 33, 0.6, COL.steelDark));
  P.push(cyl(2.0, 2.2, 0, 9.6, -24, COL.picketDark, 10));         // fore turret
  P.push(box(-2.2, 15, 9, 2.2, 23, 13, COL.picket2));               // funnel
  P.push(box(-2.4, 23, 8.8, 2.4, 24, 13.2, COL.steelDark));
  { const g = flat(new THREE.SphereGeometry(2.6, 10, 6)); g.translate(0, 22.5, -3); P.push(paint(g, COL.rail)); }   // radome
  for (const s of [-1, 1]) P.push(box(s * 5.2 - 0.4, 9, -2, s * 5.2 + 0.4, 12, 10, COL.picketDark));   // side armour
  P.push(bar(0, 10.2, -24, 0, 10.8, -31, 0.5, COL.steelDark));
  railing(P, [[-7.5, -30], [-7.5, 40]], 8.4, 1.1); railing(P, [[7.5, -30], [7.5, 40]], 8.4, 1.1);
  return merge(P);
}
function buildRadarArray() {
  return merge([box(-9, -1.4, -0.6, 9, 1.4, 0.6, COL.mast), box(-9.2, -1.6, 0.6, 9.2, 1.6, 0.9, COL.steelDark), box(-0.6, -2.4, -0.6, 0.6, 0, 0.6, COL.picketDark)]);
}

export function createSeawrack({ scene, uniforms }) {
  const U = uniforms;
  const pixU = U.uPixAng || { value: 0.0015 };
  const mat = (heat) => new THREE.ShaderMaterial({
    uniforms: { uSun: U.uSunDir, uNight: U.uNight, uThermal: U.uThermal, uHeat: { value: heat }, uFlash: { value: 0 }, uDmg: { value: 0 } },
    vertexShader: toon.vertex, fragmentShader: toon.fragment, vertexColors: true,
  });
  const outMat = new THREE.ShaderMaterial({ uniforms: { uPixAng: pixU, uScale: { value: 3 }, uThermal: U.uThermal },
    vertexShader: toonOutline.vertex, fragmentShader: toonOutline.fragment, side: THREE.BackSide });
  const mk = (geo, m) => {
    const g = new THREE.Group();
    const a = new THREE.Mesh(geo, m), o = new THREE.Mesh(outlineGeometry(geo), outMat);
    a.frustumCulled = o.frustumCulled = false;
    g.add(o, a);
    return g;
  };
  const shipMat = mat(0.35);
  const ship = mk(buildSeawrack(), shipMat);
  ship.visible = false;
  scene.add(ship);
  // white wake behind the stern
  const wakeGeo = new THREE.PlaneGeometry(1, 1); wakeGeo.rotateX(-Math.PI / 2);
  const wake = new THREE.Mesh(wakeGeo, new THREE.MeshBasicMaterial({ color: 0xdfe8ee, transparent: true, opacity: 0.35, depthWrite: false }));
  wake.scale.set(C.shipBeam * 1.2, 1, 420); wake.position.set(0, 0.6, C.shipLength / 2 + 210);
  wake.frustumCulled = false;
  ship.add(wake);
  // name boards on both bow flanks and the transom; navigation lights (port red, starboard green) on the bridge wings,
  // a white masthead light
  {
    const L = C.shipLength / 2, B = C.shipBeam / 2, D = C.deckY;
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 192;
    const g = cv.getContext('2d');
    g.fillStyle = '#f2f6fa'; g.font = '900 150px "Arial Black", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SEAWRACK', 512, 100);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const nm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const board = (x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(15, 2.8), nm); m.position.set(x, y, z); m.rotation.y = ry; m.frustumCulled = false; ship.add(m); };
    for (const s of [-1, 1]) board(s * (B + 0.14), 22.9, -L + 31.5, s * Math.PI / 2);   // clear of the bow curve and the vent box at -L+40
    board(0, 21.6, L + 0.15, 0);
    const zf = -C.bridgeZ - C.bridgeHalf;
    for (const [x, c] of [[-(B + 2.6), 0xff2a2a], [B + 2.6, 0x2aff6a]]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
      l.position.set(x, D + 48.8, zf + 2); ship.add(l);
    }
    const ml = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
    ml.position.set(0, D + 68.6, zf + 8.2); ship.add(ml);
  }
  // ---- hold two (CR-014): two lid halves hinged at the coaming sides open like a clamshell (setHold), the hold beneath
  const D = C.deckY, W2 = HOLD.w, Y0 = D + 1.6, Y1 = D + 3.4, YR = D + 4.6, HL = HOLD.z1 - HOLD.z0;
  const lids = [-1, 1].map((s) => {
    const P = [], n = Math.max(1, Math.round(HL / 12)), len = HL / n;
    for (let i = 0; i < n; i++) {
      const a = HOLD.z0 + i * len + 0.25, b = HOLD.z0 + (i + 1) * len - 0.25;
      const sh = new THREE.Shape([new THREE.Vector2(s * W2, Y0), new THREE.Vector2(s * W2, Y1), new THREE.Vector2(0, YR), new THREE.Vector2(0, Y0)]);
      const g = flat(new THREE.ExtrudeGeometry(sh, { depth: b - a, bevelEnabled: false }));
      g.translate(0, 0, a);
      P.push(paint(g, i % 2 ? COL.hatch : COL.hatch2));
      P.push(box(0, YR - 0.05, a, s * 0.35, YR + 0.35, b, COL.hatchSeam));                     // half ridge cap
      P.push(box(s * (W2 + 0.1) - 0.5, Y0 - 0.2, (a + b) / 2 - 1, s * (W2 + 0.1) + 0.5, Y0 + 1.2, (a + b) / 2 + 1, COL.steelDark));   // hinge
    }
    const geo = merge(P);
    geo.translate(-s * W2, -Y0, 0);                                                            // hinge line = origin
    const pivot = new THREE.Group();
    pivot.position.set(s * W2, Y0, 0);
    pivot.add(mk(geo, shipMat));
    ship.add(pivot);
    return { pivot, s };
  });
  // the hold itself: dark walls with frames, a floor with yellow lanes, work lights (always drawn: the lid seams show it)
  {
    const P = [], F = HOLD.floor;
    P.push(box(-W2, F - 0.4, HOLD.z0, W2, F, HOLD.z1, 0x2c3036));
    for (const s of [-1, 1]) P.push(box(s * W2 - 0.2, F, HOLD.z0, s * W2 + 0.2, D, HOLD.z1, 0x3d434a));
    for (const z of [HOLD.z0, HOLD.z1]) P.push(box(-W2, F, z - 0.2, W2, D, z + 0.2, 0x3d434a));
    for (let z = HOLD.z0 + 6; z < HOLD.z1 - 2; z += 6) for (const s of [-1, 1]) P.push(box(s * (W2 - 0.5) - 0.3, F, z - 0.3, s * (W2 - 0.5) + 0.3, D - 0.3, z + 0.3, 0x5a6169));
    for (const x of [-7, 7]) P.push(box(x - 0.3, F + 0.01, HOLD.z0 + 2, x + 0.3, F + 0.05, HOLD.z1 - 2, COL.haz));
    for (const s of [-1, 1]) for (let y = F + 6; y < D - 2; y += 9) P.push(box(s * (W2 - 0.4) - 0.2, y, HOLD.z0 + 1, s * (W2 - 0.4) + 0.2, y + 0.4, HOLD.z1 - 1, 0x4a5058));   // catwalks
    const pit = new THREE.Mesh(merge(P), new THREE.MeshBasicMaterial({ vertexColors: true }));
    pit.frustumCulled = false;
    ship.add(pit);
    for (let z = HOLD.z0 + 8; z < HOLD.z1; z += 16) for (const s of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 1.6), new THREE.MeshBasicMaterial({ color: 0xffe7b0 }));
      l.position.set(s * (W2 - 0.6), D - 3, z); l.frustumCulled = false; ship.add(l);
    }
  }
  // k: 0 = closed, 1 = both halves standing up at the sides
  function setHold(k) {
    const a = Math.max(0, Math.min(1, k)) * Math.PI * 0.49;
    for (const L of lids) L.pivot.rotation.z = -L.s * a;
  }
  const picketGeo = buildPicket(), arrayGeo = buildRadarArray(), picketMat = mat(0.4);
  const lampMat = new THREE.MeshBasicMaterial({ color: COL.light });
  const pickets = [];
  for (let i = 0; i < 3; i++) {
    const g = mk(picketGeo, picketMat);
    const arr = mk(arrayGeo, picketMat); arr.position.set(0, 35, 0); g.add(arr);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 4), lampMat); lamp.position.set(0, 37.5, 0); g.add(lamp);
    g.visible = false;
    scene.add(g);
    pickets.push({ g, arr, lamp });
  }

  function update(dt, state) {
    const st = state.story;
    const on = !!(st && (st.chapter === 2 || st.chapter === 3) && st.seawrack);   // Chapter 3 launches from her
    ship.visible = on;
    const pk = (on && Array.isArray(st.pickets)) ? st.pickets : [];
    pickets.forEach((p, i) => { p.g.visible = i < pk.length; });
    if (U.uHoldBox) U.uHoldBox.value.set(0, 0, 0, 0);
    if (!on) return;
    // hold two's footprint (inside the coaming) cut out of the sea, so its floor below the waterline shows
    if (U.uHold && U.uHoldBox) {
      const swp = st.seawrack;
      U.uHold.value.set(swp.position.x, swp.position.z, Math.cos(swp.heading), Math.sin(swp.heading));
      U.uHoldBox.value.set(-HOLD.w, HOLD.w, HOLD.z0, HOLD.z1);
    }
    const sw = st.seawrack;
    ship.position.set(sw.position.x, sw.position.y, sw.position.z);
    ship.rotation.set(sw.alive ? 0 : Math.min(0.12, sw.sinkT * 0.01), -sw.heading, sw.alive ? 0 : Math.min(0.25, sw.sinkT * 0.02), 'YXZ');
    shipMat.uniforms.uDmg.value = 0.6 * (1 - sw.hp);
    wake.visible = sw.alive;
    const t = num(state.time, 0);
    pk.forEach((q, i) => {
      const P = pickets[i];
      if (!P) return;
      P.g.position.set(q.position.x, 0, q.position.z);
      P.g.rotation.y = i * 1.7;
      P.arr.rotation.y = q.sweep * 1.6;
      P.lamp.visible = q.painted ? Math.sin(t * 18) > 0 : Math.sin(t * 3 + i) > 0.6;
    });
    void dt;
  }
  // CR-014: from inside the superstructure the ship's inverted-hull outline would wall off the windows: hide it there
  const setOutline = (v) => { ship.children[0].visible = v; };
  return { update, setHold, setOutline };
}
export const _shipGeometry = { buildSeawrack, buildPicket, buildRadarArray };   // review page (docs/models/seawrack)
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
