// Mission flow: startup stages, waves, radio lines, objective text, victory.
import * as THREE from 'three';
import { WAVES, MISSION, STARTUP, ENEMY, MATCH } from './tuning.js';
import { pushEvent, setMessage, forwardOf, clamp } from './util.js';
import { spawnEnemy } from './enemies.js';
import { endMission } from './damage.js';
import { GAWMAN } from './tuning.js';
import { resetHatch, closeHatch, stepHatch } from './hatch.js';
import { beginGawman, resetGawman, updateGawman } from './missions/gawman.js';
import { isStory, beginBoarding } from './boarding.js';
import { beginChapter2, updateSeawrack } from './missions/seawrack.js';
import { beginLane, beginLaneCheckpoint, updateLane, updateLaneAfter } from './missions/lane.js';

export { updateLaneAfter };
import { beginOenbili, beginLaunch, updateOenbili } from './missions/oenbili.js';

export { updateGawman };

const STARTUP_PROMPTS = [
  'PRESS [ENTER] — CLOSE HATCH',
  'PRESS [ENTER] — RUN DIAGNOSTIC SWEEP',
  'PRESS [ENTER] — BRING PANORAMIC MONITOR ONLINE',
  'PRESS [ENTER] — RELEASE FROM CARGO PISA',
];
const STARTUP_RADIO = [
  null,
  'CARGO PISA: Clamp down, pilot. Container is shaking itself apart.',
  'CARGO PISA: Primary diagnostics... reactor is hot. Stay with it.',
  'CARGO PISA: Monitors coming up. Ocean in forty seconds.',
];

// Chapter 3: the cold start happens in Seawrack's closed hold two
const LAUNCH_RADIO = [
  null,
  'SEAWRACK: Sealed in? Good. The reactor is yours, Xi.',
  'SEAWRACK: Diagnostics look clean from up here. Deck crew, clear hold two.',
  'SEAWRACK: Monitors up. Say the word and we open the covers.',
];
const stagePrompt = (S, i) => (i === 3 && S.story && S.story.chapter === 3 ? 'PRESS [ENTER] — OPEN THE HOLD AND LAUNCH' : STARTUP_PROMPTS[i]);

// CR-008 story: the cold start happens inside the cargo (CR-009: no hurry)
const STORY_RADIO = [
  null,
  'CARGO PISA: Hatch sealed. Now the reactor.',
  'CARGO PISA: Diagnostics are running. It all looks clean from here.',
  'CARGO PISA: Monitors are up. Release the clamps when you are ready.',
];

const _f = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _right = new THREE.Vector3();

// CR-004: pick the single-player mission from state.setup.mission. Night + start altitude follow the mission.
// Called at sim creation, on every restart to single player and (until the first Enter) every startup frame, so the
// lobby may write state.setup.mission after the sim exists.
export function applyMission(S) {
  const rt = S.sim;
  const pick = S.setup && S.setup.mission;
  const id = pick === 'gawman' ? 'gawman' : pick === 'story2' ? 'seawrack' : (pick === 'story3' || pick === 'story3c') ? 'oenpeli' : 'waves';   // CR-013: story2 = Chapter 2 checkpoint; story3/story3c = Chapter 3 Oenbili;
  // 'story1p' (RETRY when the Penelope arrives) is the Chapter 1 battle: 'waves'
  const changed = rt.missionId !== id;
  rt.missionId = id;
  S.mission.id = id;
  S.world.night = id === 'gawman';
  S.world.terrain = id === 'oenpeli' ? 'oenbili' : null;                // Chapter 3 has land (sim/terrain.js)
  if (changed) {
    resetGawman(S);
    S.mission.rescue = null;
    S.player.position.y = id === 'gawman' ? GAWMAN.startAlt : 4800;
  }
}

export function initStartup(S) {
  const rt = S.sim;
  rt.missionId = null;
  applyMission(S);
  resetHatch(S, true); // CR-004: every cold start begins with the hatch open
  rt.startupClosing = false;
  S.mission.objective = STARTUP_PROMPTS[0];
  rt.startupBusy = false;
}

// gawman: the cold start happens at the mission altitude
export function holdStartAltitude(S) {
  if (S.mission.id !== 'gawman') return;
  S.player.position.y = GAWMAN.startAlt;
  S.player.velocity.y = 0;
}

function advanceStage(S, net) {
  const rt = S.sim;
  const su = S.startup;
  const next = su.stage + 1;
  su.stage = next;
  pushEvent(S, 'startupStage', { stage: next });
  const radio = isStory(S) ? STORY_RADIO : S.story && S.story.chapter === 3 ? LAUNCH_RADIO : STARTUP_RADIO;
  if (radio[next] && !net) setMessage(S, radio[next], 5);
  if (next >= 4) {
    su.progress = 1;
    if (net) { rt.startupDone = true; return; }
    beginFlight(S);
    return;
  }
  su.progress = 0;
  rt.startupBusy = true;
  S.mission.objective = ['', 'HARNESS CLAMPING...', 'DIAGNOSTIC SWEEP...', 'MONITOR ONLINE...'][next];
}

export function updateStartup(S, dt) {
  const rt = S.sim;
  const su = S.startup;
  const inp = S.input;
  const net = rt.netOn; // CR-003: in a match the cold start plays by itself, faster, and ends in 'startup' stage 4
  const speed = net ? MATCH.startupSpeed : 1;
  if (su.stage === 0 && !rt.startupClosing && !net) applyMission(S);
  // CR-013: restart at the Chapter 2 checkpoint: no boarding, no cold start, straight into flight
  if (!net && S.setup && S.setup.mission === 'story2') { beginChapter2(S, { checkpoint: S.setup.checkpoint || null, fresh: true }); return; }
  // Chapter 3: on foot in Seawrack's hold first (the cold start comes after the walk), or RETRY straight into flight
  if (!net && S.setup && (S.setup.mission === 'story3' || S.setup.mission === 'story3c') && !rt.launchWalkDone) {
    const ck = S.setup.mission === 'story3c';
    beginOenbili(S, { checkpoint: ck ? (S.setup.checkpoint || null) : null, fresh: ck });
    return;
  }
  // Chapter 1 checkpoint: the Penelope brings Gawman (sim/missions/lane.js)
  if (!net && S.setup && S.setup.mission === 'story1p') { beginLaneCheckpoint(S, S.setup.checkpoint || null); return; }
  // CR-008 story: the chapter opens outside, on the support craft. The cold start begins once the pilot is in the hatch.
  if (!net && isStory(S) && !rt.boardDone) { beginBoarding(S); return; }
  stepHatch(S, dt, { speed });
  if (net && rt.startupDone) return;
  if (rt.startupBusy) {
    su.progress = Math.min(1, su.progress + dt * speed / STARTUP.stageTime[su.stage]);
    if (su.progress >= 1) {
      rt.startupBusy = false;
      S.mission.objective = stagePrompt(S, su.stage);
    }
    return;
  }
  if (su.stage === 0) {
    // CR-004 stage 0: the hatch is open. Enter closes it (HATCH LOCK); once sealed, stage 1 begins.
    const h = S.player.hatch;
    if (!rt.startupClosing) {
      if (!inp.interact && !net) return;
      if (!net) pushEvent(S, 'uiClick');
      rt.startupClosing = true;
      closeHatch(S);
      S.mission.objective = 'HATCH CLOSING...';
      return;
    }
    if (h.state !== 'closed') return;
    rt.startupClosing = false;
    advanceStage(S, net);
    return;
  }
  if (!inp.interact && !net) return;
  if (!net) pushEvent(S, 'uiClick');
  advanceStage(S, net);
}

function beginFlight(S) {
  const rt = S.sim;
  const p = S.player;
  S.phase = 'flight';
  p.velocity.y *= 0.3;
  rt.prevVel.copy(p.velocity);
  rt.gSm.set(0, 1, 0);
  rt.gSlow.set(0, 1, 0);
  S.mission.elapsed = 0;
  if (S.mission.id === 'gawman') {
    rt.waveState = 'gawman'; // no waves, no hostile AI
    beginGawman(S);
    return;
  }
  if (S.story && S.story.chapter === 3) { rt.waveState = 'oenbili'; beginLaunch(S); return; }   // out of the hold
  if (isStory(S)) S.story.stage = 'flight';
  rt.waveState = 'prep';
  rt.waveTimer = MISSION.firstWaveDelay;
  S.mission.objective = 'STAND BY — HOSTILES INBOUND';
  setMessage(S, 'CARGO PISA: Container away. You are on your own, Xi. Good luck.', 6);
}

function spawnWave(S, index) {
  const rt = S.sim;
  const p = S.player;
  // story Chapter 1: the third wave is the Penelope bringing Gawman, then Lane Aim's duel (sim/missions/lane.js)
  if (index === 2 && S.story.chapter === 1 && !rt.netOn) { beginLane(S); return; }
  const w = WAVES[index];
  S.mission.wave = index + 1;
  // heading: horizontal part of nose, falling back to velocity, then -Z
  forwardOf(p.quaternion, _f);
  _f.y = 0;
  if (_f.lengthSq() < 0.09) { _f.set(p.velocity.x, 0, p.velocity.z); }
  if (_f.lengthSq() < 0.09) _f.set(0, 0, -1);
  _f.normalize();
  _right.set(-_f.z, 0, _f.x);
  const total = w.gustav + w.penelope;
  let n = 0;
  const make = (type) => {
    const dist = rt.rng.range(ENEMY.spawnDistMin, ENEMY.spawnDistMax);
    const lateral = total > 1 ? (n / (total - 1) - 0.5) * 2200 + rt.rng.range(-300, 300) : rt.rng.range(-600, 600);
    _pos.copy(p.position).addScaledVector(_f, dist).addScaledVector(_right, lateral);
    _pos.y = clamp(p.position.y + rt.rng.range(-300, 500), 900, 9000);
    spawnEnemy(S, type, _pos, { missiles: w.missiles });
    n++;
  };
  for (let i = 0; i < w.gustav; i++) make('gustav');
  for (let i = 0; i < w.penelope; i++) make('penelope');
  rt.waveState = 'active';
  rt.waveStartTime = rt.time;
  pushEvent(S, 'waveStart', { wave: index + 1 });
  const lines = [
    'CIRCE RADAR: Two Gustav Karls on sub-flight sleds, dead ahead. They have seen you.',
    'CIRCE RADAR: Three more Gustavs. They are carrying missiles. Watch for the flare of launch.',
    'UNKNOWN: Single contact, fast. That is the Penelope. Lane Aim is flying it. Do not let him get behind you.',
  ];
  setMessage(S, lines[index], 7);
}

export function updateMission(S, dt) {
  const rt = S.sim;
  const m = S.mission;
  if (m.id === 'gawman') return; // updateGawman runs from index.js (it also has to run in victory / failed)
  if (m.id === 'seawrack') { updateSeawrack(S, dt); return; }   // CR-013 story Chapter 2
  if (m.id === 'oenpeli') { updateOenbili(S, dt); return; }      // story Chapter 3
  const ships = rt.ships;
  m.elapsed += dt;

  // Minovsky density drifts toward the wave's value
  const target = WAVES[Math.max(0, Math.min(WAVES.length - 1, (rt.waveState === 'prep' ? m.wave : m.wave - 1)))].density;
  const dd = target - S.world.minovskyDensity;
  const step = MISSION.densityDriftRate * dt;
  S.world.minovskyDensity += Math.abs(dd) < step ? dd : Math.sign(dd) * step;

  if (rt.holdWaves) return;

  switch (rt.waveState) {
    case 'prep':
      rt.waveTimer -= dt;
      if (rt.waveTimer <= 0) spawnWave(S, m.wave); // m.wave is 0-based index of next wave here
      break;
    case 'active': {
      let left = 0;
      for (const e of ships) if (e.alive) left++;
      m.objective = S.story.lane && S.story.lane.stage === 'duel' ? 'DEFEAT LANE AIM' : `DESTROY HOSTILES — WAVE ${m.wave}/${m.waveCount} (${left} LEFT)`;
      if (left === 0 && rt.time - rt.waveStartTime > 0.5) {
        if (m.wave >= m.waveCount) {
          rt.waveState = 'victory';
          rt.waveTimer = MISSION.victoryDelay;
          m.objective = 'ALL HOSTILES DESTROYED';
        } else {
          rt.waveState = 'clear';
          rt.waveTimer = MISSION.clearDelay;
        }
      }
      break;
    }
    case 'clear':
      rt.waveTimer -= dt;
      if (rt.waveTimer <= 0) {
        rt.waveState = 'prep';
        rt.waveTimer = MISSION.betweenWaves;
        m.objective = 'STAND BY — NEXT CONTACT';
        const lines = [
          'CIRCE RADAR: Wave clear. More contacts on the board. Particle density is climbing.',
          'CIRCE RADAR: Clear. Wait... one very fast contact. Minovsky scatter is getting thick.',
        ];
        setMessage(S, lines[Math.min(m.wave - 1, lines.length - 1)], 6);
      }
      break;
    case 'lane':
      updateLane(S, dt);
      break;
    case 'victory':
      rt.waveTimer -= dt;
      if (rt.waveTimer <= 0) {
        // CR-013: the story goes straight on into Chapter 2 (checkpoint taken there)
        if (S.story.chapter === 1 && !rt.netOn) { rt.waveState = 'done'; beginChapter2(S); break; }
        S.phase = 'victory';
        rt.waveState = 'done';
        endMission(S, true);
        setMessage(S, 'Both machines are down. The sky is quiet. For now.', 9999);
      }
      break;
    default: break;
  }
}
