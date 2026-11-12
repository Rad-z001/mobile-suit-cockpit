// Damage to the player: parts, shield, hull, monitor sectors, disabled state, eject, end of mission.
import * as THREE from 'three';
import { DAMAGE, BARRIER, PARTS, SHIELD } from './tuning.js';
import { clamp, pushEvent, raiseAlert, setMessage, randomUnit } from './util.js';
import { clearTargeting } from './sensors.js';
import { HATCH_UNLOCK_TIME } from '../state.js';
import { ejectUnlockStart, ejectUnlockCancel, ejectBlow } from './hatch.js';

const _dl = new THREE.Vector3();
const _iq = new THREE.Quaternion();

export function endMission(S, victory) {
  const rt = S.sim;
  S.mission.result = {
    victory,
    kills: S.mission.kills,
    elapsed: S.mission.elapsed,
    shotsFired: rt.shotsFired,
    hits: rt.hits,
  };
}

function sectorOf(dl, rng) {
  if (Math.abs(dl.y) > 0.95) return rng.int(8);
  const ang = Math.atan2(dl.x, -dl.z);
  const idx = Math.round(ang / (Math.PI / 4));
  return ((idx % 8) + 8) % 8;
}

function knockOutSector(S, idx, severity) {
  const rt = S.sim;
  const sec = rt.sector[idx];
  if (sec.base <= 0.1) return;
  if (idx === 0) {
    // The forward main camera has redundancy: it degrades and always comes back,
    // so the player is never left permanently blind straight ahead.
    sec.base = rt.rng.range(0.45, 0.6);
    sec.recoverAt = rt.time + rt.rng.range(3, 6);
    sec.recoverTo = rt.rng.range(0.8, 0.95);
    pushEvent(S, 'sectorLost', { index: idx });
    return;
  }
  sec.base = rt.rng.range(0, 0.12) * (1 - severity * 0.5);
  sec.recoverAt = rt.rng.chance(0.45) ? rt.time + rt.rng.range(6, 14) : Infinity;
  sec.recoverTo = rt.rng.range(0.35, 0.75);
  pushEvent(S, 'sectorLost', { index: idx });
}

// ---- parts (CR-002 item 11, docs/PLAN-parts-break.md) ----------------------------------------------
const PART_LABEL = { head: 'HEAD', rArm: 'R-ARM', lArm: 'L-ARM', legs: 'LEGS', pack: 'FLIGHT UNIT', pods: 'FUNNEL PODS' };
const LOST_RADIO = {
  head: 'Head is gone. No vulcans, the sensors are half blind.',
  rArm: 'Rifle arm is gone. Saber still works.',
  lArm: 'Shield arm is gone.',
  legs: 'Thrusters are hit. We are slow and pulling to one side.',
  pack: 'Flight unit is gone. Hover only.',
  pods: 'Funnel pods are gone.',
};

// is at least one weapon still usable if `ignore` were destroyed? rifle needs rArm, saber rArm or lArm,
// vulcan needs the head, funnels the pods
function weaponLeft(parts, ignore) {
  const ok = (n) => n !== ignore && parts[n].hp > 0;
  return ok('rArm') || ok('lArm') || ok('head') || ok('pods');
}

function setStatus(part) {
  part.status = part.hp <= 0 ? 'destroyed' : part.hp < PARTS.damagedAt ? 'damaged' : 'ok';
}

// derive p.mods from the parts. Runs every frame; parts never recover.
export function updateParts(S) {
  const p = S.player;
  const pt = p.parts;
  const m = p.mods;
  const fx = PARTS.effects;
  const st = (n) => pt[n].status;
  m.speed = 1; m.turn = 1; m.roll = 1; m.vertical = 1; m.boost = 1; m.flightSpeed = 1; m.boostHeat = 1;
  m.xformTime = 1; m.radarRange = 1; m.lockTime = 1; m.spread = 0; m.rifleCd = 1; m.saberReach = 1;
  m.funnelRegen = 1; m.funnelSalvo = Infinity; m.shieldRaise = 1; m.shieldCone = SHIELD.cone; m.shieldBlock = SHIELD.block;
  const apply = (name, map) => {
    const e = fx[name][st(name)];
    if (!e) return;
    for (const k of Object.keys(e)) {
      const key = map[k] || k;
      if (key === 'bias') continue;
      if (key === 'spread' || key === 'shieldCone' || key === 'shieldBlock' || key === 'funnelSalvo') m[key] = e[k];
      else m[key] *= e[k];
    }
  };
  for (const n of ['head', 'rArm', 'lArm', 'legs', 'pack', 'pods']) apply(n, {});
  m.rifleOk = pt.rArm.hp > 0;
  m.saberOk = pt.rArm.hp > 0 || pt.lArm.hp > 0;
  m.saberDamage = pt.rArm.hp > 0 ? 1 : PARTS.saberLeftHandDamage;
  m.vulcanOk = pt.head.hp > 0;
  m.funnelOk = pt.pods.hp > 0;
  m.shieldOk = pt.lArm.hp > 0;
  m.flightOk = pt.pack.hp > 0;
  m.targetReadable = pt.head.hp > 0;
  if (!m.funnelOk) { m.funnelRegen = 0; m.funnelSalvo = 0; }
  // legs hp shows on the four nozzles (visual only) and a destroyed leg unit pulls the suit to one side
  const rt = S.sim;
  for (let i = 0; i < 4; i++) rt.thrusters[i] = clamp(pt.legs.hp * 4 - i, 0, 1);
  rt.bias.yaw = pt.legs.status === 'destroyed' ? fx.legs.destroyed.bias * (rt.legSide || 1) : 0;
}

function pickWeighted(rng, table) {
  let total = 0;
  for (const k in table) total += table[k];
  let r = rng.next() * total;
  for (const k in table) {
    r -= table[k];
    if (r < 0) return k;
  }
  return Object.keys(table)[0];
}

// which part does a hit from this PLAYER-LOCAL direction land on? 'core' means the hull itself.
export function pickPart(rng, dl) {
  const z = PARTS.zones;
  let table;
  if (dl.z < PARTS.frontZ) table = z.front;
  else if (dl.z > PARTS.rearZ) table = z.rear;
  else if (dl.y > PARTS.topY) table = z.top;
  else if (dl.y < PARTS.lowY) table = z.low;
  else {
    table = {};
    const arm = dl.x >= 0 ? 'rArm' : 'lArm';
    for (const k in z.side) table[k === 'arm' ? arm : k] = z.side[k];
  }
  return pickWeighted(rng, table);
}

function partAlert(S, name, status) {
  const label = PART_LABEL[name];
  if (status === 'destroyed') {
    raiseAlert(S, 'part_' + name, `${label} LOST`, 'warning', 6);
    setMessage(S, LOST_RADIO[name], 5);
  } else raiseAlert(S, 'part_' + name, `${label} DAMAGED`, 'caution', 4);
}

// takes `amount` of part hp; fires one event per status change. The last working weapon is held at lastWeaponHp.
function damagePart(S, name, amount, dirLocal) {
  const p = S.player;
  const part = p.parts[name];
  if (part.hp <= 0) return;
  const before = part.status;
  part.hp = Math.max(0, part.hp - amount);
  if (part.hp < 1e-9) part.hp = 0;
  if (part.hp <= 0 && !weaponLeft(p.parts, name)) part.hp = PARTS.lastWeaponHp; // held together
  setStatus(part);
  updateParts(S);
  if (part.status === before) return;
  if (part.status === 'damaged') pushEvent(S, 'partDamaged', { part: name, hp: part.hp, dir: dirLocal.clone() });
  else if (part.status === 'destroyed') {
    pushEvent(S, 'partDestroyed', { part: name });
    if (name === 'legs') S.sim.legSide = S.sim.rng.sign();
    updateParts(S);
  }
  partAlert(S, name, part.status);
}

export function recomputeThrust(S) {
  const rt = S.sim;
  rt.thrustFactor = 1; // thrust loss now lives in player.mods (legs), not in a thrust factor
  updateParts(S);
}

// fromDirWorld: unit vector pointing from the pilot toward where the hit came from (or null)
// opts.part forces the part that is hit (tests / debugging): a part name or 'core'
// fromDirWorld: unit vector pointing from the pilot toward where the hit came from (or null)
export function damagePlayer(S, amount, fromDirWorld, opts) {
  const rt = S.sim;
  const p = S.player;
  if (S.phase !== 'flight' && S.phase !== 'disabled' && S.phase !== 'victory') return;
  if (S.phase === 'victory') return;
  if (rt.netOn && S.match.spawnShield > 0) return; // CR-003: spawn protection
  const rng = rt.rng;

  // local direction
  if (fromDirWorld) _dl.copy(fromDirWorld);
  else randomUnit(rng, _dl);
  _dl.normalize();
  _iq.copy(p.quaternion).invert();
  _dl.applyQuaternion(_iq);
  const dirLocal = _dl.clone();

  const flying = S.phase === 'flight';
  const hullBefore = p.hull;
  let dmg = amount;
  let absorbed = 0;
  let hitPart = null; // 'shield' | part name | 'core'

  // shield (hold B): blocks the front cone once raised. Rear and side hits ignore it.
  const sh = p.shield;
  const m = p.mods;
  if (flying && sh.up && sh.raise >= 1 && m.shieldOk && dirLocal.z < -Math.cos(m.shieldCone)) {
    hitPart = 'shield';
    const leak = 1 - m.shieldBlock;
    dmg = amount * leak;
    damagePart(S, 'lArm', amount * SHIELD.wear, dirLocal);
    pushEvent(S, 'shieldBlock', { dir: dirLocal.clone(), damage: amount });
  }

  const b = p.barrier;
  if (b.active && b.integrity > 0) {
    absorbed = Math.min(dmg * BARRIER.absorb, b.integrity / BARRIER.integrityCost);
    b.integrity = Math.max(0, b.integrity - absorbed * BARRIER.integrityCost);
    dmg -= absorbed;
    rt.barrierHitT = BARRIER.regenDelay;
  }

  let partDmg = 0;
  let hullDmg = dmg;
  if (hitPart === null) {
    let pick = opts && opts.part ? opts.part : pickPart(rng, dirLocal);
    if (pick !== 'core' && p.parts[pick].hp <= 0) pick = 'core'; // nothing left to break: the hull takes it
    hitPart = pick;
    if (pick !== 'core') {
      partDmg = dmg * PARTS.dmgScale;
      hullDmg = dmg * PARTS.hullShare;
    }
  }
  if (flying) p.hull = Math.max(0, p.hull - hullDmg);
  pushEvent(S, 'playerHit', { damage: amount, dir: dirLocal, absorbed, part: hitPart });
  if (flying && partDmg > 0) damagePart(S, hitPart, partDmg, dirLocal);

  // jolt: pushes the pilot away from the impact
  rt.gImpulse.addScaledVector(dirLocal, -clamp(amount * 45, 0.5, 8));
  p.stress = clamp(p.stress + amount * 4, 0, 1);
  if (typeof S.input.rumble === 'function') {
    try { S.input.rumble(0.8, 0.5, 220); } catch (e) { /* controller gone */ }
  }

  if (dmg > 0.03) {
    const idx = sectorOf(dirLocal, rng);
    if (rng.chance(DAMAGE.sectorHitChance + dmg * DAMAGE.sectorHitPerDamage)) knockOutSector(S, idx, dmg);
  }

  if (S.phase === 'flight') {
    if (hullBefore >= 0.6 && p.hull < 0.6) {
      raiseAlert(S, 'breach', 'HULL BREACH', 'warning', 8);
      setMessage(S, 'Hull breach! Pressure dropping.', 5);
    }
    if (hullBefore >= 0.3 && p.hull < 0.3) raiseAlert(S, 'breach2', 'HULL BREACH — SECTION 4', 'warning', 8);
    if (p.hull <= 0) { if (rt.netOn) rt.netDie(S, null); else goDisabled(S); }
  }
}

export function goDisabled(S) {
  const rt = S.sim;
  const p = S.player;
  S.phase = 'disabled';
  p.hull = 0;
  p.barrier.active = false;
  p.throttle = 0;
  const rng = rt.rng;
  rt.tumble.set(rng.range(-0.9, 0.9), rng.range(-0.5, 0.5), rng.range(-1.4, 1.4));
  if (Math.abs(rt.tumble.z) < 0.5) rt.tumble.z = 0.9 * rng.sign();
  for (let i = 0; i < 8; i++) {
    if (rng.chance(0.65)) {
      rt.sector[i].base = rng.range(0, 0.2);
      rt.sector[i].recoverAt = Infinity;
      pushEvent(S, 'sectorLost', { index: i });
    }
  }
  raiseAlert(S, 'sysfail', 'SYSTEM FAILURE', 'warning', 9999);
  raiseAlert(S, 'powerloss', 'MAIN POWER LOST', 'warning', 9999);
  S.mission.objective = 'HOLD EJECT LEVER';
  setMessage(S, 'Everything is failing. Pull the lever. PULL IT.', 9999);
  clearTargeting(S);
}

export function seaImpact(S, how = 'sea') {
  const rt = S.sim;
  const p = S.player;
  if (rt.netOn) { rt.netDie(S, 'sea'); return; }
  p.hull = 0;
  pushEvent(S, 'explosion', { position: p.position.clone(), size: 3 });
  S.phase = 'ejected';
  S.mission.objective = 'PILOT LOST';
  setMessage(S, how === 'ground' ? 'Impact with the ground. The pilot did not get out.' : 'Impact with the sea. The pilot did not get out.', 9999);
  endMission(S, false);
  p.barrier.active = false;
  clearTargeting(S);
}

// manual hatch lever
export function updateEject(S, dt) {
  const rt = S.sim;
  const p = S.player;
  const can = S.phase === 'disabled' || (S.phase === 'flight' && p.hull < DAMAGE.ejectHullThreshold);
  if (!can) {
    rt.ejectProgress = 0;
    rt.ejectHeld = false;
    ejectUnlockCancel(S);
    return;
  }
  // CR-004: the hatch unlocks (HATCH UNLOCK) during the last HATCH_UNLOCK_TIME of the pull, then blows at the end
  const unlockAt = 1 - HATCH_UNLOCK_TIME / DAMAGE.ejectHoldTime;
  if (S.input.ejectHold) {
    if (!rt.ejectHeld) {
      rt.ejectHeld = true;
      pushEvent(S, 'ejectLever');
    }
    rt.ejectProgress = Math.min(1, rt.ejectProgress + dt / DAMAGE.ejectHoldTime);
    if (rt.ejectProgress >= unlockAt) ejectUnlockStart(S);
    if (rt.ejectProgress >= 1) {
      ejectBlow(S);
      pushEvent(S, 'hatchBlow');
      S.phase = 'ejected';
      p.barrier.active = false;
      S.mission.objective = 'PILOT EJECTED';
      setMessage(S, 'Hatch blown. You are out. The suit is not.', 9999);
      endMission(S, false);
      clearTargeting(S);
    }
  } else {
    rt.ejectHeld = false;
    rt.ejectProgress = Math.max(0, rt.ejectProgress - dt * 1.5);
    if (rt.ejectProgress < unlockAt) ejectUnlockCancel(S);
  }
}

// monitor sectors: recovery and flicker
export function updateSectors(S, dt) {
  const rt = S.sim;
  const out = S.player.sensors.sectors;
  for (let i = 0; i < 8; i++) {
    const s = rt.sector[i];
    if (S.phase === 'flight' && rt.time >= s.recoverAt) {
      s.base = s.recoverTo;
      s.recoverAt = Infinity;
    }
    if (s.base >= 0.95) { out[i] = 1; continue; }
    s.flickT -= dt;
    if (s.flickT <= 0) {
      s.flick = rt.rng.chance(0.55) ? 1 : rt.rng.range(0.2, 0.6);
      s.flickT = rt.rng.range(0.05, 0.4);
    }
    out[i] = s.base * s.flick;
  }
}
