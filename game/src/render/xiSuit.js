// CR-005: the owner's Xi Gundam (assets/models/xi_game.glb, a Meshy AI model optimised to 25.6k triangles, one mesh, PBR
// textures) embedded as base64 (models/xiModel.js, made by tools/prepare-xi.mjs). Parsed ONCE with GLTFLoader, normalised to
// XI_MODEL_HEIGHT metres tall, origin at the bbox centre, facing -Z, and drawn with a small toon-ramp shader that keeps the
// base-colour / normal / metallic-roughness textures but takes the scene's sun, moon (night) and thermal state, so it sits in
// the same look as the other suits. Geometry + textures are shared by every instance (remote Xi pilots, your chase-view suit,
// the lobby preview).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XI_GLB_B64 } from './models/xiModel.js';
import { XI_MODEL_HEIGHT } from '../state.js';
import { toon } from './shaders.js';
import { part, B, Cz, merge } from './models.js';

// Which way the raw Meshy model faces (checked on the loaded mesh: see tools/preview-test.html). +Z means it must be turned.
const FACE_YAW = Math.PI;

let template = null, promise = null;
const waiters = [];

function b64ToBuffer(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

export const XI_TOON = {
  vertex: /* glsl */ `
    attribute float aArm;                     // CR-006: 1 on the right arm, fading to 0 under the shoulder armour
    uniform vec4 uArmQ; uniform vec3 uShoulder;
    varying vec3 vWN; varying vec3 vWV; varying vec2 vUv; varying vec3 vWP;
    vec3 qrot(vec4 q, vec3 v){ return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
    void main(){
      vec3 P = position, Nn = normal;
      if (aArm > 0.0) {                        // partial rotation about the shoulder (nlerp from identity): a bend, not a shear
        vec4 q = normalize(mix(vec4(0.0, 0.0, 0.0, 1.0), uArmQ, aArm));
        P = uShoulder + qrot(q, position - uShoulder); Nn = qrot(q, normal);
      }
      vec4 w = modelMatrix * vec4(P, 1.0);
      vWN = normalize(mat3(modelMatrix) * Nn);
      vWV = cameraPosition - w.xyz; vWP = w.xyz; vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragment: /* glsl */ `
    uniform sampler2D tBase, tNormal, tMR;
    uniform vec3 uSun; uniform float uNight, uThermal, uFlash, uDmg, uHeat, uTime;
    varying vec3 vWN; varying vec3 vWV; varying vec2 vUv; varying vec3 vWP;
    // normal mapping without tangents (screen-space derivatives)
    vec3 perturb(vec3 N, vec3 V, vec2 uv){
      vec3 dp1 = dFdx(-V), dp2 = dFdy(-V); vec2 du1 = dFdx(uv), du2 = dFdy(uv);
      vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
      vec3 T = dp2perp * du1.x + dp1perp * du2.x, B = dp2perp * du1.y + dp1perp * du2.y;
      float inv = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-12);
      vec3 m = texture2D(tNormal, uv).xyz * 2.0 - 1.0; m.xy *= 0.8;
      return normalize(mat3(T * inv, B * inv, N) * m);
    }
    void main(){
      vec3 V = normalize(vWV);
      vec3 N0 = normalize(vWN);
      if (!gl_FrontFacing) N0 = -N0;
      vec3 N = perturb(N0, vWV, vUv);
      vec3 alb = texture2D(tBase, vUv).rgb;
      vec2 mr = texture2D(tMR, vUv).gb;               // g = roughness, b = metalness
      float l = dot(N, uSun);
      float lit = smoothstep(0.02, 0.16, l);
      float mid = smoothstep(-0.48, -0.36, l);
      vec3 col = mix(alb * vec3(0.26, 0.30, 0.52), alb * vec3(0.58, 0.58, 0.76), mid);
      col = mix(col, alb * vec3(1.25, 1.0, 0.82), lit);
      float s = pow(max(dot(reflect(-uSun, N), V), 0.0), mix(60.0, 14.0, mr.x)) * (0.15 + 0.85 * mr.y);
      col += step(0.5, s) * vec3(1.0, 0.85, 0.6) * 0.5 * lit;
      float rim = smoothstep(0.62, 0.74, 1.0 - max(dot(N0, V), 0.0));
      col += vec3(0.20, 0.30, 0.65) * rim * (0.25 + 0.5 * (1.0 - lit));
      if (uNight > 0.001) {
        vec3 nc = alb * mix(vec3(0.15, 0.17, 0.24), vec3(0.66, 0.72, 0.88), lit) + vec3(0.12, 0.14, 0.20) * rim;
        nc += vec3(0.7, 0.78, 0.95) * step(0.5, s) * 0.3 * lit;
        col = mix(col, nc, uNight);
      }
      col = mix(col, col * vec3(0.30, 0.27, 0.26), uDmg);
      col += vec3(1.0, 0.85, 0.7) * uFlash;
      col = mix(col, vec3(0.5 + 0.42 * uHeat) * 0.55, uThermal);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Parse once. Returns a Promise resolving to the template { geometry, maps } (also cached for getXi()).
export function loadXi() {
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    new GLTFLoader().parse(b64ToBuffer(XI_GLB_B64), '', (gltf) => {
      let mesh = null;
      gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh) { reject(new Error('xi_game.glb has no mesh')); return; }
      mesh.updateWorldMatrix(true, false);
      const geo = mesh.geometry.clone();
      // KHR_mesh_quantization leaves normalised int attributes: expand to float BEFORE baking the node matrix (applyMatrix4 would clamp)
      for (const name of ['position', 'normal', 'uv']) {
        const at = geo.attributes[name];
        if (!at || at.array instanceof Float32Array) continue;
        const f = new Float32Array(at.count * at.itemSize);
        for (let i = 0; i < at.count; i++) { f[i * at.itemSize] = at.getX(i); f[i * at.itemSize + 1] = at.getY(i); if (at.itemSize > 2) f[i * at.itemSize + 2] = at.getZ(i); }
        geo.setAttribute(name, new THREE.BufferAttribute(f, at.itemSize));
      }
      geo.applyMatrix4(mesh.matrixWorld);                         // bake node transforms (quantization scale etc.)
      geo.computeBoundingBox();
      const bb = geo.boundingBox, size = new THREE.Vector3(), c = new THREE.Vector3();
      bb.getSize(size); bb.getCenter(c);
      geo.translate(-c.x, -c.y, -c.z);
      if (FACE_YAW) geo.rotateY(FACE_YAW);
      const k = XI_MODEL_HEIGHT / size.y;
      geo.scale(k, k, k);
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      const rig = buildArmRig(geo);
      const m = mesh.material;
      template = { rig, geometry: geo, base: m.map, normal: m.normalMap, mr: m.metalnessMap || m.roughnessMap, size: geo.boundingBox.getSize(new THREE.Vector3()) };
      for (const t of [template.base, template.normal, template.mr]) if (t) { t.anisotropy = 4; t.needsUpdate = true; }
      resolve(template);
      for (const w of waiters.splice(0)) w(template);
    }, reject);
  });
  return promise;
}
export const getXi = () => template;
export function onXiReady(fn) { if (template) fn(template); else { waiters.push(fn); loadXi(); } }

const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;
const flatN = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
flatN.needsUpdate = true;

// A drawable Xi: Mesh sharing the geometry + textures; `uniforms` are per-instance (heat, flash, damage) and the scene ones
// (sun, night, thermal) are shared objects passed in.
export function makeXiMesh(shared) {
  const t = template;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tBase: { value: t.base || white }, tNormal: { value: t.normal || flatN }, tMR: { value: t.mr || white },
      uSun: shared.sun, uNight: shared.night, uThermal: shared.thermal,
      uFlash: { value: 0 }, uDmg: { value: 0 }, uHeat: { value: 0.8 }, uTime: { value: 0 },
      uArmQ: { value: new THREE.Vector4(0, 0, 0, 1) }, uShoulder: { value: t.rig.shoulder },
    },
    vertexShader: XI_TOON.vertex, fragmentShader: XI_TOON.fragment,
  });
  const mesh = new THREE.Mesh(t.geometry, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ================================================================================================================================
// CR-006: beam rifle + the pose that holds it.
// The Meshy mesh is one fused, unrigged shell, so the right arm is found at load time by walking the surface from the right
// hand (geodesic distance over welded vertices): everything nearer than the shoulder cut is "arm" (attribute aArm, soft edge
// under the shoulder armour). The vertex shader rotates those vertices about the shoulder by one quaternion (uArmQ).
// Model space here = the normalised mesh (28 units tall, origin = bbox centre, facing -Z, +X = the suit's right).
// ================================================================================================================================
const HAND_SEED = [6.16, 0.23, -4.62];     // centre of the open right hand (measured on the mesh)
const SHOULDER = [4.85, 7.3, -1.9];        // shoulder joint, hidden under the shoulder armour
const ARM_DROP = 0.3;                      // rad: the arm points this far below the barrel line, so the rifle sits at chest height
const AIM_YAW = [-0.42, 0.75], AIM_PITCH = [-0.55, 0.55];   // rad: how far the rifle arm follows the crosshair (inward, outward / down, up)
// Where arm surface can be (the walk from the hand never leaves this zone): right of the torso, in front of the back plates,
// below the shoulder armour; the outer elbow guard (x >= 6.4) rises higher than the thin upper arm.
const armZone = (x, y, z) => x > 4.3 && z < -0.6 && z > -7 && !(x < 4.8 && y > 4.5 && y < 5.75) && (x >= 6.4 ? y < 8.5 : y < 7.9);
const armWeight = (x, y) => { if (x >= 6.4) return 1; const t = Math.min(1, Math.max(0, (y - 6.7) / 1.0)); return 1 - t * t * (3 - 2 * t); };

function buildArmRig(geo) {
  const p = geo.attributes.position, n = p.count, idx = geo.index ? geo.index.array : null;
  const rig = { ok: false, shoulder: new THREE.Vector3().fromArray(SHOULDER), hand: new THREE.Vector3().fromArray(HAND_SEED) };
  geo.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(n), 1));
  if (!idx) return rig;
  // weld by position (UV seams split vertices)
  const key = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.round(p.getX(i) * 500) + ',' + Math.round(p.getY(i) * 500) + ',' + Math.round(p.getZ(i) * 500);
    let r = key.get(k); if (r === undefined) { r = i; key.set(k, i); }
    rep[i] = r;
  }
  const adj = new Array(n);
  const link = (a, b) => { if (a === b) return; (adj[a] || (adj[a] = [])).push(b); (adj[b] || (adj[b] = [])).push(a); };
  for (let i = 0; i < idx.length; i += 3) { const a = rep[idx[i]], b = rep[idx[i + 1]], c = rep[idx[i + 2]]; link(a, b); link(b, c); link(a, c); }
  // flood the surface from the hand, staying inside armZone (Float64: a rounded-up Float32 distance would re-relax forever)
  const d = new Float64Array(n).fill(Infinity), heap = [];
  const push = (dv, v) => { heap.push([dv, v]); let i = heap.length - 1; while (i > 0) { const pa = (i - 1) >> 1; if (heap[pa][0] <= heap[i][0]) break; const t = heap[pa]; heap[pa] = heap[i]; heap[i] = t; i = pa; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === i) break; const t = heap[s]; heap[s] = heap[i]; heap[i] = t; i = s; } }
    return top;
  };
  let seeds = 0;
  for (let i = 0; i < n; i++) {
    if (rep[i] !== i || !adj[i]) continue;
    if (Math.hypot(p.getX(i) - HAND_SEED[0], p.getY(i) - HAND_SEED[1], p.getZ(i) - HAND_SEED[2]) < 0.5) { d[i] = 0; push(0, i); seeds++; }
  }
  if (!seeds) return rig;                                        // a different mesh: no arm pose, the rifle still sits at the hand
  while (heap.length) {
    const [dv, v] = pop();
    if (dv > d[v]) continue;
    for (const u of adj[v]) {
      if (!armZone(p.getX(u), p.getY(u), p.getZ(u))) continue;
      const nd = dv + Math.hypot(p.getX(v) - p.getX(u), p.getY(v) - p.getY(u), p.getZ(v) - p.getZ(u));
      if (nd < d[u]) { d[u] = nd; push(nd, u); }
    }
  }
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = d[rep[i]] < Infinity ? armWeight(p.getX(i), p.getY(i)) : 0;
  // Where the arm is fused to the body sideways, a triangle has arm and non-arm corners and would stretch into a shard when the
  // arm lifts. Give such triangles their own corner vertices with weight 0: they stay on the body, the arm tears away cleanly.
  const extra = [];                                               // source vertex of each added vertex
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    out[i] = a; out[i + 1] = b; out[i + 2] = c;
    const off = d[rep[a]] === Infinity || d[rep[b]] === Infinity || d[rep[c]] === Infinity;
    if (!off || Math.max(w[a], w[b], w[c]) < 0.25) continue;
    for (let k = 0; k < 3; k++) { out[i + k] = n + extra.length; extra.push(idx[i + k]); }
  }
  const m = n + extra.length;
  for (const name of Object.keys(geo.attributes)) {
    const at = geo.attributes[name]; if (name === 'aArm') continue;
    const arr = new Float32Array(m * at.itemSize);
    arr.set(at.array.subarray(0, n * at.itemSize));
    for (let j = 0; j < extra.length; j++) for (let k = 0; k < at.itemSize; k++) arr[(n + j) * at.itemSize + k] = at.array[extra[j] * at.itemSize + k];
    geo.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize));
  }
  const w2 = new Float32Array(m); w2.set(w);
  geo.setAttribute('aArm', new THREE.BufferAttribute(w2, 1));
  geo.setIndex(new THREE.BufferAttribute(out, 1));
  rig.ok = true;
  return rig;
}

// ---- beam rifle (built from the owner's reference photo). Local space: barrel along -Z, +Y up, origin = the grip in the hand ----
const RIFLE_SCALE = 1.2;
const RIFLE_Y = -0.55;                     // the whole rifle sits this much lower in the hand (the grip is gripped higher up)
const RIFLE_TIP = -10.4;                   // design units (before RIFLE_SCALE): front face of the muzzle brake
const RIFLE_BORE = 1.25;                   // design units: height of the barrel axis above the grip point
export const RIFLE_MUZZLE = new THREE.Vector3(0, RIFLE_BORE + RIFLE_Y, RIFLE_TIP).multiplyScalar(RIFLE_SCALE);
let rifleGeo = null;
// Rifle r2: hard-surface parts built from side profiles. prism(pts, w, b): the polygon pts = [[z, y], ...] (side view, design
// units) extruded across X to width w, every edge chamfered by b (bevelOffset keeps the outline at the given profile).
function prism(pts, w, b = 0.05, holes = null) {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  if (holes) for (const h of holes) s.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
  const d = Math.max(0.002, w - 2 * b);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -d / 2);
  g.rotateY(-Math.PI / 2);                  // shape x -> rifle z, extrusion -> rifle x
  return g;
}
// chamfered box centred on the origin (w across X, h up, d along Z)
const cbox = (w, h, d, b) => { const z = d / 2, y = h / 2; return prism([[-z + b, -y], [z - b, -y], [z, -y + b], [z, y - b], [z - b, y], [-z + b, y], [-z, y - b], [-z, -y + b]], w, b); };
const Cx = (r, len, seg = 8) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); return g; };
function buildRifle() {
  if (rifleGeo) return rifleGeo;
  // greys lean slightly cool: the toon shader warms the lit side
  const PALE = 0xdce2ec, LIGHT = 0xc6cdd9, MID2 = 0xadb4c1, MID = 0x979eab, FORE = 0x7c8290, DARK = 0x5d626e, DARK2 = 0x41444d, BLACK = 0x1c1e23;
  const GREEN = 0x3fe882, ACCENT = 0xd9a63a;
  const L = [];
  const add = (g, c, x = 0, y = 0, z = 0, rx = 0, glow = 0) => {
    const q = part(g.index ? g.toNonIndexed() : g, c, x, y, z, rx, 0, 0);
    if (q.attributes.uv) q.deleteAttribute('uv');
    q.computeVertexNormals();
    q.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count).fill(glow), 1));
    L.push(q); return q;
  };
  const Y0 = RIFLE_BORE;

  // ---- receiver (mid grey) with layered side panels, panel line and bolts
  add(prism([[1.0, 0.8], [1.0, 1.9], [-3.6, 1.9], [-3.6, 0.85], [-3.35, 0.55], [0.5, 0.55]], 0.9, 0.07), MID);
  add(prism([[-3.3, 0.95], [-3.3, 1.62], [-1.45, 1.62], [-1.2, 1.4], [-1.2, 0.95]], 0.98, 0.04), MID2);
  add(prism([[-1.0, 1.0], [-1.0, 1.62], [0.75, 1.62], [0.75, 1.2], [0.5, 1.0]], 0.98, 0.04), MID2);
  add(B(0.97, 0.05, 3.9), BLACK, 0, 0.82, -1.45);                                   // lower panel line
  for (const z of [-3.1, -1.5, -0.8, 0.55]) add(Cx(0.065, 1.03, 6), DARK, 0, 1.47, z);   // bolts (both sides)
  add(cbox(0.94, 0.5, 0.18, 0.04), DARK, 0, 1.3, 0.95);                             // rear cap

  // ---- upper shroud / sensor housing (pale), chamfered beak, dark slot, top rail, sensor block with green lens
  add(prism([[0.8, 1.85], [0.8, 2.4], [0.45, 2.75], [-2.6, 2.75], [-3.2, 2.62], [-4.8, 2.1], [-4.95, 1.95], [-4.8, 1.85]], 1.08, 0.08), LIGHT);
  add(prism([[-0.5, 2.15], [-3.0, 2.15], [-3.5, 2.38], [-0.5, 2.38]], 1.11, 0), BLACK);                 // side slot
  add(prism([[-0.75, 2.2], [-2.75, 2.2], [-3.05, 2.33], [-0.75, 2.33]], 1.115, 0), DARK);              // slot inner rib
  add(prism([[0.65, 1.84], [0.65, 1.95], [-4.75, 1.95], [-4.75, 1.84]], 1.1, 0), DARK2);               // shroud seam
  add(prism([[0.3, 2.72], [0.3, 2.86], [-2.4, 2.86], [-2.65, 2.72]], 0.72, 0.04), PALE);                // top plate
  for (const z of [0.05, -0.2, -0.45]) add(B(1.1, 0.1, 0.12), DARK2, 0, 2.55, z);                       // rear vents
  add(prism([[-0.75, 2.84], [-0.75, 2.96], [0.4, 2.96], [0.4, 2.84]], 0.42, 0.02), MID);              // rail
  for (const z of [-0.55, -0.3, -0.05, 0.2]) add(B(0.44, 0.05, 0.08), BLACK, 0, 2.95, z);
  add(prism([[-1.0, 2.8], [-1.0, 3.2], [-1.25, 3.36], [-2.4, 3.36], [-2.62, 3.18], [-2.62, 2.8]], 0.56, 0.05), PALE);   // sensor block
  add(B(0.58, 0.04, 1.2), DARK, 0, 3.08, -1.75);                                    // its panel line
  add(Cz(0.19, 0.19, 0.06, 10), DARK2, 0, 3.05, -2.63);                             // lens bezel
  add(Cz(0.13, 0.13, 0.06, 10), GREEN, 0, 3.05, -2.66, 0, 1);                       // sensor lens
  add(prism([[0.5, 2.74], [0.78, 2.74], [0.78, 3.02], [0.62, 3.1]], 0.3, 0.03), LIGHT); // rear sight fin

  // ---- fore-end (dark) with slanted vents, green translucent sensor fin underneath on a mount
  add(prism([[-3.6, 0.7], [-3.6, 1.9], [-5.2, 1.9], [-5.6, 1.55], [-5.6, 0.95], [-5.25, 0.7]], 0.82, 0.07), FORE);
  for (const z of [-3.9, -4.25, -4.6]) add(prism([[z, 1.05], [z - 0.14, 1.05], [z - 0.34, 1.6], [z - 0.2, 1.6]], 0.86, 0), BLACK);
  add(prism([[-3.55, 0.75], [-3.55, 0.35], [-3.8, 0.2], [-4.2, 0.2], [-4.2, 0.75]], 0.5, 0.04), DARK2);   // sensor mount
  add(prism([[-3.85, 0.72], [-5.1, 0.72], [-5.5, 0.3], [-5.25, 0.14], [-4.1, 0.26]], 0.34, 0.04), GREEN, 0, 0, 0, 0, 0.6);
  add(prism([[-4.15, 0.7], [-5.0, 0.7], [-5.2, 0.48], [-4.15, 0.48]], 0.38, 0), 0x2a9c5e, 0, 0, 0, 0, 0.5);   // inner core (two-tone "translucency")

  // ---- barrel: collar, cooling rings, band, muzzle brake with ports, dark bore
  add(Cz(0.34, 0.37, 0.7, 10), MID, 0, Y0, -5.95);
  add(Cz(0.39, 0.39, 0.08, 10), DARK2, 0, Y0, -6.27);
  for (const z of [-6.55, -6.78, -7.01]) add(Cz(0.255, 0.255, 0.11, 10), MID2, 0, Y0, z);
  add(Cz(0.19, 0.19, 3.45, 10), DARK, 0, Y0, -8.025);
  add(Cz(0.25, 0.25, 0.32, 10), MID, 0, Y0, -8.4);
  add(Cz(0.22, 0.26, 0.12, 10), MID, 0, Y0, -9.66);                                 // brake neck
  add(cbox(0.5, 0.5, 0.7, 0.08), MID2, 0, Y0, RIFLE_TIP + 0.35);
  for (const z of [-9.87, -10.12]) add(B(0.53, 0.11, 0.13), BLACK, 0, Y0, z);       // side ports
  add(B(0.18, 0.53, 0.13), BLACK, 0, Y0, -10.0);                                    // top/bottom port
  add(Cz(0.12, 0.12, 0.04, 10), BLACK, 0, Y0, RIFLE_TIP - 0.005);                   // bore

  // ---- pistol grip with finger grooves, trigger guard, trigger
  add(prism([[0.25, 0.6], [0.45, -0.72], [0.38, -0.85], [-0.24, -0.85], [-0.3, -0.7], [-0.22, -0.5], [-0.33, -0.3], [-0.24, -0.1],
    [-0.34, 0.1], [-0.28, 0.3], [-0.36, 0.6]], 0.5, 0.06), DARK2);
  add(prism([[0.4, -0.72], [0.47, -0.72], [0.4, -0.88], [-0.26, -0.88], [-0.26, -0.8], [0.34, -0.8]], 0.54, 0.02), MID);   // grip heel
  add(prism([[-0.3, 0.6], [-1.35, 0.6], [-1.35, 0.42], [-1.0, 0.02], [-0.25, 0.02]], 0.24, 0.02,
    [[[-0.42, 0.47], [-0.4, 0.14], [-0.92, 0.14], [-1.18, 0.4], [-1.18, 0.47]]]), DARK);
  add(prism([[-0.55, 0.56], [-0.72, 0.56], [-0.77, 0.32], [-0.64, 0.2]], 0.1, 0.02), MID2);

  // ---- E-pack under the receiver: body, side covers, mount rail, latch, ribs, one accent indicator
  add(prism([[-1.5, 0.58], [-3.3, 0.58], [-3.3, -0.1], [-3.05, -0.35], [-1.75, -0.35], [-1.5, -0.12]], 0.86, 0.08), DARK);
  add(prism([[-1.75, 0.35], [-3.05, 0.35], [-3.05, -0.05], [-2.85, -0.2], [-1.75, -0.2]], 0.92, 0.03), MID);
  add(prism([[-1.4, 0.62], [-3.45, 0.62], [-3.45, 0.47], [-1.4, 0.47]], 0.95, 0.03), DARK2);   // mount rail
  add(prism([[-1.36, 0.5], [-1.54, 0.5], [-1.54, -0.05], [-1.36, 0.1]], 0.5, 0.02), MID2);     // release latch
  for (const z of [-2.1, -2.7]) add(B(0.6, 0.06, 0.14), DARK2, 0, -0.37, z);                  // ribs
  add(B(0.94, 0.1, 0.28), ACCENT, 0, 0.12, -2.0);                                              // charge indicator

  // ---- short stock lying over the forearm (same envelope as r1): body, top plate, lightening cut, butt plate
  add(prism([[1.0, 1.15], [1.0, 2.2], [2.85, 2.15], [3.05, 1.95], [3.05, 1.15], [2.75, 1.0], [1.6, 1.15]], 0.66, 0.07), MID);
  add(prism([[1.05, 2.05], [1.05, 2.29], [2.72, 2.25], [2.9, 2.08]], 0.5, 0.04), LIGHT);
  add(prism([[1.5, 1.45], [1.5, 1.75], [2.5, 1.75], [2.65, 1.6], [2.5, 1.45]], 0.68, 0), DARK2);
  add(prism([[3.0, 1.0], [3.0, 2.25], [3.25, 2.15], [3.25, 1.05]], 0.76, 0.05), DARK2);
  add(Cx(0.06, 0.7, 6), DARK, 0, 1.9, 1.3);

  rifleGeo = merge(L);
  rifleGeo.translate(0, RIFLE_Y, 0);
  rifleGeo.scale(RIFLE_SCALE, RIFLE_SCALE, RIFLE_SCALE);
  rifleGeo.computeBoundingSphere();
  return rifleGeo;
}

const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3(), _mr = new THREE.Matrix4(), _mt = new THREE.Matrix4();
const _qr = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _v = new THREE.Vector3(), _f = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _f2 = new THREE.Vector3();
const XR = new THREE.Vector3(1, 0, 0);
// Clamp an aim direction (root space) to what the arm can reach; out = unit direction (default straight ahead).
function clampAim(aim, out) {
  if (!aim || !(aim.x * aim.x + aim.y * aim.y + aim.z * aim.z > 1e-6)) return out.set(0, 0, -1);
  const len = Math.hypot(aim.x, aim.y, aim.z);
  const yaw = Math.min(AIM_YAW[1], Math.max(AIM_YAW[0], Math.atan2(aim.x, -aim.z)));
  const pitch = Math.min(AIM_PITCH[1], Math.max(AIM_PITCH[0], Math.asin(Math.max(-1, Math.min(1, aim.y / len)))));
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}
// rotation of a frame whose Y axis is `dir` and whose X axis is as close to the suit's right as possible
function frameQuat(dir, m, q) {
  _ay.copy(dir).normalize();
  _ax.copy(XR).addScaledVector(_ay, -XR.dot(_ay)).normalize();
  _az.crossVectors(_ax, _ay);
  m.makeBasis(_ax, _ay, _az);
  return q.setFromRotationMatrix(m);
}
// Shoulder rotation that takes the hanging arm to "pointing along f", blended by k (0 = rest, 1 = aiming).
function armQuat(rig, f, k, out) {
  frameQuat(_v.subVectors(rig.hand, rig.shoulder), _mr, _qr);
  frameQuat(f, _mt, _qt);
  out.copy(_qt).multiply(_qr.invert());
  if (out.w < 0) out.set(-out.x, -out.y, -out.z, -out.w);
  _qi.identity().slerp(out, k);
  return out.copy(_qi);
}
// the direction the arm itself points for a barrel direction f: tilted down by ARM_DROP (about the suit's right axis)
function armDir(f, out) {
  _ay.copy(f).normalize();
  _ax.copy(XR).addScaledVector(_ay, -XR.dot(_ay)).normalize();
  _az.crossVectors(_ax, _ay);                                   // "up" of the aim frame
  return out.copy(_ay).multiplyScalar(Math.cos(ARM_DROP)).addScaledVector(_az, -Math.sin(ARM_DROP));
}
// rifle orientation at rest: barrel (-Z) along the arm, top (+Y) toward the front of the hanging arm
function rifleRest(rig, out) {
  _ay.subVectors(rig.hand, rig.shoulder).normalize();
  _ax.copy(XR).addScaledVector(_ay, -XR.dot(_ay)).normalize();
  _az.crossVectors(_ax, _ay);
  _mr.makeBasis(_ax, _az, _v.copy(_ay).negate());
  return out.setFromRotationMatrix(_mr);
}
// Where the rifle muzzle is (mesh space) for an un-smoothed aim: the player's own muzzle flash and visual beam origin.
export function xiMuzzle(aimLocal, out) {
  const rig = template && template.rig;
  if (!rig) return out.set(6.7, 8.4, -18.5);
  clampAim(aimLocal, _f);
  armQuat(rig, _f, 1, _q1);                                      // barrel: along the aim
  rifleRest(rig, _q2).premultiply(_q1);
  out.copy(RIFLE_MUZZLE).applyQuaternion(_q2);
  armQuat(rig, armDir(_f, _f2), 1, _q1);                         // arm: a little below it
  return out.add(_v.subVectors(rig.hand, rig.shoulder).applyQuaternion(_q1)).add(rig.shoulder);
}

// A whole drawable Xi: root group = textured mesh + beam rifle. pose() moves the arm and the rifle together.
//   suit.pose(dt, { raise: true, aim: Vector3 | null (direction in the root's own space), rifle: true, snap: false })
//   suit.muzzle : rifle muzzle in root space, valid after pose()
export function makeXiSuit(shared) {
  const mesh = makeXiMesh(shared);
  const rig = template.rig;
  const rmat = new THREE.ShaderMaterial({
    uniforms: { uSun: shared.sun, uNight: shared.night, uThermal: shared.thermal, uHeat: { value: 0.6 }, uFlash: mesh.material.uniforms.uFlash, uDmg: mesh.material.uniforms.uDmg },
    vertexShader: toon.vertex, fragmentShader: toon.fragment, vertexColors: true,
  });
  const rifle = new THREE.Mesh(buildRifle(), rmat);
  rifle.frustumCulled = false;
  const root = new THREE.Group();
  root.add(mesh, rifle);
  const q = new THREE.Quaternion(), rq = new THREE.Quaternion(), aim = new THREE.Vector3(0, 0, -1), tgt = new THREE.Vector3();
  const rest = rifleRest(rig, new THREE.Quaternion());
  const suit = { root, mesh, rifle, mats: [mesh.material, rmat], k: 0, muzzle: new THREE.Vector3() };
  suit.pose = (dt, o = {}) => {
    const want = o.raise ? 1 : 0;
    clampAim(o.aim, tgt);
    if (o.snap || !(dt > 0)) { suit.k = want; aim.copy(tgt); }
    else { suit.k += (want - suit.k) * (1 - Math.exp(-7 * dt)); aim.lerp(tgt, 1 - Math.exp(-14 * dt)).normalize(); }
    const k = suit.k * suit.k * (3 - 2 * suit.k);
    armQuat(rig, aim, k, rq);                                    // barrel follows the aim exactly...
    rq.multiply(rest);
    armQuat(rig, armDir(aim, _f2), k, q);                        // ...the arm points ARM_DROP below it (chest-height hold)
    mesh.material.uniforms.uArmQ.value.set(q.x, q.y, q.z, q.w);
    rifle.visible = o.rifle !== false;
    rifle.quaternion.copy(rq);
    rifle.position.subVectors(rig.hand, rig.shoulder).applyQuaternion(q).add(rig.shoulder);
    suit.muzzle.copy(RIFLE_MUZZLE).applyQuaternion(rq).add(rifle.position);
  };
  suit.pose(0, { raise: false, snap: true });
  return suit;
}
