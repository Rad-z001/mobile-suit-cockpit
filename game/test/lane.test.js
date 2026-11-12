// Story Chapter 1, third wave (sim/missions/lane.js): the Penelope brings Gawman, Lane Aim lets him go over the Xi, the
// player catches him in the hatch (the CR-004 rescue core), then Lane duels; the 'story1p' checkpoint restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createState, HATCH_UNLOCK_TIME, HATCH_OPEN_TIME } from '../src/state.js';
import { createSim } from '../src/sim/index.js';
import { LANE, GAWMAN } from '../src/sim/tuning.js';

const DT = 1 / 60;
const EDGES = ['interact', 'hatch'];
function game(mission = 'story1p', checkpoint = null) {
  const state = createState();
  const sim = createSim(state, { seed: 7 });
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
        for (const k of EDGES) state.input[k] = false;
      }
    },
    press(k) { state.input[k] = true; g.step(1); },
    until(pred, max = 60 * 120, each = null) { for (let i = 0; i < max && !pred(state); i++) g.step(1, each); return pred(state); },
  };
  return g;
}
const lane = (g) => g.state.story.lane;
const penelope = (s) => s.entities.find((e) => e.alive && e.type === 'penelope');
// "perfect pilot": the catch point on Gawman, his velocity matched
function perfectPilot(s) {
  const p = s.player, man = s.entities.find((e) => e.type === 'gawman' && e.alive);
  if (!man) return;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quaternion);
  p.position.copy(man.position).addScaledVector(fwd, -GAWMAN.catchOffset).add(new THREE.Vector3(1.5, 1, 0));
  p.velocity.copy(man.velocity);
}
// arrive -> talk -> ready -> slowed down -> he jumps
function toJump(g) {
  const s = g.state;
  assert.ok(g.until(() => lane(g).stage === 'talk', 60 * 40), 'she reaches her station over the Xi');
  assert.ok(g.until(() => lane(g).stage === 'ready', 60 * 30));
  assert.ok(g.until(() => lane(g).stage === 'falling', 60 * 20, (st) => st.player.velocity.multiplyScalar(0.9)), 'he jumps once the Xi slows');
  assert.ok(s.mission.rescue, 'the rescue readout is live');
  assert.ok(g.seen.includes('gawmanJump'));
}

test('lane: the checkpoint restart flies straight into the beat: chapter 1, the Penelope arriving neutral, a chapter 1 checkpoint', () => {
  const g = game('story1p', { v: 1, chapter: 1, hull: 0.7, parts: { lArm: 0.4 }, funnel: 4, vulcan: 200, flares: 3, kills: 5 });
  g.step(2);
  const s = g.state;
  assert.equal(s.phase, 'flight');
  assert.equal(s.story.chapter, 1);
  assert.equal(s.mission.id, 'waves');
  assert.equal(s.sim.waveState, 'lane');
  assert.equal(lane(g).stage, 'arrive');
  assert.equal(s.player.hull, 0.7);
  assert.equal(s.mission.kills, 5);
  const pen = penelope(s);
  assert.ok(pen && pen.faction === 'neutral', 'neutral while she carries him: no target, no AI');
  assert.equal(s.sim.targets.includes(pen), false);
  assert.ok(pen.position.y > s.player.position.y + 300, 'she comes in above');
  assert.equal(s.story.checkpoint.chapter, 1);
  assert.equal(s.mission.rescue, null);
  assert.equal(g.seen.includes('cargoImpact'), false, 'no stray cargo impact on the restart');
});

test('lane: talk, the drop, a clean catch, hatch sealed -> Lane turns hostile (wave 3) -> her death hands over to Chapter 2', () => {
  const g = game('story1p');
  const s = g.state;
  g.step(2);
  toJump(g);
  // he falls from above the Xi, well clear of the sea
  const man = s.entities.find((e) => e.type === 'gawman' && e.alive);
  assert.ok(man.position.y > s.player.position.y, 'he drops from above');
  // open up while still clear of him (a closed or opening hatch that meets him is a hull strike), then match his fall
  g.press('hatch');
  g.step(Math.ceil((HATCH_UNLOCK_TIME + HATCH_OPEN_TIME + 0.2) / DT));
  assert.equal(s.player.hatch.state, 'open');
  assert.ok(g.until(() => g.seen.includes('gawmanCaught'), 60 * 3, perfectPilot), 'caught');
  assert.equal(s.mission.rescue.phase, 'aboard');
  g.press('hatch');
  assert.ok(g.until(() => lane(g).stage === 'aboard', 60 * 5), 'sealed');
  assert.equal(s.phase, 'flight', 'no end screen: the chapter goes on');
  assert.equal(penelope(s).faction, 'neutral', 'she holds fire until the duel');
  assert.ok(g.until(() => lane(g).stage === 'duel', 60 * (LANE.duelDelay + 1)));
  assert.ok(g.seen.includes('laneDuel'));
  const pen = penelope(s);
  assert.equal(pen.faction, 'enemy');
  assert.equal(s.mission.rescue, null, 'the rescue HUD and assist end');
  assert.equal(s.sim.assist.w, 0);
  assert.equal(s.sim.waveState, 'active');
  g.step(2);
  assert.ok(s.sim.ships.includes(pen), 'the enemy AI flies her now');
  // the duel won: Chapter 2 follows as before
  pen.hp = 0;
  assert.ok(g.until(() => s.story.chapter === 2, 60 * 20));
  assert.equal(s.phase, 'flight');
});

test('lane: lose him to the sea and the chapter fails with that reason; nothing else ends it', () => {
  const g = game('story1p');
  const s = g.state;
  g.step(2);
  toJump(g);
  // stay well away from him, hatch shut
  assert.ok(g.until(() => s.phase === 'failed', 60 * 90, (st) => { st.player.position.set(3000, 2500, 3000); st.player.velocity.set(0, 0, 0); }));
  assert.equal(lane(g).stage, 'lost');
  assert.equal(s.mission.result.victory, false);
  assert.equal(s.mission.result.reason, 'sea');
  assert.ok(g.seen.includes('gawmanLost'));
});

test('lane: the story chapter\'s third wave starts the beat; the plain Intercept mission keeps its hostile Penelope', () => {
  for (const story of [true, false]) {
    const g = game('waves');
    const s = g.state;
    for (let i = 0; i < 4; i++) { g.step(300); g.press('interact'); }
    g.step(1);
    assert.equal(s.phase, 'flight');
    if (story) s.story.chapter = 1;
    s.mission.wave = 2;
    s.sim.waveState = 'prep'; s.sim.waveTimer = 0.01;
    g.step(3);
    const pen = penelope(s);
    assert.ok(pen, 'a Penelope appears');
    if (story) { assert.equal(s.sim.waveState, 'lane'); assert.equal(pen.faction, 'neutral'); assert.equal(s.story.checkpoint.chapter, 1); }
    else { assert.equal(s.sim.waveState, 'active'); assert.equal(pen.faction, 'enemy'); assert.equal(s.story.lane, null); }
  }
});
