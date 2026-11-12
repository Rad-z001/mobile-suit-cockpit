// CR-013 story Chapter 2 "Return to Seawrack" (sim/missions/seawrack.js): checkpoint start, Chapter 1 -> 2 hand-over,
// radar pickets, interceptors, the ship being found and attacked, and the deck landing.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createState } from '../src/state.js';
import { createSim } from '../src/sim/index.js';
import { SEAWRACK as C } from '../src/sim/tuning.js';
import { spawnEnemy } from '../src/sim/enemies.js';

const DT = 1 / 60;
function game(mission = 'story2', checkpoint = null) {
  const state = createState();
  const sim = createSim(state, { seed: 11 });
  state.setup.mission = mission;
  if (checkpoint) state.setup.checkpoint = checkpoint;
  const g = {
    state, sim, seen: [],
    step(n = 1, each = null) {
      for (let i = 0; i < n; i++) {
        state.events.length = 0;
        state.time += DT; state.dt = DT;
        if (each) each(state);
        sim.update(DT);
        for (const e of state.events) g.seen.push(e.type);
        state.input.interact = false;
      }
    },
  };
  return g;
}
const gustavs = (s) => s.entities.filter((e) => e.alive && e.type === 'gustav');
const hold = (s, pos, vel = null) => { s.player.position.copy(pos); if (vel) s.player.velocity.copy(vel); else s.player.velocity.set(0, 0, 0); };

test('chapter 2: a checkpoint restart flies straight away, keeps the damage and tops the hull up to half', () => {
  const g = game('story2', { v: 1, hull: 0.2, parts: { rArm: 0.3, head: 0 }, funnel: 5, vulcan: 100, flares: 2, kills: 7 });
  g.step(2);
  const s = g.state;
  assert.equal(s.phase, 'flight');
  assert.equal(s.story.chapter, 2);
  assert.equal(s.mission.id, 'seawrack');
  assert.equal(s.player.hull, C.minHull);
  assert.equal(s.player.parts.rArm.status, 'damaged');
  assert.equal(s.player.parts.head.status, 'destroyed');
  assert.equal(s.player.weapons.funnel.count, 5);
  assert.equal(s.story.pickets.length, 3);
  const d = Math.hypot(s.story.seawrack.position.x - s.player.position.x, s.story.seawrack.position.z - s.player.position.z);
  assert.ok(Math.abs(d - C.shipDistance) < 500, `ship ${d.toFixed(0)} m away`);
  assert.equal(s.story.checkpoint.chapter, 2);
});

test('chapter 2: with no stored checkpoint the restart starts with a healthy Xi', () => {
  const g = game('story2');
  g.step(2);
  assert.equal(g.state.phase, 'flight');
  assert.equal(g.state.player.hull, 1);
});

test('chapter 2: winning the Chapter 1 battle hands straight over to Chapter 2 and saves a checkpoint', () => {
  const g = game('waves');
  const s = g.state;
  g.step(1);
  s.phase = 'flight';
  s.story.chapter = 1;
  s.player.hull = 0.7;
  s.sim.waveState = 'victory';
  s.sim.waveTimer = 0.001;
  g.step(2);
  assert.equal(s.phase, 'flight', 'no end screen between the chapters');
  assert.equal(s.story.chapter, 2);
  assert.ok(g.seen.includes('checkpoint'));
  assert.ok(Math.abs(s.story.checkpoint.hull - 0.7) < 0.01);
  assert.equal(s.mission.result, null);
});

test('chapter 2: high inside a picket\'s cover fills the meter and launches two Gustavs; low under the radar does not', () => {
  const g = game('story2');
  g.step(2);
  const s = g.state, pk = s.story.pickets[0];
  const low = new THREE.Vector3(pk.position.x + 4000, 200, pk.position.z);
  g.step(60 * 15, (st) => hold(st, low));
  assert.equal(s.story.radar.state, 'hidden');
  assert.equal(s.story.radar.alerts, 0);
  assert.equal(gustavs(s).length, 0);
  const high = new THREE.Vector3(pk.position.x + 4000, 2500, pk.position.z);
  for (let i = 0; i < 60 * 15 && s.story.radar.alerts === 0; i++) g.step(1, (st) => hold(st, high));
  assert.equal(s.story.radar.alerts, 1);
  assert.ok(g.seen.includes('radarDetected'));
  assert.equal(gustavs(s).length, C.interceptorsPerAlert);
  assert.equal(s.story.seawrack.found, false, 'far from the ship: the ship stays hidden');
});

test('chapter 2: a hostile near the ship finds it; the strike group sinks it if nobody defends it, and the chapter fails', () => {
  const g = game('story2');
  g.step(2);
  const s = g.state, sw = s.story.seawrack;
  const away = new THREE.Vector3(sw.position.x + 30000, 5000, sw.position.z + 30000);
  hold(s, away);
  spawnEnemy(s, 'gustav', new THREE.Vector3(sw.position.x + 3000, 1200, sw.position.z));
  g.step(2, (st) => hold(st, away));
  assert.equal(sw.found, true);
  assert.equal(s.story.strike.ids.length, C.strikeCount);
  const strike = s.story.strike.ids.map((id) => s.sim.byId.get(id));
  assert.ok(strike.every((e) => e.sim.goal === 'seawrack'));
  let hitPilot = 0;
  for (let i = 0; i < 60 * 600 && s.phase === 'flight'; i++) {
    g.step(1, (st) => { hold(st, away); if (st.player.hull < 1) hitPilot++; st.player.hull = 1; });
  }
  assert.ok(sw.hits >= C.shipHits, `ship hits ${sw.hits}`);
  assert.equal(s.phase, 'failed');
  assert.equal(s.mission.result.reason, 'seawrack');
  assert.ok(g.seen.includes('seawrackLost'));
  void hitPilot;
});

test('chapter 2: no homecoming while the strike group lives; once it is down, closing on the ship starts it', () => {
  const g = game('story2');
  g.step(2);
  const s = g.state, sw = s.story.seawrack;
  const near = () => sw.position.clone().add(new THREE.Vector3(600, 400, 0));
  spawnEnemy(s, 'gustav', new THREE.Vector3(sw.position.x + 4000, 1500, sw.position.z));
  g.step(60 * 4, (st) => hold(st, near(), sw.velocity));
  assert.equal(s.story.landing.blocked, 'strike');
  assert.equal(s.phase, 'flight');
  for (const e of s.entities) if (e.type === 'gustav') e.alive = false;
  g.step(60 * 2, (st) => { if (st.phase === 'flight') hold(st, near(), sw.velocity); });
  assert.equal(s.phase, 'aboard');
  assert.equal(s.story.stage, 'homecoming');
  assert.ok(g.seen.includes('landed'));
});

test('chapter 2: a clean approach starts the homecoming without the ship ever being found', () => {
  const g = game('story2');
  g.step(2);
  const s = g.state, sw = s.story.seawrack;
  g.step(60, (st) => { if (st.phase === 'flight') hold(st, sw.position.clone().add(new THREE.Vector3(0, 300, 900)), sw.velocity); });
  assert.equal(s.phase, 'aboard');
  assert.equal(sw.found, false);
  assert.equal(s.story.radar.alerts, 0);
});

