// Shared helpers for the sim. No DOM access anywhere in src/sim.
import * as THREE from 'three';

export const G = 9.81;
export const R2D = 180 / Math.PI;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (cur, target, tau, dt) => cur + (target - cur) * (1 - Math.exp(-dt / tau));
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function pushEvent(S, type, extra) {
  const e = extra ? Object.assign({ type }, extra) : { type };
  S.events.push(e);
  return e;
}

// CR-003: weapons tell the net layer about a shot (no-op offline). kind: 'r' rifle, 'v' vulcan round, 's' saber, 'p' pods
export function netFire(S, kind, o, d, n) {
  const f = S.sim.onFire;
  if (f) f(kind, o, d, n);
}

// ---- alerts ----------------------------------------------------------------
export function raiseAlert(S, id, text, level = 'caution', ttl = 1) {
  const list = S.alerts;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.id === id) {
      a.text = text;
      a.level = level;
      if (ttl > a.ttl) a.ttl = ttl;
      return a;
    }
  }
  const a = { id, text, level, ttl };
  list.push(a);
  pushEvent(S, 'alert', { level, id });
  return a;
}
export function clearAlert(S, id) {
  const list = S.alerts;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].id === id) list.splice(i, 1);
}
export function tickAlerts(S, dt) {
  const list = S.alerts;
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].ttl -= dt;
    if (list[i].ttl <= 0) list.splice(i, 1);
  }
}
export function setMessage(S, text, ttl = 6) {
  S.mission.message = { text, ttl };
}
export function tickMessage(S, dt) {
  const m = S.mission.message;
  if (m.ttl > 0) {
    m.ttl -= dt;
    if (m.ttl <= 0) { m.ttl = 0; m.text = ''; }
  }
}

// ---- vectors / quaternions ---------------------------------------------------
const _m = new THREE.Matrix4();
const _o = new THREE.Vector3();
const _upY = new THREE.Vector3(0, 1, 0);
const _upZ = new THREE.Vector3(0, 0, 1);
const _qT = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _ax = new THREE.Vector3();

// Quaternion whose local -Z points along dir (unit).
export function lookQuat(out, dir) {
  _m.lookAt(_o.set(0, 0, 0), dir, Math.abs(dir.y) > 0.98 ? _upZ : _upY);
  return out.setFromRotationMatrix(_m);
}
export function orientAlong(q, dir, t) {
  lookQuat(_qT, dir);
  q.slerp(_qT, clamp(t, 0, 1));
}
// Upright orientation for humanoid ships (Gustav): -Z faces `dir` in yaw only, pitch is a small lean (slight forward lean
// with speed, a little toward a target far above/below) clamped to +-15 deg, bank is at most +-12 deg into turns (from the
// yaw rate). Smoothed per axis with rate `rate` (1/s). The state is read back from e.quaternion every call, so a quaternion
// set from outside (tests, tumble) is respected. When dir is nearly vertical the current yaw is kept.
export const UPRIGHT_MAX_PITCH = 15 * Math.PI / 180;
export const UPRIGHT_MAX_BANK = 12 * Math.PI / 180;
const _eu = new THREE.Euler(0, 0, 0, 'YXZ');
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export function orientUpright(e, dir, dt, rate, speed = 0) {
  _eu.setFromQuaternion(e.quaternion, 'YXZ');
  let yaw = _eu.y, pitch = _eu.x, roll = _eu.z;
  const k = clamp(rate * dt, 0, 1);
  let yawStep = 0;
  if (Math.hypot(dir.x, dir.z) > 0.2) {
    yawStep = wrapPi(Math.atan2(-dir.x, -dir.z) - yaw) * k;
    yaw += yawStep;
  }
  const yawRate = dt > 0 ? yawStep / dt : 0;
  const pitchT = clamp(0.3 * dir.y - 0.1 * Math.min(1, speed / 150), -UPRIGHT_MAX_PITCH, UPRIGHT_MAX_PITCH);
  pitch += (pitchT - pitch) * k;
  const rollT = clamp(yawRate * 0.25, -UPRIGHT_MAX_BANK, UPRIGHT_MAX_BANK);
  roll += (rollT - roll) * k;
  pitch = clamp(pitch, -UPRIGHT_MAX_PITCH, UPRIGHT_MAX_PITCH);
  roll = clamp(roll, -UPRIGHT_MAX_BANK, UPRIGHT_MAX_BANK);
  _eu.set(pitch, yaw, roll, 'YXZ');
  e.quaternion.setFromEuler(_eu);
}
// Humanoid ships stay upright; everything else points its whole body along dir.
export function orientShip(e, dir, rate, dt) {
  if (e.type === 'gustav' || e.type === 'penelope') orientUpright(e, dir, dt, dt > 0 ? rate / dt : 0, e.velocity ? e.velocity.length() : 0);
  else orientAlong(e.quaternion, dir, rate);
}
// Rotate v (preserving length) toward unit vector `target` by at most maxAngle.
export function rotateToward(v, target, maxAngle) {
  const len = v.length();
  if (len < 1e-6 || maxAngle <= 0) return;
  _a.copy(v).divideScalar(len);
  const ang = Math.acos(clamp(_a.dot(target), -1, 1));
  if (ang < 1e-6) return;
  const step = Math.min(ang, maxAngle);
  _ax.crossVectors(_a, target);
  if (_ax.lengthSq() < 1e-12) {
    // anti-parallel: pick any perpendicular axis
    _ax.set(1, 0, 0);
    if (Math.abs(_a.x) > 0.9) _ax.set(0, 1, 0);
    _ax.cross(_a);
  }
  _ax.normalize();
  v.applyAxisAngle(_ax, step);
}
export function randomUnit(rng, out) {
  const z = rng.range(-1, 1);
  const a = rng.range(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _cp = new THREE.Vector3();
// squared distance from point c to segment a-b
export function segDist2(a, b, c) {
  _ab.subVectors(b, a);
  const l2 = _ab.lengthSq();
  let t = 0;
  if (l2 > 1e-9) t = clamp(_ac.subVectors(c, a).dot(_ab) / l2, 0, 1);
  _cp.copy(a).addScaledVector(_ab, t);
  return _cp.distanceToSquared(c);
}

// ---- entities ----------------------------------------------------------------
export function makeEntity(S, props) {
  const rt = S.sim;
  const e = {
    id: rt.nextId++,
    type: props.type,
    faction: props.faction,
    name: props.name || props.type,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    radius: props.radius ?? 1,
    hp: props.hp ?? 1,
    maxHp: props.maxHp ?? props.hp ?? 1,
    heat: props.heat ?? 0.5,
    ttl: props.ttl ?? Infinity,
    targetId: props.targetId ?? null,
    alive: true,
    parts: null, // gustav / penelope get { [name]: { hp, maxHp, status } } at spawn
    state: '',   // enemy ships mirror their AI state here ('approach', 'ram', 'flee', ...)
    sim: {}, // private AI / projectile data (renderer and audio ignore it)
  };
  if (props.power !== undefined) e.power = props.power; // beams only (v2)
  S.entities.push(e);
  rt.byId.set(e.id, e);
  return e;
}
export function getEntity(S, id) {
  if (id === null || id === undefined || id === 'player') return null;
  const e = S.sim.byId.get(id);
  return e && e.alive ? e : null;
}
export function forwardOf(q, out) {
  return out.set(0, 0, -1).applyQuaternion(q);
}
