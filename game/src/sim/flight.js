// Player flight model (CR-002). Both forms are 6-axis: the attitude quaternion is integrated from body-axis rates
// (yaw about body up, pitch about body right, roll about body forward), no pitch limit, no auto-level.
// Hover = mobile-suit form: body-axis thrust sets a target velocity, no gravity, the free crosshair turns the body
// once it leaves the deadzone and auto-centres inside it. Flight form = jet: 150 m/s floor, velocity chases the nose.
import { hasLand, groundAt, groundAhead, waterAt, BODY_CLEAR } from './terrain.js';
import * as THREE from 'three';
import { MACH, AIM_MAX_YAW, AIM_MAX_PITCH, AIM_DEADZONE, AUTO_CENTRE_TAU } from '../state.js';
import { FLIGHT, STARTUP, SHIELD, GAWMAN, BOARD } from './tuning.js';
import { transformScale } from './transform.js';
import { G, R2D, clamp, damp, smoothstep, raiseAlert, rotateToward } from './util.js';

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _vt = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _eul = new THREE.Euler();

export function deriveAttitude(p) {
  const q = p.quaternion;
  _f.set(0, 0, -1).applyQuaternion(q);
  _r.set(1, 0, 0).applyQuaternion(q);
  _u.set(0, 1, 0).applyQuaternion(q);
  p.pitchDeg = Math.asin(clamp(_f.y, -1, 1)) * R2D;
  let h = Math.atan2(_f.x, -_f.z) * R2D;
  if (h < 0) h += 360;
  if (h >= 360) h -= 360;
  p.headingDeg = h;
  p.rollDeg = Math.atan2(-_r.y, _u.y) * R2D;
}

// world direction of the crosshair: body quaternion applied to (yaw right+, pitch up+) from body forward
export function updateAimDir(p) {
  const a = p.aim;
  const cp = Math.cos(a.pitch);
  a.dir.set(Math.sin(a.yaw) * cp, Math.sin(a.pitch), -Math.cos(a.yaw) * cp).applyQuaternion(p.quaternion).normalize();
}

const num = (x) => (Number.isFinite(x) ? x : 0);

function deriveMotion(p, S) {
  const sp = p.velocity.length();
  p.speed = sp;
  p.mach = sp / MACH;
  p.altitude = p.position.y;
  p.verticalSpeed = p.velocity.y;
  // Chapter 3 land: height above whatever is under the suit (ground or water); over the open sea it equals altitude
  p.agl = S && hasLand(S) ? p.position.y - groundAt(S, p.position.x, p.position.z) : p.position.y;
}

// Startup: the suit falls inside the Cargo Pisa container. No control.
export function stepGlide(S, dt) {
  const rt = S.sim;
  const p = S.player;
  const su = S.startup;
  const prog = su.stage + su.progress; // 0..4
  const calm = smoothstep(1.5, 3.2, prog);
  p.velocity.x = damp(p.velocity.x, STARTUP.glideVelocity[0], 1.5, dt);
  // CR-008 / CR-009 story: the suit is still clamped in the cargo, which holds its altitude until the release (no time limit)
  const inCargo = rt.boardDone && S.setup && S.setup.mission === 'story1';
  p.velocity.y = damp(p.velocity.y, inCargo ? BOARD.cargoVel[1] : STARTUP.glideVelocity[1] * (1 - 0.6 * calm), 1.5, dt);
  p.velocity.z = damp(p.velocity.z, STARTUP.glideVelocity[2], 1.5, dt);
  p.position.addScaledVector(p.velocity, dt);
  const t = rt.time;
  const amp = 1 - calm;
  _eul.set(
    -0.14 * amp + 0.025 * amp * Math.sin(t * 1.7),
    0.02 * amp * Math.sin(t * 0.7),
    0.05 * amp * Math.sin(t * 1.3),
    'YXZ'
  );
  p.quaternion.setFromEuler(_eul);
  p.throttle = 0;
  p.gVector.set(0.03 * Math.sin(t * 2.3) * amp, 0.35 + 0.65 * smoothstep(0, 4, prog), 0.02 * Math.sin(t * 3.1) * amp);
  p.gLoad = p.gVector.y;
  rt.gSm.copy(p.gVector);
  rt.prevVel.copy(p.velocity);
  p.aim.yaw = 0; p.aim.pitch = 0; p.aim.turning = 0;
  updateAimDir(p);
  deriveAttitude(p);
  deriveMotion(p, S);
}

const PARKED_INPUT = { moveX: 0, moveY: 0, moveZ: 0, aimYaw: 0, aimPitch: 0, roll: 0, boost: 0 };

export function stepFlight(S, dt, controlled) {
  const rt = S.sim;
  const p = S.player;
  const inp = rt.parked ? PARKED_INPUT : S.input;   // Chapter 3: parked on the pad (W/S and Enter drive the talk)
  const hover = p.flightMode === 'hover';
  const m = FLIGHT[p.flightMode];
  const v = p.velocity;
  const aim = p.aim;
  const mods = p.mods;
  const xf = p.flightTransition;
  const xfOn = xf.state !== 'idle';
  const rate = rt.rate; // body-axis rates, rad/s: yaw (right +), pitch (nose up +), roll (right wing down +)
  const raw = rt.aimRaw; // crosshair offset as requested (flight form clamps aim.yaw/pitch to the forward cone)
  rt.prevVel.copy(v);
  const att = controlled ? rt.inputAtt : 0;
  const tf = controlled ? rt.thrustFactor : 0;
  const thrustX = controlled ? transformScale(p, 'thrust') : 1;
  const turnX = controlled ? transformScale(p, 'turn') * mods.turn : 1;

  // ---- attitude + free crosshair -------------------------------------------
  if (controlled) {
    // crosshair follows the input (blackout makes it sluggish)
    const tY = clamp(num(inp.aimYaw), -AIM_MAX_YAW, AIM_MAX_YAW);
    const tP = clamp(num(inp.aimPitch), -AIM_MAX_PITCH, AIM_MAX_PITCH);
    if (att >= 0.999) { raw.yaw = tY; raw.pitch = tP; }
    else {
      const k = 1 - Math.exp(-dt / (0.05 + 0.6 * (1 - att)));
      raw.yaw += (tY - raw.yaw) * k;
      raw.pitch += (tP - raw.pitch) * k;
    }
    if (hover) {
      aim.yaw = raw.yaw; aim.pitch = raw.pitch; aim.limited = false;
    } else {
      // flight form: the nose is the aim. Weapons only see the forward cone.
      aim.yaw = clamp(raw.yaw, -m.aimLimitYaw, m.aimLimitYaw);
      aim.pitch = clamp(raw.pitch, -m.aimLimitPitch, m.aimLimitPitch);
      aim.limited = Math.abs(raw.yaw) > m.aimLimitYaw + 1e-9 || Math.abs(raw.pitch) > m.aimLimitPitch + 1e-9;
    }

    // body turning: nothing inside the deadzone, rising smoothly to full rate at the limit
    const nY = raw.yaw / AIM_MAX_YAW;
    const nP = raw.pitch / AIM_MAX_PITCH;
    const r = Math.hypot(nY, nP);
    const dz = AIM_DEADZONE / AIM_MAX_YAW;
    const u = clamp((r - dz) / (1 - dz), 0, 1);
    const sTurn = u * u * (3 - 2 * u);
    const sc = r > 1e-6 ? sTurn / r : 0;
    let tYawRate = nY * sc * m.turnYaw * att * turnX;
    let tPitchRate = nP * sc * m.turnPitch * att * turnX;
    tYawRate += rt.bias.yaw * m.yawBiasScale;
    // auto-centre (item 8): inside the central zone the body turns to bring the crosshair back to centre.
    // input.js takes the body turn out of the offset, so the offset decays with time constant AUTO_CENTRE_TAU
    // while the aim point stays on the same spot in the sky. Hover only; the flight-form nose is the aim.
    let centring = false;
    if (hover && !xfOn) {
      const w = 1 - u;
      tYawRate += (raw.yaw / AUTO_CENTRE_TAU) * w * att;
      tPitchRate += (raw.pitch / AUTO_CENTRE_TAU) * w * att;
      centring = w > 0.5 && Math.hypot(raw.yaw, raw.pitch) > 0.003;
    }
    const tRollRate = clamp(num(inp.roll), -1, 1) * m.rollRate * att * mods.roll * transformScale(p, 'turn');
    rate.yaw = damp(rate.yaw, tYawRate, m.turnTau, dt);
    rate.pitch = damp(rate.pitch, tPitchRate, m.turnTau, dt);
    rate.roll = damp(rate.roll, tRollRate, m.rollTau, dt);
    aim.turning = clamp(damp(aim.turning, sTurn * att, 0.1, dt), 0, 1);
    aim.centring = centring;
  } else {
    // wreck: tumble under fixed angular rates
    aim.yaw = damp(aim.yaw, 0, 0.3, dt);
    aim.pitch = damp(aim.pitch, 0, 0.3, dt);
    raw.yaw = aim.yaw; raw.pitch = aim.pitch;
    aim.turning = 0;
    aim.centring = false;
    aim.limited = false;
    rate.pitch = damp(rate.pitch, rt.tumble.x, 1.2, dt);
    rate.yaw = damp(rate.yaw, rt.tumble.y, 1.44, dt);
    rate.roll = damp(rate.roll, rt.tumble.z, 1.08, dt);
  }
  // body-axis quaternion integration (the same for the pilot and a wreck)
  _w.set(rate.pitch, -rate.yaw, -rate.roll);
  const ang = _w.length() * dt;
  if (ang > 1e-9) {
    _w.normalize();
    _dq.setFromAxisAngle(_w, ang);
    p.quaternion.multiply(_dq).normalize();
  }
  _f.set(0, 0, -1).applyQuaternion(p.quaternion);
  _r.set(1, 0, 0).applyQuaternion(p.quaternion);
  _u.set(0, 1, 0).applyQuaternion(p.quaternion);

  // ---- engine / boost / overheat -----------------------------------------------
  const mx = controlled ? clamp(num(inp.moveX), -1, 1) : 0;
  const my = controlled ? clamp(num(inp.moveY), -1, 1) : 0;
  const mz = controlled ? clamp(num(inp.moveZ), -1, 1) : 0;
  p.throttle = clamp(damp(p.throttle, mz, hover ? m.throttleTau : FLIGHT.throttleTau, dt), -1, 1);

  const moving = hover ? (Math.abs(mx) + Math.abs(my) + Math.abs(mz) > 0.1) : mz > 0.1;
  let boostAmt = 0;
  if (controlled && !rt.overheated && inp.boost > 0.05 && moving) {
    boostAmt = clamp(inp.boost, 0, 1) * (att > 0.5 ? 1 : att);
  }
  if (boostAmt > 0) {
    p.thrusterHeat += (hover ? FLIGHT.boostHeatRate : FLIGHT.boostHeatRateMinovsky * mods.boostHeat) * boostAmt * dt;
  } else {
    p.thrusterHeat -= (rt.overheated ? FLIGHT.overheatCoolRate : FLIGHT.coolRate) * dt;
  }
  p.thrusterHeat = clamp(p.thrusterHeat, 0, 1);
  if (!rt.overheated && p.thrusterHeat >= 1) {
    rt.overheated = true;
    raiseAlert(S, 'overheat', 'THRUSTER OVERHEAT', 'warning', 2);
  }
  if (rt.overheated) {
    if (p.thrusterHeat <= FLIGHT.overheatResume) rt.overheated = false;
    else raiseAlert(S, 'overheat', 'THRUSTER OVERHEAT — COOLING', 'warning', 0.5);
  } else if (p.thrusterHeat > 0.8) {
    raiseAlert(S, 'thermal', 'THRUSTER TEMP HIGH', 'caution', 0.4);
  }
  rt.boosting = boostAmt > 0.05;

  // ---- translation ----------------------------------------------------------------
  const gain = 0.35 + 0.65 * att; // blackout dulls the thrusters a little
  if (hover) rt.flightLaunched = false;
  const launching = controlled && hover && xf.state === 'toFlight' && xf.t >= 0.8;
  if (launching) {
    // drive spools up: the suit accelerates along the nose up to the flight-form floor speed
    if (v.dot(_f) < FLIGHT.minovsky.minSpeed) v.addScaledVector(_f, FLIGHT.minovsky.launchAccel * dt);
  } else if (controlled && hover) {
    // target velocity from body-axis thrust requests (forward, right, up of the suit)
    const shieldMove = 1 - (1 - SHIELD.moveScale) * clamp(p.shield.raise, 0, 1);
    const sc = mods.speed * thrustX * shieldMove;
    const fwdSpeed = m.cruise * (mz >= 0 ? mz : mz * m.backScale);
    const bl = 1 + (m.boost / m.cruise - 1) * boostAmt * mods.boost;
    _vt.set(0, 0, 0)
      .addScaledVector(_f, fwdSpeed)
      .addScaledVector(_r, mx * m.cruise * m.strafeScale)
      .addScaledVector(_u, my * m.cruise * m.vertScale * mods.vertical);
    _vt.multiplyScalar(bl * gain * (0.55 + 0.45 * tf) * sc);
    // SPEED SYNC (sim/missions/gawman.js): the no-thrust velocity is the falling man's velocity (weight as.w) and thrust is
    // relative to him, a full stick worth at most as.maxRel m/s (it shrinks with the gap). The cap grows by his speed,
    // so a full match plus the pilot's thrust is never clipped.
    const as = rt.assist;
    const syncW = as && as.w > 0 ? as.w : 0;
    const full = m.cruise * bl * sc;                       // what a full stick asks for (boost included)
    if (syncW > 0) {
      const lp = _vt.length();
      if (lp > full) _vt.multiplyScalar(full / lp);          // diagonal keys are never worth more than a full stick
      const k = Math.min(1, (Number.isFinite(as.maxRel) ? as.maxRel : full) / Math.max(1, full));
      _vt.multiplyScalar(1 - syncW * (1 - k));
      if (as.dir && Number.isFinite(as.closeCap)) {          // hatch not open: no pushing into him (away / sideways is free)
        const c = _vt.dot(as.dir);
        if (c > as.closeCap) _vt.addScaledVector(as.dir, (as.closeCap - c) * syncW);
      }
      _vt.addScaledVector(as.vel, syncW);
    }
    const lim = full + (syncW > 0 ? as.vel.length() * syncW : 0);
    const l = _vt.length();
    if (l > lim) _vt.multiplyScalar(lim / l);
    // ground / ceiling assist so holding Ctrl cannot fly the suit into the sea
    // over land: height above the highest ground along the next 1.5 s of track, so it climbs before a ridge
    const alt = hasLand(S) ? p.position.y - groundAhead(S, p.position, v, 1.5, 0.5) : p.position.y;
    if (alt < 400) _vt.y = Math.max(_vt.y, alt < FLIGHT.floorClear ? (FLIGHT.floorClear - alt) * 1.2 : -(alt - FLIGHT.floorClear));
    if (alt > FLIGHT.ceiling - 400) _vt.y = Math.min(_vt.y, FLIGHT.ceiling - alt);
    _dv.copy(_vt).sub(v);
    const tau = _vt.lengthSq() > v.lengthSq() ? m.tauUp : m.tauDown;
    _dv.multiplyScalar(1 - Math.exp(-dt / tau));
    const cap = m.maxAccel * dt;
    const dl = _dv.length();
    if (dl > cap) _dv.multiplyScalar(cap / dl);
    v.add(_dv);
    if (_vt.lengthSq() < 1e-6 && v.lengthSq() < 4) v.set(0, 0, 0);
  } else if (controlled) {
    // flight form: thrust along the nose, velocity chases the nose, never slower than the floor
    const toHover = xf.state === 'toHover';
    const floorV = toHover ? 0 : m.minSpeed;
    const cruise = m.cruise * mods.flightSpeed;
    const boostV = m.boost * mods.flightSpeed;
    const vAlong = v.dot(_f);
    let vt;
    if (toHover) vt = 0;
    else {
      const base = floorV + (cruise - floorV) * Math.max(p.throttle, 0);
      vt = base + (boostV - base) * boostAmt;
    }
    const err = vt - vAlong;
    let a;
    if (err > 0) {
      a = Math.min(err * 0.8, (m.accel + m.boostAccel * boostAmt) * tf * thrustX);
      if (vAlong < floorV) a = Math.max(a, m.launchAccel);
    } else {
      const dec = m.decel + (toHover ? m.toHoverDecel : 0);
      a = -Math.min(-err * 0.8, dec);
    }
    v.addScaledVector(_f, a * dt);
    if (mx !== 0 || my !== 0) {
      v.addScaledVector(_r, mx * m.lateralThrust * gain * dt).addScaledVector(_u, my * m.lateralThrust * gain * dt);
    }
    // drift: velocity chases the nose, limited by lateral acceleration
    const sp1 = v.length();
    if (sp1 > 1) {
      const va = v.dot(_f);
      const phi = Math.acos(clamp(va / sp1, -1, 1));
      if (phi > 1e-4) {
        const grip = va > 0 ? m.grip : m.grip * 0.5;
        let step = phi * (1 - Math.exp(-grip * dt));
        const maxStep = (m.latAccel * (0.6 + 0.4 * Math.max(tf, 0.3)) * dt) / sp1;
        if (step > maxStep) step = maxStep;
        rotateToward(v, _f, step);
      }
    }
    const cap = boostV * 1.04;
    let spd = v.length();
    if (spd > cap) { v.multiplyScalar(cap / spd); spd = cap; }
    // no stall: once the floor speed has been reached it cannot be lost again
    if (!toHover) {
      if (!rt.flightLaunched && spd >= floorV - 0.5) rt.flightLaunched = true;
      if (rt.flightLaunched && spd < floorV) {
        if (spd < 1) v.copy(_f).multiplyScalar(floorV); else v.multiplyScalar(floorV / spd);
      }
    }
  }

  // ---- gravity (none in hover; mild in flight form; full for a wreck) -----------------------
  let gEff = 0;
  if (!controlled) gEff = G;
  else if (!hover) gEff = G * m.gravityScale * (1 - smoothstep(FLIGHT.liftSpeedLo, FLIGHT.liftSpeedHi, v.length()));
  v.y -= gEff * dt;
  if (!controlled) v.multiplyScalar(Math.exp(-0.02 * dt));
  if (!hover || !controlled) {
    if (p.position.y > FLIGHT.ceiling) v.y -= (p.position.y - FLIGHT.ceiling) * 0.02 * dt;
  }

  p.position.addScaledVector(v, dt);
  rt.seaContact = false;
  rt.groundHit = 0;
  if (hasLand(S) && !waterAt(S, p.position.x, p.position.z)) {
    // Chapter 3 land: the suit scrapes over rock and grass instead of dying - pushed up, the downward speed taken
    // away, damage by how hard it hit (sim/index.js)
    const floor = groundAt(S, p.position.x, p.position.z) + BODY_CLEAR;
    if (p.position.y < floor) {
      rt.groundHit = Math.max(0, -v.y) + 0.15 * v.length();
      p.position.y = floor;
      if (v.y < 0) v.y = 0;
      v.multiplyScalar(0.92);
    }
  } else if (p.position.y <= 0.5) {
    rt.seaContact = true;
    p.position.y = 0.5;
  }

  updateAimDir(p);
  deriveAttitude(p);
  deriveMotion(p, S);
}
