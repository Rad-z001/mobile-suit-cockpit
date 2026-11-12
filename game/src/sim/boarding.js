// CR-008 story, Chapter 1 "Midair handover". Phase 'boarding' (single player, state.setup.mission === 'story1'):
//   'airlock'  the pilot starts in the cargo's dark forward airlock, facing the inner hex door; it opens as he walks up
//   'walk'     he walks / runs down the gangway inside the cargo and finds the Xi standing in the bay at the end.
//              Reaching the end of the gangway boards it automatically (no modelled walkway or door to the cockpit)
//   'enter'    quick fade to black
//   'outside'  a few seconds seen from OUTSIDE: the cargo is falling (render moves the camera; Enter skips)
// then the phase becomes 'startup' with the pilot already seated (stage 'cockpit'), still inside the falling cargo.
// After the release (stage 'flight') the empty cargo keeps falling on its own, hits the sea and explodes (stepCargo).
//
// Frame of reference: the Xi's cockpit point in the cargo IS player.position until the release, and the cargo moves with
// BOARD.cargoVel the whole time. rt.board.rel = the pilot's eye, metres from that point, world axes (the Xi faces -Z, so
// the gangway runs from the airlock at -Z toward +Z).
// CR-009: there is NO time limit. The cargo holds its altitude while the pilot or the Xi is aboard, so the player can take
// as long as he likes; it only falls (and is destroyed) after the release.
import * as THREE from 'three';
import { BOARD } from './tuning.js';
import { pushEvent, setMessage, clamp } from './util.js';

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _a = new THREE.Vector3();

export const isStory = (S) => !!(S.setup && S.setup.mission === 'story1');

export function beginBoarding(S) {
  const rt = S.sim, p = S.player, st = S.story;
  const b = rt.board = {
    t: 0, rel: new THREE.Vector3().fromArray(BOARD.start), vel: new THREE.Vector3(), yaw0: Math.PI,   // facing +Z, toward the Xi
    enterT: 0, cineT: 0, said: {}, in0: { yaw: S.input.walkYaw || 0, pitch: S.input.walkPitch || 0 },
  };
  S.phase = 'boarding';
  st.chapter = 1; st.stage = 'airlock'; st.t = 0; st.title = BOARD.titleTime; st.door = 0; st.enter = 0; st.cine = 0;
  st.cargo.gone = false; st.cargo.impactT = 0;
  st.pilot.yaw = b.yaw0; st.pilot.pitch = 0; st.pilot.step = 0;
  p.position.set(0, BOARD.startAlt, 0);
  p.velocity.fromArray(BOARD.cargoVel);
  p.quaternion.identity();
  S.mission.objective = 'WALK TO THE INNER DOOR [W]';
  S.mission.elapsed = 0;
  syncStory(S);
}

// keeps state.story in step with the falling cargo while the pilot / the suit is inside it
export function syncStory(S) {
  const rt = S.sim, p = S.player, st = S.story, b = rt.board;
  st.cargo.position.copy(p.position);
  st.cargo.velocity.fromArray(BOARD.cargoVel);
  st.impactIn = Infinity;                                  // only counts after the release (stepCargo)
  p.altitude = p.position.y;
  if (!b) return;
  st.pilot.position.copy(p.position).add(b.rel);
  st.pilot.velocity.copy(b.vel);
  st.hatch.position.fromArray(BOARD.hatch).add(p.position);
  st.hatch.distance = Math.max(0, BOARD.endZ - b.rel.z);
}

export function updateBoarding(S, dt) {
  const rt = S.sim, p = S.player, st = S.story, inp = S.input, b = rt.board;
  b.t += dt; st.t = b.t;
  st.title = Math.max(0, st.title - dt);
  // the cargo falls (constant velocity)
  p.velocity.fromArray(BOARD.cargoVel);
  p.position.addScaledVector(p.velocity, dt);
  p.speed = p.velocity.length();

  const say = (key, text, ttl) => { if (!b.said[key]) { b.said[key] = true; setMessage(S, text, ttl); } };
  const walking = st.stage === 'airlock' || st.stage === 'walk';

  if (walking) {
    // look + walk on the gangway floor (Shift runs)
    const yaw = b.yaw0 + (inp.walkYaw || 0) - b.in0.yaw;
    st.pilot.yaw = yaw;
    st.pilot.pitch = clamp((inp.walkPitch || 0) - b.in0.pitch, -1.45, 1.45);
    _fwd.set(Math.sin(yaw), 0, -Math.cos(yaw));
    _right.set(Math.cos(yaw), 0, Math.sin(yaw));
    _a.set(0, 0, 0).addScaledVector(_right, inp.moveX).addScaledVector(_fwd, inp.moveZ);
    if (_a.lengthSq() > 1) _a.normalize();
    _a.multiplyScalar(inp.boost > 0.5 ? BOARD.run : BOARD.walk);
    b.vel.lerp(_a, 1 - Math.exp(-10 * dt));
    b.rel.addScaledVector(b.vel, dt);
    st.pilot.step += b.vel.length() * dt;
    // walls: the gangway is narrow; the airlock's rear wall; the inner door until it has opened
    b.rel.x = clamp(b.rel.x, -BOARD.corridorHalf, BOARD.corridorHalf);
    b.rel.y = BOARD.start[1];
    if (b.rel.z < BOARD.backZ) { b.rel.z = BOARD.backZ; b.vel.z = Math.max(0, b.vel.z); }
    if (st.door < 1 && b.rel.z > BOARD.doorZ - 0.7) { b.rel.z = BOARD.doorZ - 0.7; b.vel.z = Math.min(0, b.vel.z); }

    if (b.t > 1.0) say('r1', 'CARGO PISA: Pilot, you are in the forward airlock. The Xi is at the end of the gangway.', 6);
    if (st.stage === 'airlock') {
      // the inner door opens as the pilot walks up to it
      if (st.door > 0 || b.rel.z > BOARD.doorZ - BOARD.doorRange) {
        if (st.door === 0) pushEvent(S, 'uiClick');
        st.door = Math.min(1, st.door + dt / BOARD.doorTime);
        if (st.door >= 1) {
          st.stage = 'walk';
          S.mission.objective = 'WALK TO THE XI — END OF THE GANGWAY';
          setMessage(S, 'CARGO PISA: Inner door is open. The Xi is powered and waiting for you.', 6);
        }
      }
    } else {
      if (b.rel.z > BOARD.bayZ - 14) say('bay', 'CARGO PISA: There it is. Keep going, straight to it.', 4);
      if (b.rel.z >= BOARD.endZ) {
        st.stage = 'enter'; b.enterT = 0; b.vel.set(0, 0, 0);
        pushEvent(S, 'uiClick');
        S.mission.objective = '';
      }
    }
  } else if (st.stage === 'enter') {
    b.enterT += dt;
    st.enter = clamp(b.enterT / BOARD.enterTime, 0, 1);
    if (st.enter >= 1) {
      st.stage = 'outside'; b.cineT = 0; st.cine = 0;
      setMessage(S, 'GALCEZON: I have eyes on the capsule. It is holding together. Take the Xi out when you are ready.', BOARD.cineTime);
    }
  } else if (st.stage === 'outside') {
    // the outside shot: the cargo falling through the dusk (render owns the camera). Enter skips after the first second.
    b.cineT += dt;
    st.cine = clamp(b.cineT / BOARD.cineTime, 0, 1);
    if (st.cine >= 1 || (inp.interact && b.cineT > 1)) { finishBoarding(S); return; }
  }
  syncStory(S);
}

function finishBoarding(S) {
  const rt = S.sim, st = S.story;
  rt.boardDone = true;
  rt.board.rel.set(0, 0, 0);
  rt.board.vel.set(0, 0, 0);
  st.stage = 'cockpit'; st.enter = 1; st.cine = 1;
  S.phase = 'startup';
  S.startup.stage = 0; S.startup.progress = 0;
  S.mission.objective = 'PRESS [ENTER] — CLOSE HATCH';
  S.player.quaternion.identity();
  syncStory(S);
}

// After the release the empty cargo keeps falling by itself, hits the sea and explodes. Called every active frame of a
// story run (sim/index.js); state.story.cargo.gone / impactT tell render to draw the fireball.
export function stepCargo(S, dt) {
  const st = S.story, c = st.cargo;
  if (st.chapter !== 1 || st.stage !== 'flight') return;
  if (c.gone) { c.impactT += dt; return; }
  // empty and unpowered now: it loses its forward speed and drops faster, so it goes in close enough to watch
  c.velocity.lerp(_a.fromArray(BOARD.freeVel), 1 - Math.exp(-0.8 * dt));
  c.position.addScaledVector(c.velocity, dt);
  st.impactIn = Math.max(0, c.position.y / Math.max(1, -c.velocity.y));
  if (c.position.y <= 0) {
    c.position.y = 0;
    c.gone = true; c.impactT = 0;
    pushEvent(S, 'explosion', { position: c.position.clone(), size: 3 });
    pushEvent(S, 'cargoImpact', { position: c.position.clone() });
    setMessage(S, 'GALCEZON: The capsule just hit the water. Nothing left of it.', 6);
  }
}
