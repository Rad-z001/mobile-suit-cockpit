// Procedural low-poly silhouettes. CR-002 item 11: ship builders return { body, parts: { name: geometry } } where the
// body and each part are separate merged BufferGeometries with vertex colours, all in the SAME model space (no
// re-centring), so drawing them together reproduces the whole ship. Missiles stay one geometry.
// Model space: forward = -Z (nose/head), +Y up, +Z is the tail where the thrusters point.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MODEL_BASE_SCALE } from '../sim/tuning.js';
import { PENELOPE_MESH } from './models/penelopeMesh.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
export const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
// cylinder whose axis is Z (the +Z end is the "top" radius rt)
export const Cz = (rt, rb, len, seg = 8) => { const g = new THREE.CylinderGeometry(rt, rb, len, seg); g.rotateX(Math.PI / 2); return g; };
// cone pointing toward -Z
export const ConeFwd = (r, len, seg = 8) => { const g = new THREE.ConeGeometry(r, len, seg); g.rotateX(-Math.PI / 2); return g; };
export const S = (r, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs);
export const merge = (list) => mergeGeometries(list, false);

// swept wing: box whose z grows with |x| (sweep back)
function wing(span, thick, chord, sweep) {
  const g = new THREE.BoxGeometry(span, thick, chord);
  g.translate(span / 2, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + sweep * p.getX(i));
  g.computeVertexNormals();
  return g;
}
function mirroredWing(side, span, thick, chord, sweep) {
  const g = wing(span, thick, chord, sweep);
  if (side < 0) g.scale(-1, 1, 1);          // mirrors (flips winding; fixed below)
  if (side < 0) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Gustav Karl (FD-03-00 sheet, assets/images/18_gustav_karl_front_back_reference.webp): a heavy upright humanoid, ~19 model
// units tall, standing on the model Y axis and facing -Z. The sheet's front view is mirrored: the suit's RIGHT arm
// (beam rifle) is +X and its LEFT arm (big curved shield + shield missile pod) is -X. Model origin = mid body height.
// Nominal bounding radius 10 m. scale = drawn size per model unit before MODEL_SCALE (MODEL_BASE_SCALE.gustav in
// sim/tuning.js, shared with the hit boxes there).
// Parts (state names): head (helmet + antenna), gunArm (right shoulder, arm, beam rifle), pod (left shoulder, arm,
// shield, shield missile pod), thrusters (backpack with 3 nozzles + red cap, two leg-rear thrusters). body = the rest.
// Every part stays in model space (no re-centring). Colours are vertex colours (the toon material reads them).
// Design record: docs/models/gustav/ (spec, review renders).
export const GUSTAV = {
  nominal: 10, baseScale: MODEL_BASE_SCALE.gustav,
  // [x, y, z, plume radius, plume length, part]; the plume starts on the real nozzle mouth and points +Z (backwards).
  nozzles: [
    [-1.3, 4.9, 4.05, 0.75, 12, 'thrusters'], [0.4, 4.4, 4.05, 0.75, 12, 'thrusters'], [-2.8, 4.2, 3.75, 0.55, 9, 'thrusters'],
    [-3.0, -6.7, 3.05, 0.42, 7, 'thrusters'], [3.0, -6.7, 3.05, 0.42, 7, 'thrusters'],
  ],
};
// Palette sampled from the reference sheet (nudged a little brighter/bluer: the toon shader warms and darkens lit faces).
export const GUSTAV_COLORS = {
  blueA: 0x7eaad8, blueB: 0x6890c4, navy: 0x3a5a94, navyDeep: 0x2b4575,
  yellow: 0xbfae78, red: 0xb83a3c, visor: 0xff63b4, visorHalo: 0xff95cc, grey: 0x9aa5b1, greyDark: 0x333840, joint: 0x2f3338,
  white: 0xe8f0f8, gold: 0xc9a85a, black: 0x14161a,
};
// Chapter 3: the Oenbili rebels' old Gustav Karls, repainted in faded olive and sand, green visors
export const REBEL_COLORS = {
  ...GUSTAV_COLORS,
  blueA: 0xa59c70, blueB: 0x8e875f, navy: 0x5f6044, navyDeep: 0x47482f, red: 0x9a4a30, visor: 0x7dff9c, visorHalo: 0xb6ffc8,
};
// ---- hard-surface helpers (all non-indexed so every flat face keeps its own normal) ----
const flat = (g) => (g.index ? g.toNonIndexed() : g);
const gp = (geo, color, ...rest) => part(flat(geo), color, ...rest);
// chamfered box: w (X) x h (Y) x d (Z), 45-degree chamfer c on every edge
function CB(w, h, d, c = 0.14) {
  const cc = Math.min(c, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
  const sh = new THREE.Shape();
  const hw = w / 2 - cc, hh = h / 2 - cc;
  sh.moveTo(-hw, -hh); sh.lineTo(hw, -hh); sh.lineTo(hw, hh); sh.lineTo(-hw, hh); sh.closePath();
  const dep = Math.max(d - 2 * cc, 0.01);
  const g = new THREE.ExtrudeGeometry(sh, { depth: dep, bevelEnabled: true, bevelThickness: cc, bevelSize: cc, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -dep / 2);
  return g;
}
// flat polygon prism in XY, extruded along Z (centred)
function prism(pts, depth) {
  const sh = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}
// faceted egg: low-segment sphere scaled to radii (rx, ry, rz), flat shaded
function egg(rx, ry, rz, seg = 8, rings = 6) {
  const g = new THREE.SphereGeometry(1, seg, rings).toNonIndexed();
  g.scale(rx, ry, rz); g.computeVertexNormals();
  return g;
}
// polygon given as (x, z) points, extruded along Y (centred): top-down footprints (feet)
function plan(pts, height) { const g = prism(pts, height); g.rotateX(Math.PI / 2); return g; }
const Cx = (r, len, seg = 8) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); return g; };
const Cy = (rt, rb, len, seg = 8) => new THREE.CylinderGeometry(rt, rb, len, seg);
const mergeFlat = (list) => mergeGeometries(list.map(flat), false);

export function buildGustav(palette = GUSTAV_COLORS) {
  const C = palette;
  const body = [], head = [], gunArm = [], pod = [], thr = [];
  const B_ = (arr, w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0, c = 0.14) => arr.push(gp(CB(w, h, d, c), color, x, y, z, rx, ry, rz));
  const PLAIN = (arr, w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0) => arr.push(gp(B(w, h, d), color, x, y, z, rx, ry, rz));
  const EGG = (arr, rx, ry, rz, color, x, y, z, seg, rings, rx2 = 0, ry2 = 0, rz2 = 0) => arr.push(gp(egg(rx, ry, rz, seg, rings), color, x, y, z, rx2, ry2, rz2));

  // ---------------- BODY: torso, waist, legs ----------------
  B_(body, 3.9, 3.4, 3.0, C.navy, 0, 5.1, -0.1, 0, 0, 0, 0.4);                    // chest block (dark navy), narrower than the shoulders
  B_(body, 3.0, 1.0, 1.7, C.navyDeep, 0, 7.0, -0.35, 0.28, 0, 0, 0.18);            // upper chest / collar slope
  B_(body, 1.55, 3.1, 0.9, C.red, 0, 3.9, -1.75, 0, 0, 0, 0.22);                   // red cockpit block, runs down into the abdomen
  B_(body, 1.9, 0.5, 0.5, C.navyDeep, 0, 6.2, -1.7, 0, 0, 0, 0.1);                 // chin plate over the cockpit
  for (const sx of [-1, 1]) {
    B_(body, 1.3, 1.15, 0.7, C.yellow, sx * 1.4, 4.95, -1.62, 0, 0, 0, 0.14);      // yellow chest vents
    for (let i = 0; i < 2; i++) PLAIN(body, 0.95, 0.1, 0.08, C.navyDeep, sx * 1.4, 4.75 + i * 0.3, -2.0);   // vent slits
    B_(body, 1.3, 0.3, 1.2, C.yellow, sx * 1.3, 6.95, -0.8, 0.22, 0, sx * -0.14, 0.06); // yellow collar trim
    B_(body, 1.0, 2.5, 2.5, C.blueB, sx * 2.25, 5.15, 0, 0, 0, 0, 0.25);           // side chest / shoulder mount plates
    PLAIN(body, 0.06, 1.7, 0.1, C.navyDeep, sx * 2.78, 5.15, -0.9);                  // panel line
  }
  body.push(gp(Cy(0.55, 0.65, 0.7, 8), C.joint, 0, 7.0, 0));                       // neck
  B_(body, 2.5, 1.6, 2.3, C.joint, 0, 2.3, 0, 0, 0, 0, 0.3);                       // abdomen joint (dark grey)
  B_(body, 4.4, 1.7, 3.0, C.blueB, 0, 0.95, 0, 0, 0, 0, 0.35);                     // pelvis
  B_(body, 4.5, 3.0, 1.2, C.navy, 0, 1.55, 1.95, 0, 0, 0, 0.35);                   // big rear waist armour (dark navy)
  for (const sx of [-1, 1]) {
    body.push(gp(prism([[-0.5, 0.4], [0.5, 0.4], [0.7, 0], [0.5, -0.4], [-0.5, -0.4], [-0.7, 0]], 0.08), C.navyDeep, sx * 1.1, 1.9, 2.58)); // hex recesses
  }
  B_(body, 0.5, 0.5, 0.12, C.grey, 0, 1.1, 2.6, 0, 0, Math.PI / 4, 0.04);          // rear emblem
  for (const sx of [-1, 1]) {
    // waist skirt, thigh armour
    B_(body, 2.0, 2.7, 0.8, C.blueA, sx * 1.35, 0.8, -1.8, 0.05, 0, sx * 0.06, 0.28); // front skirt plates
    PLAIN(body, 1.3, 0.07, 0.08, C.navyDeep, sx * 1.35, 1.2, -2.22);                  // panel lines on the skirt
    B_(body, 1.5, 0.65, 0.55, C.yellow, sx * 1.0, -0.65, -2.0, 0, 0, sx * 0.1, 0.12); // yellow plate under the skirt
    B_(body, 0.7, 2.1, 2.6, C.blueB, sx * 2.6, 0.7, 0, 0, 0, 0, 0.2);                // side skirt plates
    body.push(gp(Cz(0.65, 0.65, 2.4, 8), C.joint, sx * 2.0, 0.1, 0));                // hip joint
    B_(body, 2.9, 3.2, 2.8, C.blueB, sx * 2.5, -1.0, 0, 0, 0, 0, 0.5);               // thigh
    B_(body, 2.0, 2.4, 0.6, C.blueA, sx * 2.6, -0.3, -1.6, 0.05, 0, 0, 0.3);         // thigh front armour plate
    body.push(gp(prism([[-0.6, 1.3], [0.6, 1.3], [0.95, 0], [0.6, -1.3], [-0.6, -1.3], [-0.95, 0]], 0.6), C.navy, sx * 2.95, -1.3, -1.95));    // knee pad (navy)
    body.push(gp(Cz(0.62, 0.62, 0.3, 10), C.grey, sx * 1.55, -1.55, -1.55));         // knee joint disc
    PLAIN(body, 0.6, 0.1, 0.08, C.joint, sx * 1.55, -1.55, -1.72, 0, 0, 0.5);        // disc slot
    // lower leg: big egg, cuff, layered plates, side fins, tapering pointed foot
    EGG(body, 2.0, 3.0, 2.1, C.blueB, sx * 3.0, -4.7, 0.1, 8, 6);
    B_(body, 3.5, 1.0, 3.3, C.blueA, sx * 3.0, -2.2, 0, 0, 0, 0, 0.45);              // calf cuff
    B_(body, 2.7, 2.2, 0.7, C.blueA, sx * 3.0, -3.5, -1.95, 0.1, 0, 0, 0.35);        // upper shin plate
    B_(body, 2.3, 2.0, 0.6, C.blueB, sx * 3.0, -5.7, -1.8, -0.15, 0, 0, 0.3);        // lower shin plate
    PLAIN(body, 3.4, 0.08, 0.1, C.navyDeep, sx * 3.0, -4.55, -2.18);                  // plate seam
    B_(body, 0.55, 2.6, 1.8, C.blueA, sx * 4.9, -4.7, -0.3, 0, 0, sx * -0.12, 0.2);  // outer side armour
    B_(body, 0.5, 1.6, 1.2, C.blueA, sx * 1.15, -5.0, 0, 0, 0, sx * 0.1, 0.15);      // inner side armour
    body.push(gp(plan([[-1.7, 2.0], [1.7, 2.0], [1.85, -0.5], [0.9, -3.2], [0, -3.9], [-0.9, -3.2], [-1.85, -0.5]], 1.0), C.navyDeep, sx * 3.0, -8.0, -0.6)); // foot, pointed toe
    body.push(gp(plan([[-1.5, 1.2], [1.5, 1.2], [1.6, -0.2], [0.75, -2.6], [0, -3.2], [-0.75, -2.6], [-1.6, -0.2]], 0.7), C.blueA, sx * 3.0, -7.35, -0.85, 0.12, 0, 0)); // toe cover
  }

  // ---------------- HEAD: helmet, visor, antenna ----------------
  EGG(head, 1.4, 1.3, 1.5, C.blueA, 0, 8.4, 0.05, 8, 6);                            // round helmet
  B_(head, 1.9, 1.35, 1.4, C.blueB, 0, 7.85, -1.0, 0, 0, 0, 0.25);                 // face block
  B_(head, 2.15, 0.5, 0.12, C.visorHalo, 0, 8.1, -1.74, 0, 0, 0, 0.04);             // visor glow halo (wider, paler pink)
  B_(head, 1.8, 0.3, 0.2, C.visor, 0, 8.1, -1.82, 0, 0, 0, 0.05);                   // pink visor slit
  B_(head, 0.2, 0.6, 0.15, C.red, 0, 8.9, -1.35, 0, 0, 0, 0.04);                    // forehead mark
  B_(head, 0.5, 0.65, 0.4, C.red, 0, 7.2, -1.35, 0.2, 0, 0, 0.08);                  // chin vulcan
  for (const sx of [-1, 1]) B_(head, 0.6, 1.2, 1.5, C.blueB, sx * 1.3, 8.0, 0.2, 0, 0, 0, 0.18); // cheek / ear blocks
  B_(head, 1.7, 0.5, 1.0, C.blueB, 0, 7.3, 0.6, 0, 0, 0, 0.12);                     // rear neck guard
  PLAIN(head, 0.07, 0.8, 0.1, C.navyDeep, 0, 9.4, -1.0, 0.7);                        // crest line
  head.push(gp(Cy(0.07, 0.1, 2.6, 5), C.greyDark, -0.9, 9.9, 0.8, 0, 0, 0.3));    // rear whip antenna

  // ---------------- GUN ARM: right arm + beam rifle (+X) ----------------
  EGG(gunArm, 1.95, 1.65, 1.95, C.blueB, 3.9, 6.05, 0.1, 8, 5);                     // big rounded shoulder armour
  B_(gunArm, 2.6, 0.5, 2.6, C.blueA, 3.9, 7.4, 0.1, 0, 0, 0, 0.2);                  // shoulder cap
  gunArm.push(gp(prism([[-1.1, 1.0], [0.95, 1.1], [1.3, -0.15], [0.45, -1.15], [-1.1, -0.95]], 0.5).rotateY(Math.PI / 2), C.navy, 5.7, 6.1, 0)); // navy inset pad
  B_(gunArm, 0.9, 0.4, 1.2, C.yellow, 3.0, 7.75, 0.8, 0, 0, 0, 0.06);               // yellow shoulder trim
  B_(gunArm, 2.0, 2.7, 2.0, C.blueA, 4.0, 3.95, 0, 0, 0, 0, 0.4);                   // upper arm
  gunArm.push(gp(Cx(0.75, 1.9, 8), C.joint, 4.0, 2.45, 0));                          // elbow
  B_(gunArm, 2.4, 2.5, 2.4, C.blueB, 4.05, 1.25, -0.1, 0, 0, 0, 0.4);              // forearm block
  B_(gunArm, 1.9, 1.5, 0.4, C.blueA, 4.05, 1.5, -1.45, 0, 0, 0, 0.15);             // forearm front plate
  B_(gunArm, 1.4, 1.2, 1.5, C.joint, 4.05, -0.4, -0.2, 0, 0, 0, 0.2);              // fist
  B_(gunArm, 1.0, 1.3, 3.2, C.blueB, 4.05, -0.05, -1.5, 0, 0, 0, 0.2);             // rifle receiver
  PLAIN(gunArm, 0.25, 0.35, 1.3, C.yellow, 4.05, 0.8, -1.5);                         // sight
  B_(gunArm, 0.8, 0.7, 1.1, C.greyDark, 4.05, -0.9, -2.2, 0, 0, 0, 0.1);           // E-pack
  gunArm.push(gp(Cz(0.3, 0.3, 4.2, 8), C.greyDark, 4.05, 0.0, -5.2));              // barrel
  gunArm.push(gp(Cz(0.42, 0.42, 0.5, 8), C.grey, 4.05, 0.0, -7.3));                // muzzle

  // ---------------- POD: left arm, curved shield, shield missile pod (-X) ----------------
  EGG(pod, 2.1, 1.8, 2.1, C.blueB, -3.9, 6.05, 0.1, 8, 5);                          // larger rounded shoulder armour
  B_(pod, 2.8, 0.5, 2.8, C.blueA, -3.9, 7.5, 0.1, 0, 0, 0, 0.2);
  pod.push(gp(prism([[-1.2, 1.1], [1.05, 1.2], [1.45, -0.15], [0.5, -1.25], [-1.2, -1.05]], 0.55).rotateY(Math.PI / 2), C.navy, -5.9, 6.1, 0)); // navy inset pad
  B_(pod, 0.9, 0.4, 1.2, C.yellow, -2.9, 7.85, 0.8, 0, 0, 0, 0.06);
  B_(pod, 2.0, 2.7, 2.0, C.blueA, -4.0, 3.95, 0, 0, 0, 0, 0.4);                     // upper arm
  B_(pod, 0.4, 1.9, 1.6, C.grey, -5.15, 4.0, -0.2, 0, 0, 0, 0.06);                 // grey vented plate
  for (let i = 0; i < 3; i++) PLAIN(pod, 0.1, 0.12, 1.1, C.greyDark, -5.37, 3.5 + i * 0.5, -0.2);
  pod.push(gp(Cx(0.75, 1.9, 8), C.joint, -4.0, 2.45, 0));
  B_(pod, 2.5, 2.6, 2.5, C.blueB, -4.0, 1.25, -0.1, 0, 0, 0, 0.4);                 // heavy forearm block
  B_(pod, 1.9, 1.5, 0.4, C.blueA, -4.0, 1.5, -1.5, 0, 0, 0, 0.15);
  B_(pod, 0.4, 1.0, 1.6, C.grey, -5.4, 1.4, -0.1, 0, 0, 0, 0.06);
  B_(pod, 1.4, 1.2, 1.5, C.joint, -4.0, -0.4, -0.3, 0, 0, 0, 0.2);                 // fist
  // shield (torso to above the head): seven boxes follow a deeper curve in the XY plane, bowing outward, hooking inward at the top
  const path = [[-5.5, -1.9], [-6.2, 0.2], [-6.65, 2.7], [-6.4, 5.4], [-5.6, 7.7], [-4.2, 9.2], [-2.9, 9.0], [-2.3, 8.3]];
  const th = 1.4, dep = 3.8, zc = 0.3;
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0] = path[i], [x1, y1] = path[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    B_(pod, L + 0.14, th, dep, i % 2 ? 0x73a0d0 : C.blueA, mx, my, zc, 0, 0, a, 0.3);
    const nx = Math.sin(a), ny = -Math.cos(a);                                       // inward normal (+X side)
    pod.push(gp(B(L, 0.1, dep - 0.6), C.greyDark, mx + nx * (th / 2 + 0.04), my + ny * (th / 2 + 0.04), zc, 0, 0, a)); // dark inner liner
    const ox = -nx, oy = -ny;                                                        // outer face: navy rim strip on the front edge
    pod.push(gp(B(L * 0.8, th * 0.55, 0.1), C.navy, mx + ox * 0.12, my + oy * 0.12, zc - dep / 2 - 0.02, 0, 0, a));
  }
  B_(pod, 0.8, 0.6, 0.6, C.blueA, -5.7, -2.0, zc - 0.5 * dep + 0.35, 0, 0, -0.3, 0.08); // fork prongs at the bottom
  B_(pod, 0.8, 0.6, 0.6, C.blueA, -5.7, -2.0, zc + 0.5 * dep - 0.35, 0, 0, -0.3, 0.08);
  // white emblem: four-point star on the shield's front (-Z) face
  const star = prism([[0, 2.4], [0.25, 0.3], [0.8, 0], [0.25, -0.3], [0, -2.4], [-0.25, -0.3], [-0.8, 0], [-0.25, 0.3]], 0.05);
  pod.push(gp(star, C.white, -6.55, 4.0, zc - dep / 2 - 0.08, 0, 0, 0.05));
  // grip bracket arm: shield to forearm (dark grey)
  B_(pod, 1.2, 0.5, 0.7, C.joint, -5.55, 2.5, 0.7, 0, 0, 0, 0.08);
  B_(pod, 1.2, 0.5, 0.7, C.joint, -5.55, 5.0, 0.7, 0, 0, 0, 0.08);
  // missile pod on the shield's outer face: a launcher block with three round tubes facing forward
  B_(pod, 1.0, 2.0, 2.4, C.blueB, -7.7, 1.2, 0.3, 0, 0, 0, 0.12);
  B_(pod, 0.9, 0.3, 2.5, C.navy, -7.7, 2.3, 0.3, 0, 0, 0, 0.06);
  for (let i = -1; i <= 1; i++) {
    pod.push(gp(Cz(0.27, 0.27, 0.12, 6), C.black, -7.7, 1.2 + i * 0.6, -0.93));
    pod.push(gp(Cz(0.17, 0.17, 0.14, 6), C.red, -7.7, 1.2 + i * 0.6, -0.96));
  }

  // ---------------- THRUSTERS: backpack (2 big + 1 small nozzle, red cap) and leg-rear thrusters ----------------
  B_(thr, 3.6, 3.3, 1.7, C.blueA, -0.1, 5.2, 2.35, 0, 0, 0, 0.3);                  // backpack
  B_(thr, 1.4, 0.5, 0.9, C.blueB, 1.0, 7.0, 2.2, 0, 0, 0, 0.1);                    // upper back vent housing
  PLAIN(thr, 1.0, 0.1, 0.1, C.navyDeep, 1.0, 7.05, 2.68);
  PLAIN(thr, 1.0, 0.1, 0.1, C.navyDeep, 1.0, 6.85, 2.68);
  B_(thr, 1.3, 1.2, 0.8, C.navy, 1.45, 3.9, 2.9, 0, 0, 0, 0.12);                    // lower-right backpack block
  const noz = (x, y, z, r) => {                                                      // nozzle: bell + gold ring + dark core
    thr.push(gp(Cz(r, r * 0.85, 0.95, 8), C.greyDark, x, y, z - 0.45));
    thr.push(gp(Cz(r * 0.8, r * 0.8, 0.1, 8), C.gold, x, y, z + 0.02));
    thr.push(gp(Cz(r * 0.6, r * 0.6, 0.1, 8), C.black, x, y, z + 0.06));
  };
  noz(-1.3, 4.9, 3.95, 0.8); noz(0.4, 4.4, 3.95, 0.8); noz(-2.8, 4.2, 3.65, 0.6);
  thr.push(gp(Cy(0.6, 0.6, 0.4, 10), C.red, -2.0, 7.1, 2.5));                       // red round cap, upper left
  thr.push(gp(Cy(0.34, 0.34, 0.15, 8), 0x7a2426, -2.0, 7.35, 2.5));
  for (const sx of [-1, 1]) {
    B_(thr, 1.5, 3.4, 0.9, C.grey, sx * 3.0, -4.6, 2.5, 0, 0, 0, 0.14);            // leg-rear thruster pack
    noz(sx * 3.0, -6.7, 2.95, 0.45);                                                 // leg nozzle
  }
  PLAIN(thr, 0.12, 2.4, 0.08, C.greyDark, -3.0, -4.5, 2.98, 0, 0, 0.45);           // the X cover on the left pack
  PLAIN(thr, 0.12, 2.4, 0.08, C.greyDark, -3.0, -4.5, 2.98, 0, 0, -0.45);

  return { body: mergeFlat(body), parts: { head: mergeFlat(head), gunArm: mergeFlat(gunArm), pod: mergeFlat(pod), thrusters: mergeFlat(thr) } };
}

// Penelope: the owner's RX-104FF model (assets/models/penelope_src, baked by tools/prepare-models.py into
// models/penelopeMesh.js). MS form drawn at 1.0 model unit = 1 m of the source (bounding radius ~17.5, the old procedural
// ship's nominal radius was 18, so MODEL_BASE_SCALE.penelope and the sim's hit radius stay valid); flight form at 0.78
// (radius ~18). Both: +Y up, -Z forward, origin = bounding-box centre, beam rifle on +X (rifleArm), composite weapon on -X.
// Parts: head, rifleArm, salvoArm, wingPack (+ body = the rest). Vertex colour = Kd of the MTL; the `glow` attribute marks the
// emissive materials (eye, sensors) so the toon shader keeps them bright.
export const PENELOPE = {
  nominal: 18, baseScale: MODEL_BASE_SCALE.penelope,
  nozzles: [[-1.3, 2.6, 3.3, 0.9, 12, 'wingPack'], [1.3, 2.6, 3.3, 0.9, 12, 'wingPack'], [0, 4.6, 3.3, 0.8, 11, 'wingPack']],
};
export const PENELOPE_FLIGHT = {
  nominal: 18, baseScale: MODEL_BASE_SCALE.penelope,
  nozzles: [[-0.8, 0.5, 9.4, 1.0, 16, 'wingPack'], [0.8, 0.5, 9.4, 1.0, 16, 'wingPack']],
};
const PART_NAMES = ['body', 'head', 'rifleArm', 'salvoArm', 'wingPack'];
const b64bytes = (str) => { const bin = atob(str); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export function buildPenelope(form = 'ms') {
  const M = PENELOPE_MESH[form === 'flight' ? 'flight' : 'ms'];
  const pos16 = new Int16Array(b64bytes(M.pos).buffer), col8 = b64bytes(M.col), idx16 = new Uint16Array(b64bytes(M.idx).buffer);
  const pal = M.palette.map((p) => { const c = new THREE.Color().setRGB(p[0], p[1], p[2], THREE.SRGBColorSpace); return [c.r, c.g, c.b, p[3]]; });
  const out = {};
  let v0 = 0, t0 = 0;
  for (let k = 0; k < 5; k++) {
    const nv = M.vcount[k], nt = M.tcount[k];
    const P = new Float32Array(nv * 3), C = new Float32Array(nv * 3), G = new Float32Array(nv);
    for (let i = 0; i < nv; i++) {
      const j = v0 + i;
      P[i * 3] = (pos16[j * 3] / 32767) * M.ext[0]; P[i * 3 + 1] = (pos16[j * 3 + 1] / 32767) * M.ext[1]; P[i * 3 + 2] = (pos16[j * 3 + 2] / 32767) * M.ext[2];
      const c = pal[col8[j]];
      C[i * 3] = c[0]; C[i * 3 + 1] = c[1]; C[i * 3 + 2] = c[2]; G[i] = c[3];
    }
    const I = new Uint16Array(nt * 3);
    for (let i = 0; i < nt * 3; i++) I[i] = idx16[t0 * 3 + i] - v0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('glow', new THREE.BufferAttribute(G, 1));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    const f = g.toNonIndexed();
    f.computeVertexNormals();           // flat faces, like the other models
    out[PART_NAMES[k]] = f;
    v0 += nv; t0 += nt;
  }
  const { body, ...parts } = out;
  return { body, parts };
}

// Missile: ~4 m long. funnel = smaller, pink accent.
export function buildMissile(funnel) {
  const body = funnel ? 0xe8d8e8 : 0xcfd3d8, acc = funnel ? 0xd02a80 : 0x444a52;
  const P = [];
  P.push(part(Cz(0.22, 0.22, 4.0, 6), body));
  P.push(part(ConeFwd(0.22, 1.1, 6), acc, 0, 0, -2.5));
  P.push(part(Cz(0.16, 0.26, 0.4, 6), 0x222222, 0, 0, 2.1));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    P.push(part(B(0.05, 0.85, 0.7), acc, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 1.5, 0, 0, a + Math.PI / 2));
  }
  return merge(P);
}

// Smoothed-normal copy of a geometry for the inverted-hull outline (positions only, welded vertices).
export function outlineGeometry(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.index) g.setIndex(geo.index.clone());
  const w = mergeVertices(g, 1e-3);
  w.computeVertexNormals();
  return w;
}
// Centre + size of a geometry (model space), used for stumps, smoke and debris pivots.
export function geoBox(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  return { center: b.getCenter(new THREE.Vector3()), size: b.getSize(new THREE.Vector3()) };
}
