// Projectiles: beams, tracers, missiles, funnels, flares. Movement, homing, collisions.
import { hasLand, groundAt } from './terrain.js';
import * as THREE from 'three';
import { ENEMY, DAMAGE, WEAPONS, ENEMY_PARTS } from './tuning.js';
import {
  pushEvent, segDist2, rotateToward, lookQuat, makeEntity, getEntity, clamp,
} from './util.js';
import { hitEnemy, hitTarget } from './enemies.js';
import { damagePlayer } from './damage.js';
import { seawrackHit } from './missions/seawrack.js';

const _p0 = new THREE.Vector3();
const _d = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _tv = new THREE.Vector3();
const _n = new THREE.Vector3();
const _rd = new THREE.Vector3();

function explode(S, e, size) {
  pushEvent(S, 'explosion', { position: e.position.clone(), size });
  e.alive = false;
}

// CR-002 item 10: an enemy missile takes damage from vulcan tracers, beams and the saber.
// Returns true when it was destroyed.
export function shootDownMissile(S, m, dmg) {
  if (!m.alive) return false;
  m.hp -= dmg;
  if (m.hp > 0) return false;
  pushEvent(S, 'missileShotDown', { id: m.id, position: m.position.clone() });
  explode(S, m, 1);
  if (m.sim.mirror) S.sim.netShotDown(m); // CR-003: tell the missile's owner
  return true;
}

// returns the position/velocity of whatever a homing missile is chasing, or false
function resolveTarget(S, e) {
  const p = S.player;
  if (e.targetId === 'player') {
    _tp.copy(p.position);
    _tv.copy(p.velocity);
    return true;
  }
  const t = getEntity(S, e.targetId);
  if (!t || t.dead) return false;
  _tp.copy(t.position);
  _tv.copy(t.velocity);
  return true;
}

function homing(S, e, dt, speedMaxScale) {
  const ai = e.sim;
  const v = e.velocity;
  let sp = v.length();
  sp = Math.min(sp + ai.accel * dt, ai.speedMax * (speedMaxScale || 1));
  if (sp > 1e-6) v.setLength(sp);
  if (!ai.lost) {
    _d.copy(_tp).sub(e.position);
    const dist = _d.length() || 1;
    const t = Math.min(dist / Math.max(sp, 1), 2.5);
    _d.copy(_tp).addScaledVector(_tv, t * 0.7).sub(e.position).normalize();
    rotateToward(v, _d, ai.turn * dt);
  }
  if (sp > 1) {
    _n.copy(v).divideScalar(sp);
    lookQuat(e.quaternion, _n);
  }
}

function stepEnemyMissile(S, e, dt) {
  const rt = S.sim;
  const p = S.player;
  const ai = e.sim;
  if (ai.mirror) return; // CR-003: positioned from snapshots
  // target (a remote pilot) gone: an AI missile aimed at someone else never reacquires this pilot
  if (!ai.lost && ai.victim !== undefined && ai.victim !== rt.nt.selfId && e.targetId !== 'player') {
    const tt = getEntity(S, e.targetId);
    if (!tt || tt.dead) { ai.lost = true; e.ttl = Math.min(e.ttl, 2.5); e.targetId = null; }
  }
  // flare died or was never there: reacquire the pilot if still in the seeker cone
  if (!ai.lost && e.targetId !== 'player' && e.targetId !== null && !getEntity(S, e.targetId) && (ai.victim === undefined || ai.victim === rt.nt.selfId)) {
    _d.copy(p.position).sub(e.position);
    const dist = _d.length();
    const cos = _d.dot(e.velocity) / (dist * (e.velocity.length() || 1) || 1);
    if (dist < 2500 && cos > 0.3 && rt.rng.chance(0.5) && S.phase === 'flight') e.targetId = 'player';
    else { ai.lost = true; e.ttl = Math.min(e.ttl, 2.5); e.targetId = null; }
  }
  if (e.targetId === null || !resolveTarget(S, e)) { ai.lost = true; homing(S, e, dt, 1); return; }
  homing(S, e, dt, 1);
}

function stepFunnel(S, e, dt) {
  const rt = S.sim;
  const ai = e.sim;
  let t = getEntity(S, e.targetId);
  if (!t) {
    // retarget nearest living enemy in a wide cone, otherwise burn out
    let best = null;
    let bd = 3000 * 3000;
    for (const s of rt.targets) {
      if (!s.alive) continue;
      _d.copy(s.position).sub(e.position);
      const d2 = _d.lengthSq();
      if (d2 < bd && _d.dot(e.velocity) > 0) { bd = d2; best = s; }
    }
    if (best) { e.targetId = best.id; t = best; } else { ai.lost = true; e.ttl = Math.min(e.ttl, 1.5); }
  }
  if (t) {
    _tp.copy(t.position);
    _tv.copy(t.velocity);
    ai.lost = false;
    // Penelope's decoy: burns off an incoming funnel
    if (t.type === 'penelope' && t.sim.decoyT <= 0 && t.sim.mods.decoyOk) {
      const dd = t.position.distanceTo(e.position);
      if (dd < 650) {
        t.sim.decoyT = ENEMY.penelope.decoyCooldown * t.sim.mods.decoyCd;
        if (rt.rng.chance(ENEMY.penelope.decoyChance)) {
          explode(S, e, 1);
          return;
        }
      }
    }
  }
  homing(S, e, dt, 1);
}

function stepFlare(S, e, dt) {
  e.velocity.multiplyScalar(Math.exp(-0.5 * dt));
  e.velocity.y -= 4.9 * dt;
  e.heat = clamp(0.35 + 0.65 * (e.ttl / 5), 0, 1);
}

export function stepProjectiles(S, dt) {
  const rt = S.sim;
  const p = S.player;
  const list = S.entities;
  const ships = rt.ships;
  const targets = rt.targets;
  const hostile = S.phase === 'flight' || S.phase === 'disabled';
  const land = hasLand(S);

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    const type = e.type;
    if (type === 'gustav' || type === 'penelope' || type === 'remote' || type === 'gawman') continue; // gawman: moved by sim/missions

    if (type === 'missile') stepEnemyMissile(S, e, dt);
    else if (type === 'funnelMissile') stepFunnel(S, e, dt);
    else if (type === 'flare') stepFlare(S, e, dt);
    if (!e.alive) continue;

    _p0.copy(e.position);
    e.position.addScaledVector(e.velocity, dt);
    e.ttl -= dt;
    if (e.ttl <= 0) {
      if (type === 'missile' || type === 'funnelMissile') explode(S, e, 1);
      else e.alive = false;
      continue;
    }
    if (e.position.y <= (land ? groundAt(S, e.position.x, e.position.z) : 0)) {   // Chapter 3: hills stop shots too
      if (type === 'missile' || type === 'funnelMissile') explode(S, e, 1);
      else e.alive = false;
      continue;
    }

    if (e.faction === 'player') {
      if (type === 'flare') continue;
      // vs enemy ships
      for (let k = 0; k < targets.length; k++) {
        const s = targets[k];
        if (!s.alive || s.dead) continue;
        const r = s.radius + (type === 'tracer' ? 0 : type === 'beam' ? WEAPONS.beamHitBonus : 6);
        if (segDist2(_p0, e.position, s.position) <= r * r) {
          const big = type === 'beam' || type === 'funnelMissile';
          // the shot is a ray along its velocity, long enough to reach the ship's body (picks the part)
          _rd.copy(e.velocity);
          const sl = _rd.length() || 1;
          _rd.divideScalar(sl);
          const rl = _p0.distanceTo(e.position) + 3 * s.radius;
          const src = e.sim && e.sim.ally ? 'ally' : type === 'beam' ? 'beam' : type === 'tracer' ? 'vulcan' : 'funnel';   // Chapter 3 rebels
          hitTarget(S, s, e.sim.dmg, e.position, type === 'beam' ? 2 : big ? 1 : 0, src, _p0, _rd, rl);
          e.alive = false;
          break;
        }
      }
      // vulcan tracers and beams shoot down enemy missiles
      if (e.alive && (type === 'tracer' || type === 'beam')) {
        const bonus = type === 'beam' ? WEAPONS.missileHitBonus.beam : WEAPONS.missileHitBonus.tracer;
        for (let k = 0; k < list.length; k++) {
          const m = list[k];
          if (!m.alive || m.type !== 'missile' || m.faction === 'ally') continue;
          const r = m.radius + bonus;
          if (segDist2(_p0, e.position, m.position) <= r * r) {
            shootDownMissile(S, m, e.sim.dmg);
            if (type === 'tracer') { e.alive = false; break; }
          }
        }
      }
    } else if (hostile) {
      // CR-003: a shot aimed at someone else (or a remote pilot's shot: that hit arrives as a message) cannot hurt this pilot
      if (e.sim.victim !== undefined && e.sim.victim !== rt.nt.selfId) continue;
      // CR-013: a strike-group beam aimed at Seawrack
      if (e.targetId === 'seawrack') { if (seawrackHit(S, _p0, e.position, _d)) e.alive = false; continue; }
      // enemy projectiles vs flares (missiles only), then the player
      if (type === 'missile') {
        const tgt = e.targetId !== 'player' ? getEntity(S, e.targetId) : null;
        if (tgt && tgt.type === 'flare' && segDist2(_p0, e.position, tgt.position) <= ENEMY.missile.fuse * ENEMY.missile.fuse) {
          tgt.alive = false;
          explode(S, e, 2);
          continue;
        }
      }
      const r = type === 'missile' ? ENEMY.missile.fuse : DAMAGE.playerRadius + (type === 'beam' ? e.radius : 0);
      // evaluate in the player's frame so fast mutual motion cannot tunnel
      _d.copy(p.position).addScaledVector(p.velocity, -dt);
      if (segDist2(_p0, e.position, p.position) <= r * r || segDist2(_p0, e.position, _d) <= r * r) {
        _n.copy(e.velocity);
        if (type === 'missile') {
          _n.copy(e.position).sub(p.position);
        } else {
          _n.negate();
        }
        if (_n.lengthSq() < 1e-9) _n.set(0, 0, -1);
        _n.normalize();
        if (rt.netOn) rt.nt.lastHit = { by: 'ai', w: type === 'missile' ? 'missile' : 'ai' };
        damagePlayer(S, e.sim.dmg, _n);
        if (type === 'missile') { explode(S, e, 2); if (e.sim.mirror) rt.netShotDown(e); }
        else {
          pushEvent(S, 'explosion', { position: p.position.clone().addScaledVector(_n, 8), size: type === 'beam' && e.power >= 1 ? 2 : 1 });
          e.alive = false;
        }
      }
    }
  }

  // ram: an enemy suit that touches the player
  if (hostile && S.phase === 'flight') {
    for (const s of ships) {
      if (!s.alive || (rt.netOn && s.sim.tgt !== p)) continue;
      if (s.sim.ramCd > 0) { s.sim.ramCd -= dt; continue; }
      if (s.position.distanceTo(p.position) < s.radius + 12) {
        s.sim.ramCd = 2;
        _n.copy(s.position).sub(p.position).normalize();
        if (rt.netOn) rt.nt.lastHit = { by: 'ai', w: 'ai' };
        damagePlayer(S, s.sim.state === 'ram' ? ENEMY_PARTS.ramDamage : DAMAGE.ramDamage, _n);
        pushEvent(S, 'explosion', { position: s.position.clone(), size: 2 });
        hitEnemy(S, s, 60, null, 0);
        if (s.alive && s.sim.state !== 'ram' && s.sim.state !== 'flee') { s.sim.state = 'break'; s.sim.t = 2.5; }
      }
    }
  }
}

// remove dead / expired entities (order preserved)
export function cleanupEntities(S) {
  const rt = S.sim;
  const list = S.entities;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.alive) list[w++] = e;
    else rt.byId.delete(e.id);
  }
  list.length = w;
}

export function updateThreat(S) {
  const p = S.player;
  const inc = p.threat.incoming;
  inc.length = 0;
  let near = Infinity;
  let inbound = false;
  for (const e of S.entities) {
    if (!e.alive || e.type !== 'missile' || e.targetId !== 'player') continue;
    inbound = true;
    _d.copy(p.position).sub(e.position);
    const d = _d.length();
    if (d < near) near = d;
    // time to impact from the closing speed (Infinity while the range is opening)
    const closing = d > 1e-6 ? _n.copy(e.velocity).sub(p.velocity).dot(_d) / d : 0;
    inc.push({ id: e.id, distance: d, tti: closing > 1 ? d / closing : Infinity });
  }
  inc.sort((a, b) => a.distance - b.distance);
  p.threat.missileInbound = inbound;
  p.threat.nearestMissileDist = near;
}
