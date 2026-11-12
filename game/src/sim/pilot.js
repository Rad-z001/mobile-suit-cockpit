// Pilot body: felt g-force, blackout, stress, plus sonic boom / barrier / altitude alerts.
import * as THREE from 'three';
import { GFORCE, BARRIER, ALERTS } from './tuning.js';
import { G, clamp, lerp, raiseAlert, pushEvent } from './util.js';

const _a = new THREE.Vector3();
const _iq = new THREE.Quaternion();

export function updateG(S, dt) {
  const rt = S.sim;
  const p = S.player;
  // proper acceleration (what an accelerometer reads) in player-local space, in g
  // hover: the suit's inertial dampers swallow most of the thrust acceleration; minovsky: unfiltered
  const damped = p.flightMode === 'hover' && (S.phase === 'flight' || S.phase === 'victory');
  _a.copy(p.velocity).sub(rt.prevVel).divideScalar(dt);
  if (damped) _a.multiplyScalar(GFORCE.hoverLinearScale);
  if (!damped) _a.y += G;
  _a.divideScalar(G);
  _iq.copy(p.quaternion).invert();
  _a.applyQuaternion(_iq);
  if (damped) {
    _a.y += 1; // hover: artificial gravity, always along the seat's spine
    // fast hover turns swing the cockpit around the suit's axis: w^2 * r
    const wp = rt.rate.pitch;
    const wy = rt.rate.yaw;
    _a.y += (wp * Math.abs(wp) * GFORCE.turnRadius) / G;
    _a.x -= (wy * Math.abs(wy) * GFORCE.turnRadius) / G;
  }
  const raw = _a.add(rt.gImpulse);
  rt.gSm.lerp(raw, 1 - Math.exp(-dt / 0.08));
  p.gVector.copy(rt.gSm);
  p.gLoad = p.gVector.y;
  rt.gImpulse.multiplyScalar(Math.exp(-dt / 0.25));

  // sudden change vs slow average -> gDamper
  rt.gSlow.lerp(raw, 1 - Math.exp(-dt / 0.3));
  rt.gDamperCd -= dt;
  if (raw.distanceTo(rt.gSlow) > GFORCE.damperJump && rt.gDamperCd <= 0) {
    pushEvent(S, 'gDamper');
    rt.gDamperCd = 0.5;
  }
}

export function updateBlackout(S, dt, active) {
  const p = S.player;
  const g = p.gLoad;
  const eff = g > 0 ? g : -g * GFORCE.negativeGWeight;
  if (active && eff > GFORCE.blackoutThreshold) {
    p.blackout += (eff - GFORCE.blackoutThreshold) * GFORCE.blackoutRate * dt;
  } else {
    p.blackout -= GFORCE.blackoutRecover * dt;
  }
  p.blackout = clamp(p.blackout, 0, 1);
  if (active && eff > GFORCE.highGCaution) raiseAlert(S, 'highg', 'HIGH-G', 'caution', 0.5);
  if (active && p.blackout > 0.5) raiseAlert(S, 'gloc', 'G-LOC WARNING', 'warning', 0.4);
  return eff;
}

export function inputAttenuation(p) {
  const b = p.blackout;
  if (b >= 0.85) return GFORCE.inputAttenuation;
  if (b <= 0.6) return 1;
  return lerp(1, GFORCE.inputAttenuation, (b - 0.6) / 0.25);
}

export function updateStress(S, dt, eff) {
  const p = S.player;
  let floor = clamp((0.6 - p.hull) / 0.6, 0, 1) * 0.8;
  if (p.threat.missileInbound) floor = Math.max(floor, 0.55);
  if (eff > 4) p.stress += (eff - 4) * 0.06 * dt;
  p.stress -= 0.03 * dt;
  if (p.stress < floor) p.stress = Math.min(floor, p.stress + 0.8 * dt);
  p.stress = clamp(p.stress, 0, 1);
}

export function updateSonicAndBarrier(S, dt) {
  const rt = S.sim;
  const p = S.player;
  rt.sonicCd -= dt;
  if (rt.prevMach < 1 && p.mach >= 1 && rt.sonicCd <= 0) {
    pushEvent(S, 'sonicBoom');
    rt.sonicCd = 2;
  }
  rt.prevMach = p.mach;

  const b = p.barrier;
  rt.barrierHitT -= dt;
  if (!rt.barrierDown && b.integrity <= 0.02) {
    rt.barrierDown = true;
    b.integrity = Math.max(0, b.integrity);
    raiseAlert(S, 'barrier', 'BEAM BARRIER FAILURE', 'warning', 4);
  }
  if (rt.barrierDown && b.integrity >= BARRIER.reactivate) rt.barrierDown = false;
  b.active = p.flightMode === 'minovsky' && p.mach > 1 && !rt.barrierDown
    && p.flightTransition.state === 'idle' && p.mods.flightOk;
  if (rt.barrierHitT <= 0) b.integrity = clamp(b.integrity + BARRIER.regen * dt, 0, 1);
  if (b.active && b.integrity < 0.25) raiseAlert(S, 'barrierlow', 'BARRIER INTEGRITY LOW', 'caution', 0.5);
}

const num0 = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// CR-002 item 16: time to impact with the sea along the velocity (altitude / sink rate). Under 3 s: PULL UP.
// A steady hover has no sink rate, so it never warns. The crash itself stays fatal (seaImpact).
export function updateAltitudeWarning(S) {
  const p = S.player;
  const vs = p.velocity.y;
  const tti = vs < -1 ? num0(p.agl, p.altitude) / -vs : Infinity;   // above the ground under the suit (Chapter 3 land)
  const pu = p.pullUp;
  const active = S.phase === 'flight' && tti < ALERTS.pullUpTti;
  if (active && !pu.active) pushEvent(S, 'pullUp', { tti });
  pu.active = active;
  pu.tti = tti;
  if (active) raiseAlert(S, 'pullup', 'PULL UP', 'warning', 0.4);
}
