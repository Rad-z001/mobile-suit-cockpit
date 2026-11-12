// Sensor modes, zoom, the HUD target / lead point (enemy nearest the crosshair) and the funnel auto-lock.
// CR-002: the beam rifle has no lock. player.target is information only; player.lock is funnel-only.
import * as THREE from 'three';
import { WEAPONS } from './tuning.js';
import { pushEvent } from './util.js';

const SENSOR_MODES = ['optical', 'night', 'thermal'];
const ZOOMS = [1, 3, 8];
const _f = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

export function refreshShips(S) {
  const rt = S.sim;
  // ships: AI this client simulates. targets: everything hostile the pilot can aim at (AI incl. mirrors, hostile
  // remote suits). remotes: every living remote pilot (CR-003).
  rt.ships.length = 0;
  rt.targets.length = 0;
  rt.remotes.length = 0;
  const list = S.entities;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    if (e.faction === 'neutral') continue; // CR-004: scripted carrier / Gawman: never a target, never simulated as AI
    if (e.type === 'gustav' || e.type === 'penelope') {
      if (!e.owner) rt.ships.push(e);
      rt.targets.push(e);
    } else if (e.type === 'remote' && !e.dead) {
      rt.remotes.push(e);
      if (e.faction === 'enemy') rt.targets.push(e);
    }
  }
  return rt.ships;
}

export function updateSensorInputs(S) {
  const inp = S.input;
  const sn = S.player.sensors;
  if (inp.sensorCycle) {
    sn.mode = SENSOR_MODES[(SENSOR_MODES.indexOf(sn.mode) + 1) % SENSOR_MODES.length];
    pushEvent(S, 'sensorMode', { mode: sn.mode });
    pushEvent(S, 'uiClick');
  }
  if (inp.zoomCycle) {
    sn.zoom = ZOOMS[(ZOOMS.indexOf(sn.zoom) + 1) % ZOOMS.length];
    pushEvent(S, 'zoom', { zoom: sn.zoom });
    pushEvent(S, 'uiClick');
  }
}

function resetLock(S, announce) {
  const lock = S.player.lock;
  if (announce && lock.state !== 'none') pushEvent(S, 'lockLost');
  lock.state = 'none';
  lock.progress = 0;
}

// cosine of the angle between the crosshair direction f and the direction to e
function aimCos(S, e, f) {
  _d.copy(e.position).sub(S.player.position);
  const l = _d.length();
  return l > 1e-6 ? _d.dot(f) / l : 1;
}

// the living enemy ship nearest the crosshair inside cosCone, or null
export function nearestToCrosshair(S, f, cosCone) {
  let best = null;
  let bc = cosCone;
  for (const e of S.sim.targets) {
    if (!e.alive || e.dead) continue;
    const c = aimCos(S, e, f);
    if (c > bc) { bc = c; best = e; }
  }
  return best;
}

function clearTarget(S) {
  const t = S.player.target;
  t.id = null;
  t.distance = 0;
  t.closing = 0;
  t.leadPoint = null;
}

export function clearTargeting(S) {
  const lock = S.player.lock;
  resetLock(S, true);
  lock.targetId = null;
  lock.leadPoint = null;
  lock.multiLocks.length = 0;
  lock.distance = 0;
  lock.closing = 0;
  clearTarget(S);
}

export function updateTargeting(S, dt, canAct) {
  const p = S.player;
  const lock = p.lock;
  const tg = p.target;
  _f.copy(p.aim.dir);

  // --- HUD target: the enemy nearest the crosshair, 25 deg cone ---
  const tEnemy = nearestToCrosshair(S, _f, Math.cos(WEAPONS.targetCone));
  if (!tEnemy) clearTarget(S);
  else {
    _d.copy(tEnemy.position).sub(p.position);
    const dist = _d.length();
    const dirX = dist > 1e-6 ? 1 / dist : 0;
    tg.id = tEnemy.id;
    tg.distance = dist;
    tg.closing = -(_p.copy(tEnemy.velocity).sub(p.velocity).dot(_d) * dirX);
    if (!p.mods.targetReadable) tg.leadPoint = null;
    else {
      // lead point (doc 03 section 3.2: P_lead = P_t + V_t * t_flight), refined so it converges.
      // Information only: nothing is pulled toward it.
      if (!tg.leadPoint) tg.leadPoint = new THREE.Vector3();
      const lp = tg.leadPoint;
      let tf = dist / WEAPONS.beamSpeed;
      for (let i = 0; i < 3; i++) {
        lp.copy(tEnemy.position).addScaledVector(tEnemy.velocity, tf);
        tf = lp.distanceTo(p.position) / WEAPONS.beamSpeed;
      }
    }
  }

  // --- funnel auto-lock (item 6) ---
  lock.leadPoint = null;
  lock.multiLocks.length = 0;
  let cur = lock.targetId !== null ? S.sim.byId.get(lock.targetId) : null;
  if (cur && (!cur.alive || cur.dead)) cur = null;
  if (cur) {
    const keep = aimCos(S, cur, _f) > Math.cos(WEAPONS.lockKeepCone) && cur.position.distanceTo(p.position) < WEAPONS.lockRange;
    if (!keep || !canAct) cur = null;
  }
  if (!cur) {
    if (lock.targetId !== null || lock.state !== 'none') resetLock(S, true);
    lock.targetId = null;
    lock.distance = 0;
    lock.closing = 0;
    if (canAct) {
      const cand = nearestToCrosshair(S, _f, Math.cos(WEAPONS.lockCone));
      if (cand && cand.position.distanceTo(p.position) < WEAPONS.lockRange) {
        cur = cand;
        lock.targetId = cand.id;
        lock.state = 'acquiring';
        lock.progress = 0;
        pushEvent(S, 'lockAcquiring');
      }
    }
  }
  if (!cur) return;
  if (lock.state === 'acquiring') {
    const time = WEAPONS.lockTime * (0.7 + S.world.minovskyDensity) * p.mods.lockTime;
    lock.progress = Math.min(1, lock.progress + dt / time);
    if (lock.progress >= 1) {
      lock.state = 'locked';
      pushEvent(S, 'lockConfirmed');
    }
  }
  _d.copy(cur.position).sub(p.position);
  const dist = _d.length();
  lock.distance = dist;
  lock.closing = -(_p.copy(cur.velocity).sub(p.velocity).dot(_d) * (dist > 1e-6 ? 1 / dist : 0));
}
