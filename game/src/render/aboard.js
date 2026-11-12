// CR-014 story interlude "Aboard Seawrack" (phase 'aboard', sim/missions/aboard.js). Draws, in Seawrack's own frame
// (render/seawrack.js: bow toward -Z, +X starboard, y up from the waterline; a group that follows the ship):
//   - the Xi standing on the landing hatch (it comes down onto it in the homecoming shot), deck crew with signal wands,
//     floodlights, the hold access house with the rescued civilians, the door under the bridge
//   - the people of aboardScript.js as stylised faceless figures that turn toward the pilot
//   - the corridor (notices on the walls, the lift) and the Command room (consoles, the lit map table, windows onto the deck)
// It owns the world camera while the phase lasts (the homecoming shot, then first person), and draws a flat overlay: the
// letterbox and skip hint, objective, radio line, talk prompt, the dialogue panel with its choices, Codex toasts, fades.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon } from './shaders.js';
import { onXiReady, makeXiSuit } from './xiSuit.js';
import { XI_MODEL_HEIGHT } from '../state.js';
import { SEAWRACK as C, ABOARD as A } from '../sim/tuning.js';
import { CODEX } from '../sim/missions/aboardScript.js';
import { XI_HOLD, floorY } from '../sim/missions/aboard.js';
import { num, isVec, saturate } from './util.js';
import { createPeopleKit } from './people.js';

const W = 1280, H = 720;
const FONT = '"Roboto Mono", Consolas, "Courier New", monospace';
const D = C.deckY;
const ease = (t) => { t = saturate(t); return t * t * (3 - 2 * t); };

// ---- geometry helpers (non-indexed, vertex-coloured). shade: bake simple light into interior colours by face normal ----
const flat = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k); return n; };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
function paint(g, color, baked = false) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3), p = g.attributes.position.array, base = new THREE.Color(color), c = new THREE.Color();
  for (let t = 0; t < n; t += 3) {
    c.copy(base);
    if (baked) {
      _a.fromArray(p, t * 3); _b.fromArray(p, t * 3 + 3); _c.fromArray(p, t * 3 + 6);
      _n.subVectors(_c, _b).cross(_a.sub(_b)).normalize();
      c.multiplyScalar(_n.y > 0.5 ? 1.0 : _n.y < -0.5 ? 0.62 : Math.abs(_n.x) > 0.5 ? 0.84 : 0.74);
    }
    for (let k = 0; k < 3; k++) { a[(t + k) * 3] = c.r; a[(t + k) * 3 + 1] = c.g; a[(t + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function box(x0, y0, z0, x1, y1, z1, color, baked) {
  const g = flat(new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return paint(g, color, baked);
}
// an inward-facing room shell: floor, ceiling and walls seen from inside (a box with its faces flipped)
function room(x0, y0, z0, x1, y1, z1, color) {
  const g = box(x0, y0, z0, x1, y1, z1, color);
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
  return paint(g, color, true);
}
function cylG(r, h, color, seg = 10, r2 = r) { return paint(flat(new THREE.CylinderGeometry(r2, r, h, seg)), color); }
const merge = (list) => { const g = mergeGeometries(list, false); g.computeVertexNormals(); g.computeBoundingSphere(); return g; };
const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };

export function createAboard({ state, world, monitor, seawrack }) {
  const api = { active: false };
  const U = world.uniforms;
  const kit = createPeopleKit(U);
  const toonMat = () => new THREE.ShaderMaterial({
    uniforms: { uSun: U.uSunDir, uNight: U.uNight, uThermal: U.uThermal, uHeat: { value: 0.5 }, uFlash: { value: 0 }, uDmg: { value: 0 } },
    vertexShader: toon.vertex, fragmentShader: toon.fragment, vertexColors: true,
  });
  const lit = (geo) => { const m = new THREE.Mesh(geo, toonMat()); m.frustumCulled = false; return m; };
  const unlit = (geo, side) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: side || THREE.FrontSide })); m.frustumCulled = false; return m; };
  const glowMat = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o, depthWrite: o >= 1 });

  const root = new THREE.Group();          // follows Seawrack (model frame)
  root.visible = false;
  world.scene.add(root);
  const deckG = new THREE.Group(), corridorG = new THREE.Group(), commandG = new THREE.Group();
  root.add(deckG, corridorG, commandG);

  // ---- the Xi: in the homecoming shot it comes down out of the sky into hold two (CR-014b), facing the bow ---------------
  let xi = null;
  onXiReady(() => {
    xi = makeXiSuit({ sun: U.uSunDir, night: U.uNight, thermal: U.uThermal });
    xi.pose(0, { raise: false, rifle: true, snap: true });
    root.add(xi.root);
  });

  // ---- deck set pieces ---------------------------------------------------------------------------------------------------
  {
    const P = [];
    // door under the bridge: frame, dark doorway (outward facing, so it is open from inside), hazard sill, lit sign
    const zf = -C.bridgeZ - C.bridgeHalf;
    P.push(box(-1.9, D, zf - 0.35, -1.5, D + 2.8, zf, 0x4a5058), box(1.5, D, zf - 0.35, 1.9, D + 2.8, zf, 0x4a5058), box(-1.9, D + 2.6, zf - 0.35, 1.9, D + 3.0, zf, 0x4a5058));
    for (let i = 0; i < 8; i++) P.push(box(-1.5 + i * 0.375, D, zf - 0.4, -1.5 + (i + 1) * 0.375, D + 0.08, zf - 0.05, i % 2 ? 0x1d1d1d : 0xd9a636));
    // floodlight posts along the landing hatch
    for (const [x, z] of [[-22, -20], [22, -20], [-22, 25], [22, 25]]) { P.push(box(x - 0.15, D, z - 0.15, x + 0.15, D + 7, z + 0.15, 0x6a727b)); P.push(box(x - 0.6, D + 6.6, z - 0.4, x + 0.6, D + 7.4, z + 0.4, 0x3b4047)); }
    // crates and gas bottles near the bridge
    for (let i = 0; i < 6; i++) { const x = 9 + (i % 3) * 2.3, z = 38 + Math.floor(i / 3) * 2.2; P.push(box(x - 1, D, z - 1, x + 1, D + 1.4 + hash(i, 2) * 0.6, z + 1, hash(i, 3) > 0.5 ? 0x7c6a4a : 0x5d6a52)); }
    for (let i = 0; i < 5; i++) { const g = cylG(0.18, 1.4, i % 2 ? 0x2f6e9e : 0x9e2f2f, 8); g.translate(-14 + i * 0.45, D + 0.7, 40.5); P.push(g); }
    // hold access house on the hatch lid: three walls and a roof, open toward the Xi (+X)
    const [hx, hz, hs] = A.hold, fl = floorY('deck', hx, hz);
    P.push(box(hx - hs, fl, hz - hs, hx - hs + 0.25, fl + 3, hz + hs, 0x6a727b), box(hx - hs, fl, hz - hs, hx + hs, fl + 3, hz - hs + 0.25, 0x6a727b), box(hx - hs, fl, hz + hs - 0.25, hx + hs, fl + 3, hz + hs, 0x6a727b));
    P.push(box(hx - hs - 0.2, fl + 3, hz - hs - 0.2, hx + hs + 0.2, fl + 3.3, hz + hs + 0.2, 0x575d66));
    deckG.add(lit(merge(P)));
    // inside the hold house: warm light, a stair going down, people
    const I = [room(hx - hs + 0.26, fl, hz - hs + 0.26, hx + hs - 0.05, fl + 2.99, hz + hs - 0.26, 0x8a6a4a), box(hx - hs + 0.4, fl, hz - 1.0, hx - 0.4, fl + 0.05, hz + 1.0, 0x1a1410, false)];
    for (let i = 0; i < 5; i++) I.push(box(hx - hs + 0.6 + i * 0.35, fl - 0.1 - i * 0.3, hz - 0.9, hx - hs + 0.9 + i * 0.35, fl + 0.02 - i * 0.3, hz + 0.9, 0x3a3028));
    deckG.add(unlit(merge(I)));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glowMat(0xffd28a)); lamp.position.set(hx, fl + 2.7, hz); deckG.add(lamp);
    const civs = [['civ', hx + 0.9, hz - 1.4, 0.5, false, 1], ['civ2', hx + 1.4, hz + 0.9, -2.4, false, 1], ['civ3', hx - 0.9, hz + 1.5, 2.6, true, 1], ['civ2', hx + 0.3, hz - 0.5, 1.2, false, 0.62]];
    for (const [look, x, z, ry, seated, sc] of civs) { const m = kit.person(look, { seated }); m.position.set(x, fl, z); m.rotation.y = ry; m.scale.setScalar(sc); deckG.add(m); }
  }
  // floodlight glows and light cones (switched on in the homecoming shot)
  const floods = [];
  for (const [x, z] of [[-22, -20], [22, -20], [-22, 25], [22, 25]]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.3), glowMat(0xfff2cc)); head.position.set(x * 0.98, D + 7, z); head.lookAt(new THREE.Vector3(0, D, z));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 22, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    cone.position.set(x * 0.55, D + 0.5, z); cone.rotation.z = Math.sign(x) * 0.45;
    head.frustumCulled = cone.frustumCulled = false;
    deckG.add(head, cone);
    floods.push(head, cone);
  }
  // ambient deck crew: four with signal wands around the Xi, two by the crane
  const crew = [];
  for (const [x, z, ry, wand] of [[-12, 4, 2.2, true], [12, 2, -2.0, true], [-9, -18, 0.6, true], [10, -16, -0.7, true], [-17, 12, 1.4, false], [16, 30, -2.7, false]]) {
    const m = kit.person('deck'); m.position.set(x, floorY('deck', x, z), z); m.rotation.y = ry; deckG.add(m);
    const w = wand ? [-1, 1].map((s) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6), glowMat(0xff8a2a)); g.frustumCulled = false; m.add(g); g.userData.s = s; return g; }) : [];
    crew.push({ m, w, ph: hash(x, z) * 6 });
  }

  // ---- corridor: inward shell, ceiling lamps and pipes, notices, the lift ----------------------------------------------
  const zc0 = A.corridor.z0 - 0.6, zc1 = A.corridor.z1 + 1.0;
  {
    const P = [room(-2.5, D, zc0, 2.5, D + 2.9, zc1, 0x9aa2ab)];
    P.push(box(-2.5, D, zc0, 2.5, D + 0.02, zc1, 0x5d636b, true));
    for (let z = zc0 + 1.5; z < zc1 - 1; z += 3) P.push(box(-2.45, D + 0.02, z, 2.45, D + 0.04, z + 0.08, 0x3b4047, true));
    for (const x of [-1.9, -1.6]) P.push(box(x - 0.08, D + 2.6, zc0, x + 0.08, D + 2.76, zc1, 0x6a7a8a, true));
    for (let z = zc0 + 2; z < zc1; z += 5) P.push(box(-2.49, D + 0.9, z, -2.46, D + 2.2, z + 0.06, 0x7d858f, true), box(2.46, D + 0.9, z, 2.49, D + 2.2, z + 0.06, 0x7d858f, true));
    // lift doors at the end
    P.push(box(-1.3, D, zc1 - 0.12, -0.02, D + 2.3, zc1 - 0.02, 0xb4bcc6, true), box(0.02, D, zc1 - 0.12, 1.3, D + 2.3, zc1 - 0.02, 0xb4bcc6, true), box(-1.5, D + 2.3, zc1 - 0.14, 1.5, D + 2.5, zc1 - 0.02, 0x3b4047, true));
    corridorG.add(unlit(merge(P), THREE.FrontSide));
    for (let z = zc0 + 1.5; z < zc1; z += 3.5) { const l = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.3), glowMat(0xf4f0e0)); l.position.set(0, D + 2.86, z); corridorG.add(l); }
    const call = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.04), glowMat(0x7fe0ff)); call.position.set(1.55, D + 1.2, zc1 - 0.1); corridorG.add(call);
  }
  // notices: canvas plaques on the walls (texts are the readable lines of aboardScript.js)
  function plaque(title, lines, color, w = 1.0, h = 1.3) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 332;
    const g = cv.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 256, 332); g.fillStyle = 'rgba(0,0,0,0.75)';
    g.font = '700 22px sans-serif'; g.fillText(title, 14, 36);
    g.font = '15px sans-serif'; lines.forEach((l, i) => g.fillText(l, 14, 72 + i * 22));
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    m.frustumCulled = false;
    return m;
  }
  {
    const n = plaque('NOTICE', ['EARTH IS FOR THOSE', 'WHO BELONG TO IT.', '', 'Unregistered residents', 'will be relocated to', 'the space colonies.', '', 'Report them to your', 'district office.'], '#e8e2d0');
    const scrawl = document.createElement('canvas'); void scrawl;
    n.position.set(-2.44, D + 1.55, 50); n.rotation.y = Math.PI / 2; corridorG.add(n);
    const red = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), glowMat(0xc8202a)); red.position.set(-2.43, D + 1.3, 50); red.rotation.set(0, Math.PI / 2, 0.25); corridorG.add(red);
    const r = plaque('M/V SEAWRACK', ['Bulk carrier', '', 'Cargo: machine parts', 'Owner: Sunda Eastern', 'Freight Lines', '(registered office:', ' an empty lot)'], '#d8e2ea');
    r.position.set(2.44, D + 1.55, 54); r.rotation.y = -Math.PI / 2; corridorG.add(r);
    const ro = plaque('CREW', ['- - - - - - - - -', '- - - - - - -', '- - - - - - - -', 'GAWMAN NOBILE', '  (NOT LOST)', '- - - - - - -', '- - - - - - - -'], '#efe9dc');
    ro.position.set(-2.44, D + 1.55, 57); ro.rotation.y = Math.PI / 2; corridorG.add(ro);
  }

  // ---- Command: inward shell with window bands, consoles, the map table, two operators ------------------------------------
  const fy = D + A.command.floor;
  const zr0 = -C.bridgeZ - C.bridgeHalf + 1.3, zr1 = A.command.z1 + 1.0, xr = 26.5;
  {
    const P = [], Pl = [];
    const WALL = 0x8f979f, FRAME = 0x5a6169, DESK = 0x3a4048, TOP = 0x2a3038, DARK = 0x23272d;
    // floor with a tile grid, ceiling with beams and cable trays
    P.push(box(-xr, fy - 0.2, zr0, xr, fy, zr1, 0x4a5058, true), box(-xr, fy + 7.4, zr0, xr, fy + 7.6, zr1, 0x8a929b, true));
    for (let x = -xr + 2; x < xr; x += 2) P.push(box(x - 0.02, fy, zr0, x + 0.02, fy + 0.01, zr1, 0x3e444c));
    for (let z = zr0 + 2; z < zr1; z += 2) P.push(box(-xr, fy, z - 0.02, xr, fy + 0.01, z + 0.02, 0x3e444c));
    for (let z = zr0 + 2; z < zr1; z += 4) P.push(box(-xr, fy + 6.9, z - 0.18, xr, fy + 7.4, z + 0.18, FRAME, true));
    for (const x of [-9, 9]) P.push(box(x - 0.4, fy + 6.7, zr0, x + 0.4, fy + 6.85, zr1, 0x4a5058, true));
    // back wall: panels, equipment racks with lamp rows, the lift
    P.push(box(-xr, fy, zr1, xr, fy + 7.4, zr1 + 0.2, WALL, true));
    for (const x of [-20, -16, -12, 12, 16, 20]) {
      P.push(box(x - 1.6, fy, zr1 - 0.9, x + 1.6, fy + 2.4, zr1, DARK, true));
      for (let y = 0.4; y < 2.3; y += 0.3) P.push(box(x - 1.5, fy + y, zr1 - 0.92, x + 1.5, fy + y + 0.04, zr1 - 0.88, 0x3b4148));
    }
    P.push(box(-1.3, fy, zr1 - 0.12, -0.02, fy + 2.3, zr1, 0xb4bcc6, true), box(0.02, fy, zr1 - 0.12, 1.3, fy + 2.3, zr1, 0xb4bcc6, true), box(-1.55, fy + 2.3, zr1 - 0.15, 1.55, fy + 2.5, zr1, DARK, true));
    // front and side walls below / above the window band (fy+2.8 .. fy+6.2), panel frames, thick mullions
    for (const [y0, y1] of [[fy, fy + 2.8], [fy + 6.2, fy + 7.4]]) {
      P.push(box(-xr, y0, zr0 - 0.2, xr, y1, zr0, WALL, true));
      for (const s of [-1, 1]) P.push(box(s * xr - (s > 0 ? 0 : 0.2), y0, zr0, s * xr + (s > 0 ? 0.2 : 0), y1, zr1, WALL, true));
    }
    for (let x = -24; x <= 24; x += 6) P.push(box(x - 0.25, fy + 2.7, zr0 - 0.2, x + 0.25, fy + 6.3, zr0 + 0.1, 0x3b4047, true));
    P.push(box(-xr, fy + 2.6, zr0 - 0.1, xr, fy + 2.8, zr0 + 0.25, 0x3b4047, true), box(-xr, fy + 6.2, zr0 - 0.1, xr, fy + 6.4, zr0 + 0.2, 0x3b4047, true));
    for (const s of [-1, 1]) for (let z = zr0 + 3; z < zr1 - 1; z += 3) P.push(box(s * (xr - 0.05) - 0.06, fy + 0.2, z - 0.04, s * (xr - 0.05) + 0.06, fy + 2.6, z + 0.04, FRAME, true));
    // front consoles: angled desks, keyboards, monitors, chairs
    for (let x = -22; x <= 22; x += 5.5) {
      P.push(box(x - 2.4, fy, zr0 + 0.1, x + 2.4, fy + 0.95, zr0 + 1.3, DESK, true));
      const top = new THREE.BoxGeometry(4.6, 0.12, 1.0); top.rotateX(-0.18); top.translate(x, fy + 1.02, zr0 + 0.75); P.push(paint(flat(top), TOP, true));
      P.push(box(x - 0.7, fy + 1.06, zr0 + 1.0, x + 0.7, fy + 1.1, zr0 + 1.25, 0x1c1f24, true));                    // keyboard
      for (const dx of [-1.2, 1.2]) P.push(box(x + dx - 0.6, fy + 1.1, zr0 + 0.25, x + dx + 0.6, fy + 1.85, zr0 + 0.32, 0x1c1f24, true));   // monitors
      // swivel chair
      Pl.push([x, zr0 + 2.2]);
    }
    for (const [cx, cz] of Pl) {
      P.push(box(cx - 0.3, fy + 0.45, cz - 0.3, cx + 0.3, fy + 0.55, cz + 0.3, 0x2c3038, true), box(cx - 0.28, fy + 0.55, cz + 0.22, cx + 0.28, fy + 1.15, cz + 0.3, 0x2c3038, true));
      const ped = new THREE.CylinderGeometry(0.05, 0.05, 0.45, 6); ped.translate(cx, fy + 0.22, cz); P.push(paint(flat(ped), 0x5a6169, true));
      P.push(box(cx - 0.35, fy, cz - 0.04, cx + 0.35, fy + 0.04, cz + 0.04, 0x5a6169), box(cx - 0.04, fy, cz - 0.35, cx + 0.04, fy + 0.04, cz + 0.35, 0x5a6169));
    }
    // side consoles along both walls, the captain's station on the starboard side
    for (const s of [-1, 1]) for (let z = zr0 + 3; z < zr1 - 3; z += 4) P.push(box(s * (xr - 1.3) - 0.6, fy, z - 1.5, s * (xr - 1.3) + 0.6, fy + 1.1, z + 1.5, DESK, true));
    { const [x0, z0, x1, z1] = A.captainDesk, xm = (x0 + x1) / 2;   // the sim keeps the pilot out of this rectangle
      P.push(box(x0, fy, z0, x1, fy + 0.9, z0 + 1.0, DESK, true), box(xm - 0.6, fy + 0.45, z1 - 1.3, xm + 0.6, fy + 0.6, z1 - 0.1, 0x6a3a32, true), box(xm - 0.6, fy + 0.6, z1 - 0.2, xm + 0.6, fy + 1.7, z1, 0x6a3a32, true)); }
    // the map table: hexagonal plinth, rim, a mug and papers
    const [tx, tz, tr] = A.table;
    const plinth = new THREE.CylinderGeometry(tr, tr * 0.8, 1.0, 6); plinth.translate(tx, fy + 0.5, tz); P.push(paint(flat(plinth), DESK, true));
    const rim = new THREE.CylinderGeometry(tr + 0.12, tr + 0.12, 0.08, 6); rim.translate(tx, fy + 0.955, tz); P.push(paint(flat(rim), 0x5a6169, true));
    const mug = new THREE.CylinderGeometry(0.05, 0.045, 0.1, 8); mug.translate(tx + 2.1, fy + 1.08, tz + 0.9); P.push(paint(flat(mug), 0xd8d4c8, true));
    P.push(box(tx - 2.3, fy + 1.03, tz - 0.4, tx - 1.9, fy + 1.04, tz + 0.1, 0xeeeae0, true));
    commandG.add(unlit(merge(P)));
    // glowing parts: console and monitor screens, rack lamps, rim strip, hanging displays, light pools
    for (let x = -22; x <= 22; x += 5.5) {
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), glowMat(hash(x, 1) > 0.5 ? 0x5ad1ff : 0x7fffb0, 0.85)); sc.position.set(x, fy + 1.1, zr0 + 0.62); sc.rotation.x = -Math.PI / 2 + 0.35; commandG.add(sc);
      for (const dx of [-1.2, 1.2]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.65), glowMat(hash(x + dx, 3) > 0.5 ? 0x4fb8ff : 0x9cffc8, 0.9)); m.position.set(x + dx, fy + 1.48, zr0 + 0.34); commandG.add(m); }
    }
    for (const x of [-20, -16, -12, 12, 16, 20]) for (let k = 0; k < 6; k++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), glowMat(hash(x, k) > 0.6 ? 0xff5a4a : 0x5aff9a)); l.position.set(x - 1.2 + k * 0.45, fy + 2.2, zr1 - 0.95); commandG.add(l); }
    const rimGlow = new THREE.Mesh(new THREE.TorusGeometry(tr + 0.13, 0.02, 4, 6), glowMat(0x5ad1ff)); rimGlow.rotation.set(Math.PI / 2, 0, Math.PI / 6); rimGlow.position.set(tx, fy + 1.03, tz); commandG.add(rimGlow);
    const disp = (title, draw) => {
      const cv = document.createElement('canvas'); cv.width = 384; cv.height = 192;
      const g = cv.getContext('2d'); g.fillStyle = '#04141c'; g.fillRect(0, 0, 384, 192); g.strokeStyle = 'rgba(90,210,255,0.6)'; g.strokeRect(2, 2, 380, 188);
      g.fillStyle = '#5ad1ff'; g.font = '700 18px monospace'; g.fillText(title, 12, 24); draw(g);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.4), new THREE.MeshBasicMaterial({ map: t }));
    };
    const dA = disp('SEA / AIR PICTURE', (g) => { g.strokeStyle = 'rgba(90,210,255,0.4)'; for (let r = 20; r < 90; r += 22) { g.beginPath(); g.arc(192, 110, r, 0, Math.PI * 2); g.stroke(); } g.fillStyle = '#ff5a6a'; for (const [x, y] of [[150, 80], [240, 140], [120, 150]]) g.fillRect(x, y, 6, 6); g.fillStyle = '#6effc8'; g.fillRect(189, 107, 6, 6); });
    const dB = disp('SHIP STATUS', (g) => { g.font = '15px monospace'; ['HULL        GREEN', 'HOLD 2      SEALED', 'ENGINES     12 KN', 'PASSENGERS  41', 'MINOVSKY    LOW'].forEach((t, i) => { g.fillStyle = i === 1 ? '#ffd24a' : '#bfe8ff'; g.fillText(t, 16, 56 + i * 26); }); });
    const dC = disp('OENPELI — WEST ARNHEM', (g) => { g.strokeStyle = '#7fffb0'; g.beginPath(); g.moveTo(20, 60); g.bezierCurveTo(120, 40, 160, 120, 260, 90); g.lineTo(370, 110); g.stroke(); g.strokeStyle = '#ffd24a'; g.setLineDash([6, 5]); g.beginPath(); g.arc(300, 150, 26, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.fillStyle = '#ffd24a'; g.font = '14px monospace'; g.fillText('SIGNALS ?', 260, 186); });
    [[dA, -12], [dB, 0], [dC, 12]].forEach(([m, x]) => { m.position.set(x, fy + 5.0, zr0 + 1.6); m.rotation.x = 0.12; commandG.add(m); });
    for (const x of [-12, 0, 12]) { const h = box(x - 0.05, fy + 6.2, zr0 + 1.55, x + 0.05, fy + 7.4, zr0 + 1.65, 0x3b4047); commandG.add(unlit(h)); }
    for (let z = zr0 + 3; z < zr1; z += 4) { const l = new THREE.Mesh(new THREE.BoxGeometry(16, 0.05, 0.3), glowMat(0xeef4ff)); l.position.set(0, fy + 6.65, z); commandG.add(l); }
    for (const [x, z] of [[-9, zr0 + 5], [9, zr0 + 5], [0, A.table[1]], [-9, zr1 - 3], [9, zr1 - 3]]) {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20), new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(x, fy + 0.02, z); commandG.add(pool);
    }
  }
  // the map on the table: a canvas chart with Seawrack, the pickets and the carrier's route
  const mapCv = document.createElement('canvas'); mapCv.width = 512; mapCv.height = 512;
  const mapTex = new THREE.CanvasTexture(mapCv); mapTex.colorSpace = THREE.SRGBColorSpace;
  {
    const g = mapCv.getContext('2d');
    g.fillStyle = '#06222e'; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(80,200,255,0.18)'; g.lineWidth = 1;
    for (let i = 0; i <= 512; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
    g.fillStyle = 'rgba(90,210,140,0.35)'; g.strokeStyle = 'rgba(120,255,170,0.8)';
    for (const [cx, cy, r] of [[90, 120, 70], [140, 60, 45], [420, 380, 90], [380, 450, 60], [460, 300, 40]]) { g.beginPath(); for (let k = 0; k <= 18; k++) { const a = k / 18 * Math.PI * 2, rr = r * (0.7 + 0.35 * hash(cx + k, cy)); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.fill(); g.stroke(); }
    g.fillStyle = '#ff5a6a'; for (const [x, y] of [[230, 210], [300, 260], [190, 300]]) { g.fillRect(x - 6, y - 6, 12, 12); g.strokeStyle = 'rgba(255,90,106,0.5)'; g.beginPath(); g.arc(x, y, 46, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#6effc8'; g.beginPath(); g.moveTo(256, 236); g.lineTo(266, 266); g.lineTo(246, 266); g.closePath(); g.fill();
    g.setLineDash([10, 8]); g.strokeStyle = '#ffd24a'; g.lineWidth = 3; g.beginPath(); g.moveTo(40, 470); g.quadraticCurveTo(200, 360, 330, 150); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffd24a'; g.font = '700 18px monospace'; g.fillText('CARRIER ROUTE', 300, 140); g.fillText('X: JUMP', 205, 335);
    g.strokeStyle = '#ffd24a'; g.beginPath(); g.moveTo(200, 320); g.lineTo(216, 336); g.moveTo(216, 320); g.lineTo(200, 336); g.stroke();
    g.fillStyle = '#6effc8'; g.fillText('SEAWRACK', 220, 290);
    mapTex.needsUpdate = true;
    const top = new THREE.Mesh(new THREE.CircleGeometry(A.table[2] - 0.15, 6), new THREE.MeshBasicMaterial({ map: mapTex }));
    top.rotation.x = -Math.PI / 2; top.rotation.z = Math.PI / 6; top.position.set(A.table[0], fy + 1.01, A.table[1]);
    commandG.add(top);
    const holo = new THREE.Mesh(new THREE.CylinderGeometry(A.table[2] - 0.2, A.table[2] - 0.2, 1.2, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0x5ad1ff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    holo.position.set(A.table[0], fy + 1.6, A.table[1]); commandG.add(holo);
  }
  for (const [x, z, ry] of [[-11, zr0 + 2.1, 0], [16.5, zr0 + 2.1, 0]]) { const m = kit.person('operator', { seated: true }); m.position.set(x, fy, z); m.rotation.y = ry; commandG.add(m); }

  // ---- the story's people (aboardScript.js) ------------------------------------------------------------------------------
  const people = new Map();
  function ensurePeople(st) {
    if (people.size || !Array.isArray(st.people)) return;
    for (const q of st.people) {
      if (q.kind !== 'npc') continue;
      const m = kit.person(q.look);
      root.add(m);
      people.set(q.id, { m, q, yaw: q.yaw });
    }
  }

  // ---- flat overlay --------------------------------------------------------------------------------------------------------
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false;
  const oScene = new THREE.Scene(); oScene.add(quad);
  const oCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const col = (c, a) => `rgba(${c},${a})`;
  const CWH = '236,242,250', AMB = '255,196,40', CYAN = '120,225,255', GRN = '110,255,200';
  function T(s, x, y, c, a, size = 20, align = 'left', weight = 400) { g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = col(c, a); g.textAlign = align; g.fillText(s, x, y); }
  function wrap(text, maxW, size) {
    g.font = `400 ${size}px ${FONT}`;
    const words = String(text).split(' '), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  function drawRadio(m, y) {
    const msg = m.message;
    if (!(msg && msg.ttl > 0 && msg.text)) return;
    const a = saturate(msg.ttl / 0.6);
    const lines = wrap(msg.text, W - 380, 19);
    lines.forEach((l, i) => {
      g.font = `400 19px ${FONT}`; const tw = g.measureText(l).width, yy = y - (lines.length - 1 - i) * 26;
      g.fillStyle = col('0,0,0', 0.5 * a); g.fillRect(W / 2 - tw / 2 - 12, yy - 20, tw + 24, 27);
      T(l, W / 2, yy, CWH, a, 19, 'center');
    });
  }
  function drawTalk(t) {
    const x0 = 150, w = W - 300;
    const line = t.lines[Math.min(t.i, t.lines.length - 1)] || { who: t.name, text: '' };
    const body = t.choices.length ? [] : wrap(line.text, w - 48, 20);
    const ch = t.choices;
    const h = 64 + body.length * 28 + ch.length * 30 + (ch.length ? 6 : 0);
    const y0 = H - 36 - h;
    g.fillStyle = 'rgba(4,10,18,0.82)'; g.fillRect(x0, y0, w, h);
    g.strokeStyle = col(CYAN, 0.5); g.lineWidth = 1.5; g.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    T(String(ch.length ? t.name : line.who).toUpperCase(), x0 + 24, y0 + 32, AMB, 0.95, 18, 'left', 600);
    body.forEach((l, i) => T(l, x0 + 24, y0 + 64 + i * 28, CWH, 0.95, 20));
    ch.forEach((c, i) => {
      const sel = i === t.sel, yy = y0 + 66 + i * 30;
      if (sel) { g.fillStyle = col(CYAN, 0.16); g.fillRect(x0 + 14, yy - 22, w - 28, 29); }
      T((sel ? '> ' : '  ') + c.text, x0 + 24, yy, sel ? CYAN : CWH, sel ? 1 : 0.7, 20, 'left', sel ? 600 : 400);
    });
    T(ch.length ? 'W / S  SELECT     ENTER  CHOOSE' : 'ENTER  >', x0 + w - 20, y0 + h - 14, CWH, 0.5, 14, 'right');
  }
  function drawOverlay() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const st = state.story || {}, m = state.mission || {};
    if (st.stage === 'homecoming') {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, 84); g.fillRect(0, H - 84, W, 84);
      drawRadio(m, H - 30);
      T('[ENTER]  SKIP', W - 30, H - 100, CWH, 0.45, 15, 'right');
      const t = num(st.cine, 0) * A.cineTime;
      if (t > A.cineTime - 4) { const a = saturate((t - (A.cineTime - 4)) / 0.8) * saturate((A.cineTime - t) / 0.6); T('INTERLUDE', W / 2, 150, AMB, a, 20, 'center', 500); T('ABOARD SEAWRACK', W / 2, 196, CWH, a, 40, 'center', 500); }
      const fade = Math.max(1 - saturate(t / 0.6), saturate((t - (A.cineTime - 0.5)) / 0.5));
      if (fade > 0) { g.fillStyle = col('0,0,0', fade); g.fillRect(0, 0, W, H); }
      return;
    }
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.55, W / 2, H / 2, H * 1.05);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,3,8,0.7)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    if (!st.talk) g.fillStyle = col(CWH, 0.7), g.fillRect(W / 2 - 1.5, H / 2 - 1.5, 3, 3);
    if (m.objective) T(String(m.objective).toUpperCase(), W / 2, 42, CWH, 0.9, 18, 'center', 500);
    if (st.talk) drawTalk(st.talk);
    else {
      drawRadio(m, H - 70);
      if (st.prompt) {
        g.font = `600 20px ${FONT}`; const tw = g.measureText('[ENTER]  ' + st.prompt.text).width;
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(W / 2 - tw / 2 - 14, H / 2 + 40, tw + 28, 34);
        T('[ENTER]  ' + st.prompt.text, W / 2, H / 2 + 64, CYAN, 0.95, 20, 'center', 600);
      }
      if (st.stage === 'deck' && num(st.t, 0) < 40) T('MOUSE  LOOK      W A S D  WALK      SHIFT  RUN      ENTER  TALK / READ', W / 2, H - 22, CWH, 0.5, 15, 'center');
    }
    if (st.codexNew && CODEX[st.codexNew.id]) {
      const a = saturate(st.codexNew.t / 0.6) * saturate((4 - st.codexNew.t) / 0.3);
      g.fillStyle = col('4,10,18', 0.8 * a); g.fillRect(W - 420, 70, 390, 64);
      T('CODEX UPDATED', W - 400, 96, GRN, a, 15, 'left', 600);
      T(CODEX[st.codexNew.id].title.toUpperCase(), W - 400, 122, CWH, a, 19, 'left', 500);
    }
    const fade = num(st.fade, 0);
    if (fade > 0) { g.fillStyle = col('0,0,0', fade); g.fillRect(0, 0, W, H); }
  }

  // ---- per frame ---------------------------------------------------------------------------------------------------------
  const eul = new THREE.Euler(0, 0, 0, 'YXZ'), m4 = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), look = new THREE.Vector3();
  const CAM0 = new THREE.Vector3(-140, 125, -170), CAM1 = new THREE.Vector3(-56, 92, -20);    // off the port bow, past the gantry crane: looks aft, down into the hold
  let overridden = false, tNow = 0, drawAcc = 1, hudCleared = true;
  const toWorld = (sw, p, out) => { const c = Math.cos(sw.heading), s = Math.sin(sw.heading); return out.set(sw.position.x + p.x * c - p.z * s, sw.position.y + p.y, sw.position.z + p.x * s + p.z * c); };

  function update(dt, wc, aspect) {
    const st = state.story || {};
    const on = state.phase === 'aboard' && st.seawrack && isVec(st.seawrack.position) && st.walk;
    tNow += dt;
    api.active = !!on;
    root.visible = !!on;
    if (!on) {
      if (overridden && seawrack && seawrack.setOutline) seawrack.setOutline(true);
      if (overridden) { overridden = false; wc.near = 1; wc.updateProjectionMatrix(); }
      return;
    }
    ensurePeople(st);
    const sw = st.seawrack;
    root.position.set(sw.position.x, sw.position.y, sw.position.z);
    root.rotation.set(0, -sw.heading, 0);
    const stage = st.stage, area = st.area;
    deckG.visible = area === 'deck' || stage === 'homecoming';
    corridorG.visible = area === 'corridor' || stage === 'lift';
    commandG.visible = area === 'command' || stage === 'lift';
    // homecoming: the covers of hold two swing open, the Xi comes in over the stern, sinks into the hold, the covers close.
    // Afterwards the Xi stays hidden below and the covers stay shut.
    const cine = stage === 'homecoming' ? num(st.cine, 0) : 1;
    const open = stage === 'homecoming' ? Math.min(ease((cine - 0.08) / 0.2), 1 - ease((cine - 0.74) / 0.16)) : 0;
    if (seawrack && seawrack.setHold) seawrack.setHold(open);
    if (seawrack && seawrack.setOutline) seawrack.setOutline(!(area === 'corridor' || area === 'command' || stage === 'lift'));
    const fly = ease((cine - 0.05) / 0.35), sink = ease((cine - 0.4) / 0.3);
    const k = sink;
    if (xi) {
      const hover = D + 26;
      xi.root.position.set(XI_HOLD.x, (XI_HOLD.feet + (hover - XI_HOLD.feet) * (1 - sink)) + XI_MODEL_HEIGHT / 2 + 60 * (1 - fly), XI_HOLD.z + 70 * (1 - fly));
      xi.root.rotation.set(0.2 * (1 - fly), 0, 0);
      xi.root.visible = stage === 'homecoming';
    }
    // floodlights switch on early in the shot; wands wave while the Xi comes down
    const lightsOn = stage !== 'homecoming' || num(st.cine, 0) > 0.12;
    for (const f of floods) f.visible = lightsOn;
    for (const c of crew) {
      c.w.forEach((w) => {
        const a = (stage === 'homecoming' ? Math.sin(tNow * 3 + c.ph) * 0.9 : 0.2) * w.userData.s;
        w.position.set(w.userData.s * 0.3 + Math.sin(a) * 0.15, 1.15 + Math.cos(a) * 0.25, -0.1);
        w.rotation.z = a;
      });
    }
    // the people turn toward the pilot when he is near (and always while talking to him)
    for (const [, P] of people) {
      const q = P.q, onFloor = q.area === 'command' ? D + A.command.floor : floorY('deck', q.pos[0], q.pos[2]);
      P.m.visible = q.area === area || (q.area === 'deck' && deckG.visible);
      P.m.position.set(q.pos[0], onFloor, q.pos[2]);
      const dx = st.walk.pos.x - q.pos[0], dz = st.walk.pos.z - q.pos[2];
      const near = (st.talk && st.talk.id === q.id) || (q.area === area && Math.hypot(dx, dz) < 6);
      const want = near ? Math.atan2(dx, -dz) : q.yaw;
      let d = want - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      P.yaw += d * (1 - Math.exp(-4 * dt));
      P.m.rotation.y = -P.yaw;
      P.m.scale.y = 1 + 0.008 * Math.sin(tNow * 1.7 + q.pos[0]);
    }
    // camera
    let fov = 74;
    if (stage === 'homecoming') {
      const c = ease(num(st.cine, 0));
      v.lerpVectors(CAM0, CAM1, c);
      toWorld(sw, v, wc.position);
      toWorld(sw, look.set(XI_HOLD.x, D + 6 + 34 * (1 - k), XI_HOLD.z + 20 * (1 - fly)), look);
      m4.lookAt(wc.position, look, UP);
      wc.quaternion.setFromRotationMatrix(m4);
      fov = 46;
    } else {
      const P = st.pilot, step = num(P.step, 0), w = st.walk;
      const mv = Math.min(1, Math.hypot(w.vel.x, w.vel.z) / A.walk);
      const sway = 0.003;
      eul.set(num(P.pitch, 0) + Math.sin(tNow * 1.9) * sway, -num(P.yaw, 0) + Math.sin(tNow * 1.3 + 2) * sway, Math.sin(step * 1.45) * 0.006 * mv + Math.sin(tNow * 0.7) * 0.004);
      wc.quaternion.setFromEuler(eul);
      wc.position.copy(P.position);
      wc.position.y += Math.sin(step * 2.9) * 0.04 * mv;
    }
    if (Math.abs(wc.fov - fov) > 1e-3 || wc.aspect !== aspect || wc.near !== 0.15) { wc.fov = fov; wc.aspect = aspect; wc.near = 0.15; wc.updateProjectionMatrix(); }
    overridden = true;
    monitor.setClean(1);
  }

  function render(renderer, dt) {
    if (!api.active) { hudCleared = true; return; }
    drawAcc += dt;
    if (hudCleared || drawAcc >= 1 / 30 || !(dt > 0)) { drawAcc = 0; hudCleared = false; drawOverlay(); tex.needsUpdate = true; }
    renderer.clearDepth();
    renderer.render(oScene, oCam);
  }
  return Object.assign(api, { update, render });
}
