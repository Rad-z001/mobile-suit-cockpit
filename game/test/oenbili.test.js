// Story Chapter 3 "Oenbili" (sim/missions/oenbili.js): the walk across hold two to the Xi, the cold start in the closed
// hold, the launch out of it, the coast patrol, the signal search, landing on the rebels' pad, the seated talk with their
// leader, the last wave with the rebel suits alongside, victory; and the 'story3c' RETRY from the launch checkpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createState } from '../src/state.js';
import { createSim } from '../src/sim/index.js';
import { OENBILI as C, SEAWRACK as SW } from '../src/sim/tuning.js';
import { CATWALK } from '../src/sim/missions/aboard.js';
import { spawnEnemy } from '../src/sim/enemies.js';

const DT = 1 / 60;
const EDGES = ['interact', 'hatch', 'flightModeToggle'];
function game(mission = 'story3', checkpoint = null) {
  const state = createState();
  const sim = createSim(state, { seed: 9 });
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
    press(k = 'interact') { state.input[k] = true; g.step(1); },
    until(pred, max = 60 * 120, each = null) { for (let i = 0; i < max && !pred(state); i++) g.step(1, each); return pred(state); },
  };
  return g;
}
const st = (g) => g.state.story;
const living = (s, ids) => ids.map((id) => s.entities.find((e) => e.id === id)).filter((e) => e && e.alive);
// walk the gantry: W held, facing the Xi
function walkToXi(g) {
  return g.until(() => g.state.phase !== 'aboard', 60 * 60, (s) => { s.input.moveZ = 1; s.input.moveX = 0; });
}
function coldStart(g) {
  const s = g.state;
  g.state.input.moveZ = 0;
  for (let i = 0; i < 4 && s.phase === 'startup'; i++) { g.step(60 * 5); g.press(); }
  g.step(2);
}

test('ch3: starts on foot in hold two; the gantry leads to the Xi; reaching its hatch seats the pilot in the closed hold', () => {
  const g = game('story3');
  g.step(2);
  const s = g.state;
  assert.equal(s.phase, 'aboard');
  assert.equal(st(g).chapter, 3);
  assert.equal(st(g).stage, 'hold');
  assert.equal(st(g).area, 'hold');
  assert.equal(s.mission.id, 'oenpeli');
  assert.ok(st(g).seawrack && st(g).seawrack.alive);
  assert.ok(st(g).people.some((q) => q.id === 'chief3') && st(g).people.some((q) => q.id === 'gawman3'));
  // the railing holds: walking sideways off the gantry is impossible
  g.step(60 * 3, (q) => { q.input.moveZ = 0.6; q.input.moveX = 1; });
  assert.ok(Math.abs(st(g).walk.pos.x) <= CATWALK.pad + 1e-6);
  assert.ok(walkToXi(g), 'reached the hatch');
  assert.equal(s.phase, 'startup');
  assert.equal(st(g).stage, 'cockpit');
  assert.equal(s.player.hatch.state, 'open', 'the cold start begins with the hatch open');
  // the suit stays in the hold and sails with the ship
  const sw = st(g).seawrack, d0 = s.player.position.clone().sub(sw.position);
  g.step(60 * 3);
  assert.ok(s.player.position.clone().sub(sw.position).distanceTo(d0) < 0.5, 'still in the hold');
  assert.ok(s.player.position.y < SW.deckY, 'below the deck');
});

test('ch3: cold start in the hold, then the covers open and the Xi rises out; a chapter 3 checkpoint; weapons unlocked', () => {
  const g = game('story3');
  g.step(2);
  walkToXi(g);
  coldStart(g);
  const s = g.state;
  assert.equal(s.phase, 'flight');
  assert.ok(st(g).stage === 'launch' || st(g).stage === 'transit');
  assert.ok(g.until(() => st(g).stage === 'transit', 60 * 10), 'out of the hold');
  assert.equal(st(g).launch.out, true);
  assert.ok(s.player.position.y > SW.deckY + 30, 'clear of the deck');
  assert.equal(s.player.weaponsLocked, false);
  assert.equal(st(g).checkpoint.chapter, 3);
  assert.ok(g.seen.includes('launch'));
  g.step(60 * 4);
  assert.ok(st(g).launch.open < 0.05, 'the covers close behind it');
});

test('ch3: RETRY from the checkpoint - patrol over the coast, the signal, the pad, the talk, the last wave with allies, victory', () => {
  const g = game('story3c', { v: 1, chapter: 3, hull: 0.9, parts: {}, funnel: 24, vulcan: 800, flares: 12, kills: 0 });
  g.step(2);
  const s = g.state, p = s.player;
  assert.equal(s.phase, 'flight');
  assert.equal(st(g).stage, 'transit');
  // at the coast: the Circe patrol
  p.position.set(C.coast[0], 1500, C.coast[1] - 3000);
  p.velocity.set(0, 0, 0);
  g.step(2);
  assert.equal(st(g).stage, 'intercept');
  const patrol = living(s, st(g).ob.interceptIds);
  assert.equal(patrol.length, C.interceptCount);
  for (const e of patrol) e.hp = 0;
  g.step(3);
  assert.equal(st(g).stage, 'search');
  assert.ok(st(g).ob.waypoint && st(g).ob.waypoint.vague);
  // follow the signal in
  p.position.set(C.base[0] - 3000, 600, C.base[1] - 1000);
  g.step(2);
  assert.equal(st(g).stage, 'approach');
  assert.equal(st(g).ob.revealed, true);
  const allies = living(s, st(g).ob.allyIds);
  assert.equal(allies.length, C.allies.length);
  for (const a of allies) { assert.equal(a.faction, 'neutral'); assert.equal(s.sim.targets.includes(a), false); }
  // land: low and slow over the pad, held
  const pad = st(g).ob.pad;
  assert.ok(g.until(() => st(g).stage === 'landed', 60 * 10, (q) => {
    q.player.position.set(pad.x, pad.y + SW.cockpitAboveDeck + 20, pad.z);
    q.player.velocity.set(0, 0, 0);
  }), 'landed');
  assert.equal(s.sim.parked, true);
  assert.ok(st(g).talk && st(g).talk.id === 'leader');
  // the parked Xi does not move on W/S, and does not fire
  const at = p.position.clone();
  const shots = s.sim.shotsFired;
  g.step(30, (q) => { q.input.moveZ = 1; q.input.triggerFull = true; });
  s.input.moveZ = 0; s.input.triggerFull = false;
  assert.ok(p.position.distanceTo(at) < 1.5, 'parked');
  assert.equal(s.sim.shotsFired, shots, 'weapons safe while parked');
  // talk through to the join choice: always take the last choice
  for (let i = 0; i < 80 && st(g).stage === 'landed'; i++) {
    const t = st(g).talk;
    if (t && t.choices.length) { t.sel = t.choices.length - 1; }
    g.press();
  }
  assert.equal(st(g).stage, 'defend');
  assert.equal(s.sim.parked, false);
  assert.ok(g.seen.includes('alliesJoin'));
  const wave = living(s, st(g).ob.waveIds);
  assert.equal(wave.length, C.waveCount);
  // the rebels fight: their beams hit Circe (and never the Xi)
  const hull0 = p.hull;
  for (const e of wave) { e.position.copy(p.position).add(new THREE.Vector3(1500, 300, 0)); e.velocity.set(0, 0, 0); e.sim.fireT = 99; e.sim.missileT = 99; e.sim.canMissile = false; }
  const hp0 = wave.reduce((a, e) => a + e.hp, 0);
  g.step(60 * 12, (q) => { for (const e of wave) { if (e.alive) { e.sim.fireT = 99; e.sim.missileT = 99; } } });
  const hp1 = living(s, st(g).ob.waveIds).reduce((a, e) => a + e.hp, 0);
  assert.ok(g.seen.includes('allyFire'));
  assert.ok(hp1 < hp0, `allies damage the wave (${hp0} -> ${hp1})`);
  assert.ok(p.hull >= hull0 - 1e-9, 'no friendly fire on the Xi');
  for (const e of living(s, st(g).ob.waveIds)) e.hp = 0;
  assert.ok(g.until(() => s.phase === 'victory', 60 * 10), 'victory');
  assert.equal(s.mission.result.victory, true);
  assert.ok(g.seen.includes('chapterEnd'));
});

test('ch3: no landing while Circe is close; once it is gone the landing completes', () => {
  const g = game('story3c', { v: 1, chapter: 3 });
  g.step(2);
  const s = g.state;
  st(g).stage = 'search';
  s.player.position.set(C.base[0] - 2000, 600, C.base[1]);
  g.step(2);
  assert.equal(st(g).stage, 'approach');
  const pad = st(g).ob.pad;
  const e = spawnEnemy(s, 'gustav', new THREE.Vector3(pad.x + 2000, 1500, pad.z));
  const hold = (q) => {
    q.player.position.set(pad.x, pad.y + SW.cockpitAboveDeck + 20, pad.z); q.player.velocity.set(0, 0, 0);
    if (e.alive) { e.position.set(pad.x + 2000, 1500, pad.z); e.velocity.set(0, 0, 0); e.sim.fireT = 99; e.sim.missileT = 99; }
  };
  g.step(60 * 5, hold);
  assert.equal(st(g).stage, 'approach', 'blocked while chased');
  assert.equal(st(g).ob.landing.blocked, 'chased');
  e.hp = 0;
  assert.ok(g.until(() => st(g).stage === 'landed', 60 * 6, hold), 'lands once clear');
});

// ---- the land (sim/terrain.js, sim/lands/oenbili.js) ------------------------------------------------------------------
test('land: scraping a hillside hurts but does not kill; the suit stays above the ground', async () => {
  const { groundAt, BODY_CLEAR } = await import('../src/sim/terrain.js');
  const g = game('story3c', { v: 1, chapter: 3 });
  g.step(2);
  const s = g.state, p = s.player;
  assert.equal(s.world.terrain, 'oenbili');
  const [x, z] = [6000, 3000];
  const gy = groundAt(s, x, z);
  assert.ok(gy > 150, 'stone country here: ' + gy.toFixed(0));
  p.position.set(x, gy + 5, z);
  p.velocity.set(0, -40, -30);
  g.step(3);
  assert.equal(s.phase, 'flight', 'no crash death on land');
  assert.ok(p.position.y >= groundAt(s, p.position.x, p.position.z) + BODY_CLEAR - 1e-6);
  assert.ok(p.hull < 1 && p.hull > 0.6, 'a scrape costs some hull: ' + p.hull.toFixed(2));
  assert.ok(g.seen.includes('groundScrape'));
  assert.ok(Number.isFinite(p.agl) && p.agl < 40);
});

test('land: the hover assist climbs before a ridge; hills stop shots; the grid matches the land function', async () => {
  const { groundAt } = await import('../src/sim/terrain.js');
  const L = await import('../src/sim/lands/oenbili.js');
  const g = game('story3c', { v: 1, chapter: 3 });
  g.step(2);
  const s = g.state, p = s.player;
  // grid points are exact samples
  for (const [x, z] of [[0, 0], [8200, 5200], [-12000, -3000], [6000, 4300]]) assert.ok(Math.abs(L.heightGrid(x, z) - L.sample(x, z)) < 1e-3);
  // fly east at 60 m above the plain toward the escarpment, holding full forward thrust: never inside the ground
  p.position.set(1500, groundAt(s, 1500, 3500) + 60, 3500);
  p.velocity.set(0, 0, 0);
  p.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);   // nose east
  let minClear = Infinity;
  g.step(60 * 10, (q) => { q.input.moveZ = 1; minClear = Math.min(minClear, q.player.position.y - groundAt(q, q.player.position.x, q.player.position.z)); });
  s.input.moveZ = 0;
  assert.ok(minClear > 10, 'kept clear of the rock: ' + minClear.toFixed(1));
  // a beam into a hillside dies there
  const hx = 6000, hz = 3000, hy = groundAt(s, hx, hz);
  const { makeEntity } = await import('../src/sim/util.js');
  const b = makeEntity(s, { type: 'beam', faction: 'enemy', name: 'TEST', radius: 2, hp: 1, heat: 1, ttl: 5, targetId: null, power: 1 });
  b.position.set(hx - 400, hy - 60, hz); b.velocity.set(2000, 0, 0); b.sim = { dmg: 0 };
  g.step(1);
  assert.equal(b.alive, false, 'stopped by the hill');
});

test('town: Circe never spawns near the town, the last wave comes from the east, and hostiles are turned away from it', () => {
  const g = game('story3c', { v: 1, chapter: 3 });
  g.step(2);
  const s = g.state;
  // jump to the pad talk and finish it: the last wave spawns
  st(g).stage = 'search';
  s.player.position.set(C.base[0] - 2000, 600, C.base[1]);
  g.step(2);
  const pad = st(g).ob.pad;
  assert.ok(g.until(() => st(g).stage === 'landed', 60 * 8, (q) => { q.player.position.set(pad.x, pad.y + SW.cockpitAboveDeck + 20, pad.z); q.player.velocity.set(0, 0, 0); }));
  for (let i = 0; i < 80 && st(g).stage === 'landed'; i++) { const t = st(g).talk; if (t && t.choices.length) t.sel = t.choices.length - 1; g.press(); }
  const wave = living(s, st(g).ob.waveIds);
  for (const e of wave) {
    assert.ok(Math.hypot(e.position.x, e.position.z) >= C.spawnClear - 1, 'spawned clear of the town');
    assert.ok(e.position.x > pad.x, 'from the east, not from the town side');
  }
  // a hostile that strays toward the town is pushed back out
  const e = wave[0];
  e.position.set(2500, 900, 0); e.velocity.set(-150, 0, 0);
  g.step(60 * 8, () => { e.sim.fireT = 99; });
  assert.ok(Math.hypot(e.position.x, e.position.z) > 3200, 'turned away: ' + Math.hypot(e.position.x, e.position.z).toFixed(0));
});

// ---- review fixes (2026-11-13) ----------------------------------------------------------------------------------------
async function onPadThenWave(g) {
  const s = g.state;
  st(g).stage = 'search';
  s.player.position.set(C.base[0] - 2000, 600, C.base[1]);
  g.step(2);
  const pad = st(g).ob.pad;
  assert.ok(g.until(() => st(g).stage === 'landed', 60 * 8, (q) => { q.player.position.set(pad.x, pad.y + SW.cockpitAboveDeck + 20, pad.z); q.player.velocity.set(0, 0, 0); }));
  for (let i = 0; i < 80 && st(g).stage === 'landed'; i++) { const t = st(g).talk; if (t && t.choices.length) t.sel = t.choices.length - 1; g.press(); }
  assert.equal(st(g).stage, 'defend');
}

test('review: a wreck that comes down on the land crashes (no endless disabled state)', async () => {
  const { groundAt } = await import('../src/sim/terrain.js');
  const g = game('story3c', { v: 1, chapter: 3 });
  g.step(2);
  const s = g.state;
  for (const e of s.entities) if (e.type === 'gustav') e.alive = false;
  s.player.position.set(6000, groundAt(s, 6000, 3000) + 400, 3000);
  s.sim.damagePlayer(5, null);
  assert.equal(s.phase, 'disabled');
  assert.ok(g.until(() => s.phase === 'ejected', 60 * 40), 'crashed: ' + s.phase);
  assert.match(s.mission.message.text, /ground/i);
  assert.equal(s.mission.result.victory, false);
});

test('review: the rebels guard the Xi - they leave far Gustavs to it, and their kills are not the player\'s', async () => {
  const g = game('story3c', { v: 1, chapter: 3, kills: 0 });
  g.step(2);
  const s = g.state;
  await onPadThenWave(g);
  // the wave holds 6 km off: the rebels stay on the Xi and do not fire
  const wave = living(s, st(g).ob.waveIds);
  const far = (q) => { for (const e of wave) if (e.alive) { e.position.copy(q.player.position).add(new THREE.Vector3(6000, 400, 0)); e.velocity.set(0, 0, 0); e.sim.fireT = 99; e.sim.missileT = 99; } };
  const fired0 = g.seen.filter((t) => t === 'allyFire').length;
  g.step(60 * 10, far);
  assert.equal(g.seen.filter((t) => t === 'allyFire').length, fired0, 'no rebel fire at Gustavs far from the Xi');
  assert.equal(living(s, st(g).ob.waveIds).length, C.waveCount);
  // one comes close: the rebels engage, and a rebel kill does not count as the player's
  const hits0 = s.sim.hits, kills0 = s.mission.kills;
  const e = wave[0];
  g.step(60 * 40, (q) => { far(q); if (e.alive) { e.position.copy(q.player.position).add(new THREE.Vector3(1200, 200, 0)); e.velocity.set(0, 0, 0); e.sim.fireT = 99; e.sim.missileT = 99; } });
  assert.ok(g.seen.includes('allyFire'), 'they engage a close one');
  assert.equal(s.sim.hits, hits0, 'rebel hits are not the player\'s hits');
  if (!e.alive) { assert.ok(g.seen.includes('allyKill')); assert.equal(s.mission.kills, kills0, 'nor their kills'); }
});

test('review: no shooting while the Xi is lifted out of the hold; PULL UP warns before a cliff but not on a hover descent', async () => {
  const { groundAt } = await import('../src/sim/terrain.js');
  const g = game('story3');
  g.step(2);
  walkToXi(g);
  coldStart(g);
  const s = g.state;
  let fired = 0;
  g.until(() => st(g).stage !== 'launch', 60 * 12, (q) => { q.input.triggerFull = true; });
  s.input.triggerFull = false;
  fired = g.seen.filter((t) => t === 'rifleFire').length;
  assert.equal(fired, 0, 'weapons safe in the hold');
  // flight form, level, toward the escarpment: PULL UP before the first scrape
  const p = s.player;
  p.position.set(1500, groundAt(s, 1500, 3500) + 150, 3500);
  p.flightMode = 'minovsky';
  p.velocity.set(450, 0, 0);
  p.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  let warnedFirst = null;
  for (let i = 0; i < 60 * 12; i++) {
    g.step(1, (q) => { q.input.moveZ = 0; });
    if (p.pullUp.active && warnedFirst === null) warnedFirst = 'warn';
    if (g.seen.includes('groundScrape')) { if (warnedFirst === null) warnedFirst = 'scrape'; break; }
  }
  if (g.seen.includes('groundScrape')) assert.equal(warnedFirst, 'warn', 'PULL UP came before the scrape');
  // hover: a straight descent onto the pad never warns (the ground assist holds it)
  const h = game('story3c', { v: 1, chapter: 3 });
  h.step(2);
  const hp = h.state.player, pad = { x: C.base[0], z: C.base[1] };
  hp.position.set(pad.x, groundAt(h.state, pad.x, pad.z) + 260, pad.z); hp.velocity.set(0, 0, 0);
  let warned = false;
  h.step(60 * 6, (q) => { q.input.moveY = -1; if (q.player.pullUp.active) warned = true; });
  assert.equal(warned, false);
});
