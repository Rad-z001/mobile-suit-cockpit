// CR-014 story interlude "Aboard Seawrack" (sim/missions/aboard.js): homecoming (the Xi hides in hold two) -> straight cut
// to the pilot on deck -> corridor -> lift -> Command briefing -> Chapter 2 complete, Chapter 3 unlocked.
// Talking, choices, Codex, reactive lines, walls.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createState } from '../src/state.js';
import { createSim } from '../src/sim/index.js';
import { ABOARD as A } from '../src/sim/tuning.js';

const DT = 1 / 60;
function aboardGame(prep = null) {
  const state = createState();
  const sim = createSim(state, { seed: 5 });
  state.setup.mission = 'story2';
  const g = {
    state, seen: [],
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
    press() { state.input.interact = true; g.step(1); },
  };
  g.step(2);
  if (prep) prep(state);
  // fly to the ship: the homecoming starts
  const sw = state.story.seawrack;
  g.step(30, (st) => { if (st.phase === 'flight') { st.player.position.copy(sw.position).add(new THREE.Vector3(0, 300, 700)); st.player.velocity.copy(sw.velocity); } });
  return g;
}
const S2 = (g) => g.state.story;
function toDeck(g) { g.step(70); g.press(); g.step(60); }
// walk toward a model-frame point (x, z) until within r (or the frame budget runs out)
function walkTo(g, x, z, r = 0.6, max = 60 * 60) {
  const s = g.state, w = s.story.walk, inp = s.input;
  for (let i = 0; i < max; i++) {
    const dx = x - w.pos.x, dz = z - w.pos.z;
    if (Math.hypot(dx, dz) < r || s.story.talk || s.story.stage === 'lift' || s.phase !== 'aboard') break;
    inp.walkYaw = (inp.walkYaw || 0) + (Math.atan2(dx, -dz) - w.yaw);
    inp.moveZ = 1; inp.moveX = 0;
    g.step(1);
  }
  inp.moveZ = 0;
}
function lookAt(g, x, z) { const s = g.state, w = s.story.walk; s.input.walkYaw = (s.input.walkYaw || 0) + (Math.atan2(x - w.pos.x, -(z - w.pos.z)) - w.yaw); g.step(1); }
function talkThrough(g, max = 80) { for (let i = 0; i < max && g.state.story.talk; i++) g.press(); }

test('aboard: closing on Seawrack cuts to the homecoming; Enter skips it straight to the pilot on deck, the Xi hidden in hold two', () => {
  const g = aboardGame();
  const s = g.state;
  assert.equal(s.phase, 'aboard');
  assert.equal(S2(g).stage, 'homecoming');
  g.step(70); g.press();
  assert.equal(S2(g).stage, 'deck');
  assert.ok(S2(g).fade > 0.5, 'fades in from black');
  g.step(60);
  assert.ok(S2(g).fade < 0.01);
  const w = S2(g).walk;
  assert.ok(Math.abs(w.pos.x - A.start[0]) < 0.01 && Math.abs(w.pos.z - A.start[2]) < 0.01, 'standing at the start point');
  const sw = S2(g).seawrack;
  assert.ok(s.player.position.y < sw.position.y + 25, 'the Xi is under the deck');
});

test('aboard: the homecoming plays to its end by itself', () => {
  const g = aboardGame();
  g.step(60 * (A.cineTime + 0.5));
  assert.equal(S2(g).stage, 'deck');
});

test('aboard: the full walk — talk on deck (Codex), the door, the corridor notices, the lift, the briefing, Chapter 3 unlocked', () => {
  const g = aboardGame();
  const s = g.state;
  toDeck(g);
  // the deck chief beside the hold: his lines, then a question line, then choices; the first choice unlocks the Xi entry
  walkTo(g, 8.6, 6, 0.4);
  lookAt(g, 10.5, 6);
  assert.ok(S2(g).prompt && S2(g).prompt.id === 'chief', 'prompt to talk to the chief');
  g.press();
  assert.ok(S2(g).talk && S2(g).talk.id === 'chief');
  for (let i = 0; i < 8 && !S2(g).talk.choices.length; i++) g.press();
  assert.ok(S2(g).talk.choices.length >= 2);
  g.press();                                         // pick 'Tell me about the Xi'
  assert.ok(S2(g).codex.includes('xi'));
  for (let i = 0; i < 20 && S2(g).talk; i++) { if (S2(g).talk.choices.length) { s.input.moveZ = -1; g.step(1); s.input.moveZ = 0; g.step(1); s.input.moveZ = -1; g.step(1); s.input.moveZ = 0; g.step(1); } g.press(); }
  assert.equal(S2(g).talk, null);
  walkTo(g, 0, A.door.z + 1, 0.3);
  g.step(60);
  assert.equal(S2(g).area, 'corridor');
  walkTo(g, 0, 49, 0.5);
  lookAt(g, -1.4, 50);
  assert.ok(S2(g).prompt && S2(g).prompt.id === 'notice');
  g.press(); talkThrough(g);
  assert.ok(S2(g).codex.includes('manhunt'));
  walkTo(g, 0, A.corridor.z1 + 2, 0.3);
  assert.equal(S2(g).stage, 'lift');
  g.step(60 * (A.liftTime + 1));
  assert.equal(S2(g).area, 'command');
  walkTo(g, 0, 56, 0.4);
  assert.ok(S2(g).talk && S2(g).talk.id === 'iram', 'briefing starts');
  for (let i = 0; i < 200 && s.phase === 'aboard' && S2(g).stage !== 'end'; i++) g.press();
  assert.ok(S2(g).codex.includes('gawman'));
  assert.ok(S2(g).codex.includes('mafty'));
  g.step(60 * (A.endTime + 0.5));
  assert.equal(s.phase, 'victory');
  assert.equal(S2(g).unlock, 3);
  assert.equal(s.mission.result.victory, true);
});

test('aboard: the walls hold — the deck edge, the hold access house', () => {
  const g = aboardGame();
  toDeck(g);
  const w = S2(g).walk;
  walkTo(g, 40, 10, 0.3, 60 * 12);
  assert.ok(w.pos.x <= A.deck.x + 1e-6, 'stays inside the railing');
  walkTo(g, A.hold[0], A.hold[1], 0.3, 60 * 30);
  assert.ok(Math.abs(w.pos.x - A.hold[0]) >= A.hold[2] || Math.abs(w.pos.z - A.hold[1]) >= A.hold[2], 'never walks into the hold access house');
});

test('aboard: the crew react to how Chapter 2 went', () => {
  const clean = aboardGame();
  const found = aboardGame((s) => { s.story.seawrack.found = true; s.story.seawrack.hp = 0.6; s.story.strike.launched = true; s.story.strike.cleared = true; });
  for (const g of [clean, found]) toDeck(g);
  const firstLine = (g) => { walkTo(g, -5.5, 33.8, 1.2); lookAt(g, -5.5, 36); g.press(); return g.state.story.talk && g.state.story.talk.lines[0].text; };
  assert.match(firstLine(clean), /Not one ping/);
  assert.match(firstLine(found), /found the ship/);
});
