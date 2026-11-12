// CR-008 story Chapter 1: airlock -> gangway -> Xi -> outside shot -> cockpit, inside the falling cargo (sim/boarding.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/state.js';
import { createSim } from '../src/sim/index.js';
import { BOARD } from '../src/sim/tuning.js';

const DT = 1 / 60;
function storyGame() {
  const state = createState();
  const sim = createSim(state, { seed: 7 });
  state.setup.mission = 'story1';
  const g = {
    state, sim,
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        state.events.length = 0;
        state.time += DT; state.dt = DT;
        sim.update(DT);
        state.input.interact = false;
      }
    },
    events(type) { return state.events.filter((e) => e.type === type); },
  };
  return g;
}
// hold W (and Shift when `run`) until the walking part is over
function walkToXi(g, run = true, maxFrames = 60 * 60) {
  const s = g.state, inp = s.input;
  inp.moveZ = 1; inp.boost = run ? 1 : 0;
  for (let i = 0; i < maxFrames && s.phase === 'boarding' && (s.story.stage === 'airlock' || s.story.stage === 'walk'); i++) g.step(1);
  inp.moveZ = 0; inp.boost = 0;
}
function boardXi(g) {
  walkToXi(g);
  for (let i = 0; i < 60 * 20 && g.state.phase === 'boarding'; i++) g.step(1);
}
const rel = (s) => s.story.pilot.position.clone().sub(s.story.cargo.position);

test('story: the default mission never enters the boarding phase', () => {
  const state = createState();
  const sim = createSim(state);
  for (let i = 0; i < 30; i++) sim.update(DT);
  assert.equal(state.phase, 'startup');
  assert.equal(state.story.chapter, 0);
});

test('story: Chapter 1 starts in the airlock facing the closed inner door; the cargo holds its altitude', () => {
  const g = storyGame();
  g.step(1);
  const s = g.state;
  assert.equal(s.phase, 'boarding');
  assert.equal(s.story.chapter, 1);
  assert.equal(s.story.stage, 'airlock');
  assert.equal(s.story.door, 0);
  assert.equal(s.mission.id, 'waves');
  const y0 = s.player.position.y;
  assert.equal(y0, BOARD.startAlt);
  g.step(120);
  assert.equal(s.player.position.y, y0, 'no descent while the pilot is aboard');
  assert.equal(s.story.impactIn, Infinity, 'no impact clock');
  assert.equal(s.story.stage, 'airlock', 'nothing happens until the pilot walks');
  const r = rel(s);
  assert.ok(r.z < BOARD.doorZ && r.z > BOARD.backZ - 0.01);
  assert.ok(-Math.cos(s.story.pilot.yaw) > 0.99, 'facing +Z');
});

test('story: the inner door blocks the way until it has opened, and the side walls hold', () => {
  const g = storyGame();
  const s = g.state, inp = s.input;
  g.step(1);
  inp.moveZ = 1; inp.boost = 1; inp.moveX = 1;
  let maxZClosed = -Infinity;
  for (let i = 0; i < 600 && s.story.stage === 'airlock'; i++) { g.step(1); if (s.story.door < 1) maxZClosed = Math.max(maxZClosed, rel(s).z); }
  assert.ok(maxZClosed <= BOARD.doorZ - 0.69, `stopped at the door: ${maxZClosed}`);
  assert.equal(s.story.stage, 'walk', 'the door opened by itself as he came up to it');
  assert.equal(s.story.door, 1);
  g.step(120);
  assert.ok(Math.abs(rel(s).x) <= BOARD.corridorHalf + 1e-6, 'cannot leave the corridor sideways');
  assert.ok(Math.abs(rel(s).y - BOARD.start[1]) < 1e-6, 'stays on the floor');
});

test('story: run the gangway to the Xi -> outside shot -> seated cold start in the cargo -> release into the battle', () => {
  const g = storyGame();
  const s = g.state;
  g.step(1);
  walkToXi(g);
  assert.equal(s.phase, 'boarding');
  assert.equal(s.story.stage, 'enter', 'reached the end of the gangway');
  assert.ok(s.story.t < 20, `running the gangway took ${s.story.t.toFixed(1)} s`);
  // fade, then the outside shot runs its time
  let sawOutside = 0;
  for (let i = 0; i < 60 * 20 && s.phase === 'boarding'; i++) { g.step(1); if (s.story.stage === 'outside') sawOutside++; }
  assert.ok(Math.abs(sawOutside * DT - BOARD.cineTime) < 0.2, `outside shot lasted ${(sawOutside * DT).toFixed(2)} s`);
  assert.equal(s.phase, 'startup', 'cut to the cockpit');
  assert.equal(s.story.stage, 'cockpit');
  assert.ok(s.sim.boardDone);
  assert.equal(s.startup.stage, 0);
  assert.equal(s.player.hatch.state, 'open', 'the cold start begins with the hatch open');
  // the cargo still holds its altitude during the cold start
  const y0 = s.player.position.y;
  g.step(120);
  assert.ok(Math.abs(y0 - s.player.position.y) < 3, `altitude changed by ${y0 - s.player.position.y} m`);
  for (let i = 0; i < 4 && s.phase === 'startup'; i++) { g.step(300); s.input.interact = true; g.step(1); }
  assert.equal(s.phase, 'flight', 'released from the cargo');
  assert.equal(s.story.stage, 'flight');
  assert.ok(s.player.position.y > BOARD.startAlt - 100, `released at the cargo altitude: ${s.player.position.y}`);
  s.sim.holdWaves = false;
  g.step(60 * 30);
  assert.ok(s.mission.wave >= 1, 'the first wave arrives');
});

test('story: Enter skips the outside shot after its first second', () => {
  const g = storyGame();
  const s = g.state;
  g.step(1);
  walkToXi(g);
  while (s.story.stage === 'enter') g.step(1);
  assert.equal(s.story.stage, 'outside');
  s.input.interact = true; g.step(1);
  assert.equal(s.story.stage, 'outside', 'not in the first second');
  g.step(70);
  s.input.interact = true; g.step(1);
  assert.equal(s.phase, 'startup');
});

test('story: after the release the empty cargo keeps falling, hits the sea and explodes', () => {
  const g = storyGame();
  const s = g.state;
  g.step(1);
  boardXi(g);
  for (let i = 0; i < 4 && s.phase === 'startup'; i++) { g.step(300); s.input.interact = true; g.step(1); }
  assert.equal(s.phase, 'flight');
  s.sim.holdWaves = true;
  const c = s.story.cargo;
  assert.equal(c.gone, false);
  const y0 = c.position.y;
  g.step(60);
  assert.ok(y0 - c.position.y > 30, `the empty cargo starts to fall: ${y0 - c.position.y} m in 1 s`);
  assert.ok(c.position.y < s.player.position.y - 20, 'and drops away below the freed suit');
  let impact = null, boom = 0;
  for (let i = 0; i < 60 * 120 && !impact; i++) { g.step(1); impact = g.events('cargoImpact')[0] || null; boom += g.events('explosion').length; }
  assert.ok(impact, 'cargoImpact event');
  assert.ok(boom >= 1, 'with an explosion');
  assert.equal(impact.position.y, 0);
  assert.equal(c.gone, true);
  assert.equal(s.phase, 'flight', 'the pilot is unharmed');
  g.step(60);
  assert.ok(c.impactT > 0.9, 'impactT counts up for the fireball');
});

test('story: there is no time limit: five idle minutes in the airlock and five in the cockpit never fail, no alarms', () => {
  const g = storyGame();
  const s = g.state;
  g.step(1);
  let alarm = false;
  const idle = (sec) => { for (let i = 0; i < 60 * sec; i++) { g.step(1); if (s.alerts.some((a) => /SEA|IMPACT|CARGO/.test(a.text))) alarm = true; } };
  idle(300);
  assert.equal(s.phase, 'boarding');
  assert.equal(s.story.stage, 'airlock');
  assert.equal(s.player.position.y, BOARD.startAlt);
  boardXi(g);
  assert.equal(s.phase, 'startup');
  idle(300);
  assert.equal(s.phase, 'startup', 'still waiting for the pilot');
  assert.ok(Math.abs(s.player.position.y - BOARD.startAlt) < 5, `altitude ${s.player.position.y}`);
  assert.equal(alarm, false);
  for (let i = 0; i < 4 && s.phase === 'startup'; i++) { g.step(300); s.input.interact = true; g.step(1); }
  assert.equal(s.phase, 'flight');
});
