// CR-013 story Chapter 2 "Return to Seawrack". Straight on from the Chapter 1 battle (or from the saved checkpoint):
//   fly home to the carrier ship Seawrack, past three enemy radar pickets, and land on its deck.
//   - Radar: each picket covers a circle (SEAWRACK.radarRadius). Inside it and above radarFloor (or inside closeRange at
//     any height) a detection meter fills; hidden, it drains. Flight form fills it faster. A full meter = DETECTED: a pair
//     of Gustav Karls launches from that picket after the player.
//   - Seawrack is FOUND when the player is detected within foundRange of it, or a hostile gets within chaseRange of it.
//     A strike group of three Gustavs then attacks the ship (it takes shipHits beam hits); if it sinks, the chapter fails.
//   - Landing: no hostile within chaseRange of the player, no strike group alive, then hold low and slow over the deck
//     between the cranes for landTime seconds.
// Everything the render and HUD need lives in state.story (see state.js, CR-013).
import * as THREE from 'three';
import { SEAWRACK as C, PARTS } from '../tuning.js';
import { pushEvent, setMessage, raiseAlert, forwardOf } from '../util.js';
import { spawnEnemy } from '../enemies.js';
import { endMission } from '../damage.js';
import { resetHatch } from '../hatch.js';
import { ABOARD as A } from '../tuning.js';
import { beginAboard } from './aboard.js';

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();

export const isChapter2 = (S) => !!(S.story && S.story.chapter === 2);

// what a checkpoint keeps of the Xi (the lobby stores it in the browser). Chapter 1 takes one too, when the Penelope
// arrives (sim/missions/lane.js).
function capture(S, chapter = 2) {
  const p = S.player, w = p.weapons;
  const parts = {};
  for (const [k, v] of Object.entries(p.parts)) parts[k] = v.hp;
  return { v: 1, chapter, hull: p.hull, parts, funnel: w.funnel.count, vulcan: w.vulcan.ammo, flares: w.flares.count,
    minovsky: S.world.minovskyDensity, kills: S.mission.kills || 0 };
}
function restore(S, ck) {
  const p = S.player, w = p.weapons;
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  p.hull = Math.max(C.minHull, Math.min(1, num(ck.hull, 1)));
  for (const [k, part] of Object.entries(p.parts)) {
    part.hp = Math.max(0, Math.min(1, num(ck.parts && ck.parts[k], 1)));
    part.status = part.hp <= 0 ? 'destroyed' : part.hp < PARTS.damagedAt ? 'damaged' : 'ok';
  }
  w.funnel.count = Math.max(0, Math.min(w.funnel.max, Math.round(num(ck.funnel, w.funnel.max))));
  w.vulcan.ammo = Math.max(0, Math.min(w.vulcan.max, Math.round(num(ck.vulcan, w.vulcan.max))));
  w.flares.count = Math.max(0, Math.min(w.flares.max, Math.round(num(ck.flares, w.flares.max))));
  S.world.minovskyDensity = Math.max(0, Math.min(1, num(ck.minovsky, S.world.minovskyDensity)));
  S.mission.kills = Math.max(0, Math.round(num(ck.kills, 0)));
}

// ship-local coordinates of a world point: x across (+ = starboard), z along (+ = bow)
export function shipLocal(ship, pos, out) {
  const dx = pos.x - ship.position.x, dz = pos.z - ship.position.z;
  const fx = Math.sin(ship.heading), fz = -Math.cos(ship.heading);   // heading 0 = sailing toward -Z
  return out.set(dx * -fz + dz * fx, pos.y - ship.position.y, dx * fx + dz * fz);
}

// Start Chapter 2. opts.checkpoint: restart from a stored checkpoint (fresh sim, phase 'startup'); otherwise the chapter
// follows the Chapter 1 battle without a break and the checkpoint is taken now.
export function beginChapter2(S, opts = {}) {
  const rt = S.sim, p = S.player, st = S.story, m = S.mission;
  const fromCk = !!opts.checkpoint || !!opts.fresh;
  if (fromCk) {
    restore(S, opts.checkpoint || {});
    p.position.set(0, C.startAlt, 0);
    p.velocity.set(0, 0, -120);
    p.quaternion.identity();
    resetHatch(S, false);
    S.startup.stage = 4; S.startup.progress = 1;
    S.phase = 'flight';
    rt.prevVel.copy(p.velocity); rt.gSm.set(0, 1, 0); rt.gSlow.set(0, 1, 0);
  }
  m.elapsed = 0;
  st.chapter = 2;
  st.stage = 'transit';
  st.t = 0;
  st.title = C.titleTime;
  m.id = 'seawrack';
  rt.missionId = 'seawrack';
  rt.waveState = 'seawrack';
  m.wave = Math.max(m.wave, 1);
  // route: from the player to Seawrack, the ship off to the right and behind
  forwardOf(p.quaternion, _f); _f.y = 0;
  if (_f.lengthSq() < 0.09) _f.set(p.velocity.x, 0, p.velocity.z);
  if (_f.lengthSq() < 0.09) _f.set(0, 0, -1);
  _f.normalize();
  _r.set(-_f.z, 0, _f.x);
  const dir = _d.copy(_f).multiplyScalar(Math.cos(C.shipBearing)).addScaledVector(_r, Math.sin(C.shipBearing)).normalize();
  const start = new THREE.Vector3(p.position.x, 0, p.position.z);
  const shipPos = start.clone().addScaledVector(dir, C.shipDistance);
  shipPos.y = 0;
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const heading = Math.atan2(side.x, -side.z);                     // sails across the route
  st.seawrack = {
    position: shipPos, velocity: new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading)).multiplyScalar(C.shipSpeed),
    heading, hits: 0, hp: 1, alive: true, found: false, sinkT: 0,
  };
  st.pickets = C.pickets.map(([t, lat], i) => ({
    id: i, position: start.clone().addScaledVector(dir, C.shipDistance * t).addScaledVector(side, lat),
    radius: C.radarRadius, floor: C.radarFloor, painted: false, sweep: i * 2.1,
  }));
  st.radar = { meter: 0, state: 'clear', cooldown: 0, alerts: 0, nearest: null };
  st.landing = { progress: 0, ready: false, blocked: null, over: false };
  st.strike = { launched: false, ids: [], cleared: false };
  st.interceptorIds = [];
  st.checkpoint = capture(S);
  pushEvent(S, 'chapterStart', { chapter: 2 });
  pushEvent(S, 'checkpoint', { chapter: 2 });
  m.objective = 'RETURN TO SEAWRACK — STAY LOW INSIDE RADAR COVER';
  setMessage(S, 'SEAWRACK: Xi, this is Seawrack. Nicely done. Come home — but three Circe pickets sit between us. Get down on the water and stay under their radar.', 9);
}

function hostileShips(S) { return S.sim.ships.filter((e) => e.alive && e.faction === 'enemy'); }

function spawnFlight(S, from, toward, n, alt, goal) {
  const ids = [];
  _d.copy(toward).sub(from); _d.y = 0;
  if (_d.lengthSq() < 1) _d.set(0, 0, -1);
  _d.normalize();
  const side = new THREE.Vector3(-_d.z, 0, _d.x);
  for (let i = 0; i < n; i++) {
    _p.copy(from).addScaledVector(side, (i - (n - 1) / 2) * 400);
    _p.y = alt + i * 120;
    const e = spawnEnemy(S, 'gustav', _p, { missiles: goal !== 'seawrack' });
    if (goal) e.sim.goal = goal;
    ids.push(e.id);
  }
  return ids;
}

function findShip(S, why) {
  const st = S.story, sw = st.seawrack;
  if (sw.found || !sw.alive) return;
  sw.found = true;
  st.stage = 'defend';
  st.landing.progress = 0;
  // the strike group comes from the nearest picket's side of the ship
  let best = st.pickets[0], bd = Infinity;
  for (const pk of st.pickets) { const d = pk.position.distanceTo(sw.position); if (d < bd) { bd = d; best = pk; } }
  _d.copy(best.position).sub(sw.position); _d.y = 0; _d.normalize();
  const from = sw.position.clone().addScaledVector(_d, C.strikeSpawnDist);
  st.strike.launched = true;
  st.strike.ids = spawnFlight(S, from, sw.position, C.strikeCount, C.strikeSpawnAlt, 'seawrack');
  pushEvent(S, 'seawrackFound', { why });
  raiseAlert(S, 'seawrack', 'SEAWRACK FOUND', 'warning', 3);
  S.mission.objective = 'DEFEND SEAWRACK — DESTROY THE STRIKE GROUP';
  setMessage(S, why === 'chase'
    ? 'SEAWRACK: You led them right to us! Gustav Karls turning for the ship — Xi, keep them off us!'
    : 'SEAWRACK: They have our position! Strike group inbound on the ship — Xi, defend us!', 8);
}

function detect(S, pk) {
  const st = S.story, p = S.player, rd = st.radar;
  rd.meter = 0;
  rd.cooldown = C.alertCooldown;
  rd.alerts++;
  pushEvent(S, 'radarDetected', { picket: pk.id });
  raiseAlert(S, 'radar', 'DETECTED', 'warning', 2.5);
  const nearShip = p.position.distanceTo(st.seawrack.position) < C.foundRange;
  if (rd.alerts <= C.maxAlerts) {
    const from = pk.position.clone().addScaledVector(_d.copy(p.position).sub(pk.position).setY(0).normalize(), C.interceptSpawnDist);
    st.interceptorIds.push(...spawnFlight(S, from, p.position, C.interceptorsPerAlert, C.interceptSpawnAlt, null));
    if (!nearShip) setMessage(S, `PICKET ${pk.id + 1} (intercepted): Contact, low and fast. Unknown suit. Scrambling Gustavs. — SEAWRACK: You've been seen, Xi. Lose them before you come home.`, 8);
  }
  if (nearShip) findShip(S, 'radar');
}

function stepRadar(S, dt) {
  const st = S.story, p = S.player, rd = st.radar;
  const alt = p.position.y;
  let k = 0, cover = false, near = null, nd = Infinity;
  for (const pk of st.pickets) {
    pk.sweep += dt * 1.4;
    const d = Math.hypot(p.position.x - pk.position.x, p.position.z - pk.position.z);
    const inside = d < pk.radius;
    const seen = inside && (alt > pk.floor || d < C.closeRange);
    pk.painted = seen;
    if (inside) cover = true;
    if (seen) { const kk = 0.5 + 0.5 * (1 - d / pk.radius); if (kk > k) k = kk; }
    if (d < nd) { nd = d; near = pk; }
  }
  rd.nearest = near ? near.id : null;
  rd.cooldown = Math.max(0, rd.cooldown - dt);
  if (k > 0 && rd.cooldown <= 0) {
    const form = p.flightMode === 'minovsky' ? C.flightFormRate : 1;
    rd.meter += (k * form * (1 - 0.4 * S.world.minovskyDensity) / C.fillTime) * dt;
  } else rd.meter -= dt / C.drainTime;
  rd.meter = Math.max(0, Math.min(1, rd.meter));
  const prev = rd.state;
  rd.state = k > 0 ? 'painted' : cover ? 'hidden' : 'clear';
  if (rd.state === 'painted' && prev !== 'painted') pushEvent(S, 'radarPaint', {});
  if (rd.state === 'painted') raiseAlert(S, 'radarpaint', 'RADAR PAINT', 'caution', 0.3);
  if (rd.meter >= 1) {
    let pk = near;
    for (const q of st.pickets) if (q.painted) { pk = q; break; }
    detect(S, pk);
  }
}

// keeps the suit out of the hull: the standing Xi's feet never sink below the deck / the superstructure roof
function stepDeck(S) {
  const sw = S.story.seawrack, p = S.player;
  if (!sw.alive) return;
  const l = shipLocal(sw, p.position, _p);
  if (Math.abs(l.x) > C.shipBeam / 2 || Math.abs(l.z) > C.shipLength / 2) return;
  const roof = Math.abs(l.z - C.bridgeZ) < C.bridgeHalf ? C.bridgeTop : Math.abs(l.z - C.portalZ) < C.portalHalf ? C.portalTop : C.deckY;
  const minY = sw.position.y + roof + C.cockpitAboveDeck;
  if (p.position.y < minY) {
    p.position.y = minY;
    if (p.velocity.y < sw.velocity.y) p.velocity.y = 0;
  }
}

function stepLanding(S, dt) {
  const st = S.story, sw = st.seawrack, p = S.player, L = st.landing;
  let blocked = null;
  if (st.strike.launched && !st.strike.cleared) blocked = 'strike';
  else for (const e of hostileShips(S)) if (e.position.distanceTo(p.position) < C.chaseRange) { blocked = 'chased'; break; }
  L.blocked = blocked;
  if (!blocked) st.waveOffSaid = false;
  // CR-014: no manual landing any more. Close enough, with nobody on your tail, the homecoming scene takes over.
  const dist = Math.hypot(p.position.x - sw.position.x, p.position.z - sw.position.z);
  L.over = false; L.ready = false;
  L.progress = Math.max(0, Math.min(1, 1 - (dist - A.homeRange) / 3000));
  if (blocked === 'chased' && dist < C.chaseRange && !st.waveOffSaid) {
    st.waveOffSaid = true;
    setMessage(S, 'SEAWRACK: Wave off, Xi! You have company — we cannot take you aboard with Gustavs on your tail.', 7);
  }
  if (!blocked && dist < 4500 && !st.approachSaid) {
    st.approachSaid = true;
    setMessage(S, 'SEAWRACK: We have you. Bring her in — the deck crew is standing by.', 7);
  }
  if (!blocked && dist < A.homeRange) {
    st.stage = 'landed';
    pushEvent(S, 'landed', {});
    beginAboard(S);
  }
}
// hit by an enemy beam aimed at the ship (sim/projectiles.js). Returns true when the segment p0->p1 touches the hull.
export function seawrackHit(S, p0, p1, dmgPos) {
  const sw = S.story && S.story.seawrack;
  if (!sw || !sw.alive) return false;
  for (const q of [p1, _r.copy(p0).lerp(p1, 0.5)]) {
    const l = shipLocal(sw, q, _p);
    const top = Math.abs(l.z - C.bridgeZ) < C.bridgeHalf ? C.bridgeTop : C.deckY + 20;
    if (Math.abs(l.x) < C.shipBeam / 2 + 6 && Math.abs(l.z) < C.shipLength / 2 + 6 && l.y > -8 && l.y < top) {
      sw.hits++;
      sw.hp = Math.max(0, 1 - sw.hits / C.shipHits);
      dmgPos.copy(q);
      pushEvent(S, 'explosion', { position: q.clone(), size: 2 });
      pushEvent(S, 'seawrackHit', { hp: sw.hp });
      if (sw.hp > 0 && sw.hp < 0.3) raiseAlert(S, 'shiphull', 'SEAWRACK HULL CRITICAL', 'warning', 0.6);
      return true;
    }
  }
  return false;
}

// target for a strike-group Gustav: the ship, unless the Xi comes close
export function strikeTarget(S, e) {
  const sw = S.story && S.story.seawrack;
  if (!sw || !sw.alive || !isChapter2(S)) return S.player;
  return e.position.distanceTo(S.player.position) < C.strikeEngagePlayer ? S.player : sw;
}

export function updateSeawrack(S, dt) {
  const st = S.story, sw = st.seawrack, m = S.mission;
  if (!sw) return;
  st.t += dt;
  st.title = Math.max(0, st.title - dt);
  m.elapsed += dt;
  sw.position.addScaledVector(sw.velocity, dt);
  if (!sw.alive) {
    sw.sinkT += dt;
    sw.position.y = -sw.sinkT * 1.5;
    return;
  }
  if (sw.hp <= 0) {
    sw.alive = false;
    st.stage = 'lost';
    pushEvent(S, 'seawrackLost', { position: sw.position.clone() });
    for (let i = 0; i < 4; i++) pushEvent(S, 'explosion', { position: sw.position.clone().add(new THREE.Vector3(0, 30, (i - 1.5) * 60)), size: 3 });
    S.phase = 'failed';
    endMission(S, false);
    m.result.reason = 'seawrack';
    m.result.detections = st.radar.alerts;
    m.objective = 'SEAWRACK LOST';
    setMessage(S, 'SEAWRACK: Fire in the hold — we are going down... Xi... get clear...', 9999);
    return;
  }
  if (st.stage !== 'landed') {
    stepRadar(S, dt);
    // a hostile closing on the ship finds it
    if (!sw.found) for (const e of hostileShips(S)) if (e.position.distanceTo(sw.position) < C.chaseRange) { findShip(S, 'chase'); break; }
    if (st.strike.launched && !st.strike.cleared) {
      const left = st.strike.ids.filter((id) => { const e = S.sim.byId.get(id); return e && e.alive; }).length;
      m.objective = `DEFEND SEAWRACK — ${left} LEFT  |  SHIP HULL ${Math.round(sw.hp * 100)}%`;
      if (left === 0) {
        st.strike.cleared = true;
        st.stage = 'transit';
        st.approachSaid = false;
        pushEvent(S, 'strikeCleared', {});
        setMessage(S, 'SEAWRACK: That is the last of them. Bring her in, Xi.', 7);
      }
    } else {
      const d = S.player.position.distanceTo(sw.position);
      const low = st.radar.state === 'painted' ? 'GET LOW' : st.radar.state === 'hidden' ? 'UNDER RADAR' : 'CLEAR';
      m.objective = st.landing.blocked === 'chased'
        ? 'LOSE THE INTERCEPTORS BEFORE LANDING'
        : d < 3000 ? 'LAND ON THE MARKED DECK — LOW AND SLOW' : `RETURN TO SEAWRACK ${(d / 1000).toFixed(1)} KM  |  ${low}`;
    }
    stepDeck(S);
    stepLanding(S, dt);
  }
}

export { capture as captureCheckpoint, restore as restoreCheckpoint };
