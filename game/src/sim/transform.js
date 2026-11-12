// Flight-form transformation state machine (CR-002 item 12, docs/PLAN-flight-form.md).
// hover -> flight takes 2.0 s, flight -> hover 1.4 s, then a 3 s cooldown. Once started it cannot be cancelled.
// p.flightMode only flips at the END of the transformation (hover physics run with reduced thrust and turn
// until then). While transforming: no weapons (p.weaponsLocked), thrust x0.5, turn x0.6, barrier off.
import { FLIGHT } from './tuning.js';
import { pushEvent, raiseAlert } from './util.js';

const F = FLIGHT.minovsky;

// 0..1: how healthy the flight unit (backpack) is. 0 = lost, flight form refused.
export function flightUnitHealth(S) {
  const p = S.player;
  if (!p.mods.flightOk) return 0;
  return Math.max(0, Math.min(1, p.parts.pack.hp));
}

export function isTransforming(p) {
  return p.flightTransition.state !== 'idle';
}

// thrust / turn multiplier while transforming
export function transformScale(p, which) {
  if (p.flightTransition.state === 'idle') return 1;
  return which === 'thrust' ? F.xformThrustScale : F.xformTurnScale;
}

function begin(S, to, forced) {
  const p = S.player;
  const xf = p.flightTransition;
  const rt = S.sim;
  xf.state = to === 'minovsky' ? 'toFlight' : 'toHover';
  xf.t = 0;
  xf.cooldown = 0;
  rt.xfDuration = (to === 'minovsky' ? F.toFlightTime : F.toHoverTime) * (p.mods.xformTime || 1);
  p.weaponsLocked = true;
  // saber / shield state is cleared when a transformation starts
  if (p.weapons.active !== 'rifle') {
    p.weapons.active = 'rifle';
    pushEvent(S, 'weaponSwap', { active: 'rifle' });
  }
  pushEvent(S, 'flightTransformStart', { to });
  pushEvent(S, 'flightMode', { mode: to });
  if (!forced) pushEvent(S, 'uiClick');
}

function refuse(S, reason) {
  pushEvent(S, 'flightRefused', { reason });
  raiseAlert(S, 'flightlost', reason, 'warning', 2.5);
}

// called once per frame while the player is in control (phase 'flight')
export function stepTransform(S, dt) {
  const p = S.player;
  const rt = S.sim;
  const xf = p.flightTransition;
  const inp = S.input;
  if (xf.cooldown > 0) xf.cooldown = Math.max(0, xf.cooldown - dt);
  if (p.suit === 'gustav') { // CR-003: the Gustav Karl has no flight form
    if (inp.flightModeToggle) {
      pushEvent(S, 'flightRefused', { reason: 'notEquipped' });
      raiseAlert(S, 'flightlost', 'NOT EQUIPPED', 'caution', 2);
    }
    return;
  }

  if (xf.state === 'idle') {
    if (inp.flightModeToggle && xf.cooldown <= 0) {
      if (p.flightMode === 'hover') {
        if (flightUnitHealth(S) <= 0) refuse(S, 'FLIGHT UNIT LOST');
        else begin(S, 'minovsky', false);
      } else begin(S, 'hover', false);
    } else if (inp.flightModeToggle && p.flightMode === 'hover' && flightUnitHealth(S) <= 0) {
      refuse(S, 'FLIGHT UNIT LOST'); // refusal is not subject to the cooldown
    }
    // flight unit lost while in flight form: forced revert (ignores the cooldown)
    if (xf.state === 'idle' && p.flightMode === 'minovsky' && flightUnitHealth(S) <= 0) {
      refuse(S, 'FLIGHT UNIT LOST');
      begin(S, 'hover', true);
    }
  }

  if (xf.state !== 'idle') {
    xf.t = Math.min(1, xf.t + dt / rt.xfDuration);
    p.weaponsLocked = true;
    if (xf.t >= 1) {
      const to = xf.state === 'toFlight' ? 'minovsky' : 'hover';
      xf.state = 'idle';
      xf.t = 0;
      xf.cooldown = F.cooldown;
      p.weaponsLocked = false;
      if (to === 'minovsky' && flightUnitHealth(S) <= 0) {
        // pack destroyed while the transformation ran: stay in hover
        refuse(S, 'FLIGHT UNIT LOST');
        pushEvent(S, 'flightTransformEnd', { mode: 'hover' });
      } else {
        p.flightMode = to;
        pushEvent(S, 'flightTransformEnd', { mode: to });
        if (to === 'hover') rt.flightLaunched = false;
      }
    }
  } else {
    p.weaponsLocked = false;
  }
}

// when the player stops being in control (disabled, ejected): freeze the machine
export function resetTransform(S) {
  const p = S.player;
  p.flightTransition.state = 'idle';
  p.flightTransition.t = 0;
  p.weaponsLocked = false;
}
