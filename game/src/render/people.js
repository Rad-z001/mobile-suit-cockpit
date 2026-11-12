// Stylised people (CR-014 interlude, CR-015 Oenpeli): about 1.75 m, feet at y 0, facing -Z, no faces (the owner's choice).
// Rounded, jointed bodies (lofted torso and hips, tapered limbs, knee / elbow / shoulder joints, hands, boots), clothing
// per role (vests with reflective bands, jackets, coats, collars, epaulettes, belts, a tie), hair and headgear. Smooth
// toon shading plus the suits' ink outline, so people sit in the same cel look as everything else.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, toonOutline } from './shaders.js';
import { outlineGeometry } from './models.js';

// coat: torso + arms colour; legs: trousers; extra: per-look accessories
export const LOOKS = {
  deck: { coat: 0x2e3a52, legs: 0x2e3a52, skin: 0xc9a07c, hands: 0x2a2a2a, boots: 0x1c1d20, vest: 0xe8782e, band: 0xdde3ea, head: 'helmet', hat: 0xf2c230 },
  captain: { coat: 0x253250, legs: 0x5d6470, skin: 0xcfa27e, boots: 0x15161a, head: 'cap', hat: 0xeef1f4, collar: 0xf2f4f6, gold: 0xd6b45a, belt: 0x15161a },
  iram: { coat: 0x30333a, legs: 0x30333a, skin: 0xd8b08c, boots: 0x111214, head: 'short', hair: 0x1d1b1a, collar: 0xe8eaee, tie: 0x7a2430 },
  emerelda: { coat: 0x5b6b3a, legs: 0x2f3330, skin: 0xb98a66, boots: 0x2a211a, head: 'short', hair: 0x2a1d16, fur: 0xb89a70, belt: 0x2a211a },
  mihessia: { coat: 0xc9b48f, legs: 0x4a4038, skin: 0xe2bc98, boots: 0x3a2a20, head: 'long', hair: 0x6a4630, skirt: true, belt: 0x8a6a4a },
  operator: { coat: 0x33405e, legs: 0x2a3550, skin: 0xc79c78, boots: 0x15161a, head: 'short', hair: 0x222428, headset: 0x1a1b1e },
  gawman: { coat: 0x46503a, legs: 0x2e3030, skin: 0xc29470, boots: 0x231d18, head: 'short', hair: 0x2b2420, bandage: 0xeeeeea, belt: 0x231d18 },
  leader: { coat: 0x8a7a52, legs: 0x5a5040, skin: 0x8a5e40, boots: 0x3a2a1e, head: 'bush', hat: 0x6e5a3a, belt: 0x3a2a1e, scarf: 0xa83a2a },
  fighter: { coat: 0x6a6a48, legs: 0x4a4a3a, skin: 0x9a6a48, boots: 0x2a2219, head: 'cap', hat: 0x4a4a32, belt: 0x2a2219 },
  civ: { coat: 0x8a7f6e, legs: 0x5d564a, skin: 0xc49a76, boots: 0x3a3028, head: 'short', hair: 0x3a2a20 },
  civ2: { coat: 0x6e7c8a, legs: 0x4f5560, skin: 0xd6ae8a, boots: 0x2a2a2a, head: 'long', hair: 0x2a2220, skirt: true },
  civ3: { coat: 0xa0786a, legs: 0x5a4a44, skin: 0xb88a68, boots: 0x30282a, head: 'short', hair: 0x8a8a88 },
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// strip to position (+ index), add a flat colour
function col(g, hex) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const sphere = (r, x, y, z, sx = 1, sy = 1, sz = 1, seg = 10) => { const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 3)); g.scale(sx, sy, sz); g.translate(x, y, z); return g; };
const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
// tapered limb between two points
function limb(a, b, r0, r1, seg = 9) {
  const d = b.clone().sub(a), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1);
  g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
// lofted body through elliptical rings [{ y, rx, rz, z }] (indexed: smooth normals around), capped at both ends
function loftBody(rings, seg = 12) {
  const pos = [], idx = [];
  rings.forEach((r) => { for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(Math.sin(a) * r.rx, r.y, -Math.cos(a) * r.rz + (r.z || 0)); } });
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < seg; i++) {
    const a = k * seg + i, b = k * seg + ((i + 1) % seg), c = (k + 1) * seg + i, d = (k + 1) * seg + ((i + 1) % seg);
    idx.push(a, c, b, b, c, d);
  }
  const base = pos.length / 3;
  pos.push(0, rings[0].y, rings[0].z || 0, 0, rings[rings.length - 1].y, rings[rings.length - 1].z || 0);
  const last = (rings.length - 1) * seg;
  for (let i = 0; i < seg; i++) { idx.push(base, i, (i + 1) % seg); idx.push(base + 1, last + ((i + 1) % seg), last + i); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function personGeometry(look, seated = false) {
  const L = LOOKS[look] || LOOKS.deck, P = [];
  const add = (g, c) => P.push(col(g, c));
  const dy = seated ? -0.42 : 0;                                   // seated: the upper body sits lower
  // ---- legs and boots
  for (const s of [-1, 1]) {
    const x = s * 0.1;
    if (seated) {
      add(limb(V(x, 0.5, 0), V(x, 0.5, -0.4), 0.082, 0.066), L.legs);
      add(sphere(0.063, x, 0.5, -0.41), L.legs);
      add(limb(V(x, 0.49, -0.42), V(x, 0.1, -0.44), 0.06, 0.05), L.legs);
      add(box(0.12, 0.1, 0.27, x, 0.05, -0.48), L.boots);
    } else {
      add(box(0.12, 0.1, 0.27, x, 0.05, -0.04), L.boots);
      add(sphere(0.06, x, 0.1, -0.15, 1, 0.6, 1, 8), L.boots);           // rounded toe
      add(limb(V(x, 0.1, 0), V(x, 0.49, -0.005), 0.052, 0.06), L.legs);
      add(sphere(0.063, x, 0.5, -0.008), L.legs);                         // knee
      add(limb(V(x, 0.5, 0), V(x, 0.9, 0), 0.068, 0.084), L.legs);
    }
  }
  // ---- hips, torso, neck, head
  add(loftBody([{ y: 0.82 + dy, rx: 0.165, rz: 0.105 }, { y: 0.92 + dy, rx: 0.172, rz: 0.11 }, { y: 0.99 + dy, rx: 0.16, rz: 0.105 }]), L.skirt ? L.coat : L.legs);
  add(loftBody([{ y: 0.97 + dy, rx: 0.155, rz: 0.1 }, { y: 1.12 + dy, rx: 0.163, rz: 0.108 }, { y: 1.29 + dy, rx: 0.188, rz: 0.118, z: -0.005 },
    { y: 1.41 + dy, rx: 0.198, rz: 0.108 }, { y: 1.47 + dy, rx: 0.115, rz: 0.075 }]), L.coat);
  if (L.skirt) add(loftBody([{ y: 0.6 + dy, rx: 0.21, rz: 0.15 }, { y: 0.84 + dy, rx: 0.185, rz: 0.125 }, { y: 1.0 + dy, rx: 0.162, rz: 0.106 }]), L.coat);
  add(limb(V(0, 1.45 + dy, 0), V(0, 1.55 + dy, 0.005), 0.048, 0.045), L.skin);
  add(sphere(0.1, 0, 1.635 + dy, 0.004, 1, 1.2, 1.08), L.skin);
  // ---- arms: shoulder, upper arm, elbow, forearm, hand
  for (const s of [-1, 1]) {
    const sh = V(s * 0.205, 1.4 + dy, 0), el = V(s * 0.235, 1.13 + dy, -0.015), wr = V(s * 0.245, 0.9 + dy, -0.045);
    add(sphere(0.06, sh.x, sh.y, sh.z), L.coat);
    add(limb(sh, el, 0.052, 0.045), L.coat);
    add(sphere(0.046, el.x, el.y, el.z), L.coat);
    add(limb(el, wr, 0.044, 0.036), L.coat);
    add(sphere(1, wr.x, wr.y - 0.055, wr.z, 0.034, 0.068, 0.048, 8), L.hands || L.skin);
  }
  // ---- clothing details
  if (L.vest) {
    add(loftBody([{ y: 1.0 + dy, rx: 0.17, rz: 0.115 }, { y: 1.29 + dy, rx: 0.2, rz: 0.13, z: -0.005 }, { y: 1.42 + dy, rx: 0.205, rz: 0.12 }]), L.vest);
    for (const y of [1.1, 1.26]) add(loftBody([{ y: y + dy, rx: 0.178 + (y - 1.0) * 0.12, rz: 0.12 + (y - 1) * 0.06 }, { y: y + 0.035 + dy, rx: 0.18 + (y - 1.0) * 0.12, rz: 0.122 + (y - 1) * 0.06 }]), L.band);
  }
  if (L.belt) add(loftBody([{ y: 0.96 + dy, rx: 0.163, rz: 0.108 }, { y: 1.0 + dy, rx: 0.164, rz: 0.109 }]), L.belt);
  if (L.collar) add(box(0.12, 0.07, 0.04, 0, 1.45 + dy, -0.085), L.collar);
  if (L.tie) add(box(0.04, 0.17, 0.02, 0, 1.36 + dy, -0.118), L.tie);
  if (L.gold) for (const s of [-1, 1]) add(box(0.09, 0.02, 0.06, s * 0.2, 1.465 + dy, 0), L.gold);
  if (L.fur) { const t = new THREE.TorusGeometry(0.085, 0.028, 6, 14); t.rotateX(Math.PI / 2); t.translate(0, 1.47 + dy, 0); add(t, L.fur); }
  if (L.scarf) { const t = new THREE.TorusGeometry(0.075, 0.025, 6, 12); t.rotateX(Math.PI / 2); t.translate(0, 1.49 + dy, 0); add(t, L.scarf); }
  if (L.bandage) add(limb(V(0.217, 1.3 + dy, -0.006), V(0.222, 1.25 + dy, -0.008), 0.054, 0.054), L.bandage);
  // ---- hair and headgear
  const hy = 1.635 + dy;
  if (L.head === 'helmet') {
    add(sphere(0.124, 0, hy + 0.035, 0.004, 1, 0.95, 1.05, 12), L.hat);
    add(limb(V(0, hy + 0.02, 0), V(0, hy + 0.032, 0), 0.142, 0.142, 14), L.hat);
  } else if (L.head === 'cap') {
    add(limb(V(0, hy + 0.06, 0.005), V(0, hy + 0.13, 0.005), 0.108, 0.118, 12), L.hat);
    add(box(0.16, 0.012, 0.09, 0, hy + 0.062, -0.1), 0x111215);
    if (L.gold) add(limb(V(0, hy + 0.06, 0.005), V(0, hy + 0.08, 0.005), 0.11, 0.11, 12), L.gold);
  } else if (L.head === 'bush') {
    add(limb(V(0, hy + 0.05, 0.005), V(0, hy + 0.06, 0.005), 0.2, 0.2, 14), L.hat);        // wide brim
    add(sphere(0.105, 0, hy + 0.07, 0.005, 1, 0.75, 1, 10), L.hat);
  } else {
    const cap = new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    cap.rotateX(0.6);                                                          // the crown tips back: the face stays bare
    cap.scale(1, 1.15, 1.08); cap.translate(0, hy + 0.01, 0.01);
    add(cap, L.hair);
    if (L.head === 'long') add(sphere(1, 0, hy - 0.11, 0.075, 0.105, 0.16, 0.05, 10), L.hair);
  }
  if (L.headset) { const t = new THREE.TorusGeometry(0.112, 0.012, 5, 14, Math.PI); t.translate(0, hy + 0.02, 0); add(t, L.headset); for (const s of [-1, 1]) add(sphere(0.03, s * 0.11, hy, 0, 0.5, 1, 1, 8), L.headset); }
  const g = mergeGeometries(P, false);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// factory: kit.person(look, { seated }) -> Group (toon body + ink outline); geometry cached per look / pose
export function createPeopleKit(U) {
  const cache = new Map();
  const bodyMat = new THREE.ShaderMaterial({
    uniforms: { uSun: U.uSunDir, uNight: U.uNight, uThermal: U.uThermal, uHeat: { value: 0.55 }, uFlash: { value: 0 }, uDmg: { value: 0 } },
    vertexShader: toon.vertex, fragmentShader: toon.fragment, vertexColors: true,
  });
  const outMat = new THREE.ShaderMaterial({ uniforms: { uPixAng: U.uPixAng || { value: 0.0015 }, uScale: { value: 0.12 }, uThermal: U.uThermal },
    vertexShader: toonOutline.vertex, fragmentShader: toonOutline.fragment, side: THREE.BackSide });
  function person(look, opt = {}) {
    const key = look + (opt.seated ? ':s' : '');
    if (!cache.has(key)) { const g = personGeometry(look, !!opt.seated); cache.set(key, { g, o: outlineGeometry(g) }); }
    const { g, o } = cache.get(key);
    const grp = new THREE.Group();
    const m = new THREE.Mesh(g, bodyMat), om = new THREE.Mesh(o, outMat);
    m.frustumCulled = om.frustumCulled = false;
    grp.add(om, m);
    return grp;
  }
  return { person };
}
