// Pilot head / camera rig. CR-002 items 1 + 2: the cockpit is STABLE.
// No rifle recoil, no idle sway or breathing, no head lean toward the crosshair, no g-force sway, no trauma shake.
// What remains:
//   - free look (Alt): input.lookYaw / lookPitch
//   - one short, small jolt when the player takes a hit (about 0.15 s)
//   - flight transform: one damped pitch pulse (at most 0.5 deg) and a +4 deg FOV change
//   - FOV: Mach widening, sonic-boom kick, zoom
//   - scripted end sequences (suit dead: slow tumble; hatch blow / eject) keep their drama
// Cockpit space: origin = sphere centre = neutral eye point, +Y up, -Z forward, +X right.
//   rig.seatPos / rig.seatQuat : seat pivot transform (fixed now, kept for cockpit.js)
//   rig.camPos  / rig.camQuat  : eye position / orientation (free-look + jolt)
//   rig.fov (vertical degrees, display) and rig.worldFov (after zoom)
// The world camera orientation is playerQuat * rig.camQuat. playerQuat includes the free roll (Q/E).
import * as THREE from 'three';
import { Spring, clamp, damp, wobble, smoothstep, saturate, num, isVec, DEG } from './util.js';

export const SEAT_PIVOT = new THREE.Vector3(0, -0.52, 0.18);
const ZOOM_LEVELS = [1, 3, 8];
const JOLT_TIME = 0.15;

export function createCameraRig(state) {
  const rig = {
    fov: 90,
    worldFov: 90,
    zoomVis: 1,
    camPos: new THREE.Vector3(),
    camQuat: new THREE.Quaternion(),
    seatPos: SEAT_PIVOT.clone(),
    seatQuat: new THREE.Quaternion(),
    shake: 0,           // kept for HUD jitter: only non-zero during the hit jolt
    tumble: 0,
    time: 0,
  };

  const stroke = new Spring(9, 0.8);           // hatch blow only
  let trauma = 0;                              // scripted end sequences only
  let fovKick = 0, fovXf = 0;
  let joltT = 0, joltAmp = 0;
  const joltDir = new THREE.Vector3(0, 0, -1);
  let xfPulseT = -1;                           // seconds since the transform pitch pulse started
  let lastXfT = 0, lastXfState = 'idle';
  let ly = 0, lp = 0, first = true;
  const lookQ = new THREE.Quaternion();
  const shakeQ = new THREE.Quaternion();
  const lookE = new THREE.Euler(0, 0, 0, 'YXZ');
  const shakeE = new THREE.Euler(0, 0, 0, 'YXZ');
  const off = new THREE.Vector3();

  function onEvent(e) {
    switch (e.type) {
      case 'playerHit': {
        const d = isVec(e.dir) ? e.dir : { x: 0, y: 0, z: -1 };
        joltDir.set(d.x, d.y, d.z);
        joltT = JOLT_TIME;
        joltAmp = 0.5 + 0.5 * saturate(num(e.damage, 0.2) * 3);
        break;
      }
      case 'sonicBoom': fovKick = 5; break;
      case 'hatchBlow': trauma = 1; stroke.v += 2; break;
      case 'ejectLever': trauma = Math.min(1, trauma + 0.2); break;
      default: break;
    }
  }
  // explosions no longer shake the cockpit
  function onExplosion() {}

  function update(dt, aspect) {
    const p = state.player || {};
    const inp = state.input || {};
    const phase = state.phase;
    rig.time += dt;
    const t = rig.time;
    stroke.step(0, dt);

    // ---- scripted end sequences (the only remaining shake) -------------------------------------
    let floor = 0;
    if (phase === 'ejected') floor = 0.7;
    trauma = Math.max(0, trauma - dt * 1.5);
    const tr = Math.max(trauma, floor);
    const sh = tr * tr;
    const sw = t * 22;
    const sx = wobble(sw, 1) * sh * 0.035, sy = wobble(sw, 2) * sh * 0.035, sz = wobble(sw, 3) * sh * 0.02;
    const rp = wobble(sw, 4) * sh * 0.06, ry = wobble(sw, 5) * sh * 0.045, rr = wobble(sw, 6) * sh * 0.07;
    let tumR = 0, tumP = 0, sag = 0;
    if (phase === 'disabled') {
      tumR = Math.sin(t * 1.1) * 0.10 + Math.sin(t * 2.3) * 0.04;
      tumP = Math.sin(t * 0.8) * 0.07 + Math.sin(t * 1.9) * 0.03;
      sag = -0.03;
    }
    rig.tumble = Math.abs(tumR) + Math.abs(tumP);

    // ---- hit jolt: short, small, linear decay ----------------------------------------------------
    joltT = Math.max(0, joltT - dt);
    const jk = joltT / JOLT_TIME;
    const jolt = jk * jk * joltAmp;
    rig.shake = Math.min(1, sh + jolt * 0.5);
    const jx = -joltDir.x * 0.012 * jolt, jy = -joltDir.y * 0.012 * jolt, jz = -joltDir.z * 0.012 * jolt;
    const jr = joltDir.x * 0.006 * jolt, jp = (-joltDir.y * 0.006 - 0.003) * jolt;

    // ---- transform pitch pulse: <= 0.5 deg over 0.4 s at t = 0.8 of a hover -> flight transform ---------
    const ft = p.flightTransition || {};
    const fstate = ft.state || 'idle', ftt = num(ft.t, 0);
    if (fstate === 'toFlight' && lastXfT < 0.8 && ftt >= 0.8) xfPulseT = 0;
    if (fstate === 'toFlight' && lastXfState !== 'toFlight' && ftt >= 0.8) xfPulseT = 0;
    lastXfT = ftt; lastXfState = fstate;
    let xfPitch = 0;
    if (xfPulseT >= 0) {
      xfPulseT += dt;
      const u = xfPulseT / 0.4;
      if (u >= 1) xfPulseT = -1;
      else xfPitch = 0.5 * DEG * Math.sin(Math.PI * u) * Math.exp(-2.2 * u) * 2.2;   // peak ~0.5 deg
      xfPitch = Math.min(xfPitch, 0.5 * DEG);
    }

    // ---- free look (Alt) -------------------------------------------------------------------------
    const tly = num(inp.lookYaw, 0), tlp = num(inp.lookPitch, 0);
    if (first || !(dt > 0)) { ly = tly; lp = tlp; first = false; }
    else { ly = damp(ly, tly, 22, dt); lp = damp(lp, tlp, 22, dt); }
    lookE.set(lp, -ly, 0);                               // yaw right = rotate about -Y; pitch up = rotate about +X
    lookQ.setFromEuler(lookE);
    shakeE.set(rp + jp + tumP + xfPitch, ry, rr + jr + tumR);
    shakeQ.setFromEuler(shakeE);

    // ---- seat + camera transform (seat is fixed) --------------------------------------------------------
    rig.seatQuat.identity();
    rig.seatPos.set(SEAT_PIVOT.x, SEAT_PIVOT.y, SEAT_PIVOT.z + stroke.x);
    off.set(jx + sx, jy + sy + sag, jz + sz);
    rig.camPos.copy(off);
    rig.camQuat.copy(lookQ).multiply(shakeQ);

    // ---- FOV --------------------------------------------------------------------------------------------
    const mach = num(p.mach, 0);
    fovKick = damp(fovKick, 0, 4, dt);
    fovXf = damp(fovXf, fstate !== 'idle' ? 4 : 0, 3, dt);        // +4 deg over about 1 s, eases back after
    const target = 90 + 8 * smoothstep(0.92, 1.08, mach) + fovKick + fovXf;
    rig.fov = first ? target : damp(rig.fov, target, 2.5, dt);
    let vf = rig.fov;
    const asp = aspect || 16 / 9;
    const hf = 2 * Math.atan(Math.tan(vf * DEG / 2) * asp) / DEG;
    if (hf > 128) vf = (2 * Math.atan(Math.tan(64 * DEG) / asp)) / DEG;     // keep ultra-wide sane
    rig.dispFov = vf;
    const sens = p.sensors || {};
    const z = ZOOM_LEVELS.includes(sens.zoom) ? sens.zoom : Math.max(1, num(sens.zoom, 1));
    rig.zoomVis = dt > 0 ? damp(rig.zoomVis, z, 9, dt) : z;
    rig.worldFov = (2 * Math.atan(Math.tan(vf * DEG / 2) / rig.zoomVis)) / DEG;
  }

  rig.update = update;
  rig.onEvent = onEvent;
  rig.onExplosion = onExplosion;
  rig.dispFov = 90;
  return rig;
}
