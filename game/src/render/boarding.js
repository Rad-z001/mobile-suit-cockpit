// CR-008 story, Chapter 1 scene. Reads state.story (sim/boarding.js) only. Everything is drawn in the WORLD scene at real
// scale (pilot 1.8 m, Xi 28 m) in one group whose origin is the Xi's cockpit point in the cargo (the Xi faces -Z):
//   interior  dark hexagonal airlock with a heavy layered hex frame and a sliding inner door, the 48 m hex gangway, and the
//             bay (ring frames, gantry towers and clamps holding the Xi, work lights, a railed ledge at the gangway mouth;
//             no walkway or door to the cockpit). Seen in first person in phase 'boarding' ('airlock' / 'walk' / 'enter')
//             and on the monitors during the story cold start (without the Xi, which the camera is then inside).
//   exterior  the cargo hull (a boxy armoured container: panels, frames, doors, thruster pods) with its fire trail. Seen
//             in the 'outside' shot (this module moves the camera) and after the release, when the empty cargo falls on and
//             explodes on the sea (ragged fire bloom, fire and smoke puffs, embers, shock ring).
// The interior is unlit geometry (MeshBasicMaterial + vertex colours): lighting from the lamps is baked into the vertex
// colours once at build time. A flat HUD on top: distance to the Xi, objective, radio line, hints, the chapter title card,
// fades, letterbox bars for the outside shot. While the pilot is on foot or the outside shot runs, the cockpit, sphere HUD
// and chase view are off (render/index.js asks boarding.active) and the monitor pass is "clean".
import * as THREE from 'three';
import { toon } from './shaders.js';
import { part, B, merge } from './models.js';
import { onXiReady, makeXiSuit } from './xiSuit.js';
import { XI_COCKPIT } from '../state.js';
import { BOARD } from '../sim/tuning.js';
import { num, isVec, saturate } from './util.js';

const W = 1280, H = 720;
const FONT = '"Roboto Mono", Consolas, "Courier New", monospace';
const FOV_WALK = 78, FOV_CINE = 52;
const ease = (t) => { t = saturate(t); return t * t * (3 - 2 * t); };
const COS30 = Math.cos(Math.PI / 6);

export function createBoarding({ state, world, monitor, rig }) {
  const api = { active: false };
  const U = world.uniforms;
  const shared = { sun: U.uSunDir, night: U.uNight, thermal: U.uThermal };
  const toonMat = (side) => new THREE.ShaderMaterial({
    uniforms: { uSun: shared.sun, uNight: shared.night, uThermal: shared.thermal, uHeat: { value: 0.5 }, uFlash: { value: 0 }, uDmg: { value: 0 } },
    vertexShader: toon.vertex, fragmentShader: toon.fragment, vertexColors: true, side: side || THREE.FrontSide,
  });
  const lit = (geo, side) => { const m = new THREE.Mesh(geo, toonMat(side)); m.frustumCulled = false; return m; };
  // unlit, vertex-coloured (the inside of the cargo has no sun): the colours ARE the lighting
  const flat = (geo, side) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: side || THREE.FrontSide })); m.frustumCulled = false; return m; };

  // ---- geometry helpers -------------------------------------------------------------------------------------------------------
  let seed = 0x2f6b1a3;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
  const _c = new THREE.Color(), _c2 = new THREE.Color();
  const mix = (a, b, t) => _c2.set(a).lerp(_c.set(b), saturate(t)).clone();
  const shade = (a, k) => new THREE.Color(a).multiplyScalar(k);
  // triangles with an explicit face normal (winding fixed to match it) and a colour
  function Tris() {
    const pos = [], nrm = [], col = [];
    const t = {
      tri(a, b, c, color, N) {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        if ((uy * vz - uz * vy) * N[0] + (uz * vx - ux * vz) * N[1] + (ux * vy - uy * vx) * N[2] < 0) { const s = b; b = c; c = s; }
        _c.set(color);
        for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); nrm.push(N[0], N[1], N[2]); col.push(_c.r, _c.g, _c.b); }
      },
      quad(a, b, c, d, color, N) { t.tri(a, b, c, color, N); t.tri(a, c, d, color, N); },
      geo() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        return g;
      },
    };
    return t;
  }
  // regular n-gon with a flat side at the bottom (side 0 = floor); A = apothem; u in [0, n) runs along the perimeter
  const ROT = (n) => 1.5 * Math.PI - Math.PI / n;
  function polyPt(n, cx, cy, A, u) {
    const k = Math.floor(u), t = u - k, R = A / Math.cos(Math.PI / n), f0 = ROT(n) + (2 * Math.PI * k) / n, f1 = f0 + (2 * Math.PI) / n;
    return [cx + R * (Math.cos(f0) * (1 - t) + Math.cos(f1) * t), cy + R * (Math.sin(f0) * (1 - t) + Math.sin(f1) * t)];
  }
  // sweep a profile [[apothem, z], ...] around an n-gon. sgn -1: seen from inside (profile in +z order), +1: from outside
  function sweep(T, n, cx, cy, prof, colorFn, sgn = -1, sub = 1, sides) {
    for (let i = 0; i < n; i++) {
      if (sides && sides.indexOf(i) < 0) continue;
      const th = ROT(n) + (Math.PI * (2 * i + 1)) / n, mx = Math.cos(th), my = Math.sin(th);
      for (let j = 0; j + 1 < prof.length; j++) {
        const p0 = prof[j], p1 = prof[j + 1], [a0, z0] = p0, [a1, z1] = p1;
        if (a0 === a1 && z0 === z1) continue;
        const nr = (z1 - z0) * sgn, nz = -(a1 - a0) * sgn, l = Math.hypot(nr, nz);
        const N = [(mx * nr) / l, (my * nr) / l, nz / l];
        for (let s = 0; s < sub; s++) {
          const c = colorFn(i, j, (z0 + z1) / 2, p0, p1, s);
          if (c == null) continue;
          const u0 = i + s / sub, u1 = i + (s + 1) / sub;
          const q = (u, a, z) => { const p = polyPt(n, cx, cy, a, u); return [p[0], p[1], z]; };
          T.quad(q(u0, a0, z0), q(u1, a0, z0), q(u1, a1, z1), q(u0, a1, z1), c, N);
        }
      }
    }
  }
  // a flat face at z between two closed outlines sampled at the same parameter (bulkheads, end walls)
  function face(T, segs, inner, outer, z, rings, N, colorFn, yMin = -1e9) {
    const L = (u, t) => { const a = inner(u), b = outer(u); return [a[0] + (b[0] - a[0]) * t, Math.max(yMin, a[1] + (b[1] - a[1]) * t), z]; };
    for (let m = 0; m < segs; m++) for (let r = 0; r < rings; r++) T.quad(L(m, r / rings), L(m + 1, r / rings), L(m + 1, (r + 1) / rings), L(m, (r + 1) / rings), colorFn(m, r), N);
  }
  // add a coloured, non-indexed copy of a geometry (position / normal / colour only) to a list
  function put(arr, g0, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = part(g0.index ? g0.toNonIndexed() : g0, c, x, y, z, rx, ry, rz);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
    g.clearGroups(); g.computeVertexNormals();
    arr.push(g); return g;
  }
  // a box whose +Y face is inset by b on all sides: a bevelled plate (12 triangles)
  const plate = (w, h, d, b) => {
    const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, Math.sign(p.getX(i)) * Math.max(0.004, w / 2 - b)); p.setZ(i, Math.sign(p.getZ(i)) * Math.max(0.004, d / 2 - b)); }
    return g;
  };
  // place a piece on side k of an n-gon wall: local X along the side, local +Y = into the room, Z = z. lift = centre's
  // distance from the wall plane, u = offset along the side
  function onSide(arr, geo, c, n, cx, cy, A, k, u, z, lift) {
    const th = ROT(n) + (Math.PI * (2 * k + 1)) / n, ct = Math.cos(th), st = Math.sin(th);
    return put(arr, geo, c, cx + ct * (A - lift) - st * u, cy + st * (A - lift) + ct * u, z, 0, 0, th + Math.PI / 2);
  }
  const hexPath = (cx, cy, A, Ctor = THREE.Path) => { const pts = []; for (let i = 0; i < 6; i++) { const p = polyPt(6, cx, cy, A, i); pts.push(new THREE.Vector2(p[0], p[1])); } return new Ctor(pts); };
  const slab = (shape, depth, bev) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, curveSegments: 1 });
  const hexRing = (Aout, Ain) => { const s = hexPath(0, 0, Aout, THREE.Shape); s.holes.push(hexPath(0, 0, Ain)); return s; };
  const cyl = (r0, r1, len, seg, open) => new THREE.CylinderGeometry(r0, r1, len, seg, 1, !!open);
  // baked lighting: colour *= ambient + sum of point lamps (wrapped Lambert, smooth range falloff)
  const mkLight = (x, y, z, hex, i, R) => { const c = new THREE.Color(hex); return { x, y, z, r: c.r, g: c.g, b: c.b, i, R, R2: R * R }; };
  function bake(g, lights, amb) {
    const p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.color.array;
    for (let v = 0; v < p.length; v += 3) {
      const px = p[v], py = p[v + 1], pz = p[v + 2], nx = n[v], ny = n[v + 1], nz = n[v + 2];
      const h = 0.8 + 0.2 * ny;
      let r = amb[0] * h, gg = amb[1] * h, b = amb[2] * h;
      for (const L of lights) {
        const dx = L.x - px, dy = L.y - py, dz = L.z - pz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= L.R2) continue;
        const d = Math.sqrt(d2) + 1e-4, f = 1 - d / L.R, lam = (nx * dx + ny * dy + nz * dz) / d;
        const k = f * f * L.i * (lam > 0 ? 0.25 + 0.75 * lam : 0.25 * Math.max(0, 1 + 1.6 * lam));
        r += L.r * k; gg += L.g * k; b += L.b * k;
      }
      c[v] *= r; c[v + 1] *= gg; c[v + 2] *= b;
    }
  }
  // static lit list + emissive list -> one unlit mesh geometry
  function finishFlat(litList, emList, lights, amb) {
    const a = merge(litList); bake(a, lights, amb);
    const g = emList.length ? merge([a, merge(emList)]) : a;
    g.deleteAttribute('normal');
    return g;
  }
  // camera-facing-ish glow quads merged into one additive mesh
  function Glows() {
    const pos = [], uv = [], col = [], v = new THREE.Vector3(), up = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
    return {
      add(x, y, z, size, color, tx, ty, tz) {
        v.set(tx - x, ty - y, tz - z).normalize();
        up.set(0, 1, 0); if (Math.abs(v.y) > 0.95) up.set(1, 0, 0);
        u.crossVectors(up, v).normalize().multiplyScalar(size / 2); w.crossVectors(v, u);
        const P = (a, b) => [x + u.x * a + w.x * b, y + u.y * a + w.y * b, z + u.z * a + w.z * b];
        const q = [P(-1, -1), P(1, -1), P(1, 1), P(-1, -1), P(1, 1), P(-1, 1)], t = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
        _c.set(color);
        for (let i = 0; i < 6; i++) { pos.push(...q[i]); uv.push(t[i * 2], t[i * 2 + 1]); col.push(_c.r, _c.g, _c.b); }
      },
      mesh(tex, opacity = 1) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        m.frustumCulled = false; m.renderOrder = 5; return m;
      },
    };
  }
  // canvas textures (no files)
  function canvasTex(size, draw, repeat) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
    return t;
  }
  const glowTex = canvasTex(128, (g) => {
    const gr = g.createRadialGradient(64, 64, 3, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.42)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
  const gratTex = canvasTex(64, (g) => {
    g.fillStyle = '#121418'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#585e68'; for (let i = 2; i < 64; i += 8) g.fillRect(i, 0, 3, 64);           // bearing bars
    g.fillStyle = '#3c4048'; for (let j = 6; j < 64; j += 16) g.fillRect(0, j, 64, 2);           // cross rods
    g.fillStyle = '#6d737e'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 0, 2, 64);                     // panel frame
    g.fillStyle = '#26292f'; g.fillRect(0, 62, 64, 2); g.fillRect(62, 0, 2, 64);
  }, true);
  // a ragged blob outline (flame tongues): n points around (cx, cy), radius R, jaggedness j
  function raggedPath(g, cx, cy, R, j, n, spikes) {
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      let r = 1 + j * (0.45 * Math.sin(a * 3 + ph[0]) + 0.3 * Math.sin(a * 7 + ph[1]) + 0.25 * Math.sin(a * 13 + ph[2]));
      r += j * (rnd() - 0.5) * 0.9;
      if (spikes && i % 2 === 0) r += j * spikes * rnd();
      g.lineTo(cx + Math.cos(a) * R * r, cy + Math.sin(a) * R * r);
    }
    g.closePath();
  }
  // fire puff: cream core, orange body, dark ragged rim
  const fireTex = canvasTex(128, (g) => {
    g.filter = 'blur(1.5px)';
    g.fillStyle = 'rgba(70,32,14,0.55)'; raggedPath(g, 64, 64, 50, 0.22, 48, 0.5); g.fill();
    g.fillStyle = 'rgba(232,118,36,0.95)'; raggedPath(g, 64, 64, 44, 0.2, 44, 0.45); g.fill();
    g.fillStyle = 'rgba(255,196,120,1)'; raggedPath(g, 64, 64, 36, 0.18, 40, 0.3); g.fill();
    g.filter = 'blur(4px)';
    g.fillStyle = 'rgba(255,246,222,1)'; raggedPath(g, 64, 64, 26, 0.15, 32, 0); g.fill();
  });
  const smokeTex = canvasTex(128, (g) => {
    g.filter = 'blur(5px)';
    for (let k = 0; k < 5; k++) { g.fillStyle = `rgba(255,255,255,${0.22 + 0.08 * k})`; raggedPath(g, 64 + (rnd() - 0.5) * 10, 64 + (rnd() - 0.5) * 10, 48 - k * 7, 0.18, 36, 0.2); g.fill(); }
  });
  // the impact seen from above (reference): huge cream-white bloom, orange then dark-brown ragged edge, dark wreck core, embers
  const bloomTex = canvasTex(512, (g) => {
    g.filter = 'blur(2px)';
    g.fillStyle = 'rgba(48,24,12,0.85)'; raggedPath(g, 256, 256, 222, 0.16, 90, 0.55); g.fill();
    g.fillStyle = 'rgba(200,92,30,1)'; raggedPath(g, 256, 256, 200, 0.15, 90, 0.5); g.fill();
    g.fillStyle = 'rgba(255,170,90,1)'; raggedPath(g, 256, 256, 186, 0.15, 80, 0.4); g.fill();
    g.filter = 'blur(6px)';
    g.fillStyle = 'rgba(255,240,212,1)'; raggedPath(g, 256, 256, 168, 0.14, 70, 0.3); g.fill();
    g.fillStyle = 'rgba(255,252,240,1)'; raggedPath(g, 256, 256, 120, 0.12, 50, 0); g.fill();
    g.filter = 'blur(1px)';
    g.fillStyle = 'rgba(70,40,24,0.95)'; raggedPath(g, 262, 270, 44, 0.3, 28, 0.6); g.fill();           // the wreck
    g.fillStyle = 'rgba(40,22,14,1)'; g.fillRect(238, 258, 50, 16);
    g.fillStyle = 'rgba(255,226,160,1)'; for (const [x, y] of [[250, 266], [272, 262], [262, 279]]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
    g.filter = 'none';
    for (let i = 0; i < 70; i++) { const a = rnd() * 6.28, r = 200 + rnd() * 50; g.fillStyle = `rgba(255,${150 + rnd() * 90 | 0},80,${0.5 + rnd() * 0.5})`; g.fillRect(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 2 + rnd() * 3, 2 + rnd() * 3); }
  });

  const root = new THREE.Group();
  root.visible = false;
  world.scene.add(root);
  const interior = new THREE.Group(), exterior = new THREE.Group();
  root.add(interior, exterior);

  // ---- layout (metres, origin = Xi cockpit point) -------------------------------------------------------------------------
  const FLOOR = BOARD.start[1] - 1.7;                                   // gangway / airlock floor
  const HEXR = 2.3, HEXA = HEXR * COS30, HEXY = FLOOR + HEXA;          // gangway: hex tube with a flat floor
  const AIRR = 2.9, AIRA = AIRR * COS30, AIRY = FLOOR + AIRA;          // airlock: a wider hex
  const DOORY = 1.2, OPA = 1.5;                                         // inner door: opening centre height and apothem
  const DZ = BOARD.doorZ, BZ = BOARD.bayZ, BACK = BOARD.backZ - 0.4, G0 = DZ + 0.45;   // G0: gangway side of the door bulkhead
  const HULL_R = 19, HULL_Y = -5, HULL_Z0 = -72, HULL_Z1 = 20;
  const BAYR = HULL_R - 0.6, BAYA = BAYR * Math.cos(Math.PI / 24), BEND = HULL_Z1 - 0.5, DECK = -20.6;
  const EYE = [0, BOARD.start[1], BOARD.endZ];

  // ---- interior palette (albedo; the bake adds the light) --------------------------------------------------------------------
  const WALL = 0x5a606b, WALL2 = 0x4c525c, PANEL = 0x3a3f48, RIB = 0x6a717d, DARK = 0x1c1f24, STEEL = 0x7d8592, STEELD = 0x4a505a;
  const BRIGHT = 0xb8c0cc, HAZY = 0xc9962c, HAZK = 0x202020, PIPE = 0x66707c, PIPER = 0x7a3a2c, CABLE = 0x2a2d33;
  const LAMP = 0xe4efff, LAMPW = 0xfff1d6, STRIP = 0x6c9ec4, GUIDE = 0x86d0ff, GUIDEA = 0xffb040;

  const S = [], E = [], TS = Tris(), glows = Glows(), warnGeo = [], warnGlow = Glows();
  const LA = [], LG = [], LB = [];                                      // baked lights: airlock, gangway, bay
  const GR = { pos: [], uv: [], col: [] };                              // floor grating (textured)
  function grating(x0, x1, z0, z1, y, step) {
    const nz = Math.max(1, Math.round((z1 - z0) / step)), nx = Math.max(1, Math.round((x1 - x0) / 0.8));
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const za = z0 + ((z1 - z0) * k) / nz, zb = z0 + ((z1 - z0) * (k + 1)) / nz, xa = x0 + ((x1 - x0) * i) / nx, xb = x0 + ((x1 - x0) * (i + 1)) / nx;
      for (const [x, z] of [[xa, za], [xa, zb], [xb, zb], [xa, za], [xb, zb], [xb, za]]) { GR.pos.push(x, y, z); GR.uv.push(x / 0.6, z / 0.6); }
    }
  }

  // ======== AIRLOCK ===========================================================================================================
  LA.push(mkLight(0, AIRY + AIRA - 0.35, -65.4, LAMP, 1.7, 7.5), mkLight(0, 3.75, DZ - 0.9, 0xcfe0ff, 1.3, 4.2),
    mkLight(-2.0, 3.0, DZ - 0.5, 0xff3a22, 0.7, 3.2), mkLight(2.0, 3.0, DZ - 0.5, 0xff3a22, 0.7, 3.2),
    mkLight(0, 2.6, BACK + 0.8, 0x9fb6d8, 0.5, 4), mkLight(0, 0.2, DZ - 1.2, 0x8fa8c8, 0.45, 3.5));
  {
    // walls: panel bays with seams, ribs
    const prof = []; for (let z = BACK; z < DZ - 1e-6; z += 0.55) prof.push([AIRA, Math.min(z, DZ)]); prof.push([AIRA, DZ]);
    sweep(TS, 6, 0, AIRY, prof, (i, j, z) => i === 0 ? DARK : shade(i === 3 ? WALL2 : WALL, 0.85 + 0.15 * hash(i, Math.floor((z - BACK) / 2.2))), -1, 2);
    for (const zr of [BACK + 2.2, BACK + 4.4]) sweep(TS, 6, 0, AIRY, [[AIRA, zr - 0.22], [AIRA - 0.16, zr - 0.12], [AIRA - 0.16, zr + 0.12], [AIRA, zr + 0.22]], (i, j) => j === 1 ? RIB : STEELD, -1, 1, [1, 2, 3, 4, 5]);
    // recessed wall panels (dark inset, raised bevelled border) on the four slanted sides; lamp and vents on the ceiling
    for (let b = 0; b < 3; b++) {
      const zc = BACK + 1.1 + b * 2.2;
      for (const k of [1, 2, 4, 5]) {
        const w = AIRR - 0.55, d = 1.75;
        onSide(S, plate(w - 0.18, 0.03, d - 0.18, 0.015), PANEL, 6, 0, AIRY, AIRA, k, 0, zc, 0.015);
        onSide(S, plate(w, 0.07, 0.13, 0.04), STEEL, 6, 0, AIRY, AIRA, k, 0, zc - d / 2, 0.035);
        onSide(S, plate(w, 0.07, 0.13, 0.04), STEEL, 6, 0, AIRY, AIRA, k, 0, zc + d / 2, 0.035);
        onSide(S, plate(0.13, 0.07, d - 0.13, 0.04), STEEL, 6, 0, AIRY, AIRA, k, -w / 2, zc, 0.035);
        onSide(S, plate(0.13, 0.07, d - 0.13, 0.04), STEEL, 6, 0, AIRY, AIRA, k, w / 2, zc, 0.035);
        const r = hash(k, b);
        if (r < 0.45) for (let s = 0; s < 4; s++) onSide(S, plate(0.9, 0.05, 0.06, 0.02), RIB, 6, 0, AIRY, AIRA, k, (k < 3 ? 1 : -1) * 0.35, zc - 0.3 + s * 0.2, 0.05);   // vent slats
        else if (r < 0.8) { onSide(S, plate(0.7, 0.16, 0.55, 0.05), STEELD, 6, 0, AIRY, AIRA, k, -0.3, zc + 0.2, 0.09); onSide(S, B(0.12, 0.05, 0.12), BRIGHT, 6, 0, AIRY, AIRA, k, -0.5, zc + 0.35, 0.19); }
      }
      onSide(S, plate(1.7, 0.05, 1.5, 0.03), PANEL, 6, 0, AIRY, AIRA, 3, 0, zc, 0.025);
    }
    onSide(S, plate(1.3, 0.12, 0.5, 0.04), STEELD, 6, 0, AIRY, AIRA, 3, 0, -65.4, 0.07);
    onSide(E, B(1.1, 0.03, 0.3), LAMP, 6, 0, AIRY, AIRA, 3, 0, -65.4, 0.14);
    glows.add(0, AIRY + AIRA - 0.3, -65.4, 1.6, 0x8090a8, 0, 1, -40);
    // lockers by the outer hatch
    for (const k of [1, 5]) { onSide(S, plate(1.5, 0.32, 1.3, 0.05), STEELD, 6, 0, AIRY, AIRA, k, 0.05, BACK + 1.1, 0.17); onSide(S, B(0.6, 0.05, 0.05), BRIGHT, 6, 0, AIRY, AIRA, k, 0.05, BACK + 0.6, 0.35); }
    // rear wall with the outer hatch
    face(TS, 18, (m) => polyPt(6, 0, AIRY, 0.3, m / 3), (m) => polyPt(6, 0, AIRY, AIRA, m / 3), BACK, 4, [0, 0, 1], (m, r) => shade(WALL2, 0.75 + 0.1 * (r % 2)));
    put(S, plate(1.9, 0.12, 2.6, 0.06), STEELD, 0, FLOOR + 1.45, BACK + 0.06, Math.PI / 2);
    put(S, plate(1.45, 0.08, 2.1, 0.04), PANEL, 0, FLOOR + 1.45, BACK + 0.16, Math.PI / 2);
    put(S, B(0.5, 0.08, 0.08), BRIGHT, 0.45, FLOOR + 1.3, BACK + 0.24);
    for (const y of [0.75, 2.2]) put(S, plate(1.2, 0.06, 0.32, 0.03), 0x4a505a, 0, FLOOR + y, BACK + 0.22, Math.PI / 2);
    for (let i = 0; i < 6; i++) put(S, B(0.2, 0.12, 0.02), i % 2 ? HAZK : HAZY, -0.5 + i * 0.2, FLOOR + 2.62, BACK + 0.21);
    put(S, plate(0.5, 0.06, 0.35, 0.03), 0x15171a, 0, FLOOR + 1.75, BACK + 0.22, Math.PI / 2);
    put(E, B(0.14, 0.14, 0.04), 0xff3020, 0, FLOOR + 3.0, BACK + 0.1);
    // floor grating
    grating(-1.3, 1.3, BACK, DZ - 0.36, FLOOR + 0.015, 0.8);
    for (const sx of [-1, 1]) put(S, B(0.16, 0.06, DZ - BACK - 0.4), STEELD, sx * 1.38, FLOOR + 0.03, (BACK + DZ - 0.4) / 2);

    // ---- the inner door: bulkhead, layered bevelled hex frame (high / recessed / high), handle bars, throat -------------
    face(TS, 18, (m) => polyPt(6, 0, DOORY, 2.02, m / 3), (m) => polyPt(6, 0, AIRY, AIRA, m / 3), DZ, 3, [0, 0, -1], (m, r) => shade(r === 1 ? WALL2 : WALL, 0.8 + 0.2 * hash(m, r)), FLOOR - 0.01);
    put(S, slab(hexRing(2.05, 1.89), 0.24, 0.05), 0x2f333b, 0, DOORY, DZ - 0.29);            // L1 outer plate: z DZ-0.34..DZ
    put(S, slab(hexRing(1.83, 1.65), 0.12, 0.03), 0x23262c, 0, DOORY, DZ - 0.15);            // L2 recessed band
    put(S, slab(hexRing(1.61, 1.53), 0.24, 0.03), 0x3a3f48, 0, DOORY, DZ - 0.27);            // L3 inner lip
    sweep(TS, 6, 0, DOORY, [[OPA, DZ - 0.3], [OPA, G0]], () => DARK);                      // throat
    for (let k = 0; k < 6; k++) {
      const th = ROT(6) + (Math.PI * (2 * k + 1)) / 6, ct = Math.cos(th), st = Math.sin(th), rz = th + Math.PI / 2;
      const at = (A, u, z) => [ct * A - st * u, DOORY + st * A + ct * u, z];
      // handle bar in a dark slot on the recessed band, bright end brackets
      let p = at(1.74, 0, DZ - 0.19); put(S, B(0.86, 0.17, 0.02), 0x0f1114, p[0], p[1], p[2], 0, 0, rz);
      p = at(1.74, 0, DZ - 0.27); const bar = cyl(0.032, 0.032, 0.66, 6); bar.rotateZ(Math.PI / 2); put(S, bar, BRIGHT, p[0], p[1], p[2], 0, 0, rz);
      for (const u of [-0.36, 0.36]) { p = at(1.74, u, DZ - 0.23); put(S, B(0.07, 0.09, 0.11), 0xd0d6de, p[0], p[1], p[2], 0, 0, rz); }
      // corner brackets on the outer plate
      const cr = polyPt(6, 0, DOORY, 1.97, k), f = ROT(6) + (2 * Math.PI * k) / 6;
      { const g = plate(0.34, 0.1, 0.24, 0.04); g.rotateX(-Math.PI / 2); put(S, g, 0x454a54, cr[0], cr[1], DZ - 0.38, 0, 0, f); }
      // a thin light edge on the inner lip (the reference's edge highlight)
      p = at(1.535, 0, DZ - 0.305); put(S, B(1.6 * 1.0, 0.025, 0.02), 0x9aa3b0, p[0], p[1], p[2], 0, 0, rz);
    }
    // greebles on the bulkhead: vent bars above the frame, instrument boxes, conduit
    for (const y of [3.55, 3.85]) { put(S, plate(1.7, 0.08, 0.16, 0.05), STEEL, 0, y, DZ - 0.05, -Math.PI / 2); put(S, B(1.5, 0.05, 0.03), 0x0d0f12, 0, y, DZ - 0.1); }
    for (const sx of [-1, 1]) {
      put(S, plate(0.55, 0.14, 0.4, 0.04), STEELD, sx * 0.75, 3.7, DZ - 0.08, -Math.PI / 2);
      put(S, plate(0.5, 0.18, 0.9, 0.05), STEELD, sx * 1.15, -0.25, DZ - 0.12, -Math.PI / 2);
      put(S, plate(0.3, 0.06, 0.3, 0.02), PANEL, sx * 1.15, -0.25, DZ - 0.22, -Math.PI / 2);
      const c = cyl(0.05, 0.05, 3.0, 6); put(S, c, PIPE, sx * 2.3, 1.6, DZ - 0.1);
      // blinking warning lamps by the door
      put(S, B(0.3, 0.3, 0.12), STEELD, sx * 2.0, 3.0, DZ - 0.08);
      const dome = cyl(0.11, 0.13, 0.16, 8); dome.rotateX(Math.PI / 2); warnGeo.push(part(dome, 0xffffff, sx * 2.0, 3.0, DZ - 0.2));
      warnGlow.add(sx * 2.0, 3.0, DZ - 0.3, 1.0, 0xff3020, 0, 1, -70);
    }
    // gangway side of the bulkhead
    face(TS, 18, (m) => polyPt(6, 0, DOORY, OPA, m / 3), (m) => polyPt(6, 0, HEXY, HEXA, m / 3), G0, 2, [0, 0, 1], (m, r) => shade(WALL2, 0.7 + 0.15 * r), FLOOR - 0.01);
  }

  // ---- the sliding door halves (each half a hex with half a window; a 1 cm light seam between them) ----------------------
  function doorHalf(sx) {
    const DA = 1.58, DR = DA / COS30, WA = 0.4, WR = WA / COS30, WY = 0.2;
    const P = (pts) => pts.map(([x, y]) => new THREE.Vector2(sx * x, y));
    const sh = new THREE.Shape(P([[0.035, -DA], [DR / 2, -DA], [DR, 0], [DR / 2, DA], [0.035, DA]]));
    const win = P([[0.07, WY - WA], [WR / 2, WY - WA], [WR, WY], [WR / 2, WY + WA], [0.07, WY + WA]]);
    sh.holes.push(new THREE.Path(win));
    const l = [], e = [];
    put(l, slab(sh, 0.14, 0.03), 0x343942, 0, DOORY, DZ + 0.08);
    const ring = new THREE.Shape(P([[0.045, WY - 0.56], [0.56 / COS30 / 2, WY - 0.56], [0.56 / COS30, WY], [0.56 / COS30 / 2, WY + 0.56], [0.045, WY + 0.56]]));
    ring.holes.push(new THREE.Path(win));
    put(l, slab(ring, 0.03, 0.02), 0x4a505a, 0, DOORY, DZ + 0.01);
    const pf = (w, h, t, b, c, x, y) => put(l, plate(w, t, h, b), c, sx * x, DOORY + y, DZ + 0.05 - t / 2, -Math.PI / 2);
    pf(0.95, 0.42, 0.06, 0.03, 0x41464f, 0.7, 1.02);
    pf(1.1, 0.62, 0.06, 0.03, 0x41464f, 0.65, -0.9);
    pf(0.6, 0.12, 0.04, 0.015, 0x2a2e35, 0.75, -0.45);
    pf(0.05, 2.95, 0.025, 0.01, 0x9aa3b0, 0.065, 0);                                         // seam edge highlight
    pf(0.16, 0.7, 0.03, 0.02, 0x15171a, 0.28, -0.35);                                         // handle recess
    const bar = cyl(0.022, 0.022, 0.55, 5); put(l, bar, BRIGHT, sx * 0.28, DOORY - 0.35, DZ - 0.02);
    for (let i = 0; i < 4; i++) pf(0.09, 0.05, 0.02, 0.008, 0x8a6a2a, 0.13, -1.25 + i * 0.12);  // small marker ticks
    put(e, B(0.1, 0.06, 0.02), 0x40ff70, sx * 0.3, DOORY + 0.85, DZ + 0.0);
    const g = finishFlat(l, e, LA, [0.05, 0.055, 0.07]);
    const m = flat(g); return m;
  }
  const doorL = doorHalf(-1), doorR = doorHalf(1);
  interior.add(doorL, doorR);

  // ======== GANGWAY ===========================================================================================================
  {
    const NB = Math.round((BZ - G0) / 3);                    // 3 m bays
    const ribZ = []; for (let m = 0; G0 + 1.5 + 3 * m < BZ - 1.3; m++) ribZ.push(G0 + 1.5 + 3 * m);
    const seams = []; for (let b = 1; b < NB; b++) seams.push(G0 + 3 * b);
    // wall with a shallow panel seam groove half-way between ribs
    const zs = []; for (let z = G0; z < BZ - 0.01; z += 0.75) zs.push(z); zs.push(BZ);
    for (const s of seams) zs.push(s - 0.025, s + 0.025);
    zs.sort((a, b) => a - b);
    const prof = zs.map((z) => [HEXA, z]);
    sweep(TS, 6, 0, HEXY, prof, (i, j, z, p0, p1) => {
      if (seams.some((s) => Math.abs(z - s) < 0.01)) return 0x0c0d10;
      const b = Math.floor((z - G0 + 1.5) / 3);
      const k = (i === 0 ? 0.55 : i === 3 ? 0.8 : i === 1 || i === 5 ? 1.0 : 0.92) * (0.88 + 0.2 * hash(i, b));
      return shade(i === 3 ? WALL2 : WALL, k);
    }, -1, 1);
    // ribs every 3 m; a heavy frame with a hazard band every 12 m (progress markers)
    ribZ.forEach((zr, m) => {
      const heavy = m % 4 === 2;
      const d = heavy ? 0.34 : 0.2, w = heavy ? 0.45 : 0.22;
      sweep(TS, 6, 0, HEXY, [[HEXA, zr - w], [HEXA - d, zr - w * 0.6], [HEXA - d, zr + w * 0.6], [HEXA, zr + w]],
        (i, j, z, p0, p1, s) => j !== 1 ? (heavy ? STEELD : 0x4f5560) : heavy ? (s % 2 ? HAZK : HAZY) : RIB, -1, heavy ? 4 : 1, [1, 2, 3, 4, 5]);
      if (heavy) put(S, plate(2.1, 0.05, 0.7, 0.03), STEEL, 0, FLOOR + 0.035, zr);
      // pipe brackets on the lower walls
      for (const [k, su] of [[1, 1], [5, -1]]) onSide(S, plate(0.12, 0.2, 0.1, 0.02), STEELD, 6, 0, HEXY, HEXA, k, su * 0.05, zr + 0.3, 0.1);
    });
    const end = BZ - 0.5;
    for (let b = 0; b < NB; b++) {
      const z0 = G0 + 3 * b - 1.5, za = Math.max(G0, z0), zb = Math.min(end, z0 + 3), zc = (za + zb) / 2, len = zb - za;
      if (len < 0.3) continue;
      // pipes (lower sides) and cable trays (upper sides), split per bay so the baked light varies along them
      for (const [k, su] of [[1, 1], [5, -1]]) {
        const p1 = cyl(0.075, 0.075, len, 6, true); p1.rotateX(Math.PI / 2); onSide(S, p1, PIPE, 6, 0, HEXY, HEXA, k, su * -0.05, zc, 0.12);
        const p2 = cyl(0.05, 0.05, len, 6, true); p2.rotateX(Math.PI / 2); onSide(S, p2, b % 3 === 1 ? PIPER : PIPE, 6, 0, HEXY, HEXA, k, su * 0.2, zc, 0.1);
      }
      for (const [k, su] of [[2, 1], [4, -1]]) {
        onSide(S, B(0.5, 0.03, len - 0.05), STEELD, 6, 0, HEXY, HEXA, k, su * 0.72, zc, 0.06);
        onSide(S, B(0.03, 0.12, len - 0.05), STEELD, 6, 0, HEXY, HEXA, k, su * 0.47, zc, 0.1);
        for (let c = 0; c < 2; c++) { const g = cyl(0.045, 0.045, len - 0.05, 4, true); g.rotateX(Math.PI / 2); onSide(S, g, c === 1 ? 0x3a2e28 : CABLE, 6, 0, HEXY, HEXA, k, su * (0.62 + c * 0.14), zc, 0.11); }
        // equipment boxes, different in every bay
        const r = hash(k * 7 + b, b);
        if (b > 0 && r < 0.75) {
          const w = 0.45 + 0.4 * hash(b, k), dd = 0.6 + 1.0 * hash(k, b + 3), t = 0.1 + 0.14 * hash(b + 9, k);
          onSide(S, plate(w, t, dd, 0.04), r < 0.35 ? STEELD : 0x50565f, 6, 0, HEXY, HEXA, k, su * -0.25, zc + (hash(b, 2) - 0.5) * 0.8, t / 2 + 0.01);
          if (r < 0.5) onSide(E, B(0.05, 0.02, 0.05), r < 0.2 ? 0x60ff80 : 0xffb040, 6, 0, HEXY, HEXA, k, su * (-0.25 - w / 4), zc, t + 0.02);
        }
      }
      // inset panel on the slanted sides
      for (const k of [1, 2, 4, 5]) if (b > 0 && hash(b, k + 20) < 0.55) onSide(S, plate(1.0, 0.025, len - 0.9, 0.012), PANEL, 6, 0, HEXY, HEXA, k, (k === 2 || k === 5 ? -1 : 1) * 0.25 * (k < 3 ? 1 : -1) * 0, zc, 0.013);
      // ceiling: a lamp every 6 m, vents between
      if (b % 2 === 1) {
        onSide(S, plate(1.25, 0.12, 0.42, 0.04), STEELD, 6, 0, HEXY, HEXA, 3, 0, zc, 0.06);
        onSide(E, B(1.05, 0.03, 0.26), LAMP, 6, 0, HEXY, HEXA, 3, 0, zc, 0.135);
        glows.add(0, HEXY + HEXA - 0.2, zc, 1.5, 0x7d8aa0, 0, 1.0, zc - 30);
        LG.push(mkLight(0, HEXY + HEXA - 0.4, zc, LAMP, 1.9, 6.4));
      } else if (b > 0) {
        onSide(S, plate(1.2, 0.04, 1.1, 0.03), PANEL, 6, 0, HEXY, HEXA, 3, 0, zc, 0.02);
        for (let s = 0; s < 5; s++) onSide(S, B(1.0, 0.03, 0.05), 0x0e1013, 6, 0, HEXY, HEXA, 3, 0, zc - 0.4 + s * 0.2, 0.045);
      }
      // dashed light strips at the side corners (eye height) and floor guide lights: motion cues when running
      for (const sx of [-1, 1]) for (const dz of [-0.75, 0.75]) {
        const z = zc + dz; if (z > end) continue;
        put(E, B(0.05, 0.04, 0.7), STRIP, sx * (HEXR - 0.07), HEXY, z);
        put(E, B(0.07, 0.02, 0.14), z > BZ - 9 ? GUIDEA : GUIDE, sx * 1.06, FLOOR + 0.09, z);
      }
      // kerbs along the floor edges
      for (const sx of [-1, 1]) put(S, B(0.18, 0.08, len), STEELD, sx * 1.06, FLOOR + 0.04, zc);
      // red warning lamps every 12 m
      if (b % 4 === 2) for (const [k, su] of [[2, -1], [4, 1]]) {
        const g = onSide(S, B(0.32, 0.08, 0.32), STEELD, 6, 0, HEXY, HEXA, k, su * 0.4, zc, 0.04);
        const th = ROT(6) + (Math.PI * (2 * k + 1)) / 6, x = Math.cos(th) * (HEXA - 0.15) - Math.sin(th) * su * 0.4, y = HEXY + Math.sin(th) * (HEXA - 0.15) + Math.cos(th) * su * 0.4;
        const dome = cyl(0.1, 0.12, 0.16, 8); dome.rotateZ(th + Math.PI / 2 + Math.PI); warnGeo.push(part(dome, 0xffffff, x, y, zc));
        warnGlow.add(x * 0.97, y, zc - 0.1, 1.1, 0xff3020, 0, 1, zc - 40);
        LG.push(mkLight(x * 0.9, y, zc, 0xff2a18, 0.35, 2.5));
        void g;
      }
    }
    grating(-0.96, 0.96, G0, BZ, FLOOR + 0.015, 1.5);
    // the mouth: a heavy frame with a hazard flange on the bay side
    sweep(TS, 6, 0, HEXY, [[HEXA, BZ - 0.55], [HEXA - 0.3, BZ - 0.45], [HEXA - 0.3, BZ + 0.05], [HEXA + 0.8, BZ + 0.16], [HEXA + 0.8, BZ]],
      (i, j, z, p0, p1, s) => j === 2 ? (s % 2 ? HAZK : HAZY) : j === 1 ? RIB : STEELD, -1, 4, [1, 2, 3, 4, 5]);
    // light spilling in from the bay
    LG.push(mkLight(0, 2.0, BZ + 2, 0xffe0b0, 1.7, 11), mkLight(0, 1.0, DZ + 1.5, 0x9fb4d0, 0.7, 4));
  }

  // ======== BAY ===============================================================================================================
  {
    const BL = (x, y, z, i, R, c = LAMPW) => LB.push(mkLight(x, y, z, c, i * 0.38, R));
    // work lights: housing + lens aimed at the Xi, glow toward the ledge, baked light
    const o = new THREE.Object3D();
    function workLight(x, y, z, tx, ty, tz, i = 5, R = 24, big = 1) {
      o.position.set(x, y, z); o.lookAt(tx, ty, tz); const r = o.rotation, d = new THREE.Vector3(tx - x, ty - y, tz - z).normalize();
      put(S, B(1.1 * big, 0.75 * big, 0.6 * big), STEELD, x, y, z, r.x, r.y, r.z);
      put(S, B(0.2, 0.2, 0.9), STEELD, x - d.x * 0.5, y - d.y * 0.5 - 0.3, z - d.z * 0.5, r.x, r.y, r.z);
      put(E, B(0.95 * big, 0.6 * big, 0.04), LAMPW, x + d.x * 0.31 * big, y + d.y * 0.31 * big, z + d.z * 0.31 * big, r.x, r.y, r.z);
      glows.add(x + d.x * 0.5, y + d.y * 0.5, z + d.z * 0.5, 4.5 * big, 0xb0a890, EYE[0], EYE[1], EYE[2]);
      BL(x + d.x * 1.5, y + d.y * 1.5, z + d.z * 1.5, i, R);
    }
    // hull wall: 24 sides, panels, darker below the deck
    const zs = []; for (let z = BZ; z < BEND - 0.01; z += 2.75) zs.push(z); zs.push(BEND);
    sweep(TS, 24, 0, HULL_Y, zs.map((z) => [BAYA, z]), (i, j, z, p0, p1, s) => {
      const k = 0.75 + 0.25 * hash(i, j) + (s ? 0.06 : 0);
      return shade(i % 3 === 0 ? WALL2 : WALL, k * (i < 3 || i > 21 ? 0.45 : 0.75));
    }, -1, 1);
    // ring frames and longitudinal stringers
    const rings = [-9.5, -3.5, 2.5, 8.5, 14.5];
    for (const zr of rings) sweep(TS, 24, 0, HULL_Y, [[BAYA, zr - 0.55], [BAYA - 0.95, zr - 0.38], [BAYA - 0.95, zr + 0.38], [BAYA, zr + 0.55]], (i, j) => j === 1 ? RIB : STEELD, -1, 1);
    const zb = [BZ, ...rings, BEND];
    for (let s = 0; s < 24; s += 3) for (let q = 0; q + 1 < zb.length; q++) {
      const a = zb[q] + 0.55, b = zb[q + 1] - 0.55; if (b - a < 0.5) continue;
      onSide(S, B(0.45, 0.45, b - a), STEELD, 24, 0, HULL_Y, BAYA, s, 0, (a + b) / 2, 0.22);
    }
    // front bulkhead (the gangway comes out of it) and rear wall
    const hexAt = (u) => {
      const o2 = polyPt(24, 0, HULL_Y, BAYA, u / 2), phi = Math.atan2(o2[1] - HEXY, o2[0]);
      const tn = Math.PI / 6 + (Math.PI / 3) * Math.round((phi - Math.PI / 6) / (Math.PI / 3)), r = (HEXA + 0.55) / Math.cos(phi - tn);
      return [Math.cos(phi) * r, HEXY + Math.sin(phi) * r];
    };
    face(TS, 48, hexAt, (m) => polyPt(24, 0, HULL_Y, BAYA, m / 2), BZ, 6, [0, 0, 1], (m, r) => shade(r % 2 ? WALL2 : WALL, 0.65 + 0.2 * hash(m >> 1, r)));
    face(TS, 48, (m) => polyPt(24, 0, HULL_Y, 1.5, m / 2), (m) => polyPt(24, 0, HULL_Y, BAYA, m / 2), BEND, 5, [0, 0, -1], (m, r) => shade(r % 2 ? WALL2 : WALL, 0.6 + 0.2 * hash(m >> 1, r + 7)));
    // bulkhead beams, an observation window, the rear doors' outline
    for (const [x, y, w, h] of [[-5.5, 6, 0.6, 12], [5.5, 6, 0.6, 12], [-5.5, -12, 0.6, 14], [5.5, -12, 0.6, 14], [0, 8.5, 9, 0.6], [0, -6.5, 10, 0.6], [-11, -2, 6, 0.6], [11, -2, 6, 0.6]])
      put(S, plate(w, 0.45, h, 0.12), STEELD, x, y, BZ + 0.22, Math.PI / 2);
    put(S, plate(4.6, 0.4, 1.6, 0.1), DARK, -9, 4.5, BZ + 0.2, Math.PI / 2);
    put(E, B(4.1, 1.1, 0.05), 0x2e6070, -9, 4.5, BZ + 0.42);
    for (const x of [-10.2, -9, -7.8]) put(S, B(0.08, 1.1, 0.08), DARK, x, 4.5, BZ + 0.46);
    for (const sx of [-1, 1]) {
      put(S, plate(0.8, 0.5, 26, 0.15), STEELD, sx * 7.5, -7, BEND - 0.25, Math.PI / 2);
      for (let i = 0; i < 9; i++) put(S, B(0.7, 1.2, 0.1), i % 2 ? HAZK : HAZY, sx * 7.5, -19 + i * 1.4, BEND - 0.52);
      // red beacons by the mouth
      put(S, B(0.4, 0.4, 0.2), STEELD, sx * 3.4, 3.6, BZ + 0.1);
      const dome = cyl(0.14, 0.16, 0.2, 8); dome.rotateX(Math.PI / 2); warnGeo.push(part(dome, 0xffffff, sx * 3.4, 3.6, BZ + 0.3));
      warnGlow.add(sx * 3.4, 3.6, BZ + 0.45, 1.6, 0xff3020, 0, 1, BZ - 30);
    }
    put(S, plate(15, 0.5, 0.8, 0.15), STEELD, 0, 5.5, BEND - 0.25, Math.PI / 2);
    // deck plates with safety lines
    const DW = 9.3;
    for (let ix = 0; ix < 6; ix++) for (let iz = 0; iz < 10; iz++) {
      const x0 = -DW + (ix * 2 * DW) / 6, z0 = BZ + (iz * (BEND - BZ)) / 10, w = (2 * DW) / 6, d = (BEND - BZ) / 10;
      TS.quad([x0, DECK, z0], [x0 + w, DECK, z0], [x0 + w, DECK, z0 + d], [x0, DECK, z0 + d], shade(0x3c4048, 0.85 + 0.3 * hash(ix, iz)), [0, 1, 0]);
    }
    for (const sx of [-1, 1]) put(S, B(0.25, 0.02, BEND - BZ - 1), HAZY, sx * 6.6, DECK + 0.01, (BZ + BEND) / 2);
    // foot clamps
    for (const sx of [-1, 1]) { put(S, plate(3.4, 0.8, 5.5, 0.25), STEELD, sx * 4.2, DECK + 0.4, 3.5); put(S, B(0.6, 1.6, 4.8), STEEL, sx * 6.4, DECK + 0.8, 3.5); }
    // gantry towers with clamp arms at the shoulders and hips
    for (const sx of [-1, 1]) {
      const tx = sx * 13, tz = 1.5, top = 7.2, hgt = top - DECK, post = 0.34, half = 0.85;
      for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) put(S, B(post, hgt, post), dx * sx < 0 ? STEEL : STEELD, tx + dx * half, DECK + hgt / 2, tz + dz * half);
      for (let y = DECK + 2.5; y < top; y += 3.4) {
        for (const dz of [-1, 1]) put(S, B(2 * half, 0.22, 0.22), STEELD, tx, y, tz + dz * half);
        for (const dx of [-1, 1]) put(S, B(0.22, 0.22, 2 * half), STEELD, tx + dx * half, y, tz);
        if (y + 3.4 < top) { const L = Math.hypot(2 * half, 3.4), a = Math.atan2(2 * half, 3.4); put(S, B(0.14, L, 0.14), STEELD, tx - sx * half, y + 1.7, tz, a * (y % 2 > 1 ? 1 : -1), 0, 0); }
      }
      // arms: box beam + clamp head (back plate and two jaws)
      for (const [y, x1, z1, big] of [[3.2, 9.9, 1.0, 1], [-9.0, 8.7, 0.5, 0.85]]) {
        const x0 = tx - sx * half, len = Math.abs(x0) - x1, cx = sx * (x1 + len / 2);
        put(S, plate(len, 0.9 * big, 0.9 * big, 0.12), STEEL, cx, y, z1, 0, 0, 0);
        put(S, B(len * 0.8, 0.12, 0.12), HAZY, cx, y + 0.5 * big, z1 - 0.46 * big);
        put(S, plate(0.5, 2.6 * big, 2.6 * big, 0.12), STEELD, sx * (x1 + 0.25), y, z1);
        for (const dy of [-1, 1]) put(S, plate(1.6, 0.45, 2.2 * big, 0.1), STEEL, sx * (x1 - 0.5), y + dy * 1.15 * big, z1, dy < 0 ? Math.PI : 0, 0, 0);
        const hyd = cyl(0.15, 0.15, len * 0.7, 6); hyd.rotateZ(Math.PI / 2); put(S, hyd, BRIGHT, cx, y - 0.75 * big, z1);
      }
      workLight(tx - sx * 1.2, top - 0.8, tz - 2.5, sx * 3, 2, -4, 5.5, 24, 1.1);
      workLight(tx - sx * 1.2, DECK + 4, tz - 2.5, sx * 3, -10, -4, 4, 18, 0.9);
    }
    // overhead crane: rails along the ceiling, a bridge behind the head
    for (const sx of [-1, 1]) put(S, plate(0.7, 0.9, BEND - BZ - 2, 0.12), STEELD, sx * 6, 11.2, (BZ + BEND) / 2, Math.PI, 0, 0);
    put(S, B(12.6, 1.0, 1.1), STEEL, 0, 10.4, 9.5); put(S, B(2.2, 1.0, 1.8), STEELD, 2.2, 9.6, 9.5); put(S, B(0.12, 3, 0.12), CABLE, 2.2, 7.7, 9.5);
    // work lights on the ring frames
    for (const [x, y, z, tx, ty, tz, i, R] of [[-12.4, 9.5, -9.2, -2, 0, 0, 5.5, 26], [12.4, 9.5, -9.2, 2, 0, 0, 5.5, 26], [-16.5, -6, -3.2, -4, -6, 2, 4.5, 22], [16.5, -6, -3.2, 4, -6, 2, 4.5, 22],
      [-11, 11.5, 14.2, -2, 0, 4, 4.5, 24], [11, 11.5, 14.2, 2, 0, 4, 4.5, 24], [0, 12.5, -9.2, 0, 2, 0, 4, 20], [-9, -19.5, -11.5, -3, -10, 0, 4, 18], [9, -19.5, -11.5, 3, -10, 0, 4, 18]]) workLight(x, y, z, tx, ty, tz, i, R);
    BL(0, -5, 4, 1.2, 30, 0x9fb0c8);
    // the ledge at the gangway mouth: plate, braces, hazard kick plate, railing
    const LD = 2.8, LZ = BZ + LD;
    put(S, plate(4.4, 0.3, LD, 0.06), STEELD, 0, FLOOR - 0.15, BZ + LD / 2);
    grating(-2.05, 2.05, BZ + 0.15, LZ - 0.05, FLOOR + 0.015, 0.8);
    for (const sx of [-1, 1]) put(S, B(0.22, 3.4, 0.22), STEELD, sx * 1.7, FLOOR - 1.4, BZ + 1.2, 0.8, 0, 0);
    for (let i = 0; i < 10; i++) put(S, B(0.44, 0.16, 0.04), i % 2 ? HAZK : HAZY, -1.98 + i * 0.44, FLOOR + 0.08, LZ - 0.03);
    for (let i = 0; i < 5; i++) put(S, B(0.06, 1.05, 0.06), STEELD, -2.05 + i * 1.025, FLOOR + 0.52, LZ - 0.12);
    for (const y of [1.05, 0.55]) { put(S, B(4.1, 0.06, 0.06), y > 1 ? 0x8a6a2a : STEELD, 0, FLOOR + y, LZ - 0.12); for (const sx of [-1, 1]) put(S, B(0.06, 0.06, LD - 0.2), STEELD, sx * 2.05, FLOOR + y, BZ + LD / 2 + 0.05); }
    for (const sx of [-1, 1]) put(S, B(0.06, 1.05, 0.06), STEELD, sx * 2.05, FLOOR + 0.52, BZ + 0.2);
  }

  // ---- interior meshes -------------------------------------------------------------------------------------------------------
  S.push(TS.geo());
  const interiorStatic = flat(finishFlat(S, E, [...LA, ...LG, ...LB], [0.03, 0.034, 0.045]));
  interior.add(interiorStatic);
  // CR-010: a near-black shell just outside every interior wall. The modelled walls have hairline gaps at their seams and
  // some are single-sided; without this the sky and the sea showed through them.
  const backing = (() => {
    const list = [], BK = 0x06070a;
    const tubeZ = (r, z0, z1, seg, cy) => { const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg, 1, true); g.rotateX(Math.PI / 2); return put(list, g, BK, 0, cy, (z0 + z1) / 2); };
    const RA = AIRR + 0.9, RB = BAYR + 0.9;
    tubeZ(RA, BACK - 0.7, BZ + 0.2, 12, AIRY);                                              // round the airlock and the gangway
    put(list, new THREE.CircleGeometry(RA, 12), BK, 0, AIRY, BACK - 0.7);                      // behind the outer hatch
    tubeZ(RB, BZ - 0.6, BEND + 0.9, 24, HULL_Y);                                             // round the bay
    put(list, new THREE.CircleGeometry(RB, 24), BK, 0, HULL_Y, BEND + 0.9);                    // behind the bay's rear wall
    {
      // behind the bay's front bulkhead: a disc with a hole where the gangway comes through (the hole is at the GANGWAY's height)
      const sh = new THREE.Shape(); sh.absarc(0, HULL_Y, RB, 0, Math.PI * 2, false);
      const hole = new THREE.Path(); hole.absarc(0, AIRY, RA - 0.4, 0, Math.PI * 2, true); sh.holes.push(hole);
      put(list, new THREE.ShapeGeometry(sh, 24), BK, 0, 0, BZ - 0.6);
    }
    const g = merge(list); g.deleteAttribute('normal');
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })); m.frustumCulled = false;
    return m;
  })();
  interior.add(backing);
  // the same static geometry is shown through the open cockpit hatch at the story cold start (render/hatch.js)
  api.bayGeometries = [interiorStatic.geometry, backing.geometry];
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(GR.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(GR.uv, 2));
    const n = GR.pos.length / 3, nrm = new Float32Array(n * 3), col = new Float32Array(n * 3).fill(1.3);
    for (let i = 0; i < n; i++) nrm[i * 3 + 1] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    bake(g, [...LA, ...LG, ...LB], [0.03, 0.034, 0.045]); g.deleteAttribute('normal');
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: gratTex, vertexColors: true })); m.frustumCulled = false;
    interior.add(m);
  }
  interior.add(glows.mesh(glowTex, 0.9));
  // red warning lamps (blink together)
  const warnMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const warn = new THREE.Mesh(merge(warnGeo.map((g) => { g.deleteAttribute('uv'); g.deleteAttribute('normal'); g.deleteAttribute('color'); return g.index ? g.toNonIndexed() : g; })), warnMat);
  warn.frustumCulled = false; interior.add(warn);
  const warnGlowMesh = warnGlow.mesh(glowTex, 0.8); interior.add(warnGlowMesh);

  let xi = null;
  onXiReady(() => {
    xi = makeXiSuit(shared);
    xi.root.position.set(-XI_COCKPIT.x, -XI_COCKPIT.y, -XI_COCKPIT.z);
    xi.pose(0, { raise: false, rifle: true, snap: true });
    interior.add(xi.root);
  });

  const hullHalves = [];                                                         // [left (x < 0), right]
  // ======== EXTERIOR (CR-010): a boxy armoured cargo container, axis along Z, front toward -Z, and its fire trail ============
  // Octagonal box section (flat top / bottom / sides with wide chamfered corners): armour panels with seams, frame rings,
  // corner longerons, side cargo doors with hazard edges, a flat scorched heat plate on the front and the underside, braking
  // thruster pods at the four rear corners and retro blocks at the front. No nose cone, no fins.
  const SHELL = 0x9aa0a6, SHELL2 = 0x868d94, CHAR = 0x2e2824, SCORCH = 0x5a4434, BAND = 0xd0662a, STEELX = 0x5e6670, DARKX = 0x23262b, HAZX = 0xc9962c;
  const XA = HULL_R + 0.5;                                                       // apothem of the box section (clears the bay)
  {
    const T = Tris(), parts = [], n = 8;
    // side k: 0 = bottom, 2 / 6 = the two walls, 4 = top, odd = the chamfers
    const scorch = (i, z) => {
      const low = i === 0 ? 1 : (i === 1 || i === 7) ? 0.7 : (i === 2 || i === 6) ? 0.18 : 0;
      const front = saturate((HULL_Z1 - z) / (HULL_Z1 - HULL_Z0));
      return saturate(low * (0.45 + 0.5 * front) * (0.7 + 0.6 * hash(i, Math.floor(z / 5.75))) + 0.12 * front * front);
    };
    // armour panels: rows 5.75 m long with a recessed dark seam between rows; each face split in two columns
    const ROW = 5.75, body = [];
    for (let z = HULL_Z0; z < HULL_Z1 - 0.01; z += ROW) body.push([XA - 0.18, z], [XA - 0.18, z + 0.22], [XA, z + 0.22], [XA, z + ROW]);
    body.push([XA - 0.18, HULL_Z1]);
    sweep(T, n, 0, HULL_Y, body, (i, j, z, p0, p1, sIdx) => {
      if (p0[0] !== p1[0] || p0[0] < XA - 0.01) return 0x33373d;                 // seams
      const row = Math.floor((z - HULL_Z0) / ROW), base = shade((row + sIdx + i) % 2 ? SHELL2 : SHELL, 0.92 + 0.12 * hash(i * 7 + sIdx, row));
      const sc = scorch(i, z);
      return mix(base, sc > 0.6 ? CHAR : SCORCH, sc * 1.1);
    }, 1, 2);
    // frame rings (heavier at both ends)
    for (let z = HULL_Z0 + ROW * 2; z < HULL_Z1 - 1; z += ROW * 2) sweep(T, n, 0, HULL_Y, [[XA, z - 0.55], [XA + 0.6, z - 0.4], [XA + 0.6, z + 0.4], [XA, z + 0.55]], (i, j, zz) => mix(j === 1 ? STEELX : DARKX, CHAR, scorch(i, zz) * 0.8), 1);
    for (const [z0, z1] of [[HULL_Z0, HULL_Z0 + 2.2], [HULL_Z1 - 2.2, HULL_Z1]]) sweep(T, n, 0, HULL_Y, [[XA, z0], [XA + 0.9, z0], [XA + 0.9, z1], [XA, z1]], (i, j, zz) => mix(j === 1 ? STEELX : DARKX, CHAR, scorch(i, zz) * 0.7), 1);
    // identity stripe (not on the scorched underside)
    sweep(T, n, 0, HULL_Y, [[XA + 0.02, HULL_Z0 + 5], [XA + 0.2, HULL_Z0 + 5.1], [XA + 0.2, HULL_Z0 + 7.4], [XA + 0.02, HULL_Z0 + 7.5]], () => BAND, 1, 1, [2, 3, 4, 5, 6]);
    // front: chamfered rim down to a flat, scorched heat plate with a centre boss
    sweep(T, n, 0, HULL_Y, [[0, HULL_Z0 - 3], [XA - 6, HULL_Z0 - 3], [XA - 2.5, HULL_Z0 - 1.6], [XA + 0.9, HULL_Z0]], (i, j) => j === 0 ? shade(CHAR, 0.8 + 0.25 * hash(i, 1)) : j === 1 ? mix(CHAR, SCORCH, 0.4 + 0.3 * hash(i, 2)) : mix(STEELX, CHAR, 0.6), 1);
    sweep(T, n, 0, HULL_Y, [[0, HULL_Z0 - 3.7], [5, HULL_Z0 - 3.7], [6.2, HULL_Z0 - 3]], (i, j) => shade(0x4a3a30, 0.8 + 0.2 * j), 1);
    // rear: recessed plate between the thruster pods, a docking collar in the middle
    sweep(T, n, 0, HULL_Y, [[XA + 0.9, HULL_Z1], [XA - 2, HULL_Z1 + 1.2], [0, HULL_Z1 + 1.2]], (i, j) => j === 0 ? STEELX : shade(DARKX, 1 + 0.3 * hash(i, 5)), 1);
    sweep(T, 12, 0, HULL_Y, [[5.2, HULL_Z1 + 1.2], [5.2, HULL_Z1 + 2.6], [4.2, HULL_Z1 + 2.6], [4.2, HULL_Z1 + 1.3], [0, HULL_Z1 + 1.3]], (i, j) => j === 1 ? STEELX : j === 4 ? 0x0e0c0b : DARKX, 1);
    parts.push(T.geo());
    // pieces placed on a face: onSide's +Y is inward, so a negative lift sits on the outside
    const on = (geo, c, k, u, z, out) => onSide(parts, geo, c, n, 0, HULL_Y, XA, k, u, z, -out);
    const HLEN = HULL_Z1 - HULL_Z0, HMID = (HULL_Z0 + HULL_Z1) / 2, FW = 2 * XA * Math.tan(Math.PI / 8);   // FW: width of one face
    // corner longerons along the four chamfers, with tie plates at every second frame
    for (const k of [1, 3, 5, 7]) {
      on(B(2.4, 0.9, HLEN - 4.6), k === 1 || k === 7 ? 0x2a2622 : DARKX, k, 0, HMID, 0.45);
      for (let z = HULL_Z0 + ROW * 2; z < HULL_Z1 - 1; z += ROW * 4) on(plate(4.2, 0.5, 2.6, 0.3), STEELX, k, 0, z, 1.0);
    }
    // cargo doors on both walls: a raised door slab, hazard-striped edges, hinge blocks, a small hatch and a number plate
    for (const k of [2, 6]) {
      for (const zc of [-48, -6]) {
        on(plate(FW - 3.2, 0.5, 17, 0.35), shade(SHELL2, 0.9), k, 0, zc, 0.25);
        on(B(0.16, 0.14, 16.2), DARKX, k, 0, zc, 0.52);                                             // the split between the two leaves
        for (const sz of [-1, 1]) for (let i = 0; i < 14; i++) on(B((FW - 3.6) / 14, 0.08, 0.5), i % 2 ? 0x1c1c1c : HAZX, k, -(FW - 3.6) / 2 + (i + 0.5) * (FW - 3.6) / 14, zc + sz * 8.9, 0.06);
        for (const su of [-1, 1]) for (const dz of [-6, 0, 6]) on(plate(0.9, 0.7, 1.6, 0.2), STEELX, k, su * (FW / 2 - 1.3), zc + dz, 0.35);
      }
      on(plate(3.2, 0.4, 4.4, 0.25), STEELX, k, 2.2, -27, 0.2); on(B(1.6, 0.1, 0.3), 0xd8dbe0, k, 2.2, -28.4, 0.45);
      on(plate(4.6, 0.3, 2.2, 0.15), 0xd8dbe0, k, -3.4, -66, 0.15);                                 // pale number plate (blank)
      for (let i = 0; i < 9; i++) on(B(0.5 + hash(k, i) * 1.6, 0.25 + hash(i, k) * 0.5, 0.6 + hash(k + 3, i) * 2.2), hash(i, 9) > 0.5 ? STEELX : DARKX, k, -5.5 + hash(i, 4) * 11, HULL_Z0 + 9 + i * 9.4 + hash(i, k) * 3, 0.2);
    }
    // top: spine conduit, vent boxes, antenna mast and dish, lifting lugs
    on(B(1.4, 0.6, HLEN - 10), STEELX, 4, 0, HMID, 0.3);
    for (let z = HULL_Z0 + 8; z < HULL_Z1 - 6; z += 11.5) { on(plate(3.4, 0.9, 2.6, 0.3), DARKX, 4, 3.6, z, 0.45); on(plate(2.2, 0.6, 3.4, 0.2), STEELX, 4, -3.8, z + 4, 0.3); }
    for (const z of [HULL_Z0 + 4, HULL_Z1 - 4]) for (const su of [-1, 1]) on(plate(1.6, 1.2, 1.6, 0.4), STEELX, 4, su * 5.5, z, 0.6);
    put(parts, B(0.35, 6, 0.35), STEELX, -2, HULL_Y + XA + 3, 4);
    { const d = cyl(1.8, 0.3, 0.9, 12, true); d.rotateX(-0.5); put(parts, d, 0xd8dbe0, -2, HULL_Y + XA + 6.2, 4.2); }
    put(parts, B(0.12, 5, 0.12), STEELX, 4, HULL_Y + XA + 2.4, -40, -0.4, 0, -0.15);
    // underside: heat tiles in a slightly raised field
    for (let z = HULL_Z0 + 3; z < HULL_Z1 - 3; z += 5.75) for (let i = 0; i < 3; i++) on(plate(FW / 3 - 0.3, 0.3, 5.3, 0.2), shade(CHAR, 0.75 + 0.4 * hash(i, z)), 0, (i - 1) * (FW / 3), z + 2.9, 0.15);
    // braking thruster pods on the four rear chamfers: a box, two nozzles firing down / outward, intake slats
    for (const k of [1, 3, 5, 7]) {
      on(plate(6.2, 3.6, 13, 0.8), SHELL2, k, 0, HULL_Z1 - 9, 1.8);
      on(B(6.6, 0.5, 1.2), DARKX, k, 0, HULL_Z1 - 15.2, 1.6);
      for (let i = 0; i < 4; i++) on(B(4.6, 0.15, 0.5), DARKX, k, 0, HULL_Z1 - 12.5 + i * 1.1, 3.65);
      for (const dz of [-6.2, -1.6]) { const g = cyl(1.5, 1.0, 1.6, 10); on(g, DARKX, k, 0, HULL_Z1 + dz - 2, 4.3); const h = cyl(0.85, 0.85, 0.2, 10); on(h, 0x0e0c0b, k, 0, HULL_Z1 + dz - 2, 5.15); }
      { const g = cyl(1.9, 1.3, 2.4, 10); g.rotateX(Math.PI / 2); on(g, DARKX, k, 0, HULL_Z1 - 1.4, 1.9); }   // rear-firing nozzle
    }
    // retro blocks near the front, on the walls and the top
    for (const k of [2, 4, 6]) for (const su of [-1, 1]) {
      on(plate(2.6, 1.3, 3.6, 0.3), STEELX, k, su * (FW / 2 - 2.2), HULL_Z0 + 11.5, 0.65);
      for (const dz of [-1, 0, 1]) { const g = cyl(0.3, 0.42, 0.5, 8); on(g, DARKX, k, su * (FW / 2 - 2.2), HULL_Z0 + 11.5 + dz, 1.5); }
    }
    const geos = parts.map((g) => { g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1)); return g; });
    // CR-011: split the hull down its centre line into two halves; at the release they are blown apart sideways and the Xi
    // comes out between them (before this the suit simply passed through the wall). Both sides are drawn, so the pilot
    // sees the inside of the shell opening around him.
    const whole = merge(geos), names = Object.keys(whole.attributes), src = {}, half = [{}, {}];
    for (const k of names) { src[k] = whole.attributes[k]; half[0][k] = []; half[1][k] = []; }
    const P = src.position;
    for (let v = 0; v < P.count; v += 3) {
      const h = P.getX(v) + P.getX(v + 1) + P.getX(v + 2) < 0 ? 0 : 1;
      for (const k of names) { const at = src[k], n = at.itemSize; for (let j = 0; j < 3 * n; j++) half[h][k].push(at.array[v * n + j]); }
    }
    for (let h = 0; h < 2; h++) {
      const g = new THREE.BufferGeometry();
      for (const k of names) g.setAttribute(k, new THREE.Float32BufferAttribute(half[h][k], src[k].itemSize));
      const m = lit(g, THREE.DoubleSide); hullHalves.push(m); exterior.add(m);
    }
  }

  // ---- billboard particle batches: one draw call each; per-particle centre, size, rotation, colour, alpha ----------------
  function puffs(N, tex, blending, depthTest = true, order = 0) {
    const pos = new Float32Array(N * 12), ap = new Float32Array(N * 8), ac = new Float32Array(N * 16), cor = new Float32Array(N * 8), idx = [];
    const cs = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5];
    for (let i = 0; i < N; i++) { cor.set(cs, i * 8); idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3); }
    const g = new THREE.BufferGeometry();
    const aPos = new THREE.BufferAttribute(pos, 3), aP = new THREE.BufferAttribute(ap, 2), aC = new THREE.BufferAttribute(ac, 4);
    aPos.setUsage(THREE.DynamicDrawUsage); aP.setUsage(THREE.DynamicDrawUsage); aC.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', aPos); g.setAttribute('aP', aP); g.setAttribute('aC', aC); g.setAttribute('corner', new THREE.BufferAttribute(cor, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } }, transparent: true, depthWrite: false, depthTest, blending,
      vertexShader: /* glsl */ `
        attribute vec2 corner; attribute vec2 aP; attribute vec4 aC;
        varying vec2 vUv; varying vec4 vC;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float c = cos(aP.y), s = sin(aP.y);
          mv.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * aP.x;
          vUv = corner + 0.5; vC = aC;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; varying vec2 vUv; varying vec4 vC;
        void main(){
          vec4 t = texture2D(map, vUv);
          gl_FragColor = vec4(vC.rgb * t.rgb, vC.a * t.a);
          #include <colorspace_fragment>
        }`,
    }));
    m.frustumCulled = false; m.renderOrder = order;
    return {
      mesh: m, N,
      set(i, x, y, z, size, rot, r, gg, b, a) {
        for (let k = 0; k < 4; k++) { pos[i * 12 + k * 3] = x; pos[i * 12 + k * 3 + 1] = y; pos[i * 12 + k * 3 + 2] = z; ap[i * 8 + k * 2] = size; ap[i * 8 + k * 2 + 1] = rot; ac[i * 16 + k * 4] = r; ac[i * 16 + k * 4 + 1] = gg; ac[i * 16 + k * 4 + 2] = b; ac[i * 16 + k * 4 + 3] = a; }
      },
      commit() { aPos.needsUpdate = true; aP.needsUpdate = true; aC.needsUpdate = true; },
    };
  }
  // fire trail: hot puffs streaming from the windward underside and nose, then smoke
  const wake = new THREE.Vector3().fromArray(BOARD.cargoVel).normalize().multiplyScalar(-1);   // where the fire streams to
  const trail = puffs(56, fireTex, THREE.AdditiveBlending, true, 6), trailSmoke = puffs(22, smokeTex, THREE.NormalBlending, true, 5);
  const trailP = [], smokeP = [];
  for (let i = 0; i < trail.N; i++) { const nose = i < 8; trailP.push({ x: (rnd() - 0.5) * HULL_R * (nose ? 0.9 : 1.3), y: HULL_Y - HULL_R * (nose ? 0.35 + rnd() * 0.5 : 0.8 + rnd() * 0.2), z: nose ? HULL_Z0 - 3.5 - rnd() * 3 : HULL_Z0 - 2 + rnd() * 70, ph: rnd(), sp: 0.6 + rnd() * 0.6, rot: rnd() * 6.28, nose }); }
  for (let i = 0; i < trailSmoke.N; i++) smokeP.push({ x: (rnd() - 0.5) * HULL_R, y: HULL_Y - HULL_R * 0.6, z: HULL_Z1 - rnd() * 30, ph: rnd(), sp: 0.25 + rnd() * 0.2, rot: rnd() * 6.28 });
  exterior.add(trail.mesh, trailSmoke.mesh);

  // ---- impact on the sea: fire bloom, flash, puffs, smoke, embers, shock ring (world space, not in `root`) ----------------
  // No depth test and drawn late, so the glow shows through the cloud decks between the suit and the sea.
  const boom = new THREE.Group(); boom.visible = false; world.scene.add(boom);
  const flashDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xfff0c0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false }));
  const bloom = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: bloomTex, transparent: true, depthWrite: false, depthTest: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, depthTest: false, opacity: 0.5 }));
  flashDisc.frustumCulled = bloom.frustumCulled = ring.frustumCulled = false;
  flashDisc.position.y = 3; bloom.position.y = 4; ring.position.y = 2;
  bloom.renderOrder = 47; flashDisc.renderOrder = 48; ring.renderOrder = 49;
  const fireSmoke = puffs(14, smokeTex, THREE.NormalBlending, false, 50), fireAdd = puffs(14, fireTex, THREE.AdditiveBlending, false, 51), fireCore = puffs(14, fireTex, THREE.NormalBlending, false, 52);
  boom.add(bloom, flashDisc, ring, fireSmoke.mesh, fireAdd.mesh, fireCore.mesh);
  const mkP = (core) => ({ a: rnd() * 6.28, r: (core ? 20 : 60) + rnd() * (core ? 220 : 330), up: 14 + rnd() * 34, sz: (core ? 380 : 300) + rnd() * 320, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 0.12 });
  const coreP = [], addP = [], smkP = [];
  for (let i = 0; i < 14; i++) { coreP.push(mkP(true)); addP.push(mkP(false)); smkP.push({ a: rnd() * 6.28, r: 120 + rnd() * 380, up: 20 + rnd() * 26, sz: 340 + rnd() * 360, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 0.08 }); }
  const NE = 160, ePos = new Float32Array(NE * 3), eCol = new Float32Array(NE * 3), embersV = [];
  for (let i = 0; i < NE; i++) { const a = rnd() * 6.28, h = 40 + rnd() * 240; embersV.push({ vx: Math.cos(a) * h, vz: Math.sin(a) * h, vy: 50 + rnd() * 220, life: 3 + rnd() * 7, hot: rnd() }); }
  const eGeo = new THREE.BufferGeometry(); eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3)); eGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
  const embers = new THREE.Points(eGeo, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  embers.frustumCulled = false; embers.renderOrder = 53; boom.add(embers);

  // ---- wind streaks around the camera (outside shot) ---------------------------------------------------------------------------
  const NS = 150, BOX = 160;
  const sPos = new Float32Array(NS * 3), sBuf = new Float32Array(NS * 6);
  for (let i = 0; i < NS * 3; i++) sPos[i] = (Math.random() - 0.5) * BOX;
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sBuf, 3));
  const streaks = new THREE.LineSegments(sGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }));
  streaks.frustumCulled = false; streaks.visible = false;
  world.scene.add(streaks);
  const wind = new THREE.Vector3();

  // ---- flat HUD ------------------------------------------------------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false;
  const oScene = new THREE.Scene(); oScene.add(quad);
  const oCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const col = (c, a) => `rgba(${c},${a})`;
  const CWH = '236,242,250', AMB = '255,196,40', CYAN = '120,225,255';
  function T(s, x, y, c, a, size = 20, align = 'left', weight = 400) { g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = col(c, a); g.textAlign = align; g.fillText(s, x, y); }
  const camRel = new THREE.Vector3(), look = new THREE.Vector3(), m4 = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0), qS = new THREE.Quaternion();
  let tNow = 0, drawAcc = 1, overridden = false, hudCleared = true, relT = -1;   // relT: seconds since the release (-1 before)

  function drawRadio(m, y) {
    const msg = m.message;
    if (!(msg && msg.ttl > 0 && msg.text)) return;
    const a = saturate(msg.ttl / 0.6);
    g.font = `400 20px ${FONT}`; const tw = g.measureText(String(msg.text)).width;
    g.fillStyle = col('0,0,0', 0.5 * a); g.fillRect(W / 2 - tw / 2 - 14, y - 22, tw + 28, 32);
    T(String(msg.text), W / 2, y, CWH, a, 20, 'center');
  }

  function drawOverlay() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const st = state.story || {}, m = state.mission || {};
    if (st.stage === 'outside') {
      // letterbox, radio, skip hint; in from black, out to black
      const t = num(st.cine, 0) * BOARD.cineTime;
      g.fillStyle = '#000'; g.fillRect(0, 0, W, 84); g.fillRect(0, H - 84, W, 84);
      drawRadio(m, H - 36);
      T('[ENTER]  SKIP', W - 30, H - 100, CWH, 0.45, 15, 'right');
      const fade = Math.max(1 - saturate(t / 0.6), saturate((t - (BOARD.cineTime - 0.5)) / 0.5));
      if (fade > 0) { g.fillStyle = col('0,0,0', fade); g.fillRect(0, 0, W, H); }
      return;
    }
    // helmet visor: darkened corners and a thin rim
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, H * 1.0);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,3,8,0.9)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    g.strokeStyle = col(CYAN, 0.13); g.lineWidth = 3;
    g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.56, H * 0.62, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = col(CWH, 0.7); g.fillRect(W / 2 - 1.5, H / 2 - 1.5, 3, 3);
    // the Xi: distance left
    const dist = num(st.hatch && st.hatch.distance, 0);
    if (st.stage === 'airlock' || st.stage === 'walk') T(`XI  ${dist.toFixed(0)} M`, W / 2, H - 146, CYAN, 0.9, 22, 'center', 500);
    if (m.objective) T(String(m.objective).toUpperCase(), W / 2, H - 108, CWH, 0.9, 20, 'center', 500);
    drawRadio(m, H - 62);
    if (st.stage === 'airlock' || st.stage === 'walk') T('MOUSE  LOOK      W A S D  WALK      SHIFT  RUN', W / 2, H - 22, CWH, 0.55, 15, 'center');
    // chapter title card
    const tt = num(st.title, 0);
    if (tt > 0) {
      const a = saturate(tt / 1.2) * saturate((BOARD.titleTime - tt) / 0.6 + 0.15);
      g.fillStyle = col('0,0,0', 0.6 * a); g.fillRect(0, H * 0.3, W, 150);
      T('CHAPTER 1', W / 2, H * 0.3 + 58, AMB, a, 22, 'center', 500);
      T('MIDAIR HANDOVER', W / 2, H * 0.3 + 108, CWH, a, 46, 'center', 500);
    }
    // the start fades in from black; into the hatch: white bloom, then black
    const fin = 1 - saturate(num(st.t, 9) / 1.5);
    if (fin > 0) { g.fillStyle = col('0,0,0', fin); g.fillRect(0, 0, W, H); }
    const e = st.stage === 'enter' ? num(st.enter, 0) : 0;
    if (e > 0) { g.fillStyle = col('0,0,0', saturate(e * 1.2)); g.fillRect(0, 0, W, H); }
  }

  // ---- per frame -----------------------------------------------------------------------------------------------------------------
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const A0 = new THREE.Vector3(120, -42, -190), A1 = new THREE.Vector3(96, 46, -52), AIM = new THREE.Vector3(0, HULL_Y, (HULL_Z0 + HULL_Z1) / 2);
  const fract = (x) => x - Math.floor(x);
  function updateTrail() {
    for (let i = 0; i < trail.N; i++) {
      const p = trailP[i], fl = 0.8 + 0.2 * Math.sin(tNow * (17 + i * 3.1) + i * 1.7);
      if (p.nose) {   // the plasma sheath on the heat shield
        trail.set(i, p.x * 0.5, p.y, p.z, (34 + 20 * p.ph) * fl, p.rot + tNow * 0.6, 1, 0.82, 0.55, 0.55 * fl);
        continue;
      }
      const a = fract(tNow * p.sp + p.ph), d = 6 + a * 150;
      trail.set(i, p.x * (1 + a * 0.8) + Math.sin(tNow * 3 + i) * 2 * a, p.y + wake.y * d, p.z + wake.z * d, (16 + 75 * a) * fl * (0.8 + 0.4 * p.ph), p.rot + a * 2,
        1, 0.85 - 0.6 * a, 0.55 - 0.5 * a, Math.pow(1 - a, 1.4) * 0.8 * fl);
    }
    for (let i = 0; i < trailSmoke.N; i++) {
      const p = smokeP[i], a = fract(tNow * p.sp + p.ph), d = 40 + a * 230;
      trailSmoke.set(i, p.x * (1 + a), p.y + wake.y * d, p.z + wake.z * d, 30 + 120 * a, p.rot + a, 0.2, 0.17, 0.15, 0.45 * saturate(a * 5) * (1 - a));
    }
    trail.commit(); trailSmoke.commit();
  }
  function updateBoom(t) {
    const grow = 1 - Math.exp(-t * 1.6), cool = saturate((t - 1.5) / 7);
    flashDisc.scale.setScalar(350 + 1250 * grow); flashDisc.material.opacity = saturate(1.15 - t / 7);
    bloom.scale.setScalar(260 + 1150 * grow); bloom.rotation.y = 0.4 + t * 0.01;
    bloom.material.opacity = saturate(1.3 - t / 13); bloom.material.color.setRGB(1 - 0.45 * cool, 1 - 0.6 * cool, 1 - 0.7 * cool);
    ring.scale.setScalar(200 + 260 * t); ring.material.opacity = 0.55 * saturate(1 - t / 6);
    for (let i = 0; i < 14; i++) {
      let u = coreP[i];
      fireCore.set(i, Math.cos(u.a) * u.r * 1.5 * grow, 30 + u.up * t, Math.sin(u.a) * u.r * 1.5 * grow, u.sz * 1.5 * (0.5 + 0.9 * grow), u.rot + u.spin * t,
        1 - 0.4 * cool, 1 - 0.55 * cool, 1 - 0.65 * cool, saturate(1.1 - t / 4.5) * 0.95);
      u = addP[i];
      fireAdd.set(i, Math.cos(u.a) * u.r * 1.5 * grow, 30 + u.up * t, Math.sin(u.a) * u.r * 1.5 * grow, u.sz * 1.7 * (0.5 + 0.9 * grow), u.rot + u.spin * t,
        1, 0.62, 0.32, saturate(1.15 - t / 8) * (0.75 + 0.25 * Math.sin(tNow * 14 + u.a)));
      u = smkP[i];
      fireSmoke.set(i, Math.cos(u.a) * u.r * grow, 40 + u.up * t, Math.sin(u.a) * u.r * grow, u.sz * (0.6 + 0.25 * t), u.rot + u.spin * t,
        0.17, 0.12, 0.09, 0.6 * saturate((t - 0.8) / 2) * saturate(1 - (t - 9) / 9));
    }
    fireCore.commit(); fireAdd.commit(); fireSmoke.commit();
    const dr = (1 - Math.exp(-t * 0.6)) / 0.6;
    for (let i = 0; i < NE; i++) {
      const e = embersV[i], k = saturate(1 - t / e.life);
      ePos[i * 3] = e.vx * dr; ePos[i * 3 + 1] = Math.max(2, e.vy * dr - 9 * t * t); ePos[i * 3 + 2] = e.vz * dr;
      eCol[i * 3] = k; eCol[i * 3 + 1] = k * (0.45 + 0.4 * e.hot); eCol[i * 3 + 2] = k * 0.2 * e.hot;
    }
    eGeo.attributes.position.needsUpdate = true; eGeo.attributes.color.needsUpdate = true;
  }
  // call after chase.update: in phase 'boarding' it places the world camera
  function update(dt, wc, aspect) {
    const st = state.story || {};
    const story = st.chapter === 1;
    const on = story && state.phase === 'boarding' && isVec(st.pilot && st.pilot.position);
    tNow += dt;
    const cockpit = story && state.phase === 'startup' && st.stage === 'cockpit';
    const freed = story && st.stage === 'flight';
    const gone = !!(st.cargo && st.cargo.gone), impactT = num(st.cargo && st.cargo.impactT, 0);
    const cine = on && st.stage === 'outside';
    api.active = on;
    root.visible = on || cockpit || (freed && !gone);
    interior.visible = (on && !cine) || cockpit;
    exterior.visible = cine || (freed && !gone);
    streaks.visible = cine;
    if (root.visible) {
      root.position.copy(st.cargo.position);
      if (xi) xi.root.visible = on;                                    // in the cockpit the camera is inside the suit
      // door halves slide apart into the bulkhead; lamps
      const d = ease(num(st.door, 0)) * 1.8;
      doorL.position.x = -d; doorR.position.x = d;
      const blink = Math.sin(tNow * 5.2) > 0.2;
      warnMat.color.setRGB(blink ? 1 : 0.12, blink ? 0.12 : 0.03, blink ? 0.06 : 0.02);
      warnGlowMesh.material.opacity = blink ? 0.85 : 0.05;
      // CR-011 release: explosive bolts fire (white flash), the two hull halves fly apart and roll outward
      if (freed) {
        if (relT < 0) { relT = 0; monitor.addFlash(0.75); } else relT += dt;
      } else relT = -1;
      const rt_ = Math.max(0, relT), off = relT < 0 ? 0 : 1.5 + 26 * (1 - Math.exp(-rt_ * 1.5)) + 6 * rt_, roll = relT < 0 ? 0 : 0.55 * (1 - Math.exp(-rt_ * 0.9));
      for (let h = 0; h < hullHalves.length; h++) {
        const sx = h === 0 ? -1 : 1, m = hullHalves[h];
        m.position.set(sx * off, relT < 0 ? 0 : -2.5 * rt_ * (h ? 1 : 0.4), sx * 3 * Math.min(rt_, 6));
        m.rotation.set(0, sx * 0.05 * Math.min(rt_, 6), -sx * roll);
      }
      trail.mesh.visible = trailSmoke.mesh.visible = relT < 0;   // CR-012: no fire once the hull has split (it hung in the empty middle between the halves)
      if (exterior.visible) updateTrail();
    }
    // impact fireball
    boom.visible = story && gone && impactT < 18 && isVec(st.cargo.position) && st.stage !== 'lost';
    if (boom.visible) {
      boom.position.set(st.cargo.position.x, 0, st.cargo.position.z);
      updateBoom(impactT);
    }
    if (!on) {
      if (overridden) { overridden = false; wc.fov = rig.worldFov; wc.aspect = aspect; wc.updateProjectionMatrix(); }
      return;
    }
    let fov = FOV_WALK;
    if (cine) {
      // outside shot: from below and ahead, rising past the hull as it comes down, ending above it with the sea underneath
      const k = ease(num(st.cine, 0));
      camRel.lerpVectors(A0, A1, k);
      wc.position.copy(st.cargo.position).add(camRel);
      look.copy(st.cargo.position).add(AIM);
      m4.lookAt(wc.position, look, UP);
      wc.quaternion.setFromRotationMatrix(m4);
      eul.set(Math.sin(tNow * 9.1) * 0.004, Math.sin(tNow * 7.3) * 0.004, Math.sin(tNow * 5.7) * 0.006);
      wc.quaternion.multiply(qS.setFromEuler(eul));
      fov = FOV_CINE;
      wind.fromArray(BOARD.cargoVel).multiplyScalar(-1);
      const wl = wind.length() || 1, hb = BOX / 2, sl = 9 / wl;
      for (let i = 0; i < NS; i++) {
        const j = i * 3, q = i * 6;
        for (let a = 0; a < 3; a++) { let v = sPos[j + a] + wind.getComponent(a) * dt; if (v > hb) v -= BOX; else if (v < -hb) v += BOX; sPos[j + a] = v; }
        sBuf[q] = sPos[j]; sBuf[q + 1] = sPos[j + 1]; sBuf[q + 2] = sPos[j + 2];
        sBuf[q + 3] = sPos[j] + wind.x * sl; sBuf[q + 4] = sPos[j + 1] + wind.y * sl; sBuf[q + 5] = sPos[j + 2] + wind.z * sl;
      }
      sGeo.attributes.position.needsUpdate = true;
      streaks.position.copy(wc.position);
    } else {
      // first person: head bob from the steps, the hull shaking as it falls, an occasional jolt
      const step = num(st.pilot.step, 0), mv = Math.min(1, Math.hypot(num(st.pilot.velocity.x, 0), num(st.pilot.velocity.z, 0)) / BOARD.walk);
      const jolt = Math.pow(Math.max(0, Math.sin(tNow * 0.9) * Math.sin(tNow * 2.3 + 1)), 6) * 0.03;
      const sh = 0.0035 + jolt;
      eul.set(num(st.pilot.pitch, 0) + Math.sin(tNow * 13.1) * sh, -num(st.pilot.yaw, 0) + Math.sin(tNow * 11.3 + 2) * sh, Math.sin(tNow * 7.7) * sh * 1.6 + Math.sin(step * 1.45) * 0.006 * mv);
      wc.quaternion.setFromEuler(eul);
      wc.position.copy(st.pilot.position);
      wc.position.y += Math.sin(step * 2.9) * 0.045 * mv + Math.sin(tNow * 17) * jolt * 0.6;
    }
    if (Math.abs(wc.fov - fov) > 1e-3 || wc.aspect !== aspect) { wc.fov = fov; wc.aspect = aspect; wc.updateProjectionMatrix(); }
    overridden = true;
    monitor.setClean(1);
  }

  // after the monitor / cockpit / overlay passes; only while the pilot is on foot / in the outside shot
  function render(renderer, dt) {
    if (!api.active) { hudCleared = true; return; }
    drawAcc += dt;
    if (hudCleared || drawAcc >= 1 / 30 || !(dt > 0)) { drawAcc = 0; hudCleared = false; drawOverlay(); tex.needsUpdate = true; }
    renderer.clearDepth();
    renderer.render(oScene, oCam);
  }
  return Object.assign(api, { update, render });
}
