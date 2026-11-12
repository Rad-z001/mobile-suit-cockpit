// Enemy ships: spawn, steering AI, firing, taking damage, dying.
import * as THREE from 'three';
import { MODEL_SCALE } from '../state.js';
import { ENEMY, ENEMY_PARTS, MODEL_BASE_SCALE } from './tuning.js';
import { makeEntity, pushEvent, orientAlong, orientShip, orientUpright, lookQuat, randomUnit, setMessage, clamp } from './util.js';
import { strikeTarget } from './missions/seawrack.js';

const _toP = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _des = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _o = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _rv = new THREE.Vector3();

const KILL_LINES = [
  'Splash one.', 'Target destroyed.', 'He is gone. Next.', 'Good kill. Do not get comfortable.',
];

function defaultMods() {
  return {
    speed: 1, accel: 1, dodge: 1, spread: 1, leadOk: true, beamOk: true, missileOk: true, decoyOk: true,
    fireRate: 1, missileRate: 1, passOk: true, passTime: 1, salvo: Infinity, breakOk: true, decoyCd: 1, circle: 1,
  };
}

// rebuild e.sim.mods from the part statuses (parts never recover, so this only ever gets worse)
export function defaultEnemyMods() { return defaultMods(); }

export function applyEnemyMods(e) {
  const mods = defaultMods();
  const fx = ENEMY_PARTS.effects[e.type];
  for (const [name, part] of Object.entries(e.parts)) {
    const eff = fx[name] && fx[name][part.status];
    if (!eff) continue;
    for (const [k, v] of Object.entries(eff)) {
      if (typeof v === 'boolean') mods[k] = mods[k] && v;
      else if (k === 'salvo') mods[k] = Math.min(mods[k], v);
      else mods[k] *= v;
    }
  }
  e.sim.mods = mods;
  return mods;
}

export function spawnEnemy(S, type, position, opts = {}) {
  const rt = S.sim;
  const rng = rt.rng;
  const c = ENEMY[type];
  const e = makeEntity(S, {
    type, faction: 'enemy', name: c.name, radius: c.radius * MODEL_SCALE, hp: c.hp, maxHp: c.hp,
    heat: c.heat, ttl: Infinity, targetId: 'player',
  });
  e.parts = {};
  for (const [name, hp] of Object.entries(ENEMY_PARTS.hp[type])) e.parts[name] = { hp, maxHp: hp, status: 'ok' };
  e.position.copy(position);
  _dir.copy(S.player.position).sub(position).normalize();
  if (!opts.stationary) e.velocity.copy(_dir).multiplyScalar(c.cruise);
  if (type === 'gustav' || type === 'penelope') { e.quaternion.identity(); orientUpright(e, _dir, 1, 1, 0); } else lookQuat(e.quaternion, _dir);
  e.sim = {
    state: 'approach', t: 0, side: rng.sign(), vert: 0,
    fireT: rng.range(2, 5), burst: 0, burstT: 0,
    missileT: rng.range(6, 12), canMissile: !!opts.missiles,
    salvo: 0, salvoT: 0, salvoCd: rng.range(4, 8),
    decoyT: 0, extendT: 0, passFired: false,
    dodgeDelay: 0, dodgeT: 0, dodgeDir: new THREE.Vector3(), ramCd: 0,
    stationary: !!opts.stationary,
    mods: defaultMods(), fled: false, fleePhase: null,
    tgt: null,
  };
  e.nid = rt.nt ? rt.nt.nextNid++ : e.id; // CR-003: network id (stable across host migration)
  e.state = 'approach';
  return e;
}

// Heavy (power 1) or light (power < 1) enemy beam. Lead is a fraction of the player's current velocity
// (imperfect on purpose): a suit that holds still is hit often, one that keeps changing velocity rarely.
export function fireEnemyBeam(S, e, damage, lead, spread, power = 1, radius = 2) {
  const rt = S.sim;
  const rng = rt.rng;
  const tg = e.sim.tgt || S.player;
  const p = tg;
  const speed = power >= 0.7 ? ENEMY.beamSpeedHeavy : ENEMY.beamSpeedLight;
  _dir.copy(p.position).sub(e.position);
  const dist0 = _dir.length() || 1;
  _dir.divideScalar(dist0);
  _o.copy(e.position).addScaledVector(_dir, e.radius * 1.2);
  const dist = _o.distanceTo(p.position);
  const t = dist / speed;
  _aim.copy(p.position).addScaledVector(p.velocity, t * lead);
  randomUnit(rng, _rv).multiplyScalar(dist * spread * rng.next());
  _aim.add(_rv);
  _dir.copy(_aim).sub(_o).normalize();
  const b = makeEntity(S, {
    type: 'beam', faction: 'enemy', name: power >= 0.7 ? 'ENEMY HEAVY BEAM' : 'ENEMY BEAM', radius, hp: 1, heat: 1,
    ttl: 9, targetId: 'player', power,
  });
  if (S.story && tg === S.story.seawrack) b.targetId = 'seawrack';   // CR-013: a shot at the ship can only hit the ship
  b.position.copy(_o);
  b.velocity.copy(_dir).multiplyScalar(speed);
  lookQuat(b.quaternion, _dir);
  b.sim = { dmg: damage };
  if (rt.netOn) { b.sim.victim = rt.nt.victimOf(tg); rt.netAiFire(b, e, speed, damage, power, radius); }
  pushEvent(S, 'enemyFire', { id: e.id, power });
  return b;
}

export function spawnMissile(S, from, damage) {
  const rt = S.sim;
  const rng = rt.rng;
  const c = ENEMY.missile;
  const m = makeEntity(S, {
    type: 'missile', faction: 'enemy', name: c.name, radius: 3 * MODEL_SCALE, hp: c.hp, maxHp: c.hp, heat: 0.9,
    ttl: c.ttl, targetId: 'player',
  });
  m.position.copy(from.position);
  const tg = from.sim.tgt || S.player;
  _dir.copy(tg.position).sub(from.position).normalize();
  // launched somewhat sideways so it has to curve in
  randomUnit(rng, _rv).multiplyScalar(0.5);
  _dir.add(_rv).normalize();
  m.velocity.copy(from.velocity).addScaledVector(_dir, c.speedStart);
  lookQuat(m.quaternion, _dir);
  m.sim = { dmg: damage ?? c.damage, speedMax: c.speedMax, accel: c.accel, turn: c.turn, lost: false };
  m.nid = rt.nt ? rt.nt.nextNid++ : m.id;
  if (rt.netOn) { m.sim.victim = rt.nt.victimOf(tg); if (tg !== S.player) m.targetId = tg.id; }
  return m;
}

function countEnemyMissiles(S) {
  let n = 0;
  for (const e of S.entities) if (e.alive && e.type === 'missile') n++;
  return n;
}

// the pilot's beam is in flight: enemies that see it coming may jink out of the way
export function alertEnemiesOfShot(S, origin, dir) {
  const rt = S.sim;
  for (const e of rt.ships) {
    if (!e.alive || e.sim.stationary || e.sim.dodgeT > 0 || e.sim.dodgeDelay > 0) continue;
    _toP.copy(e.position).sub(origin);
    const along = _toP.dot(dir);
    if (along < 500) continue;
    _toP.addScaledVector(dir, -along);
    if (_toP.length() > 90) continue;
    const chance = (e.type === 'penelope' ? ENEMY.penelope.dodgeChance : ENEMY.gustav.dodgeChance) * e.sim.mods.dodge;
    if (!rt.rng.chance(chance)) continue;
    randomUnit(rt.rng, _rv);
    _rv.addScaledVector(dir, -_rv.dot(dir)).normalize();
    e.sim.dodgeDir.copy(_rv);
    e.sim.dodgeDelay = rt.rng.range(0.2, 0.45);
    e.sim.dodgeT = rt.rng.range(1.0, 1.6);
  }
}

function dodging(ai, dt) {
  if (ai.dodgeDelay > 0) { ai.dodgeDelay -= dt; return false; }
  if (ai.dodgeT > 0) { ai.dodgeT -= dt; return true; }
  return false;
}

function accelerate(e, des, maxAccel, dt) {
  _acc.copy(des).sub(e.velocity);
  const l = _acc.length();
  const m = maxAccel * dt;
  if (l > m) _acc.multiplyScalar(m / l);
  e.velocity.add(_acc);
}

function altitudeGuard(e, des) {
  const y = e.position.y;
  if (y < ENEMY.minAlt) des.y += (ENEMY.minAlt - y) / 150 + 0.3;
  else if (y > ENEMY.maxAlt) des.y -= 0.5;
  if (y < 200 && e.velocity.y < 0) e.velocity.y = Math.abs(e.velocity.y) * 0.5 + 20;
}

function stepGustav(S, e, dt, hostile) {
  const rt = S.sim;
  const rng = rt.rng;
  const p = e.sim.tgt || S.player;
  const c = ENEMY.gustav;
  const ai = e.sim;
  _toP.copy(p.position).sub(e.position);
  const dist = _toP.length() || 1;
  _dir.copy(_toP).divideScalar(dist);
  _tan.set(_dir.z, 0, -_dir.x);
  if (_tan.lengthSq() < 1e-4) _tan.set(1, 0, 0);
  _tan.normalize();
  ai.t -= dt;
  const mods = ai.mods;
  const cMax = c.max * mods.speed;
  let speed = c.cruise * mods.speed;
  _des.set(0, 0, 0);

  if (ai.state === 'approach') {
    _des.copy(_dir);
    if (dist < c.engageRange) { ai.state = 'strafe'; ai.t = rng.range(3, 6); }
  } else if (ai.state === 'strafe') {
    const radial = dist > c.holdMax ? 0.6 : dist < c.holdMin ? -0.8 : 0;
    _des.copy(_tan).multiplyScalar(ai.side * 0.9).addScaledVector(_dir, radial);
    _des.y += ai.vert + clamp((p.position.y - e.position.y) / 2500, -0.3, 0.3);
    if (ai.t <= 0) {
      ai.side = -ai.side;
      ai.vert = rng.range(-0.25, 0.35);
      ai.t = rng.range(3, 6);
    }
    if (dist < c.breakRange && mods.breakOk) { ai.state = 'break'; ai.t = 2.5; }
  } else { // break off
    _des.copy(_dir).multiplyScalar(-0.7).addScaledVector(_tan, ai.side);
    _des.y += 0.3;
    speed = cMax;
    if (ai.t <= 0) { ai.state = dist > c.engageRange ? 'approach' : 'strafe'; ai.t = rng.range(3, 5); }
  }
  const jink = dodging(ai, dt);
  if (jink) { _des.copy(ai.dodgeDir); speed = cMax; }
  altitudeGuard(e, _des);
  if (_des.lengthSq() < 1e-6) _des.copy(_dir);
  _des.normalize().multiplyScalar(speed);
  accelerate(e, _des, c.accel * mods.accel * (jink ? 1.7 : 1), dt);
  const sp = e.velocity.length();
  if (sp > cMax * (jink ? 1.3 : 1)) e.velocity.multiplyScalar(cMax * (jink ? 1.3 : 1) / sp);
  e.heat = clamp(0.42 + 0.3 * (sp / c.max) + 0.2 * (1 - e.hp / e.maxHp), 0, 1);
  orientShip(e, _dir, 3 * dt, dt);

  if (!hostile) return;
  // --- beam bursts with imperfect lead ---
  ai.fireT -= dt;
  if (ai.burst > 0) {
    ai.burstT -= dt;
    if (ai.burstT <= 0) {
      fireEnemyBeam(S, e, c.beamDamage, mods.leadOk ? rng.range(c.leadMin, c.leadMax) : 0, c.spread * mods.spread, c.beamPower, c.beamRadius);
      ai.burst--;
      ai.burstT = 0.35;
    }
  } else if (ai.fireT <= 0 && mods.beamOk && dist < c.fireRange && dist > c.fireMin && ai.state !== 'break') {
    ai.burst = c.burst[Math.min(1, Math.max(0, S.mission.wave - 1))];
    ai.burstT = 0;
    ai.fireT = c.fireInterval[Math.min(1, Math.max(0, S.mission.wave - 1))] * rng.range(0.8, 1.25) * mods.fireRate;
  }
  // --- missiles (waves 2+) ---
  if (ai.canMissile && mods.missileOk) {
    ai.missileT -= dt;
    if (ai.missileT <= 0 && dist > c.missileMin && dist < c.missileMax && countEnemyMissiles(S) < c.missileCap) {
      spawnMissile(S, e);
      ai.missileT = rng.range(c.missileInterval[0], c.missileInterval[1]) * mods.missileRate;
    }
  }
}

function stepPenelope(S, e, dt, hostile) {
  const rt = S.sim;
  const rng = rt.rng;
  const p = e.sim.tgt || S.player;
  const c = ENEMY.penelope;
  const ai = e.sim;
  _toP.copy(p.position).sub(e.position);
  const dist = _toP.length() || 1;
  _dir.copy(_toP).divideScalar(dist);
  _tan.set(_dir.z, 0, -_dir.x);
  if (_tan.lengthSq() < 1e-4) _tan.set(1, 0, 0);
  _tan.normalize();
  ai.t -= dt;
  ai.decoyT -= dt;
  const mods = ai.mods;
  const cMax = c.max * mods.speed;
  const circleIn = c.circleIn * mods.circle;
  const circleOut = c.circleOut * mods.circle;
  let speed = c.cruise * mods.speed;
  let facePlayer = false;
  _des.set(0, 0, 0);
  const closing = -_rv.copy(e.velocity).sub(p.velocity).dot(_dir);
  const yMatch = clamp((p.position.y - e.position.y) / 1800, -0.4, 0.4);

  switch (ai.state) {
    case 'approach':
      // fast run-in, aimed slightly off the player so it does not become a collision
      _des.copy(_dir).addScaledVector(_tan, 0.07 * ai.side);
      speed = cMax;
      if (dist < circleOut) { ai.state = 'circle'; ai.t = rng.range(c.circleTime[0], c.circleTime[1]); }
      break;
    case 'circle': {
      // mobile-suit style: orbit the player, nose on him, firing heavy shots
      const radial = dist > circleOut ? 0.7 : dist < circleIn ? -0.9 : 0;
      _des.copy(_tan).multiplyScalar(ai.side).addScaledVector(_dir, radial);
      _des.y += yMatch + ai.vert * 0.3;
      facePlayer = true;
      if (ai.t <= 0) {
        if (mods.passOk) { ai.state = 'pass'; ai.t = c.passTime * mods.passTime; ai.passFired = false; }
        else ai.t = rng.range(c.circleTime[0], c.circleTime[1]); // no high-speed passes: keep circling
      }
      break;
    }
    case 'pass':
      // high-speed pass straight through the player's area
      _des.copy(_dir);
      speed = cMax;
      if (!ai.passFired) { ai.passFired = true; if (mods.beamOk) { ai.burst = c.burst; ai.burstT = 0; } }
      if ((closing < -50 && dist < 1500) || dist < 120 || ai.t <= 0) {
        ai.state = 'extend';
        ai.t = rng.range(c.extendTime[0], c.extendTime[1]);
        ai.side = -ai.side;
        ai.vert = rng.range(0.1, 0.5);
      }
      break;
    default: // 'extend': boost away, then come back
      _des.copy(_dir).multiplyScalar(-0.8).addScaledVector(_tan, ai.side * 0.4);
      _des.y += ai.vert;
      speed = cMax;
      if (ai.t <= 0) { ai.state = 'approach'; ai.side = rng.sign(); }
      break;
  }
  const jink = dodging(ai, dt);
  if (jink) { _des.copy(ai.dodgeDir).addScaledVector(e.velocity, 1 / (e.velocity.length() + 1)); speed = cMax; }
  altitudeGuard(e, _des);
  if (_des.lengthSq() < 1e-6) _des.copy(_dir);
  _des.normalize().multiplyScalar(speed);
  accelerate(e, _des, c.accel * mods.accel * (jink ? 1.5 : 1), dt);
  const sp = e.velocity.length();
  if (sp > cMax) e.velocity.multiplyScalar(cMax / sp);
  e.heat = clamp(0.7 + 0.3 * (sp / c.max), 0, 1);
  // CR-003: the Penelope is a humanoid model now: stays upright like the Gustav
  if (facePlayer) orientUpright(e, _dir, dt, 5, sp);
  else if (sp > 1) orientUpright(e, _rv.copy(e.velocity).divideScalar(sp), dt, 4, sp);

  if (!hostile) return;
  // --- heavy beam: one dangerous shot at a time ---
  ai.fireT -= dt;
  if (ai.burst > 0) {
    ai.burstT -= dt;
    if (ai.burstT <= 0) {
      fireEnemyBeam(S, e, c.beamDamage, mods.leadOk ? rng.range(c.leadMin, c.leadMax) : 0, c.spread * mods.spread, c.beamPower, c.beamRadius);
      ai.burst--;
      ai.burstT = 0.5;
    }
  } else if (ai.fireT <= 0 && mods.beamOk && dist < c.fireRange && dist > 400 && (ai.state === 'circle' || ai.state === 'pass')) {
    ai.burst = c.burst;
    ai.burstT = 0;
    ai.fireT = c.fireInterval * rng.range(0.8, 1.2) * mods.fireRate;
  }
  // --- missile salvos ---
  ai.salvoCd -= dt;
  if (ai.salvo > 0) {
    ai.salvoT -= dt;
    if (ai.salvoT <= 0) { spawnMissile(S, e); ai.salvo--; ai.salvoT = 0.25; }
  } else if (ai.salvoCd <= 0 && mods.missileOk && dist > c.missileMin && dist < c.missileMax && ai.state !== 'extend') {
    ai.salvo = Math.min(c.salvoSize, mods.salvo);
    ai.salvoT = 0;
    ai.salvoCd = rng.range(c.salvoInterval[0], c.salvoInterval[1]);
  }
}

// ---- desperate behaviour: ram when every ranged weapon is gone, flee when crippled -----------------
function rangedGone(e) {
  const list = ENEMY_PARTS.ranged[e.type];
  for (const n of list) if (e.parts[n].status !== 'destroyed') return false;
  return true;
}

function updateDesperation(S, e) {
  const ai = e.sim;
  if (ai.state === 'flee') return;
  const hpf = e.hp / e.maxHp;
  const mobDestroyed = e.parts[ENEMY_PARTS.mobility[e.type]].status === 'destroyed';
  if (!ai.fled && hpf < ENEMY_PARTS.fleeHp && mobDestroyed) {
    ai.state = 'flee';
    ai.fleePhase = 'out';
    ai.fled = true;
    ai.burst = 0;
  } else if (ai.state !== 'ram' && rangedGone(e)) {
    ai.state = 'ram';
    ai.burst = 0;
  }
}

function stepDesperate(S, e, dt) {
  const rt = S.sim;
  const p = e.sim.tgt || S.player;
  const ai = e.sim;
  const c = ENEMY[e.type];
  _toP.copy(p.position).sub(e.position);
  const dist = _toP.length() || 1;
  _dir.copy(_toP).divideScalar(dist);
  const cMax = c.max * ai.mods.speed;
  _des.set(0, 0, 0);
  let speed = cMax;
  if (ai.state === 'ram') {
    _des.copy(_dir);
  } else if (ai.fleePhase === 'out') {
    _des.copy(_dir).multiplyScalar(-1);
    _des.y += 0.2;
    if (dist > ENEMY_PARTS.fleeRange) { ai.fleePhase = 'wait'; ai.t = ENEMY_PARTS.returnDelay; }
  } else { // wait far away, then come back with the parts still broken
    speed = 0;
    ai.t -= dt;
    if (ai.t <= 0) { ai.state = 'approach'; ai.fleePhase = null; }
  }
  altitudeGuard(e, _des);
  if (speed > 0) {
    if (_des.lengthSq() < 1e-6) _des.copy(_dir);
    _des.normalize().multiplyScalar(speed);
  } else _des.set(0, 0, 0);
  accelerate(e, _des, c.accel * ai.mods.accel, dt);
  const sp = e.velocity.length();
  if (sp > cMax) e.velocity.multiplyScalar(cMax / sp);
  e.heat = clamp(0.5 + 0.3 * (sp / c.max), 0, 1);
  if (sp > 1) orientShip(e, _rv.copy(e.velocity).divideScalar(sp), 4 * dt, dt);
  void rt;
}

// CR-003: an AI (host side) attacks the nearest living pilot, local or remote. Null when nobody is in play.
function pickTarget(S, e) {
  const rt = S.sim;
  let best = null;
  let bd = Infinity;
  if (S.phase === 'flight') { best = S.player; bd = e.position.distanceToSquared(S.player.position); }
  for (const r of rt.remotes) {
    const d = e.position.distanceToSquared(r.position);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

export function stepEnemies(S, dt, hostile) {
  const rt = S.sim;
  const ships = rt.ships;
  for (let i = 0; i < ships.length; i++) {
    const e = ships[i];
    if (!e.alive) continue;
    const tgt = rt.netOn ? pickTarget(S, e) : e.sim.goal === 'seawrack' ? strikeTarget(S, e) : S.player;   // CR-013 strike group
    e.sim.tgt = tgt || S.player;
    const h = hostile && !!tgt;
    if (!e.sim.stationary) {
      updateDesperation(S, e);
      if (e.sim.state === 'ram' || e.sim.state === 'flee') stepDesperate(S, e, dt);
      else if (e.type === 'gustav') stepGustav(S, e, dt, h);
      else stepPenelope(S, e, dt, h);
    }
    e.position.addScaledVector(e.velocity, dt);
    e.state = e.sim.state;
  }
}

// ---- parts: where did a shot land ----------------------------------------------------------------
const _inv = new THREE.Quaternion();
const _lo = new THREE.Vector3();
const _ld = new THREE.Vector3();

// slab test of a ray (origin o, unit direction d, length len, all in model units) against a box
// [cx, cy, cz, hx, hy, hz]. Returns the entry distance, or -1 when it misses.
function rayBox(o, d, len, b) {
  let t0 = 0;
  let t1 = len;
  for (let k = 0; k < 3; k++) {
    const ok = k === 0 ? o.x : k === 1 ? o.y : o.z;
    const dk = k === 0 ? d.x : k === 1 ? d.y : d.z;
    const lo = b[k] - b[k + 3];
    const hi = b[k] + b[k + 3];
    if (Math.abs(dk) < 1e-9) {
      if (ok < lo || ok > hi) return -1;
    } else {
      let a = (lo - ok) / dk;
      let c = (hi - ok) / dk;
      if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) return -1;
    }
  }
  return t0;
}

// Which part does a shot hit? The shot is a ray (world origin ro, unit direction rd, length rlen, metres) that
// the projectile follows; the first box it enters wins, parts first-come with the torso. Destroyed parts are
// gone, so the ray passes through them. Boxes are model-unit boxes scaled by `scale` (default MODEL_SCALE x the type's MODEL_BASE_SCALE: what the render draws).
// Returns { part: name | null (torso or miss), point: Vector3 entry point in LOCAL model units | null }.
export function pickEnemyPart(e, ro, rd, rlen, scale) {
  const kind = e.type === 'remote' ? (e.suit === 'penelope' || e.suit === 'xi' ? e.suit : 'gustav') : e.type; // CR-003: remote pilots
  if (scale === undefined) scale = MODEL_SCALE * (MODEL_BASE_SCALE[kind] || 1);
  const boxes = ENEMY_PARTS.boxes[kind];
  _inv.copy(e.quaternion).invert();
  _lo.copy(ro).sub(e.position).applyQuaternion(_inv).divideScalar(scale);
  if (rd) _ld.copy(rd).applyQuaternion(_inv); else _ld.set(0, 0, 1);
  const len = (rlen || 0) / scale;
  let best = Infinity;
  let bestPart = null;
  let bestTorso = Infinity;
  for (const name of Object.keys(boxes)) {
    const isTorso = name === 'torso';
    if (!isTorso && e.parts[name].status === 'destroyed') continue;
    for (const b of boxes[name]) {
      const t = rayBox(_lo, _ld, len, b);
      if (t < 0) continue;
      if (isTorso) { if (t < bestTorso) bestTorso = t; } else if (t < best) { best = t; bestPart = name; }
    }
  }
  if (bestPart === null || bestTorso < best) return { part: null, point: null };
  return { part: bestPart, point: _lo.clone().addScaledVector(_ld, best) };
}

function damageEnemyPart(S, e, name, amount) {
  const part = e.parts[name];
  if (part.status === 'destroyed') return;
  part.hp = Math.max(0, part.hp - amount);
  if (part.hp < 1e-9) part.hp = 0;
  const before = part.status;
  if (part.hp <= 0) part.status = 'destroyed';
  else if (part.hp < part.maxHp * ENEMY_PARTS.damagedAt) part.status = 'damaged';
  if (part.status === before) return;
  const mods = applyEnemyMods(e);
  if (!mods.beamOk) e.sim.burst = 0;
  if (part.status === 'damaged') {
    pushEvent(S, 'enemyPartDamaged', { id: e.id, part: name, hp: part.hp });
  } else {
    const b = ENEMY_PARTS.boxes[e.type][name][0];
    pushEvent(S, 'enemyPartDestroyed', { id: e.id, part: name, point: new THREE.Vector3(b[0], b[1], b[2]) });
  }
}

// dmg = body damage (always applied in full). src: 'beam' | 'funnel' | 'vulcan' | 'saber'. The optional ray
// (ro, rd, rlen) is how the shot travels; without it the hit is a body hit.
export function hitEnemy(S, e, dmg, hitPos, size, src = 'beam', ro = null, rd = null, rlen = 0) {
  if (!e.alive) return;
  let part = null;
  if (e.parts && (ro || hitPos)) {
    const pick = pickEnemyPart(e, ro || hitPos, ro ? rd : null, ro ? rlen : 0);
    part = pick.part;
  }
  applyEnemyHit(S, e, dmg, part, hitPos, size, src);
}

// CR-003: shooter-side hit tests go through here: mirrors and remote pilots get a network message, local AI the real hit.
export function hitTarget(S, s, dmg, hitPos, size, src, ro, rd, rlen) {
  if (s.type === 'remote' || s.owner) return S.sim.netHit(S, s, dmg, hitPos, size, src, ro, rd, rlen);
  return hitEnemy(S, s, dmg, hitPos, size, src, ro, rd, rlen);
}

// the part is already known (picked here by hitEnemy, or by the shooter's client for a remote hit on the host's AI)
export function applyEnemyHit(S, e, dmg, part, hitPos, size, src = 'beam') {
  const rt = S.sim;
  if (!e.alive) return;
  e.hp -= dmg;
  const ally = src === 'ally';                 // Chapter 3: a rebel's beam - not the player's hit (accuracy) or kill
  e.lastHitBy = ally ? 'ally' : 'player';
  if (!ally) rt.hits++;
  pushEvent(S, 'enemyHit', { id: e.id, part, ally });
  if (part) damageEnemyPart(S, e, part, dmg * (ENEMY_PARTS.partDamage[src] ?? 1));
  if (size > 0 && hitPos) pushEvent(S, 'explosion', { position: hitPos.clone(), size });
  if (e.type === 'gustav' && e.hp > 0 && e.sim.mods.breakOk && rt.rng.chance(0.4) && e.sim.state !== 'break'
    && e.sim.state !== 'ram' && e.sim.state !== 'flee') {
    e.sim.state = 'break';
    e.sim.t = 2;
  }
  if (e.hp <= 0) killEnemy(S, e);
}

const ALLY_KILL_LINES = ['BILI-1: Got one! Old girl still bites.', 'BILI-3: Splash one Gustav!', 'BILI-2: That one\'s mine, Mafty.'];

export function killEnemy(S, e) {
  if (!e.alive) return;
  const rt = S.sim;
  e.alive = false;
  e.hp = 0;
  if (rt.netOn) { rt.netAiKilled(S, e); return; }
  if (e.lastHitBy === 'ally') {                // a rebel shot it down
    pushEvent(S, 'allyKill', { id: e.id, name: e.name });
    pushEvent(S, 'explosion', { position: e.position.clone(), size: 3 });
    setMessage(S, rt.rng.pick(ALLY_KILL_LINES), 3);
    return;
  }
  S.mission.kills++;
  pushEvent(S, 'kill', { id: e.id, name: e.name });
  pushEvent(S, 'explosion', { position: e.position.clone(), size: 3 });
  if (e.type === 'gustav' || rt.rng.chance(0.5)) setMessage(S, rt.rng.pick(KILL_LINES), 3);
}

// anything whose hp was zeroed elsewhere dies here
export function sweepDeaths(S) {
  const ships = S.sim.ships;
  for (let i = 0; i < ships.length; i++) {
    const e = ships[i];
    if (e.alive && e.hp <= 0) killEnemy(S, e);
  }
}
