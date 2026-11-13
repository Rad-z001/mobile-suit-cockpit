// Story Chapter 3 "Oenbili" (owner, 2026-11-12/13). setup.mission 'story3' (from the start) | 'story3c' (RETRY: from the
// checkpoint taken once the Xi is out of the hold). mission.id 'oenpeli', rt.waveState 'oenbili', story.chapter 3.
//   'hold' / 'board'  on foot in hold two, the gantry to the Xi (sim/missions/aboard.js beginLaunchWalk)
//   'cockpit'         the seated cold start in the closed hold (phase 'startup', sim/mission.js; syncHold keeps it aboard)
//   'launch'          the gantry retracts, the covers open and the Xi rises out of the hold (scripted; phase 'flight')
//   'transit'         fly south-east to the coast (waypoint)
//   'intercept'       a Circe patrol of Gustav Karls comes out over the coast: shoot them down
//   'search'          follow the rebels' faint signal into the stone country (signal meter, no exact position)
//   'approach'        they show themselves: land on their pad (low, slow, held), no hostiles close
//   'landed'          parked on the pad (rt.parked: no flying, no weapons), the leader talks (state.story.talk)
//   'defend'          the last Circe wave; the rebels' suits fly with the Xi (neutral entities flown here, their beams
//                     hit through the player branch of stepProjectiles); all hostiles down -> 'won' -> victory
// Ground heights come from sim/terrain.js. state.story.ob is the chapter's HUD-facing state (see state.js).
import * as THREE from 'three';
import { OENBILI as C, SEAWRACK as SW, WEAPONS } from '../tuning.js';
import { pushEvent, setMessage, forwardOf, makeEntity, orientShip, lookQuat } from '../util.js';
import { spawnEnemy } from '../enemies.js';
import { endMission } from '../damage.js';
import { resetHatch } from '../hatch.js';
import { beginLaunchWalk, SUIT_COCKPIT, shipToWorld } from './aboard.js';
import { captureCheckpoint, restoreCheckpoint } from './seawrack.js';
import { groundAt } from '../terrain.js';
import { LEADER, PLACE } from './oenbiliScript.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const ease = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

export const isChapter3 = (S) => !!(S.story && S.story.chapter === 3);

// the pad, at the ground height of the land (flat sea until terrain is loaded)
function padOf(S) {
  const [x, z] = C.base;
  return { x, z, y: groundAt(S, x, z), r: C.padRadius };
}

function newShip(S) {
  const h = C.shipHeading;
  return {
    position: new THREE.Vector3(C.ship[0], 0, C.ship[1]),
    velocity: new THREE.Vector3(Math.sin(h), 0, -Math.cos(h)).multiplyScalar(SW.shipSpeed),
    heading: h, hits: 0, hp: 1, alive: true, found: false, sinkT: 0,
  };
}

// Start Chapter 3. opts.checkpoint / opts.fresh: RETRY - straight into flight just above Seawrack (no walk, no cold start).
export function beginOenbili(S, opts = {}) {
  const rt = S.sim, st = S.story, m = S.mission;
  st.chapter = 3;
  m.id = 'oenpeli'; rt.missionId = 'oenpeli'; rt.waveState = 'oenbili';
  S.world.night = false;
  S.world.terrain = 'oenbili';
  st.seawrack = newShip(S);
  st.pickets = [];
  st.codex = st.codex || [];
  st.launch = null;
  st.ob = {
    t: 0, pad: padOf(S), interceptIds: [], waveIds: [], allyIds: [], signal: 0, revealed: false,
    landing: { progress: 0, ready: false, over: false, blocked: null },
    waypoint: null, said: {}, wonT: 0,
  };
  rt.parked = false;
  m.wave = 0; m.kills = m.kills || 0;
  if (opts.checkpoint || opts.fresh) { startFromCheckpoint(S, opts.checkpoint || {}); return; }
  rt.launchWalkDone = false;
  beginLaunchWalk(S);
  setMessage(S, 'SEAWRACK PA: Pilot to hold two. The Xi is fuelled and warm.', 6);
  pushEvent(S, 'chapterStart', { chapter: 3 });
}

function startFromCheckpoint(S, ck) {
  const rt = S.sim, p = S.player, st = S.story, sw = st.seawrack;
  restoreCheckpoint(S, ck);
  rt.boardDone = true; rt.launchWalkDone = true;
  shipToWorld(sw, _a.set(0, SUIT_COCKPIT[1] + C.riseTo, SUIT_COCKPIT[2]), p.position);
  p.velocity.copy(sw.velocity);
  p.quaternion.setFromAxisAngle(_up, -sw.heading);
  resetHatch(S, false);
  S.startup.stage = 4; S.startup.progress = 1;
  S.phase = 'flight';
  rt.prevVel.copy(p.velocity); rt.gSm.set(0, 1, 0); rt.gSlow.set(0, 1, 0);
  st.launch = { t: 99, retract: 1, open: 0, rise: C.riseTo, out: true, closeT: 99 };
  st.gantry = 0;
  toTransit(S, true);
}

// the cold start's last stage: the gantry pulls back, the hold opens, go (called from sim/mission.js beginFlight)
export function beginLaunch(S) {
  const st = S.story, p = S.player;
  st.stage = 'launch';
  st.launch = { t: 0, retract: 0, open: 0, rise: 0, out: false, closeT: 0, said: false };
  st.gantry = 1;
  p.weaponsLocked = true;
  S.mission.objective = '';
  pushEvent(S, 'launch');
  setMessage(S, 'DECK CHIEF: Gantry coming back. Covers next — hold her steady.', 4);
}

function stepLaunch(S, dt) {
  const rt = S.sim, p = S.player, st = S.story, sw = st.seawrack, L = st.launch;
  L.t += dt;
  // owner: the gantry visibly retracts to the forward bulkhead first; the covers open once it is back
  L.retract = ease(L.t / C.retractTime);
  st.gantry = 1 - L.retract;
  const t = L.t - C.retractTime;
  if (t >= 0 && !L.said) { L.said = true; setMessage(S, 'SEAWRACK: Covers opening. Straight up, Xi — and come home with friends.', 6); }
  L.open = t > 0 ? ease(t / C.openTime) : 0;
  const up = t > C.riseDelay ? C.riseSpeed * ease((t - C.riseDelay) / 1.2) : 0;
  L.rise = Math.min(C.riseTo, L.rise + up * dt);
  shipToWorld(sw, _a.set(0, SUIT_COCKPIT[1] + L.rise, SUIT_COCKPIT[2]), p.position);
  p.velocity.copy(sw.velocity).addScaledVector(_up, up);
  p.quaternion.setFromAxisAngle(_up, -sw.heading);
  p.speed = p.velocity.length();
  rt.prevVel.copy(p.velocity);                              // a scripted climb, not a G spike
  if (L.rise >= C.riseTo) {
    L.out = true; L.closeT = 0;
    p.weaponsLocked = false;
    toTransit(S, false);
  }
}

function toTransit(S, restart) {
  const st = S.story, ob = st.ob;
  st.stage = 'transit';
  st.title = C.titleTime;
  st.checkpoint = captureCheckpoint(S, 3);
  pushEvent(S, 'checkpoint', { chapter: 3 });
  ob.waypoint = { x: C.coast[0], z: C.coast[1], label: 'COAST' };
  S.mission.objective = `FLY TO ${PLACE.toUpperCase()} — THE COAST TO THE SOUTH-EAST`;
  setMessage(S, restart
    ? `SEAWRACK: You are clear of the ship. ${PLACE} is south-east, past the river mouths. Watch the coast.`
    : `IRAM: Clear of the deck. ${PLACE} is south-east, past the river mouths. Circe patrols that coast — expect company.`, 8);
}

// ---- interception and the last wave --------------------------------------------------------------------------------
function spawnGroup(S, n, from, dist, alt) {
  const p = S.player, ids = [];
  _d.set(from[0] - p.position.x, 0, from[1] - p.position.z);
  if (_d.lengthSq() < 1) _d.set(0, 0, -1);
  _d.normalize();
  _b.set(-_d.z, 0, _d.x);
  for (let i = 0; i < n; i++) {
    _a.copy(p.position).addScaledVector(_d, dist).addScaledVector(_b, (i - (n - 1) / 2) * 700);
    const tr = Math.hypot(_a.x, _a.z);                       // never spawn near the town
    if (tr < C.spawnClear) { const k = C.spawnClear / Math.max(1, tr); _a.x *= k; _a.z *= k; }
    _a.y = Math.max(alt, groundAt(S, _a.x, _a.z) + 700) + i * 90;
    const e = spawnEnemy(S, 'gustav', _a, { missiles: i % 2 === 0 });
    ids.push(e.id);
  }
  return ids;
}
const alive = (S, ids) => ids.filter((id) => { const e = S.entities.find((q) => q.id === id); return e && e.alive; });

// The town is a real community: Circe's machines are turned away from it (a soft push outward inside townClear)
function keepClearOfTown(S, dt) {
  for (const e of S.sim.ships) {
    if (!e.alive || e.faction !== 'enemy') continue;
    const r = Math.hypot(e.position.x, e.position.z);
    if (r >= C.townClear || r < 1) continue;
    const k = (C.townClear - r) / C.townClear;
    const ux = e.position.x / r, uz = e.position.z / r;
    e.velocity.x += ux * 120 * k * dt * 4; e.velocity.z += uz * 120 * k * dt * 4;
    e.position.x += ux * 60 * k * dt; e.position.z += uz * 60 * k * dt;
  }
}

// ---- the signal and the pad ----------------------------------------------------------------------------------------
function horiz(p, x, z) { return Math.hypot(p.position.x - x, p.position.z - z); }

function stepPad(S, dt) {
  const p = S.player, ob = S.story.ob, pad = ob.pad, L = ob.landing;
  const near = S.sim.ships.some((e) => e.alive && e.faction === 'enemy' && e.position.distanceTo(p.position) < C.chaseRange);
  const d = horiz(p, pad.x, pad.z);
  const h = p.position.y - (pad.y + SW.cockpitAboveDeck);
  L.over = d < pad.r;
  L.blocked = near ? 'chased' : null;
  L.ready = !near && L.over && h < C.landHeight && p.velocity.length() < C.landSpeed;
  L.progress = L.ready ? Math.min(1, L.progress + dt / C.landTime) : Math.max(0, L.progress - dt / C.landTime);
  if (near) S.mission.objective = 'HOSTILES CLOSE — NO LANDING';
  else if (d > 600) S.mission.objective = `LAND ON THE PAD — ${Math.round(d)} M`;
  else if (!L.over) S.mission.objective = 'LAND ON THE PAD — OVER THE GREEN SMOKE';
  else if (h >= C.landHeight) S.mission.objective = 'LAND ON THE PAD — LOWER';
  else if (p.velocity.length() >= C.landSpeed) S.mission.objective = 'LAND ON THE PAD — SLOWER';
  else S.mission.objective = `HOLD IT THERE — ${Math.round(L.progress * 100)}%`;
  return L.progress >= 1;
}

// parked on the pad: the cockpit sits at pad + cockpitAboveDeck; the flight model gets no input (sim/flight.js rt.parked)
function park(S) {
  const p = S.player, pad = S.story.ob.pad;
  p.position.x += (pad.x - p.position.x) * 0.2;
  p.position.z += (pad.z - p.position.z) * 0.2;
  p.position.y = pad.y + SW.cockpitAboveDeck;
  p.velocity.set(0, 0, 0);
  p.speed = 0;
  S.sim.prevVel.set(0, 0, 0);
}

// ---- the rebels' suits ---------------------------------------------------------------------------------------------
function spawnAllies(S) {
  const ob = S.story.ob, pad = ob.pad;
  const names = ['BILI-1', 'BILI-2', 'BILI-3'];
  C.allies.forEach(([ox, oz], i) => {
    _a.set(pad.x + ox, 0, pad.z + oz);
    _a.y = groundAt(S, _a.x, _a.z) + 30;
    const e = spawnEnemy(S, 'gustav', _a, { missiles: false });
    e.faction = 'neutral';                     // never a target, never hostile AI (sensors.js); flown by stepAllies
    e.name = names[i];
    e.paint = 'rebel';                         // render: their own faded olive paint (render/entities.js)
    e.state = 'parked';
    e.velocity.set(0, 0, 0);
    e.sim.ally = { fireT: 1 + i * 0.7, tgt: null, slot: i, up: false };
    ob.allyIds.push(e.id);
  });
}
function fireAllyBeam(S, e, tg) {
  const rt = S.sim;
  _d.copy(tg.position).addScaledVector(tg.velocity, e.position.distanceTo(tg.position) / WEAPONS.beamSpeed).sub(e.position).normalize();
  if (rt.rng.next() > C.allyAccuracy) { _a.set(rt.rng.range(-1, 1), rt.rng.range(-1, 1), rt.rng.range(-1, 1)).multiplyScalar(0.08); _d.add(_a).normalize(); }
  const b = makeEntity(S, { type: 'beam', faction: 'player', name: 'ALLY BEAM', radius: WEAPONS.beamRadius, hp: 1, heat: 1, ttl: WEAPONS.beamTtl, targetId: null, power: 0.8 });
  b.position.copy(e.position).addScaledVector(_d, 30);
  b.velocity.copy(_d).multiplyScalar(WEAPONS.beamSpeed);
  lookQuat(b.quaternion, _d);
  b.sim = { dmg: C.allyDamage, ally: true };
  pushEvent(S, 'allyFire', { id: e.id });
}
function stepAllies(S, dt) {
  const ob = S.story.ob, p = S.player, rt = S.sim;
  // they guard the Xi: only Gustavs that come close to it are theirs to chase (the Xi has to fight the wave itself)
  const enemies = S.sim.ships.filter((q) => q.alive && q.faction === 'enemy' && q.position.distanceTo(p.position) < C.allyGuard);
  for (const id of ob.allyIds) {
    const e = S.entities.find((q) => q.id === id);
    if (!e || !e.alive) continue;
    const a = e.sim.ally;
    if (S.story.stage !== 'defend' && S.story.stage !== 'won') {   // parked on the ground at the pad
      e.velocity.set(0, 0, 0);
      continue;
    }
    // pick the nearest enemy (sticky until it dies), else hold a slot off the Xi's wing
    if (!a.tgt || !a.tgt.alive) a.tgt = enemies.length ? enemies.reduce((b2, q) => (q.position.distanceTo(e.position) < b2.position.distanceTo(e.position) ? q : b2)) : null;
    if (a.tgt) {
      _d.copy(e.position).sub(a.tgt.position); _d.y = 0;
      if (_d.lengthSq() < 1) _d.set(1, 0, 0);
      _d.normalize();
      _b.copy(a.tgt.position).addScaledVector(_d, C.allyStandoff);
      _b.y = Math.max(a.tgt.position.y - 150, groundAt(S, _b.x, _b.z) + 250);
    } else {
      forwardOf(p.quaternion, _d); _d.y = 0; if (_d.lengthSq() < 0.01) _d.set(0, 0, -1); _d.normalize();
      _a.set(-_d.z, 0, _d.x);
      _b.copy(p.position).addScaledVector(_a, (a.slot - 1) * 220 || 160).addScaledVector(_d, -180);
      _b.y = Math.max(p.position.y - 40, groundAt(S, _b.x, _b.z) + 200);
    }
    _a.copy(_b).sub(e.position);
    const want = _a.clampLength(0, 210);                       // m/s: an old Gustav on a sled
    e.velocity.lerp(want, 1 - Math.exp(-1.2 * dt));
    e.position.addScaledVector(e.velocity, dt);
    const gy = groundAt(S, e.position.x, e.position.z) + 25;
    if (e.position.y < gy) { e.position.y = gy; e.velocity.y = Math.max(0, e.velocity.y); }
    if (e.velocity.lengthSq() > 25) orientShip(e, _a.copy(e.velocity).normalize(), 3 * dt, dt);
    e.state = a.tgt ? 'attack' : 'escort';
    a.fireT -= dt;
    if (a.tgt && !enemies.includes(a.tgt)) a.tgt = null;   // it drew off from the Xi: back to escort
    if (a.tgt && a.fireT <= 0 && e.position.distanceTo(a.tgt.position) < C.allyRange) {
      fireAllyBeam(S, e, a.tgt);
      a.fireT = rt.rng.range(C.allyFireEvery[0], C.allyFireEvery[1]);
    }
  }
}

// ---- the seated talk (same st.talk shape as the interlude; drawn by render/aboard.js in overlay mode) ---------------
function openNode(S, nodeId) {
  const st = S.story, node = LEADER.nodes[nodeId];
  st.ob.visited = st.ob.visited || {};
  st.ob.visited[nodeId] = true;
  st.talk = { id: LEADER.id, name: LEADER.name, node: nodeId, i: 0, lines: (node.lines || []).slice(), choices: [], sel: 0 };
  if (!st.talk.lines.length) advance(S);
}
function unlock(S, id) {
  const st = S.story;
  if (!id || st.codex.includes(id)) return;
  st.codex.push(id);
  st.codexNew = { id, t: 4 };
  pushEvent(S, 'codex', { id });
}
function advance(S) {
  const st = S.story, t = st.talk, ob = st.ob;
  if (!t) return;
  ob.taken = ob.taken || {};
  if (t.choices.length) {
    const c = t.choices[t.sel];
    ob.taken[c.text] = true;
    unlock(S, c.codex);
    pushEvent(S, 'uiClick');
    if (c.end) { st.talk = null; if (c.finish) toDefend(S); return; }
    openNode(S, c.to);
    return;
  }
  if (t.i < t.lines.length - 1) { t.i++; return; }
  const node = LEADER.nodes[t.node];
  unlock(S, node.codex);
  const ch = (node.choices || []).filter((c) => !(c.once && ob.taken[c.text]) && !(c.needs && !ob.visited[c.needs]));
  if (ch.length) { t.choices = ch; t.sel = 0; return; }
  if (node.next) { openNode(S, node.next); return; }
  st.talk = null;
}
function stepTalk(S) {
  const st = S.story, t = st.talk, inp = S.input, ob = st.ob;
  const dir = inp.moveZ > 0.5 ? 1 : inp.moveZ < -0.5 ? -1 : 0;
  if (t.choices.length && dir !== 0 && dir !== ob.selPrev) { t.sel = (t.sel - dir + t.choices.length) % t.choices.length; pushEvent(S, 'uiClick'); }
  ob.selPrev = dir;
  if (inp.interact) advance(S);
}

function toDefend(S) {
  const st = S.story, ob = st.ob, rt = S.sim;
  st.stage = 'defend';
  ob.landing.progress = 0; ob.landing.ready = false;
  rt.parked = false;
  S.player.velocity.set(0, 6, 0);
  for (const id of ob.allyIds) { const e = S.entities.find((q) => q.id === id); if (e) e.state = 'escort'; }
  ob.waveIds = spawnGroup(S, C.waveCount, C.waveFrom, C.waveSpawnDist, C.waveAlt);
  S.mission.wave = 2;
  ob.waypoint = null;
  pushEvent(S, 'alliesJoin');
  pushEvent(S, 'waveStart', { wave: 2 });
  setMessage(S, 'CORA VESSEY: Bili flight, up! Stay on the Xi. Circe, coming in over the stone country from the east.', 7);
}

// ---- every flight frame (sim/mission.js updateMission) -------------------------------------------------------------
export function updateOenbili(S, dt) {
  const rt = S.sim, st = S.story, ob = st.ob, p = S.player, m = S.mission, sw = st.seawrack;
  if (!ob) return;
  m.elapsed += dt;
  ob.t += dt;
  if (sw) sw.position.addScaledVector(sw.velocity, dt);
  st.title = Math.max(0, (st.title || 0) - dt);
  if (st.codexNew) { st.codexNew.t -= dt; if (st.codexNew.t <= 0) st.codexNew = null; }
  if (st.launch && st.launch.out) { st.launch.closeT += dt; st.launch.open = 1 - ease(st.launch.closeT / C.closeTime); }
  const say = (key, text, ttl = 7) => { if (!ob.said[key]) { ob.said[key] = true; setMessage(S, text, ttl); } };
  if (ob.allyIds.length) stepAllies(S, dt);
  keepClearOfTown(S, dt);

  switch (st.stage) {
    case 'launch':
      stepLaunch(S, dt);
      break;
    case 'transit': {
      const d = horiz(p, C.coast[0], C.coast[1]);
      if (d < C.interceptRange) {
        st.stage = 'intercept';
        ob.interceptIds = spawnGroup(S, C.interceptCount, [C.coast[0] + 6000, C.coast[1] + 4000], C.interceptSpawnDist, C.interceptAlt);
        m.wave = 1;
        pushEvent(S, 'waveStart', { wave: 1 });
        setMessage(S, 'SEAWRACK: Three Gustav Karls lifting off the coast — a Circe patrol. They have seen you. Clear them before you go looking.', 8);
      } else m.objective = `FLY TO ${PLACE.toUpperCase()} — COAST ${(d / 1000).toFixed(1)} KM`;
      break;
    }
    case 'intercept': {
      const left = alive(S, ob.interceptIds).length;
      m.objective = `CIRCE PATROL — ${left} LEFT`;
      ob.waypoint = null;
      if (left === 0) {
        st.stage = 'search';
        ob.waypoint = { x: C.base[0], z: C.base[1], label: 'SIGNAL', vague: true };
        setMessage(S, `IRAM: Patrol down. Now listen: there is a weak carrier wave out of the stone country past ${PLACE}. Follow it in — fly low, it fades with height.`, 9);
      }
      break;
    }
    case 'search': {
      const d = horiz(p, C.base[0], C.base[1]);
      const agl = p.position.y - groundAt(S, p.position.x, p.position.z);
      ob.signal = Math.max(0, Math.min(1, 1 - d / C.signalRange)) * (agl < 1500 ? 1 : 0.55);
      m.objective = `FOLLOW THE SIGNAL — ${Math.round(ob.signal * 100)}%${agl >= 1500 ? ' (FLY LOWER)' : ''}`;
      if (d < 12000) say('town', `IRAM: That's ${PLACE} off to your left — keep clear of the town, they have nothing to do with this.`, 7);
      if (d < C.revealRange) {
        st.stage = 'approach';
        ob.revealed = true;
        ob.signal = 1;
        ob.waypoint = { x: C.base[0], z: C.base[1], label: 'PAD' };
        spawnAllies(S);
        pushEvent(S, 'rebelsFound');
        setMessage(S, 'CORA VESSEY: Gundam, we see you. That\'s our smoke, green, in the gap between the rocks. Set down on the pad — gently, it\'s older than you.', 9);
      }
      break;
    }
    case 'approach':
      if (stepPad(S, dt)) {
        st.stage = 'landed';
        rt.parked = true;
        park(S);
        ob.waypoint = null;
        m.objective = 'TALK — [ENTER] NEXT   W / S CHOOSE';
        pushEvent(S, 'landed');
        openNode(S, LEADER.start);
      }
      break;
    case 'landed':
      park(S);
      if (st.talk) stepTalk(S);
      else if (st.stage === 'landed') openNode(S, 'q');      // the talk only ends by the finish choice
      break;
    case 'defend': {
      const left = alive(S, ob.waveIds).length;
      m.objective = `HOLD THE STONE COUNTRY — ${left} LEFT`;
      if (left === 0) {
        st.stage = 'won'; ob.wonT = 0;
        setMessage(S, 'CORA VESSEY: That\'s the last of them. ...Alright, real Mafty. Where do we go?', 8);
      }
      break;
    }
    case 'won':
      ob.wonT += dt;
      m.objective = 'ALL HOSTILES DESTROYED';
      if (ob.wonT >= C.victoryDelay && S.phase === 'flight') {
        S.phase = 'victory';
        endMission(S, true);
        st.unlock = Math.max(st.unlock || 0, 4);
        pushEvent(S, 'chapterEnd', { chapter: 3 });
        setMessage(S, `IRAM: Bring them home, Hathaway. Seawrack will meet you off the coast. Good work at ${PLACE}.`, 9999);
      }
      break;
    default: break;
  }
}
