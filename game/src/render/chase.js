// CR-005: third-person chase view (toggle with V = state.input.viewToggle edge; render-only state, never written to `state`).
//   - the camera sits behind and above your own suit, springed, following the suit's quaternion with lag; 0.4 s ease in/out
//   - your own suit is drawn through the entity renderer as a synthetic remote-style entity (Xi model, Gustav or Penelope incl.
//     Penelope's flight form); parts are mapped from player.parts exactly like the net snapshot does
//   - cockpit interior, sub-monitors, sphere HUD and the 360 wrap are skipped (index.js asks chase.hidden); the monitor pass
//     goes "clean" (no scanlines / noise); a flat 2D overlay replaces the HUD: crosshair at the aim direction, speed / altitude /
//     hull, weapon + ammo, alerts + missile warning, target + Gawman markers, rescue readout, radio line
//   - phase 'startup' forces the cockpit
import * as THREE from 'three';
import { MODEL_SCALE, XI_MODEL_HEIGHT, XI_COCKPIT } from '../state.js';
import { clamp, num, isVec, damp, saturate } from './util.js';

const W = 1280, H = 720;
const SUIT_H = { xi: XI_MODEL_HEIGHT * MODEL_SCALE, gustav: 19 * 1.6 * MODEL_SCALE, penelope: 18 * (22 / 18) * MODEL_SCALE };
const FONT = '"Roboto Mono", Consolas, "Courier New", monospace';
const ease = (t) => { t = saturate(t); return t * t * (3 - 2 * t); };

export function createChase({ state, world, entities, monitor, rig }) {
  const self = {
    id: -99, type: 'remote', faction: 'player', name: 'YOU', suit: 'xi', form: 'ms', team: 0, shield: false, weapon: 'rifle', spawnShield: false, dead: false,
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(), aimLocal: new THREE.Vector3(0, 0, -1), radius: 20, hp: 1, maxHp: 1, heat: 0.8, ttl: Infinity, alive: true, state: '', parts: null,
  };
  const api = { k: 0, on: false, hidden: false };
  let want = false, kRaw = 0, overridden = false;
  const lagQ = new THREE.Quaternion(), look = new THREE.Quaternion(), tmpQ = new THREE.Quaternion(), baseQ = new THREE.Quaternion();
  const desired = new THREE.Vector3(), posSm = new THREE.Vector3(), vel = new THREE.Vector3(), target = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), basePos = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), off = new THREE.Vector3(), ctr = new THREE.Vector3();
  let first = true;

  // ---- flat overlay (own canvas + ortho quad, drawn after the overlay pass) ------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  quad.frustumCulled = false;
  const oScene = new THREE.Scene(); oScene.add(quad);
  const oCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let drawAcc = 1, tNow = 0;

  const col = (c, a) => `rgba(${c},${a})`;
  const WHITE = '236,242,250', AMB = '255,196,40', RED = '255,70,70', GRN = '140,255,190', ORG = '255,128,44';
  function T(s, x, y, c, a, size = 20, align = 'left', weight = 400) { g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = col(c, a); g.textAlign = align; g.fillText(s, x, y); }
  function proj(p, wc, out) { out.copy(p).project(wc); return out.z < 1 && out.z > -1 && Math.abs(out.x) < 1.2 && Math.abs(out.y) < 1.2; }
  const px = (v) => [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H];

  function drawOverlay(wc, a) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    if (a < 0.02) return;
    const p = state.player || {};
    g.globalAlpha = a; g.lineWidth = 2; g.lineCap = 'butt';
    // crosshair at the aim direction
    const aim = p.aim && isVec(p.aim.dir) ? p.aim.dir : null;
    if (aim && isVec(p.position)) {
      v3.copy(p.position).addScaledVector(aim, 3000);
      if (proj(v3, wc, off)) {
        const [x, y] = px(off);
        g.strokeStyle = col(WHITE, 0.95); g.beginPath();
        g.moveTo(x - 26, y); g.lineTo(x - 7, y); g.moveTo(x + 7, y); g.lineTo(x + 26, y); g.moveTo(x, y - 26); g.lineTo(x, y - 7); g.moveTo(x, y + 7); g.lineTo(x, y + 26); g.stroke();
        g.beginPath(); g.arc(x, y, 2, 0, 6.2832); g.fillStyle = col(WHITE, 0.95); g.fill();
      }
    }
    // flight data, lower left
    const spd = num(p.speed, 0), alt = num(p.altitude, 0), hull = saturate(num(p.hull, 1));
    T(`SPD ${Math.round(spd)} M/S`, 36, H - 86, WHITE, 0.95, 22);
    T(`ALT ${Math.round(alt)} M`, 36, H - 58, WHITE, 0.95, 22);
    g.fillStyle = col(WHITE, 0.2); g.fillRect(36, H - 44, 200, 8);
    g.fillStyle = col(hull < 0.3 ? RED : WHITE, 0.95); g.fillRect(36, H - 44, 200 * hull, 8);
    T(`HULL ${Math.round(hull * 100)}%`, 246, H - 36, hull < 0.3 ? RED : WHITE, 0.9, 18);
    // weapons, lower right
    const w = p.weapons || {}, rf = w.rifle || {};
    const saber = w.active === 'saber';
    T(saber ? 'SABER' : `RIFLE ${num(rf.shots, 0)}/${num(rf.perPack, 15)}${rf.reloading ? '  RELOAD' : ''}`, W - 36, H - 86, saber ? '140,230,255' : WHITE, 0.95, 22, 'right');
    T(`MSL ${num(w.funnel && w.funnel.count, 0)}   VULCAN ${num(w.vulcan && w.vulcan.ammo, 0)}   FLARE ${num(w.flares && w.flares.count, 0)}`, W - 36, H - 58, WHITE, 0.85, 18, 'right');
    // alerts + missile warning, top centre
    let y = 54;
    const thr = p.threat || {};
    if (thr.missileInbound || (Array.isArray(thr.incoming) && thr.incoming.length)) {
      const on = Math.sin(tNow * 12) > 0;
      T('MISSILE', W / 2, y, RED, on ? 1 : 0.5, 30, 'center', 500); y += 34;
    }
    if (p.pullUp && p.pullUp.active) { T('PULL UP', W / 2, y, RED, 0.5 + 0.5 * Math.sin(tNow * 12) ** 2, 28, 'center', 500); y += 32; }
    const al = Array.isArray(state.alerts) ? state.alerts : [];
    for (let i = 0; i < al.length && i < 4; i++) { const A = al[i]; if (!A) continue; T(String(A.text || '').toUpperCase(), W / 2, y, A.level === 'warning' ? RED : AMB, 0.95, 20, 'center'); y += 24; }
    const msg = state.mission && state.mission.message;
    if (msg && msg.ttl > 0 && msg.text) T(String(msg.text), W / 2, H - 126, WHITE, saturate(msg.ttl / 0.6) * 0.9, 20, 'center');
    // target marker (enemy nearest the crosshair) + Gawman marker
    const ents = Array.isArray(state.entities) ? state.entities : [];
    const marker = (pos, label, c) => {
      if (!proj(pos, wc, off)) return;
      const [x, y2] = px(off);
      g.strokeStyle = col(c, 0.95); g.lineWidth = 2.4; g.beginPath(); g.moveTo(x - 12, y2 - 20); g.lineTo(x + 12, y2 - 20); g.lineTo(x, y2 - 4); g.closePath(); g.stroke();
      T(label, x, y2 + 22, c, 0.95, 18, 'center');
    };
    const tg = p.target && p.target.id != null ? ents.find((e) => e.id === p.target.id) : null;
    if (tg && isVec(tg.position)) marker(tg.position, `${String(tg.name || tg.type).toUpperCase()}  ${Math.round(num(p.target.distance, 0))} M`, ORG);
    const rs = state.mission && state.mission.rescue;
    if (rs) {
      const gw = ents.find((e) => e.id === rs.gawmanId);
      if (gw && isVec(gw.position) && rs.phase !== 'aboard') marker(gw.position, `GAWMAN  ${Math.round(num(rs.distance, 0))} M`, ORG);
      const inE = !!rs.inEnvelope, c = inE ? GRN : WHITE;
      T('RESCUE', 36, 56, c, 0.95, 22, 'left', 500);
      T(`DIST ${Math.round(num(rs.distance, 0))} M   CLOSING ${Math.round(num(rs.closing, 0))}`, 36, 82, c, 0.9, 18);
      if (rs.relVel) T(`REL  F ${(-rs.relVel.z).toFixed(1)}  U ${rs.relVel.y.toFixed(1)}  R ${rs.relVel.x.toFixed(1)}`, 36, 106, inE ? GRN : AMB, 0.95, 18);
      if (isFinite(num(rs.timeToSea, Infinity))) T(`SEA ${rs.timeToSea.toFixed(1)} S`, 36, 130, rs.timeToSea < 6 ? RED : AMB, 0.95, 18);
    }
    T('CHASE VIEW  [V] COCKPIT', W - 36, 44, WHITE, 0.55, 16, 'right');
    g.globalAlpha = 1;
  }

  // ---- per-frame camera + self entity -------------------------------------------------------------------------------------------------
  function mapParts(p) {
    const P = p.parts || {};
    const mk = (s) => ({ hp: num(s && s.hp, 1), maxHp: 1, status: (s && s.status) || 'ok' });
    const worst = (a, b) => (num(a && a.hp, 1) <= num(b && b.hp, 1) ? mk(a) : mk(b));
    if (p.suit === 'gustav') return { head: mk(P.head), gunArm: mk(P.rArm), pod: mk(P.pods), thrusters: worst(P.legs, P.pack) };
    if (p.suit === 'penelope') return { head: mk(P.head), rifleArm: mk(P.rArm), salvoArm: worst(P.lArm, P.pods), wingPack: worst(P.legs, P.pack) };
    return { head: mk(P.head), rArm: mk(P.rArm), lArm: mk(P.lArm), legs: mk(P.legs), pack: mk(P.pack), pods: mk(P.pods) };
  }

  // wc = world camera already placed at the cockpit eye for this frame; returns after possibly overriding it
  function update(dt, wc, aspect) {
    const p = state.player || {};
    const inp = state.input || {};
    tNow += dt;
    if (inp.viewToggle && state.phase !== 'startup' && state.phase !== 'boarding') want = !want;
    if (state.phase === 'startup' || state.phase === 'ejected' || state.phase === 'boarding') want = false;
    kRaw = clamp(kRaw + (want ? dt : -dt) / 0.4, 0, 1);
    const k = ease(kRaw);
    api.k = k; api.on = kRaw > 0; api.hidden = k > 0.5;
    const suit = p.suit === 'gustav' || p.suit === 'penelope' ? p.suit : 'xi';
    const Hs = SUIT_H[suit];

    if (!isVec(p.position) || !p.quaternion || typeof p.quaternion.w !== 'number') { entities.setSelf(null); return; }
    basePos.copy(wc.position); baseQ.copy(wc.quaternion);
    // lagged follow frame + sprung camera position
    if (first || !(dt > 0)) { lagQ.copy(p.quaternion); first = false; }
    else lagQ.slerp(p.quaternion, 1 - Math.exp(-3.2 * dt));
    // CR-006: the Xi pilot sits in the chest; frame the whole suit (its middle), not the cockpit
    if (suit === 'xi') ctr.set(-XI_COCKPIT.x, -XI_COCKPIT.y, -XI_COCKPIT.z).multiplyScalar(MODEL_SCALE).applyQuaternion(p.quaternion).add(p.position);
    else ctr.copy(p.position);
    off.set(0, 0.42 * Hs, 1.75 * Hs).applyQuaternion(lagQ);
    desired.copy(ctr).add(off);
    if (kRaw <= 0) { posSm.copy(desired); vel.set(0, 0, 0); }
    else {
      const w = 6.5, h = Math.min(dt, 0.05), n = Math.max(1, Math.ceil(h / 0.008)), s = h / n;
      for (let i = 0; i < n; i++) { v3.subVectors(posSm, desired); vel.addScaledVector(v3, -w * w * s).addScaledVector(vel, -2 * w * s); posSm.addScaledVector(vel, s); }
    }
    // own suit entity (only once the camera has left the cockpit)
    if (k > 0.2) {
      self.suit = suit; self.name = 'YOU';
      self.position.copy(p.position); self.quaternion.copy(p.quaternion);
      if (isVec(p.velocity)) self.velocity.set(p.velocity.x, p.velocity.y, p.velocity.z);
      const ft = p.flightTransition || {};
      const fl = p.flightMode === 'minovsky' || (ft.state === 'toFlight' && num(ft.t, 0) > 0.5) || (ft.state === 'toHover' && num(ft.t, 0) < 0.5);
      self.form = fl && suit !== 'gustav' ? 'flight' : 'ms';
      self.shield = !!(p.shield && p.shield.up);
      self.weapon = p.weapons && p.weapons.active === 'saber' ? 'saber' : 'rifle';
      // CR-006: the rifle arm follows the crosshair (aim direction in the suit's own frame)
      if (p.aim && isVec(p.aim.dir)) self.aimLocal.copy(p.aim.dir).applyQuaternion(tmpQ.copy(p.quaternion).invert());
      else self.aimLocal.set(0, 0, -1);
      self.parts = mapParts({ suit, parts: p.parts });
      self.radius = 20;
      entities.setSelf(self);
    } else entities.setSelf(null);

    if (kRaw > 0) {
      target.copy(ctr).addScaledVector(off.set(0, 0.05, -1).applyQuaternion(lagQ), Hs * 3);
      m4.lookAt(posSm, target, up);
      look.setFromRotationMatrix(m4);
      wc.position.lerpVectors(basePos, posSm, k);
      wc.quaternion.slerpQuaternions(baseQ, look, k);
      const fov = 90 + (62 - 90) * k;                     // pulls in from the 90 deg cockpit field to a normal chase FOV
      if (Math.abs(wc.fov - fov) > 1e-3 || wc.aspect !== aspect) { wc.fov = fov; wc.aspect = aspect; wc.updateProjectionMatrix(); }
      overridden = true;
    } else if (overridden) { overridden = false; wc.fov = rig.worldFov; wc.updateProjectionMatrix(); }
    monitor.setClean(k > 0.5 ? 1 : 0);
  }
  // after the camera is final
  function render(renderer, dt, wc) {
    if (api.k < 0.02) return;
    drawAcc += dt;
    if (drawAcc >= 1 / 20) { drawAcc = 0; wc.updateMatrixWorld(true); drawOverlay(wc, saturate((api.k - 0.4) / 0.6)); tex.needsUpdate = true; }
    renderer.clearDepth();
    renderer.render(oScene, oCam);
  }
  return Object.assign(api, { update, render });
}
