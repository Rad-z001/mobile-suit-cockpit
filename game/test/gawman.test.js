// CR-004: cockpit hatch, hatch cold start, eject unlock, mission select, Gawman retrieval, neutral faction.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createState, HATCH_UNLOCK_TIME, HATCH_OPEN_TIME, HATCH_CLOSE_TIME } from '../src/state.js';
import { createSim } from '../src/sim/index.js';
import { GAWMAN } from '../src/sim/tuning.js';

const DT = 1 / 60;
const EDGES = ['funnel', 'targetCycle', 'flightModeToggle', 'sensorCycle', 'zoomCycle', 'flare', 'interact', 'pauseToggle', 'reload', 'hatch'];

function makeGame(mission) {
  const state = createState();
  if (mission) state.setup.mission = mission;
  const sim = createSim(state);
  const g = {
    state, sim,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        state.events.length = 0;
        state.time += DT;
        state.dt = DT;
        sim.update(DT);
        for (const k of EDGES) state.input[k] = false;
        state.input.weaponSelect = null;
      }
    },
    secs(t) { g.step(Math.ceil(t / DT)); },
    press(key) { state.input[key] = true; g.step(1); },
    events(type) { return state.events.filter((e) => e.type === type); },
    // run n frames and collect { frame, event } for the type
    collect(type, n) {
      const out = [];
      for (let i = 0; i < n; i++) {
        g.step(1);
        for (const e of state.events) if (e.type === type) out.push({ frame: i, e });
      }
      return out;
    },
  };
  return g;
}

function toFlight(g) {
  for (let i = 0; i < 4; i++) {
    g.step(300);
    g.press('interact');
  }
  g.step(1);
  assert.equal(g.state.phase, 'flight');
  g.state.events.length = 0;
}

function flightGame(mission) {
  const g = makeGame(mission);
  toFlight(g);
  g.state.sim.holdWaves = true;
  return g;
}

// the hatch fully open
function openHatch(g) {
  g.press('hatch');
  g.secs(HATCH_UNLOCK_TIME + HATCH_OPEN_TIME + 0.1);
  assert.equal(g.state.player.hatch.state, 'open');
  g.state.events.length = 0;
}

// ---- hatch ----------------------------------------------------------------------------------------------

test('hatch: closed -> unlocking -> opening -> open -> closing -> closed with the right timings and events', () => {
  const g = flightGame();
  const h = g.state.player.hatch;
  assert.equal(h.state, 'closed');
  assert.equal(h.locked, true);
  assert.equal(h.open, 0);
  g.state.input.hatch = true;
  const seen = {};
  let t = 0;
  const log = (name) => { if (!(name in seen)) seen[name] = t; };
  let prevOpen = 0;
  let first = true;
  for (let i = 0; i < Math.ceil(5 / DT); i++) {
    g.step(1);
    t += DT;
    for (const e of g.state.events) if (e.type.startsWith('hatch')) log(e.type);
    if (first) { assert.equal(h.state, 'unlocking'); assert.equal(h.locked, false); first = false; }
    assert.ok(h.open >= prevOpen - 1e-9, 'open never goes backwards while opening');
    assert.ok(h.open >= 0 && h.open <= 1);
    prevOpen = h.open;
    if (h.state === 'unlocking') assert.equal(h.open, 0);
  }
  assert.equal(h.state, 'open');
  assert.equal(h.open, 1);
  assert.equal(h.locked, false);
  assert.ok(seen.hatchUnlock < 0.05);
  assert.ok(Math.abs(seen.hatchOpen - HATCH_UNLOCK_TIME) < 0.05, 'doors start parting after the unlock: ' + seen.hatchOpen);
  assert.ok(Math.abs(seen.hatchOpened - (HATCH_UNLOCK_TIME + HATCH_OPEN_TIME)) < 0.05, 'fully open: ' + seen.hatchOpened);
  // eased: halfway through the opening the doors are about half open
  // close
  g.state.input.hatch = true;
  g.step(1);
  assert.equal(h.state, 'closing');
  assert.equal(g.events('hatchClose').length, 1);
  assert.equal(h.locked, false);
  let closedAt = -1;
  t = 0;
  for (let i = 0; i < Math.ceil(3 / DT); i++) {
    g.step(1);
    t += DT;
    if (g.events('hatchLocked').length) { closedAt = t; break; }
  }
  assert.ok(Math.abs(closedAt - HATCH_CLOSE_TIME) < 0.06, 'sealed after ' + closedAt);
  assert.equal(h.state, 'closed');
  assert.equal(h.locked, true);
  assert.equal(h.open, 0);
});

test('hatch: a press during a transition is queued (one) and runs when it ends', () => {
  const g = flightGame();
  const h = g.state.player.hatch;
  g.press('hatch'); // -> unlocking
  assert.equal(h.state, 'unlocking');
  g.secs(0.3);
  g.press('hatch'); // queued
  g.step(2);
  g.press('hatch'); // a second press does not stack
  assert.equal(h.state, 'unlocking', 'cannot be interrupted');
  g.secs(HATCH_UNLOCK_TIME + HATCH_OPEN_TIME);
  // opened, then the queued press closes it again
  const states = new Set();
  for (let i = 0; i < Math.ceil(3 / DT); i++) { g.step(1); states.add(h.state); }
  assert.ok(states.has('closing'), 'queued press ran: ' + [...states]);
  assert.equal(h.state, 'closed', 'exactly one queued press, not two');
});

test('hatch: rifle, funnels and saber are locked while it is not sealed, vulcan still fires', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  p.weapons.funnel.count = 24;
  // sealed: the rifle fires
  s.input.triggerFull = true;
  g.step(2);
  assert.ok(g.events('rifleFire').length + (p.weapons.rifle.shots < p.weapons.rifle.perPack ? 1 : 0) >= 1);
  s.input.triggerFull = false;
  g.secs(2);
  const shots = p.weapons.rifle.shots;
  g.press('hatch'); // unlocking: not locked any more
  assert.equal(p.hatch.locked, false);
  s.input.triggerFull = true;
  s.input.secondary = true;
  let rifle = 0; let vulcan = 0;
  for (let i = 0; i < Math.ceil(4 / DT); i++) {
    g.step(1);
    rifle += g.events('rifleFire').length;
    vulcan += g.events('vulcanFire').length;
  }
  assert.equal(rifle, 0, 'no rifle with the hatch open');
  assert.equal(p.weapons.rifle.shots, shots);
  assert.ok(vulcan > 20, 'vulcan works: ' + vulcan);
  assert.ok(s.alerts.some((a) => a.id === 'hatchwpn'));
  s.input.funnel = true; g.step(1);
  assert.equal(g.events('funnelLaunch').length, 0);
  s.input.triggerFull = false; s.input.secondary = false;
  // saber
  s.input.weaponSelect = 'saber'; g.step(1);
  s.input.triggerFull = true; g.step(3);
  assert.equal(g.events('saberSlash').length, 0);
  s.input.triggerFull = false;
});

test('hatch: open above 120 m/s raises WIND + buffeting, above 200 m/s it slowly damages the hull', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  openHatch(g);
  s.input.moveZ = 1;
  let wind = 0; let alertSeen = false; let maxG = 0; let minG = 9;
  for (let i = 0; i < Math.ceil(8 / DT); i++) {
    g.step(1);
    wind += g.events('hatchWind').length;
    if (s.alerts.some((a) => a.id === 'wind')) alertSeen = true;
    if (p.speed > 130) { maxG = Math.max(maxG, p.gVector.x); minG = Math.min(minG, p.gVector.x); }
  }
  assert.ok(p.speed > 200, 'speed ' + p.speed);
  assert.ok(wind >= 2, 'hatchWind events ' + wind);
  assert.ok(alertSeen);
  assert.ok(maxG > minG, 'g jitter');
  assert.ok(p.hull < 1 && p.hull >= 0.05, 'hull ' + p.hull);
  assert.equal(s.phase, 'flight');
  // sealed: no effect
  const g2 = flightGame();
  g2.state.input.moveZ = 1;
  g2.secs(8);
  assert.equal(g2.state.player.hull, 1);
  assert.equal(g2.state.alerts.some((a) => a.id === 'wind'), false);
});

test('hatch: a slow open hatch is quiet (no wind below 120 m/s)', () => {
  const g = flightGame();
  openHatch(g);
  g.secs(3);
  assert.equal(g.state.alerts.some((a) => a.id === 'wind'), false);
  assert.equal(g.state.player.hull, 1);
});

// ---- cold start -----------------------------------------------------------------------------------------

test('cold start: stage 0 begins with the hatch fully open and the first Enter closes it, then stage 1 begins', () => {
  for (const mission of [undefined, 'gawman']) {
    const g = makeGame(mission);
    const s = g.state;
    assert.equal(s.phase, 'startup');
    assert.equal(s.startup.stage, 0);
    assert.deepEqual({ state: s.player.hatch.state, open: s.player.hatch.open, locked: s.player.hatch.locked }, { state: 'open', open: 1, locked: false });
    g.secs(3);
    assert.equal(s.startup.stage, 0, 'waits for Enter');
    assert.equal(s.player.hatch.state, 'open');
    s.input.interact = true;
    g.step(1);
    assert.equal(s.player.hatch.state, 'closing');
    assert.equal(g.events('hatchClose').length, 1);
    assert.equal(s.startup.stage, 0);
    const locked = g.collect('hatchLocked', Math.ceil(2 / DT));
    assert.equal(locked.length, 1);
    assert.equal(s.player.hatch.locked, true);
    assert.equal(s.startup.stage, 1, 'stage 1 once sealed');
    // H does nothing during the cold start
    g.press('hatch');
    assert.equal(s.player.hatch.state, 'closed');
    toFlightFrom(g);
    assert.equal(s.player.hatch.state, 'closed');
    assert.equal(s.player.hatch.locked, true);
  }
});

function toFlightFrom(g) {
  for (let i = 0; i < 3; i++) { g.step(300); g.press('interact'); }
  g.step(1);
  assert.equal(g.state.phase, 'flight');
}

// ---- eject ----------------------------------------------------------------------------------------------

test('eject: the hatch unlocks (event) before it blows, inside the same 2.5 s hold', () => {
  const g = flightGame();
  const s = g.state;
  s.sim.damagePlayer(5, new THREE.Vector3(0, 0, -1));
  assert.equal(s.phase, 'disabled');
  s.events.length = 0;
  // a short pull never unlocks
  s.input.ejectHold = true;
  g.secs(1.0);
  assert.equal(s.player.hatch.state, 'closed');
  s.input.ejectHold = false;
  g.secs(1.5);
  assert.equal(s.player.hatch.state, 'closed');
  // a full pull
  s.input.ejectHold = true;
  let tUnlock = -1; let tBlow = -1; let t = 0;
  for (let i = 0; i < 60 * 4 && tBlow < 0; i++) {
    g.step(1);
    t += DT;
    if (tUnlock < 0 && g.events('hatchUnlock').length) tUnlock = t;
    if (g.events('hatchBlow').length) tBlow = t;
  }
  assert.ok(tUnlock > 0 && tBlow > tUnlock, `unlock ${tUnlock} blow ${tBlow}`);
  assert.ok(Math.abs(tBlow - tUnlock - HATCH_UNLOCK_TIME) < 0.1, 'unlock plays before the blow: ' + (tBlow - tUnlock));
  assert.ok(tBlow > 2.4 && tBlow < 2.7, 'the old 2.5 s hold: ' + tBlow);
  assert.equal(s.phase, 'ejected');
  assert.equal(s.player.hatch.open, 1);
});

// ---- mission select -------------------------------------------------------------------------------------

test('mission select: state.setup.mission is copied to mission.id (at creation and until the first Enter)', () => {
  const a = makeGame();
  assert.equal(a.state.mission.id, 'waves');
  assert.equal(a.state.world.night, false);
  const b = makeGame('gawman');
  assert.equal(b.state.mission.id, 'gawman');
  assert.equal(b.state.world.night, true);
  assert.equal(b.state.player.position.y, GAWMAN.startAlt);
  // chosen after the sim exists (lobby writes it later)
  const c = makeGame();
  c.state.setup.mission = 'gawman';
  c.step(2);
  assert.equal(c.state.mission.id, 'gawman');
  assert.equal(c.state.world.night, true);
  c.state.setup.mission = 'waves';
  c.step(2);
  assert.equal(c.state.mission.id, 'waves');
  assert.equal(c.state.world.night, false);
  assert.equal(c.state.player.position.y > 3000, true);
});

test('mission waves: unchanged (waves start, hostile AI spawns, no neutrals)', () => {
  const g = makeGame();
  toFlight(g);
  g.secs(8);
  assert.equal(g.state.mission.wave, 1);
  assert.ok(g.state.entities.some((e) => e.faction === 'enemy'));
  assert.equal(g.state.entities.some((e) => e.faction === 'neutral'), false);
  assert.equal(g.state.mission.rescue, null);
});

// ---- gawman ---------------------------------------------------------------------------------------------

function gm(g) { return g.state.sim.gm; }

test('gawman: night start at 2400 m, neutral Penelope ~1.5 km ahead at ~110 m/s, no waves, no hostiles', () => {
  const g = flightGame('gawman');
  const s = g.state;
  assert.equal(s.mission.id, 'gawman');
  assert.ok(Math.abs(s.player.position.y - GAWMAN.startAlt) < 30, 'altitude ' + s.player.position.y);
  const pen = s.entities.find((e) => e.type === 'penelope');
  assert.ok(pen);
  assert.equal(pen.faction, 'neutral');
  const d = pen.position.distanceTo(s.player.position);
  assert.ok(d > 1300 && d < 1700, 'distance ' + d);
  assert.ok(Math.abs(pen.velocity.length() - 110) < 30, 'speed ' + pen.velocity.length());
  assert.match(s.mission.objective, /PENELOPE/);
  g.secs(10);
  assert.equal(s.mission.wave, 0);
  assert.equal(s.entities.filter((e) => e.faction === 'enemy').length, 0);
  assert.equal(s.mission.rescue.phase, 'approach');
  assert.equal(s.mission.rescue.gawmanId, null);
  assert.ok(s.mission.rescue.distance > 500);
  // upright and level: yaw only, small pitch / bank
  const eu = new THREE.Euler().setFromQuaternion(pen.quaternion, 'YXZ');
  assert.ok(Math.abs(eu.x) < 0.3 && Math.abs(eu.z) < 0.3);
});

test('gawman: he jumps when the player is within 450 m of Penelope', () => {
  const g = flightGame('gawman');
  const s = g.state;
  const pen = gm(g).penelope;
  g.secs(2);
  assert.equal(gm(g).jumped, false);
  s.player.position.copy(pen.position).add(new THREE.Vector3(0, 0, 600));
  g.step(2);
  assert.equal(gm(g).jumped, false, 'still 600 m');
  s.player.position.copy(pen.position).add(new THREE.Vector3(0, 0, 420));
  let jumps = 0;
  for (let i = 0; i < 4; i++) { g.step(1); jumps += g.events('gawmanJump').length; }
  assert.equal(jumps, 1);
  const man = s.entities.find((e) => e.type === 'gawman');
  assert.ok(man);
  assert.equal(man.faction, 'neutral');
  assert.equal(man.radius, 1);
  assert.ok(man.light && Math.abs(man.light.length() - 1) < 1e-6);
  assert.equal(s.mission.rescue.phase, 'falling');
  assert.equal(s.mission.rescue.gawmanId, man.id);
  assert.ok(s.mission.message.text.length > 0);
  assert.ok(man.velocity.length() > 90, 'jumps with the carrier velocity');
});

test('gawman: he jumps after 60 s even if the player stays far away', () => {
  const g = flightGame('gawman');
  g.secs(55);
  assert.equal(gm(g).jumped, false);
  const ev = g.collect('gawmanJump', Math.ceil(10 / DT));
  assert.equal(ev.length, 1);
  assert.ok(ev[0].frame * DT > 3 && ev[0].frame * DT < 7, 'at ~60 s: ' + ev[0].frame * DT);
});

test('gawman: falls with drag toward ~55 m/s terminal speed, tumbles, flashlight wobbles, reaches the sea in about 45-55 s', () => {
  const g = flightGame('gawman');
  const s = g.state;
  const pen = gm(g).penelope;
  s.player.position.copy(pen.position).add(new THREE.Vector3(0, 0, 400));
  g.step(2);
  const man = s.entities.find((e) => e.type === 'gawman');
  const q0 = man.quaternion.clone();
  const lights = [];
  let maxSpeed = 0;
  let t = 0;
  while (man.alive && t < 120 && s.phase === 'flight') {
    g.step(1);
    t += DT;
    maxSpeed = Math.max(maxSpeed, man.velocity.length());
    if (Math.round(t / DT) % 20 === 0) lights.push(man.light.clone());
    if (t > 15 && t < 15.1) assert.ok(Math.abs(man.velocity.y) > 45 && Math.abs(man.velocity.y) < 62, 'vy at 15 s ' + man.velocity.y);
  }
  assert.ok(maxSpeed < 125, 'speed bounded ' + maxSpeed);
  assert.ok(man.quaternion.angleTo(q0) > 0.5, 'tumbles');
  let spread = 0;
  for (const l of lights) spread = Math.max(spread, l.distanceTo(lights[0]));
  assert.ok(spread > 0.2, 'flashlight wobbles');
  assert.equal(s.phase, 'failed');
  assert.equal(s.mission.result.reason, 'sea');
  assert.ok(t > 38 && t < 60, 'fall time ' + t);
});

// place the player so the catch point is on Gawman, matching his velocity ("perfect pilot")
function perfectPilot(g, offset = new THREE.Vector3()) {
  const s = g.state;
  const p = s.player;
  const man = s.entities.find((e) => e.type === 'gawman' && e.alive);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quaternion);
  p.position.copy(man.position).addScaledVector(fwd, -GAWMAN.catchOffset).add(offset);
  p.velocity.copy(man.velocity);
  return man;
}

function jumpedGame() {
  const g = flightGame('gawman');
  const s = g.state;
  s.player.position.copy(gm(g).penelope.position).add(new THREE.Vector3(0, 0, 400));
  g.step(2);
  assert.equal(gm(g).jumped, true);
  s.events.length = 0;
  return g;
}

test('gawman: a perfect pilot (hatch open, velocity matched, catch point on him) catches him, closes up and wins', () => {
  const g = jumpedGame();
  const s = g.state;
  const r = s.mission.rescue;
  openHatch(g);
  let caught = 0;
  for (let i = 0; i < 12; i++) {
    perfectPilot(g, new THREE.Vector3(2, 1, 0));
    g.step(1);
    caught += g.events('gawmanCaught').length;
    if (caught) break;
  }
  assert.equal(caught, 1);
  assert.equal(s.phase, 'flight', 'phase stays flight until the hatch is sealed');
  assert.equal(r.phase, 'aboard');
  assert.match(s.mission.objective, /CLOSE THE HATCH/);
  assert.equal(s.mission.result, null);
  assert.equal(s.entities.some((e) => e.type === 'gawman' && e.alive), false);
  // still flight while the doors close
  g.press('hatch');
  assert.equal(s.player.hatch.state, 'closing');
  g.secs(1.0);
  assert.equal(s.phase, 'flight');
  g.secs(1.0);
  assert.equal(s.player.hatch.state, 'closed');
  assert.equal(s.phase, 'victory');
  assert.equal(s.mission.result.victory, true);
});

test('gawman: the readout is live (distance/closing from the catch point, relVel in player axes, envelope, time to sea)', () => {
  const g = jumpedGame();
  const s = g.state;
  const r = s.mission.rescue;
  const man = s.entities.find((e) => e.type === 'gawman');
  g.step(2);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.player.quaternion);
  const cp = s.player.position.clone().addScaledVector(fwd, GAWMAN.catchOffset);
  assert.ok(r.catchPoint.distanceTo(cp) < 1e-6);
  assert.ok(Math.abs(r.distance - man.position.distanceTo(r.catchPoint)) < 1e-3);
  const rel = man.velocity.clone().sub(s.player.velocity).applyQuaternion(s.player.quaternion.clone().invert());
  assert.ok(r.relVel.distanceTo(rel) < 1e-3);
  assert.ok(Math.abs(r.relSpeed - rel.length()) < 1e-3);
  assert.ok(r.timeToSea > 30 && r.timeToSea < 60, 'time to sea ' + r.timeToSea);
  assert.equal(r.inEnvelope, false);
  // envelope: on the catch point, matched velocity (hatch open, otherwise it is a hull strike)
  openHatch(g);
  perfectPilot(g);
  g.step(1);
  assert.equal(r.inEnvelope, true);
  assert.ok(r.distance <= GAWMAN.catchRadius);
});

test('gawman: hints ask for the hatch, then for matching speed', () => {
  const g = jumpedGame();
  const s = g.state;
  const man = s.entities.find((e) => e.type === 'gawman');
  s.player.position.copy(man.position).add(new THREE.Vector3(0, 0, 300));
  const hints = [];
  for (let i = 0; i < 200; i++) { g.step(1); for (const e of s.events) if (e.type === 'rescueHint') hints.push(e.text); }
  assert.ok(hints.some((h) => /OPEN THE HATCH/.test(h)), 'A:' + hints.join('|'));
  openHatch(g);
  perfectPilot(g, new THREE.Vector3(0, 0, 30));
  s.player.velocity.set(0, 0, -80);
  const more = [];
  for (let i = 0; i < 20; i++) { g.step(1); for (const e of s.events) if (e.type === 'rescueHint') more.push(e.text); }
  assert.ok(more.some((h) => /MATCH|TOO FAST/.test(h)), 'B:' + more.join('|') + ' ' + s.phase + ' ' + JSON.stringify(s.mission.rescue.hint));
});

test('gawman: contact at more than 15 m/s fails (GAWMAN HIT THE HULL)', () => {
  const g = jumpedGame();
  const s = g.state;
  openHatch(g);
  const man = perfectPilot(g);
  s.player.velocity.copy(man.velocity).add(new THREE.Vector3(0, 40, 0)); // 40 m/s relative
  g.step(1);
  assert.equal(s.phase, 'failed');
  assert.equal(g.events('gawmanLost')[0].reason, 'hull');
  assert.equal(s.mission.result.victory, false);
  assert.equal(s.mission.result.reason, 'hull');
  assert.match(s.mission.objective, /HULL/);
  assert.equal(s.mission.rescue.phase, 'lost');
});

test('gawman: contact with the hatch not fully open fails, even when slow', () => {
  for (const opening of [false, true]) {
    const g = jumpedGame();
    const s = g.state;
    if (opening) { g.press('hatch'); g.secs(HATCH_UNLOCK_TIME + 0.8); assert.equal(s.player.hatch.state, 'opening'); }
    assert.equal(s.player.hatch.state === 'open', false);
    perfectPilot(g);
    g.step(1);
    assert.equal(s.phase, 'failed');
    assert.equal(s.mission.result.reason, 'hull');
  }
});

test('gawman: hatch open but too fast inside the catch ring is not a catch', () => {
  const g = jumpedGame();
  const s = g.state;
  openHatch(g);
  const man = perfectPilot(g);
  // 12 m/s relative: above the catch limit (8) but below the fatal one (15)
  s.player.velocity.copy(man.velocity).add(new THREE.Vector3(0, 0, -12));
  g.step(1);
  assert.equal(g.events('gawmanCaught').length, 0);
  assert.notEqual(s.phase, 'victory');
});

test('gawman: Gawman below 30 m altitude fails (GAWMAN LOST)', () => {
  const g = jumpedGame();
  const s = g.state;
  const man = s.entities.find((e) => e.type === 'gawman');
  man.position.y = 25;
  man.position.x += 2000; // far from the suit
  g.step(1);
  assert.equal(s.phase, 'failed');
  assert.equal(g.events('gawmanLost')[0].reason, 'sea');
  assert.equal(s.mission.result.reason, 'sea');
  assert.equal(s.mission.result.victory, false);
  assert.match(s.mission.objective, /LOST/);
});

test('gawman: tracking assist matches his fall so a hovering pilot can set up the catch', () => {
  const g = jumpedGame();
  const s = g.state;
  const man = s.entities.find((e) => e.type === 'gawman');
  // start 110 m behind him, moving with the carrier, no input at all
  s.player.position.copy(man.position).add(new THREE.Vector3(0, 0, 110));
  s.player.velocity.copy(man.velocity);
  const r = s.mission.rescue;
  let ok = 0;
  let maxDist = 0;
  for (let i = 0; i < 60 * 8; i++) {
    g.step(1);
    if (i > 60 * 3) { maxDist = Math.max(maxDist, r.distance); if (r.relSpeed < GAWMAN.catchSpeed) ok++; }
  }
  assert.ok(r.assist > 0.5, 'assist engaged ' + r.assist);
  assert.ok(ok > 60 * 4, 'relative speed inside the catch limit for most of the time: ' + ok);
  assert.ok(maxDist < 200, 'stays with him ' + maxDist);
  // thrust is relative to him: a short forward tap changes the gap slowly
  const d0 = r.distance;
  s.input.moveZ = 0.5;
  g.secs(1);
  s.input.moveZ = 0;
  assert.ok(r.distance < d0 + 1 && d0 - r.distance < 40, `tap closed ${d0 - r.distance} m`);
});

test('gawman: Xi in flight form can catch up with Penelope (and in hover too)', () => {
  const g = flightGame('gawman');
  const s = g.state;
  const pen = gm(g).penelope;
  g.press('flightModeToggle');
  g.secs(2.2);
  assert.equal(s.player.flightMode, 'minovsky');
  s.input.moveZ = 1;
  let jumped = false;
  for (let i = 0; i < 60 * 30 && !jumped; i++) { g.step(1); jumped = gm(g).jumped; }
  assert.equal(jumped, true);
  assert.ok(gm(g).t < 30, 'caught up before the timer: ' + gm(g).t);
  assert.ok(pen.position.distanceTo(s.player.position) <= GAWMAN.jumpDist + 20);
  // hover: 280 m/s cruise also closes on a 110 m/s carrier
  const h = flightGame('gawman');
  h.state.input.moveZ = 1;
  let hj = false;
  for (let i = 0; i < 60 * 30 && !hj; i++) { h.step(1); hj = gm(h).jumped; }
  assert.equal(hj, true);
  assert.ok(gm(h).t < 20, 'hover closes in ' + gm(h).t);
});

// ---- neutral faction ---------------------------------------------------------------------------------------

test('neutral: Penelope and Gawman are never targeted, locked, hit or damaged; shots pass through', () => {
  const g = jumpedGame();
  const s = g.state;
  const pen = gm(g).penelope;
  const man = s.entities.find((e) => e.type === 'gawman');
  // line the crosshair up on Penelope and fire everything
  s.player.position.copy(pen.position).add(new THREE.Vector3(0, 0, 700));
  s.player.velocity.copy(pen.velocity);
  s.input.triggerFull = true;
  s.input.secondary = true;
  let enemyHit = 0;
  for (let i = 0; i < 60 * 6; i++) {
    s.player.position.copy(pen.position).add(new THREE.Vector3(0, 0, 700));
    g.step(1);
    enemyHit += g.events('enemyHit').length;
    assert.equal(s.player.target.id, null);
    assert.equal(s.player.lock.targetId, null);
    assert.equal(s.player.lock.state, 'none');
    assert.equal(s.player.threat.missileInbound, false);
  }
  assert.equal(enemyHit, 0);
  assert.equal(pen.hp, pen.maxHp);
  assert.ok(pen.alive);
  assert.equal(s.sim.targets.length, 0);
  assert.equal(s.sim.ships.length, 0);
  assert.equal(g.state.sim.shotsFired > 0, true);
  // Penelope is on her scripted course, not AI
  assert.ok(Math.abs(pen.velocity.length() - 110) < 30);
  // Gawman too
  s.input.triggerFull = false;
  s.input.secondary = false;
  man.hp = 1;
  s.player.position.copy(man.position).add(new THREE.Vector3(0, 0, 50));
  s.input.secondary = true;
  g.step(30);
  assert.equal(man.hp, 1);
  assert.equal(s.player.target.id, null);
});

test('neutral: the carrier never fires and nothing else damages the player in the gawman mission', () => {
  const g = flightGame('gawman');
  g.secs(30);
  assert.equal(g.state.player.hull, 1);
  assert.equal(g.state.entities.some((e) => e.type === 'beam' || e.type === 'missile'), false);
});

test('gawman: the mission id is not re-read in flight', () => {
  const g = flightGame('gawman');
  assert.ok(g.state.entities.some((e) => e.faction === 'neutral'));
  g.state.setup.mission = 'waves';
  g.step(2);
  assert.equal(g.state.mission.id, 'gawman');
  assert.equal(g.state.world.night, true);
});
