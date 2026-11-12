// CR-004 GAWMAN RETRIEVAL mission (night). See docs/PLAN-gawman-retrieval.md.
//   approach: close on the scripted neutral Penelope carrier (type 'penelope', faction 'neutral', ~110 m/s, gentle weave).
//   jump:     player within GAWMAN.jumpDist of her, or GAWMAN.jumpTime after the flight starts -> radio + 'gawmanJump'.
//   falling:  Gawman (type 'gawman', faction 'neutral', radius 1, `light` = flashlight direction) falls with gravity and
//             quadratic drag (terminal GAWMAN.terminal). Catch point = player position + body forward * catchOffset.
//             Hatch fully open, catch point within catchRadius and relative speed <= catchSpeed -> 'gawmanCaught'.
//             Hull contact (within contactRadius of the player) above contactSpeed, or with the hatch not fully open,
//             or altitude below seaAlt -> 'gawmanLost' {reason: 'hull' | 'sea'}, phase 'failed'.
//   aboard:   close the hatch (sealed) -> phase 'victory'.
// mission.rescue is rewritten every frame (see the contract comment in state.js).
// The rescue core (jump, fall, readout, assist, catch / hull / sea) is shared with the Chapter 1 story beat, where Lane Aim's
// Penelope lets Gawman go over the Xi (sim/missions/lane.js): gawmanJump() and stepRescue() take the radio lines.
import * as THREE from 'three';
import { MODEL_SCALE } from '../../state.js';
import { ENEMY, ENEMY_PARTS, GAWMAN } from '../tuning.js';
import { G, makeEntity, pushEvent, setMessage, orientShip, forwardOf } from '../util.js';
import { endMission } from '../damage.js';
import { requestHover } from '../transform.js';

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _iq = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _ax = new THREE.Vector3();

const DRAG_K = G / (GAWMAN.terminal * GAWMAN.terminal);

export function makeRescue() {
  return {
    phase: 'approach', penelopeId: null, gawmanId: null,
    distance: 0, closing: 0, relVel: new THREE.Vector3(), relSpeed: 0, catchPoint: new THREE.Vector3(),
    inEnvelope: false, timeToSea: Infinity,
    assist: 0, sync: 'off', syncW: 0, catchRadius: GAWMAN.catchRadius, catchSpeed: GAWMAN.catchSpeed, dangerSpeed: GAWMAN.contactSpeed,
    hint: '',
  };
}

// state of the mission script (private, state.sim.gm)
function makeScript() {
  return {
    t: 0, jumped: false, over: false, penelope: null, gawman: null,
    base: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), hintT: -99, hintText: '',
  };
}

// remove the mission's entities and runtime (restart / mission change)
export function resetGawman(S) {
  const rt = S.sim;
  for (const e of S.entities) if (e.type === 'gawman' || (e.type === 'penelope' && e.faction === 'neutral')) e.alive = false;
  rt.gm = null;
  rt.assist = { w: 0, vel: new THREE.Vector3(), maxRel: Infinity, dir: new THREE.Vector3(0, 0, -1), closeCap: Infinity };
}

// the flight starts: spawn the carrier 1.5 km ahead (same altitude, along the horizontal heading)
export function beginGawman(S) {
  const rt = S.sim;
  const p = S.player;
  resetGawman(S);
  const gm = rt.gm = makeScript();
  forwardOf(p.quaternion, _f);
  _f.y = 0;
  if (_f.lengthSq() < 0.09) _f.set(0, 0, -1);
  _f.normalize();
  gm.dir.copy(_f);
  gm.base.copy(p.position).addScaledVector(_f, GAWMAN.penelopeAhead);
  const c = ENEMY.penelope;
  const e = makeEntity(S, {
    type: 'penelope', faction: 'neutral', name: 'RX-104FF PENELOPE', radius: c.radius * MODEL_SCALE, hp: c.hp, maxHp: c.hp,
    heat: c.heat, ttl: Infinity, targetId: null,
  });
  e.parts = {};
  for (const [name, hp] of Object.entries(ENEMY_PARTS.hp.penelope)) e.parts[name] = { hp, maxHp: hp, status: 'ok' };
  e.state = 'carrier';
  e.sim = { neutral: true, mods: null };
  e.position.copy(gm.base);
  e.velocity.copy(_f).multiplyScalar(GAWMAN.penelopeSpeed);
  e.quaternion.identity();
  orientShip(e, _f, 1, 1);
  gm.penelope = e;
  S.mission.rescue = makeRescue();
  S.mission.rescue.penelopeId = e.id;
  S.mission.objective = 'CLOSE ON PENELOPE';
  setMessage(S, 'CARGO PISA: Penelope is carrying Gawman. Close on her, Xi. He will jump when you are near.', 8);
}

function stepPenelope(S, dt) {
  const gm = S.sim.gm;
  const e = gm.penelope;
  if (!e || !e.alive) return;
  const [a1, a2] = GAWMAN.weaveAmp;
  const w1 = (2 * Math.PI) / GAWMAN.weavePeriod[0];
  const w2 = (2 * Math.PI) / GAWMAN.weavePeriod[1];
  const t = gm.t;
  gm.base.addScaledVector(gm.dir, GAWMAN.penelopeSpeed * dt);
  _r.set(-gm.dir.z, 0, gm.dir.x); // right of the heading
  e.position.copy(gm.base)
    .addScaledVector(_r, a1 * Math.sin(w1 * t))
    .addScaledVector(_up, a2 * Math.sin(w2 * t + 1));
  e.velocity.copy(gm.dir).multiplyScalar(GAWMAN.penelopeSpeed)
    .addScaledVector(_r, a1 * w1 * Math.cos(w1 * t))
    .addScaledVector(_up, a2 * w2 * Math.cos(w2 * t + 1));
  _d.copy(e.velocity).normalize();
  orientShip(e, _d, 3 * dt, dt);
}

// the mission's own radio lines (the Chapter 1 beat passes Lane Aim's)
const LINES = {
  jump: 'PENELOPE: Gawman is away! He is falling. Open the hatch and get under him!',
  caught: 'GAWMAN: I am in! I am IN! Close the hatch!',
  lostHull: 'PENELOPE: Gawman! GAWMAN! ...He hit the hull. We lost him.',
  lostSea: 'PENELOPE: He is in the sea. We lost him, Xi.',
};

// rt.gm for a carrier the caller flies itself (lane.js): the same script fields the rescue core reads
export function makeRescueScript(penelope) {
  const gm = makeScript();
  gm.penelope = penelope;
  return gm;
}

export function gawmanJump(S, L = LINES) {
  const rt = S.sim;
  const gm = rt.gm;
  const pen = gm.penelope;
  gm.jumped = true;
  const e = makeEntity(S, {
    type: 'gawman', faction: 'neutral', name: 'GAWMAN', radius: GAWMAN.radius, hp: 1, maxHp: 1, heat: 0.45, ttl: Infinity,
    targetId: null,
  });
  e.state = 'falling';
  e.position.copy(pen.position);
  e.position.y -= 7; // out of the carrier's belly
  e.velocity.copy(pen.velocity);
  e.velocity.y -= 2;
  e.quaternion.setFromEuler(new THREE.Euler(rt.rng.range(-0.5, 0.5), rt.rng.range(0, 6.28), rt.rng.range(-0.5, 0.5)));
  e.light = new THREE.Vector3(0, -1, 0);
  e.sim = { w: new THREE.Vector3(), seed: rt.rng.range(0, 100) };
  gm.gawman = e;
  const r = S.mission.rescue || (S.mission.rescue = makeRescue());
  r.penelopeId = pen.id;
  r.phase = 'falling';
  r.gawmanId = e.id;
  pushEvent(S, 'gawmanJump');
  setMessage(S, L.jump, 7);
}

// gravity + quadratic drag (terminal ~55 m/s; his horizontal speed bleeds off the same way), a flailing tumble, a wobbling flashlight
function stepGawmanBody(S, e, dt) {
  const t = S.sim.gm.t + e.sim.seed;
  const v = e.velocity;
  const sp = v.length();
  v.addScaledVector(v, -DRAG_K * sp * dt);
  v.y -= G * dt;
  e.position.addScaledVector(v, dt);
  // tumble: angular rate wanders about three axes
  const w = e.sim.w;
  w.set(1.4 * Math.sin(t * 0.9 + 1), 1.1 * Math.sin(t * 1.3), 1.6 * Math.sin(t * 0.7 + 2));
  const ang = w.length() * dt;
  if (ang > 1e-9) {
    _ax.copy(w).normalize();
    _dq.setFromAxisAngle(_ax, ang);
    e.quaternion.multiply(_dq).normalize();
  }
  // flashlight: roughly toward the pilot, wobbling
  _d.copy(S.player.position).sub(e.position).normalize();
  e.light.copy(_d);
  e.light.x += 0.34 * Math.sin(t * 3.1);
  e.light.y += 0.30 * Math.sin(t * 2.3 + 1);
  e.light.z += 0.34 * Math.sin(t * 2.7 + 2);
  e.light.normalize();
}

function timeToSea(e) {
  _p.copy(e.position);
  _v.copy(e.velocity);
  const h = 0.5;
  for (let i = 0; i < 240; i++) {
    const sp = _v.length();
    _v.addScaledVector(_v, -DRAG_K * sp * h);
    _v.y -= G * h;
    _p.addScaledVector(_v, h);
    if (_p.y <= 0) return (i + 1) * h;
  }
  return Infinity;
}

function hint(S, text) {
  const gm = S.sim.gm;
  const r = S.mission.rescue;
  r.hint = text;
  if (!text) return;
  const since = gm.t - gm.hintT;
  if ((text !== gm.hintText && since > 0.8) || since > GAWMAN.hintCooldown) {
    gm.hintText = text;
    gm.hintT = gm.t;
    pushEvent(S, 'rescueHint', { text });
  }
}

function fail(S, reason, L) {
  const rt = S.sim;
  const gm = rt.gm;
  gm.over = true;
  const r = S.mission.rescue;
  r.phase = 'lost';
  r.inEnvelope = false;
  r.assist = 0; r.syncW = 0; r.sync = 'off';
  r.hint = '';
  rt.assist.w = 0;
  S.phase = 'failed';
  endMission(S, false);
  S.mission.result.reason = reason;
  pushEvent(S, 'gawmanLost', { reason });
  if (reason === 'hull') {
    S.mission.objective = 'GAWMAN HIT THE HULL';
    setMessage(S, L.lostHull, 9999);
    pushEvent(S, 'explosion', { position: S.player.position.clone(), size: 1 });
  } else {
    S.mission.objective = 'GAWMAN LOST';
    setMessage(S, L.lostSea, 9999);
  }
}

// every frame in 'flight' / 'victory' / 'failed' (single player gawman mission)
export function updateGawman(S, dt) {
  const rt = S.sim;
  const gm = rt.gm;
  const m = S.mission;
  const p = S.player;
  if (!gm) return;
  const flying = S.phase === 'flight';
  gm.t += dt;
  if (flying) m.elapsed += dt;
  stepPenelope(S, dt);
  // ---- jump ----
  if (!gm.jumped && flying) {
    if (gm.penelope.position.distanceTo(p.position) <= GAWMAN.jumpDist || gm.t >= GAWMAN.jumpTime) gawmanJump(S);
  }
  const out = stepRescue(S, dt, LINES);
  if (out === 'approach') { m.objective = 'CLOSE ON PENELOPE'; m.rescue.assist = 0; return; }
  if (out === 'sealed') {
    // doors sealed -> mission complete
    S.phase = 'victory';
    endMission(S, true);
    m.rescue.hint = '';
    m.objective = 'GAWMAN SAFE';
    setMessage(S, 'PENELOPE: Gawman is safe. Good flying, Xi. Bring him home.', 9999);
  }
}

// SPEED SYNC: automatic once he has jumped and the catch point is inside GAWMAN.syncRange. A flight-form Xi drops to
// hover (requestHover); in hover (no transformation running) the strength syncW ramps to 1 over syncEngage s, and the
// flight model (sim/flight.js) makes his velocity the no-thrust velocity with that weight. It only matches speed - it
// never steers toward him; the pilot's thrust is relative to him and tops out at max(syncMinRel, syncGain x gap) m/s.
// r.sync: 'off' (out of range) | 'hover' (waiting for hover form) | 'engaging' | 'locked' (full strength AND the speeds
// have actually matched once: relative speed under catchSpeed; it stays locked while the strength holds).
// The pilot cannot leave hover while it is engaged (transform.js reads rt.syncHoldT). The thrust limit also counts the
// gap to the HULL (he can come in beside the cockpit), and with the hatch not fully open the pilot cannot push toward
// him inside ~syncHullStop m of the hull (limit only, along the line to him: it never steers).
function stepSync(S, r, g, dist, dt) {
  const rt = S.sim, p = S.player;
  const inRange = dist <= GAWMAN.syncRange;
  if (inRange) rt.syncHoldT = rt.time;
  if (inRange && requestHover(S)) pushEvent(S, 'syncHover');
  const ready = inRange && p.flightMode === 'hover' && p.flightTransition.state === 'idle';
  r.syncW = ready ? Math.min(1, r.syncW + dt / GAWMAN.syncEngage) : Math.max(0, r.syncW - dt / GAWMAN.syncRelease);
  const was = r.sync;
  const matched = r.syncW >= 1 && (was === 'locked' || r.relSpeed <= GAWMAN.catchSpeed);
  r.sync = !inRange ? 'off' : !ready ? 'hover' : matched ? 'locked' : 'engaging';
  if (r.sync === 'locked' && was !== 'locked') pushEvent(S, 'syncLocked');
  _d.copy(g.position).sub(p.position);
  const dc = _d.length();
  const hullGap = dc - GAWMAN.contactRadius;
  rt.assist.w = r.syncW;
  rt.assist.vel.copy(g.velocity);
  rt.assist.maxRel = Math.max(GAWMAN.syncMinRel, GAWMAN.syncGain * Math.min(dist, Math.max(0, hullGap)));
  rt.assist.dir.copy(_d).divideScalar(Math.max(1e-6, dc));
  rt.assist.closeCap = p.hatch.state === 'open' ? Infinity : GAWMAN.syncGain * Math.max(0, hullGap - GAWMAN.syncHullStop);
  r.assist = r.syncW;
}

// The rescue core, every frame once rt.gm exists (the caller advances gm.t, flies the carrier and triggers the jump):
// Gawman's fall, the readout, the tracking assist, the catch, hull and sea checks, objective and hints.
// L: radio lines { caught, lostHull, lostSea }. Returns
//   'idle' (not flying) | 'approach' (no jump yet) | 'falling' | 'caught' (this frame) | 'aboard' (hatch still open) |
//   'sealed' (aboard and the hatch closed) | 'lost' (this frame or earlier: phase 'failed', reason in mission.result).
export function stepRescue(S, dt, L = LINES) {
  const rt = S.sim;
  const gm = rt.gm;
  const m = S.mission;
  const p = S.player;
  const flying = S.phase === 'flight';
  const r = m.rescue;
  const g = gm.gawman;
  const pen = gm.penelope;
  if (g && g.alive) {
    stepGawmanBody(S, g, dt);
    if (g.position.y <= 0) g.alive = false; // splashed (after a 'sea' fail, or unnoticed)
  }
  if (!r) return flying ? 'approach' : 'idle';

  // ---- readout ----
  forwardOf(p.quaternion, _f);
  r.catchPoint.copy(p.position).addScaledVector(_f, GAWMAN.catchOffset);
  const tgt = g && g.alive ? g : (!gm.jumped ? pen : null);
  if (tgt && !gm.over && r.phase !== 'aboard') {
    _d.copy(tgt.position).sub(r.catchPoint);
    const dist = _d.length();
    _v.copy(tgt.velocity).sub(p.velocity); // world relative velocity
    r.closing = dist > 1e-6 ? -_v.dot(_d) / dist : 0;
    r.distance = dist;
    r.relSpeed = _v.length();
    _iq.copy(p.quaternion).invert();
    r.relVel.copy(_v).applyQuaternion(_iq);
    r.inEnvelope = tgt === g && dist <= GAWMAN.catchRadius && r.relSpeed <= GAWMAN.catchSpeed;
    r.timeToSea = tgt === g ? timeToSea(g) : Infinity;
  }
  rt.assist.w = 0;
  if (!flying) return gm.over ? 'lost' : 'idle';
  if (!gm.jumped) return 'approach';

  if (r.phase === 'aboard') {
    if (p.hatch.state === 'closed') return 'sealed';
    m.objective = 'CLOSE THE HATCH';
    hint(S, p.hatch.state === 'open' ? 'CLOSE THE HATCH [H]' : '');
    return 'aboard';
  }
  if (gm.over || !g || !g.alive) return 'lost';

  // ---- falling: SPEED SYNC, catch, fail ----
  const hatch = p.hatch;
  const dist = r.distance;
  stepSync(S, r, g, dist, dt);
  _d.copy(g.position).sub(p.position);
  const dc = _d.length(); // from the suit centre (the hull)
  if (hatch.state === 'open' && r.inEnvelope) {
    g.alive = false;
    r.phase = 'aboard';
    r.timeToSea = Infinity;
    rt.assist.w = 0;
    r.assist = 0; r.syncW = 0; r.sync = 'off';
    pushEvent(S, 'gawmanCaught');
    m.objective = 'CLOSE THE HATCH';
    setMessage(S, L.caught, 7);
    hint(S, 'CLOSE THE HATCH [H]');
    return 'caught';
  }
  if (dc <= GAWMAN.contactRadius && (hatch.state !== 'open' || r.relSpeed > GAWMAN.contactSpeed)) {
    fail(S, 'hull', L);
    return 'lost';
  }
  if (g.position.y < GAWMAN.seaAlt) {
    fail(S, 'sea', L);
    return 'lost';
  }

  // objective + hints
  m.objective = hatch.state === 'open' ? 'MATCH SPEED — CATCH GAWMAN' : 'OPEN THE HATCH — CATCH GAWMAN';
  let h = '';
  const openish = hatch.state === 'open' || hatch.state === 'opening' || hatch.state === 'unlocking';
  if (!openish && dist < 900) h = 'OPEN THE HATCH [H]';
  else if (r.sync === 'hover') h = 'SPEED SYNC — DROPPING TO HOVER';
  else if (hatch.state === 'open' && dist < 120 && r.relSpeed > GAWMAN.contactSpeed) h = 'TOO FAST';
  else if (dist < 350 && r.relSpeed > GAWMAN.catchSpeed && Math.abs(r.relVel.y) >= Math.max(Math.abs(r.relVel.x), Math.abs(r.relVel.z))) h = 'MATCH HIS FALL';
  else if (dist < 350 && r.relSpeed > GAWMAN.catchSpeed) h = 'MATCH SPEED';
  else if (r.timeToSea < 12) h = 'LOW — HURRY';
  else if (dist < 60 && hatch.state === 'open' && !r.inEnvelope) h = 'CLOSE IN SLOWLY';
  hint(S, h);
  return 'falling';
}
