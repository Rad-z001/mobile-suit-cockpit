// Player weapons: beam rifle (E-Pack), beam saber, head vulcans, funnel missiles, flares, shield.
// CR-002: no rifle lock and no charge (the shot goes along player.aim.dir), no recoil.
import * as THREE from 'three';
import { WEAPONS, SHIELD } from './tuning.js';
import { MODEL_SCALE, XI_COCKPIT, XI_HEAD_VULCAN } from '../state.js';
import { makeEntity, pushEvent, forwardOf, lookQuat, randomUnit, raiseAlert, getEntity, clamp, segDist2, netFire } from './util.js';
import { alertEnemiesOfShot, hitTarget } from './enemies.js';
import { shootDownMissile } from './projectiles.js';

const _f = new THREE.Vector3();   // crosshair direction (world)
const _bf = new THREE.Vector3();  // body forward
const _r = new THREE.Vector3();   // body right
const _u = new THREE.Vector3();   // body up
const _m = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Vector3();

function axes(p) {
  _f.copy(p.aim.dir);
  forwardOf(p.quaternion, _bf);
  _r.set(1, 0, 0).applyQuaternion(p.quaternion);
  _u.set(0, 1, 0).applyQuaternion(p.quaternion);
}

function fireRifle(S) {
  const rt = S.sim;
  const p = S.player;
  const r = p.weapons.rifle;
  // muzzle: the rifle in the right hand, out in front of the suit along the crosshair
  _m.copy(p.position).addScaledVector(_f, 10).addScaledVector(_r, 2.2);
  _d.copy(_f);
  if (p.mods.spread > 0) { // damaged right arm
    randomUnit(rt.rng, _s).multiplyScalar(p.mods.spread * rt.rng.next());
    _d.add(_s).normalize();
  }
  const b = makeEntity(S, {
    type: 'beam', faction: 'player', name: 'BEAM RIFLE', radius: WEAPONS.beamRadius, hp: 1, heat: 1,
    ttl: WEAPONS.beamTtl, targetId: null, power: 1,
  });
  b.position.copy(_m);
  b.velocity.copy(_d).multiplyScalar(WEAPONS.beamSpeed);
  lookQuat(b.quaternion, _d);
  b.sim = { dmg: WEAPONS.rifleDamage };
  r.shots -= 1;
  r.cooldown = WEAPONS.rifleCooldown * p.mods.rifleCd;
  rt.shotsFired++;
  alertEnemiesOfShot(S, _m, _d);
  netFire(S, 'r', _m, _d);
  pushEvent(S, 'rifleFire');
  if (r.shots <= 0) startReload(S, true); // empty pack swaps itself
}

function startReload(S, auto) {
  const r = S.player.weapons.rifle;
  if (r.reloading) return false;
  if (!auto && r.shots >= r.perPack) return false;
  r.reloading = true;
  r.reload = 0;
  pushEvent(S, 'reloadStart');
  return true;
}

// Distance along the crosshair line to the nearest hostile thing the line passes through or close by (ship, pilot or
// missile), else `def`.
function convergeRange(S, def, max) {
  const p = S.player;
  let best = Infinity;
  for (const e of S.entities) {
    if (!e.alive || e.faction === 'player' || e.faction === 'ally' || e.faction === 'neutral') continue;
    if (e.type !== 'gustav' && e.type !== 'penelope' && e.type !== 'missile' && e.type !== 'remote') continue;
    _e.copy(e.position).sub(p.position);
    const along = _e.dot(_f);
    if (along < 40 || along > max || along >= best) continue;
    const perp = Math.sqrt(Math.max(0, _e.lengthSq() - along * along));
    if (perp < (e.radius || 0) * 1.25 + along * 0.06) best = along;   // inside its bounding sphere, or within ~3.5 degrees
  }
  return best < Infinity ? best : def;
}

function fireVulcanRound(S) {
  const rt = S.sim;
  const p = S.player;
  const w = p.weapons.vulcan;
  if (p.suit === 'gustav' || p.suit === 'penelope') {
    _m.copy(p.position).addScaledVector(_bf, 9).addScaledVector(_u, 1.5);
    _d.copy(_f);
  } else {
    // CR-006 Xi: the rounds leave the head, above the chest cockpit (in the flight form the suit lies prone: head forward,
    // chest down), and are angled so they cross the crosshair line at the range of whatever is under it.
    const hx = (XI_HEAD_VULCAN.x - XI_COCKPIT.x) * MODEL_SCALE, hy = (XI_HEAD_VULCAN.y - XI_COCKPIT.y) * MODEL_SCALE, hz = (XI_COCKPIT.z - XI_HEAD_VULCAN.z) * MODEL_SCALE;
    if (p.flightMode === 'minovsky') _m.copy(p.position).addScaledVector(_r, hx).addScaledVector(_bf, hy).addScaledVector(_u, -hz);
    else _m.copy(p.position).addScaledVector(_r, hx).addScaledVector(_u, hy).addScaledVector(_bf, hz);
    _d.copy(p.position).addScaledVector(_f, convergeRange(S, WEAPONS.vulcanConverge, WEAPONS.vulcanSpeed * WEAPONS.vulcanTtl)).sub(_m).normalize();
  }
  randomUnit(rt.rng, _s).multiplyScalar(WEAPONS.vulcanSpread);
  _d.add(_s).normalize();
  const t = makeEntity(S, {
    type: 'tracer', faction: 'player', name: 'VULCAN', radius: 0.4, hp: 1, heat: 0.5,
    ttl: WEAPONS.vulcanTtl,
  });
  t.position.copy(_m);
  t.velocity.copy(_d).multiplyScalar(WEAPONS.vulcanSpeed).add(p.velocity);
  lookQuat(t.quaternion, _d);
  t.sim = { dmg: WEAPONS.vulcanDamage };
  w.ammo -= 1;
  rt.shotsFired++;
  netFire(S, 'v', _m, _d);
  pushEvent(S, 'vulcanFire');
}

function launchFunnels(S) {
  const rt = S.sim;
  const p = S.player;
  const fw = p.weapons.funnel;
  if (fw.count <= 0 || rt.funnelCd > 0) return;
  const lock = p.lock;
  let target = lock.state === 'locked' ? getEntity(S, lock.targetId) : null;
  if (target && target.dead) target = null;
  if (!target) {
    raiseAlert(S, 'nofunnel', 'NO FUNNEL TARGET', 'caution', 1);
    return;
  }
  const pods = p.suit === 'gustav'; // CR-003: Gustav Karl missile pods share the funnel code
  const n = Math.min(fw.count, pods ? WEAPONS.podSalvo : WEAPONS.funnelSalvo, p.mods.funnelSalvo);
  for (let i = 0; i < n; i++) {
    const m = makeEntity(S, {
      type: 'funnelMissile', faction: 'player', name: 'FUNNEL', radius: 2, hp: 1, heat: 0.75,
      ttl: 8, targetId: target.id,
    });
    // fan out around the nose
    const ang = (i / n) * Math.PI * 2;
    _d.copy(_f).addScaledVector(_r, Math.cos(ang) * 0.5).addScaledVector(_u, Math.sin(ang) * 0.5).normalize();
    m.position.copy(p.position).addScaledVector(_f, 6).addScaledVector(_r, Math.cos(ang) * 3).addScaledVector(_u, Math.sin(ang) * 3);
    m.velocity.copy(p.velocity).addScaledVector(_d, 120);
    lookQuat(m.quaternion, _d);
    m.sim = { dmg: pods ? WEAPONS.podDamage : WEAPONS.funnelDamage, speedMax: WEAPONS.funnelSpeed, accel: 170, turn: WEAPONS.funnelTurn };
  }
  fw.count -= n;
  rt.shotsFired += n;
  rt.funnelCd = WEAPONS.funnelCooldown;
  netFire(S, 'p', p.position, _f, n);
  pushEvent(S, 'funnelLaunch', { count: n });
}

function deployFlare(S) {
  const rt = S.sim;
  const p = S.player;
  const fl = p.weapons.flares;
  if (fl.count <= 0) return;
  fl.count--;
  const first = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const f = makeEntity(S, {
      type: 'flare', faction: 'player', name: 'FLARE', radius: 2, hp: 1, heat: 1, ttl: WEAPONS.flareTtl,
    });
    f.position.copy(p.position).addScaledVector(_bf, -8);
    f.velocity.copy(p.velocity).multiplyScalar(0.92).addScaledVector(_bf, -25)
      .addScaledVector(_r, side * 38).addScaledVector(_u, -12 + 10 * i);
    lookQuat(f.quaternion, _bf);
    first.push(f);
  }
  // enemy missiles in view may bite on the decoy
  for (const m of S.entities) {
    if (!m.alive || m.type !== 'missile' || m.sim.mirror) continue;
    const tgt = m.targetId;
    if (tgt !== 'player' && !getEntity(S, tgt)) continue;
    _d.copy(first[0].position).sub(m.position);
    const dist = _d.length();
    if (dist > 4500) continue;
    const mv = m.velocity.length() || 1;
    const cos = _d.dot(m.velocity) / (dist * mv || 1);
    if (cos < 0.34) continue; // outside ~70 degree seeker cone
    if (rt.rng.chance(WEAPONS.flareDecoyChance)) {
      m.targetId = first[rt.rng.int(2)].id;
      m.sim.lost = false;
    }
  }
  pushEvent(S, 'flareDeploy');
}

// ---- beam saber ---------------------------------------------------------------------------
function startSlash(S) {
  const sb = S.player.weapons.saber;
  sb.slash = 1e-6;
  S.sim.saberHit = false;
  netFire(S, 's', _m.copy(S.player.position), _f);
  pushEvent(S, 'saberSlash');
}

// the blade connects: a ray of `reach` metres along the crosshair
function saberStrike(S) {
  const rt = S.sim;
  const p = S.player;
  const reach = WEAPONS.saberReach * p.mods.saberReach;
  _m.copy(p.position).addScaledVector(_f, 4);
  _e.copy(_m).addScaledVector(_f, reach);
  const dmg = WEAPONS.saberDamage * p.mods.saberDamage;
  let hitAny = false;
  for (const s of rt.targets) {
    if (!s.alive || s.dead) continue;
    const rad = s.radius;
    if (segDist2(_m, _e, s.position) > rad * rad) continue;
    hitAny = true;
    // hit point: the closest point of the blade line to the ship centre
    _d.copy(s.position).sub(_m);
    const t = clamp(_d.dot(_f), 0, reach);
    _s.copy(_m).addScaledVector(_f, t);
    pushEvent(S, 'saberHit', { id: s.id });
    hitTarget(S, s, dmg, _s, 2, 'saber', _m, _f, reach);
  }
  // the blade cuts enemy missiles in reach
  for (const e of S.entities) {
    if (!e.alive || e.type !== 'missile' || e.faction === 'ally') continue;
    const rad = e.radius + WEAPONS.missileHitBonus.saber;
    if (segDist2(_m, _e, e.position) <= rad * rad) {
      hitAny = true;
      pushEvent(S, 'saberHit', { id: e.id });
      shootDownMissile(S, e, 1e6);
    }
  }
  rt.saberHit = hitAny;
}

function stepSaber(S, dt, wantSlash, usable) {
  const sb = S.player.weapons.saber;
  if (sb.cooldown > 0) sb.cooldown = Math.max(0, sb.cooldown - dt);
  if (sb.slash > 0) {
    const before = sb.slash;
    sb.slash += dt / WEAPONS.saberSwing;
    if (before < WEAPONS.saberHitAt && sb.slash >= WEAPONS.saberHitAt) saberStrike(S);
    if (sb.slash >= 1) { sb.slash = 0; sb.cooldown = WEAPONS.saberCooldown; }
  } else if (wantSlash && usable && sb.cooldown <= 0) {
    startSlash(S);
  }
}

// ---- weapon select / shield / reload -------------------------------------------------------
function selectWeapon(S, sel) {
  const p = S.player;
  const w = p.weapons;
  if (!sel) return;
  const want = sel === 'toggle' ? (w.active === 'rifle' ? 'saber' : 'rifle') : sel;
  if (want !== 'rifle' && want !== 'saber') return;
  if (want === w.active) return;
  if (w.saber.slash > 0) return; // cannot swap mid-swing
  if (want === 'saber') {
    if (p.flightMode !== 'hover' || p.flightTransition.state !== 'idle') {
      raiseAlert(S, 'sabernope', 'SABER UNAVAILABLE IN FLIGHT FORM', 'caution', 1.5);
      return;
    }
    if (!p.mods.saberOk) {
      raiseAlert(S, 'sabernope', 'SABER LOST', 'caution', 1.5);
      return;
    }
  }
  w.active = want;
  pushEvent(S, 'weaponSwap', { active: want });
}

// Shield: hold B. Needs the L-arm, hover form, no transformation. Raises in 0.3 s (0.6 s with a damaged arm).
export function stepShield(S, dt, canAct) {
  const rt = S.sim;
  const p = S.player;
  const sh = p.shield;
  const want = canAct && S.input.shield && p.suit !== 'penelope'; // CR-003: the Penelope carries no shield
  if (want && (p.flightMode !== 'hover' || p.flightTransition.state !== 'idle')) {
    raiseAlert(S, 'shieldnope', 'SHIELD UNAVAILABLE IN FLIGHT FORM', 'caution', 0.5);
  } else if (want && !p.mods.shieldOk) {
    raiseAlert(S, 'shieldlost', 'SHIELD LOST', 'caution', 0.5);
  }
  rt.prevShieldKey = want;
  const up = want && p.mods.shieldOk && p.flightMode === 'hover' && p.flightTransition.state === 'idle';
  if (up !== sh.up) {
    sh.up = up;
    pushEvent(S, up ? 'shieldUp' : 'shieldDown');
  }
  const raiseT = SHIELD.raise * p.mods.shieldRaise;
  if (sh.up) sh.raise = Math.min(1, sh.raise + dt / raiseT);
  else sh.raise = Math.max(0, sh.raise - dt / SHIELD.lower);
}

export function stepWeapons(S, dt, canAct, att) {
  const rt = S.sim;
  const p = S.player;
  const inp = S.input;
  const w = p.weapons;
  const r = w.rifle;
  const mods = p.mods;
  axes(p);

  // timers that always run
  if (r.cooldown > 0) r.cooldown = Math.max(0, r.cooldown - dt);
  if (r.reloading) {
    r.reload = Math.min(1, r.reload + dt / WEAPONS.rifleReload);
    if (r.reload >= 1) {
      r.reloading = false;
      r.reload = 0;
      r.shots = r.perPack;
      pushEvent(S, 'reloadEnd');
    }
  }
  if (rt.funnelCd > 0) rt.funnelCd -= dt;
  if (w.funnel.count < w.funnel.max && mods.funnelOk) {
    rt.funnelRegen += dt * mods.funnelRegen;
    if (rt.funnelRegen >= WEAPONS.funnelRegenSeconds) { rt.funnelRegen = 0; w.funnel.count++; }
  } else rt.funnelRegen = 0;

  const trigger = !!inp.triggerFull;
  const trigEdge = trigger && !rt.prevTrigger;
  rt.prevTrigger = trigger;

  if (!canAct || att < 0.3) return;

  selectWeapon(S, inp.weaponSelect);
  const locked = p.weaponsLocked;
  const shieldUp = p.shield.up;
  // CR-004: rifle, funnels and saber are locked while the hatch is not sealed (vulcans still work)
  const hatchOpen = !p.hatch.locked;

  if (inp.reload && !locked && mods.rifleOk) startReload(S, false);

  // left mouse: rifle shot, or saber slash
  const gate = !locked && !shieldUp && !hatchOpen;
  if (hatchOpen && trigger && w.saber.slash <= 0) raiseAlert(S, 'hatchwpn', 'HATCH OPEN — WEAPONS LOCKED', 'caution', 1.2);
  if (w.active === 'rifle') {
    if (trigger && gate && mods.rifleOk) {
      if (r.reloading || r.shots <= 0) {
        if (trigEdge) pushEvent(S, 'rifleEmpty');
        if (!r.reloading && r.shots <= 0) startReload(S, true);
      } else if (r.cooldown <= 0) fireRifle(S);
    }
    stepSaber(S, dt, false, false);
  } else {
    stepSaber(S, dt, trigger, gate && mods.saberOk);
  }

  // right mouse: vulcan (allowed with the shield up; not in a transformation)
  if (inp.secondary && !locked && mods.vulcanOk && w.vulcan.ammo > 0) {
    rt.vulcanT += dt;
    const period = 1 / WEAPONS.vulcanRate;
    while (rt.vulcanT >= period && w.vulcan.ammo > 0) {
      rt.vulcanT -= period;
      fireVulcanRound(S);
    }
  } else rt.vulcanT = Math.min(rt.vulcanT, 0);

  if (inp.funnel) {
    if (locked) { /* no weapons during a transformation */ }
    else if (hatchOpen) raiseAlert(S, 'hatchwpn', 'HATCH OPEN — WEAPONS LOCKED', 'caution', 1.2);
    else if (!mods.funnelOk) raiseAlert(S, 'funnellost', 'FUNNEL LOST', 'caution', 1);
    else launchFunnels(S);
  }
  if (inp.flare) deployFlare(S);
}
