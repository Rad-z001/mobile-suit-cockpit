// Story Chapter 1, third wave (owner, after CR-014): "when Penelope gets in there will be dialogue, Penelope will fly
// above and let Gawman fly to get Xi", then "Lane Aim attacks: final duel".
//   arrive:  the Penelope (faction 'neutral': no target, no AI, never hit) closes on a station above and ahead of the Xi.
//   talk:    Lane Aim has Gawman in the suit's hand. Radio exchange (original lines). Lane will not fight with a prisoner.
//   ready:   "slow down, open the hatch" - she lets him go once the Xi is slow, or after LANE.dropWait.
//   falling: the CR-004 rescue (sim/missions/gawman.js stepRescue): open hatch, match his fall, catch him in the hatch.
//   aboard:  the hatch sealed, a beat, then the duel: the Penelope turns hostile and the wave machine takes over (wave 3,
//            one hostile); her death ends Chapter 1 and Chapter 2 follows as before.
//   lost:    Gawman hits the hull or the sea: phase 'failed'. RETRY restarts here (lobby 'story1p', from the checkpoint
//            taken when she arrives: state.story.checkpoint with chapter 1).
// State for render / HUD / lobby: state.story.lane (see state.js).
import * as THREE from 'three';
import { LANE as C } from '../tuning.js';
import { pushEvent, setMessage, forwardOf, orientShip } from '../util.js';
import { spawnEnemy } from '../enemies.js';
import { resetHatch } from '../hatch.js';
import { makeRescueScript, gawmanJump, stepRescue } from './gawman.js';
import { captureCheckpoint, restoreCheckpoint } from './seawrack.js';

const _f = new THREE.Vector3(), _s = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3();

const TALK = [
  'LANE AIM: Mafty\'s Gundam. Hold your fire — look at my left hand.',
  'GAWMAN: Don\'t mind me! Shoot him! I knew what this job was when I took it!',
  'LANE AIM: I don\'t fight with a man in my fist. Slow down and open your hatch. I\'m letting him go.',
];
const RESCUE_LINES = {
  jump: 'LANE AIM: He\'s yours. Catch him, Mafty — then we finish this.',
  caught: 'GAWMAN: I\'m in! I\'m in! Shut the hatch before I fall out again!',
  lostHull: 'LANE AIM: ...You hit him. I handed him to you, and you hit him.',
  lostSea: 'LANE AIM: He went into the sea. That was your man, Mafty.',
};

// horizontal heading of the Xi (nose, then velocity, then -Z)
function heading(p, out) {
  forwardOf(p.quaternion, out); out.y = 0;
  if (out.lengthSq() < 0.09) out.set(p.velocity.x, 0, p.velocity.z);
  if (out.lengthSq() < 0.09) out.set(0, 0, -1);
  return out.normalize();
}

// Start the beat (from the third wave of the story chapter, or from the 'story1p' checkpoint restart)
export function beginLane(S) {
  const rt = S.sim, p = S.player, m = S.mission, st = S.story;
  heading(p, _f);
  _s.copy(p.position).addScaledVector(_f, C.spawnAhead);
  _s.y = Math.max(p.position.y + C.spawnUp, C.minAlt + C.spawnUp);
  const e = spawnEnemy(S, 'penelope', _s, { missiles: true });
  e.faction = 'neutral';                     // CR-004 neutral: never a target, never simulated as AI (sensors.js)
  e.state = 'carrier';
  e.velocity.copy(p.velocity);
  rt.gm = makeRescueScript(e);
  m.rescue = null;                           // the rescue HUD appears with the jump
  m.wave = 3;
  rt.waveState = 'lane';
  st.lane = { stage: 'arrive', t: 0, line: -1, penelopeId: e.id };
  st.checkpoint = captureCheckpoint(S, 1);   // RETRY restarts here (lobby 'story1p')
  pushEvent(S, 'waveStart', { wave: 3 });
  pushEvent(S, 'checkpoint', { chapter: 1 });
  m.objective = 'HOLD YOUR FIRE — UNKNOWN CONTACT';
  setMessage(S, 'CIRCE RADAR: One contact, very fast, coming straight in. It is the Penelope — Lane Aim.', 7);
}

// RETRY from the checkpoint: a fresh sim straight into flight, three waves' worth of damage kept, then the beat starts
export function beginLaneCheckpoint(S, ck) {
  const rt = S.sim, p = S.player;
  restoreCheckpoint(S, ck || {});
  p.position.set(0, 2600, 0);
  p.velocity.set(0, 0, -110);
  p.quaternion.identity();
  resetHatch(S, false);
  S.startup.stage = 4; S.startup.progress = 1;
  S.phase = 'flight';
  rt.prevVel.copy(p.velocity); rt.gSm.set(0, 1, 0); rt.gSlow.set(0, 1, 0);
  rt.boardDone = true;
  S.story.chapter = 1;
  S.story.stage = 'flight';
  S.story.cargo.gone = true; S.story.cargo.impactT = 999;   // the empty cargo went into the sea long ago
  S.mission.elapsed = 0;
  beginLane(S);
}

// her station over the Xi (or, after the drop, further off where she watches)
function station(S, out) {
  const p = S.player, lane = S.story.lane;
  const away = lane.stage === 'falling' || lane.stage === 'aboard' || lane.stage === 'lost';
  heading(p, _f);
  const y = Math.max(p.position.y + (away ? C.awayUp : C.stationUp), C.minAlt);
  // a low Xi: she stays at minAlt but moves further ahead, so she (and his drop) stays within maxElev of the nose
  const ahead = Math.min(C.maxAhead, Math.max(away ? C.awayAhead : C.stationAhead, (y - p.position.y) / Math.tan(C.maxElev)));
  out.copy(p.position).addScaledVector(_f, ahead);
  out.y = y;
  return out;
}

function fly(S, e, dt) {
  const p = S.player;
  station(S, _s);
  _d.copy(_s).sub(e.position);
  _v.copy(_d).multiplyScalar(C.stationGain);
  const rel = _v.length();
  if (rel > C.approachSpeed) _v.multiplyScalar(C.approachSpeed / rel);
  _v.add(p.velocity);
  e.velocity.lerp(_v, 1 - Math.exp(-2.5 * dt));
  e.position.addScaledVector(e.velocity, dt);
  // face along her flight while closing, then the way the Xi is heading (she flies with it)
  if (_d.length() > 300) _d.copy(e.velocity).normalize(); else heading(p, _d);
  if (_d.lengthSq() > 1e-6) orientShip(e, _d, 3 * dt, dt);
  return _s.distanceTo(e.position);
}

function say(S, i) {
  const lane = S.story.lane;
  if (lane.line >= i) return;
  lane.line = i;
  setMessage(S, TALK[i], C.lineTime + 0.5);
}

// every flight frame while state.sim.waveState === 'lane'
export function updateLane(S, dt) {
  const rt = S.sim, gm = rt.gm, m = S.mission, p = S.player, lane = S.story.lane;
  if (!gm || !lane) return;
  const e = gm.penelope;
  gm.t += dt;
  lane.t += dt;
  const d = e && e.alive ? fly(S, e, dt) : Infinity;
  switch (lane.stage) {
    case 'arrive':
      // close enough, or close to the Xi after a while (a pilot who keeps turning swings her station away)
      if (d < C.arriveRange || (lane.t > C.arriveFallback && e && e.position.distanceTo(p.position) < 1500)) { lane.stage = 'talk'; lane.t = 0; say(S, 0); }
      m.objective = 'HOLD YOUR FIRE — UNKNOWN CONTACT';
      break;
    case 'talk':
      m.objective = 'HOLD YOUR FIRE — THE PENELOPE IS CARRYING GAWMAN';
      if (lane.t >= C.lineTime) say(S, 1);
      if (lane.t >= 2 * C.lineTime) { say(S, 2); lane.stage = 'ready'; lane.t = 0; }
      break;
    case 'ready':
      m.objective = 'SLOW DOWN — OPEN THE HATCH [H]';
      if ((p.velocity.length() < C.slowSpeed && lane.t > 3) || lane.t >= C.dropWait) {
        gawmanJump(S, RESCUE_LINES);
        lane.stage = 'falling'; lane.t = 0;
      }
      break;
    case 'falling': {
      const out = stepRescue(S, dt, RESCUE_LINES);
      if (out === 'sealed') {
        lane.stage = 'aboard'; lane.t = 0;
        if (m.rescue) m.rescue.hint = '';
        m.objective = 'GAWMAN ABOARD';
        setMessage(S, 'GAWMAN: Strapped in behind your seat. Go on — I won\'t touch anything.', C.duelDelay + 1);
      } else if (out === 'lost') {
        lane.stage = 'lost';
      }
      break;
    }
    case 'aboard':
      if (lane.t >= C.duelDelay) duel(S);
      break;
    case 'lost':
      stepRescue(S, dt, RESCUE_LINES);                  // he keeps falling (the result screen fades in over the world)
      break;
    default: break;
  }
}

// after the beat has failed (phase 'failed'): she and Gawman keep moving under the result fade (sim/index.js)
export function updateLaneAfter(S, dt) {
  const lane = S.story.lane;
  if (!lane || lane.stage !== 'lost' || !S.sim.gm) return;
  updateLane(S, dt);
}

// Gawman is safe: the Penelope turns on the Xi; from here it is the ordinary third wave (mission.js)
function duel(S) {
  const rt = S.sim, m = S.mission, gm = rt.gm, lane = S.story.lane;
  const e = gm.penelope;
  lane.stage = 'duel'; lane.t = 0;
  m.rescue = null;                          // the rescue HUD and the hover assist end here
  rt.assist.w = 0;
  rt.gm = null;
  e.faction = 'enemy';
  e.sim.state = 'approach'; e.sim.t = 0;
  e.sim.fireT = 2.5; e.sim.missileT = 9; e.sim.salvoCd = 6;
  e.state = 'approach';
  rt.waveState = 'active';
  rt.waveStartTime = rt.time;
  m.objective = 'DEFEAT LANE AIM';
  pushEvent(S, 'laneDuel');
  setMessage(S, 'LANE AIM: There. Nothing between us now. Come on, Mafty!', 7);
}
