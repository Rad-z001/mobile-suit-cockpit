// Simulation entry point. createSim(state) -> { update(dt) }.
// Private runtime lives under state.sim (see the list in createRuntime).
import * as THREE from 'three';
import { createRng } from './rng.js';
import { tickAlerts, tickMessage, pushEvent, raiseAlert, clamp } from './util.js';
import { stepGlide, stepFlight } from './flight.js';
import {
  updateG, updateBlackout, updateStress, updateSonicAndBarrier, updateAltitudeWarning, inputAttenuation,
} from './pilot.js';
import { refreshShips, updateSensorInputs, updateTargeting, clearTargeting } from './sensors.js';
import { stepWeapons, stepShield } from './weapons.js';
import { stepTransform, resetTransform } from './transform.js';
import { spawnEnemy, stepEnemies, sweepDeaths } from './enemies.js';
import { stepProjectiles, cleanupEntities, updateThreat } from './projectiles.js';
import {
  damagePlayer, updateEject, updateSectors, seaImpact, recomputeThrust, updateParts,
} from './damage.js';
import { initStartup, updateStartup, updateMission, updateGawman, updateLaneAfter, holdStartAltitude } from './mission.js';
import { stepHatch } from './hatch.js';
import { isStory, updateBoarding, syncStory, stepCargo } from './boarding.js';
import { updateAboard } from './missions/aboard.js';
import { createNetSync } from './netsync.js';
import { createMatch } from './match.js';

function createRuntime(S, seed) {
  const rt = S.sim || (S.sim = {});
  Object.assign(rt, {
    rng: createRng(seed),
    nextId: 1,
    byId: new Map(),
    time: 0,
    holdWaves: false,          // tests / debugging: freeze wave progression
    ships: [],                 // living gustav/penelope this client simulates, rebuilt every frame
    targets: [],               // CR-003: hostile things the pilot can aim at (AI incl. mirrors, hostile remote suits)
    remotes: [],               // CR-003: living remote pilots
    netOn: false,              // CR-003: a multiplayer match is running (see sim/match.js)
    startupDone: false,
    boardDone: false,          // CR-008 story: the pilot has entered the hatch (see sim/boarding.js; rt.board holds the scene)
    board: null,
    // flight
    rate: { pitch: 0, yaw: 0, roll: 0 }, // body-axis turn rates, rad/s (yaw: right +, pitch: nose up +, roll: right wing down +)
    aimRaw: { yaw: 0, pitch: 0 }, // crosshair offset as requested (flight form clamps player.aim to the forward cone)
    flightLaunched: false,     // flight form: floor speed reached, no stall from here
    xfDuration: 1,             // s, length of the transformation in progress
    prevTrigger: false, prevShieldKey: false, saberHit: false, legSide: 1,
    tumble: new THREE.Vector3(),
    prevVel: S.player.velocity.clone(),
    gSm: new THREE.Vector3(0, 1, 0),
    gSlow: new THREE.Vector3(0, 1, 0),
    gImpulse: new THREE.Vector3(),
    gDamperCd: 0,
    overheated: false,
    boosting: false,
    sonicCd: 0,
    prevMach: S.player.mach,
    barrierDown: false,
    barrierHitT: 0,
    thrusters: [1, 1, 1, 1],
    thrustFactor: 1,
    bias: { yaw: 0, roll: 0 },
    inputAtt: 1,
    seaContact: false,
    // weapons
    shotsFired: 0,
    hits: 0,
    funnelCd: 0,
    funnelRegen: 0,
    vulcanT: 0,
    // eject
    ejectProgress: 0,          // 0..1, renderer may use it for the lever animation
    ejectHeld: false,
    // monitor sectors
    sector: Array.from({ length: 8 }, () => ({ base: 1, recoverAt: Infinity, recoverTo: 1, flickT: 0, flick: 1 })),
    // mission
    startupBusy: false,
    waveState: 'startup',
    waveTimer: 0,
    waveStartTime: 0,
  });
  // test / debug helpers
  rt.spawnEnemy = (type, position, opts) => spawnEnemy(S, type, position, opts);
  rt.damagePlayer = (amount, fromDirWorld, opts) => damagePlayer(S, amount, fromDirWorld || null, opts);
  return rt;
}

export function createSim(state, opts = {}) {
  const S = state;
  const rt = createRuntime(S, opts.seed ?? 0x1c0ffee);
  recomputeThrust(S);
  initStartup(S);
  const ns = createNetSync(S, rt);
  const match = createMatch(S, rt);

  function activeFrame(dt) {
    const p = S.player;
    const phase = S.phase;
    const inFlight = phase === 'flight';
    const controlled = inFlight || phase === 'victory' || phase === 'failed';
    const hostile = phase === 'flight' || phase === 'disabled' || (rt.netOn && rt.nt.state === 'live');

    rt.inputAtt = controlled ? inputAttenuation(p) : 0;
    refreshShips(S);

    updateParts(S);
    // CR-004: cockpit hatch (H works in flight only); the wind effects need the suit to be flying
    stepHatch(S, dt, { input: inFlight, wind: controlled || phase === 'disabled' });
    if (inFlight) stepTransform(S, dt);
    else resetTransform(S);
    if (controlled) updateSensorInputs(S);
    stepShield(S, dt, inFlight);

    stepFlight(S, dt, controlled);
    if (rt.seaContact) {
      if (phase === 'flight') {
        // slow touch-and-go is survivable only barely; at speed it is fatal
        if (p.speed > 40 || p.velocity.y < -15) { seaImpact(S); return; }
        p.velocity.y = Math.max(p.velocity.y, 10);
        damagePlayer(S, 0.15, null);
      } else if (phase === 'disabled') {
        seaImpact(S);
        return;
      } else if (phase === 'ejected') {
        p.velocity.set(0, 0, 0);
      } else {
        p.velocity.y = Math.max(p.velocity.y, 10);
      }
    }

    // pilot body
    updateG(S, dt);
    const eff = updateBlackout(S, dt, inFlight || phase === 'disabled');
    updateStress(S, dt, eff);
    if (controlled) {
      updateSonicAndBarrier(S, dt);
      updateAltitudeWarning(S);
    } else if (p.pullUp.active) {
      p.pullUp.active = false;
      p.pullUp.tti = Infinity;
    }

    // targeting + weapons
    if (inFlight) {
      updateTargeting(S, dt, rt.inputAtt > 0.3);
      stepWeapons(S, dt, true, rt.inputAtt);
    } else {
      if (S.player.lock.targetId !== null || S.player.lock.state !== 'none') clearTargeting(S);
    }

    // world
    stepEnemies(S, dt, hostile);
    stepProjectiles(S, dt);
    sweepDeaths(S);
    updateThreat(S);
    if (p.threat.missileInbound && inFlight) {
      raiseAlert(S, 'missile', 'MISSILE INBOUND', 'warning', 0.4);
    }

    if (phase === 'flight' || phase === 'disabled') S.mission.elapsed += (phase === 'disabled' ? dt : 0);
    if (inFlight && !rt.netOn) updateMission(S, dt);
    if (S.mission.id === 'gawman' && !rt.netOn && (inFlight || phase === 'victory' || phase === 'failed')) updateGawman(S, dt);
    if (rt.waveState === 'lane' && !rt.netOn && phase === 'failed') updateLaneAfter(S, dt);   // Chapter 1: lost him, keep the world moving
    if ((S.phase === 'flight' || S.phase === 'disabled') && !rt.netOn) updateEject(S, dt);
    if (S.phase === 'flight' && p.hull < 0.25 && p.hull > 0) raiseAlert(S, 'hullcrit', 'HULL CRITICAL', 'warning', 0.5);
    updateSectors(S, dt);
    if (S.story.chapter === 1 && !rt.netOn) stepCargo(S, dt);   // CR-008: the released cargo falls on and hits the sea
  }

  // CR-003: own suit destroyed or match over: the world keeps running, the pilot does not
  function deadFrame(dt) {
    const p = S.player;
    p.velocity.set(0, 0, 0);
    p.speed = 0;
    refreshShips(S);
    stepEnemies(S, dt, rt.netOn && rt.nt.state === 'live');
    stepProjectiles(S, dt);
    sweepDeaths(S);
    updateThreat(S);
    updateSectors(S, dt);
  }

  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    rt.time += dt;
    match.pre(dt);
    if (rt.netOn) ns.receive(dt);
    switch (S.phase) {
      case 'boarding':           // CR-008 story: the pilot is outside, crossing to the falling cargo
        updateBoarding(S, dt);
        break;
      case 'aboard':             // CR-014 story interlude: on foot aboard Seawrack
        updateAboard(S, dt);
        break;
      case 'startup':
        updateStartup(S, dt);
        if (S.phase === 'startup') { stepGlide(S, dt); holdStartAltitude(S); }
        if (S.phase === 'startup' && rt.boardDone && isStory(S)) syncStory(S);   // still clamped in the cargo
        updateSectors(S, dt);
        if (rt.netOn) match.hold();
        break;
      case 'respawn':
      case 'matchOver':
        deadFrame(dt);
        break;
      case 'flight':
      case 'failed':
      case 'disabled':
      case 'ejected':
      case 'victory':
        activeFrame(dt);
        break;
      default: break;
    }
    cleanupEntities(S);
    tickAlerts(S, dt);
    tickMessage(S, dt);
    if (rt.netOn) { match.post(dt); ns.post(dt); }
  }

  return { update };
}
