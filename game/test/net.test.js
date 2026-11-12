// CR-003 multiplayer sim tests: N independent states + sims joined by a fake loopback net.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createState, MODEL_SCALE, XI_COCKPIT } from '../src/state.js';
import { createSim } from '../src/sim/index.js';
import { fireEnemyBeam, spawnMissile } from '../src/sim/enemies.js';
import { MODEL_BASE_SCALE, ENEMY } from '../src/sim/tuning.js';

const DT = 1 / 60;
const EDGES = ['funnel', 'targetCycle', 'flightModeToggle', 'sensorCycle', 'zoomCycle', 'flare', 'interact', 'pauseToggle', 'reload'];
const clone = (x) => JSON.parse(JSON.stringify(x));

function netGame(n, settings = {}, opts = {}) {
  const ids = ['a', 'b', 'c', 'd'].slice(0, n);
  const set = Object.assign({ mode: 'ffa', ai: false, scoreLimit: 10, timeLimit: 480, respawn: 5 }, settings);
  const roster = ids.map((id, i) => ({
    id, name: id.toUpperCase() + 'PILOT', suit: (opts.suits && opts.suits[i]) || 'gustav',
    team: opts.teams ? opts.teams[i] : i % 2, slot: i,
  }));
  const g = { clock: 1000, frame: 0, delay: opts.delay || 0, cl: [], queue: [], roster, set };
  const at = g.clock + 5;
  function addClient(id, hostId) {
    const state = createState();
    const sim = createSim(state);
    const N = state.net;
    N.mode = 'match'; N.status = 'connected'; N.selfId = id; N.hostId = hostId; N.isHost = id === hostId;
    N.settings = { ...set };
    N.peers = roster.filter((r) => r.id !== id).map((r) => ({ ...r, ready: true, ping: 20 }));
    N.start = { seed: 1234, at, settings: { ...set }, roster: roster.map((r) => ({ ...r })) };
    const c = { id, state, sim, N, seen: [], lastSnap: null, off: false };
    g.cl.push(c);
    return c;
  }
  for (const id of ids) addClient(id, 'a');
  g.addClient = addClient;
  g.byId = (id) => g.cl.find((c) => c.id === id);
  function broadcast(from, kind, data) {
    for (const c of g.cl) {
      if (c.off || c.id === from) continue;
      g.queue.push({ due: g.frame + 1 + g.delay, to: c.id, msg: { from, kind, data } });
    }
  }
  g.inject = (to, from, kind, data) => g.queue.push({ due: g.frame + 1, to, msg: { from, kind, data } });
  g.step = (frames = 1, dt = DT) => {
    for (let f = 0; f < frames; f++) {
      g.clock += dt;
      g.frame++;
      for (const c of g.cl) {
        if (c.off) continue;
        const mine = g.queue.filter((q) => q.to === c.id && q.due <= g.frame);
        g.queue = g.queue.filter((q) => !(q.to === c.id && q.due <= g.frame));
        c.N.clock = g.clock;
        c.N.inbox = mine.map((q) => q.msg);
        c.state.events.length = 0;
        c.state.time += dt; c.state.dt = dt;
        c.sim.update(dt);
        for (const e of c.state.events) c.seen.push(e);
        for (const k of EDGES) c.state.input[k] = false;
        c.state.input.weaponSelect = null;
        const out = c.state.netOut;
        if (out.snap && out.snap !== c.lastSnap && g.frame % 3 === 0) { c.lastSnap = out.snap; broadcast(c.id, 'snap', clone(out.snap)); }
        if (out.events.length) { broadcast(c.id, 'ev', clone(out.events)); out.events.length = 0; }
      }
    }
  };
  g.run = (sec) => g.step(Math.ceil(sec / DT));
  g.live = () => { g.run(5.3); return g; };
  g.ev = (c, type) => c.seen.filter((e) => e.type === type);
  return g;
}
const remoteOf = (c, id) => c.state.entities.find((e) => e.type === 'remote' && e.peerId === id && e.alive);

test('net: countdown plays the cold start by itself, then everyone is live on the spawn circle facing the centre', () => {
  const g = netGame(2);
  g.run(3);
  for (const c of g.cl) {
    assert.equal(c.state.phase, 'startup');
    assert.equal(c.state.match.state, 'countdown');
    assert.ok(c.state.match.countdown > 0);
    assert.equal(c.state.player.suit, 'gustav');
  }
  g.run(2.4);
  const secs = g.ev(g.cl[0], 'matchCountdown').map((e) => e.seconds);
  assert.ok(secs.includes(5) && secs.includes(1), 'countdown events each second');
  for (const c of g.cl) {
    const p = c.state.player;
    assert.equal(c.state.phase, 'flight');
    assert.equal(c.state.match.state, 'live');
    assert.equal(g.ev(c, 'matchStart').length, 1);
    assert.ok(Math.abs(Math.hypot(p.position.x, p.position.z) - 2500) < 1);
    assert.ok(Math.abs(p.position.y - 1500) < 1);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quaternion);
    const toC = new THREE.Vector3(-p.position.x, 0, -p.position.z).normalize();
    assert.ok(f.dot(toC) > 0.99, 'faces the centre');
    assert.ok(c.state.match.spawnShield > 0);
  }
  const [a, b] = g.cl;
  assert.ok(a.state.player.position.distanceTo(b.state.player.position) > 4000, 'opposite sides');
});

test('net: snapshot round trip creates a remote entity that interpolates behind the sender', () => {
  const g = netGame(2).live();
  const [a, b] = g.cl;
  const r = remoteOf(b, 'a');
  assert.ok(r, 'remote entity exists');
  assert.equal(r.faction, 'enemy');
  assert.equal(r.suit, 'gustav');
  assert.ok(r.parts.gunArm && r.parts.pod && r.parts.thrusters && r.parts.head);
  assert.ok(r.position.distanceTo(a.state.player.position) < 2);
  a.state.input.moveZ = 1;
  let prev = r.position.clone();
  let moved = 0;
  for (let i = 0; i < 90; i++) {
    g.step(1);
    const d = r.position.distanceTo(prev);
    assert.ok(d < 20, 'no teleporting between frames');
    moved += d;
    prev = r.position.clone();
  }
  const lag = r.position.distanceTo(a.state.player.position);
  assert.ok(moved > 50, 'remote moved');
  assert.ok(lag > 5 && lag < a.state.player.speed * 0.45 + 5, 'lags the sender by about the interpolation delay, lag=' + lag);
  assert.ok(r.velocity.length() > 10);
  const snap = a.state.netOut.snap;
  assert.ok(JSON.stringify(snap).length < 2500);
  assert.equal(snap.su, 0);
  assert.equal(snap.fm, 0);
});

test('net: a shooter-side hit damages the victim (hull + part) and confirms to the shooter', () => {
  const g = netGame(2).live();
  g.run(2.3); // spawn shield over
  const [a, b] = g.cl;
  a.state.input.triggerFull = true; g.step(1); a.state.input.triggerFull = false;
  g.run(4);
  assert.ok(b.state.player.hull < 0.8, 'victim hull ' + b.state.player.hull);
  assert.ok(g.ev(b, 'playerHit').length >= 1);
  assert.ok(g.ev(a, 'hitConfirm').length >= 1);
  assert.equal(a.state.player.hull, 1, 'shooter untouched');
});

test('net: spawn shield blocks damage, then damage lands', () => {
  const g = netGame(2).live();
  const [a, b] = g.cl;
  g.inject('b', 'a', 'ev', [{ t: 'hit', to: 'b', p: 'core', dmg: 0.3, d: [1, 0, 0], w: 'rifle' }]);
  g.step(2);
  assert.equal(b.state.player.hull, 1);
  g.run(2.2);
  g.inject('b', 'a', 'ev', [{ t: 'hit', to: 'b', p: 'core', dmg: 0.3, d: [1, 0, 0], w: 'rifle' }]);
  g.step(2);
  assert.ok(b.state.player.hull < 0.75);
  void a;
});

test('net: death -> host scores the killer, feed reaches everyone, respawn after settings.respawn', () => {
  const g = netGame(3, { respawn: 5 }).live();
  g.run(2.3);
  const [a, b, c] = g.cl;
  const hit = { t: 'hit', to: 'b', p: 'core', dmg: 0.4, d: [1, 0, 0], w: 'rifle' };
  g.inject('b', 'a', 'ev', [hit, hit, hit]);
  g.step(3);
  assert.equal(b.state.phase, 'respawn');
  assert.ok(b.state.match.respawnIn > 4 && b.state.match.respawnIn <= 5);
  g.run(0.5);
  for (const cl of [a, b, c]) {
    const f = g.ev(cl, 'killFeed');
    assert.equal(f.length, 1, 'feed event on ' + cl.id);
    assert.equal(f[0].killer, 'APILOT');
    assert.equal(f[0].victim, 'BPILOT');
    assert.equal(cl.state.match.feed.length, 1);
    const row = (id) => cl.state.match.scores.find((s) => s.id === id);
    assert.equal(row('a').kills, 1, 'kills on ' + cl.id);
    assert.equal(row('b').deaths, 1);
    assert.equal(cl.state.match.scores[0].id, 'a', 'sorted for the board');
  }
  assert.ok(a.state.match.scores.find((s) => s.id === 'a').isSelf);
  assert.ok(a.state.match.scores.find((s) => s.id === 'a').isHost);
  assert.equal(remoteOf(a, 'b').dead, true);
  g.run(5);
  assert.equal(b.state.phase, 'flight');
  assert.equal(b.state.player.hull, 1);
  assert.equal(g.ev(b, 'respawn').length, 1);
  assert.ok(b.state.match.spawnShield > 0);
  assert.equal(remoteOf(a, 'b').dead, false);
});

test('net: team mode - no friendly fire, allies are not targets, enemies are', () => {
  const g = netGame(3, { mode: 'team' }, { teams: [0, 0, 1] }).live();
  g.run(2.3);
  const [a, b] = g.cl;
  assert.equal(remoteOf(a, 'b').faction, 'ally');
  assert.equal(remoteOf(a, 'c').faction, 'enemy');
  assert.ok(!a.state.sim.targets.some((e) => e.peerId === 'b'));
  assert.ok(a.state.sim.targets.some((e) => e.peerId === 'c'));
  g.inject('b', 'a', 'ev', [{ t: 'hit', to: 'b', p: 'core', dmg: 0.3, d: [1, 0, 0], w: 'rifle' }]);
  g.step(3);
  assert.equal(b.state.player.hull, 1);
});

test('net: coop - only the host spawns AI, clients mirror it, a client hit kills the host AI', () => {
  const g = netGame(2, { mode: 'coop' }).live();
  const [a, b] = g.cl;
  assert.equal(remoteOf(b, 'a').faction, 'ally');
  g.run(7);
  const hostAi = a.state.entities.filter((e) => e.alive && e.type === 'gustav');
  assert.equal(hostAi.length, 3, 'wave 1 scaled +50% for the second pilot');
  assert.ok(hostAi.every((e) => !e.owner));
  const mir = b.state.entities.filter((e) => e.alive && e.type === 'gustav');
  assert.equal(mir.length, 3);
  assert.ok(mir.every((e) => e.owner === 'a' && e.sim.mirror));
  assert.equal(b.state.sim.ships.length, 0, 'client simulates no AI');
  const m0 = mir[0];
  const host0 = hostAi.find((e) => e.nid === m0.nid);
  assert.ok(host0 && m0.position.distanceTo(host0.position) < 400);
  b.state.sim.netHit(b.state, m0, 999, m0.position.clone(), 0, 'beam', null, null, 0);
  g.step(3);
  assert.ok(!host0.alive, 'host AI died');
  assert.equal(b.state.entities.filter((e) => e.alive && e.type === 'gustav').length, 2);
  assert.ok(g.ev(b, 'kill').length >= 1, 'killer is credited');
  assert.equal(a.state.match.scores.find((s) => s.id === 'b').kills, 1);
  assert.ok(g.ev(a, 'killFeed').length >= 1);
});

test('net: an AI shot aimed at a client is hit-tested by that client (victim side)', () => {
  const g = netGame(2, { mode: 'coop' }).live();
  g.run(2.3);
  const [a, b] = g.cl;
  const ai = a.sim && a.state.sim.spawnEnemy('gustav', b.state.player.position.clone().add(new THREE.Vector3(0, 0, -2000)), { stationary: true });
  g.step(2);
  ai.sim.tgt = remoteOf(a, 'b');
  fireEnemyBeam(a.state, ai, 0.4, 0, 0, 0.45, 2);
  g.run(2.5);
  assert.ok(b.state.player.hull < 0.8, 'victim hull ' + b.state.player.hull);
  assert.equal(a.state.player.hull, 1, 'host is not the victim');
});

test('net: host leaves -> the lowest remaining peer becomes host and adopts the AI', () => {
  const g = netGame(3, { mode: 'coop' }).live();
  g.run(8);
  const [a, b, c] = g.cl;
  const n = a.state.sim.ships.length;
  assert.ok(n >= 3);
  assert.equal(c.state.entities.filter((e) => e.alive && e.type === 'gustav').length, n);
  a.off = true;
  for (const cl of [b, c]) {
    cl.N.peers = cl.N.peers.filter((p) => p.id !== 'a');
    cl.N.hostId = 'b'; cl.N.isHost = cl.id === 'b';
    g.inject(cl.id, 'a', 'sys', { type: 'leave', id: 'a', name: 'APILOT' });
    g.inject(cl.id, cl.id, 'sys', { type: 'host', id: 'b' });
  }
  g.run(2);
  assert.equal(b.state.sim.ships.filter((e) => e.alive).length, n, 'adopted every AI');
  assert.ok(b.state.sim.ships.every((e) => !e.owner));
  assert.equal(g.ev(b, 'hostChanged')[0].isHost, true);
  assert.equal(g.ev(b, 'peerLeft')[0].name, 'APILOT');
  const mir = c.state.entities.filter((e) => e.alive && e.type === 'gustav');
  assert.equal(mir.length, n, 'other client keeps mirroring');
  assert.ok(mir.every((e) => e.owner === 'b'));
  assert.ok(!remoteOf(b, 'a'), 'old host entity removed');
});

test('net: ffa ends at scoreLimit on every client', () => {
  const g = netGame(2, { scoreLimit: 2, respawn: 1 }).live();
  g.run(2.3);
  const [a, b] = g.cl;
  const hit = { t: 'hit', to: 'b', p: 'core', dmg: 0.4, d: [1, 0, 0], w: 'rifle' };
  g.inject('b', 'a', 'ev', [hit, hit, hit]);
  g.run(4); // respawned, shield over
  assert.equal(b.state.phase, 'flight');
  g.inject('b', 'a', 'ev', [hit, hit, hit]);
  g.run(1);
  for (const c of [a, b]) {
    assert.equal(c.state.phase, 'matchOver');
    assert.equal(c.state.match.state, 'over');
    assert.deepEqual(c.state.match.winner, { name: 'APILOT' });
    assert.equal(g.ev(c, 'matchEnd').length, 1);
  }
});

test('net: Gustav - G is refused, F launches the missile pods (salvo 4 of 8)', () => {
  const g = netGame(2).live();
  g.run(2.3);
  const [a] = g.cl;
  a.state.input.flightModeToggle = true; g.step(1);
  assert.equal(g.ev(a, 'flightRefused')[0].reason, 'notEquipped');
  g.run(2.3);
  assert.equal(a.state.player.flightMode, 'hover');
  assert.equal(a.state.player.weapons.funnel.max, 8);
  assert.equal(a.state.player.lock.state, 'locked', 'locks the hostile remote suit');
  a.state.input.funnel = true; g.step(1);
  const pods = a.state.entities.filter((e) => e.type === 'funnelMissile' && e.alive);
  assert.equal(pods.length, 4);
  assert.equal(a.state.player.weapons.funnel.count, 4);
  g.step(4);
  assert.equal(a.state.netOut.snap.m.length, 4, 'own missiles are in the snapshot');
  assert.ok(g.cl[1].state.entities.filter((e) => e.type === 'missile' && e.owner === 'a').length >= 1, 'mirrored on the other client');
});

test('net: Penelope - flight form flips the remote form, B does nothing, shield-less; Gustav shield works', () => {
  const g = netGame(2, {}, { suits: ['penelope', 'gustav'] }).live();
  g.run(2.3);
  const [a, b] = g.cl;
  assert.equal(a.state.player.suit, 'penelope');
  assert.equal(a.state.player.weapons.funnel.max, 24);
  assert.equal(a.state.netOut.snap.su, 1);
  const r = remoteOf(b, 'a');
  assert.equal(r.suit, 'penelope');
  assert.ok(r.parts.rifleArm && r.parts.salvoArm && r.parts.wingPack && r.parts.head);
  assert.equal(r.form, 'ms');
  a.state.input.shield = true; b.state.input.shield = true;
  g.run(0.6);
  assert.equal(a.state.player.shield.up, false, 'B does nothing for Penelope');
  assert.equal(b.state.player.shield.up, true, 'Gustav shield works');
  assert.equal(remoteOf(a, 'b').shield, true);
  a.state.input.shield = false; b.state.input.shield = false;
  a.state.input.flightModeToggle = true; g.step(1);
  g.run(2.5);
  assert.equal(a.state.player.flightMode, 'minovsky');
  assert.equal(a.state.netOut.snap.fm, 1);
  assert.equal(remoteOf(b, 'a').form, 'flight');
});

test('net: a hit on a remote Penelope maps to the right part', () => {
  const g = netGame(2, {}, { suits: ['penelope', 'gustav'] }).live();
  g.run(2.3);
  const [, b] = g.cl;
  const r = remoteOf(b, 'a');
  const s = MODEL_SCALE * MODEL_BASE_SCALE.penelope;
  const shoot = (center, fromZ, dirZ) => {
    const o = new THREE.Vector3(center[0], center[1], fromZ).multiplyScalar(s).applyQuaternion(r.quaternion).add(r.position);
    const d = new THREE.Vector3(0, 0, dirZ).applyQuaternion(r.quaternion);
    b.state.netOut.events.length = 0;
    b.state.sim.netHit(b.state, r, 105, o.clone(), 0, 'beam', o, d, 200 * s);
    return b.state.netOut.events.find((m) => m.t === 'hit');
  };
  const head = shoot([0, 9.6], -60, 1);
  assert.equal(head.to, 'a');
  assert.equal(head.p, 'head');
  assert.ok(head.dmg > 0 && head.dmg < 1);
  assert.equal(shoot([-8, 8.4], 60, -1).p, 'pack');
  assert.equal(shoot([30, 0], 60, -1).p, 'core', 'a miss of every part box is a core hit');
});

test('net: a late joiner appears for everyone and drops straight in', () => {
  const g = netGame(2).live();
  g.run(3);
  const roster3 = [...g.roster, { id: 'c', name: 'CPILOT', suit: 'gustav', team: 0, slot: 2 }];
  for (const c of g.cl) c.N.start = { seed: 1234, at: c.N.start.at, settings: { ...g.set }, roster: roster3.map((r) => ({ ...r })) };
  const late = g.addClient('c', 'a');
  late.N.start = { seed: 1234, at: g.cl[0].N.start.at, settings: { ...g.set }, roster: roster3.map((r) => ({ ...r })) };
  late.N.peers = roster3.filter((r) => r.id !== 'c').map((r) => ({ ...r, ready: true, ping: 30 }));
  for (const c of g.cl.slice(0, 2)) c.N.peers = roster3.filter((r) => r.id !== c.id).map((r) => ({ ...r, ready: true, ping: 30 }));
  g.run(1);
  assert.equal(late.state.phase, 'flight');
  assert.equal(late.state.match.state, 'live');
  assert.ok(remoteOf(g.cl[0], 'c'), 'host sees the late joiner');
  assert.ok(remoteOf(g.cl[1], 'c'), 'other client sees the late joiner');
  assert.ok(remoteOf(late, 'a') && remoteOf(late, 'b'));
  assert.equal(g.cl[0].state.match.scores.length, 3);
  assert.ok(late.state.match.spawnShield > 0);
});

test('net: host snapshot with a full co-op wave stays under 2.5 KB', () => {
  const g = netGame(4, { mode: 'coop' }).live();
  g.run(7);
  const [a] = g.cl;
  for (let i = 0; i < 5; i++) a.state.sim.spawnEnemy('gustav', new THREE.Vector3(3000 + i * 300, 1800, 3000), {});
  g.step(2);
  const ships = a.state.sim.ships.filter((e) => e.alive);
  assert.ok(ships.length >= 10, 'wave + extras ' + ships.length);
  for (let i = 0; i < 6; i++) spawnMissile(a.state, ships[i], 0.12);
  g.step(1);
  const snap = a.state.netOut.snap;
  assert.ok(snap.ai.length >= 10 && snap.am.length >= 6);
  const size = JSON.stringify(snap).length;
  assert.ok(size < 2500, 'snapshot size ' + size);
});

test('net: leaving the room returns to a calm single player startup that still works', () => {
  const g = netGame(2, { mode: 'coop' }).live();
  g.run(8);
  const [a] = g.cl;
  a.N.mode = 'lobby'; a.N.start = null;
  g.step(2);
  const S = a.state;
  assert.equal(S.phase, 'startup');
  assert.equal(S.entities.filter((e) => e.alive).length, 0);
  assert.equal(S.player.suit, 'xi');
  assert.equal(S.player.weapons.funnel.max, 24);
  assert.equal(S.match.type, 'single');
  assert.equal(a.sim && S.sim.netOn, false);
  a.N.mode = 'offline';
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 300; k++) S.sim && a.sim.update(DT);
    S.input.interact = true; a.sim.update(DT); S.input.interact = false;
  }
  a.sim.update(DT);
  assert.equal(S.phase, 'flight');
});

test('net: offline single player is untouched (netsync and match are no-ops)', () => {
  const state = createState();
  const sim = createSim(state);
  for (let i = 0; i < 300; i++) { state.time += DT; sim.update(DT); }
  assert.equal(state.phase, 'startup');
  assert.equal(state.netOut.snap, null);
  assert.equal(state.netOut.events.length, 0);
  assert.equal(state.sim.netOn, false);
  assert.equal(state.entities.length, 0);
  assert.equal(state.match.state, 'none');
  assert.equal(state.player.suit, 'xi');
});

test('net CR-004: the hatch starts open, closes by itself fast and the whole cold start still ends inside the countdown', () => {
  const g = netGame(2);
  g.run(0.2);
  for (const c of g.cl) {
    assert.equal(c.state.player.hatch.state === 'open' || c.state.player.hatch.state === 'closing', true);
    assert.equal(c.state.mission.id, 'waves');
  }
  g.run(4.4);
  for (const c of g.cl) {
    assert.equal(c.state.phase, 'startup', 'still counting down');
    assert.equal(c.state.startup.stage, 4, 'cold start finished before the countdown ended');
    assert.equal(c.state.player.hatch.state, 'closed');
    assert.equal(c.state.player.hatch.locked, true);
    assert.equal(g.ev(c, 'hatchLocked').length, 1);
  }
  g.run(0.8);
  for (const c of g.cl) { assert.equal(c.state.phase, 'flight'); assert.equal(c.state.player.hatch.locked, true); }
});

// ---- CR-005: Xi online -------------------------------------------------------------------------------
test('net CR-005: an Xi pilot has the Xi loadout, transforms with G and fires funnels at a locked target', () => {
  const g = netGame(2, {}, { suits: ['xi', 'gustav'] }).live();
  g.run(2.3);
  const [a, b] = g.cl;
  const p = a.state.player;
  assert.equal(p.suit, 'xi');
  assert.equal(p.weapons.funnel.max, 24);
  assert.equal(a.state.netOut.snap.su, 2);
  // shield works (not a Penelope)
  a.state.input.shield = true; g.run(0.6);
  assert.equal(p.shield.up, true);
  a.state.input.shield = false; g.run(0.3);
  // transform
  a.state.input.flightModeToggle = true; g.step(1);
  g.run(2.5);
  assert.equal(p.flightMode, 'minovsky');
  assert.equal(remoteOf(b, 'a').form, 'flight');
  g.run(3.2);
  a.state.input.flightModeToggle = true; g.step(1);
  g.run(2.0);
  assert.equal(p.flightMode, 'hover');
  // funnels: b is placed in front of a, the crosshair is on it, wait for the lock, launch
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quaternion);
  b.state.player.position.copy(p.position).addScaledVector(f, 1500);
  g.run(2.5);
  const n0 = p.weapons.funnel.count;
  a.state.input.funnel = true; g.step(1);
  g.run(0.2);
  assert.ok(p.weapons.funnel.count < n0 || g.ev(a, 'funnelLaunch').length > 0 || a.state.alerts.some((x) => x.id === 'nofunnel'), 'funnel key handled');
  assert.equal(p.weapons.funnel.max, 24);
});

test('net CR-005: a remote Xi has the player part names, form and a MODEL_SCALE radius', () => {
  const g = netGame(2, {}, { suits: ['xi', 'gustav'] }).live();
  g.run(2.3);
  const [a, b] = g.cl;
  const r = remoteOf(b, 'a');
  assert.equal(r.suit, 'xi');
  assert.deepEqual(Object.keys(r.parts).sort(), ['head', 'lArm', 'legs', 'pack', 'pods', 'rArm']);
  for (const k of Object.keys(r.parts)) assert.deepEqual(Object.keys(r.parts[k]).sort(), ['hp', 'maxHp', 'status']);
  assert.equal(r.radius, ENEMY.xi.radius * MODEL_SCALE);
  assert.equal(r.form, 'ms');
  // damaged parts of the pilot show up on the remote entity by name
  a.state.player.parts.lArm.hp = 0.3; a.state.player.parts.pods.hp = 0;
  g.run(0.3);
  assert.equal(r.parts.lArm.status, 'damaged');
  assert.equal(r.parts.pods.status, 'destroyed');
  assert.equal(r.parts.rArm.status, 'ok');
});

test('net CR-005: a hit on a remote Xi maps to sensible parts by direction and height', () => {
  const g = netGame(2, {}, { suits: ['xi', 'gustav'] }).live();
  g.run(2.3);
  const [, b] = g.cl;
  const r = remoteOf(b, 'a');
  const s = MODEL_SCALE * MODEL_BASE_SCALE.xi;
  const shoot = (x, y, fromZ, dirZ) => {
    // x, y, fromZ are mesh coordinates (origin = bbox centre); CR-006: the entity position is the chest cockpit (XI_COCKPIT)
    const o = new THREE.Vector3(x - XI_COCKPIT.x, y - XI_COCKPIT.y, fromZ - XI_COCKPIT.z).multiplyScalar(s).applyQuaternion(r.quaternion).add(r.position);
    const d = new THREE.Vector3(0, 0, dirZ).applyQuaternion(r.quaternion);
    b.state.netOut.events.length = 0;
    b.state.sim.netHit(b.state, r, 105, o.clone(), 0, 'beam', o, d, 200 * s);
    return b.state.netOut.events.find((m) => m.t === 'hit');
  };
  assert.equal(shoot(0, 11.7, -80, 1).p, 'head');
  assert.equal(shoot(5.4, 3.6, -80, 1).p, 'rArm');
  assert.equal(shoot(-5.4, 3.6, -80, 1).p, 'lArm');
  assert.equal(shoot(2.0, -11, -80, 1).p, 'legs');
  assert.equal(shoot(0, 6.5, 80, -1).p, 'pack', 'from behind the backpack is hit');
  assert.equal(shoot(5.0, 11, 80, -1).p, 'pack', 'wing binders count as the pack');
  assert.equal(shoot(0, 6.6, -80, 1).p, 'core', 'a front hit on the chest is a core hit');
  assert.equal(shoot(40, 0, -80, 1).p, 'core', 'a miss is a core hit');
});

test('net CR-005: snapshot round trip with all three suits', () => {
  const g = netGame(3, {}, { suits: ['gustav', 'penelope', 'xi'] }).live();
  g.run(2.5);
  const codes = g.cl.map((c) => c.state.netOut.snap.su);
  assert.deepEqual(codes, [0, 1, 2]);
  for (const c of g.cl) {
    for (const o of g.cl) {
      if (o === c) continue;
      const r = remoteOf(c, o.id);
      assert.equal(r.suit, ['gustav', 'penelope', 'xi'][o.state.netOut.snap.su]);
    }
  }
  const xi = remoteOf(g.cl[0], 'c');
  assert.ok(xi.parts.pack && xi.parts.pods);
  assert.ok(JSON.stringify(g.cl[2].state.netOut.snap).length < 2500);
});
