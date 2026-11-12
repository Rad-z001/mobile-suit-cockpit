// CR-004 cockpit hatch. player.hatch = { state, t, open, locked }.
//   state: 'closed' -> 'unlocking' (HATCH_UNLOCK_TIME) -> 'opening' (HATCH_OPEN_TIME) -> 'open'
//          -> 'closing' (HATCH_CLOSE_TIME) -> 'closed'.  Closing an open hatch needs no unlock step.
//   t     progress 0..1 of the running transition (0 in the two stable states).
//   open  0..1 how far the doors are apart, eased (smoothstep) by sim. 0 while unlocking.
//   locked true only when closed and sealed (false from the moment unlocking starts).
// H (input.hatch) toggles in flight. A press during a transition is queued (one) and runs when it ends.
// While not locked: rifle / funnels / saber are locked (sim/weapons.js), vulcans still work.
// Above HATCH.windSpeed an open hatch raises WIND + 'hatchWind' + buffeting; above damageSpeed it slowly hurts the hull.
import { HATCH_UNLOCK_TIME, HATCH_OPEN_TIME, HATCH_CLOSE_TIME } from '../state.js';
import { HATCH } from './tuning.js';
import { clamp, pushEvent, raiseAlert } from './util.js';

const ease = (t) => t * t * (3 - 2 * t);
const stable = (h) => h.state === 'closed' || h.state === 'open';

// open = true: the cold-start state (doors fully apart, unlocked). false: sealed.
export function resetHatch(S, open) {
  const h = S.player.hatch;
  const rt = S.sim;
  h.state = open ? 'open' : 'closed';
  h.t = 0;
  h.open = open ? 1 : 0;
  h.locked = !open;
  rt.hatchQueue = false;
  rt.hatchWindT = 0;
  rt.ejectUnlocking = false;
}

// start the transition that flips a stable hatch. Returns false when a transition is already running.
export function toggleHatch(S) {
  const h = S.player.hatch;
  if (h.state === 'closed') {
    h.state = 'unlocking'; h.t = 0; h.open = 0; h.locked = false;
    pushEvent(S, 'hatchUnlock');
    return true;
  }
  if (h.state === 'open') {
    h.state = 'closing'; h.t = 0; h.locked = false;
    pushEvent(S, 'hatchClose');
    return true;
  }
  return false;
}

// close an open hatch (cold start). No-op unless the hatch is open.
export function closeHatch(S) {
  return S.player.hatch.state === 'open' ? toggleHatch(S) : false;
}

// ---- eject: the hatch unlocks during the last HATCH_UNLOCK_TIME of the lever pull, then blows ----
export function ejectUnlockStart(S) {
  const rt = S.sim;
  if (rt.ejectUnlocking || S.player.hatch.state !== 'closed') return;
  rt.ejectUnlocking = true;
  toggleHatch(S); // closed -> unlocking (event hatchUnlock); stepHatch holds it at t = 1 until the blow
}
export function ejectUnlockCancel(S) {
  const rt = S.sim;
  if (!rt.ejectUnlocking) return;
  rt.ejectUnlocking = false;
  const h = S.player.hatch;
  if (h.state === 'unlocking') { h.state = 'closed'; h.t = 0; h.open = 0; h.locked = true; pushEvent(S, 'hatchLocked'); }
}
export function ejectBlow(S) {
  const rt = S.sim;
  const h = S.player.hatch;
  rt.ejectUnlocking = false;
  rt.hatchQueue = false;
  h.state = 'open'; h.t = 0; h.open = 1; h.locked = false;
}

// opts: input (H works), wind (buffeting / damage apply), speed (time scale of the transition, cold start in a match)
export function stepHatch(S, dt, opts = {}) {
  const rt = S.sim;
  const p = S.player;
  const h = p.hatch;
  const allowInput = !!opts.input;
  const k = opts.speed || 1;

  if (allowInput && !rt.ejectUnlocking) {
    if (stable(h) && rt.hatchQueue) { rt.hatchQueue = false; toggleHatch(S); }
    if (S.input.hatch) {
      if (stable(h)) { rt.hatchQueue = false; toggleHatch(S); } else rt.hatchQueue = true;
    }
  } else if (!allowInput && !rt.ejectUnlocking) rt.hatchQueue = false;

  const d = dt * k;
  if (h.state === 'unlocking') {
    h.t = Math.min(1, h.t + d / HATCH_UNLOCK_TIME);
    h.open = 0;
    if (h.t >= 1 && !rt.ejectUnlocking) { h.state = 'opening'; h.t = 0; pushEvent(S, 'hatchOpen'); }
  } else if (h.state === 'opening') {
    h.t = Math.min(1, h.t + d / HATCH_OPEN_TIME);
    h.open = ease(h.t);
    if (h.t >= 1) { h.state = 'open'; h.t = 0; h.open = 1; pushEvent(S, 'hatchOpened'); }
  } else if (h.state === 'closing') {
    h.t = Math.min(1, h.t + d / HATCH_CLOSE_TIME);
    h.open = 1 - ease(h.t);
    if (h.t >= 1) { h.state = 'closed'; h.t = 0; h.open = 0; h.locked = true; pushEvent(S, 'hatchLocked'); }
  }

  // ---- wind -------------------------------------------------------------------------------
  if (!opts.wind) { rt.hatchWindT = 0; return; }
  const exposure = h.locked ? 0 : h.open;
  const speed = p.speed;
  if (exposure < 0.05 || speed <= HATCH.windSpeed) { rt.hatchWindT = 0; return; }
  const bad = speed > HATCH.damageSpeed;
  raiseAlert(S, 'wind', bad ? 'HATCH OPEN — WIND DAMAGE' : 'HATCH OPEN — WIND', bad ? 'warning' : 'caution', 0.4);
  rt.hatchWindT -= dt;
  if (rt.hatchWindT <= 0) { rt.hatchWindT = HATCH.windEvery; pushEvent(S, 'hatchWind', { speed }); }
  const amp = HATCH.buffet * clamp((speed - HATCH.windSpeed) / 80, 0, 2.5) * exposure;
  const rng = rt.rng;
  rt.gImpulse.x += rng.range(-1, 1) * amp;
  rt.gImpulse.y += rng.range(-1, 1) * amp;
  rt.gImpulse.z += rng.range(-1, 1) * amp * 0.5;
  if (bad && S.phase === 'flight' && !(rt.netOn && S.match.spawnShield > 0)) {
    const rate = HATCH.damageRate * (1 + (speed - HATCH.damageSpeed) / 200) * exposure;
    p.hull = Math.max(Math.min(p.hull, HATCH.damageFloor), p.hull - rate * dt);
  }
}
