// Sculpted anime-mecha cockpit parts (linear seat, armrest consoles, grips, gloves, pedals, legs).
// Everything is built from chamfered extrusions, rounded boxes, capsules and lathes, coloured per vertex and merged by
// material by the caller. Seat space: eye = origin, +Y up, -Z forward, +X right, metres (same as cockpit.js `seat`).
// Material lists: armor (Phong graphite), cloth (Lambert suit / cushion / rubber), teal (emissive strips),
// leds (power-gated lamps), trit (tritium dots), glove (Lambert).
// R1 seat refinement: lighter green-tinted graphite with two-tone plates (frame darker, plates lighter), layered back
// shells, shaped armrest consoles, slim white/purple pilot suit (ref 08).
// R5 seat: soft goods are smooth-shaded pillow() cushions (welded, averaged normals) with piping and channel seams; the
// hard frame stays chamfered plates. Same three merged seat meshes, about +7.7k triangles over R4.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { part } from './models.js';

// ---------------------------------------------------------------- palette
export const COL = {
  arm: 0x2c3238, arm2: 0x1f2429, arm3: 0x3a424a, hi: 0x9aa0bd, dark: 0x090c0e, cush: 0x252a2e, cush2: 0x2d3438,
  rub: 0x14181a, panel: 0x12181a, chrome: 0xd2d7da,
  suit: 0x7d8095, suit2: 0x5f627a, purple: 0x42367a, purple2: 0x6a5aa8, glove: 0x9ea1b4, gloveDark: 0x30333f, cuff: 0x4a3f86,
  boot: 0x8d91a6, sole: 0x1c1f26, pad: 0x30363a,
  teal: 0x2ee6d6, tealDim: 0x127a74, amber: 0xffa030, green: 0x20ff70, red: 0xff2010, orange: 0xd8731a,
};

// ---------------------------------------------------------------- primitives
export const BX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const RB = (w, h, d, r = 0.008, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, Math.max(1e-4, Math.min(r, Math.min(w, h, d) / 2 - 1e-4)));

// polygon in XY, extruded along Z (centred), chamfer bevel (flat faces = hard anime plates)
export function plateXY(pts, depth, bevel = 0.008) {
  const s = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}
// polygon given as [x, z] pairs, extruded along +Y from y0 to y0 + height
export function plateXZ(pts, height, y0, bevel = 0.008) {
  const s = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}
// side profile given as [z, y] pairs, extruded across X (centred on xc, thickness `width`)
export function plateZY(pts, width, xc, bevel = 0.008) {
  const s = new THREE.Shape(pts.map((p) => new THREE.Vector2(-p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -width / 2);
  g.rotateY(Math.PI / 2);
  g.translate(xc, 0, 0);
  return g;
}
export function lathe(profile, seg = 12) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
}
const _Y = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _mat = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _sc = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
export function capsule(a, b, r, color, seg = 8, rings = 3) {
  _a.set(...a); _b.set(...b); _d.copy(_b).sub(_a);
  const len = _d.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.0001, len - 2 * r), rings, seg);
  _qq.setFromUnitVectors(_Y, _d.normalize());
  _mat.compose(_a.add(_b).multiplyScalar(0.5), _qq, _sc);
  g.applyMatrix4(_mat);
  return paint(g, color);
}
export function paint(geo, color) { return part(geo, color); }
export const P = (geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => part(geo, color, x, y, z, rx, ry, rz, sx, sy, sz);
export function place(list, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _qq.setFromEuler(_e.set(rx, ry, rz));
  _mat.compose(_a.set(x, y, z), _qq, _sc);
  for (const g of list) g.applyMatrix4(_mat);
  return list;
}
// tubes / cylinders with the axis along Z or X or Y
export const cylZ = (r, len, seg = 10) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateX(Math.PI / 2); return g; };
export const cylX = (r, len, seg = 10) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); return g; };
export const cylY = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const sph = (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
export const torusZ = (R, r, seg = 18) => new THREE.TorusGeometry(R, r, 5, seg);              // ring in the XY plane (axis Z)
export const torusY = (R, r, seg = 18) => { const g = new THREE.TorusGeometry(R, r, 5, seg); g.rotateX(Math.PI / 2); return g; };

// merge helper: indexed or not, uv dropped, so mixed primitives can share one buffer
export function mergeParts(list, grad) {
  const out = list.map((g0) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    return g;
  });
  const m = mergeGeometries(out, false);
  // baked vertical gradient (top lighter, bottom darker): grad = [yBottom, yTop, mulBottom, mulTop]
  if (grad && m.attributes.color) {
    const pos = m.attributes.position, col = m.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, (pos.getY(i) - grad[0]) / (grad[1] - grad[0])));
      const k = grad[2] + (grad[3] - grad[2]) * t;
      col.setXYZ(i, Math.min(1, col.getX(i) * k), Math.min(1, col.getY(i) * k), Math.min(1, col.getZ(i) * k));
    }
  }
  return m;
}

// a row of vent slots (dark slits) along `axis` starting at (x,y,z); face-on dims w x h x d
export function slots(n, x, y, z, step, axis, w, h, d, color = COL.dark) {
  const L = [];
  for (let i = 0; i < n; i++) {
    const o = i * step;
    L.push(P(BX(w, h, d), color, x + (axis === 'x' ? o : 0), y + (axis === 'y' ? o : 0), z + (axis === 'z' ? o : 0)));
  }
  return L;
}
// a thin panel line (groove) from (x1,y1) to (x2,y2) on a plane of constant z
function groove(list, x1, y1, x2, y2, z, w = 0.004, d = 0.004, color = COL.dark) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  list.push(P(BX(len, w, d), color, (x1 + x2) / 2, (y1 + y2) / 2, z, 0, 0, Math.atan2(y2 - y1, x2 - x1)));
}

// rotate a list of part geometries about the point (cx, cy, cz) (euler rx, ry, rz)
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
export function rotAbout(list, cx, cy, cz, rx, ry, rz) {
  _m1.makeTranslation(cx, cy, cz);
  _m2.makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  _m3.makeTranslation(-cx, -cy, -cz);
  _m1.multiply(_m2).multiply(_m3);
  for (const g of list) g.applyMatrix4(_m1);
}
// tiny hex-nut screw head (axis Y)
const nut = (list, x, y, z, c = 0x59606a) => list.push(P(cylY(0.0036, 0.0036, 0.003, 6), c, x, y, z));

// ---------------------------------------------------------------- soft cushions (smooth shaded)
// pillow(w, h, d, opt): a rounded slab (edge radius r, k rows on each rounded edge, n[] flat rows per axis) whose two faces
// normal to `axis` (0 x, 1 y, 2 z) bulge like a filled cushion (+axis face by `bulge`, the other by bulge * back), then an
// optional deform(v) on each local position. Vertices are welded and normals averaged, so the cushion shades smoothly.
// pillowPipe(...same args, side, rad) is a piping roll that follows the cushion's rim on the +axis (side 1) or -axis face.
const _cq = new THREE.Vector3(), _cd = new THREE.Vector3();
function cushionShape(p, A, R, o) {
  const ax = o.axis ?? 2, u = (ax + 1) % 3, v = (ax + 2) % 3;
  const pu = p.getComponent(u) / A[u], pv = p.getComponent(v) / A[v];
  const f = Math.max(0, 1 - pu * pu) * Math.max(0, 1 - pv * pv);
  const s = p.getComponent(ax) / A[ax];
  p.setComponent(ax, p.getComponent(ax) + (o.bulge ?? 0.01) * f * (s >= 0 ? s : (o.back ?? 0.3) * s));
  if (o.deform) o.deform(p, A);
  return p;
}
const pillowR = (A, o) => Math.max(1e-3, Math.min(o.r ?? 0.02, A[0] - 1e-3, A[1] - 1e-3, A[2] - 1e-3));
export function pillow(w, h, d, o = {}) {
  const A = [w / 2, h / 2, d / 2], R = pillowR(A, o), k = o.k ?? 2, n = o.n ?? [4, 4, 1];
  const N = n.map((m) => m + 2 * k);
  const g = new THREE.BoxGeometry(1, 1, 1, N[0], N[1], N[2]);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  const map = (t, ax) => {
    const i = Math.round((t + 0.5) * N[ax]), a = A[ax];
    if (i <= k) return -a + R * (i / k);
    if (i >= N[ax] - k) return a - R * ((N[ax] - i) / k);
    return -a + R + (2 * a - 2 * R) * ((i - k) / n[ax]);
  };
  const pos = g.attributes.position, p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.set(map(pos.getX(i), 0), map(pos.getY(i), 1), map(pos.getZ(i), 2));
    _cq.set(Math.max(-A[0] + R, Math.min(A[0] - R, p.x)), Math.max(-A[1] + R, Math.min(A[1] - R, p.y)), Math.max(-A[2] + R, Math.min(A[2] - R, p.z)));
    _cd.subVectors(p, _cq);
    const L = _cd.length();
    if (L > 1e-9) p.copy(_cq).addScaledVector(_cd, R / L);
    cushionShape(p, A, R, o);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  const m = mergeVertices(g, 1e-6);
  m.computeVertexNormals();
  return m;
}
export function pillowPipe(w, h, d, o = {}, side = 1, rad = 0.0035, seg = 36) {
  const A = [w / 2, h / 2, d / 2], R = pillowR(A, o), ax = o.axis ?? 2, u = (ax + 1) % 3, v = (ax + 2) % 3;
  const c = 0.7071 * R, hu = A[u] - R, hv = A[v] - R, pts = [];
  const C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let ci = 0; ci < 4; ci++) {
    const a0 = (ci * Math.PI) / 2, [su, sv] = C[ci], [nu, nv] = C[(ci + 1) % 4];
    for (let j = 0; j <= 3; j++) { const a = a0 + (j / 3) * (Math.PI / 2); pts.push([su * hu + c * Math.cos(a), sv * hv + c * Math.sin(a)]); }
    const a1 = a0 + Math.PI / 2, p0 = pts[pts.length - 1], p1 = [nu * hu + c * Math.cos(a1), nv * hv + c * Math.sin(a1)];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), m = Math.max(1, Math.round(len / 0.03));
    for (let j = 1; j < m; j++) pts.push([p0[0] + ((p1[0] - p0[0]) * j) / m, p0[1] + ((p1[1] - p0[1]) * j) / m]);
  }
  const V = pts.map(([pu, pv]) => {
    const p = new THREE.Vector3();
    p.setComponent(u, pu); p.setComponent(v, pv); p.setComponent(ax, side * (A[ax] - R + c));
    return cushionShape(p, A, R, o);
  });
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(V, true, 'centripetal'), seg, rad, 3, true);
}
// a stitched seam line lying on the cushion's +axis face: dir 0 runs along the first in-plane axis at `at` on the second,
// dir 1 the other way round; from/to stay inside the flat area of the face
export function pillowSeam(w, h, d, o, dir, at, from, to, rad = 0.0022, m = 8) {
  const A = [w / 2, h / 2, d / 2], ax = o.axis ?? 2, u = (ax + 1) % 3, v = (ax + 2) % 3, pts = [];
  for (let i = 0; i <= m; i++) {
    const p = new THREE.Vector3();
    p.setComponent(dir === 0 ? u : v, from + ((to - from) * i) / m); p.setComponent(dir === 0 ? v : u, at); p.setComponent(ax, A[ax]);
    pts.push(cushionShape(p, A, 0, o));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), m, rad, 3, false);
}
// flat strap (belt webbing) from a to b, width w, thickness t, its flat side facing `up` (roughly)
const _su = new THREE.Vector3(), _sx = new THREE.Vector3(), _sz = new THREE.Vector3(), _sm = new THREE.Matrix4();
function strap(a, b, w, t, color, up = [0, 1, 0]) {
  _a.set(...a); _b.set(...b); _sz.copy(_b).sub(_a);
  const len = _sz.length(); _sz.normalize();
  _su.set(...up); _sx.crossVectors(_su, _sz).normalize(); _su.crossVectors(_sz, _sx);
  const g = BX(w, t, len);
  _sm.makeBasis(_sx, _su, _sz).setPosition(_a.add(_b).multiplyScalar(0.5));
  g.applyMatrix4(_sm);
  return paint(g, color);
}

// ================================================================= LINEAR SEAT (static)
export function seatParts() {
  const armor = [], cloth = [], teal = [];
  const { arm, arm2, arm3 } = COL;

  // ---- R5 soft goods: smooth-shaded cushions (cool slate, so the dusk sun does not turn them brown) with piping
  const CU = 0x3d4858, CU2 = 0x353f4d, PIPE = 0x8a90a8, PIPE2 = 0x58607a, SEAM = 0x0b0e11;
  const cushion = (list, w, h, d, o, color, x, y, z, rx = 0, ry = 0, rz = 0, pipes = null) => {
    list.push(P(pillow(w, h, d, o), color, x, y, z, rx, ry, rz));
    if (pipes) for (const [side, col, rad] of pipes) armor.push(P(pillowPipe(w, h, d, o, side, rad ?? 0.0032, o.pipeSeg ?? 20), col, x, y, z, rx, ry, rz));
    for (const [dir, at, from, to] of o.seams ?? []) cloth.push(P(pillowSeam(w, h, d, o, dir, at, from, to), 0x171c22, x, y, z, rx, ry, rz));
  };
  // padded wing in a hard shell (headrest and shoulder wings): pad and shell share one swept side profile (the front edge
  // leans back toward the top, the top edge drops toward the front) and curve around the body. The shell is a thin slab
  // with a tight 6 mm fillet, so it reads as a machined part next to the soft pad.
  const wing = (sx, x, y, z, ry, h, d, t, col, pipeCol, shellCol = 0x434c56) => {
    const sweep = (p, A) => {
      const ty = (p.y / A[1] + 1) / 2, tz = Math.max(0, -p.z / A[2]);
      if (p.z < 0) p.z *= 1 - 0.3 * ty * ty;
      if (p.y > 0) p.y *= 1 - 0.28 * tz * tz;
      p.x += sx * 0.014 * (p.z / A[2]) ** 2;
    };
    cushion(cloth, t, h, d, { axis: 0, r: Math.min(0.018, t / 2 - 0.002), n: [1, 3, 3], bulge: 0.012, back: 1, deform: sweep }, col, x, y, z, 0, ry, 0, [[-sx, pipeCol]]);
    const sh = pillow(0.016, h + 0.014, d + 0.014, { axis: 0, r: 0.006, k: 1, n: [1, 2, 2], bulge: 0, deform: sweep });
    sh.translate(sx * (t / 2 + 0.006), 0, 0);
    armor.push(P(sh, shellCol, x, y, z, 0, ry, 0));
    teal.push(...place([P(BX(0.003, h * 0.5, 0.004), COL.teal, sx * (t / 2 + 0.0155), -0.01, 0.0)], x, y, z, 0, ry, 0));
  };
  // dark backing board the back cushions sit on (hard, crisp chamfer)
  armor.push(P(plateXY([[-0.20, -0.63], [0.20, -0.63], [0.245, -0.45], [0.25, -0.10], [0.21, 0.02], [-0.21, 0.02], [-0.25, -0.10], [-0.245, -0.45]], 0.03, 0.008), 0x161b20, 0, 0, 0.335));
  // three stacked back cushions (lumbar, mid, upper), each dished toward the pilot; the gaps between them are the seams
  // (these are built facing +z and turned half round (ry = PI) so the bulged, piped, seamed face looks at the pilot;
  // in that local frame +z is toward the pilot, so the dish pulls the side edges toward +z)
  const dish = (c, taper = 0) => (p, A) => { p.x *= 1 + taper * (p.y / A[1]); p.z += c * p.x * p.x; };
  const ch = (h) => [[1, -0.07, -h / 2 + 0.03, h / 2 - 0.03], [1, 0.07, -h / 2 + 0.03, h / 2 - 0.03]];   // two vertical channel seams
  cushion(cloth, 0.29, 0.175, 0.06, { r: 0.024, n: [4, 2, 1], bulge: 0.024, deform: dish(0.9, 0.05), seams: ch(0.175) }, CU, 0, -0.528, 0.302, 0, Math.PI, 0, [[1, PIPE2]]);
  cushion(cloth, 0.315, 0.175, 0.058, { r: 0.024, n: [4, 2, 1], bulge: 0.015, deform: dish(0.9, 0.04), seams: ch(0.175) }, CU, 0, -0.338, 0.302, 0, Math.PI, 0, [[1, PIPE2]]);
  cushion(cloth, 0.335, 0.165, 0.056, { r: 0.024, n: [4, 2, 1], bulge: 0.013, deform: dish(0.9, 0.03), seams: ch(0.165) }, CU, 0, -0.152, 0.302, 0, Math.PI, 0, [[1, PIPE2]]);
  for (const y of [-0.433, -0.244]) armor.push(P(BX(0.26, 0.007, 0.01), SEAM, 0, y, 0.302));          // seam shadow between cushions
  // harness slots at the top of the upper cushion (shoulder straps feed back here) with bright grommet frames
  for (const sx of [-1, 1]) {
    armor.push(P(RB(0.05, 0.016, 0.012, 0.005), 0x8a90a8, sx * 0.085, -0.088, 0.259), P(BX(0.04, 0.007, 0.012), SEAM, sx * 0.085, -0.088, 0.255));
  }

  // ---- broad layered shells behind the seat (ref 08 / 02): lower back, upper back, headrest, each a bevelled plate with a
  // dark gap line under it and a pale bevel-edge strip on top. Wider than tall, low crown, side wings at head height.
  const EDGE = 0x9aa0bd;
  const shell = (pts, z, depth, color, bev = 0.008, edge = true) => {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    armor.push(P(plateXY(pts.map(([x, y]) => [cx + (x - cx) * 1.045, cy + (y - cy) * 1.035]), depth, bev), 0x07090b, 0, 0, z - 0.006));   // gap line
    armor.push(P(plateXY(pts, depth, bev), color, 0, 0, z));
    if (edge) {
      const zf = z + depth / 2 + bev + 0.0015;
      let hw = 1e-3, hh = 1e-3;
      for (const p of pts) { hw = Math.max(hw, Math.abs(p[0] - cx)); hh = Math.max(hh, Math.abs(p[1] - cy)); }
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const nx = ((a[0] + b[0]) / 2 - cx) / hw, ny = ((a[1] + b[1]) / 2 - cy) / hh;
        const lit = (-nx + ny) / 1.4;                       // light from the top left
        if (Math.abs(b[1] - a[1]) < 1e-6 && a[1] < cy) continue;   // no strip on the bottom edge
        const k = 0.965;
        groove(armor, cx + (a[0] - cx) * k, cy + (a[1] - cy) * k, cx + (b[0] - cx) * k, cy + (b[1] - cy) * k, zf, 0.005, 0.003, lit > 0.3 ? EDGE : 0x323a44);
      }
    }
  };
  // lower back (widest, darkest), upper back, headrest cap
  shell([[-0.25, -0.68], [0.25, -0.68], [0.36, -0.45], [0.37, -0.12], [0.335, -0.03], [-0.335, -0.03], [-0.37, -0.12], [-0.36, -0.45]], 0.375, 0.03, 0x20262b, 0.01);
  shell([[-0.335, -0.115], [0.335, -0.115], [0.365, 0.04], [0.30, 0.235], [0.16, 0.285], [-0.16, 0.285], [-0.30, 0.235], [-0.365, 0.04]], 0.402, 0.026, 0x2d343a);
  {
    // headrest: one rounded barrel shell (cylinder segment, 9 segments) over a dark backing plate
    const R = 0.55, h = 0.25, chord = 0.36, ang = 2 * Math.asin(chord / 2 / R), zc = 0.452, sag = R * (1 - Math.cos(ang / 2));
    armor.push(P(plateXY([[-0.185, 0.045], [0.185, 0.045], [0.185, 0.315], [-0.185, 0.315]], 0.012, 0.006), 0x07090b, 0, 0, 0.422));
    const g = new THREE.CylinderGeometry(R, R, h, 9, 1, true, -ang / 2, ang);
    g.translate(0, 0.18, zc - R);
    armor.push(P(g, 0x3a434b));
    for (let k = 0; k < 9; k++) {                        // bright top edge along the arc
      const t0 = -ang / 2 + (k / 9) * ang, t1 = -ang / 2 + ((k + 1) / 9) * ang, tm = (t0 + t1) / 2;
      armor.push(P(BX(chord / 9 * 1.04, 0.005, 0.004), EDGE, R * Math.sin(tm), 0.305, zc - R + R * Math.cos(tm) + 0.002, 0, tm, 0));
    }
    armor.push(P(BX(0.005, h * 0.96, 0.004), EDGE, -chord / 2 + 0.002, 0.18, zc - sag + 0.002));      // bright left edge
    armor.push(P(BX(0.005, h * 0.96, 0.004), 0x323a44, chord / 2 - 0.002, 0.18, zc - sag + 0.002));
    groove(armor, -0.17, 0.12, 0.17, 0.12, zc + 0.001, 0.003, 0.003);
  }
  // lumbar plate, offset to one side (asymmetric) and a bar of trim plates
  shell([[-0.20, -0.52], [0.25, -0.52], [0.23, -0.21], [-0.17, -0.21]], 0.402, 0.02, 0x2d343a, 0.007);
  shell([[-0.28, -0.40], [-0.215, -0.40], [-0.205, -0.17], [-0.28, -0.15]], 0.404, 0.016, 0x3a434b, 0.006);
  // recessed padded centre of the upper shell: thin frame, brown pad, stitching, emblem
  armor.push(P(RB(0.22, 0.014, 0.014, 0.005), 0x161b1f, 0, 0.0775, 0.424), P(RB(0.22, 0.014, 0.014, 0.005), 0x161b1f, 0, -0.1075, 0.424));
  armor.push(P(RB(0.014, 0.19, 0.014, 0.005), 0x161b1f, -0.103, -0.015, 0.424), P(RB(0.014, 0.19, 0.014, 0.005), 0x161b1f, 0.103, -0.015, 0.424));
  armor.push(P(RB(0.2, 0.17, 0.01, 0.01), COL.pad, 0, -0.015, 0.416));
  for (const y of [-0.06, 0.03]) armor.push(P(BX(0.19, 0.004, 0.004), 0x171b1e, 0, y, 0.423));
  armor.push(P(BX(0.004, 0.17, 0.004), 0x171b1e, 0.045, -0.015, 0.423));
  armor.push(P(cylZ(0.0075, 0.008, 10), 0xc92d26, -0.065, -0.015, 0.425));
  armor.push(P(torusZ(0.013, 0.0025, 14), EDGE, -0.065, -0.015, 0.426));
  for (let i = 0; i < 3; i++) armor.push(P(BX(0.11, 0.008, 0.006), 0x07090b, 0, -0.15 - i * 0.022, 0.4025));    // vent slots under the pad
  // cable ribbon down the left back edge with a clamp every 15 cm
  armor.push(P(BX(0.012, 0.48, 0.004), 0x14181a, -0.345, -0.30, 0.3995));
  for (let i = 0; i < 4; i++) armor.push(P(RB(0.026, 0.014, 0.012, 0.004), 0x59606a, -0.345, -0.50 + i * 0.15, 0.401));
  // panel-line grooves between plates
  groove(armor, -0.335, -0.115, 0.335, -0.115, 0.4165, 0.003, 0.003); groove(armor, -0.37, -0.03, 0.37, -0.03, 0.392, 0.003, 0.003);
  groove(armor, 0.0, -0.52, 0.0, -0.21, 0.4145, 0.003, 0.003);
  for (const sx of [-1, 1]) {
    teal.push(P(BX(0.003, 0.18, 0.004), COL.teal, sx * 0.31, -0.30, 0.393));          // thin cyan lines only
    teal.push(P(BX(0.003, 0.09, 0.004), COL.teal, sx * 0.145, 0.125, 0.4425));
    // headrest side wings (padded wing in a hard shell, toed in)
    wing(sx, sx * 0.168, 0.05, 0.275, sx * 0.2, 0.19, 0.15, 0.04, CU, PIPE);
  }
  // headrest: dished centre cushion in a hard frame, padded neck roll below it
  armor.push(P(plateXY([[-0.15, -0.035], [0.15, -0.035], [0.168, 0.05], [0.152, 0.17], [0.10, 0.20], [-0.10, 0.20], [-0.152, 0.17], [-0.168, 0.05]], 0.05, 0.008), 0x262d33, 0, 0, 0.36));
  cushion(cloth, 0.27, 0.19, 0.07, { r: 0.026, n: [4, 3, 1], bulge: 0.016, deform: dish(1.1), seams: ch(0.19) }, CU, 0, 0.078, 0.305, 0, Math.PI, 0, [[1, PIPE]]);
  cloth.push(capsule([-0.105, -0.048, 0.292], [0.105, -0.048, 0.292], 0.026, CU2, 12, 3));
  for (const sx of [-1, 1]) armor.push(P(cylX(0.019, 0.01, 12), 0x4a525c, sx * 0.112, -0.048, 0.292));   // neck roll end caps

  // ---- asymmetric side towers behind the shoulder bolsters (thin, with a visible mount)
  {
    const t = [];
    t.push(P(RB(0.05, 0.40, 0.12, 0.012), 0x20262b, 0, 0, 0));
    t.push(P(RB(0.044, 0.026, 0.108, 0.01), 0x39424a, 0, 0.21, 0));
    for (let i = 0; i < 4; i++) t.push(P(BX(0.038, 0.011, 0.01), 0x07090b, 0, -0.11 + i * 0.07, 0.0605));
    t.push(P(RB(0.008, 0.36, 0.012, 0.003), EDGE, 0.017, 0.0, 0.0625));
    place(t, 0.395, -0.10, 0.415, 0, 0, -0.03);
    armor.push(...t);
    for (const y of [-0.24, 0.02]) armor.push(P(RB(0.07, 0.035, 0.07, 0.01), 0x2d343a, 0.365, y, 0.40));      // brackets into the shell
    teal.push(P(BX(0.003, 0.22, 0.004), COL.teal, 0.421, -0.08, 0.415));
  }
  {
    const t = [P(RB(0.06, 0.30, 0.1, 0.014), 0x2b3238, 0, 0, 0), P(RB(0.05, 0.024, 0.088, 0.01), 0x39424a, 0, 0.16, 0)];
    for (let i = 0; i < 3; i++) t.push(P(BX(0.044, 0.009, 0.01), 0x07090b, 0, -0.08 + i * 0.05, 0.0505));
    place(t, -0.405, -0.25, 0.40, 0, 0, 0.03);
    armor.push(...t);
    armor.push(P(cylX(0.03, 0.05, 14), 0x39424a, -0.405, -0.075, 0.40), P(cylX(0.017, 0.058, 12), COL.chrome, -0.405, -0.075, 0.40));
    armor.push(P(sph(0.009, 8, 6), 0xd0352a, -0.395, -0.16, 0.452));
    armor.push(P(RB(0.07, 0.03, 0.06, 0.01), 0x2d343a, -0.37, -0.22, 0.40));
  }

  // ---- side bolsters, per side from the hip up: torso bolster, armrest-side bolster (hard curved frame + padded top),
  // shoulder wing (hard shell + inner pad)
  for (const sx of [-1, 1]) {
    // torso bolster: tall padded roll angled in toward the pilot, its front swept back toward the top
    const tb = (p, A) => { const t = (p.y / A[1] + 1) / 2; if (p.z < 0) p.z *= 1 - 0.3 * t; p.x -= sx * 0.01 * (1 - (p.z / A[2]) ** 2); };
    cushion(cloth, 0.065, 0.30, 0.17, { axis: 0, r: 0.024, n: [1, 3, 2], bulge: 0.012, back: 1, deform: tb }, CU2, sx * 0.222, -0.445, 0.228, 0, sx * 0.42, 0, [[-sx, PIPE]]);
    // armrest-side frame: curved inner face, crisp chamfers, lower than r4 so it does not wall in the console
    const arc = [];
    for (let i = 0; i <= 7; i++) { const t = i / 7; arc.push([0.275 - 0.02 * Math.sin(Math.PI * t), 0.14 + 0.21 * t]); }
    const pts = arc.concat([[0.37, 0.35], [0.378, 0.24], [0.36, 0.14]]).map(([x, z]) => [x * sx, z]);
    armor.push(P(plateXZ(pts, 0.16, -0.52, 0.016), arm, 0, 0, 0));
    armor.push(P(BX(0.07, 0.004, 0.004), EDGE, sx * 0.322, -0.343, 0.127));                       // pale front top edge
    teal.push(P(BX(0.003, 0.08, 0.004), COL.teal, sx * 0.36, -0.40, 0.132));
    for (const y of [-0.375, -0.43]) nut(armor, sx * 0.29, y, 0.131, 0x59606a);
    // padded armrest-side top: dished across, rolled over the inner edge, pale piping
    const ab = (p, A) => { const ux = p.x / A[0]; p.y -= 0.008 * (1 - ux * ux) * (p.y > 0 ? 1 : 0); p.y -= 0.01 * Math.max(0, -sx * ux); };
    const ao = { axis: 1, r: 0.018, n: [2, 1, 3], bulge: 0.01, back: 0, deform: ab };
    cushion(cloth, 0.10, 0.04, 0.2, ao, CU2, sx * 0.322, -0.322, 0.248, 0, 0, 0, [[1, PIPE]]);
    // shoulder wing (padded wing in a hard shell) on a short bracket into the back frame
    wing(sx, sx * 0.274, -0.13, 0.29, sx * 0.15, 0.16, 0.17, 0.04, CU, PIPE2);
    armor.push(P(RB(0.03, 0.05, 0.05, 0.008), 0x2d343a, sx * 0.30, -0.13, 0.375));
  }

  // ---- seat pan: contoured cushion (raised thigh supports, centre channel, waterfall front) on a hard chamfered tray
  {
    const po = {
      axis: 1, r: 0.026, n: [5, 1, 5], bulge: 0.01, back: 0, seams: [[0, -0.085, -0.19, 0.24], [0, 0.085, -0.19, 0.24]],
      deform: (p, A) => {
        const t = (p.y + A[1]) / (2 * A[1]), ax = Math.abs(p.x);
        const side = Math.min(1, Math.max(0, (ax - 0.09) / 0.08));
        p.y += t * 0.02 * side * side * (3 - 2 * side);                               // thigh supports
        p.y -= t * 0.007 * Math.exp(-((p.x / 0.035) ** 2)) * (p.z < 0.15 ? 1 : 0.3);    // centre channel
        const f = Math.max(0, (-p.z - 0.12) / 0.13);
        p.y -= t * 0.03 * f * f;                                                       // waterfall front edge
      },
    };
    cushion(cloth, 0.42, 0.06, 0.50, po, CU, 0, -0.593, 0.03, 0, 0, 0, [[1, PIPE, 0.004]]);
  }
  armor.push(P(plateXZ([[-0.225, 0.30], [0.225, 0.30], [0.245, 0.27], [0.245, -0.17], [0.215, -0.235], [-0.215, -0.235], [-0.245, -0.17], [-0.245, 0.27]], 0.03, -0.66, 0.008), arm, 0, 0, 0));
  armor.push(P(BX(0.40, 0.004, 0.004), EDGE, 0, -0.622, -0.244));                                   // pale tray lip
  for (const sx of [-1, 1]) {
    // thigh bolster rolls along the pan sides, rising toward the knee
    const tr = (p, A) => { const f = Math.max(0, -p.z / A[2]); p.y += 0.016 * f * f; p.x += sx * 0.004 * (p.y / A[1]); };
    cushion(cloth, 0.045, 0.06, 0.42, { axis: 0, r: 0.02, n: [1, 1, 5], bulge: 0.006, back: 1, deform: tr }, CU2, sx * 0.238, -0.548, 0.02, 0, 0, 0, [[-sx, PIPE2]]);
    // lap-belt anchor: bolted bracket on the tray side with a D-ring, belt webbing up to the lap buckle
    armor.push(P(plateZY([[0.17, -0.66], [0.17, -0.60], [0.14, -0.575], [0.10, -0.575], [0.08, -0.60], [0.08, -0.66]], 0.008, sx * 0.256, 0.003), 0x4a525c, 0, 0, 0));
    armor.push(P(cylX(0.006, 0.012, 8), COL.chrome, sx * 0.258, -0.60, 0.125), P(torusZ(0.012, 0.0025, 10), COL.chrome, sx * 0.258, -0.584, 0.125, 0, Math.PI / 2, 0));
    cloth.push(strap([sx * 0.262, -0.588, 0.122], [sx * 0.252, -0.512, 0.0], 0.03, 0.004, 0x3b3d56, [sx, 0.3, 0]));
    cloth.push(strap([sx * 0.252, -0.512, 0.0], [sx * 0.222, -0.494, -0.05], 0.03, 0.004, 0x3b3d56, [sx * 0.4, 1, 0]));
    armor.push(P(RB(0.10, 0.12, 0.20, 0.025), arm2, sx * 0.40, -0.60, 0.12));                  // side brackets (half height, outboard)
    teal.push(P(BX(0.004, 0.08, 0.004), COL.teal, sx * 0.452, -0.60, 0.02));
    armor.push(capsule([sx * 0.25, -0.645, -0.31], [sx * 0.25, -0.645, 0.38], 0.024, COL.arm3, 8));
    armor.push(capsule([sx * 0.27, -0.64, 0.38], [sx * 0.27, -0.36, 0.38], 0.03, COL.arm2, 8));
  }
  armor.push(P(RB(0.52, 0.035, 0.60, 0.012), arm2, 0, -0.665, 0.03));
  armor.push(P(RB(0.30, 0.03, 0.16, 0.01), arm, 0, -0.69, -0.12));
  teal.push(P(BX(0.2, 0.005, 0.006), COL.teal, 0, -0.645, -0.265));
  // gimbal joint + telescoping shaft on the rear
  armor.push(P(sph(0.085, 14, 10), arm2, 0, -0.35, 0.44));
  armor.push(P(torusZ(0.09, 0.012, 20), arm3, 0, -0.35, 0.40));
  armor.push(P(cylZ(0.048, 0.5, 16), COL.chrome, 0, -0.35, 0.69));
  for (const z of [0.5, 0.6, 0.72, 0.84]) armor.push(P(torusZ(0.05, 0.007, 16), COL.arm2, 0, -0.35, z));
  armor.push(P(cylZ(0.01, 0.58, 6), 0x111111, -0.07, -0.38, 0.68), P(cylZ(0.01, 0.58, 6), 0x111111, 0.07, -0.30, 0.68));
  armor.push(P(cylZ(0.008, 0.5, 6), COL.chrome, 0, -0.44, 0.70));
  armor.push(P(RB(0.08, 0.06, 0.03, 0.01), COL.chrome, 0, -0.45, 0.07));                       // chest buckle
  armor.push(P(BX(0.05, 0.022, 0.012), COL.teal, 0, -0.45, 0.058));

  // ---- crotch strap: anchor bracket on the tray front, webbing up the centre channel to the strap buckle
  armor.push(P(RB(0.05, 0.022, 0.03, 0.006), 0x4a525c, 0, -0.62, -0.235), P(cylX(0.005, 0.054, 8), COL.chrome, 0, -0.612, -0.245));
  cloth.push(strap([0, -0.612, -0.248], [0, -0.571, -0.215], 0.036, 0.004, 0x3b3d56, [0, 0.6, 1]));
  cloth.push(strap([0, -0.571, -0.215], [0, -0.507, 0.0], 0.036, 0.004, 0x3b3d56, [0, 1, 0.3]));

  // ---- the pilot (ref 08): lavender-grey flight suit with purple panels; slim legs, knees spread, flat knee pads, boot cuffs
  cloth.push(P(sph(1, 18, 12), COL.suit2, 0, -0.48, 0.19, 0, 0, 0, 0.15, 0.16, 0.1));
  cloth.push(P(RB(0.045, 0.2, 0.01, 0.004), COL.purple, -0.08, -0.41, 0.052, 0.08, 0, 0.06));        // chest panels
  cloth.push(P(RB(0.045, 0.2, 0.01, 0.004), COL.purple, 0.08, -0.41, 0.052, 0.08, 0, -0.06));
  cloth.push(P(RB(0.01, 0.18, 0.012, 0.004), 0xcfb94a, 0, -0.43, 0.052));                         // centre zip
  for (const sx of [-1, 1]) {
    cloth.push(P(cylX(0.03, 0.07, 12), COL.suit2, sx * 0.225, -0.245, 0.16));                        // small hinge barrel
    armor.push(P(RB(0.06, 0.018, 0.07, 0.008), 0x2d343a, sx * 0.232, -0.2, 0.16, 0, 0, sx * -0.25));   // shoulder pad
    // thigh, knee, shin: slim (thigh r 0.04), knees spread to x 0.205
    cloth.push(capsule([sx * 0.16, -0.525, 0.16], [sx * 0.205, -0.52, -0.27], 0.04, COL.suit, 12, 4));
    cloth.push(capsule([sx * 0.15, -0.49, 0.10], [sx * 0.196, -0.487, -0.24], 0.007, COL.purple, 6, 2));   // purple thigh stripe
    cloth.push(P(sph(1, 12, 9), COL.suit2, sx * 0.205, -0.52, -0.31, 0, 0, 0, 0.044, 0.043, 0.044));
    armor.push(P(RB(0.074, 0.008, 0.066, 0.004), 0x161a1e, sx * 0.205, -0.4715, -0.305, 0.12, 0, 0));    // darker rim
    armor.push(P(RB(0.064, 0.01, 0.056, 0.006), 0x3a424a, sx * 0.205, -0.466, -0.305, 0.12, 0, 0));      // flat bevelled knee pad
    cloth.push(P(cylZ(0.0425, 0.03, 12), 0x3a3d52, sx * 0.18, -0.5225, -0.034, 0, sx * -0.1, 0));        // thigh strap band
    armor.push(P(BX(0.062, 0.003, 0.004), 0x8a90a8, sx * 0.205, -0.466, -0.332, 0.12, 0, 0));
    cloth.push(capsule([sx * 0.205, -0.54, -0.33], [sx * 0.155, -0.75, -0.47], 0.033, COL.suit, 10, 4));
    cloth.push(P(cylY(0.036, 0.036, 0.018, 10), COL.purple, sx * 0.172, -0.675, -0.41, 0.55, 0, 0));      // shin band
    armor.push(P(RB(0.036, 0.09, 0.012, 0.005), 0x2d343a, sx * 0.18, -0.625, -0.40, 0.55, 0, 0));          // shin guard
    armor.push(P(RB(0.06, 0.02, 0.04, 0.008), 0x8a90a8, sx * 0.2, -0.505, -0.06));                         // lap belt buckle
  }
  armor.push(P(RB(0.05, 0.016, 0.03, 0.006), 0x20262b, 0, -0.5, 0.0), P(BX(0.05, 0.003, 0.004), 0x8a90a8, 0, -0.491, -0.013));   // dark strap buckle
  return { armor, cloth, teal };
}

// ================================================================= ARMREST CONSOLES (rattle group)
export function consoleParts() {
  const armor = [], cloth = [], teal = [], trit = [], leds = [];
  const { dark, panel } = COL;
  const EDGE = 0x9aa0bd;
  for (const sx of [-1, 1]) {
    const X = (v) => v * sx;
    const xc = X(0.34);
    // long, low chamfered body (side profile: low nose, flat deck over the stick well, rising rear), width 0.165
    const n0 = [armor.length, cloth.length, teal.length, trit.length, leds.length];
    armor.push(P(plateZY([[0.30, -0.43], [0.30, -0.325], [0.17, -0.325], [0.15, -0.345], [-0.22, -0.35], [-0.36, -0.395], [-0.37, -0.43]], 0.165, xc, 0.01), 0x2c3238, 0, 0, 0));
    // lower skirt (darker, layered under) and a plan-view chamfered deck plate (lighter)
    armor.push(P(plateXZ([[0.40, 0.28], [0.40, -0.26], [0.375, -0.31], [0.305, -0.31], [0.28, -0.26], [0.28, 0.28]].map(([x, z]) => [X(x), z]), 0.04, -0.47, 0.01), 0x1d2226, 0, 0, 0));
    armor.push(P(plateXZ([[0.418, 0.02], [0.418, -0.215], [0.40, -0.265], [0.285, -0.265], [0.262, -0.215], [0.262, 0.02]].map(([x, z]) => [X(x), z]), 0.004, -0.349, 0.004), 0x56606a, 0, 0, 0));                  // mid charcoal deck
    // panel gaps across the deck, lavender top-front trim roll (fillet), hatch stripes on the front face
    armor.push(P(BX(0.15, 0.0035, 0.003), dark, X(0.34), -0.3465, -0.145), P(BX(0.15, 0.0035, 0.003), dark, X(0.34), -0.3465, 0.0));
    armor.push(P(cylX(0.0075, 0.15), EDGE, X(0.34), -0.346, -0.268));
    for (let i = 0; i < 6; i++) armor.push(P(BX(0.011, 0.012, 0.003), 0xc7cbe0, X(0.287 + i * 0.022), -0.403, -0.3625, 0, 0, 0.6));
    // pale bevel strips along the top edges of the deck + a dark gap line under them
    armor.push(P(BX(0.004, 0.004, 0.50), EDGE, X(0.4235), -0.343, 0.04), P(BX(0.004, 0.004, 0.46), EDGE, X(0.2565), -0.343, 0.06));
    armor.push(P(BX(0.004, 0.004, 0.46), dark, X(0.4235), -0.349, 0.02));
    // outer side cover: 3 recessed panel lines instead of vent slits
    armor.push(P(plateZY([[0.27, -0.425], [0.27, -0.36], [0.08, -0.37], [-0.2, -0.37], [-0.30, -0.395], [-0.32, -0.425]], 0.01, X(0.438), 0.005), 0x3a424a, 0, 0, 0));
    for (const y of [-0.385, -0.405]) armor.push(P(BX(0.004, 0.004, 0.5), dark, X(0.4455), y, -0.01));
    for (const z of [-0.2, 0.05, 0.22]) armor.push(P(BX(0.004, 0.05, 0.004), dark, X(0.4455), -0.395, z));
    teal.push(P(BX(0.003, 0.003, 0.36), COL.teal, X(0.4455), -0.416, 0.0));
    // inner face plate with a recessed groove
    armor.push(P(plateZY([[0.26, -0.425], [0.26, -0.37], [-0.19, -0.372], [-0.30, -0.40], [-0.31, -0.425]], 0.008, X(0.252), 0.004), 0x3a424a, 0, 0, 0));
    teal.push(P(BX(0.003, 0.003, 0.30), COL.tealDim, X(0.2555), -0.378, -0.04));

    // switch panel at the nose: bezel frame + recessed dark field + toggle caps
    const sx0 = 0.34, sz0 = -0.225;
    armor.push(P(RB(0.15, 0.008, 0.1, 0.003), 0x4a525c, X(sx0), -0.348, sz0));
    armor.push(P(RB(0.13, 0.006, 0.08, 0.002), 0x2b343a, X(sx0), -0.3455, sz0));
    // tiny labels near the switches: yellow stripe, white box with a dark stripe, red tag
    armor.push(P(BX(0.03, 0.002, 0.006), 0xf0c030, X(0.31), -0.3425, -0.18), P(RB(0.018, 0.002, 0.01, 0.001), 0xe6e8ee, X(0.37), -0.3425, -0.18), P(BX(0.018, 0.0025, 0.003), dark, X(0.37), -0.3415, -0.18));
    armor.push(P(BX(0.012, 0.002, 0.008), 0xd23a2a, X(0.395), -0.3425, -0.2), P(BX(0.02, 0.002, 0.005), 0xf0c030, X(0.295), -0.3425, -0.275));
    // screws (hex nuts) at the corners of the deck, an armrest plank behind the tablet, two cable ribbons with clamps
    for (const [x, z] of [[0.275, -0.25], [0.405, -0.25], [0.275, 0.0], [0.405, 0.0], [0.28, 0.27], [0.40, 0.27], [0.275, -0.145], [0.405, -0.145]]) nut(armor, X(x), z > 0.2 ? -0.3225 : -0.3465, z);
    armor.push(P(RB(0.06, 0.012, 0.1, 0.005), 0x2a3036, X(0.385), -0.3225, 0.25), P(cylY(0.03, 0.03, 0.012, 14), 0x2a3036, X(0.385), -0.3225, 0.2));
    for (const y of [-0.425, -0.445]) {
      armor.push(P(BX(0.004, 0.011, 0.6), 0x14181a, X(0.4515), y, -0.02));
      for (let i = 0; i < 5; i++) armor.push(P(RB(0.008, 0.02, 0.016, 0.003), 0x59606a, X(0.4535), y, -0.25 + i * 0.15));
    }
    for (let i = 0; i < 5; i++) {
      const x = X(0.292 + i * 0.0225), z = sz0 + 0.022;
      armor.push(P(cylY(0.0075, 0.009, 0.006, 10), 0x20262b, x, -0.343, z));
      armor.push(P(cylY(0.0028, 0.0028, 0.016, 6), COL.chrome, x, -0.335, z, 0.3 * (i % 2 ? 1 : -1), 0, 0));
      armor.push(P(sph(0.0045, 6, 5), i === 2 ? COL.amber : 0xdddddd, x, -0.326, z + (i % 2 ? -0.005 : 0.005)));
    }
    for (let i = 0; i < 3; i++) armor.push(P(RB(0.026, 0.006, 0.018, 0.004), 0x59606a, X(0.305 + i * 0.034), -0.343, sz0 - 0.02));
    // raised front shoulder (angled bezel at the nose, ref 08 foreground console)
    armor.push(P(RB(0.15, 0.026, 0.05, 0.012), 0x4a525c, X(0.34), -0.352, -0.32, 0.32, 0, 0));
    armor.push(P(BX(0.15, 0.004, 0.004), EDGE, X(0.34), -0.337, -0.337, 0.32, 0, 0));
    teal.push(P(BX(0.11, 0.003, 0.004), COL.teal, X(0.34), -0.339, -0.3395, 0.32, 0, 0));

    // tilted tablet housing at the rear deck (ref 08/14): thin bezel + dark glass + status strip + thin hinge
    const tab = [];
    tab.push(P(RB(0.15, 0.014, 0.17, 0.007), 0x3a424a, 0, 0, 0));
    tab.push(P(RB(0.134, 0.006, 0.152, 0.004), dark, 0, 0.008, -0.002));
    tab.push(P(BX(0.15, 0.003, 0.004), EDGE, 0, 0.0075, -0.083));
    tab.push(P(RB(0.15, 0.016, 0.012, 0.005), 0x20262b, 0, -0.008, 0.088));                    // thin hinge
    place(tab, X(0.335), -0.328, 0.125, 0.0, 0, X(0.38));
    armor.push(...tab);
    const gl = [P(BX(0.116, 0.003, 0.132), 0x0b5a54, 0, 0.0118, -0.002), P(BX(0.09, 0.003, 0.004), 0x3de8da, 0, 0.0136, -0.03), P(BX(0.06, 0.003, 0.004), 0x3de8da, X(-0.01), 0.0136, -0.012)];
    place(gl, X(0.335), -0.328, 0.125, 0.0, 0, X(0.38));
    leds.push(...gl);
    // rear vent tower: low and thin
    const tower = [P(RB(0.06, 0.09, 0.1, 0.012), 0x20262b, 0, 0, 0), P(RB(0.05, 0.014, 0.09, 0.006), 0x3a424a, 0, 0.05, 0)];
    for (let i = 0; i < 3; i++) tower.push(P(BX(0.044, 0.007, 0.01), dark, 0, -0.025 + i * 0.022, -0.05));
    place(tower, X(0.395), -0.345, 0.325, -0.1, 0, 0);
    armor.push(...tower);
    // small rocker row on the outer shoulder
    for (let i = 0; i < 3; i++) armor.push(P(RB(0.012, 0.008, 0.02, 0.004), 0x59606a, X(0.405), -0.339, 0.045 + i * 0.03));
    // tilt this side's housing 8.5 deg toward the pilot about its centre line
    rotAbout(armor.slice(n0[0]), xc, -0.345, 0, 0, 0, X(0.15));
    rotAbout(teal.slice(n0[2]), xc, -0.345, 0, 0, 0, X(0.15));
    rotAbout(leds.slice(n0[4]), xc, -0.345, 0, 0, 0, X(0.15));
  }
  // left: throttle slot with rails + collar, flight toggle base; right: stick well
  armor.push(P(BX(0.055, 0.006, 0.28), 0x050505, -0.34, -0.347, -0.10));
  for (const x of [-0.37, -0.31]) armor.push(P(RB(0.006, 0.008, 0.30, 0.003), COL.chrome, x, -0.346, -0.10));
  armor.push(P(RB(0.082, 0.008, 0.33, 0.004), 0x20262b, -0.34, -0.349, -0.10));
  armor.push(P(cylY(0.02, 0.023, 0.012, 14), 0x20262b, -0.34, -0.345, -0.10));        // throttle boot collar
  armor.push(P(cylY(0.016, 0.018, 0.012, 12), 0x20262b, -0.29, -0.345, -0.275));
  // stick gimbal (smaller): flared cup, ring with bolts, trunnions, ribbed rubber boot, collar
  armor.push(P(cylY(0.062, 0.066, 0.007, 20), 0x20262b, 0.34, -0.347, -0.12));
  armor.push(P(lathe([[0.068, 0.0], [0.064, 0.008], [0.053, 0.013], [0.047, 0.018], [0.042, 0.018], [0.042, 0.0]], 20), 0x3a424a, 0.34, -0.349, -0.12));
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; armor.push(P(cylY(0.004, 0.004, 0.005, 6), COL.chrome, 0.34 + Math.cos(a) * 0.055, -0.332, -0.12 + Math.sin(a) * 0.055)); }
  armor.push(P(cylX(0.007, 0.115, 10), COL.chrome, 0.34, -0.333, -0.12));
  armor.push(P(cylZ(0.007, 0.115, 10), 0x59606a, 0.34, -0.327, -0.12));
  const bel = [[0.044, 0.0], [0.043, 0.005], [0.035, 0.008], [0.04, 0.013], [0.031, 0.017], [0.035, 0.022], [0.027, 0.026], [0.029, 0.031], [0.023, 0.035], [0.02, 0.039], [0.017, 0.042]];
  cloth.push(P(lathe(bel, 18), COL.rub, 0.34, -0.343, -0.12));
  armor.push(P(cylY(0.022, 0.024, 0.007, 14), COL.chrome, 0.34, -0.3, -0.12));
  teal.push(P(torusY(0.062, 0.002, 24), COL.teal, 0.34, -0.340, -0.12));
  // tritium dots (visible in the dark)
  const dot = (x, y, z, c) => trit.push(P(sph(0.0045, 5, 4), c, x, y, z));
  const G = 0x80ffb0, A = 0xffa030;
  for (let i = 0; i < 7; i++) { dot(-0.395, -0.343, -0.27 + i * 0.065, G); dot(0.395, -0.343, -0.27 + i * 0.065, i % 3 === 0 ? A : G); }
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; dot(0.34 + Math.cos(a) * 0.063, -0.336, -0.12 + Math.sin(a) * 0.063, G); }
  for (const [x, z] of [[-0.41, -0.29], [-0.27, -0.29], [-0.41, -0.235], [-0.27, -0.235]]) dot(x, -0.338, z, G);
  dot(-0.29, -0.337, -0.20, A); dot(-0.27, -0.337, -0.17, G);
  // a few illuminated pushbuttons (small cluster)
  const led = (x, z, c) => leds.push(P(RB(0.014, 0.006, 0.014, 0.003), c, x, -0.339, z));
  led(-0.39, -0.12, 0x20ff70); led(-0.39, -0.08, 0xff9a10); led(0.37, -0.02, 0xff2010); led(0.31, -0.02, 0x20ff70);
  // the whole console is 5 cm lower than r3 (stick base just above the knee line); cockpit.js moves the grips to match
  for (const l of [armor, cloth, teal, trit, leds]) for (const g of l) g.translate(0, -0.05, 0);
  return { armor, cloth, teal, trit, leds };
}

// ================================================================= GRIPS, GLOVES, FOREARMS, TOGGLE
// right stick grip (origin = pivot on the console). returns { cloth, armor, leds }
export function stickParts() {
  const cloth = [], armor = [], leds = [];
  armor.push(P(cylY(0.011, 0.013, 0.07, 10), COL.arm3, 0, 0.035, 0));
  armor.push(P(cylY(0.016, 0.016, 0.01, 12), COL.chrome, 0, 0.07, 0));
  // sculpted grip: lathe body with finger swells
  const prof = [[0.012, 0.07], [0.021, 0.082], [0.025, 0.105], [0.022, 0.125], [0.025, 0.145], [0.022, 0.165], [0.026, 0.185], [0.021, 0.2], [0.012, 0.208], [0.0, 0.21]];
  cloth.push(P(lathe(prof, 14), 0x2a2f33, 0, 0, 0));
  armor.push(P(torusY(0.0235, 0.0018, 14), COL.dark, 0, 0.132, 0), P(torusY(0.0235, 0.0018, 14), COL.dark, 0, 0.155, 0));
  // thumb-side housing with hat switch and buttons, trigger guard
  armor.push(P(RB(0.026, 0.045, 0.03, 0.01), COL.arm2, 0.0, 0.185, -0.012));
  armor.push(P(cylY(0.008, 0.009, 0.01, 10), COL.arm3, 0, 0.212, -0.006));
  leds.push(P(cylY(0.0055, 0.0055, 0.008, 8), 0xdd2211, -0.012, 0.2, -0.024, -0.5, 0, 0));
  leds.push(P(cylY(0.0045, 0.0045, 0.006, 8), COL.amber, 0.01, 0.198, -0.026, -0.5, 0, 0));
  leds.push(P(cylY(0.0045, 0.0045, 0.006, 8), COL.green, 0.0, 0.19, -0.03, -1.0, 0, 0));
  armor.push(P(RB(0.016, 0.03, 0.012, 0.005, 1), COL.arm3, 0.03, 0.11, 0.0));                  // thumb rest
  armor.push(P(RB(0.008, 0.04, 0.03, 0.003), COL.arm3, 0, 0.14, -0.026));                      // trigger guard rail
  return { cloth, armor, leds };
}
export const triggerParts = () => [P(RB(0.012, 0.032, 0.014, 0.005), 0x555a60, 0, -0.015, -0.004)];

export function throttleParts() {
  const armor = [], cloth = [], leds = [];
  armor.push(P(cylY(0.011, 0.013, 0.07, 10), COL.chrome, 0, 0.035, 0));
  cloth.push(P(RB(0.038, 0.078, 0.052, 0.016), 0x2a2f33, 0, 0.14, 0));
  armor.push(P(RB(0.04, 0.012, 0.054, 0.005), COL.arm2, 0, 0.098, 0));
  armor.push(P(RB(0.02, 0.016, 0.014, 0.005), COL.arm3, 0.0, 0.185, -0.012));
  leds.push(P(sph(0.0075, 8, 6), 0xdd2211, 0, 0.18, -0.02));
  leds.push(P(cylY(0.004, 0.004, 0.005, 8), COL.green, 0.012, 0.172, -0.026, -1.2, 0, 0));
  return { armor, cloth, leds };
}

// gloved hand around a grip: a small fist (ref 08 / 14). side = +1 right, -1 left. Origin matches the grip pivot.
export function handParts(side, y0) {
  const G = COL.glove, D = COL.gloveDark, L = [];
  L.push(P(RB(0.028, 0.044, 0.022, 0.009), G, 0, y0, 0.03));                                   // back of hand
  L.push(P(RB(0.022, 0.008, 0.015, 0.004), D, 0, y0 + 0.008, 0.043));                          // knuckle guard
  for (let i = 0; i < 4; i++) {
    const y = y0 - 0.02 + i * 0.0135, w = i === 3 ? 0.034 : 0.04;
    L.push(capsule([-w / 2 + 0.006, y, -0.021], [w / 2 - 0.006, y, -0.021], 0.0054, G, 6, 1));      // finger wraps the grip
    L.push(capsule([0, y, 0.012], [0, y, -0.016], 0.005, G, 5, 1));                                // proximal phalanx
  }
  L.push(capsule([-side * 0.015, y0 + 0.018, 0.016], [-side * 0.018, y0 + 0.03, -0.014], 0.0062, G, 8, 2));   // thumb
  L.push(P(cylZ(0.0165, 0.02, 12), COL.cuff, 0, y0 - 0.028, 0.055));                            // suit cuff
  L.push(P(cylZ(0.0185, 0.006, 12), 0x8a90a8, 0, y0 - 0.028, 0.068));                            // seal ring
  return L;
}

// ================================================================= PEDALS (local to the pedal pivot)
export function pedalPadParts(sx) {
  const cloth = [], armor = [], teal = [];
  const { arm, arm2, arm3, rub } = COL;
  // angled tread plate
  armor.push(P(plateXZ([[-0.06, 0.06], [0.06, 0.06], [0.062, -0.14], [0.045, -0.185], [-0.045, -0.185], [-0.062, -0.14]], 0.012, -0.012, 0.006), arm2, 0, 0, 0));
  for (let i = 0; i < 6; i++) cloth.push(P(RB(0.1, 0.007, 0.013, 0.003), rub, 0, 0.0, -0.17 + i * 0.03 + 0.0));
  for (const s of [-1, 1]) {
    armor.push(P(RB(0.01, 0.034, 0.24, 0.004), arm, s * 0.064, 0.005, -0.06));
    armor.push(P(BX(0.004, 0.004, 0.17), COL.teal, s * 0.064, 0.024, -0.06));
  }
  armor.push(P(RB(0.12, 0.05, 0.02, 0.008), arm3, 0, 0.012, 0.07));                              // heel stop
  // boot: light grey suit boot with a dark sole, purple toe cap and ankle cuff
  const BOOT = COL.boot;
  cloth.push(P(RB(0.1, 0.022, 0.275, 0.01), COL.sole, 0, 0.032, -0.03));
  cloth.push(P(RB(0.092, 0.05, 0.14, 0.024, 2), BOOT, 0, 0.073, 0.02));
  cloth.push(P(sph(1, 12, 8), COL.purple, 0, 0.058, -0.155, 0, 0, 0, 0.047, 0.032, 0.085));
  cloth.push(P(cylY(0.043, 0.048, 0.07, 12), BOOT, 0, 0.13, 0.06, 0.35, 0, 0));
  cloth.push(P(cylY(0.047, 0.047, 0.014, 12), COL.purple, 0, 0.165, 0.045, 0.35, 0, 0));        // ankle cuff
  armor.push(P(RB(0.088, 0.012, 0.1, 0.005), COL.suit2, 0, 0.098, -0.075, -0.15, 0, 0));          // lace plate
  armor.push(P(BX(0.012, 0.012, 0.012), COL.teal, 0, 0.1, -0.075, -0.15, 0, 0));
  return { cloth, armor, teal };
}
export function pedalFrameParts(sx) {
  const armor = [], teal = [];
  armor.push(P(cylX(0.02, 0.15, 12), COL.arm2, 0, -0.03, 0.06));
  armor.push(P(RB(0.15, 0.03, 0.06, 0.012), COL.arm, 0, -0.045, 0.05));
  armor.push(P(RB(0.03, 0.12, 0.04, 0.012), COL.arm2, sx * 0.075, 0.02, 0.08));
  armor.push(capsule([-sx * 0.04, -0.045, 0.06], [-sx * 0.04, 0.06, 0.2], 0.008, COL.chrome, 6, 2));   // actuator rod
  return { armor, teal };
}

// ================================================================= harness clamps
export function clampParts(sx) {
  const armor = [], cloth = [];
  cloth.push(P(RB(0.055, 0.032, 0.17, 0.014), 0x2a3034, -sx * 0.055, 0.0, -0.085, 0, sx * 0.25, 0));
  armor.push(P(RB(0.032, 0.032, 0.04, 0.01), 0x4a525c, -sx * 0.095, 0.0, -0.17));
  armor.push(P(BX(0.034, 0.003, 0.004), 0x9aa0bd, -sx * 0.095, 0.017, -0.17));
  cloth.push(P(RB(0.022, 0.007, 0.11, 0.003), 0xd8731a, -sx * 0.055, -0.02, -0.15));
  armor.push(P(RB(0.03, 0.05, 0.045, 0.012), COL.arm2, 0, -0.01, 0.0));
  armor.push(P(BX(0.004, 0.004, 0.03), COL.teal, -sx * 0.095, 0.022, -0.17));
  return { armor, cloth };
}
