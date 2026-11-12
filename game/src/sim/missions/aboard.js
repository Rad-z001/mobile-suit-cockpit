// CR-014 story interlude "Aboard Seawrack" (ends Chapter 2). Phase 'aboard', state.story.stage:
//   'homecoming' outside shot: hold two's covers open like a clamshell, the Xi goes down inside it to hide, the covers
//                close (CR-014b, owner); render owns the camera; Enter skips after 1 s
//   'deck'       straight cut to the pilot on foot beside the closed hold; walk the deck to the door under the bridge; optional talks (crew, Codex entries)
//   'corridor'   a short corridor with notices to read; the lift at its end
//   'lift'       black, a short ride up
//   'command'    the bridge-level Command room: the briefing (Iram Masam, the Captain) with optional questions
//   'end'        fade out, then phase 'victory' (Chapter 2 complete, Chapter 3 unlocked: state.story.unlock = 3)
// Chapter 3 opening (owner: "walk through the bridge to the Gundam, like the space cargo"), beginLaunchWalk:
//   'hold'       the pilot on foot in hold two under the closed covers: a gantry runs from the forward bulkhead to the
//                Xi's open chest hatch at cockpit height (CATWALK); the deck chief and Gawman see him off
//   'board'      reaching the hatch fades to black, then phase 'startup' seated in the Xi (story.stage 'cockpit'); the
//                cold start and the launch out of the hold belong to sim/missions/oenbili.js
// The pilot walks in the ship's model frame (render/seawrack.js: bow toward -Z, +X starboard, y up from the waterline);
// state.story.walk holds that, state.story.pilot the same in world space. The ship keeps sailing.
// Talking: state.story.talk = { id, node, i, lines, choices, sel } while a conversation is open; Enter advances, W / S
// pick a choice. Dialogue and Codex text: aboardScript.js.
import * as THREE from 'three';
import { ABOARD as A, SEAWRACK as C } from '../tuning.js';
import { XI_COCKPIT, XI_MODEL_HEIGHT } from '../../state.js';   // the cockpit point of the hidden suit
import { pushEvent, setMessage, clamp } from '../util.js';
import { endMission } from '../damage.js';
import { resetHatch } from '../hatch.js';
import { PEOPLE, PEOPLE_BY_ID } from './aboardScript.js';

const D = C.deckY;
const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// hold two (render/seawrack.js HOLD): the Xi goes down inside it in the homecoming shot and stays there, facing the bow
export const HOLD2 = { z0: -C.portalZ + 9, z1: -C.bridgeZ - C.bridgeHalf - 4, floor: -8 };
export const XI_HOLD = { x: 0, z: (HOLD2.z0 + HOLD2.z1) / 2, feet: HOLD2.floor + 0.2 };
const SUIT_POINT = [0, XI_HOLD.feet + XI_MODEL_HEIGHT / 2 + XI_COCKPIT.y, XI_HOLD.z];   // its cockpit, for player.position
export const SUIT_COCKPIT = SUIT_POINT;
// Chapter 3: the gantry across hold two, model frame. A wider landing at the forward bulkhead door (pad half width, padLen
// long), then a narrow walkway to the Xi's chest; y = its floor (just under the cockpit), z1 = the open hatch.
export const CATWALK = { half: 0.85, pad: 3.2, padLen: 3.4, z0: HOLD2.z0 + 1.2, z1: XI_HOLD.z - 5.0, y: SUIT_POINT[1] - 1.2 };

export function shipToWorld(sw, l, out) {
  const c = Math.cos(sw.heading), s = Math.sin(sw.heading);
  return out.set(sw.position.x + l.x * c - l.z * s, sw.position.y + l.y, sw.position.z + l.x * s + l.z * c);
}

// height of the deck surface under the pilot (model frame): the pitched landing hatch lid, its coaming, else the deck
export function floorY(area, x, z) {
  if (area === 'command') return D + A.command.floor;
  if (area === 'hold') return CATWALK.y;
  if (area !== 'deck') return D;
  const W2 = C.shipBeam / 2 - 4.6;
  if (z > -C.portalZ + 9 && z < -C.bridgeZ - C.bridgeHalf - 4) {
    if (Math.abs(x) <= W2) return D + 3.4 + 1.2 * (1 - Math.abs(x) / W2);
    if (Math.abs(x) <= C.shipBeam / 2 - 4) return D + 1.6;
  }
  return D;
}

function context(S) {
  const st = S.story, sw = st.seawrack || {}, p = S.player, parts = p.parts || {};
  const vals = Object.values(parts);
  return {
    detections: (st.radar && st.radar.alerts) || 0, found: !!sw.found, shipHull: typeof sw.hp === 'number' ? sw.hp : 1,
    xiHull: p.hull, armLost: !!((parts.rArm && parts.rArm.status === 'destroyed') || (parts.lArm && parts.lArm.status === 'destroyed')),
    partsHurt: vals.filter((q) => q.status !== 'ok').length, kills: S.mission.kills || 0,
  };
}

export function beginAboard(S) {
  const rt = S.sim, st = S.story, p = S.player;
  const ab = rt.aboard = { t: 0, fadeT: 0, said: {}, visited: {}, taken: {}, selPrev: 0, ctx: context(S), in0: { yaw: S.input.walkYaw || 0, pitch: S.input.walkPitch || 0 }, briefed: false };
  void ab;
  S.phase = 'aboard';
  st.stage = 'homecoming';
  st.cine = 0; st.fade = 0;
  st.area = 'deck';
  st.walk = { pos: new THREE.Vector3(A.start[0], D + A.eye, A.start[2]), vel: new THREE.Vector3(), yaw: Math.PI, pitch: 0, step: 0 };   // yaw 0 = toward the bow
  st.talk = null;
  st.codex = st.codex || [];
  st.codexNew = null;
  st.people = peopleFor(2);
  st.unlock = 0;
  p.velocity.copy(st.seawrack.velocity);
  S.mission.objective = '';
  pushEvent(S, 'homecoming', {});
  setMessage(S, 'SEAWRACK: Opening number two. Take her straight down, Xi — I want those covers shut before anything flies over.', 7);
  sync(S);
}

// the figures and notices of one chapter's scenes (aboardScript.js: chapter 2 = the interlude, 3 = the launch walk)
function peopleFor(chapter) {
  return PEOPLE.filter((q) => (q.chapter || 2) === chapter)
    .map((q) => ({ id: q.id, name: q.name, area: q.area, kind: q.kind, look: q.look, pos: q.pos.slice(), yaw: q.yaw, talked: false }));
}

// Chapter 3 opening: on foot in hold two, the gantry to the Xi. state.story.seawrack is set by the mission first.
export function beginLaunchWalk(S) {
  const rt = S.sim, st = S.story;
  rt.aboard = { t: 0, fadeT: A.fadeTime / 2, said: {}, visited: {}, taken: {}, selPrev: 0, ctx: context(S), in0: { yaw: S.input.walkYaw || 0, pitch: S.input.walkPitch || 0 }, briefed: true, launch: true };
  S.phase = 'aboard';
  st.stage = 'hold';
  st.area = 'hold';
  st.cine = 1; st.fade = 1;                                 // fades in from black
  st.walk = { pos: new THREE.Vector3(0, CATWALK.y + A.eye, CATWALK.z0 + 0.8), vel: new THREE.Vector3(), yaw: Math.PI, pitch: 0, step: 0 };
  setYaw(S, Math.PI, -0.12);                                // facing the Xi (toward the stern), a little down
  st.talk = null;
  st.codex = st.codex || [];
  st.codexNew = null;
  st.people = peopleFor(3);
  st.unlock = 0;
  S.mission.objective = 'CROSS THE GANTRY TO THE XI';
  sync(S);
}

// the hatch reached: seated in the Xi, still in the closed hold; the cold start follows (phase 'startup')
function finishLaunchWalk(S) {
  const rt = S.sim, st = S.story, p = S.player, sw = st.seawrack;
  rt.boardDone = true;
  rt.launchWalkDone = true;
  st.stage = 'cockpit';
  st.fade = 0;
  st.talk = null; st.prompt = null;
  S.phase = 'startup';
  S.startup.stage = 0; S.startup.progress = 0;
  rt.startupBusy = false; rt.startupClosing = false;
  resetHatch(S, true);                                      // every cold start begins with the hatch open
  p.quaternion.setFromAxisAngle(_up, -sw.heading);          // the Xi faces the bow
  S.mission.objective = 'PRESS [ENTER] — CLOSE HATCH';
  syncHold(S, 0);
}

// Chapter 3, phase 'startup': the suit (player.position = its cockpit) stays in hold two while Seawrack sails on
export function syncHold(S, dt) {
  const st = S.story, sw = st.seawrack, p = S.player;
  if (!sw) return;
  sw.position.addScaledVector(sw.velocity, dt);
  shipToWorld(sw, _v.fromArray(SUIT_POINT), p.position);
  p.velocity.copy(sw.velocity);
  p.speed = sw.velocity.length();
  p.altitude = p.position.y;
  p.quaternion.setFromAxisAngle(_up, -sw.heading);
}

function sync(S) {
  const st = S.story, sw = st.seawrack, w = st.walk, p = S.player;
  shipToWorld(sw, w.pos, st.pilot.position);
  st.pilot.velocity.copy(sw.velocity);
  st.pilot.yaw = w.yaw + sw.heading;
  st.pilot.pitch = w.pitch;
  st.pilot.step = w.step;
  // the suit (player.position = its cockpit) is down in hold two: keeps world / audio code happy
  shipToWorld(sw, _v.fromArray(SUIT_POINT), p.position);
  p.velocity.copy(sw.velocity);
  p.speed = sw.velocity.length();
  p.altitude = p.position.y;
}

function unlock(S, id) {
  const st = S.story;
  if (!id || st.codex.includes(id)) return;
  st.codex.push(id);
  st.codexNew = { id, t: 4 };
  pushEvent(S, 'codex', { id });
}

// ---- talking --------------------------------------------------------------------------------------------------------
function resolveLines(S, node) {
  const ctx = S.sim.aboard.ctx;
  return (node.lines || []).map((l) => (typeof l === 'function' ? l(ctx) : l)).filter(Boolean);
}
function visibleChoices(S, id, node) {
  const ab = S.sim.aboard;
  return (node.choices || []).filter((c) => !(c.once && ab.taken[id + '|' + c.text]) && !(c.needs && !ab.visited[id + '|' + c.needs]));
}
function openNode(S, id, nodeId) {
  const st = S.story, ab = S.sim.aboard, def = PEOPLE_BY_ID[id], node = def.nodes[nodeId];
  ab.visited[id + '|' + nodeId] = true;
  st.talk = { id, name: def.name, node: nodeId, i: 0, lines: resolveLines(S, node), choices: [], sel: 0 };
  if (!st.talk.lines.length) advance(S);
}
function startTalk(S, id) {
  const st = S.story;
  const person = st.people.find((q) => q.id === id);
  if (person) person.talked = true;
  pushEvent(S, 'uiClick');
  openNode(S, id, PEOPLE_BY_ID[id].start);
}
function endTalk(S, finish) {
  const st = S.story;
  st.talk = null;
  if (finish) { st.stage = 'end'; S.sim.aboard.fadeT = 0; S.mission.objective = ''; }
}
// Enter: next line; after the last line show the choices, follow `next`, or close
function advance(S) {
  const st = S.story, t = st.talk;
  if (!t) return;
  if (t.choices.length) {
    const c = t.choices[t.sel];
    const ab = S.sim.aboard;
    ab.taken[t.id + '|' + c.text] = true;
    unlock(S, c.codex);
    pushEvent(S, 'uiClick');
    if (c.end) { endTalk(S, !!c.finish); return; }
    openNode(S, t.id, c.to);
    return;
  }
  if (t.i < t.lines.length - 1) { t.i++; return; }
  const node = PEOPLE_BY_ID[t.id].nodes[t.node];
  unlock(S, node.codex);
  const ch = visibleChoices(S, t.id, node);
  if (ch.length) { t.choices = ch; t.sel = 0; return; }
  if (node.next) { openNode(S, t.id, node.next); return; }
  endTalk(S, false);
}
function stepTalk(S) {
  const st = S.story, t = st.talk, inp = S.input, ab = S.sim.aboard;
  const dir = inp.moveZ > 0.5 ? 1 : inp.moveZ < -0.5 ? -1 : 0;
  if (t.choices.length && dir !== 0 && dir !== ab.selPrev) {
    t.sel = (t.sel - dir + t.choices.length) % t.choices.length;      // W = up, S = down
    pushEvent(S, 'uiClick');
  }
  ab.selPrev = dir;
  if (inp.interact) advance(S);
}
// the person or notice the pilot is looking at, close enough to talk to (or null)
function lookTarget(S) {
  const st = S.story, w = st.walk;
  const fx = Math.sin(w.yaw), fz = -Math.cos(w.yaw);
  let best = null, bc = A.talkCos;
  for (const q of st.people) {
    if (q.area !== st.area) continue;
    const dx = q.pos[0] - w.pos.x, dz = q.pos[2] - w.pos.z, d = Math.hypot(dx, dz);
    if (d > A.talkRange || d < 1e-3) continue;
    const c = (dx * fx + dz * fz) / d;
    if (c > bc) { bc = c; best = q; }
  }
  return best;
}

// ---- walking --------------------------------------------------------------------------------------------------------
function stepWalk(S, dt) {
  const st = S.story, w = st.walk, inp = S.input, ab = S.sim.aboard;
  w.yaw = ab.yaw0 + (inp.walkYaw || 0) - ab.in0.yaw;
  w.pitch = clamp(ab.pitch0 + (inp.walkPitch || 0) - ab.in0.pitch, -1.4, 1.4);
  const fx = Math.sin(w.yaw), fz = -Math.cos(w.yaw), rx = Math.cos(w.yaw), rz = Math.sin(w.yaw);
  let ax = rx * inp.moveX + fx * inp.moveZ, az = rz * inp.moveX + fz * inp.moveZ;
  const l = Math.hypot(ax, az);
  if (l > 1) { ax /= l; az /= l; }
  const sp = inp.boost > 0.5 ? A.run : A.walk;
  const k = 1 - Math.exp(-10 * dt);
  w.vel.x += (ax * sp - w.vel.x) * k; w.vel.z += (az * sp - w.vel.z) * k;
  const px = w.pos.x, pz = w.pos.z;
  w.pos.x += w.vel.x * dt; w.pos.z += w.vel.z * dt;
  w.step += Math.hypot(w.vel.x, w.vel.z) * dt;
  // walls, the Xi's feet, people, the open hold hatch, the map table
  if (st.area === 'deck') {
    w.pos.x = clamp(w.pos.x, -A.deck.x, A.deck.x);
    w.pos.z = clamp(w.pos.z, A.deck.z0, A.deck.z1);
    const [hx, hz, hs] = A.hold;
    if (Math.abs(w.pos.x - hx) < hs + 0.3 && Math.abs(w.pos.z - hz) < hs + 0.3) { w.pos.x = px; w.pos.z = pz; }
  } else if (st.area === 'corridor') {
    w.pos.x = clamp(w.pos.x, -A.corridor.x, A.corridor.x);
    w.pos.z = clamp(w.pos.z, A.corridor.z0, A.corridor.z1 + 0.5);
  } else if (st.area === 'hold') {
    // the landing by the bulkhead door, then the narrow gantry (railings both sides) out to the Xi's hatch
    w.pos.z = clamp(w.pos.z, CATWALK.z0, CATWALK.z1);
    const onPad = w.pos.z < CATWALK.z0 + CATWALK.padLen;
    const hw = onPad ? CATWALK.pad : CATWALK.half;
    if (!onPad && pz < CATWALK.z0 + CATWALK.padLen && Math.abs(w.pos.x) > CATWALK.half) { w.pos.z = pz; }   // the railing ends
    w.pos.x = clamp(w.pos.x, -hw, hw);
  } else {
    w.pos.x = clamp(w.pos.x, -A.command.x, A.command.x);
    w.pos.z = clamp(w.pos.z, A.command.z0, A.command.z1);
    const [tx, tz, tr] = A.table;
    const d = Math.hypot(w.pos.x - tx, w.pos.z - tz);
    if (d < tr + 0.4) { w.pos.x = tx + (w.pos.x - tx) / d * (tr + 0.4); w.pos.z = tz + (w.pos.z - tz) / d * (tr + 0.4); }
    const [cx0, cz0, cx1, cz1] = A.captainDesk;
    if (w.pos.x > cx0 - 0.3 && w.pos.x < cx1 + 0.3 && w.pos.z > cz0 - 0.3 && w.pos.z < cz1 + 0.3) { w.pos.x = px; w.pos.z = pz; }
  }
  for (const q of st.people) {
    if (q.area !== st.area || q.kind !== 'npc') continue;
    const dx = w.pos.x - q.pos[0], dz = w.pos.z - q.pos[2], d = Math.hypot(dx, dz);
    if (d < 1.1 && d > 1e-4) { w.pos.x = q.pos[0] + dx / d * 1.1; w.pos.z = q.pos[2] + dz / d * 1.1; }
  }
  // eye height follows the floor (steps up onto the hatch lid, down off the coaming)
  const target = floorY(st.area, w.pos.x, w.pos.z) + A.eye;
  w.pos.y += (target - w.pos.y) * (1 - Math.exp(-12 * dt));
}

function enterArea(S, area) {
  const st = S.story, w = st.walk, ab = S.sim.aboard;
  st.area = area;
  if (area === 'corridor') st.stage = 'corridor';
  w.vel.set(0, 0, 0);
  if (area === 'corridor') { w.pos.set(0, D + A.eye, A.corridor.z0 + 0.4); setYaw(S, Math.PI, 0); S.mission.objective = 'TAKE THE LIFT TO COMMAND — END OF THE CORRIDOR'; }
  if (area === 'command') { w.pos.set(0, D + A.command.floor + A.eye, A.command.z1 - 0.4); setYaw(S, 0, -0.05); S.mission.objective = 'JOIN IRAM AT THE MAP TABLE'; }
  void ab;
}
// set the look direction and re-base the mouse so the view does not jump
function setYaw(S, yaw, pitch) {
  const ab = S.sim.aboard, inp = S.input;
  ab.yaw0 = yaw; ab.pitch0 = pitch;
  ab.in0.yaw = inp.walkYaw || 0; ab.in0.pitch = inp.walkPitch || 0;
  S.story.walk.yaw = yaw; S.story.walk.pitch = pitch;
}

export function updateAboard(S, dt) {
  const st = S.story, sw = st.seawrack, ab = S.sim.aboard, inp = S.input, w = st.walk;
  ab.t += dt; st.t = ab.t;
  sw.position.addScaledVector(sw.velocity, dt);            // Seawrack keeps sailing
  if (st.codexNew) { st.codexNew.t -= dt; if (st.codexNew.t <= 0) st.codexNew = null; }
  const say = (key, text, ttl) => { if (!ab.said[key]) { ab.said[key] = true; setMessage(S, text, ttl); } };
  if (st.stage !== 'deck' && st.stage !== 'corridor' && st.stage !== 'command' && st.stage !== 'hold') st.prompt = null;

  switch (st.stage) {
    case 'homecoming':
      // CR-014b (owner): the Xi hides in hold two: the covers open, it goes down inside, the covers close (render).
      st.cine = Math.min(1, st.cine + dt / A.cineTime);
      if (st.cine > 0.72) say('covers', 'SEAWRACK: She\'s in. Covers closing. From the air we\'re a freighter again.', 5);
      if (st.cine >= 1 || (inp.interact && st.cine * A.cineTime > 1)) {
        // straight cut to the pilot on deck, out of the suit, beside the closed hold
        st.stage = 'deck';
        st.area = 'deck';
        w.pos.set(A.start[0], floorY('deck', A.start[0], A.start[2]) + A.eye, A.start[2]);
        w.vel.set(0, 0, 0);
        setYaw(S, Math.PI, -0.04);
        ab.fadeT = A.fadeTime / 2;                         // fade in from black
        st.fade = 1;
        S.mission.objective = 'REPORT TO COMMAND — THE DOOR UNDER THE BRIDGE';
      }
      break;
    case 'hold':
    case 'deck':
    case 'corridor':
    case 'command': {
      if (ab.fadeT > 0) {                                  // fading between areas: no control
        ab.fadeT -= dt;
        st.fade = Math.min(1, ab.fadeT > A.fadeTime / 2 ? (A.fadeTime - ab.fadeT) / (A.fadeTime / 2) : ab.fadeT / (A.fadeTime / 2));
        if (ab.fadeT <= A.fadeTime / 2 && ab.pending) { enterArea(S, ab.pending); ab.pending = null; }
        if (ab.fadeT <= 0) { ab.fadeT = 0; st.fade = 0; }
        break;
      }
      if (st.talk) { stepTalk(S); break; }
      stepWalk(S, dt);
      const target = lookTarget(S);
      st.prompt = target ? { id: target.id, text: (target.kind === 'sign' ? 'READ — ' : 'TALK — ') + target.name } : null;
      if (inp.interact && target) { startTalk(S, target.id); st.prompt = null; break; }
      if (st.area === 'deck') {
        if (ab.t > 6) say('pa', ab.ctx.found ? 'SEAWRACK PA: Damage control to frame forty. The fire is contained. Keep the hold hatches shut.' : 'SEAWRACK PA: Deck crew, secure the Xi. Hold two, headcount in ten minutes.', 7);
        if (Math.abs(w.pos.x) < A.door.x && w.pos.z > A.door.z - 0.3) { ab.fadeT = A.fadeTime; ab.pending = 'corridor'; pushEvent(S, 'uiClick'); }
      } else if (st.area === 'corridor') {
        if (w.pos.z > A.corridor.z1) { st.stage = 'lift'; ab.liftT = A.liftTime; st.fade = 1; S.mission.objective = ''; pushEvent(S, 'uiClick'); }
      } else if (st.area === 'hold') {
        if (ab.t > 2.5) say('h1', 'SEAWRACK: Covers stay shut until you are sealed in. Then we open number two and you go straight up.', 7);
        if (w.pos.z > CATWALK.z1 - 8) say('h2', 'DECK CHIEF: Hatch is open and the seat is warm. In you get.', 5);
        if (w.pos.z >= CATWALK.z1 - 0.05) {
          st.stage = 'board'; ab.fadeT = 0; w.vel.set(0, 0, 0); st.prompt = null;
          S.mission.objective = '';
          pushEvent(S, 'uiClick');
        }
      } else if (!ab.briefed && Math.hypot(w.pos.x - A.table[0], w.pos.z - A.table[1]) < A.briefRange) {
        ab.briefed = true;
        startTalk(S, 'iram');
      }
      break;
    }
    case 'board':
      // Chapter 3: into the cockpit - a fade to black, then the seated cold start
      ab.fadeT += dt;
      st.fade = Math.min(1, ab.fadeT / A.fadeTime);
      if (ab.fadeT >= A.fadeTime) { finishLaunchWalk(S); return; }
      break;
    case 'lift':
      ab.liftT -= dt;
      st.fade = 1;
      if (ab.liftT <= A.liftTime / 2 && st.area !== 'command') enterArea(S, 'command');
      if (ab.liftT <= 0) { st.stage = 'command'; ab.fadeT = A.fadeTime / 2; }
      break;
    case 'end':
      ab.fadeT += dt;
      st.fade = Math.min(1, ab.fadeT / A.endTime);
      if (ab.fadeT >= A.endTime && S.phase === 'aboard') {
        st.unlock = 3;
        S.phase = 'victory';
        endMission(S, true);
        S.mission.result.detections = ab.ctx.detections;
        S.mission.result.shipHull = ab.ctx.shipHull;
        S.mission.result.codex = st.codex.length;
        S.mission.objective = '';
        pushEvent(S, 'chapterEnd', { chapter: 2 });
        setMessage(S, '', 0);
      }
      break;
    default: break;
  }
  sync(S);
}
