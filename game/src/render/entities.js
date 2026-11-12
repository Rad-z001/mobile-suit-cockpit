// Entity renderer: pooled cel-shaded meshes for mobile suits / missiles (one mesh per part, CR-002 item 11), instanced
// ribbons for beams & tracers, glow sprites (min on-screen presence), smoke trails, explosions, part debris.
// Reads state.entities only. Unknown types and malformed entries are ignored.
import * as THREE from 'three';
import { plume, toon, toonOutline } from './shaders.js';
import { part as gpart, S as gS, Cz as gCz, merge as gmerge } from './models.js';
import { buildGustav, buildPenelope, buildMissile, outlineGeometry, geoBox, part as mpart, B as mB, GUSTAV, PENELOPE, PENELOPE_FLIGHT } from './models.js';
import { Effects } from './fx.js';
import { getXi, loadXi, makeXiSuit, xiMuzzle } from './xiSuit.js';
import { MODEL_SCALE, XI_COCKPIT, XI_HEAD_VULCAN } from '../state.js';
import { isVec, clamp, num, tmp } from './util.js';

const FWD = new THREE.Vector3(0, 0, -1);
const MISSILE_BASE = 1;        // model units -> metres before MODEL_SCALE
// CR-002b: the missile model (models.js: ~6 units long, 0.44 across) is drawn MODEL_SCALE times real, and on top of
// that widened / lengthened so it still reads as a missile at a few km. Non-uniform group scale, models.js untouched.
const MISSILE_GIRTH = 2.4;     // extra widening (x, y)
const MISSILE_LENGTH = 1.5;    // extra lengthening (z)
const TAIL_Z = 2.4;            // model-space z of the motor nozzle (tail), before scaling

export function createEntities(scene, state, thermalUniform) {
  const fx = new Effects(scene, thermalUniform);
  const timeU = { value: 0 };
  const sunU = { value: new THREE.Vector3(-0.6, 0.12, -0.78).normalize() };
  const pixU = { value: 0.002 };
  const nightU = { value: 0 };

  // ---- geometry: ships are { body, parts }, each with a welded outline twin --------------------------------
  function shipGeo(built) {
    const out = { body: { geo: built.body, outline: outlineGeometry(built.body) }, parts: {} };
    for (const k of Object.keys(built.parts)) {
      const g = built.parts[k], bx = geoBox(g);
      out.parts[k] = { geo: g, outline: outlineGeometry(g), center: bx.center, size: bx.size };
    }
    return out;
  }
  const missGeo = (f) => { const g = buildMissile(f); return { geo: g, outline: outlineGeometry(g) }; };
  const geos = {
    gustav: shipGeo(buildGustav()),
    penelope: shipGeo(buildPenelope('ms')),
    penelopeFlight: null,                      // built on first use (remote Penelope pilot in flight form)
    missile: missGeo(false),
    funnelMissile: missGeo(true),
    gawman: null,                              // built below (CR-004)
  };
  const defs = {
    gustav: { ...GUSTAV, scale: GUSTAV.baseScale * MODEL_SCALE, defaultRadius: 10, glint: [1.0, 0.75, 0.5], plumeCol: [[1.0, 0.45, 0.12], [1.0, 0.9, 0.6]] },
    penelope: { ...PENELOPE, scale: PENELOPE.baseScale * MODEL_SCALE, defaultRadius: 18, glint: [0.7, 0.85, 1.0], plumeCol: [[0.5, 0.35, 1.0], [0.9, 0.95, 1.0]] },
    penelopeFlight: { ...PENELOPE_FLIGHT, scale: PENELOPE_FLIGHT.baseScale * MODEL_SCALE, defaultRadius: 18, glint: [0.7, 0.85, 1.0], plumeCol: [[0.5, 0.35, 1.0], [0.9, 0.95, 1.0]] },
  };
  // CR-004 Gawman: a ~1.8 m low-poly person (origin = mid body, facing -Z), arms and legs splayed in a flail, torch in the hand.
  function buildGawman() {
    const SUITC = 0xd4d8de, DARK = 0x2a2d33, SKIN = 0xc79a7a, TORCH = 0xffffff;
    const P = [];
    P.push(gpart(new THREE.BoxGeometry(0.42, 0.62, 0.24), SUITC, 0, 0.12, 0));
    P.push(gpart(gS(0.13, 8, 6), SKIN, 0, 0.56, 0));
    P.push(gpart(new THREE.BoxGeometry(0.40, 0.14, 0.26), DARK, 0, -0.26, 0));
    P.push(gpart(new THREE.BoxGeometry(0.11, 0.56, 0.11), SUITC, -0.34, 0.30, -0.12, 0.5, 0, 0.9), gpart(new THREE.BoxGeometry(0.11, 0.56, 0.11), SUITC, 0.34, 0.38, -0.20, -0.7, 0, -0.7));
    P.push(gpart(new THREE.BoxGeometry(0.15, 0.80, 0.15), SUITC, -0.18, -0.68, 0.10, -0.3, 0, 0.18), gpart(new THREE.BoxGeometry(0.15, 0.80, 0.15), SUITC, 0.20, -0.66, -0.06, 0.4, 0, -0.25));
    P.push(gpart(new THREE.BoxGeometry(0.06, 0.06, 0.24), TORCH, 0.52, 0.62, -0.42));
    return gmerge(P);
  }
  geos.gawman = (() => { const g = buildGawman(); return { geo: g, outline: outlineGeometry(g) }; })();
  const ALLY_GLINT = [0.45, 1.0, 0.8];
  const getGeo = (type) => geos[type] || (geos[type] = shipGeo(buildPenelope('flight')));
  const missScale = { missile: MISSILE_BASE * MODEL_SCALE, funnelMissile: 0.6 * MISSILE_BASE * MODEL_SCALE };
  const missTail = { missile: TAIL_Z * MISSILE_LENGTH * missScale.missile, funnelMissile: TAIL_Z * MISSILE_LENGTH * missScale.funnelMissile };

  const plumeGeo = new THREE.ConeGeometry(1, 1, 10, 1, true);
  plumeGeo.rotateX(Math.PI / 2);          // apex +Y -> +Z
  plumeGeo.translate(0, 0, 0.5);          // base at z=0, apex at z=1
  const plumeMats = {};
  for (const k of ['gustav', 'penelope', 'penelopeFlight']) {
    plumeMats[k] = new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeU,
        uOuter: { value: new THREE.Vector3(...defs[k].plumeCol[0]) },
        uCore: { value: new THREE.Vector3(...defs[k].plumeCol[1]) },
      },
      vertexShader: plume.vertex,
      fragmentShader: plume.fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  // outline materials: one per type (constant scale)
  const outMats = {};
  for (const k of ['gustav', 'penelope', 'penelopeFlight', 'missile', 'funnelMissile', 'gawman']) {
    const sc = defs[k] ? defs[k].scale : k === 'gawman' ? 1 : missScale[k];
    outMats[k] = new THREE.ShaderMaterial({
      uniforms: { uPixAng: pixU, uScale: { value: sc }, uThermal: thermalUniform },
      vertexShader: toonOutline.vertex, fragmentShader: toonOutline.fragment, side: THREE.BackSide,
    });
  }
  const makeToon = () => new THREE.ShaderMaterial({
    uniforms: { uSun: sunU, uNight: nightU, uThermal: thermalUniform, uHeat: { value: 0.8 }, uFlash: { value: 0 }, uDmg: { value: 0 } },
    vertexShader: toon.vertex, fragmentShader: toon.fragment, vertexColors: true,
  });
  // stump: small dark block left where a part was torn off
  const stumpGeo = mpart(mB(1, 1, 1), 0x15171b);
  const stumpOutline = outlineGeometry(stumpGeo);

  const pool = { xi: [], gustav: [], penelope: [], penelopeFlight: [], missile: [], funnelMissile: [], gawman: [] };
  const live = new Map();       // id -> entry
  let frame = 0;
  const byId = new Map();       // id -> entity (current frame), for event lookups
  const TARGET_MASK_LAYER = 1;
  const targetMaskMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false });
  let targetMaskEntry = null;

  function renderTargetMask(renderer, camera, targetRt, targetId) {
    const entry = targetId == null ? null : live.get(targetId);
    if (entry !== targetMaskEntry) {
      if (targetMaskEntry) targetMaskEntry.group.traverse((obj) => obj.layers.disable(TARGET_MASK_LAYER));
      if (entry) entry.group.traverse((obj) => obj.layers.enable(TARGET_MASK_LAYER));
      targetMaskEntry = entry;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousLayers = camera.layers.mask;
    const previousOverride = scene.overrideMaterial;
    renderer.setRenderTarget(targetRt);
    renderer.clear(true, true, true);
    try {
      if (entry) {
        scene.overrideMaterial = targetMaskMat;
        camera.layers.set(TARGET_MASK_LAYER);
        renderer.render(scene, camera);
      }
    } finally {
      camera.layers.mask = previousLayers;
      scene.overrideMaterial = previousOverride;
      renderer.setRenderTarget(previousTarget);
    }
  }

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _t = new THREE.Vector3();

  function toonMesh(group, g, type, mat) {
    const mesh = new THREE.Mesh(g.geo, mat);
    const out = new THREE.Mesh(g.outline, outMats[type]);
    mesh.frustumCulled = false; out.frustumCulled = false;
    group.add(out, mesh);
    return { mesh, out, mat };
  }

  // ---- CR-005 Xi: one textured mesh (xiSuit.js); part damage is shown with smoke / embers / scorch glow at local points ----------
  const XI_SHARED = { sun: sunU, night: nightU, thermal: thermalUniform };
  const XI_PARTS = { head: [0, 11.7, -1.2], rArm: [6.2, 5.5, -0.5], lArm: [-6.2, 5.5, -0.5], legs: [0, -8.5, 0], pack: [0, 8.5, 3.4], pods: [-5, 10.5, 3.4] };
  for (const k in XI_PARTS) { XI_PARTS[k][0] -= XI_COCKPIT.x; XI_PARTS[k][1] -= XI_COCKPIT.y; XI_PARTS[k][2] -= XI_COCKPIT.z; }   // CR-006: pose space origin = chest cockpit
  const XI_FLIGHT_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);   // nose-first, prone, backpack up
  const XI_ID_Q = new THREE.Quaternion();
  function makeXiEntry() {
    const group = new THREE.Group();
    const pose = new THREE.Group();
    const suit = makeXiSuit(XI_SHARED);                              // CR-006: mesh + beam rifle, arm pose
    const mesh = suit.mesh;
    suit.root.position.set(-XI_COCKPIT.x, -XI_COCKPIT.y, -XI_COCKPIT.z);   // the entity position is the chest cockpit
    pose.add(suit.root); group.add(pose);
    return { type: 'xi', group, pose, mesh, suit, plumes: [], parts: null, body: { mat: mesh.material }, mats: suit.mats, emitT: 0, seen: 0, id: -1, flash: 0, heat: 0.8, pt: {}, flight: 0 };
  }
  function xiStep(e, dist, px1, dt, view) {
    if (!getXi()) { loadXi(); return; }
    let en = live.get(e.id);
    if (!en || en.type !== 'xi') {
      if (en) { release(en); live.delete(e.id); }
      en = acquire('xi'); en.id = e.id; en.remote = e.type === 'remote'; en.born = frame; live.set(e.id, en);
    }
    en.seen = frame;
    const s = MODEL_SCALE;
    en.group.position.set(e.position.x, e.position.y, e.position.z);
    if (e.quaternion && typeof e.quaternion.w === 'number') en.group.quaternion.set(e.quaternion.x, e.quaternion.y, e.quaternion.z, e.quaternion.w);
    en.group.scale.setScalar(s);
    en.pose.quaternion.slerp(e.form === 'flight' ? XI_FLIGHT_Q : XI_ID_Q, 1 - Math.exp(-4 * dt));
    en.group.updateMatrixWorld(true);
    setHeat(en, num(e.heat, 0.8));
    en.flash = Math.max(0, en.flash - dt * 6);
    en.mesh.material.uniforms.uFlash.value = en.flash * 0.35;
    // part damage
    const parts = e.parts && typeof e.parts === 'object' ? e.parts : null;
    // CR-006: rifle in the right hand, arm raised along the crosshair (remote pilots: straight ahead); lowered in the flight
    // form, hidden with the saber out or the arm gone
    const ra = parts && parts.rArm;
    const rifleOn = e.weapon !== 'saber' && !(ra && (ra.status === 'destroyed' || ra.hp <= 0));
    en.suit.pose(dt, { raise: rifleOn && e.form !== 'flight' && !e.dead, aim: e.aimLocal || null, rifle: rifleOn, snap: frame - en.born < 2 });
    en.group.updateMatrixWorld(true);
    let dmg = 0;
    if (parts) for (const k in XI_PARTS) {
      const st = parts[k] ? (parts[k].status || (parts[k].hp <= 0 ? 'destroyed' : 'ok')) : 'ok';
      const prev = en.pt[k] || { st: 'ok', t: 0 };
      if (st !== prev.st) {
        if (st === 'destroyed' && frame - en.born > 3) { _b.fromArray(XI_PARTS[k]); en.pose.localToWorld(_b); fx.explosion(_b.x, _b.y, _b.z, 1); fx.spark(_b.x, _b.y, _b.z, 10); }
        prev.st = st;
      }
      en.pt[k] = prev;
      if (st === 'ok') continue;
      dmg += st === 'destroyed' ? 0.8 : 0.3;
      _b.fromArray(XI_PARTS[k]); en.pose.localToWorld(_b);
      prev.t += dt;
      const per = st === 'destroyed' ? 0.07 : 0.16;
      if (prev.t >= per) {
        prev.t = 0;
        const hv = isVec(e.velocity);
        const g = st === 'destroyed' ? 0.05 : 0.17;
        fx.smoke.spawn(_b.x, _b.y, _b.z, (hv ? e.velocity.x * 0.3 : 0) + (Math.random() - 0.5) * 3, 5 + Math.random() * 4, (hv ? e.velocity.z * 0.3 : 0) + (Math.random() - 0.5) * 3,
          (st === 'destroyed' ? 4 : 3) * s * 0.6, (st === 'destroyed' ? 16 : 11) * s * 0.6, g, g, g * 1.05, st === 'destroyed' ? 0.9 : 0.6, st === 'destroyed' ? 2.4 : 1.8);
        if (st === 'destroyed' && Math.random() < 0.3) fx.spark(_b.x, _b.y, _b.z, 2);
      }
      // scorch: a warm emissive patch at the part (additive glow; flickers on a destroyed part, steady dim on a damaged one)
      const fl = st === 'destroyed' ? 0.55 + 0.3 * Math.sin(timeU.value * 17 + k.length) : 0.2;
      fx.glow.add(_b.x, _b.y, _b.z, Math.max(2.2 * s, dist * view.pixAng * 6), 1.0, 0.42, 0.1, fl);
    }
    en.mesh.material.uniforms.uDmg.value = clamp(dmg / 3, 0, 0.8);
    if (e.type === 'remote') remoteExtras(en, e, 'xi', dt);
    const modelPx = (14 * s * 2) / px1;
    const ga = clamp(1.15 - modelPx / 22, 0, 1);
    const gc = e.faction === 'ally' ? ALLY_GLINT : [0.9, 0.9, 1.0];
    if (ga > 0.02) fx.glow.add(e.position.x, e.position.y, e.position.z, px1 * 16, gc[0], gc[1], gc[2], 0.9 * ga);
  }

  function makeEntry(type) {
    if (type === 'xi') return makeXiEntry();
    const group = new THREE.Group();
    group.matrixAutoUpdate = true;
    const entry = { type, group, plumes: [], parts: null, body: null, mats: [], emitT: 0, seen: 0, id: -1, flash: 0, heat: 0.8 };
    const G = getGeo(type);
    if (G.parts) {
      const bm = makeToon();
      entry.body = toonMesh(group, G.body, type, bm);
      entry.mats.push(bm);
      entry.parts = {};
      for (const k of Object.keys(G.parts)) {
        const pm = makeToon();
        const pg = G.parts[k];
        const t = toonMesh(group, pg, type, pm);
        const stumpMat = makeToon();
        const stump = new THREE.Mesh(stumpGeo, stumpMat);
        stump.position.copy(pg.center);
        stump.scale.set(Math.min(pg.size.x, 2.4) * 0.6, Math.min(pg.size.y, 2.4) * 0.6, Math.min(pg.size.z, 2.4) * 0.6);
        stump.visible = false;
        const so = new THREE.Mesh(stumpOutline, outMats[type]);
        so.position.copy(stump.position); so.scale.copy(stump.scale); so.visible = false;
        stump.frustumCulled = so.frustumCulled = false;
        group.add(so, stump);
        entry.mats.push(pm, stumpMat);
        entry.parts[k] = { ...t, stump, stumpOut: so, status: 'ok', hp: 1, smokeT: 0, center: pg.center, size: pg.size };
      }
      for (const n of defs[type].nozzles) {
        const p = new THREE.Mesh(plumeGeo, plumeMats[type]);
        p.position.set(n[0], n[1], n[2]);
        p.scale.set(n[3], n[3], n[4]);
        group.add(p);
        entry.plumes.push({ mesh: p, part: n[5], base: [n[3], n[4]], on: 1 });
      }
    } else {
      const m = makeToon();
      entry.body = toonMesh(group, G, type, m);
      entry.mats.push(m);
    }
    return entry;
  }
  function acquire(type) {
    const e = pool[type].pop() || makeEntry(type);
    if (e.parts) {
      for (const k in e.parts) {
        const p = e.parts[k];
        p.status = 'ok'; p.hp = 1; p.smokeT = 0;
        p.mesh.visible = true; p.out.visible = true; p.stump.visible = false; p.stumpOut.visible = false;
        p.mat.uniforms.uDmg.value = 0; p.mat.uniforms.uFlash.value = 0;
      }
      for (const pl of e.plumes) { pl.mesh.visible = true; pl.mesh.scale.set(pl.base[0], pl.base[0], pl.base[1]); pl.on = 1; }
    }
    e.flash = 0;
    e.body.mat.uniforms.uFlash.value = 0;
    scene.add(e.group);
    return e;
  }
  function release(entry) {
    scene.remove(entry.group);
    pool[entry.type].push(entry);
  }
  function setHeat(entry, heat) {
    entry.heat = heat;
    for (const m of entry.mats) m.uniforms.uHeat.value = heat;
  }

  // ---- debris of torn-off parts: pooled, tumbling, ballistic ----------------------------------------------
  const debris = [];
  function spawnDebris(entry, name, ent) {
    const p = entry.parts && entry.parts[name];
    if (!p) return;
    const type = entry.type;
    let d = debris.find((x) => !x.active);
    if (!d) {
      if (debris.length >= 24) return;
      d = { active: false, g: new THREE.Group(), mesh: null, out: null, v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0, emit: 0, mat: makeToon(), s0: 1 };
      d.mat.uniforms.uDmg.value = 0.5;
      debris.push(d);
    }
    const G = getGeo(type).parts[name];
    if (d.mesh) d.g.remove(d.mesh, d.out);
    d.mesh = new THREE.Mesh(G.geo, d.mat);
    d.out = new THREE.Mesh(G.outline, outMats[type]);
    d.mesh.frustumCulled = d.out.frustumCulled = false;
    d.mesh.position.copy(G.center).negate(); d.out.position.copy(G.center).negate();
    d.g.add(d.out, d.mesh);
    d.s0 = defs[type].scale;
    d.g.scale.setScalar(d.s0);
    entry.group.updateMatrixWorld(true);
    _b.copy(G.center).applyMatrix4(entry.group.matrixWorld);
    d.g.position.copy(_b);
    d.g.quaternion.copy(entry.group.quaternion);
    _d.copy(_b).sub(entry.group.position);
    const l = _d.length() || 1;
    _d.multiplyScalar(1 / l);
    const hv = ent && isVec(ent.velocity);
    const vx = hv ? ent.velocity.x : 0, vy = hv ? ent.velocity.y : 0, vz = hv ? ent.velocity.z : 0;
    d.v.set(vx + _d.x * 18 + (Math.random() - 0.5) * 10, vy + _d.y * 18 + 6 + (Math.random() - 0.5) * 8, vz + _d.z * 18 + (Math.random() - 0.5) * 10);
    d.w.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
    d.t = 3; d.emit = 0; d.active = true;
    d.mat.uniforms.uHeat.value = 1.0;
    scene.add(d.g);
  }
  function updateDebris(dt) {
    for (const d of debris) {
      if (!d.active) continue;
      d.t -= dt;
      if (d.t <= 0) { d.active = false; scene.remove(d.g); continue; }
      d.v.y -= 9.8 * dt;
      d.g.position.addScaledVector(d.v, dt);
      tmp.q1.setFromEuler(tmp.e1.set(d.w.x * dt, d.w.y * dt, d.w.z * dt));
      d.g.quaternion.premultiply(tmp.q1);
      d.g.scale.setScalar(d.s0 * (d.t < 0.5 ? d.t / 0.5 : 1));
      d.emit += dt;
      if (d.emit > 0.07) {
        d.emit = 0;
        fx.smoke.spawn(d.g.position.x, d.g.position.y, d.g.position.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3,
          3.5, 12, 0.10, 0.10, 0.11, 0.8, 1.6);
      }
    }
  }

  // Clip the segment tail->head so the tail is at least `near` metres in front of the camera.
  function clipTail(tail, head, view, near) {
    const zt = _d.copy(tail).sub(view.pos).dot(view.fwd);
    const zh = _w.copy(head).sub(view.pos).dot(view.fwd);
    if (zh < near) return false;
    if (zt < near) {
      const k = (near - zt) / (zh - zt);
      tail.lerp(head, k);
    }
    return true;
  }

  // ---- film-style beams (reference 16): player GREEN heavy, enemy PINK heavy, enemy light thinner and paler -----
  // LOOK KNOBS: quad half width (glow), visible bolt length, trail life, min px.
  const BEAM = {
    halfW: [5, 30],          // light .. heavy  (m)
    len: [260, 1150],        // visible bolt incl. the long thin tail (m)
    trail: [0.35, 1.1],      // seconds the trail lingers
    minPx: [5, 20],          // minimum on-screen half width of the glow quad (px)
    crackle: [0.4, 0.7],
  };
  const GREEN = [0.020, 1.0, 0.150], GREEN_CORE = [0.92, 1.0, 0.95];
  const PINK = [1.0, 0.12, 0.45], PINK_CORE = [1.0, 0.92, 0.96];
  const MUZZLE = new THREE.Vector3(3.4, -1.9, -7.0);   // right hand, body space, relative to the eye
  // CR-006: body-space point (metres, relative to the pilot) where the player's own beam visibly starts. Xi in the MS form:
  // the muzzle of the rifle held in the right hand, following the crosshair. Other suits / flight form: the old fixed point.
  const _aimL = new THREE.Vector3(), _qInv = new THREE.Quaternion();
  function ownMuzzle(pl, out) {
    if (pl.suit === 'gustav' || pl.suit === 'penelope' || pl.flightMode === 'minovsky' || !getXi()) return out.copy(MUZZLE);
    if (pl.aim && isVec(pl.aim.dir)) _aimL.copy(pl.aim.dir).applyQuaternion(_qInv.copy(pl.quaternion).invert()); else _aimL.set(0, 0, -1);
    xiMuzzle(_aimL, out);
    return out.set(out.x - XI_COCKPIT.x, out.y - XI_COCKPIT.y, out.z - XI_COCKPIT.z).multiplyScalar(MODEL_SCALE);
  }
  const beamSt = new Map();       // id -> { seen, ox,oy,oz, px,py,pz (prev visual head), sx,sy,sz (true start), x0,y0,z0 (visual origin), trav }
  const recentHits = [];          // player beam heads of the last frames { x,y,z,t }
  let beamT = 0;
  let pixAngNow = 0.002;
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const out = { pink: 0 };         // read by index.js: cockpit pink flash from passing enemy heavy beams

  function drawBeam(e, view, dt) {
    const enemy = e.faction !== 'player';
    const pw = clamp(num(e.power, enemy ? 1 : 1), 0.1, 1.2);
    const f = clamp((pw - 0.3) / 0.7, 0, 1);
    const hasV = isVec(e.velocity);
    let vx = hasV ? e.velocity.x : 0, vy = hasV ? e.velocity.y : 0, vz = hasV ? e.velocity.z : 0;
    let sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (sp < 1e-3) {
      _d.copy(FWD);
      if (e.quaternion && typeof e.quaternion.w === 'number') _d.applyQuaternion(tmp.q1.set(e.quaternion.x, e.quaternion.y, e.quaternion.z, e.quaternion.w));
      vx = _d.x; vy = _d.y; vz = _d.z; sp = 1;
    }
    const dx = vx / sp, dy = vy / sp, dz = vz / sp;
    let st = beamSt.get(e.id);
    const pl = state.player;
    if (!st) {
      st = { seen: 0, ox: 0, oy: 0, oz: 0, px: 0, py: 0, pz: 0, sx: e.position.x, sy: e.position.y, sz: e.position.z, x0: 0, y0: 0, z0: 0, trav: 0, first: true };
      if (!enemy && pl && isVec(pl.position) && pl.quaternion && Math.hypot(e.position.x - pl.position.x, e.position.y - pl.position.y, e.position.z - pl.position.z) < 80) {
        // visual origin = the suit's right hand; the bolt bends onto the true line as it travels
        ownMuzzle(pl, _a).applyQuaternion(pl.quaternion).add(pl.position);
        st.ox = _a.x - e.position.x; st.oy = _a.y - e.position.y; st.oz = _a.z - e.position.z;
      }
      beamSt.set(e.id, st);
    }
    st.seen = frame;
    st.trav = Math.hypot(e.position.x - st.sx, e.position.y - st.sy, e.position.z - st.sz);
    const k = 1 - sstep(st.trav / 1100);
    const hx = e.position.x + st.ox * k, hy = e.position.y + st.oy * k, hz = e.position.z + st.oz * k;
    if (st.first) { st.px = hx; st.py = hy; st.pz = hz; st.x0 = hx; st.y0 = hy; st.z0 = hz; }
    // tail: one bolt length behind the head along the visual path, never behind the origin
    const len = lerp(BEAM.len[0], BEAM.len[1], f);
    let tx = hx - dx * len, ty = hy - dy * len, tz = hz - dz * len;
    const back = (hx - st.x0) * dx + (hy - st.y0) * dy + (hz - st.z0) * dz;
    if (back < len) { tx = st.x0; ty = st.y0; tz = st.z0; }
    const halfW = lerp(BEAM.halfW[0], BEAM.halfW[1], f);
    const minPx = lerp(BEAM.minPx[0], BEAM.minPx[1], f);
    const crk = lerp(BEAM.crackle[0], BEAM.crackle[1], f);
    let oc, cc;
    if (!enemy) { oc = GREEN; cc = GREEN_CORE; }
    else {
      const pale = (1 - f) * 0.5;           // light shots: paler pink
      oc = [lerp(PINK[0], 1, pale), lerp(PINK[1], 0.6, pale), lerp(PINK[2], 0.8, pale)];
      cc = PINK_CORE;
    }
    fx.beams.add(tx, ty, tz, hx, hy, hz, halfW, oc[0], oc[1], oc[2], cc[0], cc[1], cc[2], crk, minPx);
    // lingering trail: segment prev head -> head, fades / widens over its life
    if (!st.first) {
      const sl = Math.hypot(hx - st.px, hy - st.py, hz - st.pz);
      if (sl > 0.5) {
        fx.trails.spawn(st.px, st.py, st.pz, hx, hy, hz, halfW * 0.7, oc[0], oc[1], oc[2], cc[0], cc[1], cc[2],
          fx.uniforms.uNow.value, lerp(BEAM.trail[0], BEAM.trail[1], f), (e.id * 0.37) % 1, minPx * 0.6);
      }
    }
    st.px = hx; st.py = hy; st.pz = hz;
    st.first = false;
    // head glow (bloom-like halo) with a minimum on-screen presence
    _w.set(hx, hy, hz);
    const hd = Math.max(1, _w.distanceTo(view.pos));
    const gs = Math.max(lerp(10, 44, f), hd * view.pixAng * lerp(10, 22, f));
    fx.glow.add(hx, hy, hz, gs, oc[0] * 0.9 + 0.1, oc[1] * 0.9 + 0.1, oc[2] * 0.9 + 0.1, 0.8);
    if (f > 0.5) fx.glow.add(hx, hy, hz, gs * 0.3, 1, 1, 1, 0.9);
    if (!enemy) {
      recentHits.push({ x: hx, y: hy, z: hz, t: beamT });
      if (recentHits.length > 24) recentHits.shift();
    } else if (f > 0.5 && pl && isVec(pl.position)) {
      // pink wash on the cockpit when an enemy heavy shot passes close
      const ax = st.px, ay = st.py, az = st.pz;
      const d = Math.hypot(ax - pl.position.x, ay - pl.position.y, az - pl.position.z);
      if (d < 90) out.pink = Math.max(out.pink, (1 - d / 90) * f);
    }
  }
  function nearRecentBeam(x, y, z, r) {
    for (let i = recentHits.length - 1; i >= 0; i--) {
      const h = recentHits[i];
      if (beamT - h.t > 0.6) break;
      if (Math.hypot(h.x - x, h.y - y, h.z - z) < r) return true;
    }
    return false;
  }

  // ---- per-ship part state: hide destroyed parts, show stumps, smoke damaged ones --------------------------
  function updateParts(en, e, dt, view, s) {
    const parts = e.parts && typeof e.parts === 'object' ? e.parts : null;
    en.flash = Math.max(0, en.flash - dt * 6);
    en.body.mat.uniforms.uFlash.value = en.flash * 0.35;
    if (!en.parts) return;
    en.group.updateMatrixWorld(true);
    for (const k in en.parts) {
      const p = en.parts[k];
      const src = parts ? parts[k] : null;
      let status = 'ok', hpf = 1;
      if (src) {
        status = src.status || (src.hp <= 0 ? 'destroyed' : src.hp < 0.5 * (src.maxHp || 1) ? 'damaged' : 'ok');
        hpf = clamp(num(src.hp, 1) / Math.max(1, num(src.maxHp, 1)), 0, 1);
      }
      if (status !== p.status) {
        const dead = status === 'destroyed';
        if (dead && en.remote && frame - en.born > 3) {          // remote pilot lost a part: no sim event drives it, so burst here
          en.group.updateMatrixWorld(true);
          _b.copy(p.center).applyMatrix4(en.group.matrixWorld);
          fx.explosion(_b.x, _b.y, _b.z, 1);
          spawnDebris(en, k, e);
        }
        p.status = status;
        p.mesh.visible = !dead; p.out.visible = !dead;
        p.stump.visible = dead; p.stumpOut.visible = dead;
      }
      p.hp = hpf;
      p.mat.uniforms.uDmg.value = clamp((1 - hpf) * 0.85, 0, 0.85);
      p.mat.uniforms.uFlash.value = p.flash > 0 ? p.flash * 0.6 : 0;
      if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 7);
      // smoke: damaged = thin grey, destroyed stump = thick dark with embers
      if (status !== 'ok') {
        p.smokeT += dt;
        const per = status === 'destroyed' ? 0.06 : 0.14;
        if (p.smokeT >= per) {
          p.smokeT = 0;
          _b.copy(p.center).applyMatrix4(en.group.matrixWorld);
          const rise = status === 'destroyed' ? 9 : 5;
          const hv = isVec(e.velocity);
          const g = status === 'destroyed' ? 0.05 : 0.17;
          fx.smoke.spawn(_b.x, _b.y, _b.z, (hv ? e.velocity.x * 0.3 : 0) + (Math.random() - 0.5) * 3, rise + Math.random() * 3, (hv ? e.velocity.z * 0.3 : 0) + (Math.random() - 0.5) * 3,
            (status === 'destroyed' ? 4 : 3) * s * 0.6, (status === 'destroyed' ? 16 : 11) * s * 0.6, g, g, g * 1.05, status === 'destroyed' ? 0.9 : 0.6, status === 'destroyed' ? 2.4 : 1.8);
          if (status === 'destroyed' && Math.random() < 0.3) fx.spark(_b.x, _b.y, _b.z, 2);
        }
      }
    }
    // plumes follow their part
    for (const pl of en.plumes) {
      const p = en.parts[pl.part];
      const st = p ? p.status : 'ok';
      const on = st === 'destroyed' ? 0 : st === 'damaged' ? 0.45 + 0.35 * Math.random() : 1;
      pl.on = on;
      pl.mesh.visible = on > 0.01;
      pl.mesh.scale.set(pl.base[0] * (0.4 + 0.6 * on), pl.base[0] * (0.4 + 0.6 * on), pl.base[1] * on);
    }
  }

  // ---- remote pilots: thruster scale from velocity, raised shield plate, spawn-protection shimmer, saber blade -----------
  const shieldMat = new THREE.MeshBasicMaterial({ color: 0x55e8ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const shimmerMat = new THREE.MeshBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true });
  const bladeMat = new THREE.MeshBasicMaterial({ color: 0xff9ae6, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const shieldGeo = new THREE.BoxGeometry(6.5, 9.5, 0.3);
  const shimmerGeo = new THREE.IcosahedronGeometry(1, 1);
  const bladeGeo = new THREE.CylinderGeometry(0.28, 0.28, 9, 6).rotateX(Math.PI / 2);
  const RX = {   // per rendered type: shimmer radius, shield plate pose, saber blade pose (model units)
    gustav: { r: 11, shield: [-1.6, 4.0, -3.6, 0.3], saber: [4.05, 0.2, -6.0] },
    penelope: { r: 19, shield: null, saber: [3.9, -3.0, -6.5] },
    penelopeFlight: { r: 20, shield: null, saber: null },
    xi: { r: 22, shield: [-6.5, 3.0 - XI_COCKPIT.y, -4.5 - XI_COCKPIT.z, 0.3], saber: [7.0, 3.0 - XI_COCKPIT.y, -8.5 - XI_COCKPIT.z] },
  };
  function remoteExtras(en, e, rtype, dt) {
    const cfg = RX[rtype];
    if (!en.rx) {
      en.rx = { shield: new THREE.Mesh(shieldGeo, shieldMat), shimmer: new THREE.Mesh(shimmerGeo, shimmerMat), blade: new THREE.Mesh(bladeGeo, bladeMat) };
      for (const m of Object.values(en.rx)) { m.visible = false; m.frustumCulled = false; en.group.add(m); }
      en.rx.shimmer.scale.setScalar(cfg.r);
      if (cfg.shield) { en.rx.shield.position.set(cfg.shield[0], cfg.shield[1], cfg.shield[2]); en.rx.shield.rotation.y = cfg.shield[3]; }
      if (cfg.saber) en.rx.blade.position.set(cfg.saber[0], cfg.saber[1], cfg.saber[2]);
    }
    const x = en.rx;
    x.shield.visible = !!(e.shield && cfg.shield);
    x.shimmer.visible = !!e.spawnShield;
    x.blade.visible = !!(e.weapon === 'saber' && cfg.saber);
    let sp = 0;
    if (isVec(e.velocity)) sp = Math.hypot(e.velocity.x, e.velocity.y, e.velocity.z);
    const k = clamp(0.3 + sp / 140, 0.3, 1.4);
    for (const pl of en.plumes) {
      if (pl.on < 0.05) continue;
      pl.mesh.scale.z *= k; pl.mesh.scale.x *= 0.6 + 0.4 * k; pl.mesh.scale.y *= 0.6 + 0.4 * k;
    }
    if (x.shimmer.visible) shimmerMat.opacity = 0.14 + 0.1 * Math.sin(timeU.value * 14);
    if (x.shield.visible) shieldMat.opacity = 0.24 + 0.08 * Math.sin(timeU.value * 9);
  }

  let selfEnt = null;                       // CR-005: the player's own suit in chase view (a synthetic remote-style entity, render only)
  function setSelf(ent) { selfEnt = ent; }
  function update(dt, view) {
    // view = { pos, fwd, pixAng, thermal(bool) }
    frame++;
    timeU.value += dt;
    beamT += dt;
    pixAngNow = view.pixAng;
    pixU.value = view.pixAng;
    const sd = state.world && isVec(state.world.sunDir) ? state.world.sunDir : null;
    const night = !!(state.world && state.world.night);
    nightU.value += ((night ? 1 : 0) - nightU.value) * Math.min(1, dt * 2.2);
    const md = night && state.world && isVec(state.world.moonDir) ? state.world.moonDir : null;
    if (md) sunU.value.set(md.x, md.y, md.z).normalize();
    else if (sd) sunU.value.set(sd.x, sd.y, sd.z).normalize();
    fx.beamMat.uniforms.uPixAng.value = view.pixAng;
    out.pink = 0;
    fx.glow.begin();
    fx.beams.begin();
    byId.clear();
    const list = Array.isArray(state.entities) ? state.entities : [];
    const nTot = list.length + (selfEnt ? 1 : 0);
    for (let i = 0; i < nTot; i++) {
      const e = i < list.length ? list[i] : selfEnt;
      if (!e || e.alive === false || !isVec(e.position)) continue;
      byId.set(e.id, e);
      const type = e.type;
      const px = e.position.x, py = e.position.y, pz = e.position.z;
      _a.set(px, py, pz);
      const dist = Math.max(1, _a.distanceTo(view.pos));
      const px1 = dist * view.pixAng;          // metres per pixel at this distance

      if ((type === 'remote' && e.suit === 'xi')) { xiStep(e, dist, px1, dt, view); continue; }
      if (type === 'gustav' || type === 'penelope' || type === 'remote') {
        const remote = type === 'remote';
        if (remote && e.dead) continue;                          // hidden while dead (entry is retired below)
        const rtype = remote ? (e.suit === 'penelope' ? (e.form === 'flight' ? 'penelopeFlight' : 'penelope') : 'gustav') : type;
        let en = live.get(e.id);
        if (!en || en.type !== rtype) {
          if (en) { release(en); live.delete(e.id); }
          en = acquire(rtype);
          en.id = e.id;
          en.remote = remote;
          en.born = frame;
          live.set(e.id, en);
        }
        en.seen = frame;
        const d = defs[rtype];
        const s = d.scale;
        en.group.position.set(px, py, pz);
        if (e.quaternion && typeof e.quaternion.w === 'number') en.group.quaternion.set(e.quaternion.x, e.quaternion.y, e.quaternion.z, e.quaternion.w);
        en.group.scale.setScalar(s);
        en.group.updateMatrix();
        en.group.updateMatrixWorld(true);
        setHeat(en, num(e.heat, 0.8));
        updateParts(en, e, dt, view, s);
        if (remote) remoteExtras(en, e, rtype, dt);
        // thruster glows
        for (const pl of en.plumes) {
          if (pl.on < 0.05) continue;
          pl.mesh.getWorldPosition(_b);
          const gs = Math.max(pl.mesh.scale.x * s * 5, _b.distanceTo(view.pos) * view.pixAng * 7);
          fx.glow.add(_b.x, _b.y, _b.z, gs, d.plumeCol[1][0], d.plumeCol[1][1], d.plumeCol[1][2], 0.8 * pl.on);
        }
        // minimum presence: glint star that fades out as the model itself becomes big enough
        const modelPx = (d.defaultRadius * s * 2) / px1;
        const ga = clamp(1.15 - modelPx / 22, 0, 1);
        const gc = remote && e.faction === 'ally' ? ALLY_GLINT : d.glint;      // IFF: allies glint cyan-green, hostiles warm
        if (ga > 0.02) fx.glow.add(px, py, pz, px1 * 16, gc[0], gc[1], gc[2], 0.9 * ga);
      } else if (type === 'gawman') {
        // body only when it can be seen; at range only the flashlight (a hard point + a soft cone along `light`)
        let en = live.get(e.id);
        const showBody = dist < 260;
        if (showBody && (!en || en.type !== 'gawman')) { en = acquire('gawman'); en.id = e.id; live.set(e.id, en); }
        if (en && showBody) {
          en.seen = frame;
          en.group.position.set(px, py, pz);
          if (e.quaternion && typeof e.quaternion.w === 'number') en.group.quaternion.set(e.quaternion.x, e.quaternion.y, e.quaternion.z, e.quaternion.w);
          en.group.scale.setScalar(1);
          setHeat(en, 0.6);
        } else if (en) { release(en); live.delete(e.id); }
        const L = isVec(e.light) ? e.light : null;
        _t.set(px, py, pz);
        if (L && e.quaternion && typeof e.quaternion.w === 'number' && showBody) {            // torch is in his hand, not at his centre
          _w.set(0.52, 0.62, -0.42).applyQuaternion(e.quaternion); _t.add(_w);
        }
        const tw = 0.9 + 0.1 * Math.sin(timeU.value * 17 + e.id);
        const near = clamp(dist / 160, 0.12, 1);              // close up the glare shrinks so the person stays readable
        fx.glow.add(_t.x, _t.y, _t.z, Math.min(Math.max(0.3, px1 * 14) * tw, 2.5), 1.0, 0.95, 0.80, 1.0);
        fx.glow.add(_t.x, _t.y, _t.z, Math.min(Math.max(1.0, px1 * 34) * tw, 7), 1.0, 0.92, 0.70, 0.5 * (0.4 + 0.6 * near));
        if (L) {
          _d.set(L.x, L.y, L.z).normalize();
          _a.copy(view.pos).sub(_t).normalize();
          const face = Math.max(0, _d.dot(_a));                // beam aimed at the camera reads much brighter
          const gain = 0.12 + 0.88 * Math.pow(face, 1.5);
          if (gain > 0.13) {
            _a.set(0, 0, 0);
            for (let k = 0; k < 7; k++) {
              const dd = 4 * Math.pow(1.9, k);
              fx.glow.add(_t.x + _d.x * dd, _t.y + _d.y * dd, _t.z + _d.z * dd, dd * 0.55, 0.9, 0.92, 0.85, Math.min(0.5, 0.42 * gain * near / (1 + k * 0.45)));
            }
            fx.glow.add(_t.x, _t.y, _t.z, Math.min(Math.max(3, px1 * 60), 24), 1.0, 0.94, 0.78, 0.35 * face * near);
          }
        }
      } else if (type === 'missile' || type === 'funnelMissile') {
        const funnel = type === 'funnelMissile';
        let en = live.get(e.id);
        if (!en || en.type !== type) {
          if (en) { release(en); live.delete(e.id); }
          en = acquire(type);
          en.id = e.id;
          en.emitT = 0;
          en.hasTail = false;
          live.set(e.id, en);
        }
        en.seen = frame;
        en.group.position.set(px, py, pz);
        const hasV = isVec(e.velocity);
        const vx = hasV ? e.velocity.x : 0, vy = hasV ? e.velocity.y : 0, vz = hasV ? e.velocity.z : 0;
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (sp > 1) {
          _d.set(vx / sp, vy / sp, vz / sp);
          en.group.quaternion.setFromUnitVectors(FWD, _d);
        } else if (e.quaternion && typeof e.quaternion.w === 'number') {
          en.group.quaternion.set(e.quaternion.x, e.quaternion.y, e.quaternion.z, e.quaternion.w);
        }
        const ms = missScale[type];
        en.group.scale.set(ms * MISSILE_GIRTH, ms * MISSILE_GIRTH, ms * MISSILE_LENGTH);
        setHeat(en, 1);
        // motor nozzle (tail) in world space; the flare, the smoke and the glowing exhaust ribbon all start there
        const dirLen = sp > 1 ? 1 / sp : 0;
        if (sp > 1) _t.set(px - vx * dirLen * missTail[type], py - vy * dirLen * missTail[type], pz - vz * dirLen * missTail[type]);
        else _t.set(px, py, pz);
        // bright exhaust flare (reference 13: white-hot point with a warm halo), pulsing, at least ~20 px across so it
        // reads at distance; the funnel missile's flare is hot pink to tell it apart from the enemy's orange one
        const pulse = 0.84 + 0.16 * Math.sin(timeU.value * 26 + e.id * 1.9);
        const gsize = Math.max(funnel ? 10 : 26, px1 * (funnel ? 24 : 46)) * pulse;
        if (funnel) {
          fx.glow.add(_t.x, _t.y, _t.z, gsize, 1.0, 0.36, 0.85, 1.0);
          fx.glow.add(_t.x, _t.y, _t.z, gsize * 0.4, 1.0, 0.85, 0.95, 1.0);
        } else {
          fx.glow.add(_t.x, _t.y, _t.z, gsize, 1.0, 0.58, 0.20, 1.0);
          fx.glow.add(_t.x, _t.y, _t.z, gsize * 0.5, 1.0, 0.86, 0.55, 1.0);
          fx.glow.add(_t.x, _t.y, _t.z, gsize * 0.2, 1.0, 1.0, 1.0, 1.0);
        }
        // glowing exhaust ribbon: tail(prev) -> tail(now), orange fading to nothing in ~0.8 s, 2 px minimum width
        if (en.hasTail) {
          const sl = Math.hypot(_t.x - en.tx, _t.y - en.ty, _t.z - en.tz);
          if (sl > 0.4 && sl < 250) {
            fx.trails.spawn(en.tx, en.ty, en.tz, _t.x, _t.y, _t.z, (funnel ? 0.9 : 1.6) * MODEL_SCALE * 0.5, funnel ? 1.0 : 1.0, funnel ? 0.3 : 0.5, funnel ? 0.8 : 0.16,
              1.0, 0.92, funnel ? 0.95 : 0.7, fx.uniforms.uNow.value, funnel ? 0.6 : 0.85, (e.id * 0.37) % 1, 2.2);
          }
        }
        en.tx = _t.x; en.ty = _t.y; en.tz = _t.z; en.hasTail = true;
        // smoke trail (reference 13: a long grey-white wiggling line): dense puffs whose size never drops below ~3 px
        en.emitT += dt;
        const period = funnel ? 0.04 : 0.03;
        let guard = 0;
        while (en.emitT >= period && guard++ < 5) {
          en.emitT -= period;
          const back = en.emitT;
          const s0 = Math.max(funnel ? 2.2 : 4.5, px1 * 2.6), s1 = Math.max(funnel ? 9 : 22, px1 * 8);
          fx.smoke.spawn(_t.x - vx * back, _t.y - vy * back, _t.z - vz * back,
            (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5,
            s0, s1, 0.88, 0.86, 0.90, funnel ? 0.55 : 0.68, funnel ? 2.4 : 3.4);
        }
        if (en.emitT > period) en.emitT = 0;
      } else if (type === 'beam') {
        drawBeam(e, view, dt);
      } else if (type === 'tracer') {
        const hasV = isVec(e.velocity);
        let vx = hasV ? e.velocity.x : 0, vy = hasV ? e.velocity.y : 0, vz = hasV ? e.velocity.z : 0;
        let sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (sp < 1e-3) {
          _d.copy(FWD);
          if (e.quaternion && typeof e.quaternion.w === 'number') _d.applyQuaternion(tmp.q1.set(e.quaternion.x, e.quaternion.y, e.quaternion.z, e.quaternion.w));
          vx = _d.x; vy = _d.y; vz = _d.z; sp = 1;
        }
        const dx = vx / sp, dy = vy / sp, dz = vz / sp;
        const len = clamp(sp * 0.03, 12, 90);
        _b.set(px, py, pz);                                  // head
        _a.set(px - dx * len, py - dy * len, pz - dz * len); // tail
        if (!clipTail(_a, _b, view, 2.0)) continue;
        const hw = Math.max(0.3, px1 * 0.8);
        fx.beams.add(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, hw, 1.0, 0.65, 0.2, 1.0, 1.0, 0.8, 0, 0.5);
      } else if (type === 'flare') {
        const hasV = isVec(e.velocity);
        fx.glow.add(px, py, pz, Math.max(5, px1 * 9), 1.0, 0.9, 0.72, 1.0);
        let en = live.get(e.id);
        if (!en) { en = { type: 'flare', emitT: 0, seen: 0, id: e.id, group: null }; live.set(e.id, en); }
        en.seen = frame;
        en.emitT += dt;
        let guard = 0;
        while (en.emitT >= 0.04 && guard++ < 3) {
          en.emitT -= 0.04;
          const vx = hasV ? e.velocity.x : 0, vy = hasV ? e.velocity.y : 0, vz = hasV ? e.velocity.z : 0;
          fx.smoke.spawn(px - vx * en.emitT, py - vy * en.emitT, pz - vz * en.emitT, 0, 0.5, 0, 1.5, 9, 0.9, 0.9, 0.95, 0.6, 2.2);
        }
        if (en.emitT > 0.04) en.emitT = 0;
      }
      // unknown types: ignored on purpose
    }
    // retire entries not seen this frame
    for (const [id, en] of live) {
      if (en.seen !== frame) {
        if (en.group) release(en);
        live.delete(id);
      }
    }
    for (const [id, bs] of beamSt) if (bs.seen !== frame) beamSt.delete(id);
    while (recentHits.length && beamT - recentHits[0].t > 1.0) recentHits.shift();
    updateDebris(dt);
    fx.glow.end();
    fx.beams.end();
    fx.update(dt);
  }

  // events -----------------------------------------------------------------------------------------
  function onEvent(e) {
    if (!e) return;
    const pl = state.player;
    switch (e.type) {
      case 'explosion':
        if (isVec(e.position)) {
          fx.explosion(e.position.x, e.position.y, e.position.z, num(e.size, 1));
          if (nearRecentBeam(e.position.x, e.position.y, e.position.z, 500)) {
            const sz = 28 + 30 * num(e.size, 1);
            fx.beamImpact(e.position.x, e.position.y, e.position.z, sz, GREEN[0], GREEN[1], GREEN[2]);
          }
        }
        break;
      case 'enemyHit': {
        const t = byId.get(e.id);
        if (t) {
          fx.spark(t.position.x, t.position.y, t.position.z, 8);
          const en = live.get(e.id);
          if (en && en.body) {
            en.flash = 1;
            if (e.part && en.parts && en.parts[e.part]) en.parts[e.part].flash = 1;
          }
          if (nearRecentBeam(t.position.x, t.position.y, t.position.z, 700)) {
            fx.beamImpact(t.position.x, t.position.y, t.position.z, Math.max(30, num(t.radius, 10) * 3), GREEN[0], GREEN[1], GREEN[2]);
          }
        }
        break;
      }
      case 'enemyPartDestroyed': {
        const en = live.get(e.id);
        const t = byId.get(e.id);
        if (en && en.parts && en.parts[e.part]) {
          const p = en.parts[e.part];
          en.group.updateMatrixWorld(true);
          _b.copy(p.center).applyMatrix4(en.group.matrixWorld);
          fx.explosion(_b.x, _b.y, _b.z, 1);                       // spark + smoke burst (size 1 small)
          spawnDebris(en, e.part, t);
          p.status = 'destroyed';
          p.mesh.visible = false; p.out.visible = false; p.stump.visible = true; p.stumpOut.visible = true;
        }
        break;
      }
      case 'remoteFire': {
        const en = live.get(e.id);
        if (!en || !en.remote) break;
        en.group.updateMatrixWorld(true);
        const t = byId.get(e.id);
        const col = t && t.faction === 'ally' ? GREEN : PINK;
        const pen = en.type !== 'gustav';
        if (en.type === 'xi' && (e.weapon === 'rifle' || e.weapon === 'vulcan')) {      // CR-006: real rifle muzzle / head vulcans
          if (e.weapon === 'rifle') { en.suit.root.localToWorld(_b.copy(en.suit.muzzle)); fx.beamMuzzle(_b.x, _b.y, _b.z, Math.max(10, num(t && t.radius, 20) * 0.5), col[0], col[1], col[2]); }
          else { en.suit.root.localToWorld(_b.set(XI_HEAD_VULCAN.x, XI_HEAD_VULCAN.y, XI_HEAD_VULCAN.z)); fx.muzzle(_b.x, _b.y, _b.z, 6); }
        } else if (e.weapon === 'rifle') {
          _b.set(4.05, pen ? -3.4 : 0, pen ? -12 : -7.3).applyMatrix4(en.group.matrixWorld);
          fx.beamMuzzle(_b.x, _b.y, _b.z, Math.max(10, num(t && t.radius, 20) * 0.5), col[0], col[1], col[2]);
        } else if (e.weapon === 'vulcan') {
          _b.set(0, pen ? 5.2 : 7.2, -1.8).applyMatrix4(en.group.matrixWorld);
          fx.muzzle(_b.x, _b.y, _b.z, 6);
        } else if (e.weapon === 'pods') {
          _b.set(-4.5, 1.5, -3).applyMatrix4(en.group.matrixWorld);
          fx.muzzle(_b.x, _b.y, _b.z, 9);
        }
        break;
      }
      case 'hitConfirm': {
        const t = byId.get(e.id);
        const en = live.get(e.id);
        if (t && en && en.remote) {
          fx.spark(t.position.x, t.position.y, t.position.z, 8);
          en.flash = 1;
          if (e.part && en.parts && en.parts[e.part]) en.parts[e.part].flash = 1;
        }
        break;
      }
      case 'enemyPartDamaged': {
        const en = live.get(e.id);
        if (en && en.parts && en.parts[e.part]) en.parts[e.part].flash = 1;
        break;
      }
      case 'missileShotDown':
        if (isVec(e.position)) {
          fx.spark(e.position.x, e.position.y, e.position.z, 14);
          fx.explosion(e.position.x, e.position.y, e.position.z, 0.6);
        }
        break;
      case 'enemyFire': {
        const t = byId.get(e.id);
        if (t && pl && isVec(pl.position)) {
          const d = Math.max(50, Math.hypot(t.position.x - pl.position.x, t.position.y - pl.position.y, t.position.z - pl.position.z));
          const pw = num(e.power, 1);
          fx.beamMuzzle(t.position.x, t.position.y, t.position.z, Math.max(8 + 10 * pw, d * pixAngNow * (6 + 8 * pw)), PINK[0], PINK[1], PINK[2]);
        }
        break;
      }
      case 'rifleFire': {
        if (!pl || !isVec(pl.position)) break;
        // muzzle: the suit's right hand (lower right of the view), green bloom + shock ring
        ownMuzzle(pl, _a).applyQuaternion(pl.quaternion).add(pl.position);
        fx.beamMuzzle(_a.x, _a.y, _a.z, pl.suit === 'gustav' || pl.suit === 'penelope' ? 2.8 : 6, GREEN[0], GREEN[1], GREEN[2]);
        break;
      }
      case 'vulcanFire': {
        if (!pl || !isVec(pl.position)) break;
        if (pl.suit === 'gustav' || pl.suit === 'penelope') _a.set(-0.6, 0.9, -7);
        else if (pl.flightMode === 'minovsky') _a.set(0, XI_HEAD_VULCAN.z - XI_COCKPIT.z, XI_COCKPIT.y - XI_HEAD_VULCAN.y).multiplyScalar(MODEL_SCALE);   // prone: head forward
        else _a.set(XI_HEAD_VULCAN.x - XI_COCKPIT.x, XI_HEAD_VULCAN.y - XI_COCKPIT.y, XI_HEAD_VULCAN.z - XI_COCKPIT.z).multiplyScalar(MODEL_SCALE);       // CR-006: the head, above the chest cockpit
        _a.applyQuaternion(pl.quaternion).add(pl.position);
        fx.muzzle(_a.x, _a.y, _a.z, 2.4);
        break;
      }
      default:
        break;
    }
  }

  return { update, renderTargetMask, onEvent, fx, flash: out, setSelf };
}
