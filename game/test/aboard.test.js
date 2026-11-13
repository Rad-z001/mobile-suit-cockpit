// CR-014 story interlude "Aboard Seawrack" (sim/missions/aboard.js): homecoming (the Xi hides in hold two) -> cut to the
// cockpit in the closed hold, the gantry extends, H opens the hatch -> on foot along the gantry to the bulkhead door ->
// up on deck at the hold access house -> corridor -> lift -> Command briefing -> Chapter 2 complete, Chapter 3 unlocked.
// Talking, choices, Codex, reactive lines, walls.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createState } from '../src/state.js';
import { createSim } from '../src/sim/index.js';
import { ABOARD as A, SEAWRACK as SW } from '../src/sim/tuning.js';
import { CATWALK } from '../src/sim/missions/aboard.js';

const DT = 1 / 60;
const EDGES = ['interact', 'hatch'];
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
        for (const k of EDGES) state.input[k] = false;
      }
    },
    press(k = 'interact') { state.input[k] = true; g.step(1); },
    until(pred, max = 60 * 60, each = null) { for (let i = 0; i < max && !pred(state); i++) g.step(1, each); return pred(state); },
  };
  g.step(2);
  if (prep) prep(state);
  // fly to the ship: the homecoming starts
  const sw = state.story.seawrack;
  g.step(30, (st) => { if (st.phase === 'flight') { st.player.position.copy(sw.position).add(new THREE.Vector3(0, 300, 700)); st.player.velocity.copy(sw.velocity); } });
  return g;
}
const S2 = (g) => g.state.story;
// skip the homecoming, wait for the gantry, open the hatch: on foot at the end of the gantry
function toGantry(g) {
  g.step(70); g.press();
  g.until((s) => s.story.gantry >= 1);
  g.press('hatch');
  g.until((s) => s.story.stage === 'hold' && s.story.fade < 0.01);
}
// then along the gantry (facing the bulkhead) to the door: up on deck
function toDeck(g) {
  toGantry(g);
  g.until((s) => s.story.area === 'deck', 60 * 60, (s) => { s.input.moveZ = 1; s.input.moveX = 0; });
  g.state.input.moveZ = 0;
  g.step(60);
}
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

test('aboard: the homecoming; Enter skips it to the cockpit in hold two; the gantry extends; H opens the hatch; on foot on the gantry', () => {
  const g = aboardGame();
  const s = g.state;
  assert.equal(s.phase, 'aboard');
  assert.equal(S2(g).stage, 'homecoming');
  assert.equal(S2(g).gantry, 0, 'stowed while the Xi comes in');
  g.step(70); g.press();
  // seated in the Xi, in the closed hold, facing the bow
  assert.equal(S2(g).stage, 'gantry');
  assert.equal(s.phase, 'aboard');
  assert.ok(S2(g).fade > 0.5, 'fades in from black');
  assert.equal(s.player.hatch.state, 'closed');
  const sw = S2(g).seawrack;
  assert.ok(s.player.position.y < sw.position.y + SW.deckY, 'the Xi is under the deck');
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.player.quaternion);
  assert.ok(fwd.dot(new THREE.Vector3(Math.sin(sw.heading), 0, -Math.cos(sw.heading))) > 0.99, 'facing the bow, down the gantry');
  // the gantry comes out by itself; H does nothing until it is there
  g.step(Math.round(60 * (A.gantryDelay + A.gantryTime / 2)));
  assert.ok(S2(g).gantry > 0.2 && S2(g).gantry < 0.8, 'extending');
  g.press('hatch');
  assert.equal(s.player.hatch.state, 'closed', 'not before the gantry is on');
  assert.ok(g.until((q) => q.story.gantry >= 1));
  assert.match(s.mission.objective, /\[H\].*OPEN HATCH/);
  g.press('hatch');
  assert.notEqual(s.player.hatch.state, 'closed', 'H opens the hatch');
  assert.ok(g.until((q) => q.player.hatch.state === 'open', 60 * 6));
  assert.ok(g.seen.includes('hatchOpened'));
  assert.equal(S2(g).stage, 'gantry', 'a moment to look down the gantry first');
  // the cut: on foot at the end of the gantry, facing the forward bulkhead
  assert.ok(g.until((q) => q.story.stage === 'hold', 60 * 4));
  assert.equal(S2(g).area, 'hold');
  const w = S2(g).walk;
  assert.ok(Math.abs(w.pos.z - (CATWALK.z1 - 0.6)) < 0.01 && Math.abs(w.pos.x) < 0.01, 'at the Xi end of the gantry');
  assert.ok(Math.abs(w.yaw) < 1e-6, 'facing the bow');
  assert.ok(S2(g).fade > 0.5);
  g.step(60);
  assert.ok(S2(g).fade < 0.01);
});

test('aboard: the homecoming plays to its end by itself, into the cockpit in the hold', () => {
  const g = aboardGame();
  g.step(60 * (A.cineTime + 0.5));
  assert.equal(S2(g).stage, 'gantry');
});

test('aboard: Chapter 2 on the gantry - back to the bulkhead door, up on deck by the hold access house; never Chapter 3\'s boarding', () => {
  const g = aboardGame();
  const s = g.state;
  toGantry(g);
  // walking the other way, into the Xi's hatch, does not seat the pilot (that is Chapter 3's launch walk)
  g.step(60 * 3, (q) => { q.input.moveZ = -1; q.input.moveX = 0; });
  assert.equal(s.phase, 'aboard');
  assert.equal(S2(g).stage, 'hold');
  assert.ok(Math.abs(S2(g).walk.pos.z - CATWALK.z1) < 0.01, 'at the hatch end');
  // the railing holds
  g.step(60 * 2, (q) => { q.input.moveZ = 0; q.input.moveX = 1; });
  assert.ok(Math.abs(S2(g).walk.pos.x) <= CATWALK.half + 1e-6);
  // to the door
  assert.ok(g.until((q) => q.story.area === 'deck', 60 * 60, (q) => { q.input.moveZ = 1; q.input.moveX = 0; }), 'through the bulkhead door');
  s.input.moveZ = 0;
  assert.equal(S2(g).stage, 'deck');
  const w = S2(g).walk;
  assert.ok(Math.abs(w.pos.x - A.start[0]) < 0.01 && Math.abs(w.pos.z - A.start[2]) < 0.01, 'out of the hold access house');
  assert.ok(Math.abs(w.pos.x - A.hold[0]) > A.hold[2] + 0.3, 'outside the house walls');
  assert.match(s.mission.objective, /REPORT TO COMMAND/);
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
  assert.ok(S2(g).codex.includes('oenpeli'), 'the briefing sets up Chapter 3: Oenpeli');
  assert.ok(S2(g).codex.includes('imitators'));
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

test('aboard: Gawman, home from Chapter 1, waits on deck near the pilot and talks about Lane Aim', () => {
  const g = aboardGame();
  const s = g.state;
  toDeck(g);
  const gw = S2(g).people.find((q) => q.id === 'gawman');
  assert.ok(gw && gw.area === 'deck' && gw.look === 'gawman');
  const w = S2(g).walk;
  assert.ok(Math.hypot(gw.pos[0] - w.pos.x, gw.pos[2] - w.pos.z) < 8, 'close to where the pilot arrives');
  walkTo(g, gw.pos[0] + 1.6, gw.pos[2] - 1.2, 0.4);
  lookAt(g, gw.pos[0], gw.pos[2]);
  assert.ok(S2(g).prompt && S2(g).prompt.id === 'gawman', 'prompt to talk to Gawman');
  g.press();
  for (let i = 0; i < 8 && !S2(g).talk.choices.length; i++) g.press();
  g.press();                                         // 'Why did Lane let you go?'
  assert.ok(S2(g).codex.includes('lane'));
  void s;
});
