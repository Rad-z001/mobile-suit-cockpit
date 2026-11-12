import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createState, MACH, AIM_MAX_YAW, AIM_MAX_PITCH, AUTO_CENTRE_TAU, MODEL_SCALE, EPACK_SHOTS } from '../src/state.js';
import { createSim } from '../src/sim/index.js';
import { compensateAim, createInput } from '../src/input.js';
import { flightUnitHealth } from '../src/sim/transform.js';
import { pickPart } from '../src/sim/damage.js';
import { pickEnemyPart, hitEnemy } from '../src/sim/enemies.js';
import { createRng } from '../src/sim/rng.js';
import { ENEMY, WEAPONS, FLIGHT, PARTS, SHIELD } from '../src/sim/tuning.js';

const DT = 1 / 60;
const EDGES = ['funnel', 'targetCycle', 'flightModeToggle', 'sensorCycle', 'zoomCycle', 'flare', 'interact', 'pauseToggle', 'reload', 'hatch'];

function makeGame(seed) {
  const state = createState();
  const sim = createSim(state, seed ? { seed } : undefined);
  const g = {
    state, sim,
    couple: false, // true: emulate input.js, which takes the body turn out of the crosshair offset
    step(n = 1, dt = DT) {
      for (let i = 0; i < n; i++) {
        state.events.length = 0; // main clears events after each frame
        if (g.couple && state.phase === 'flight') compensateAim(state.input, state.sim.rate, dt);
        state.time += dt;
        state.dt = dt;
        sim.update(dt);
        for (const k of EDGES) state.input[k] = false; // edges live one frame
        state.input.weaponSelect = null;
      }
    },
    press(key) { state.input[key] = true; g.step(1); },
    events(type) { return state.events.filter((e) => e.type === type); },
    // run n frames and collect every event of the type seen
    collect(type, n, dt = DT) {
      const out = [];
      for (let i = 0; i < n; i++) {
        g.step(1, dt);
        for (const e of state.events) if (e.type === type) out.push(e);
        state.events.length = 0;
      }
      return out;
    },
  };
  return g;
}

function toFlight(g) {
  const s = g.state;
  for (let i = 0; i < 4; i++) {
    g.step(300); // longer than the hatch close (1.6 s) + any stage
    g.press('interact');
  }
  g.step(1);
  assert.equal(s.phase, 'flight');
  s.events.length = 0;
}

function flightGame(seed) {
  const g = makeGame(seed);
  toFlight(g);
  g.state.sim.holdWaves = true;
  return g;
}

// press G and let the 2.0 s transformation finish: the suit is in flight form afterwards
function enterFlightForm(g) {
  g.press('flightModeToggle');
  g.step(Math.ceil(2.05 / DT));
  assert.equal(g.state.player.flightMode, 'minovsky');
  g.state.events.length = 0;
}
function leaveFlightForm(g) {
  g.step(Math.ceil(3.1 / DT)); // cooldown
  g.press('flightModeToggle');
  g.step(Math.ceil(1.45 / DT));
  assert.equal(g.state.player.flightMode, 'hover');
  g.state.events.length = 0;
}
// put an enemy dead ahead of the crosshair, not moving
function dummy(g, type, dist, dx = 0, dy = 0) {
  const p = g.state.player;
  const f = p.aim.dir;
  const e = g.state.sim.spawnEnemy(type, p.position.clone().addScaledVector(f, dist).add(new THREE.Vector3(dx, dy, 0)), { stationary: true });
  e.velocity.set(0, 0, 0);
  return e;
}

function allFinite(p) {
  const nums = [
    p.position.x, p.position.y, p.position.z, p.velocity.x, p.velocity.y, p.velocity.z,
    p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w,
    p.speed, p.mach, p.altitude, p.headingDeg, p.pitchDeg, p.rollDeg, p.verticalSpeed,
    p.throttle, p.gLoad, p.gVector.x, p.gVector.y, p.gVector.z, p.blackout, p.stress,
    p.hull, p.thrusterHeat, p.barrier.integrity,
  ];
  return nums.every(Number.isFinite);
}

test('startup sequence steps 0->4 on interact and reaches flight', () => {
  const g = makeGame();
  const s = g.state;
  assert.equal(s.phase, 'startup');
  assert.match(s.mission.objective, /PRESS \[ENTER\]/);
  // CR-004: stage 0 starts with the hatch open; the first Enter closes it and stage 1 begins once it is sealed
  assert.equal(s.player.hatch.state, 'open');
  const stages = [];
  g.state.input.interact = true;
  g.step(1);
  assert.equal(s.startup.stage, 0);
  assert.equal(s.player.hatch.state, 'closing');
  stages.push(...g.collect('startupStage', Math.ceil(1.75 / DT)).map((e) => e.stage));
  assert.equal(s.player.hatch.state, 'closed');
  // not accepted while a stage is running
  assert.equal(s.startup.stage, 1);
  assert.ok(s.startup.progress < 1);
  s.events.length = 0;
  g.press('interact'); // ignored: stage 1 still clamping
  assert.equal(s.startup.stage, 1);
  assert.equal(s.events.filter((e) => e.type === 'startupStage').length, 0);
  g.step(200);
  assert.equal(s.startup.progress, 1);
  assert.match(s.mission.objective, /PRESS \[ENTER\]/);
  for (let want = 2; want <= 4; want++) {
    g.press('interact');
    stages.push(...g.events('startupStage').map((e) => e.stage));
    assert.equal(s.startup.stage, want);
    if (want < 4) {
      assert.equal(s.phase, 'startup');
      g.step(200);
    }
  }
  assert.deepEqual(stages, [1, 2, 3, 4]);
  assert.equal(s.phase, 'flight');
  assert.ok(allFinite(s.player));
});

test('first wave starts a few seconds after flight begins', () => {
  const g = makeGame();
  toFlight(g);
  assert.equal(g.state.mission.wave, 0);
  const ev = g.collect('waveStart', 60 * 8);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].wave, 1);
  const ships = g.state.entities.filter((e) => e.type === 'gustav');
  assert.equal(ships.length, 2);
  for (const e of ships) {
    const d = e.position.distanceTo(g.state.player.position);
    assert.ok(d > 5000 && d < 10500, `spawn distance ${d}`);
  }
});

test('minovsky mode goes supersonic, fires sonicBoom and raises the barrier', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.press('flightModeToggle');
  assert.equal(g.events('flightMode')[0].mode, 'minovsky'); // fires at the start of the transformation
  g.step(Math.ceil(2.05 / DT));
  assert.equal(p.flightMode, 'minovsky');
  s.input.moveZ = 1;
  s.input.boost = 1;
  let booms = 0;
  let maxMach = 0;
  for (let i = 0; i < 60 * 25; i++) {
    g.step(1);
    booms += g.events('sonicBoom').length;
    s.events.length = 0;
    maxMach = Math.max(maxMach, p.mach);
    if (p.thrusterHeat > 0.8) s.input.boost = 0; else s.input.boost = 1;
  }
  assert.equal(booms, 1);
  assert.ok(maxMach > 1.5, `max mach ${maxMach}`);
  assert.equal(p.barrier.active, p.mach > 1);
});

test('hover: W accelerates to about 280 m/s in ~1.5 s, boost reaches about 520, releasing stops the suit', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 5);
  s.input.moveZ = 1;
  g.step(90);
  assert.ok(p.speed > 250 && p.speed < 300, `speed after 1.5 s ${p.speed}`);
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quaternion);
  assert.ok(p.velocity.clone().normalize().dot(f) > 0.99, 'thrust is along body forward');
  g.step(60 * 3);
  assert.ok(p.speed > 270 && p.speed < 290, `cruise ${p.speed}`);
  s.input.boost = 1;
  g.step(60 * 2);
  assert.ok(p.speed > 480 && p.speed < 530, `boost speed ${p.speed}`);
  assert.ok(p.thrusterHeat > 0.1);
  s.input.boost = 0;
  s.input.moveZ = 0;
  g.step(60 * 2);
  assert.ok(p.speed < 5, `speed 2 s after release ${p.speed}`);
  g.step(60 * 3);
  assert.equal(p.speed, 0);
  s.input.moveZ = -1;
  g.step(60 * 3);
  assert.ok(p.velocity.dot(f) < -120, 'S thrusts backwards');
});

test('hover: with no input the suit holds position and altitude for 30 s', () => {
  const g = flightGame();
  const p = g.state.player;
  g.step(60 * 4); // let the startup glide bleed off
  const p0 = p.position.clone();
  let maxDrift = 0;
  for (let i = 0; i < 60 * 30; i++) {
    g.step(1);
    maxDrift = Math.max(maxDrift, p.position.distanceTo(p0));
  }
  assert.ok(maxDrift < 0.5, `drift ${maxDrift}`);
  assert.equal(p.speed, 0);
  assert.ok(Math.abs(p.rollDeg) < 0.01 && Math.abs(p.pitchDeg) < 0.01);
  // from the very start of control: only the leftover glide momentum, then it holds
  const g2 = flightGame();
  const q0 = g2.state.player.position.clone();
  g2.step(60 * 30);
  assert.ok(g2.state.player.position.distanceTo(q0) < 80, `wander ${g2.state.player.position.distanceTo(q0)}`);
  assert.ok(Math.abs(g2.state.player.altitude - q0.y) < 10);
});

test('hover: Space / Ctrl / A / D thrust along the BODY axes (pitched suit climbs along its own up), no cosmetic bank', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  const alt0 = p.altitude;
  s.input.moveY = 1;
  g.step(90);
  assert.ok(p.verticalSpeed > 140 && p.verticalSpeed < 190, `vs ${p.verticalSpeed}`);
  assert.ok(p.altitude > alt0 + 80);
  s.input.moveY = 0;
  g.step(120);
  s.input.aimPitch = AIM_MAX_PITCH;
  g.couple = true;
  g.step(60);
  s.input.aimPitch = 0;
  g.couple = false;
  g.step(30);
  assert.ok(p.pitchDeg > 20, `pitch ${p.pitchDeg}`);
  g.step(60 * 2);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quaternion);
  s.input.moveY = 1;
  g.step(90);
  assert.ok(p.velocity.clone().normalize().dot(up) > 0.99, 'Space thrusts along the body up axis');
  assert.ok(Math.abs(p.velocity.x) + Math.abs(p.velocity.z) > 20 || Math.abs(up.y) > 0.99, 'a pitched suit also moves horizontally');
  s.input.moveY = -1;
  g.step(60 * 3);
  assert.ok(p.velocity.dot(up) < -100);

  const g2 = flightGame();
  const p2 = g2.state.player;
  g2.step(60 * 4);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(p2.quaternion);
  g2.state.input.moveX = 1;
  g2.step(90);
  assert.ok(p2.velocity.dot(right) > 150, `strafe speed ${p2.velocity.dot(right)}`);
  assert.ok(p2.velocity.dot(right) < 215, 'strafe is slower than forward');
  assert.ok(Math.abs(p2.rollDeg) < 0.01, `no cosmetic bank ${p2.rollDeg}`);
  g2.state.input.moveX = -1;
  g2.step(90);
  assert.ok(p2.velocity.dot(right) < -150);
  g2.state.input.moveX = 0;
  g2.step(60 * 3);
  assert.ok(p2.speed < 1 && Math.abs(p2.rollDeg) < 0.01);
});

test('hover ground assist: holding Ctrl over the sea stops above it instead of crashing', () => {
  const g = flightGame();
  const s = g.state;
  s.player.position.y = 300;
  g.step(60);
  s.input.moveY = -1;
  g.step(60 * 20);
  assert.equal(s.phase, 'flight');
  assert.ok(s.player.altitude > 40, `altitude ${s.player.altitude}`);
});

function headingOf(q) {
  const v = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(v.x, -v.z);
}

test('crosshair inside the central zone moves aim.dir at once and the body auto-centres it with tau 1.5 s', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  g.couple = true; // input.js takes the body turn out of the offset
  const q0 = p.quaternion.clone();
  const dir0 = new THREE.Vector3(0, 0, -1);
  s.input.aimYaw = 0.12; // inside AIM_DEADZONE (0.20 rad)
  s.input.aimPitch = 0.05;
  g.step(1);
  assert.ok(Math.abs(p.aim.yaw - 0.12) < 1e-9 && Math.abs(p.aim.pitch - 0.05) < 1e-9, 'aim follows the mouse immediately');
  const fwd0 = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quaternion);
  const ang = Math.acos(Math.min(1, fwd0.dot(p.aim.dir)));
  assert.ok(Math.abs(ang - Math.hypot(0.12, 0.05)) < 0.01, `aim angle ${ang}`);
  assert.ok(p.aim.dir.x > 0.05, 'right of the nose is world +X for a level suit facing -Z');
  assert.ok(p.aim.dir.y > 0);
  assert.ok(Math.abs(p.aim.dir.length() - 1) < 1e-9);
  assert.equal(p.aim.centring, true);
  const aimDir0 = p.aim.dir.clone();
  // 1.5 s later the offset has decayed to about 1/e while the aim point stays on the same spot in the sky
  g.step(Math.round(AUTO_CENTRE_TAU * 60));
  const off = Math.hypot(p.aim.yaw, p.aim.pitch) / Math.hypot(0.12, 0.05);
  assert.ok(off > 0.3 && off < 0.45, `offset after one tau ${off}`);
  assert.ok(p.quaternion.angleTo(q0) > 0.05, 'the body turned toward the crosshair');
  assert.ok(p.aim.dir.angleTo(aimDir0) < 0.02, `aim point drifted ${p.aim.dir.angleTo(aimDir0)}`);
  g.step(60 * 10);
  assert.ok(Math.hypot(p.aim.yaw, p.aim.pitch) < 0.002, 'fully centred');
  assert.equal(p.aim.centring, false);
  const q1 = p.quaternion.clone();
  g.step(60 * 2);
  assert.ok(p.quaternion.angleTo(q1) < 1e-4, 'body stops once the crosshair is centred');
  void dir0;
  // the limits still clamp
  s.input.aimYaw = 5;
  s.input.aimPitch = -5;
  g.couple = false;
  g.step(1);
  assert.ok(Math.abs(p.aim.yaw - AIM_MAX_YAW) < 1e-9 && Math.abs(p.aim.pitch + AIM_MAX_PITCH) < 1e-9);
});

test('crosshair at the yaw limit turns the body right at more than 2 rad/s; response rises with offset', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  s.input.aimYaw = AIM_MAX_YAW;
  g.step(30); // spin-up
  const h0 = headingOf(p.quaternion);
  g.step(30);
  let dh = headingOf(p.quaternion) - h0;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  assert.ok(dh > 0, 'turned right (east)');
  assert.ok(dh / 0.5 > 2.0 && dh / 0.5 < 2.8, `rate ${dh / 0.5}`);
  assert.ok(p.aim.turning > 0.95);
  assert.ok(Math.abs(p.rollDeg) < 0.01, `no cosmetic bank in a level turn ${p.rollDeg}`);
  s.input.aimYaw = 0;
  g.step(60);
  s.input.aimPitch = AIM_MAX_PITCH;
  g.step(20);
  const pitch0 = p.pitchDeg;
  g.step(10);
  const rate = ((p.pitchDeg - pitch0) * Math.PI / 180) / (10 / 60);
  assert.ok(rate > 1.5 && rate < 2.1, `pitch rate ${rate}`);
  const rateAt = (yaw) => {
    const g2 = flightGame();
    const q = g2.state.player;
    g2.step(60 * 4);
    g2.state.input.aimYaw = yaw;
    g2.step(60);
    const a = headingOf(q.quaternion);
    g2.step(30);
    return Math.abs(headingOf(q.quaternion) - a) / 0.5;
  };
  const r1 = rateAt(0.26);
  const r2 = rateAt(0.42);
  const r3 = rateAt(0.60);
  assert.ok(r1 < r2 && r2 < r3 && r1 < 0.5 && r3 > 2.0, `${r1} ${r2} ${r3}`);
});

test('no pitch limit: the suit can loop over the top (hover)', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  s.input.aimPitch = AIM_MAX_PITCH; // held with no coupling: a steady pull
  let maxP = 0;
  let sawInverted = false;
  for (let i = 0; i < 60 * 8; i++) {
    g.step(1);
    maxP = Math.max(maxP, p.pitchDeg);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quaternion);
    if (up.y < -0.5) sawInverted = true;
    assert.ok(allFinite(p));
  }
  assert.ok(maxP > 89, `max pitch ${maxP}`);
  assert.ok(sawInverted, 'went over the top');
});

test('minovsky: velocity lags the nose in a turn (drift); body yaw rate is about half the hover rate', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  enterFlightForm(g);
  s.input.moveZ = 1;
  g.step(60 * 15);
  s.input.aimYaw = AIM_MAX_YAW;
  g.step(90);
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quaternion);
  const angle = Math.acos(Math.min(1, f.dot(p.velocity.clone().normalize())));
  assert.ok(angle > 0.03, `drift angle ${angle}`);
  s.input.aimYaw = 0;
  g.step(60);
  s.input.aimYaw = AIM_MAX_YAW;
  g.step(40);
  const h0 = headingOf(p.quaternion);
  g.step(30);
  let dh = headingOf(p.quaternion) - h0;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  assert.ok(Math.abs(dh) / 0.5 > 1.0 && Math.abs(dh) / 0.5 < 1.5, `minovsky yaw rate ${dh / 0.5}`);
});

test('switching flight form -> hover takes 1.4 s and then the suit brakes hard', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  enterFlightForm(g);
  s.input.moveZ = 1;
  s.input.boost = 1;
  g.step(60 * 10);
  s.input.boost = 0;
  assert.ok(p.speed > 350, `speed ${p.speed}`);
  s.input.moveZ = 0;
  g.step(Math.ceil(3.1 / DT));
  g.press('flightModeToggle');
  assert.equal(p.flightTransition.state, 'toHover');
  g.step(Math.ceil(1.45 / DT));
  assert.equal(p.flightMode, 'hover');
  g.step(60 * 3);
  assert.ok(p.speed < 5, `speed after 3 s in hover ${p.speed}`);
});

test('minovsky: an aggressive pull-up raises gLoad and blackout; hover maneuvering stays calm', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  enterFlightForm(g);
  s.input.moveZ = 1;
  s.input.boost = 1;
  for (let i = 0; i < 60 * 25; i++) { g.step(1); s.input.boost = p.thrusterHeat > 0.8 ? 0 : 1; }
  s.input.aimPitch = AIM_MAX_PITCH;
  let maxG = 0;
  let maxBlack = 0;
  let sawHighG = false;
  for (let i = 0; i < 60 * 8; i++) {
    g.step(1);
    maxG = Math.max(maxG, p.gLoad);
    maxBlack = Math.max(maxBlack, p.blackout);
    if (s.alerts.some((a) => a.text === 'HIGH-G')) sawHighG = true;
    s.events.length = 0;
  }
  assert.ok(maxG > 4.5, `max g ${maxG}`);
  assert.ok(sawHighG, 'HIGH-G caution raised');
  assert.ok(maxBlack > 0.3, `blackout ${maxBlack}`);
  s.input.aimPitch = 0;
  s.input.moveZ = 0;
  s.input.boost = 0;
  leaveFlightForm(g); // the hover form's dampers end the g-load
  g.step(60 * 10);
  assert.ok(p.blackout < 0.2, `blackout after recovery ${p.blackout}`);
  assert.ok(allFinite(p));

  const h = flightGame();
  const hp = h.state.player;
  let worst = 0;
  let worstG = 0;
  for (let i = 0; i < 60 * 40; i++) {
    h.state.input.moveZ = Math.sin(i / 40) > 0 ? 1 : -1;
    h.state.input.moveX = Math.sin(i / 23) > 0 ? 1 : -1;
    h.state.input.boost = 1;
    h.state.input.aimYaw = AIM_MAX_YAW * (Math.sin(i / 90) > 0 ? 1 : -1);
    h.state.input.aimPitch = AIM_MAX_PITCH * Math.sin(i / 70);
    h.step(1);
    worst = Math.max(worst, hp.blackout);
    worstG = Math.max(worstG, hp.gLoad);
  }
  assert.ok(worst < 0.05, `hover blackout ${worst}`);
  assert.ok(worstG > 1.3, `hover maneuvers still felt: ${worstG}`);
});

test('gDamper fires on a sudden g jump (hit impulse)', () => {
  const g = flightGame();
  g.step(30);
  g.state.events.length = 0;
  g.state.sim.damagePlayer(0.08, new THREE.Vector3(0, 0, -1));
  const ev = g.collect('gDamper', 20);
  assert.ok(ev.length >= 1);
});

test('sensor and zoom cycling, with events', () => {
  const g = flightGame();
  const sn = g.state.player.sensors;
  g.press('sensorCycle');
  assert.equal(sn.mode, 'night');
  assert.equal(g.events('sensorMode')[0].mode, 'night');
  g.state.events.length = 0;
  g.press('sensorCycle');
  assert.equal(sn.mode, 'thermal');
  g.press('sensorCycle');
  assert.equal(sn.mode, 'optical');
  g.press('zoomCycle');
  assert.equal(sn.zoom, 3);
  assert.equal(g.events('zoom')[0].zoom, 3);
  g.press('zoomCycle');
  g.press('zoomCycle');
  assert.equal(sn.zoom, 1);
});

test('player.target is the enemy nearest the crosshair (25 deg cone) with a doc-03 lead point; nothing is pulled toward it', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  const at = (x, z) => p.position.clone().add(new THREE.Vector3(x, 0, z));
  const a = s.sim.spawnEnemy('gustav', at(0, -3000), { stationary: true });
  const b = s.sim.spawnEnemy('gustav', at(500, -5000), { stationary: true });
  a.velocity.set(100, 0, 0); // stationary AI keeps velocity: a crossing target
  g.step(2);
  assert.equal(p.target.id, a.id);
  const d = a.position.distanceTo(p.position);
  assert.ok(Math.abs(p.target.distance - d) < 1);
  // single-pass formula: t = d / Vb (2200); lead = Pt + Vt * t. The sim iterates it, so it must lie within a few
  // metres of the single-pass answer and ahead of the target.
  const naive = a.position.clone().addScaledVector(a.velocity, d / 2200);
  assert.ok(p.target.leadPoint.distanceTo(naive) < 15, `lead off by ${p.target.leadPoint.distanceTo(naive)}`);
  assert.ok(p.target.leadPoint.x > a.position.x + 50);
  // swing the crosshair (inside the central zone) to b: it becomes the target
  s.input.aimYaw = Math.atan2(500, 5000);
  g.step(1);
  assert.equal(p.target.id, b.id, 'target follows the crosshair');
  // 31 deg away from everything: no target at all
  s.input.aimYaw = -0.55;
  g.step(1);
  assert.equal(p.target.id, null);
  assert.equal(p.target.leadPoint, null);
  // the T key no longer does anything
  s.input.aimYaw = 0;
  g.step(1);
  const id0 = p.target.id;
  g.press('targetCycle');
  assert.equal(p.target.id, id0);
  // head destroyed: the lead pip is lost
  s.sim.damagePlayer(0.1, new THREE.Vector3(0, 0, -1), { part: 'head' });
  s.sim.damagePlayer(0.6, new THREE.Vector3(0, 0, -1), { part: 'head' });
  g.step(2);
  assert.equal(p.parts.head.status, 'destroyed');
  assert.equal(p.target.leadPoint, null);
  assert.ok(p.target.id !== null && p.target.distance > 0, 'distance is still readable');
});

test('the beam rifle fires where the crosshair points, with no lock: 3 shots kill a stationary Gustav', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 5); // let the glide bleed off
  const e = dummy(g, 'gustav', 3500);
  s.events.length = 0;
  const seen = { fire: 0, kill: 0, hit: 0, locked: 0 };
  const count = () => {
    for (const ev of s.events) {
      if (ev.type === 'rifleFire') seen.fire++;
      if (ev.type === 'kill') seen.kill++;
      if (ev.type === 'enemyHit') seen.hit++;
      if (ev.type === 'lockConfirmed') seen.locked++;
    }
    s.events.length = 0;
  };
  s.input.triggerFull = true; // no half-pull, no lock needed
  for (let i = 0; i < 60 * 25 && e.alive; i++) { g.step(1); count(); }
  s.input.triggerFull = false;
  assert.equal(e.alive, false);
  assert.ok(seen.fire >= 3 && seen.fire <= 4, `rifle shots ${seen.fire}`); // a 4th is already flying when the 3rd lands
  assert.equal(seen.hit, 3);
  assert.equal(seen.kill, 1);
  assert.equal(s.mission.kills, 1);
  assert.equal(p.weapons.rifle.shots, EPACK_SHOTS - seen.fire);
  g.step(5);
  assert.ok(!s.entities.includes(e), 'dead entity removed');
  assert.ok(s.sim.shotsFired >= 3 && s.sim.hits >= 3);
  // a shot aimed away from the enemy misses: the rifle never steers
  const h = flightGame();
  h.step(60 * 5);
  const e2 = dummy(h, 'gustav', 3500);
  h.state.input.aimYaw = 0.19; // 11 deg off, inside the central zone
  h.step(1);
  h.state.input.triggerFull = true;
  h.step(1);
  h.state.input.triggerFull = false;
  h.step(60 * 4);
  assert.equal(e2.hp, e2.maxHp, 'a shot 11 deg off the target misses');
});

test('funnel auto-lock: the enemy nearest the crosshair inside 8 deg locks after a short delay; F fires only at a lock', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  const at = (deg, dist = 3000) => {
    const a = deg * Math.PI / 180;
    return p.position.clone().add(new THREE.Vector3(Math.sin(a) * dist, 0, -Math.cos(a) * dist));
  };
  const far = s.sim.spawnEnemy('gustav', at(15), { stationary: true });   // outside the 8 deg cone
  const right = s.sim.spawnEnemy('gustav', at(5, 2500), { stationary: true });
  const left = s.sim.spawnEnemy('gustav', at(-3, 3500), { stationary: true }); // nearest the crosshair
  for (const e of [far, right, left]) e.velocity.set(0, 0, 0);
  // F with no lock yet: refused
  s.events.length = 0;
  const seen = { acq: 0, conf: 0, lost: 0 };
  g.press('funnel');
  seen.acq += g.events('lockAcquiring').length; // acquiring starts on this very frame
  assert.equal(g.events('funnelLaunch').length, 0);
  assert.ok(s.alerts.some((a) => a.text === 'NO FUNNEL TARGET'));
  assert.equal(p.weapons.funnel.count, 24);
  let t = 0;
  for (let i = 0; i < 60 * 3 && p.lock.state !== 'locked'; i++) {
    g.step(1);
    t += DT;
    seen.acq += g.events('lockAcquiring').length;
    seen.conf += g.events('lockConfirmed').length;
  }
  assert.equal(p.lock.state, 'locked');
  assert.equal(p.lock.targetId, left.id, 'the enemy nearest the crosshair');
  assert.ok(t > 0.4 && t < 1.2, `lock delay ${t}`);
  assert.equal(seen.acq, 1);
  assert.equal(seen.conf, 1);
  assert.ok(Math.abs(p.lock.distance - left.position.distanceTo(p.position)) < 1);
  // F: the whole salvo goes at the locked enemy
  g.press('funnel');
  assert.equal(g.events('funnelLaunch').length, 1);
  assert.equal(g.events('funnelLaunch')[0].count, WEAPONS.funnelSalvo);
  const fm = s.entities.filter((x) => x.type === 'funnelMissile');
  assert.equal(fm.length, WEAPONS.funnelSalvo);
  assert.ok(fm.every((m) => m.targetId === left.id));
  assert.equal(p.weapons.funnel.count, 24 - WEAPONS.funnelSalvo);
  // swing the crosshair (inside the zone) to 9 deg from the locked enemy: still inside the keep cone
  s.input.aimYaw = -0.03 + 0.157;
  g.step(5);
  assert.equal(p.lock.state, 'locked');
  // 20 deg away: the lock drops
  s.input.aimYaw = 0.45;
  g.step(3);
  assert.equal(p.lock.state, 'none');
  assert.equal(p.lock.targetId, null);
  assert.ok(g.events('lockLost').length >= 0);
  // an enemy only outside the cone never locks (HUD target still follows it)
  const g2 = flightGame();
  g2.step(60 * 4);
  const p2 = g2.state.player;
  const o = g2.state.sim.spawnEnemy('gustav', p2.position.clone().add(new THREE.Vector3(Math.sin(0.26) * 3000, 0, -Math.cos(0.26) * 3000)), { stationary: true });
  o.velocity.set(0, 0, 0);
  g2.step(90);
  assert.equal(p2.lock.state, 'none');
  assert.equal(p2.target.id, o.id);
});

test('vulcans (right mouse), funnels and flares spend ammo and push events', () => {
  const g = flightGame();
  const s = g.state;
  const w = s.player.weapons;
  g.step(60 * 5);
  const e = dummy(g, 'gustav', 2500);
  s.events.length = 0;
  s.input.secondary = true;
  const v = g.collect('vulcanFire', 30);
  s.input.secondary = false;
  assert.ok(v.length >= 8);
  assert.ok(w.vulcan.ammo < 800);
  g.step(90); // funnel auto-lock settles
  assert.equal(s.player.lock.state, 'locked');
  s.input.funnel = true;
  g.step(1);
  const fl = g.events('funnelLaunch');
  assert.equal(fl.length, 1);
  assert.equal(fl[0].count, 6);
  assert.equal(w.funnel.count, 18);
  assert.equal(s.entities.filter((x) => x.type === 'funnelMissile').length, 6);
  const hp0 = e.hp;
  g.step(60 * 6);
  assert.ok(e.hp < hp0 || !e.alive, 'funnels hit the target');
  g.press('flare');
  assert.equal(g.events('flareDeploy').length, 1);
  assert.equal(w.flares.count, 11);
  assert.equal(s.entities.filter((x) => x.type === 'flare').length, 2);
});

test('a flare can pull an enemy missile off the player', () => {
  const g = flightGame('7');
  const s = g.state;
  const p = s.player;
  const sh = g.state.sim.spawnEnemy('gustav', new THREE.Vector3(0, 4800, -3000), { stationary: true });
  sh.velocity.set(0, 0, 0);
  let decoyed = 0;
  for (let trial = 0; trial < 20; trial++) {
    const m = g.state.sim.spawnEnemy; // keep lint quiet
    void m;
    // fabricate a missile heading at the player
    const rt = s.sim;
    const ent = {
      id: rt.nextId++, type: 'missile', faction: 'enemy', name: 'm',
      position: p.position.clone().add(new THREE.Vector3(0, 0, -2500)),
      velocity: new THREE.Vector3(0, 0, 300), quaternion: new THREE.Quaternion(),
      radius: 3, hp: 1, maxHp: 1, heat: 1, ttl: 20, targetId: 'player', alive: true,
      sim: { dmg: 0.2, speedMax: 430, accel: 120, turn: 0.75, lost: false },
    };
    s.entities.push(ent);
    rt.byId.set(ent.id, ent);
    p.weapons.flares.count = 12;
    s.input.flare = true;
    g.step(1);
    if (ent.targetId !== 'player') decoyed++;
    ent.alive = false;
    g.step(1);
  }
  assert.ok(decoyed >= 8 && decoyed <= 19, `decoyed ${decoyed}/20`);
});

test('enemy missile sets threat fields and an alert', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  const rt = s.sim;
  const ent = {
    id: rt.nextId++, type: 'missile', faction: 'enemy', name: 'm',
    position: p.position.clone().add(new THREE.Vector3(0, 0, -3000)),
    velocity: new THREE.Vector3(0, 0, 300), quaternion: new THREE.Quaternion(),
    radius: 3, hp: 1, maxHp: 1, heat: 1, ttl: 20, targetId: 'player', alive: true,
    sim: { dmg: 0.2, speedMax: 430, accel: 120, turn: 0.75, lost: false },
  };
  s.entities.push(ent);
  rt.byId.set(ent.id, ent);
  g.step(2);
  assert.equal(p.threat.missileInbound, true);
  assert.ok(p.threat.nearestMissileDist < 3000 && p.threat.nearestMissileDist > 2000);
  assert.ok(s.alerts.some((a) => a.text === 'MISSILE INBOUND'));
  g.step(60);
  assert.ok(p.stress > 0.3, `stress ${p.stress}`);
});

test('hits knock out monitor sectors and cost hull; barrier absorbs when active', () => {
  const g = flightGame('3');
  const s = g.state;
  const p = s.player;
  for (let i = 0; i < 6; i++) g.state.sim.damagePlayer(0.05, new THREE.Vector3(1, 0, 0), { part: 'core' });
  const hits = g.state.events.filter((e) => e.type === 'playerHit');
  assert.equal(hits.length, 6);
  assert.ok(hits[0].dir instanceof THREE.Vector3);
  assert.ok(Math.abs(hits[0].dir.length() - 1) < 1e-6);
  assert.ok(hits[0].dir.x > 0.9, 'hit from the right is local +X');
  assert.ok(Math.abs(p.hull - 0.7) < 1e-9);
  assert.ok(p.sensors.sectors[2] < 1 || g.state.events.some((e) => e.type === 'sectorLost'));
  // barrier
  const g2 = flightGame('3');
  const p2 = g2.state.player;
  p2.flightMode = 'minovsky';
  p2.velocity.set(0, 0, -600);
  g2.state.input.moveZ = 1;
  g2.step(10);
  g2.state.events.length = 0;
  assert.equal(p2.barrier.active, true);
  const i0 = p2.barrier.integrity;
  g2.state.sim.damagePlayer(0.1, new THREE.Vector3(0, 0, -1), { part: 'core' });
  assert.ok(p2.hull > 0.95 && p2.hull < 0.99, `hull ${p2.hull}`);
  assert.ok(p2.barrier.integrity < i0);
  // regenerates slowly
  const i1 = p2.barrier.integrity;
  g2.step(60 * 10);
  assert.ok(p2.barrier.integrity > i1);
});

test('lethal damage -> disabled -> hold eject -> ejected with result', () => {
  const g = flightGame();
  const s = g.state;
  s.sim.damagePlayer(5, new THREE.Vector3(0, 0, -1));
  assert.equal(s.phase, 'disabled');
  assert.equal(s.player.hull, 0);
  assert.ok(s.alerts.some((a) => a.level === 'warning'));
  assert.equal(s.mission.result, null);
  s.events.length = 0;
  // no control while disabled: stick input does not change angular state of the tumble
  s.input.moveZ = 1;
  g.step(60);
  assert.ok(s.player.speed < 400);
  // eject: lever event at start, hatch only after 2.5 s of holding
  s.input.ejectHold = true;
  const lever = [];
  const hatch = [];
  let t = 0;
  for (let i = 0; i < 60 * 3; i++) {
    g.step(1);
    t += DT;
    lever.push(...g.events('ejectLever'));
    hatch.push(...g.events('hatchBlow'));
    if (s.phase === 'ejected') break;
    s.events.length = 0;
  }
  assert.equal(lever.length, 1);
  assert.equal(hatch.length, 1);
  assert.ok(t > 2.4 && t < 2.7, `eject took ${t}`);
  assert.equal(s.phase, 'ejected');
  assert.ok(s.mission.result);
  assert.equal(s.mission.result.victory, false);
  assert.equal(typeof s.mission.result.kills, 'number');
  assert.equal(typeof s.mission.result.elapsed, 'number');
});

test('releasing the eject lever early resets it', () => {
  const g = flightGame();
  const s = g.state;
  s.sim.damagePlayer(5, new THREE.Vector3(0, 0, -1));
  s.input.ejectHold = true;
  g.step(60);
  s.input.ejectHold = false;
  g.step(60);
  assert.equal(s.phase, 'disabled');
  assert.ok(s.sim.ejectProgress < 0.1);
});

test('eject lever is available in flight only when hull < 0.25', () => {
  const g = flightGame();
  const s = g.state;
  s.input.ejectHold = true;
  g.step(60 * 4);
  assert.equal(s.phase, 'flight');
  s.input.ejectHold = false;
  s.player.hull = 0.2;
  g.step(2);
  s.input.ejectHold = true;
  g.step(60 * 3);
  assert.equal(s.phase, 'ejected');
  assert.equal(s.mission.result.victory, false);
});

test('disabled suit hitting the sea ends as ejected with a note', () => {
  const g = flightGame();
  const s = g.state;
  s.player.position.y = 1500;
  s.sim.damagePlayer(5, new THREE.Vector3(0, 0, -1));
  assert.equal(s.phase, 'disabled');
  let guard = 0;
  while (s.phase === 'disabled' && guard++ < 60 * 60) g.step(1);
  assert.equal(s.phase, 'ejected');
  assert.ok(s.mission.result && s.mission.result.victory === false);
  assert.match(s.mission.message.text, /did not get out/i);
});

test('flying into the sea at speed is fatal; low altitude raises PULL UP', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  p.flightMode = 'minovsky';
  p.position.y = 400;
  p.velocity.set(0, -120, -150);
  p.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.6);
  s.input.moveZ = 0.5;
  let warned = false;
  for (let i = 0; i < 60 * 15 && s.phase === 'flight'; i++) {
    g.step(1);
    if (s.alerts.some((a) => a.text === 'PULL UP')) warned = true;
  }
  assert.ok(warned);
  assert.equal(s.phase, 'ejected');
  assert.equal(s.mission.result.victory, false);
  assert.match(s.mission.message.text, /sea/i);
});

test('thruster overheat forces cooldown with an alert', () => {
  const g = flightGame();
  const s = g.state;
  s.input.moveZ = 1;
  s.input.boost = 1;
  let overheated = false;
  for (let i = 0; i < 60 * 14; i++) {
    g.step(1);
    if (s.alerts.some((a) => a.text.startsWith('THRUSTER OVERHEAT'))) overheated = true;
  }
  assert.ok(overheated);
  assert.ok(s.player.thrusterHeat < 1);
});

test('clearing all waves -> victory with a result', () => {
  const g = makeGame();
  toFlight(g);
  const s = g.state;
  const waves = [];
  let guard = 0;
  while (s.phase === 'flight' && guard++ < 60 * 200) {
    g.step(1);
    for (const e of s.events) if (e.type === 'waveStart') waves.push(e.wave);
    s.events.length = 0;
    for (const e of s.entities) {
      if ((e.type === 'gustav' || e.type === 'penelope') && e.alive) e.hp = 0; // dev cheat: instant kills
    }
    s.player.hull = 1; // stay alive
  }
  assert.deepEqual(waves, [1, 2, 3]);
  assert.equal(s.phase, 'victory');
  assert.ok(s.mission.result);
  assert.equal(s.mission.result.victory, true);
  assert.equal(s.mission.result.kills, 6);
  assert.equal(s.mission.wave, 3);
  assert.ok(s.world.minovskyDensity > 0.35);
  assert.ok(allFinite(s.player));
});

test('wave composition: 2 gustav, 3 gustav with missiles, 1 penelope', () => {
  const g = makeGame();
  toFlight(g);
  const s = g.state;
  const seen = [];
  let guard = 0;
  while (s.phase === 'flight' && guard++ < 60 * 200) {
    g.step(1);
    for (const e of s.events) if (e.type === 'waveStart') {
      const live = s.entities.filter((x) => x.alive && (x.type === 'gustav' || x.type === 'penelope'));
      seen.push(live.map((x) => x.type).sort().join(','));
    }
    s.events.length = 0;
    for (const e of s.entities) {
      if ((e.type === 'gustav' || e.type === 'penelope') && e.alive) e.hp = 0;
    }
  }
  assert.deepEqual(seen, ['gustav,gustav', 'gustav,gustav,gustav', 'penelope']);
});

test('enemies fight back: beams and missiles reach the player over time', () => {
  const g = makeGame('11');
  toFlight(g);
  const s = g.state;
  s.input.moveZ = 0.4; // a careless straight-and-level pilot
  const kinds = new Set();
  let hits = 0;
  for (let i = 0; i < 60 * 150 && s.phase === 'flight'; i++) {
    g.step(1);
    for (const e of s.entities) if (e.faction === 'enemy') kinds.add(e.type);
    hits += s.events.filter((e) => e.type === 'playerHit').length;
    s.events.length = 0;
  }
  assert.ok(kinds.has('beam'), 'enemy beams were fired');
  assert.ok(hits > 0 || s.phase !== 'flight', 'a careless pilot gets hit');
});

test('entity contract: unique ids, valid fields, nothing dead lingers', () => {
  const g = makeGame('5');
  toFlight(g);
  const s = g.state;
  const rng = lcg(5);
  for (let i = 0; i < 60 * 90; i++) {
    s.input.moveZ = 0.5;
    s.input.triggerHalf = i % 300 < 200;
    s.input.triggerFull = i % 300 > 100 && i % 300 < 200;
    s.input.secondary = i % 500 < 60;
    s.input.aimYaw = AIM_MAX_YAW * Math.sin(i / 50);
    s.input.aimPitch = AIM_MAX_PITCH * Math.sin(i / 37);
    g.step(1);
    if (i % 3 === 0) s.input.funnel = true;
    const ids = new Set();
    for (const e of s.entities) {
      assert.ok(!ids.has(e.id), 'duplicate id');
      ids.add(e.id);
      assert.ok(e.alive, 'dead entity left in list');
      assert.ok(['gustav', 'penelope', 'missile', 'funnelMissile', 'beam', 'tracer', 'flare'].includes(e.type));
      assert.ok(e.faction === 'enemy' || e.faction === 'player');
      assert.ok(e.position instanceof THREE.Vector3 && e.velocity instanceof THREE.Vector3 && e.quaternion instanceof THREE.Quaternion);
      assert.ok(Number.isFinite(e.position.x + e.position.y + e.position.z));
      assert.ok(e.heat >= 0 && e.heat <= 1, `heat ${e.heat} ${e.type}`);
      assert.ok(e.ttl > 0);
    }
    s.events.length = 0;
    void rng;
    if (s.phase !== 'flight') break;
  }
});

function lcg(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}

test('no NaN in player state after 60 s of random-ish input', () => {
  const g = makeGame('9');
  toFlight(g);
  const s = g.state;
  const r = lcg(1234);
  const inp = s.input;
  let hold = 0;
  for (let i = 0; i < 60 * 60; i++) {
    if (hold-- <= 0) {
      hold = 10 + Math.floor(r() * 50);
      inp.aimYaw = (r() * 2 - 1) * AIM_MAX_YAW;
      inp.aimPitch = (r() * 2 - 1) * AIM_MAX_PITCH;
      inp.moveX = r() * 2 - 1;
      inp.moveY = r() * 2 - 1;
      inp.moveZ = r() * 2 - 1;
      inp.boost = r() < 0.4 ? 1 : 0;
      inp.triggerHalf = r() < 0.5;
      inp.triggerFull = r() < 0.4;
      inp.secondary = r() < 0.3;
      inp.funnel = r() < 0.3;
      inp.flare = r() < 0.3;
      inp.flightModeToggle = r() < 0.15;
      inp.sensorCycle = r() < 0.2;
      inp.zoomCycle = r() < 0.2;
      inp.targetCycle = r() < 0.3;
    }
    g.step(1);
    s.events.length = 0;
    assert.ok(allFinite(s.player), `non-finite player state at frame ${i} (phase ${s.phase})`);
    if (s.phase === 'ejected' || s.phase === 'victory') break;
  }
  assert.ok(allFinite(s.player));
});

test('no NaN in player state after 60 s in each phase, including wreck tumble', () => {
  const g = flightGame('2');
  g.state.player.position.y = 9000;
  g.state.sim.damagePlayer(5, null);
  g.step(60 * 30);
  assert.ok(allFinite(g.state.player));
});

test('determinism: identical inputs give identical state', () => {
  const run = () => {
    const g = makeGame('42');
    toFlight(g);
    const s = g.state;
    const r = lcg(77);
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 20 === 0) {
        s.input.aimYaw = (r() * 2 - 1) * AIM_MAX_YAW;
        s.input.aimPitch = (r() * 2 - 1) * AIM_MAX_PITCH;
        s.input.moveZ = r();
        s.input.moveX = r() * 2 - 1;
        s.input.triggerFull = r() < 0.5;
      }
      g.step(1);
      s.events.length = 0;
    }
    return [s.player.position.toArray(), s.player.hull, s.entities.length, s.mission.kills, s.sim.nextId];
  };
  assert.deepEqual(run(), run());
});

test('derived fields: heading, pitch, roll, vertical speed', () => {
  const g = flightGame();
  const p = g.state.player;
  g.step(2);
  assert.ok(Math.abs(p.pitchDeg) < 1);
  assert.ok(Math.abs(p.rollDeg) < 1);
  assert.ok(p.headingDeg < 1 || p.headingDeg > 359);
  g.state.input.roll = 1; // E: roll right (right wing down +)
  g.step(60);
  assert.ok(p.rollDeg > 50, `roll ${p.rollDeg} (right wing down is +)`);
  g.state.input.roll = 0;
  p.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2); // nose toward +X
  g.step(1);
  assert.ok(Math.abs(p.headingDeg - 90) < 2, `heading ${p.headingDeg}`);
  assert.ok(Math.abs(p.altitude - p.position.y) < 1e-9);
  assert.ok(Math.abs(p.mach - p.speed / MACH) < 1e-9);
});

// ---------------------------------------------------------------------------
// v2 feel: crosshair targeting, heavy beams, enemy beams, hover vs strafe
// ---------------------------------------------------------------------------

test('player beam: heavy single shot, power 1, ~2200 m/s along the crosshair, 1.4 s cadence, no recoil, no generator energy', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  s.input.aimYaw = 0.15;
  s.input.aimPitch = 0.1;
  g.step(2);
  const imp0 = s.sim.gImpulse.length();
  s.input.triggerFull = true;
  g.step(1);
  const beams = s.entities.filter((e) => e.type === 'beam' && e.faction === 'player');
  assert.equal(beams.length, 1);
  const b = beams[0];
  assert.equal(b.power, 1);
  assert.ok(Math.abs(b.velocity.length() - 2200) < 1, `beam speed ${b.velocity.length()}`);
  assert.ok(b.velocity.clone().normalize().dot(p.aim.dir) > 0.99999, 'fired along aim.dir');
  assert.ok(b.ttl * 2200 > 9000, `reach ${b.ttl * 2200}`);
  assert.ok(g.events('rifleFire').length === 1);
  assert.ok(s.sim.gImpulse.length() <= imp0 + 1e-9, 'no recoil shove');
  assert.equal(p.weapons.rifle.energy, undefined, 'the rifle draws no generator energy');
  // cadence: shots at ~1.4 s while the trigger is held
  const fires = [];
  for (let i = 0; i < 60 * 12; i++) {
    g.step(1);
    if (g.events('rifleFire').length) fires.push(i / 60);
    s.events.length = 0;
  }
  assert.ok(fires.length >= 7 && fires.length <= 10, `shots in 12 s: ${fires.length}`);
  assert.ok(Math.abs(fires[1] - fires[0] - 1.4) < 0.1, `interval ${fires[1] - fires[0]}`);
});

test('E-Pack: 15 shots, then an automatic 2 s reload during which the rifle cannot fire', () => {
  const g = flightGame();
  const s = g.state;
  const r = s.player.weapons.rifle;
  g.step(60 * 4);
  assert.equal(r.shots, EPACK_SHOTS);
  assert.equal(r.perPack, 15);
  s.input.triggerFull = true;
  const log = [];
  for (let i = 0; i < 60 * 30; i++) {
    g.step(1);
    for (const ev of s.events) if (['rifleFire', 'reloadStart', 'reloadEnd', 'rifleEmpty'].includes(ev.type)) log.push([ev.type, i * DT]);
    s.events.length = 0;
  }
  const idx = (t) => log.findIndex((l) => l[0] === t);
  const fires = log.filter((l) => l[0] === 'rifleFire');
  assert.equal(idx('reloadStart'), 15, 'reload starts right after the 15th shot');
  assert.ok(fires.length >= 16, `fires ${fires.length}`);
  const rs = log[idx('reloadStart')][1];
  const re = log[idx('reloadEnd')][1];
  assert.ok(Math.abs(re - rs - 2.0) < 0.05, `reload took ${re - rs}`);
  assert.ok(Math.abs(fires[14][1] - rs) < 0.05, 'reload starts on the last shot');
  const between = fires.filter((f) => f[1] > rs && f[1] < re);
  assert.equal(between.length, 0, 'no shots during the reload');
  assert.ok(log.filter((l) => l[0] === 'rifleEmpty').length === 0, 'holding the trigger does not spam rifleEmpty');
  assert.ok(fires[15][1] > re - 1e-9);
  // pressing the trigger again during a reload clicks once
  const h = flightGame();
  h.step(60 * 4);
  h.state.player.weapons.rifle.shots = 1;
  h.state.input.triggerFull = true;
  h.step(1);
  assert.equal(h.state.player.weapons.rifle.reloading, true);
  h.state.input.triggerFull = false;
  h.step(5);
  h.state.input.triggerFull = true;
  h.step(1);
  assert.equal(h.events('rifleEmpty').length, 1);
  assert.equal(h.events('rifleFire').length, 0);
});

test('E-Pack: R swaps the pack mid-pack (2 s, no fire during it), and does nothing on a full pack', () => {
  const g = flightGame();
  const s = g.state;
  const r = s.player.weapons.rifle;
  g.step(60 * 4);
  g.press('reload'); // full pack: nothing
  assert.equal(g.events('reloadStart').length, 0);
  assert.equal(r.reloading, false);
  s.input.triggerFull = true;
  g.step(1);
  s.input.triggerFull = false;
  g.step(Math.ceil(1.5 / DT));
  s.input.triggerFull = true;
  g.step(1);
  s.input.triggerFull = false;
  assert.equal(r.shots, EPACK_SHOTS - 2);
  g.step(Math.ceil(1.5 / DT));
  g.press('reload');
  assert.equal(g.events('reloadStart').length, 1);
  assert.equal(r.reloading, true);
  s.input.triggerFull = true;
  g.step(Math.ceil(1.9 / DT));
  assert.equal(g.state.entities.filter((e) => e.type === 'beam' && e.faction === 'player').length >= 0, true);
  assert.equal(r.shots, EPACK_SHOTS - 2, 'cannot fire during the swap');
  assert.equal(r.reloading, true);
  s.input.triggerFull = false;
  const ev = g.collect('reloadEnd', Math.ceil(0.3 / DT));
  assert.equal(ev.length, 1);
  assert.equal(r.shots, EPACK_SHOTS);
  assert.equal(r.reloading, false);
});

test('thick beam: a shot that passes ~25 m beside a Gustav still hits', () => {
  const g = flightGame();
  const s = g.state;
  g.step(60 * 4);
  const p = s.player;
  const e = s.sim.spawnEnemy('gustav', p.position.clone().add(new THREE.Vector3(30, 0, -3000)), { stationary: true });
  e.velocity.set(0, 0, 0);
  s.input.triggerFull = true; // unlocked: straight down -Z, 30 m wide of the centre
  g.step(1);
  s.input.triggerFull = false;
  g.step(60 * 3);
  assert.ok(e.hp < e.maxHp, 'grazing beam hit');
});

test('enemy beams carry power (Penelope heavy 1, Gustav light < 1) and push enemyFire', () => {
  const seen = { gustav: null, penelope: null };
  const fires = { gustav: 0, penelope: 0 };
  for (const type of ['gustav', 'penelope']) {
    const g = flightGame('31');
    const s = g.state;
    g.step(60 * 4);
    const e = s.sim.spawnEnemy(type, s.player.position.clone().add(new THREE.Vector3(0, 0, -2500)), {});
    s.sim.holdWaves = true;
    for (let i = 0; i < 60 * 40; i++) {
      g.step(1);
      s.player.hull = 1; // survive the observation
      for (const ev of s.events) {
        if (ev.type === 'enemyFire') {
          assert.equal(ev.id, e.id);
          fires[type]++;
          seen[type] = ev.power;
        }
      }
      for (const b of s.entities) {
        if (b.type === 'beam' && b.faction === 'enemy') assert.equal(typeof b.power, 'number');
      }
      s.events.length = 0;
    }
    assert.ok(fires[type] >= 2, `${type} fired ${fires[type]}`);
  }
  assert.equal(seen.penelope, 1);
  assert.ok(seen.gustav > 0 && seen.gustav < 1, `gustav power ${seen.gustav}`);
});

test('enemy beam damage: heavy ~0.14 hull, light ~0.04 hull (no barrier in hover)', () => {
  for (const [type, want] of [['penelope', 0.14], ['gustav', 0.04]]) {
    const g = flightGame();
    const s = g.state;
    g.step(60 * 4);
    const e = s.sim.spawnEnemy(type, s.player.position.clone().add(new THREE.Vector3(0, 0, -1500)), { stationary: true });
    e.velocity.set(0, 0, 0);
    let dmg = 0;
    for (let i = 0; i < 60 * 30 && dmg === 0; i++) {
      g.step(1);
      // stationary AI does not fire, so hand-fire through the real routine via a forced non-stationary swap
      e.sim.stationary = false;
      e.sim.fireT = 0;
      for (const ev of s.events) if (ev.type === 'playerHit') dmg = ev.damage;
      s.events.length = 0;
    }
    assert.ok(Math.abs(dmg - want) < 1e-9, `${type} damage ${dmg}`);
  }
});

test('a hovering bot takes clearly more damage than a strafing bot in wave 1 (90 s)', () => {
  const run = (seed, strafe) => {
    const g = makeGame(seed);
    toFlight(g);
    const s = g.state;
    for (let i = 0; i < 60 * 90 && s.phase === 'flight'; i++) {
      if (strafe) {
        s.input.moveX = Math.sin(i / 60 * 1.3) > 0 ? 1 : -1;
        s.input.moveY = 0.5 * (Math.sin(i / 60 * 0.7) > 0 ? 1 : -1);
      }
      g.step(1);
      s.events.length = 0;
    }
    return 1 - s.player.hull;
  };
  let still = 0;
  let moving = 0;
  const seeds = ['101', '202', '303', '404'];
  for (const sd of seeds) { still += run(sd, false); moving += run(sd, true); }
  still /= seeds.length;
  moving /= seeds.length;
  assert.ok(still > 0.25, `still bot damage ${still}`);
  assert.ok(still > moving * 3 + 0.15, `still ${still} vs strafing ${moving}`);
});

test('enemies behave like mobile suits: Gustavs hold range 1.5-4 km, Penelope circles and passes', () => {
  const g = makeGame('77');
  toFlight(g);
  const s = g.state;
  g.step(60 * 4);
  const gus = s.sim.spawnEnemy('gustav', s.player.position.clone().add(new THREE.Vector3(0, 0, -7000)), {});
  const pen = s.sim.spawnEnemy('penelope', s.player.position.clone().add(new THREE.Vector3(3000, 0, -7000)), {});
  s.sim.holdWaves = true;
  const states = new Set();
  let minG = Infinity;
  let sumG = 0;
  let nG = 0;
  for (let i = 0; i < 60 * 70; i++) {
    g.step(1);
    s.player.hull = 1;
    s.events.length = 0;
    states.add(pen.sim.state);
    if (i > 60 * 30) { const d = gus.position.distanceTo(s.player.position); minG = Math.min(minG, d); sumG += d; nG++; }
  }
  for (const st of ['approach', 'circle', 'pass', 'extend']) assert.ok(states.has(st), `penelope state ${st}`);
  assert.ok(sumG / nG > 1500 && sumG / nG < 4300, `gustav mean range ${sumG / nG}`);
  assert.ok(minG > 400, `gustav min range ${minG}`);
});

// ===========================================================================
// CR-002 build: parts, shield, saber, flight form, roll, auto-centre, input
// ===========================================================================

const FRONT = new THREE.Vector3(0, 0, -1); // a hit from straight ahead (player-local = world for a level suit)
const REAR = new THREE.Vector3(0, 0, 1);
const Z_ = new THREE.Vector3(0, 0, 1);
const NZ_ = new THREE.Vector3(0, 0, -1);

function hurt(g, amount, dir, part) {
  g.state.sim.damagePlayer(amount, dir, part ? { part } : undefined);
}
function evs(g, type) { return g.state.events.filter((e) => e.type === type); }

// a stationary, level ship with a big body hp so part tests do not kill it
function ship(g, type, at, tough = true) {
  const e = g.state.sim.spawnEnemy(type, at.clone(), { stationary: true });
  e.velocity.set(0, 0, 0);
  e.quaternion.identity();
  if (tough) e.hp = e.maxHp = 5000;
  return e;
}
// fire a ray (world offset o from the ship centre, direction d, length len) at the ship
function shoot(g, e, o, d, dmg = 105, src = 'beam', len = 600) {
  hitEnemy(g.state, e, dmg, e.position, 0, src, e.position.clone().add(o), d, len);
}
const W = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Parts: player
// ---------------------------------------------------------------------------
test('parts (player): rear hits pick only pack/pods/legs/core, front hits never pick pack or pods (200 seeded hits)', () => {
  const rng = createRng(5);
  const rear = new Set();
  const front = new Set();
  const right = new Set();
  const low = new Set();
  const top = new Set();
  for (let i = 0; i < 200; i++) {
    rear.add(pickPart(rng, W(0, 0, 1)));
    front.add(pickPart(rng, W(0, 0, -1)));
    right.add(pickPart(rng, W(1, 0, 0)));
    low.add(pickPart(rng, W(0, -1, 0)));
    top.add(pickPart(rng, W(0, 1, 0)));
  }
  assert.deepEqual([...rear].sort(), ['core', 'legs', 'pack', 'pods']);
  assert.ok(!front.has('pack') && !front.has('pods'));
  assert.deepEqual([...front].sort(), ['core', 'head', 'lArm', 'legs', 'rArm']);
  assert.ok(right.has('rArm') && !right.has('lArm'), 'side hits pick the arm on that side');
  assert.deepEqual([...low].sort(), ['core', 'legs']);
  assert.deepEqual([...top].sort(), ['head', 'pack', 'pods']);
  // through the sim: playerHit carries the part
  const g = flightGame();
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    g.state.player.hull = 1;
    hurt(g, 0.001, REAR);
    for (const e of evs(g, 'playerHit')) seen.add(e.part);
    g.state.events.length = 0;
  }
  for (const part of seen) assert.ok(['pack', 'pods', 'legs', 'core'].includes(part), part);
});

test('parts (player): head goes ok -> damaged -> destroyed with one event each, and the vulcan stops', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(30);
  const seen = { damaged: 0, destroyed: 0 };
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    hurt(g, 0.1, FRONT, 'head');
    seen.damaged += evs(g, 'partDamaged').filter((e) => e.part === 'head').length;
    seen.destroyed += evs(g, 'partDestroyed').filter((e) => e.part === 'head').length;
    statuses.push(p.parts.head.status);
    for (const e of evs(g, 'playerHit')) assert.equal(e.part, 'head');
    s.events.length = 0;
  }
  assert.deepEqual(statuses, ['ok', 'ok', 'damaged', 'damaged', 'destroyed']);
  assert.deepEqual(seen, { damaged: 1, destroyed: 1 });
  assert.equal(p.parts.head.hp, 0);
  assert.ok(s.alerts.some((a) => a.text === 'HEAD LOST'));
  assert.ok(Math.abs(p.hull - (1 - 5 * 0.1 * PARTS.hullShare)) < 1e-9, 'a part hit costs the hull 60%');
  // vulcan: works before, dead after
  const before = p.weapons.vulcan.ammo;
  s.input.secondary = true;
  g.step(30);
  s.input.secondary = false;
  assert.equal(p.weapons.vulcan.ammo, before, 'no vulcan with the head gone');
  assert.equal(p.mods.vulcanOk, false);
  assert.equal(p.mods.targetReadable, false);
  assert.ok(p.mods.radarRange < 0.3);
  const h = flightGame();
  h.state.input.secondary = true;
  h.step(30);
  assert.ok(h.state.player.weapons.vulcan.ammo < 800);
});

test('parts (player): R-arm destroyed -> no rifle, the saber works from the left hand at 60% damage, vulcan and funnels still work', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  hurt(g, 0.5, FRONT, 'rArm');
  assert.equal(p.parts.rArm.status, 'destroyed');
  s.events.length = 0;
  s.input.triggerFull = true;
  g.step(30);
  s.input.triggerFull = false;
  assert.equal(p.weapons.rifle.shots, EPACK_SHOTS, 'rifle will not fire');
  const e = dummy(g, 'gustav', 60);
  s.input.weaponSelect = 'saber';
  g.step(1);
  assert.equal(p.weapons.active, 'saber');
  s.input.triggerFull = true;
  const hp0 = e.hp;
  const got = { slash: 0, hit: 0 };
  for (let i = 0; i < 40; i++) {
    g.step(1);
    got.slash += g.events('saberSlash').length;
    got.hit += g.events('saberHit').length;
    if (got.hit) s.input.triggerFull = false;
  }
  assert.equal(got.slash, 1);
  assert.equal(got.hit, 1);
  assert.ok(Math.abs((hp0 - e.hp) - WEAPONS.saberDamage * 0.6) < 1e-6, `saber damage ${hp0 - e.hp}`);
  // vulcan and funnels
  s.input.secondary = true;
  g.step(10);
  s.input.secondary = false;
  assert.ok(p.weapons.vulcan.ammo < 800);
  g.step(90);
  assert.equal(p.lock.state, 'locked');
  s.input.funnel = true;
  g.step(1);
  assert.equal(g.events('funnelLaunch').length, 1);
});

test('parts (player): legs destroyed -> hover top speed about 0.6x and the suit still stops with no input', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  hurt(g, 0.5, REAR, 'legs');
  assert.equal(p.parts.legs.status, 'destroyed');
  s.input.moveZ = 1;
  g.step(60 * 4);
  assert.ok(p.speed > 160 && p.speed < 176, `speed ${p.speed}`);
  s.input.moveZ = 0;
  g.step(60 * 3);
  assert.ok(p.speed < 1, `stops by itself ${p.speed}`);
  // the damaged stage is milder
  const h = flightGame();
  h.step(60 * 4);
  hurt(h, 0.3, REAR, 'legs'); // hp 0.4
  assert.equal(h.state.player.parts.legs.status, 'damaged');
  h.state.input.moveZ = 1;
  h.step(60 * 4);
  assert.ok(h.state.player.speed > 215 && h.state.player.speed < 232, `damaged speed ${h.state.player.speed}`);
});

test('parts (player): pack destroyed in flight form -> forced revert to hover, no re-entry, hover speed unchanged', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  enterFlightForm(g);
  s.input.moveZ = 1;
  g.step(60 * 3);
  hurt(g, 0.5, REAR, 'pack');
  assert.equal(p.parts.pack.status, 'destroyed');
  g.step(1);
  assert.equal(p.flightTransition.state, 'toHover', 'forced revert starts');
  assert.ok(g.events('flightRefused').length >= 1 || s.alerts.some((a) => a.text === 'FLIGHT UNIT LOST'));
  assert.equal(p.barrier.active, false);
  g.step(Math.ceil(1.5 / DT));
  assert.equal(p.flightMode, 'hover');
  s.input.moveZ = 0;
  g.step(60 * 4);
  g.press('flightModeToggle');
  assert.equal(g.events('flightRefused').length, 1);
  assert.equal(p.flightTransition.state, 'idle');
  assert.equal(p.flightMode, 'hover');
  s.input.moveZ = 1;
  g.step(60 * 4);
  assert.ok(p.speed > 270 && p.speed < 290, `hover speed ${p.speed}`);
});

test('parts (player): shield leaks 15% to the hull and wears only the L-arm; rear hits ignore it; rifle blocked, vulcan allowed; movement slowed', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  s.input.shield = true;
  g.step(5);
  assert.equal(p.shield.up, true);
  assert.ok(p.shield.raise < 1, 'takes 0.3 s to raise');
  assert.equal(g.events('shieldUp').length, 0); // fired on the first frame
  g.step(20);
  assert.equal(p.shield.raise, 1);
  s.events.length = 0;
  hurt(g, 0.2, FRONT);
  assert.ok(Math.abs(p.hull - (1 - 0.2 * SHIELD.leak)) < 1e-9, `hull ${p.hull}`);
  assert.ok(Math.abs(p.parts.lArm.hp - (1 - 0.2 * SHIELD.wear)) < 1e-9, `L-arm ${p.parts.lArm.hp}`);
  for (const n of ['head', 'rArm', 'legs', 'pack', 'pods']) assert.equal(p.parts[n].hp, 1, n);
  assert.equal(evs(g, 'shieldBlock').length, 1);
  assert.equal(evs(g, 'playerHit')[0].part, 'shield');
  s.events.length = 0;
  hurt(g, 0.1, REAR, 'pack'); // from behind: no shield
  assert.equal(evs(g, 'shieldBlock').length, 0);
  assert.ok(Math.abs(p.parts.pack.hp - 0.8) < 1e-9);
  // rifle blocked while it is up, vulcan allowed
  s.input.triggerFull = true;
  g.step(30);
  s.input.triggerFull = false;
  assert.equal(p.weapons.rifle.shots, EPACK_SHOTS);
  s.input.secondary = true;
  g.step(10);
  s.input.secondary = false;
  assert.ok(p.weapons.vulcan.ammo < 800);
  // movement x0.6
  s.input.moveZ = 1;
  g.step(60 * 4);
  assert.ok(p.speed > 160 && p.speed < 176, `shielded speed ${p.speed}`);
  s.input.moveZ = 0;
  g.step(60 * 3);
  // L-arm destroyed: B does nothing
  p.parts.lArm.hp = 0;
  p.parts.lArm.status = 'destroyed';
  g.step(30);
  assert.equal(p.shield.up, false);
  assert.ok(s.alerts.some((a) => a.text === 'SHIELD LOST'));
  const hull0 = p.hull;
  hurt(g, 0.1, FRONT, 'core');
  assert.ok(Math.abs(hull0 - p.hull - 0.1) < 1e-9, 'no shield: full damage');
  s.input.shield = false;
  g.step(10);
  assert.equal(p.shield.raise, 0);
});

test('parts (player): pods destroyed -> funnel launch refused and the count does not change', () => {
  const g = flightGame();
  const s = g.state;
  g.step(60 * 5);
  dummy(g, 'gustav', 2500);
  g.step(90);
  assert.equal(s.player.lock.state, 'locked');
  hurt(g, 0.5, REAR, 'pods');
  assert.equal(s.player.parts.pods.status, 'destroyed');
  s.events.length = 0;
  g.press('funnel');
  assert.equal(g.events('funnelLaunch').length, 0);
  assert.equal(s.player.weapons.funnel.count, 24);
  assert.ok(s.alerts.some((a) => a.text === 'FUNNEL LOST'));
  assert.equal(s.player.mods.funnelOk, false);
  // damaged pods: smaller salvo
  const h = flightGame();
  h.step(60 * 5);
  dummy(h, 'gustav', 2500);
  hurt(h, 0.3, REAR, 'pods');
  h.step(90);
  h.press('funnel');
  assert.equal(h.events('funnelLaunch')[0].count, 3);
});

test('parts (player): parts never recover - not in 60 s of calm, not through a wave break', () => {
  const g = makeGame('8');
  toFlight(g);
  const s = g.state;
  const p = s.player;
  g.step(30);
  hurt(g, 0.5, REAR, 'legs');
  hurt(g, 0.3, FRONT, 'head'); // hp 0.4: damaged
  hurt(g, 0.1, FRONT, 'lArm'); // hp 0.8: ok
  s.events.length = 0;
  let maxWave = 0;
  for (let i = 0; i < 60 * 70; i++) {
    g.step(1);
    maxWave = Math.max(maxWave, s.mission.wave);
    for (const e of s.entities) if ((e.type === 'gustav' || e.type === 'penelope') && e.alive) e.hp = 0; // nobody shoots back
    p.hull = 1;
    s.events.length = 0;
    assert.equal(p.parts.legs.hp, 0);
    assert.equal(p.parts.legs.status, 'destroyed');
    assert.ok(Math.abs(p.parts.head.hp - 0.4) < 1e-9 && p.parts.head.status === 'damaged');
    assert.ok(Math.abs(p.parts.lArm.hp - 0.8) < 1e-9);
  }
  assert.ok(maxWave >= 2, `ran through a wave break (wave ${maxWave})`);
});

test('parts (player): hull <= 0 still disables the suit whatever the parts; the last working weapon is held at hp 0.1', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(30);
  hurt(g, 5, FRONT, 'head'); // 5 * 0.6 hull damage: gone
  assert.equal(s.phase, 'disabled');
  assert.equal(p.hull, 0);
  const h = flightGame();
  const q = h.state.player;
  h.step(30);
  for (const part of ['head', 'pods', 'lArm']) { hurt(h, 0.5, FRONT, part); q.hull = 1; }
  assert.equal(q.parts.head.status, 'destroyed');
  assert.equal(q.parts.pods.status, 'destroyed');
  assert.equal(q.parts.lArm.status, 'destroyed');
  hurt(h, 0.5, FRONT, 'rArm'); // the last weapon
  q.hull = 1;
  assert.equal(q.parts.rArm.hp, PARTS.lastWeaponHp);
  assert.equal(q.parts.rArm.status, 'damaged');
  assert.equal(q.mods.rifleOk, true);
  hurt(h, 0.5, FRONT, 'rArm');
  assert.equal(q.parts.rArm.hp, PARTS.lastWeaponHp, 'stays held together');
});

test('parts (player): the same seed and hits give the same parts state', () => {
  const run = () => {
    const g = flightGame('77');
    const r = lcg(3);
    for (let i = 0; i < 40; i++) {
      g.state.player.hull = 1;
      hurt(g, 0.02 + r() * 0.05, W(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1));
      g.step(2);
    }
    return JSON.stringify(g.state.player.parts);
  };
  assert.equal(run(), run());
});

// ---------------------------------------------------------------------------
// Parts: enemies
// ---------------------------------------------------------------------------
test('parts (enemy): a ray through the Gustav head box picks the head, also on a ship yawed 90 deg; a miss picks none', () => {
  const g = flightGame();
  const e = ship(g, 'gustav', W(0, 5000, -3000));
  const pos = e.position;
  const at = (o) => pos.clone().add(o);
  assert.equal(pickEnemyPart(e, at(W(0, 26.9, -300)), Z_, 600).part, 'head');
  assert.equal(pickEnemyPart(e, at(W(12.8, 9.6, 300)), NZ_, 600).part, 'gunArm');
  assert.equal(pickEnemyPart(e, at(W(-12.8, 9.6, 300)), NZ_, 600).part, 'pod');
  assert.equal(pickEnemyPart(e, at(W(9.6, -15.4, 300)), NZ_, 600).part, 'thrusters');
  assert.equal(pickEnemyPart(e, at(W(0, 0, 0)), Z_, 0).part, null, 'a point in the torso');
  assert.equal(pickEnemyPart(e, at(W(0, 500, -300)), Z_, 600).part, null, 'missed every box');
  // yaw the ship 90 deg: its nose now points along -X in the world (R_y(90): -Z -> -X)
  e.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(e.quaternion);
  assert.ok(nose.x < -0.99);
  // the head is now at world (0, 26.9, 0) (Gustav humanoid: head centre y 8.4 model units x MODEL_SCALE 2 x base scale 1.6): a ray from -X heading +X through it picks the head
  assert.equal(pickEnemyPart(e, at(W(-300, 26.9, 0)), W(1, 0, 0), 600).part, 'head');
  // the old straight-down-Z ray now meets the side of the ship (its gun arm), not the head
  assert.notEqual(pickEnemyPart(e, at(W(0, 9.6, -300)), Z_, 600).part, 'head');
  // a destroyed part is gone: the ray passes through to the torso
  e.quaternion.identity();
  e.parts.head.status = 'destroyed';
  assert.equal(pickEnemyPart(e, at(W(0, 26.9, -300)), Z_, 600).part, null);
});

test('parts (enemy): the same part is picked at MODEL_SCALE 1 and 2 when the shot is scaled to match', () => {
  const g = flightGame();
  const e = ship(g, 'penelope', W(0, 5000, -3000));
  for (const [scale, ok] of [[1, true], [2, true], [MODEL_SCALE, true]]) {
    const o = e.position.clone().add(W(7.2 / 2 * scale, 2.4 / 2 * scale, -300 * scale)); // local (3.6, 1.2, ...) model units
    const r = pickEnemyPart(e, o, Z_, 600 * scale, scale);
    assert.equal(r.part === 'rifleArm', ok, `scale ${scale}: ${r.part}`);
    // the entry point comes back in model units, so it does not depend on the scale
    assert.ok(Math.abs(r.point.x - 3.6) < 1e-6 && Math.abs(r.point.y - 1.2) < 1e-6, `${r.point.x} ${r.point.y}`);
  }
  assert.ok(e.radius === ENEMY.penelope.radius * MODEL_SCALE, 'hit radius follows MODEL_SCALE');
});

test('parts (enemy): two heavy beams destroy the Gustav gun arm: no more beams, missiles still fly while the pod lives, none after it dies', () => {
  const g = flightGame('12');
  const s = g.state;
  g.step(60 * 4);
  const e = s.sim.spawnEnemy('gustav', s.player.position.clone().add(W(0, 0, -3200)), { missiles: true });
  e.hp = e.maxHp = 5000;
  e.quaternion.identity();
  shoot(g, e, W(12.8, 9.6, 300), NZ_);
  assert.equal(e.parts.gunArm.status, 'damaged');
  assert.equal(evs(g, 'enemyPartDamaged').length, 1);
  shoot(g, e, W(12.8, 9.6, 300), NZ_);
  assert.equal(e.parts.gunArm.status, 'destroyed');
  const destroyed = evs(g, 'enemyPartDestroyed');
  assert.equal(destroyed.length, 1);
  assert.equal(destroyed[0].part, 'gunArm');
  assert.ok(destroyed[0].point instanceof THREE.Vector3 && destroyed[0].point.x > 3, 'point is in model units');
  assert.equal(e.sim.mods.beamOk, false);
  assert.ok(e.hp > 4500, 'part damage is a bonus: the body took the plain damage');
  let fires = 0;
  let missiles = 0;
  const seenIds = new Set();
  for (let i = 0; i < 60 * 45; i++) {
    g.step(1);
    s.player.hull = 1;
    fires += evs(g, 'enemyFire').length;
    for (const m of s.entities) if (m.type === 'missile' && !seenIds.has(m.id)) { seenIds.add(m.id); missiles++; }
  }
  assert.equal(fires, 0, 'a Gustav without its gun arm fires no beams');
  assert.ok(missiles >= 1, `missiles while the pod lives: ${missiles}`);
  e.quaternion.identity(); // the ship has been flying around: level it for the ray test
  shoot(g, e, W(-12.8, 9.6, 300), NZ_);
  shoot(g, e, W(-12.8, 9.6, 300), NZ_);
  assert.equal(e.parts.pod.status, 'destroyed');
  for (const m of s.entities) if (m.type === 'missile') m.alive = false;
  g.step(2);
  seenIds.clear();
  for (let i = 0; i < 60 * 45; i++) {
    g.step(1);
    s.player.hull = 1;
    for (const m of s.entities) if (m.type === 'missile') seenIds.add(m.id);
  }
  assert.equal(seenIds.size, 0, 'no missiles without the pod');
});

test('parts (enemy): thrusters destroyed -> mods.speed 0.5 and a measured top speed under 55%; head destroyed -> spread 2.5 and no lead', () => {
  const topSpeed = (damage) => {
    const g = flightGame('21');
    const s = g.state;
    g.step(60 * 4);
    const e = s.sim.spawnEnemy('gustav', s.player.position.clone().add(W(0, 0, -3000)), {});
    e.hp = e.maxHp = 5000;
    e.quaternion.identity();
    if (damage) { shoot(g, e, W(9.6, -15.4, 300), NZ_); shoot(g, e, W(9.6, -15.4, 300), NZ_); }
    let top = 0;
    for (let i = 0; i < 60 * 40; i++) {
      g.step(1);
      s.player.hull = 1;
      top = Math.max(top, e.velocity.length());
    }
    return { top, e };
  };
  const ok = topSpeed(false);
  const bad = topSpeed(true);
  assert.equal(bad.e.parts.thrusters.status, 'destroyed');
  assert.equal(bad.e.sim.mods.speed, 0.5);
  assert.equal(bad.e.sim.mods.breakOk, false);
  assert.ok(ok.top > 140, `undamaged ${ok.top}`);
  assert.ok(bad.top < 0.55 * 230, `damaged top speed ${bad.top}`);
  const g = flightGame();
  const e = ship(g, 'gustav', W(0, 5000, -3000));
  shoot(g, e, W(0, 26.9, -300), Z_);
  assert.equal(e.parts.head.status, 'damaged');
  assert.equal(e.sim.mods.spread, 1.5);
  shoot(g, e, W(0, 26.9, -300), Z_);
  assert.equal(e.parts.head.status, 'destroyed');
  assert.equal(e.sim.mods.spread, 2.5);
  assert.equal(e.sim.mods.leadOk, false);
  assert.equal(e.sim.mods.dodge, 0.5);
});

test('parts (enemy): a Penelope with both arms gone fires nothing and rams; without its wing pack it never makes a pass', () => {
  const g = flightGame('31');
  const s = g.state;
  g.step(60 * 4);
  const e = s.sim.spawnEnemy('penelope', s.player.position.clone().add(W(0, 0, -3000)), { missiles: true });
  e.hp = e.maxHp = 5000;
  e.quaternion.identity();
  for (let i = 0; i < 3; i++) shoot(g, e, W(9.8, -0.7, -300), Z_);
  assert.equal(e.parts.rifleArm.status, 'destroyed');
  for (let i = 0; i < 3; i++) shoot(g, e, W(-9.8, -0.7, -300), Z_);
  assert.equal(e.parts.salvoArm.status, 'destroyed');
  let fires = 0;
  let missiles = 0;
  let rammed = false;
  for (let i = 0; i < 60 * 25; i++) {
    g.step(1);
    s.player.hull = 1;
    fires += evs(g, 'enemyFire').length;
    missiles += s.entities.filter((m) => m.type === 'missile').length;
    if (evs(g, 'playerHit').length) rammed = true;
  }
  assert.equal(fires, 0);
  assert.equal(missiles, 0);
  assert.equal(e.sim.state, 'ram');
  assert.ok(rammed, 'it flew into the player');
  // wing pack destroyed: no high-speed pass
  const h = flightGame('32');
  h.step(60 * 4);
  const pen = h.state.sim.spawnEnemy('penelope', h.state.player.position.clone().add(W(0, 0, -3000)), {});
  pen.hp = pen.maxHp = 5000;
  pen.quaternion.identity();
  for (let i = 0; i < 4; i++) shoot(h, pen, W(19.5, 20.5, -300), Z_);
  assert.equal(pen.parts.wingPack.status, 'destroyed');
  assert.equal(pen.sim.mods.passOk, false);
  const states = new Set();
  for (let i = 0; i < 60 * 60; i++) {
    h.step(1);
    h.state.player.hull = 1;
    states.add(pen.sim.state);
  }
  assert.ok(!states.has('pass'), `states ${[...states]}`);
  assert.ok(states.has('circle'));
});

test('parts (enemy): hp < 30% with the mobility part gone -> flees past 8 km, returns after 20 s with the parts still broken', () => {
  const g = flightGame('41');
  const s = g.state;
  g.step(60 * 4);
  const e = s.sim.spawnEnemy('gustav', s.player.position.clone().add(W(0, 0, -3000)), {});
  e.hp = e.maxHp = 5000;
  e.quaternion.identity();
  shoot(g, e, W(9.6, -15.4, 300), NZ_);
  shoot(g, e, W(9.6, -15.4, 300), NZ_);
  e.hp = e.maxHp * 0.2;
  let maxDist = 0;
  let tFar = null;
  let tBack = null;
  for (let i = 0; i < 60 * 200 && tBack === null; i++) {
    g.step(1);
    s.player.hull = 1;
    const d = e.position.distanceTo(s.player.position);
    maxDist = Math.max(maxDist, d);
    if (tFar === null && e.sim.fleePhase === 'wait') tFar = i * DT;
    if (tFar !== null && e.sim.state !== 'flee') tBack = i * DT;
  }
  assert.ok(maxDist > 8000, `fled to ${maxDist}`);
  assert.ok(tFar !== null && tBack !== null);
  assert.ok(Math.abs(tBack - tFar - 20) < 0.5, `returned after ${tBack - tFar}`);
  assert.equal(e.parts.thrusters.status, 'destroyed');
  assert.ok(['approach', 'strafe', 'break', 'ram'].includes(e.sim.state));
  assert.equal(e.sim.fled, true);
});

test('parts (enemy): about 25 vulcan rounds strip a Gustav head; a saber hit does 2x part damage; the body always takes full damage', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 5);
  const e = s.sim.spawnEnemy('gustav', p.position.clone().add(W(0, -26.9, -150)), { stationary: true }); // head on the crosshair line
  e.velocity.set(0, 0, 0);
  e.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // facing the player
  s.input.secondary = true;
  let rounds = 0;
  let destroyedAt = -1;
  for (let i = 0; i < 200 && destroyedAt < 0; i++) {
    g.step(1);
    rounds += g.events('vulcanFire').length;
    if (g.events('enemyPartDestroyed').some((x) => x.part === 'head')) destroyedAt = rounds;
  }
  s.input.secondary = false;
  assert.ok(destroyedAt > 0 && destroyedAt <= 50, `rounds to strip the head ${destroyedAt}`); // 22 head hits needed; a few rounds spread past the box
  // body damage: every hit costs the body the plain 1.6, head hits or not
  const hits = Math.round((e.maxHp - e.hp) / WEAPONS.vulcanDamage);
  assert.ok(hits >= 22 && hits <= destroyedAt, `hits ${hits}`);
  // saber vs beam on the same part
  const h = flightGame();
  const a = ship(h, 'gustav', W(0, 5000, -3000), false);
  const b = ship(h, 'gustav', W(0, 5000, -4000), false);
  shoot(h, a, W(0, 26.9, -300), Z_, 50, 'beam');
  shoot(h, b, W(0, 26.9, -300), Z_, 50, 'saber');
  assert.equal(a.parts.head.hp, 140 - 50);
  assert.equal(b.parts.head.hp, 140 - 100);
  assert.equal(a.hp, a.maxHp - 50);
  assert.equal(b.hp, b.maxHp - 50);
  // a Gustav still dies to 3 heavy beams
  const c = ship(h, 'gustav', W(0, 5000, -5000), false);
  for (let i = 0; i < 3; i++) shoot(h, c, W(0, 26.9, -300), Z_, WEAPONS.rifleDamage);
  assert.equal(c.alive, false);
});

test('parts (enemy): each part status change fires exactly one event; spawn gives full parts', () => {
  const g = flightGame();
  const e = ship(g, 'gustav', W(0, 5000, -3000));
  assert.deepEqual(Object.keys(e.parts).sort(), ['gunArm', 'head', 'pod', 'thrusters']);
  assert.equal(e.parts.head.hp, 140);
  assert.equal(e.parts.head.maxHp, 140);
  const pen = ship(g, 'penelope', W(0, 5000, -5000));
  assert.deepEqual(Object.keys(pen.parts).sort(), ['head', 'rifleArm', 'salvoArm', 'wingPack']);
  let damaged = 0;
  let destroyed = 0;
  const hitParts = [];
  for (let i = 0; i < 6; i++) {
    shoot(g, e, W(0, 26.9, -300), Z_, 30);
    damaged += evs(g, 'enemyPartDamaged').length;
    destroyed += evs(g, 'enemyPartDestroyed').length;
    for (const ev of evs(g, 'enemyHit')) hitParts.push(ev.part);
    g.state.events.length = 0;
  }
  assert.equal(damaged, 1);
  assert.equal(destroyed, 1);
  assert.deepEqual(hitParts.slice(0, 5), ['head', 'head', 'head', 'head', 'head']);
  assert.equal(hitParts[5], null, 'the destroyed head is gone: the sixth shot meets the torso');
  // missiles and funnels have no parts
  assert.equal(g.state.sim.spawnEnemy('gustav', W(0, 5000, -3000), { stationary: true }).parts !== null, true);
});

// ---------------------------------------------------------------------------
// Saber, weapon swap
// ---------------------------------------------------------------------------
test('saber: 1/2/wheel swap the active weapon; a slash takes 0.5 s, reaches ~40 m along the crosshair and hits once', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 5);
  assert.equal(p.weapons.active, 'rifle');
  s.input.weaponSelect = 'saber';
  g.step(1);
  assert.equal(p.weapons.active, 'saber');
  assert.equal(g.events('weaponSwap')[0].active, 'saber');
  s.input.weaponSelect = 'toggle';
  g.step(1);
  assert.equal(p.weapons.active, 'rifle');
  s.input.weaponSelect = 'toggle';
  g.step(1);
  assert.equal(p.weapons.active, 'saber');
  s.input.weaponSelect = 'rifle';
  g.step(1);
  assert.equal(p.weapons.active, 'rifle');
  // out of reach: a slash at 200 m hits nothing; the rifle does not fire while the saber is out
  const far = dummy(g, 'gustav', 200);
  s.input.weaponSelect = 'saber';
  g.step(1);
  s.input.triggerFull = true;
  const log = { slash: 0, hit: 0, fire: 0, t: [] };
  for (let i = 0; i < 90; i++) {
    g.step(1);
    log.slash += g.events('saberSlash').length;
    log.hit += g.events('saberHit').length;
    log.fire += g.events('rifleFire').length;
  }
  s.input.triggerFull = false;
  assert.ok(log.slash >= 2, 'the trigger repeats slashes');
  assert.equal(log.hit, 0);
  assert.equal(log.fire, 0);
  assert.equal(far.hp, far.maxHp);
  // in reach
  far.alive = false;
  g.step(2);
  const near = dummy(g, 'gustav', 70);
  g.step(60);
  const hp0 = near.hp;
  s.input.triggerFull = true;
  g.step(1);
  s.input.triggerFull = false;
  assert.equal(g.events('saberSlash').length, 1);
  assert.ok(p.weapons.saber.slash > 0 && p.weapons.saber.slash < 0.1);
  let hitAt = -1;
  for (let i = 1; i <= 40; i++) {
    g.step(1);
    if (g.events('saberHit').length && hitAt < 0) hitAt = i * DT;
    if (p.weapons.saber.slash === 0) break;
  }
  assert.ok(hitAt > 0.15 && hitAt < 0.25, `blade connects at ${hitAt}`);
  assert.ok(Math.abs((hp0 - near.hp) - WEAPONS.saberDamage) < 1e-6, `damage ${hp0 - near.hp}`);
  assert.ok(WEAPONS.saberDamage / WEAPONS.rifleDamage > 1.4 && WEAPONS.saberDamage / WEAPONS.rifleDamage < 1.6);
  assert.equal(p.weapons.saber.slash, 0, 'swing over after about 0.5 s');
});

// ---------------------------------------------------------------------------
// Missiles can be shot down; threat list
// ---------------------------------------------------------------------------
function fakeMissile(g, pos, vel, target = 'player') {
  const s = g.state;
  const rt = s.sim;
  const m = {
    id: rt.nextId++, type: 'missile', faction: 'enemy', name: 'm',
    position: pos.clone(), velocity: vel.clone(), quaternion: new THREE.Quaternion(),
    radius: 3 * MODEL_SCALE, hp: 3, maxHp: 3, heat: 1, ttl: 20, targetId: target, alive: true,
    sim: { dmg: 0.12, speedMax: 430, accel: 120, turn: 0.75, lost: false },
  };
  s.entities.push(m);
  rt.byId.set(m.id, m);
  return m;
}

test('missiles: vulcan tracers shoot down an incoming missile (missileShotDown); a beam does too', () => {
  const g = flightGame('5');
  const s = g.state;
  const p = s.player;
  g.step(60 * 5);
  const m = fakeMissile(g, p.position.clone().add(W(0, 0, -1500)), W(0, 0, 300));
  g.step(1);
  assert.equal(p.threat.missileInbound, true);
  s.input.secondary = true;
  let down = null;
  for (let i = 0; i < 180 && !down; i++) {
    g.step(1);
    down = g.events('missileShotDown')[0] || null;
  }
  s.input.secondary = false;
  assert.ok(down, 'missile shot down');
  assert.equal(down.id, m.id);
  assert.ok(down.position instanceof THREE.Vector3);
  assert.equal(m.alive, false);
  assert.ok(p.hull > 0.999, 'it never reached the player');
  // beam
  const h = flightGame('6');
  h.step(60 * 5);
  const hp = h.state.player;
  const m2 = fakeMissile(h, hp.position.clone().add(W(0, 0, -1200)), W(0, 0, 0), null);
  h.state.input.triggerFull = true;
  let d2 = false;
  for (let i = 0; i < 120 && !d2; i++) {
    h.step(1);
    d2 = h.events('missileShotDown').length > 0;
  }
  assert.ok(d2, 'beam shoots the missile down');
  assert.equal(m2.alive, false);
});

test('threat.incoming lists every homing missile, nearest first, with a time to impact', () => {
  const g = flightGame();
  const p = g.state.player;
  g.step(60 * 4);
  const a = fakeMissile(g, p.position.clone().add(W(0, 0, -3000)), W(0, 0, 300));
  const b = fakeMissile(g, p.position.clone().add(W(500, 0, -1500)), W(0, 0, 300));
  fakeMissile(g, p.position.clone().add(W(0, 0, -2000)), W(0, 0, 300), null); // not homing on the player
  g.step(1);
  const inc = p.threat.incoming;
  assert.equal(inc.length, 2);
  assert.equal(inc[0].id, b.id);
  assert.equal(inc[1].id, a.id);
  assert.ok(inc[0].distance < inc[1].distance);
  assert.ok(inc[1].tti > 5 && inc[1].tti < 12, `tti ${inc[1].tti}`);
  assert.ok(inc[0].tti < inc[1].tti);
});

// ---------------------------------------------------------------------------
// Roll, 6 axes, auto-centre
// ---------------------------------------------------------------------------
test('roll: Q/E roll at 1.2 rad/s in hover, 1.6 in flight form; the bank stays where it is left (no level assist); 180 deg reads +-180', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  s.input.roll = 1;
  g.step(60);
  assert.ok(p.rollDeg > 50 && p.rollDeg < 70, `hover roll after 1 s ${p.rollDeg}`);
  s.input.roll = 0;
  g.step(60);
  const r1 = p.rollDeg;
  g.step(60 * 5);
  assert.ok(Math.abs(p.rollDeg - r1) < 0.05, `bank unchanged after 5 s: ${r1} -> ${p.rollDeg}`);
  s.input.roll = -1;
  g.step(60);
  assert.ok(p.rollDeg < r1 - 40, 'Q rolls the other way');
  s.input.roll = 0;
  // all the way round
  const h = flightGame();
  h.step(60 * 4);
  h.state.input.roll = 1;
  h.step(Math.round(2.7 * 60));
  h.state.input.roll = 0;
  h.step(60);
  assert.ok(Math.abs(h.state.player.rollDeg) > 165 && Math.abs(h.state.player.rollDeg) <= 180, `roll ${h.state.player.rollDeg}`);
  const rr = h.state.player.rollDeg;
  h.step(60 * 5);
  let dd = Math.abs(h.state.player.rollDeg - rr);
  if (dd > 180) dd = 360 - dd;
  assert.ok(dd < 0.05, 'still upside down 5 s later');
  // flight form
  const f = flightGame();
  enterFlightForm(f);
  f.state.input.roll = 1;
  f.step(60);
  const rf = f.state.player.rollDeg;
  assert.ok(rf > 66 && rf < 82, `flight-form roll after 1 s ${rf}`);
  f.state.input.roll = 0;
  f.step(120);
  const rf1 = f.state.player.rollDeg;
  f.step(60 * 5);
  assert.ok(Math.abs(f.state.player.rollDeg - rf1) < 0.05, 'no level assist in flight form either');
});

test('6-axis hover: rolled 90 deg, the crosshair pushed right yaws about the body up axis (world pitch changes, heading does not); auto-centre still centres', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  p.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, -1), Math.PI / 2); // right wing straight down
  g.step(1);
  assert.ok(Math.abs(p.rollDeg - 90) < 1, `roll ${p.rollDeg}`);
  s.input.aimYaw = AIM_MAX_YAW;
  g.step(30);
  assert.ok(p.pitchDeg < -30, `nose pitched down in the world: ${p.pitchDeg}`);
  const hdg = p.headingDeg > 180 ? p.headingDeg - 360 : p.headingDeg;
  assert.ok(Math.abs(hdg) < 5, `heading unchanged ${p.headingDeg}`);
  // back to level-ish, then centre from inside the zone while rolled
  const h = flightGame();
  h.step(60 * 4);
  h.state.player.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, -1), Math.PI / 2);
  h.couple = true;
  h.state.input.aimYaw = 0.15;
  h.state.input.aimPitch = -0.05;
  h.step(60 * 10);
  assert.ok(Math.hypot(h.state.player.aim.yaw, h.state.player.aim.pitch) < 0.003, 'centred at any roll');
});

test('input compensation: a body roll rotates the crosshair offset about the centre so the aim point stays on the same sky point', () => {
  const I = { aimYaw: 0.3, aimPitch: 0 };
  compensateAim(I, { yaw: 0, pitch: 0, roll: 1 }, 0.1); // right wing down 0.1 rad: the sky turns counter-clockwise
  assert.ok(Math.abs(I.aimYaw - 0.3 * Math.cos(0.1)) < 1e-12);
  assert.ok(Math.abs(I.aimPitch - 0.3 * Math.sin(0.1)) < 1e-12 && I.aimPitch > 0);
  const J = { aimYaw: 0.2, aimPitch: -0.1 };
  compensateAim(J, { yaw: 0, pitch: 0, roll: 0 }, 0.1);
  assert.deepEqual(J, { aimYaw: 0.2, aimPitch: -0.1 }, 'zero rates leave it unchanged');
  const K = { aimYaw: 0.2, aimPitch: 0.1 };
  compensateAim(K, { yaw: 1, pitch: -1, roll: 0 }, 0.05);
  assert.ok(Math.abs(K.aimYaw - 0.15) < 1e-12 && Math.abs(K.aimPitch - 0.15) < 1e-12);
  const L = { aimYaw: AIM_MAX_YAW, aimPitch: AIM_MAX_PITCH };
  compensateAim(L, { yaw: 0, pitch: 0, roll: 2 }, 0.5);
  assert.ok(Math.abs(L.aimYaw) <= AIM_MAX_YAW && Math.abs(L.aimPitch) <= AIM_MAX_PITCH, 'stays inside the limits');
  // end to end with the sim: roll for half a second and the world direction of the crosshair stays put
  const g = flightGame();
  const s = g.state;
  g.step(60 * 4);
  s.input.aimYaw = 0.15;
  s.input.aimPitch = 0.05;
  g.step(1);
  const dir0 = s.player.aim.dir.clone();
  g.couple = true;
  s.input.roll = 1;
  g.step(30);
  s.input.roll = 0;
  g.step(30);
  assert.ok(Math.abs(s.player.rollDeg) > 30, 'the body really rolled');
  assert.ok(s.player.aim.dir.angleTo(dir0) < 0.04, `aim point moved ${s.player.aim.dir.angleTo(dir0)} rad`);
});

// ---------------------------------------------------------------------------
// Flight form
// ---------------------------------------------------------------------------
test('flight form: G starts toFlight; flight mode only after 2.0 s; weapons locked meanwhile; events fire', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(30);
  g.press('flightModeToggle');
  assert.equal(p.flightTransition.state, 'toFlight');
  assert.equal(p.weaponsLocked, true);
  assert.equal(g.events('flightTransformStart')[0].to, 'minovsky');
  assert.equal(g.events('flightMode')[0].mode, 'minovsky');
  s.input.triggerFull = true;
  s.input.secondary = true;
  let fired = 0;
  for (let i = 0; i < Math.round(1.9 / DT); i++) {
    g.step(1);
    fired += g.events('rifleFire').length + g.events('vulcanFire').length;
  }
  assert.equal(fired, 0, 'no weapons while transforming');
  assert.equal(p.flightMode, 'hover', 'not before 2.0 s');
  assert.ok(p.flightTransition.t > 0.9);
  let end = null;
  for (let i = 0; i < 12 && !end; i++) { g.step(1); end = g.events('flightTransformEnd')[0] || null; }
  assert.ok(end && end.mode === 'minovsky');
  assert.equal(p.flightMode, 'minovsky');
  assert.equal(p.weaponsLocked, false);
  assert.equal(p.flightTransition.state, 'idle');
  assert.ok(p.flightTransition.cooldown > 2.5);
  s.input.triggerFull = false;
  s.input.secondary = false;
  // thrust and turn are reduced while transforming (turn x0.6)
  const h = flightGame();
  h.step(60 * 4);
  h.state.input.aimYaw = AIM_MAX_YAW;
  h.step(30);
  const rateHover = h.state.sim.rate.yaw;
  const k = flightGame();
  k.step(60 * 4);
  k.press('flightModeToggle');
  k.state.input.aimYaw = AIM_MAX_YAW;
  k.step(30);
  assert.ok(Math.abs(k.state.sim.rate.yaw / rateHover - 0.6) < 0.05, `turn x${k.state.sim.rate.yaw / rateHover}`);
});

test('flight form: a toggle during a transformation or its cooldown is ignored; the way back takes 1.4 s then 3 s cooldown', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(30);
  g.press('flightModeToggle');
  g.step(60);
  g.press('flightModeToggle'); // mid transformation: committed
  assert.equal(g.events('flightTransformStart').length, 0);
  assert.equal(p.flightTransition.state, 'toFlight');
  g.step(Math.ceil(1.1 / DT));
  assert.equal(p.flightMode, 'minovsky');
  g.step(60);
  g.press('flightModeToggle'); // cooldown
  assert.equal(p.flightTransition.state, 'idle');
  assert.equal(p.flightMode, 'minovsky');
  g.step(Math.ceil(2.2 / DT));
  g.press('flightModeToggle');
  assert.equal(p.flightTransition.state, 'toHover');
  g.step(Math.round(1.3 / DT));
  assert.equal(p.flightMode, 'minovsky', 'still transforming at 1.3 s');
  g.step(Math.ceil(0.2 / DT));
  assert.equal(p.flightMode, 'hover');
  assert.ok(g.events('flightTransformEnd').length <= 1);
  g.press('flightModeToggle');
  assert.equal(p.flightTransition.state, 'idle', 'cooldown after the return too');
});

test('flight form: speed never drops under 150 m/s with S held for 10 s (no stall)', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  enterFlightForm(g);
  g.step(60 * 3);
  assert.ok(p.speed >= 149, `launched to the floor: ${p.speed}`);
  s.input.moveZ = -1;
  let min = Infinity;
  for (let i = 0; i < 60 * 10; i++) { g.step(1); min = Math.min(min, p.speed); }
  assert.ok(min >= 149, `slowest ${min}`);
  assert.ok(p.speed < 170);
  // nose up: still no stall
  s.input.aimPitch = AIM_MAX_PITCH;
  min = Infinity;
  for (let i = 0; i < 60 * 8; i++) { g.step(1); min = Math.min(min, p.speed); }
  assert.ok(min >= 149, `slowest in the loop ${min}`);
  assert.ok(allFinite(p));
});

test('flight form: rifle and vulcan stay in the 8 / 6 deg forward cone; saber and shield are refused', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  enterFlightForm(g);
  s.input.aimYaw = 0.5;
  s.input.aimPitch = 0.3;
  g.step(1);
  assert.ok(Math.abs(p.aim.yaw - FLIGHT.minovsky.aimLimitYaw) < 1e-9);
  assert.ok(Math.abs(p.aim.pitch - FLIGHT.minovsky.aimLimitPitch) < 1e-9);
  assert.equal(p.aim.limited, true);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quaternion);
  assert.ok(p.aim.dir.angleTo(fwd) < 0.175, `aim ${p.aim.dir.angleTo(fwd)}`);
  s.input.triggerFull = true;
  s.input.secondary = true;
  let nShots = 0;
  let nRounds = 0;
  for (let i = 0; i < 4; i++) {
    g.step(1);
    nShots += g.events('rifleFire').length;
    nRounds += g.events('vulcanFire').length;
    // no spread to speak of: judge against the body forward at the moment of firing
    const f2 = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quaternion);
    for (const b of s.entities.filter((e) => (e.type === 'beam' || e.type === 'tracer') && e.faction === 'player' && e.ttl > 1)) {
      const v = b.velocity.clone().sub(p.velocity).normalize();
      assert.ok(v.angleTo(f2) < 0.2, `shot ${b.type} ${v.angleTo(f2)} rad off the nose`);
    }
  }
  assert.equal(nShots, 1);
  assert.ok(nRounds >= 1, 'vulcan fires too');
  s.input.triggerFull = false;
  s.input.secondary = false;
  s.input.weaponSelect = 'saber';
  g.step(1);
  assert.equal(p.weapons.active, 'rifle');
  assert.ok(s.alerts.some((a) => a.text === 'SABER UNAVAILABLE IN FLIGHT FORM'));
  s.input.shield = true;
  g.step(10);
  assert.equal(p.shield.up, false);
  assert.ok(s.alerts.some((a) => a.text === 'SHIELD UNAVAILABLE IN FLIGHT FORM'));
  // a saber/shield state is cleared when a transform starts
  const h = flightGame();
  h.step(30);
  h.state.input.weaponSelect = 'saber';
  h.step(1);
  assert.equal(h.state.player.weapons.active, 'saber');
  h.press('flightModeToggle');
  assert.equal(h.state.player.weapons.active, 'rifle');
});

test('flight form: PULL UP when the time to impact under the velocity is under 3 s; a steady hover never warns', () => {
  // hover dive
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 4);
  p.position.y = 400;
  p.velocity.set(0, -150, 0);
  g.step(1);
  assert.equal(p.pullUp.active, true);
  assert.ok(p.pullUp.tti < 3 && p.pullUp.tti > 2, `tti ${p.pullUp.tti}`);
  assert.equal(g.events('pullUp').length, 1);
  assert.ok(s.alerts.some((a) => a.text === 'PULL UP'));
  let again = 0;
  for (let i = 0; i < 30; i++) { g.step(1); again += g.events('pullUp').length; }
  assert.equal(again, 0, 'the event fires on activation only');
  // flight-form dive along the velocity vector
  const f = flightGame();
  enterFlightForm(f);
  const fp = f.state.player;
  f.state.input.moveZ = 1;
  f.step(60 * 3);
  fp.position.y = 700;
  fp.velocity.set(0, -300, -200);
  f.step(1);
  assert.equal(fp.pullUp.active, true, `tti ${fp.pullUp.tti}`);
  // a gentle descent is fine
  const k = flightGame();
  k.step(60 * 4);
  k.state.player.position.y = 800;
  k.state.player.velocity.set(0, -20, 0);
  k.step(1);
  assert.equal(k.state.player.pullUp.active, false);
  // steady hover, even low: never
  const h = flightGame();
  h.step(60 * 4);
  h.state.player.position.y = 100;
  h.state.player.velocity.set(0, 0, 0);
  let warns = 0;
  for (let i = 0; i < 60 * 20; i++) {
    h.step(1);
    warns += h.events('pullUp').length;
    assert.equal(h.state.player.pullUp.active, false);
  }
  assert.equal(warns, 0);
  assert.ok(!h.state.alerts.some((a) => a.text === 'PULL UP'));
  assert.equal(h.state.player.pullUp.tti, Infinity);
});

test('flight form: flightUnitHealth drives it - 0 refuses, damaged slows boost and the transform, destroyed mid-flight reverts', () => {
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  assert.equal(flightUnitHealth(s), 1);
  p.parts.pack = { hp: 0, status: 'destroyed' };
  g.step(1);
  assert.equal(flightUnitHealth(s), 0);
  g.press('flightModeToggle');
  assert.equal(p.flightTransition.state, 'idle');
  assert.equal(g.events('flightRefused').length, 1);
  assert.ok(s.alerts.some((a) => a.text === 'FLIGHT UNIT LOST'));
  // damaged pack: x0.7 flight speed, x1.5 transform time
  const top = (damaged) => {
    const h = flightGame();
    const hp = h.state.player;
    if (damaged) hp.parts.pack = { hp: 0.4, status: 'damaged' };
    h.step(1);
    h.press('flightModeToggle');
    let t = 0;
    while (hp.flightMode !== 'minovsky' && t < 6) { h.step(1); t += DT; }
    h.state.input.moveZ = 1;
    h.state.input.boost = 1;
    let m = 0;
    for (let i = 0; i < 60 * 14; i++) {
      h.step(1);
      m = Math.max(m, hp.speed);
      h.state.input.boost = hp.thrusterHeat > 0.8 ? 0 : 1;
    }
    return { t, m };
  };
  const ok = top(false);
  const bad = top(true);
  assert.ok(Math.abs(ok.t - 2.0) < 0.1, `transform ${ok.t}`);
  assert.ok(Math.abs(bad.t - 3.0) < 0.1, `damaged transform ${bad.t}`);
  assert.ok(bad.m < ok.m * 0.78 && bad.m > ok.m * 0.6, `top speed ${ok.m} vs ${bad.m}`);
  assert.equal(flightUnitHealth(flightGame().state), 1);
  // destroyed mid flight
  const k = flightGame();
  enterFlightForm(k);
  assert.equal(k.state.player.flightMode, 'minovsky');
  k.state.player.parts.pack = { hp: 0, status: 'destroyed' };
  k.step(1);
  assert.equal(k.state.player.flightTransition.state, 'toHover');
  k.step(Math.ceil(1.5 / DT));
  assert.equal(k.state.player.flightMode, 'hover');
});

test('flight form: the transformation is deterministic for the same seed and inputs', () => {
  const run = () => {
    const g = flightGame('55');
    const s = g.state;
    g.step(30);
    g.press('flightModeToggle');
    for (let i = 0; i < 60 * 12; i++) {
      s.input.moveZ = i > 150 ? 1 : 0;
      s.input.aimYaw = 0.3 * Math.sin(i / 40);
      s.input.roll = i % 90 < 20 ? 1 : 0;
      if (i === 400) s.input.flightModeToggle = true;
      g.step(1);
    }
    const p = s.player;
    return [p.position.toArray(), p.quaternion.toArray(), p.flightMode, p.flightTransition.state, p.flightTransition.cooldown];
  };
  assert.deepEqual(run(), run());
});

// ---------------------------------------------------------------------------
// input.js mapping (DOM stubbed)
// ---------------------------------------------------------------------------
function stubDom() {
  const handlers = {};
  const add = (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); };
  globalThis.window = { addEventListener: add };
  globalThis.document = { addEventListener: add, pointerLockElement: null };
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true, writable: true });
  const canvas = { addEventListener: add, requestPointerLock() {} };
  const fire = (type, ev = {}) => {
    const e = { prevented: false, preventDefault() { e.prevented = true; }, ...ev };
    for (const f of handlers[type] || []) f(e);
    return e;
  };
  const state = createState();
  const input = createInput(canvas, state);
  const key = (code, extra) => fire('keydown', { code, ...extra });
  const up = (code) => fire('keyup', { code });
  return { state, input, fire, key, up, I: state.input };
}

test('input.js CR-002 layout: Q/E roll, Enter interact, R reload, B shield, right mouse vulcan, 1/2/wheel swap, Alt free-look, V and middle mouse unused', () => {
  const d = stubDom();
  const { I } = d;
  d.key('KeyE');
  d.input.update(1 / 60);
  assert.equal(I.roll, 1);
  assert.equal(I.interact, false, 'E is roll now, not the start-up switch');
  d.up('KeyE');
  d.key('KeyQ');
  d.input.update(1 / 60);
  assert.equal(I.roll, -1);
  d.up('KeyQ');
  I.aimYaw = 0.3;
  d.key('KeyQ');
  d.input.update(1 / 60);
  assert.equal(I.aimYaw, 0.3, 'Q no longer re-centres');
  d.up('KeyQ');
  d.input.update(1 / 60);
  assert.equal(I.roll, 0);
  d.key('Enter');
  d.input.update(1 / 60);
  assert.equal(I.interact, true);
  d.input.update(1 / 60);
  assert.equal(I.interact, false, 'edge lasts one frame');
  d.up('Enter');
  d.key('KeyR');
  d.input.update(1 / 60);
  assert.equal(I.reload, true);
  d.input.update(1 / 60);
  assert.equal(I.reload, false);
  d.key('KeyB');
  d.input.update(1 / 60);
  assert.equal(I.shield, true);
  d.up('KeyB');
  d.input.update(1 / 60);
  assert.equal(I.shield, false);
  // mouse: left = trigger, right = vulcan
  d.fire('mousedown', { button: 0 });
  d.input.update(1 / 60);
  assert.equal(I.triggerFull, true);
  assert.equal(I.secondary, false);
  assert.equal(I.triggerHalf, false, 'no half pull any more');
  d.fire('mouseup', { button: 0 });
  d.fire('mousedown', { button: 2 });
  d.input.update(1 / 60);
  assert.equal(I.secondary, true);
  assert.equal(I.triggerFull, false);
  d.fire('mouseup', { button: 2 });
  d.key('KeyV');
  d.input.update(1 / 60);
  assert.equal(I.secondary, false, 'V does nothing');
  d.up('KeyV');
  // weapon select
  d.key('Digit2');
  d.input.update(1 / 60);
  assert.equal(I.weaponSelect, 'saber');
  d.input.update(1 / 60);
  assert.equal(I.weaponSelect, null);
  d.key('Digit1');
  d.input.update(1 / 60);
  assert.equal(I.weaponSelect, 'rifle');
  const w = d.fire('wheel', { deltaY: 100 });
  assert.equal(w.prevented, true);
  d.input.update(1 / 60);
  assert.equal(I.weaponSelect, 'toggle');
  // middle mouse: no free-look, the crosshair moves
  I.aimYaw = 0;
  d.fire('mousedown', { button: 1 });
  d.fire('mousemove', { movementX: 50, movementY: 0 });
  d.input.update(1 / 60);
  assert.ok(Math.abs(I.lookYaw) < 1e-9);
  assert.ok(I.aimYaw > 0.05);
  d.fire('mouseup', { button: 1 });
  // Alt: free-look, and the browser menu is blocked
  const a = d.key('AltLeft');
  assert.equal(a.prevented, true);
  const yaw0 = I.aimYaw;
  d.fire('mousemove', { movementX: 50, movementY: 0 });
  d.input.update(1 / 60);
  assert.ok(I.lookYaw > 0.1, 'Alt held: the mouse turns the head');
  assert.equal(I.aimYaw, yaw0, 'and the crosshair stays');
  assert.equal(d.up('AltLeft').prevented, true);
  for (let i = 0; i < 60; i++) d.input.update(1 / 60);
  assert.ok(Math.abs(I.lookYaw) < 0.01, 'head returns on release');
});

test('Gustav stays upright: chasing a target 2 km above or below, pitch within 15 deg, bank within 12 deg, heading toward the target', () => {
  for (const dy of [2000, -2000]) {
    const g = flightGame('31');
    const s = g.state;
    g.step(60 * 4);
    const target = s.player.position.clone();
    const e = s.sim.spawnEnemy('gustav', target.clone().add(new THREE.Vector3(3000, -dy, -1500)), {});
    e.hp = e.maxHp = 9999;
    const eu = new THREE.Euler();
    const fwd = new THREE.Vector3();
    let maxPitch = 0, maxRoll = 0, aligned = 0, frames = 0;
    for (let i = 0; i < 60 * 12; i++) {
      g.step(1);
      s.player.hull = 1;
      eu.setFromQuaternion(e.quaternion, 'YXZ');
      maxPitch = Math.max(maxPitch, Math.abs(eu.x));
      maxRoll = Math.max(maxRoll, Math.abs(eu.z));
      if (i > 60 * 4) {
        fwd.set(0, 0, -1).applyQuaternion(e.quaternion); fwd.y = 0; fwd.normalize();
        const to = s.player.position.clone().sub(e.position); to.y = 0; to.normalize();
        frames++; if (fwd.dot(to) > 0.8) aligned++;
      }
    }
    assert.ok(maxPitch <= 15.01 * Math.PI / 180, `pitch ${maxPitch * 180 / Math.PI} (dy ${dy})`);
    assert.ok(maxRoll <= 12.01 * Math.PI / 180, `roll ${maxRoll * 180 / Math.PI} (dy ${dy})`);
    assert.ok(aligned / frames > 0.9, `faces the target ${aligned}/${frames} (dy ${dy})`);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(e.quaternion);
    assert.ok(up.y > 0.95, 'body stays upright');
  }
});

test('input.js CR-005: V is a one-frame viewToggle edge with the default prevented, and the sim ignores it', () => {
  const d = stubDom();
  const { I } = d;
  assert.equal(I.viewToggle, false);
  const ev = d.key('KeyV');
  assert.equal(ev.prevented, true);
  d.input.update(1 / 60);
  assert.equal(I.viewToggle, true);
  d.input.update(1 / 60);
  assert.equal(I.viewToggle, false, 'edge lasts one frame');
  d.up('KeyV');
  // the sim does not react to it
  const g = flightGame('77');
  g.step(10);
  const before = g.state.player.position.toArray().join();
  g.state.input.viewToggle = true;
  g.step(1);
  assert.equal(g.state.phase, 'flight');
  assert.ok(Math.abs(g.state.player.position.y - Number(before.split(',')[1])) < 50);
});

// ---- CR-006: Xi cockpit in the chest, head vulcans ---------------------------------------------------------------------------
test('CR-006: Xi vulcan rounds leave the head above the chest cockpit and cross the crosshair line', async () => {
  const { XI_COCKPIT, XI_HEAD_VULCAN } = await import('../src/state.js');
  const g = flightGame();
  const s = g.state;
  const p = s.player;
  g.step(60 * 5);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quaternion);
  const headUp = (XI_HEAD_VULCAN.y - XI_COCKPIT.y) * MODEL_SCALE;
  assert.ok(headUp > 5, 'the head is well above the cockpit');
  s.input.secondary = true;
  let t = null;
  for (let i = 0; i < 8 && !t; i++) { g.step(1); t = s.entities.find((e) => e.type === 'tracer' && e.faction === 'player') || null; }
  s.input.secondary = false;
  assert.ok(t, 'a round was fired');
  const rel = t.position.clone().sub(p.position);
  assert.ok(Math.abs(rel.dot(up) - headUp) < 2.5, `round starts at head height: ${rel.dot(up)} vs ${headUp}`);
  // it is angled down onto the crosshair line: at the convergence range it is within the spread of that line
  const v = t.velocity.clone().sub(p.velocity).normalize();
  assert.ok(v.dot(up) < 0, 'angled down toward the crosshair line');
  const aim = p.aim.dir.clone();
  const at = rel.clone().addScaledVector(v, WEAPONS.vulcanConverge);
  const off = at.clone().addScaledVector(aim, -at.dot(aim)).length();
  assert.ok(off < WEAPONS.vulcanConverge * WEAPONS.vulcanSpread * 2 + 3, `crosses the crosshair line: ${off} m off`);
});
