// Input layer (owner: input). Turns keyboard, mouse and gamepad into state.input.
// Writes ONLY the state.input fields declared in state.js.
// This module must not import anything. The constants below are copies of the
// values in state.js and MUST stay equal to them.
//
// CR-002 layout
//   Mouse: move = crosshair, left = fire rifle / slash saber, right = vulcan (held), wheel = swap rifle/saber.
//   Keys:  W/S/A/D/Space/Ctrl move, Shift boost, Q/E roll (held), R reload, 1/2 swap, B shield (held),
//          F funnels, C flares, G flight form, N sensor mode, Z zoom, Enter start-up switch,
//          H cockpit hatch (CR-004), X (hold) eject lever, Alt (hold) free-look, P pause. Middle mouse and V are unused.

const AIM_MAX_YAW = 0.62;    // must match AIM_MAX_YAW in state.js
const AIM_MAX_PITCH = 0.40;  // must match AIM_MAX_PITCH in state.js

const DEADZONE = 0.15;
const MOUSE_AIM = 0.0016;    // rad per mouse count, crosshair
const MOUSE_LOOK = 0.003;    // rad per mouse count, head (Alt held)
const PAD_AIM_X = 1.4;       // rad/s at full right-stick deflection
const PAD_AIM_Y = 1.0;
const MOVE_RATE = 6;         // move-axis ramp, units per second

// One-frame edge fields. Each becomes true for exactly one update after a press.
const EDGE_NAMES = [
  'funnel', 'targetCycle', 'flightModeToggle', 'sensorCycle',
  'zoomCycle', 'flare', 'interact', 'pauseToggle', 'reload', 'hatch', 'viewToggle',
];
const KEY_EDGE = {
  KeyF: 'funnel', KeyT: 'targetCycle', KeyG: 'flightModeToggle', KeyN: 'sensorCycle',
  KeyZ: 'zoomCycle', KeyC: 'flare', Enter: 'interact', NumpadEnter: 'interact', KeyP: 'pauseToggle', KeyR: 'reload',
  KeyH: 'hatch', // CR-004: cockpit hatch
  KeyV: 'viewToggle', // CR-005: cockpit <-> third-person chase view (render only)
};
const KEY_SELECT = { Digit1: 'rifle', Numpad1: 'rifle', Digit2: 'saber', Numpad2: 'saber' };
// Standard gamepad mapping, button index -> edge field(s).
//  0 A rise   1 B descend   2 X funnels   3 Y reload (and the start-up switch)   4 LB shield (held)
//  5 RB fire / slash (held)   6 LT vulcan (held)   7 RT boost   8 Back eject lever (held)   9 Start pause
//  10 L3 flight form   11 R3 swap rifle / saber   12 D-up flares   13 D-down sensor mode
//  14 D-left roll left (held)   15 D-right roll right (held)
const PAD_EDGE = {
  3: ['reload', 'interact'], 2: ['funnel'], 10: ['flightModeToggle'], 13: ['sensorCycle'],
  12: ['flare'], 9: ['pauseToggle'],
};
const PAD_SWAP = 11;
// Keys whose default browser action is suppressed while the game runs.
const GAME_KEYS = new Set([
  'Space', 'ControlLeft', 'ShiftLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyB',
  'KeyX', 'KeyF', 'KeyT', 'KeyG', 'KeyN', 'KeyZ', 'KeyC', 'Enter', 'KeyP', 'Digit1', 'Digit2', 'KeyH', 'KeyV',
  'AltLeft', 'AltRight', 'Tab',
]);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const pickLarger = (a, b) => (Math.abs(a) >= Math.abs(b) ? a : b);

function deadzone(v) {
  const x = typeof v === 'number' && isFinite(v) ? v : 0;
  const a = Math.abs(x);
  if (a < DEADZONE) return 0;
  return Math.sign(x) * (a - DEADZONE) / (1 - DEADZONE);
}

// The crosshair points at a spot in the sky. While the body turns, take that turn out of the offset so the aim
// point stays put. `rate` = state.sim.rate: body-axis rates in rad/s, yaw right +, pitch up +, roll right wing
// down +. Rolling rotates the offset around the screen centre (counter-clockwise for roll right, because the
// world appears to turn the opposite way to the body). Exported so the test can check it. Mutates and returns I.
export function compensateAim(I, rate, h) {
  const wy = (Number(rate.yaw) || 0) * h;
  const wp = (Number(rate.pitch) || 0) * h;
  const wr = (Number(rate.roll) || 0) * h;
  let x = I.aimYaw - wy;
  let y = I.aimPitch - wp;
  if (wr !== 0) {
    const c = Math.cos(wr);
    const s = Math.sin(wr);
    const nx = x * c - y * s;
    y = x * s + y * c;
    x = nx;
  }
  I.aimYaw = clamp(x, -AIM_MAX_YAW, AIM_MAX_YAW);
  I.aimPitch = clamp(y, -AIM_MAX_PITCH, AIM_MAX_PITCH);
  return I;
}

function readPad() {
  let pads = null;
  try {
    pads = navigator.getGamepads ? navigator.getGamepads() : null;
  } catch (e) {
    pads = null;
  }
  if (!pads) return null;
  for (const gp of pads) {
    if (gp && gp.connected) return gp;
  }
  return null;
}

export function createInput(canvas, state) {
  const I = state.input;

  const held = new Set();                 // KeyboardEvent.code values currently down
  const edge = {};                        // pending one-frame edges
  for (const n of EDGE_NAMES) edge[n] = false;

  let mouseDX = 0;                        // accumulated movement since last update
  let mouseDY = 0;
  let mouseLeft = false;
  let mouseRight = false;
  let pendingSelect = null;               // 'rifle' | 'saber' | 'toggle' (keys 1/2, wheel, pad R3), one frame
  let kbActivity = false;                 // keyboard or mouse used since last update
  let padPrev = {};                       // previous pressed state per button index

  const locked = () => document.pointerLockElement === canvas;

  function requestLock() {
    try {
      const r = canvas.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) {
      /* pointer lock unsupported */
    }
  }

  function onKeyDown(e) {
    const code = e.code;
    if (GAME_KEYS.has(code)) e.preventDefault(); // Alt: keeps the browser menu from taking focus
    held.add(code);
    kbActivity = true;
    if (!e.repeat) {
      if (Object.prototype.hasOwnProperty.call(KEY_EDGE, code)) {
        edge[KEY_EDGE[code]] = true;
      }
      if (Object.prototype.hasOwnProperty.call(KEY_SELECT, code)) pendingSelect = KEY_SELECT[code];
    }
  }

  function onKeyUp(e) {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    held.delete(e.code);
  }

  function onMouseMove(e) {
    // Pointer lock can be refused (embedded frames, some app views). Movement still
    // counts over the page, so the crosshair works without it.
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
    kbActivity = true;
  }

  function onMouseDown(e) {
    kbActivity = true;
    if (e.button === 0) mouseLeft = true;
    if (e.button === 1) e.preventDefault(); // middle button is unused: stop the browser auto-scroll
    if (e.button === 2) mouseRight = true;
  }

  function onMouseUp(e) {
    if (e.button === 0) mouseLeft = false;
    if (e.button === 2) mouseRight = false;
  }

  function onAuxClick(e) {
    if (e.button === 1) e.preventDefault();
  }

  function onWheel(e) {
    if (e.deltaY !== 0) pendingSelect = 'toggle';
    e.preventDefault();
  }

  function releaseAll() {
    held.clear();
    mouseLeft = false;
    mouseRight = false;
    pendingSelect = null;
    mouseDX = 0;
    mouseDY = 0;
    for (const n of EDGE_NAMES) edge[n] = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  window.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('auxclick', onAuxClick);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', () => {
    if (!locked()) requestLock();
  });

  // Rumble helper for other modules. Silently does nothing when unsupported.
  I.rumble = function rumble(low, high, ms) {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (gp && gp.connected && gp.vibrationActuator && typeof gp.vibrationActuator.playEffect === 'function') {
          const p = gp.vibrationActuator.playEffect('dual-rumble', {
            duration: ms,
            weakMagnitude: clamp(high, 0, 1),
            strongMagnitude: clamp(low, 0, 1),
          });
          if (p && typeof p.catch === 'function') p.catch(() => {});
          return;
        }
      }
    } catch (e) {
      /* vibration unsupported */
    }
  };

  function update(dt) {
    const h = Number(dt) || 0;

    // ---- gamepad ------------------------------------------------------------
    const pad = readPad();
    let padOn = false;
    let lx = 0, ly = 0, rx = 0, ry = 0, lt = 0, rt = 0;
    let padBtn = [];
    const nowPrev = {};
    if (pad) {
      const ax = pad.axes || [];
      padBtn = pad.buttons || [];
      const down = (i) => !!(padBtn[i] && padBtn[i].pressed);
      lx = deadzone(ax[0]);
      ly = deadzone(ax[1]);
      rx = deadzone(ax[2]);
      ry = deadzone(ax[3]);
      padOn = lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0 || padBtn.some((b) => b && b.pressed);
      for (const k of Object.keys(PAD_EDGE)) {
        const idx = Number(k);
        const d = down(idx);
        if (d && !padPrev[idx]) for (const name of PAD_EDGE[k]) edge[name] = true;
        nowPrev[idx] = d;
      }
      const dSwap = down(PAD_SWAP);
      if (dSwap && !padPrev[PAD_SWAP]) pendingSelect = 'toggle';
      nowPrev[PAD_SWAP] = dSwap;
    }
    padPrev = nowPrev;
    if (!padOn) {
      lx = ly = rx = ry = 0;
      padBtn = [];
    } else {
      rt = padBtn[7] ? (padBtn[7].value || 0) : 0;
      lt = padBtn[6] ? (padBtn[6].value || 0) : 0;
    }
    const pb = (i) => !!(padBtn[i] && padBtn[i].pressed);

    // Device: keyboard/mouse activity wins for the frame, otherwise a live pad.
    if (kbActivity) I.device = 'keyboard';
    else if (padOn) I.device = 'gamepad';
    kbActivity = false;

    // ---- crosshair and head look ---------------------------------------------
    // CR-008 story: on foot (phase 'boarding') the mouse / right stick is a free look; the crosshair does not move
    if (state.phase === 'boarding' || state.phase === 'aboard') {   // CR-014: also on foot aboard Seawrack
      I.walkYaw = (I.walkYaw || 0) + mouseDX * MOUSE_LOOK + rx * 2.4 * h;
      I.walkPitch = clamp((I.walkPitch || 0) - mouseDY * MOUSE_LOOK - ry * 1.8 * h, -1.45, 1.45);
      mouseDX = 0; mouseDY = 0; rx = 0; ry = 0;
    }
    const altHeld = held.has('AltLeft') || held.has('AltRight');
    if (altHeld) {
      // Alt held: the mouse turns the head; the crosshair stays put.
      I.lookYaw = clamp(I.lookYaw + mouseDX * MOUSE_LOOK, -2.6, 2.6);
      I.lookPitch = clamp(I.lookPitch - mouseDY * MOUSE_LOOK, -1.3, 1.3);
    } else {
      // Mouse moves the crosshair. The offset does not spring back (the sim auto-centres it by turning the body).
      I.aimYaw += mouseDX * MOUSE_AIM;
      I.aimPitch -= mouseDY * MOUSE_AIM;
      // Head returns to seat forward when released.
      const kLook = Math.exp(-6 * h);
      I.lookYaw *= kLook;
      I.lookPitch *= kLook;
    }
    mouseDX = 0;
    mouseDY = 0;

    // Right stick moves the crosshair as a rate (stick up = aim up).
    I.aimYaw += rx * PAD_AIM_X * h;
    I.aimPitch -= ry * PAD_AIM_Y * h;
    // Keep the aim point fixed in the sky while the body turns and rolls (coupling to state.sim.rate).
    const bodyRate = state.sim && state.sim.rate;
    if (bodyRate && state.phase === 'flight') compensateAim(I, bodyRate, h);
    else {
      I.aimYaw = clamp(I.aimYaw, -AIM_MAX_YAW, AIM_MAX_YAW);
      I.aimPitch = clamp(I.aimPitch, -AIM_MAX_PITCH, AIM_MAX_PITCH);
    }

    // ---- movement: keyboard and gamepad combined (larger magnitude wins) -----
    const kZ = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
    const kX = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
    const kY = (held.has('Space') ? 1 : 0) - (held.has('ControlLeft') ? 1 : 0);
    const gX = lx;
    const gZ = -ly;                        // stick up is a negative axis value; up = forward
    const gY = (pb(0) ? 1 : 0) - (pb(1) ? 1 : 0); // A rises, B descends
    I.moveX = approach(I.moveX, clamp(pickLarger(kX, gX), -1, 1), MOVE_RATE * h);
    I.moveY = approach(I.moveY, clamp(pickLarger(kY, gY), -1, 1), MOVE_RATE * h);
    I.moveZ = approach(I.moveZ, clamp(pickLarger(kZ, gZ), -1, 1), MOVE_RATE * h);

    // ---- boost ----------------------------------------------------------------
    I.boost = clamp(Math.max(held.has('ShiftLeft') ? 1 : 0, rt), 0, 1);

    // ---- held buttons ----------------------------------------------------------
    I.triggerFull = mouseLeft || pb(5);
    I.secondary = mouseRight || lt > 0.3;
    I.shield = held.has('KeyB') || pb(4);
    I.ejectHold = held.has('KeyX') || pb(8);
    I.scoreboard = held.has('Tab'); // CR-003
    const kRoll = (held.has('KeyE') ? 1 : 0) - (held.has('KeyQ') ? 1 : 0);
    const gRoll = (pb(15) ? 1 : 0) - (pb(14) ? 1 : 0);
    I.roll = clamp(pickLarger(kRoll, gRoll), -1, 1);
    I.weaponSelect = pendingSelect;
    pendingSelect = null;

    // ---- legacy fields: kept at fixed values for old readers --------------------
    I.triggerHalf = false;
    I.pitch = 0;
    I.yaw = 0;
    I.brake = 0;
    I.freeAim = false;
    I.throttle = I.moveZ;

    // ---- one-frame edges -----------------------------------------------------
    for (const n of EDGE_NAMES) {
      I[n] = edge[n];
      edge[n] = false;
    }
  }

  return {
    update,
    capture() {
      requestLock();
    },
  };
}
