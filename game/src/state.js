// =============================================================================
// SHARED STATE CONTRACT  (owner: manager — do not change shapes without asking)
// =============================================================================
// Conventions
//   - Three.js coordinates: +Y up, -Z is "forward" for any object, units = metres.
//   - Speeds in m/s, angles in radians unless the field name ends in "Deg".
//   - Sea level is y = 0. Speed of sound = 340 m/s (MACH constant below).
//   - Frame order: input.update → sim.update → render.update → audio.update → events cleared.
//   - Only the listed owner writes a field. Render and audio NEVER write to state.
// =============================================================================
import * as THREE from 'three';

export const MACH = 340;

// Free-crosshair aiming (v2). The crosshair lives in body space as a yaw/pitch offset.
export const AIM_MAX_YAW = 0.62;    // rad, crosshair travel limit left/right
export const AIM_MAX_PITCH = 0.40;  // rad, crosshair travel limit up/down
export const AIM_DEADZONE = 0.20;   // rad (elliptical, scaled by the max values): inside it only the
                                    // rifle arm and head move; outside it the body turns toward the
                                    // crosshair, faster the further out it is.
                                    // CR-002: the zone is behaviour only, it is NOT drawn on the HUD.
export const AUTO_CENTRE_TAU = 1.5; // s (CR-002 item 8): while the crosshair rests inside the central zone
                                    // the body turns to bring it back to screen centre with this time constant.
export const MODEL_SCALE = 2;       // CR-002 item 14: enemy ships and missiles are drawn this many times real
                                    // size. Render scales meshes by it; sim scales hit radii and part boxes by it.
export const EPACK_SHOTS = 15;      // CR-002 item 4: beam rifle shots per E-Pack (packs are infinite)

// -----------------------------------------------------------------------------
// CR-002 (2026-11-11) contract changes. See docs/CR-002-owner-requests.md,
// docs/PLAN-parts-break.md, docs/PLAN-flight-form.md.
//   - No rifle lock-on: the rifle fires exactly along player.aim.dir. No charge shot.
//   - player.lock is now ONLY the funnel-missile auto-lock (enemy nearest the crosshair, ~8 deg cone).
//   - player.target is the enemy nearest the crosshair, for the HUD target block and the lead pip.
//   - Hover is full 6-axis: input.roll is real (Q/E); moveX/Y/Z are body axes; no pitch limit.
//   - Camera stays stable: render adds no recoil, sway, head lean or G sway; only a short hit jolt.
//   - The cross-module coupling input.js -> state.sim.rate uses rate.yaw, rate.pitch AND rate.roll
//     (rad/s, body axes). Sim must keep these names.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// CR-003 (2026-11-11) MULTIPLAYER. See docs/PLAN-multiplayer.md (decisions + wire format).
//   - Module split: net/ (transport, lobby, peers; knows nothing about game content) and
//     sim/netsync.js + sim/match.js (encode/decode game state, remote suits, hits, score, respawn).
//   - Frame order becomes: input → net.receive → sim → net.send → render → audio → events cleared.
//   - Boundary: net writes state.net (incl. net.inbox); sim writes state.netOut and state.match.
//     Sim never calls the transport; net never reads player/entities.
//   - Authority: every client owns its own suit. The HOST (lowest peer id, migrates when it leaves)
//     owns AI enemies, waves and the match (score, timer, winner). Human shooters decide their own
//     hits (on players and AI); AI shots are hit-checked by the victim client.
//   - Multiplayer pilots fly the Gustav Karl (player.suit = 'gustav': shield, no flight form, F fires the
//     missile pods) or the Penelope ('penelope': flight form, funnel missiles, no shield). Xi is shown
//     LOCKED in the suit picker until its model exists.
//     Single player is unchanged (Xi, 3 waves).
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// CR-004 (2026-11-11) GAWMAN RETRIEVAL mission, cockpit hatch, night, HUD restyle.
// See docs/PLAN-gawman-retrieval.md and the frames in assets/images/video_ref/.
//   - state.setup.mission (written by the lobby UI before boarding) picks the single-player mission:
//     'waves' (the original 3 waves, dusk) | 'gawman' (night retrieval). Sim copies it to mission.id.
//   - The cockpit hatch is real: player.hatch (sim). H toggles it in flight. Cold start now BEGINS with the
//     hatch open (pilot looking down the white hatch tunnel) and the first Enter closes + locks it.
//   - world.night (sim) switches the world to a moonlit night (render).
//   - New entity type 'gawman' (a person falling with a flashlight) and faction 'neutral' (scripted Penelope
//     carrier and Gawman: never targeted, locked, damaged or shown as hostile).
// -----------------------------------------------------------------------------
// CR-005 (2026-11-11) Xi Gundam model (owner's Meshy GLB, optimised to assets/models/xi_game.glb,
// 25.6k triangles, 1.1 MB). Used for: remote Xi pilots online (Xi is now selectable), a third-person
// chase view of your own suit (V), and a rotating preview in the suit picker.
//   - One mesh, no separate parts: part-break on a remote Xi is shown with sparks/smoke/scorch at
//     approximate local points, not by removing pieces. Remote Xi `parts` use the PLAYER part names
//     { head, rArm, lArm, legs, pack, pods } (status only).
//   - Model space: height normalised to XI_MODEL_HEIGHT m before MODEL_SCALE, origin at the bbox
//     centre, facing -Z (render normalises; sim hit boxes use the same units).
// -----------------------------------------------------------------------------
export const XI_MODEL_HEIGHT = 28;     // m (canon RX-105 height)
// CR-006 (2026-11-11): the Xi cockpit is in the CHEST. The pilot position (player.position, a remote Xi's entity position)
// is the point XI_COCKPIT of the model, so render draws the mesh shifted by -XI_COCKPIT and the sim shifts the Xi hit boxes
// the same way. The head vulcans fire from XI_HEAD_VULCAN (sim/weapons.js); the beam rifle is a real model held in the right
// hand (render/xiSuit.js), the arm follows the crosshair. Both points are in model units (x MODEL_SCALE = metres in the world).
export const XI_COCKPIT = { x: 0, y: 6.5, z: -3.0 };      // chest centre of the mesh (origin = bbox centre, -Z = front)
export const XI_HEAD_VULCAN = { x: 0, y: 10.0, z: -5.0 }; // between the two vulcan ports on the front of the head
// CR-005b: the Xi model's chest hatch opens with the cockpit hatch. Own suit: render reads
// player.hatch.open. Remote pilots: entity field `hatchOpen` (0..1, sim copies it from the snapshot).

// -----------------------------------------------------------------------------
export const HATCH_UNLOCK_TIME = 0.8;  // s, HATCH UNLOCK frames slide in, locks release
export const HATCH_OPEN_TIME = 1.8;    // s, doors part and the tunnel extends
export const HATCH_CLOSE_TIME = 1.6;   // s, doors close + lock

export const NET_SNAP_HZ = 20;      // own-suit snapshots per second
export const NET_INTERP_DELAY = 0.12; // s, remote suits are drawn this far in the past (interpolation)
export const MAX_PLAYERS = 4;
export const SUITS = ['gustav', 'xi', 'penelope']; // picker order
export const SUITS_UNLOCKED = ['gustav', 'penelope', 'xi']; // CR-005: Xi unlocked with the owner's model // CR-003: Gustav Karl; Penelope since the owner's model
                                                      // (assets/models/penelope_src). Xi stays locked.

// -----------------------------------------------------------------------------
// CR-008 (2026-11-11) STORY MODE. Chapter 1 "Midair handover" = a playable boarding scene + the 'waves' battle.
//   - state.setup.mission = 'story1' starts it. Sim then runs the new phase 'boarding' BEFORE 'startup':
//     the pilot (first person, on foot) starts in the cargo's forward airlock, walks the gangway inside the
//     cargo and finds the Xi at its end; entering the chest hatch plays a short OUTSIDE shot of the falling
//     cargo, then cuts to the cockpit with the pilot seated ('startup'). mission.id stays 'waves'.
//   - CR-009: NO time limit and no clock. The cargo holds its altitude while the pilot / the Xi is aboard, so
//     boarding and the cold start cannot fail; it only falls after the release.
//   - After the release the empty cargo keeps falling, hits the sea and explodes: event 'cargoImpact' {position}
//     (plus an 'explosion'), story.cargo.gone / impactT.
//   - state.story (sim writes, render reads) carries the scene: see createState().
//   - input.walkYaw / walkPitch (input.js): the pilot's free mouse look, only updated in phase 'boarding'.
//     Walking reuses moveX / moveZ, boost = run, interact = skip the outside shot.
//   - Render: render/boarding.js draws the scene and a visor HUD; cockpit, sphere HUD and chase view are off.
// -----------------------------------------------------------------------------
// Game phases (state.phase), written by sim:
//   'boarding' CR-008 story only: the pilot is outside, crossing to the cargo (see above)
//   'aboard'   CR-014 story only: the interlude aboard Seawrack that ends Chapter 2 (on foot; see state.story)
//   'startup'  cockpit dark, player advances the cold-start stages with input.interact
//   'flight'   normal play
//   'disabled' suit is dead (hull <= 0): no control, falling, player must hold input.ejectHold
//   'ejected'  hatch blown, end screen (defeat)
//   'victory'  all waves destroyed, end screen
//   CR-003 multiplayer only:
//   'respawn'  own suit destroyed; monitors dead, countdown in state.match.respawnIn, then 'flight'
//   'matchOver' match finished; scoreboard end screen (state.match.winner)
//   CR-004: 'failed'  single-player mission failed (mission.result.reason); end screen with RETRY
//   In a multiplayer match the cold start auto-advances during the countdown (no Enter needed),
//   and 'disabled'/'ejected' are not used (death goes straight to 'respawn').
//
// Startup stages (state.startup.stage), see research doc 06 scene 2:
//   0 pitch black, tritium switches only   1 harness clamping
//   2 cyan diagnostic sweep                3 panoramic monitor fades in
//   4 complete (phase becomes 'flight')
//
// Event types pushed to state.events by sim (one-frame lifetime). Each is {type, ...}:
//   'startupStage' {stage}        'rifleFire'            'vulcanFire'
//   'enemyFire' {id, power}   (v2: an enemy fired a beam; power as on the beam entity)
//   'funnelLaunch' {count}        'flareDeploy'
//   'lockAcquiring' 'lockConfirmed' 'lockLost'   (CR-002: funnel auto-lock only)
//   'sensorMode' {mode}           'zoom' {zoom}          'flightMode' {mode}    'sonicBoom'
//   'playerHit' {damage, dir, part}  dir = THREE.Vector3, unit, in PLAYER-LOCAL space, pointing
//                                 from the pilot toward where the hit came from; part = player part
//                                 name, 'core' or 'shield'
//   'sectorLost' {index}          'explosion' {position, size}   size 1 small … 3 huge
//   'enemyHit' {id, part}         'kill' {id, name}      'waveStart' {wave}
//   'gDamper'  (instant g jump)   'alert' {level}        'ejectLever'
//   'hatchBlow'                   'uiClick'
// CR-002 additions:
//   'rifleEmpty' (trigger with 0 shots)   'reloadStart'   'reloadEnd'
//   'weaponSwap' {active}         'saberSlash'           'saberHit' {id}
//   'shieldUp'  'shieldDown'      'shieldBlock' {dir, damage}
//   'partDamaged' {part, hp, dir} 'partDestroyed' {part}
//   'enemyPartDamaged' {id, part, hp}
//   'enemyPartDestroyed' {id, part, point}  point = Vector3 in the ship's LOCAL model units
//                                 (before MODEL_SCALE), for debris
//   'missileShotDown' {id, position}
//   'flightTransformStart' {to}   to = 'minovsky' | 'hover'
//   'flightTransformEnd' {mode}   'flightRefused' {reason}
//   'pullUp' {tti}                fired when the sea warning becomes active (see player.pullUp)
// CR-003 multiplayer additions (sim):
//   'remoteFire' {id, weapon}     a remote human suit fired ('rifle'|'vulcan'|'pods'|'saber'); id = its entity
//   'hitConfirm' {id, part, kill} own shot hit a remote suit / AI (shooter-side hit marker)
//   'killFeed' {killer, victim, weapon}   names (strings); also kept in state.match.feed
//   'matchCountdown' {seconds}    'matchStart'   'matchEnd' {winner}
//   'respawn'                     own suit respawned
// CR-004 additions (sim):
//   'hatchUnlock'  (locks release, HATCH UNLOCK frames)   'hatchOpen' (doors start parting)
//   'hatchOpened'  (fully open)   'hatchClose' (doors start closing)   'hatchLocked' (sealed)
//   'hatchWind' {speed}  (open hatch above the safe speed: buffeting)
//   'gawmanJump'   'gawmanCaught'   'gawmanLost' {reason}   'rescueHint' {text}
//   'peerJoined' {name}           'peerLeft' {name}      'hostChanged' {isHost}
// Input-originated UI feedback ('uiClick') may also be pushed by sim when a switch is used.

export function createState() {
  return {
    time: 0,          // seconds since start (main)
    dt: 0,            // last frame delta, clamped to 0.05 (main)
    paused: false,    // main
    phase: 'startup', // sim
    startup: { stage: 0, progress: 0 }, // sim; progress 0..1 within the current stage

    // ---- written by input.js only ------------------------------------------
    input: {
      // --- v2 controls: mobile-suit movement + free crosshair -------------------
      moveX: 0,          // -1..1 strafe, +1 = right (D)            } thrust requests in
      moveY: 0,          // -1..1 vertical, +1 = up (Space), -1 = down (Ctrl)   } PLAYER-LOCAL
      moveZ: 0,          // -1..1 forward/back, +1 = forward (W)    } axes, smoothed by input
      aimYaw: 0,         // crosshair offset from body forward, radians, + = right, clamped ±AIM_MAX_YAW
      aimPitch: 0,       // crosshair offset, radians, + = up, clamped ±AIM_MAX_PITCH
                         // The mouse moves this offset; it does NOT spring back. Sim turns the body
                         // when the offset is outside AIM_DEADZONE (see constants above).
      boost: 0,          // 0..1 boost (Shift): faster thrust, raises thruster heat
      roll: 0,           // CR-002: -1..1 roll request, +1 = roll right (E), -1 = roll left (Q)
      triggerFull: false,// held: left mouse. Fires the rifle, or slashes when the saber is active
      secondary: false,  // held: right mouse (CR-002, was V). Head vulcans
      shield: false,     // held: B (gamepad LB). Raise the shield
      // legacy fields, kept so old readers do not break. input.js keeps them at these values:
      triggerHalf: false,// always false (CR-002: no rifle lock, no charge)
      pitch: 0, yaw: 0,  // always 0 (body turning comes from aimYaw/aimPitch)
      throttle: 0,       // mirrors moveZ
      brake: 0,          // always 0 (the suit stops by itself when no thrust is requested)
      freeAim: false,    // always false (aim is always free)
      ejectHold: false,  // held: pulling the manual hatch lever
      // one-frame edges (true only on the frame the button went down):
      funnel: false, targetCycle: false, flightModeToggle: false, sensorCycle: false,
      zoomCycle: false, flare: false, interact: false, pauseToggle: false,
      // CR-002 edges. interact = Enter now (E is roll).
      reload: false,     // R: swap E-Pack
      weaponSelect: null,// null | 'rifle' | 'saber' | 'toggle'  (1 / 2 / mouse wheel), one frame
      viewToggle: false, // CR-005: one-frame edge, V. Render toggles cockpit <-> third-person chase view
                         // (render-only camera state; sim and aim are unchanged)
      hatch: false,      // CR-004: one-frame edge, H. Toggle the cockpit hatch (flight / startup only)
      scoreboard: false, // CR-003: held, Tab (gamepad Back is eject, so: gamepad View/Back short press n/a)
                         // In a multiplayer match P (pause) does nothing; input still reports it.
      // pilot head free-look (CR-002: hold Alt; middle mouse unused), radians, relative to seat forward:
      walkYaw: 0,        // CR-008: pilot on foot (phase 'boarding'): free look, radians, + = right, NOT clamped
      walkPitch: 0,      // CR-008: + = up, clamped ±1.45
      lookYaw: 0,        // + = look right, clamped ±2.6
      lookPitch: 0,      // + = look up, clamped ±1.3
      device: 'keyboard',// 'keyboard' | 'gamepad' (last used)
      rumble: null,      // optional function(lowFreq0to1, highFreq0to1, ms) set by input.js
    },

    // ---- CR-004: written by the lobby UI only, before the player boards -------------------------
    setup: { mission: 'waves',     // 'waves' | 'gawman' | 'story1' (CR-008) | 'story2' (CR-013: Chapter 2 checkpoint)
      checkpoint: null },          // CR-013: the stored Chapter 2 checkpoint for 'story2' (state.story.checkpoint of an
                                   // earlier run), or null = a healthy Xi. Single player only; multiplayer ignores both.

    // ---- CR-008 story: written by sim only (sim/boarding.js) -----------------------------------
    story: {
      chapter: 0,           // 0 = not a story run, 1 = Chapter 1, 2 = Chapter 2 (CR-013)
      stage: 'none',        // 'none' | 'airlock' (start, inner door closed) | 'walk' (gangway to the Xi) | 'enter' (into
                            // the hatch) | 'outside' (outside shot of the falling cargo) | 'cockpit' (cold start inside
                            // the falling cargo) | 'flight' (released)
      t: 0,                 // s since the chapter began
      title: 0,             // s the chapter title card still shows
      door: 0,              // 0..1 the airlock's inner door, 1 = open
      enter: 0,             // 0..1 progress of 'enter' (render fades)
      cine: 0,              // 0..1 progress of 'outside'
      impactIn: Infinity,   // s until the EMPTY cargo reaches the sea (only after the release; Infinity before)
      cargo: { position: new THREE.Vector3(), velocity: new THREE.Vector3(),   // = the Xi cockpit point in the cargo
        gone: false, impactT: 0 },                                             // hit the sea; s since the impact
      pilot: { position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, step: 0 }, // eye, world;
                            // velocity is relative to the cargo; yaw 0 = -Z, + right; pitch + up (radians); step = metres
                            // walked (head bob)
      hatch: { position: new THREE.Vector3(), distance: 0 },                   // lit chest hatch; metres of gangway left
      // ---- CR-013 Chapter 2 "Return to Seawrack" (sim/missions/seawrack.js writes; null / [] before the chapter) ----
      // chapter becomes 2 and stage 'transit' | 'defend' (strike group attacking the ship) | 'landed' | 'lost'.
      seawrack: null,       // { position, velocity (Vector3, sea level y 0; sinks once lost), heading (rad, 0 = sailing
                            //   toward -Z), hits, hp 0..1, alive, found (the enemy knows where it is), sinkT }
      pickets: [],          // [{ id, position (on the sea), radius, floor (m), painted (its radar sees the player now), sweep (rad) }]
      radar: null,          // { meter 0..1, state 'clear' | 'hidden' (inside cover, under the floor) | 'painted',
                            //   cooldown s after a detection, alerts (times detected), nearest (picket id) }
      landing: null,        // { progress 0..1, ready, over (above the landing box), blocked null | 'chased' | 'strike' }
      strike: null,         // { launched, ids (strike-group entity ids, sim.goal 'seawrack'), cleared }
      checkpoint: null,     // what a Chapter 2 restart keeps: { v, chapter: 2, hull, parts {name: hp}, funnel, vulcan,
                            //   flares, minovsky, kills }. The lobby stores it in the browser. Chapter 1 takes one with
                            //   chapter: 1 when the Penelope arrives (restart: setup.mission 'story1p').
      // ---- Chapter 3 "Oenbili" (sim/missions/oenbili.js writes; null before). chapter 3, stage 'hold' | 'board' (on foot,
      // aboard.js) | 'cockpit' (cold start in the hold) | 'launch' | 'transit' | 'intercept' | 'search' | 'approach' |
      // 'landed' (parked on the pad, the leader's talk in story.talk) | 'defend' | 'won'. ----
      launch: null,         // { t, retract 0..1 (the gantry pulls back first), open 0..1 (hold covers), rise (m up out of
                            //   the hold), out (clear of the ship), closeT }
      gantry: 0,            // hold two's gantry, 0..1 (see the interlude below)
      ob: null,             // { t, pad {x,y,z,r}, interceptIds, waveIds, allyIds (neutral gustav entities flown by the
                            //   mission, their beams are faction 'player'), signal 0..1, revealed, landing {progress, ready,
                            //   over, blocked}, waypoint {x, z, label, vague} | null, said, wonT }
      // Events: 'launch', 'rebelsFound', 'alliesJoin', 'allyFire' {id}, 'chapterEnd' {chapter: 3}.
      // ---- Chapter 1, third wave: the Penelope brings Gawman (sim/missions/lane.js writes; null before) ----
      lane: null,           // { stage 'arrive' | 'talk' | 'ready' (asks the Xi to slow down) | 'falling' (Gawman jumped:
                            //   mission.rescue as in CR-004) | 'aboard' (hatch sealed) | 'duel' (she is hostile, wave 3) |
                            //   'lost', t (s in the stage), line (radio line shown), penelopeId }. Event 'laneDuel'.
      // ---- CR-014 interlude "Aboard Seawrack" (phase 'aboard', sim/missions/aboard.js writes; render/aboard.js reads) ----
      // stage 'homecoming' (cine 0..1: hold two opens, the Xi hides inside, it closes) | 'gantry' (seated in the Xi in the
      //   closed hold, cockpit view: the gantry extends to the chest, then H opens the hatch; player.hatch is stepped) |
      //   'hold' (on foot on the gantry, to the forward bulkhead door) | 'deck' | 'corridor' | 'lift' | 'command' | 'end'.
      //   gantry 0..1: hold two's gantry, 0 = retracted against the forward bulkhead, 1 = out to the Xi's chest hatch
      //   (also Chapter 3: 1 on the walk and the cold start, retracting at the start of the launch).
      //   area 'deck' | 'corridor' | 'command' | 'hold'. fade 0..1 (black). walk { pos (ship model frame, eye),
      //   vel, yaw (0 = toward the bow), pitch, step }; pilot (world) mirrors it. people [{ id, name, area, kind 'npc' |
      //   'sign', look, pos, yaw, talked }]. prompt null | { id, text }. talk null | { id, name, node, i, lines [{ who,
      //   text }], choices [{ text, ... }], sel }. codex [entry ids] (aboardScript.js CODEX), codexNew null | { id, t }.
      //   unlock = 3 once the briefing ends (Chapter 3). Events: 'homecoming', 'codex' {id}, 'chapterEnd' {chapter}.
      // Events: 'chapterStart' {chapter}, 'checkpoint', 'radarPaint', 'radarDetected' {picket}, 'seawrackFound' {why},
      //   'seawrackHit' {hp}, 'strikeCleared', 'seawrackLost' {position}, 'landed'. mission.id = 'seawrack' in Chapter 2;
      //   mission.result adds detections, shipHull, and reason 'seawrack' when the ship sinks.
    },

    // ---- CR-003: written by net/ only ---------------------------------------------
    net: {
      mode: 'offline',      // 'offline' (single player) | 'lobby' | 'match'
      transport: null,      // null | 'p2p' (WebRTC via free public relays; the only transport)
      status: 'idle',       // 'idle' | 'connecting' | 'connected' | 'error'
      error: '',            // human-readable, for the lobby
      roomCode: '',         // 6 chars, shared with friends
      selfId: '',           // this client's peer id
      hostId: '',           // current host's peer id (lowest id among connected, self included)
      isHost: false,
      profile: { name: 'PILOT', suit: 'gustav', team: 0, ready: false }, // own lobby profile
      peers: [],            // remote members: [{ id, name, suit, team, ready, ping }]  (self excluded)
      settings: {           // the host's match settings (copied to every client)
        mode: 'ffa',        // 'ffa' | 'team' | 'coop'
        ai: false,          // ffa/team: AI Gustav Karls also attack everyone (coop: always AI waves)
        scoreLimit: 10,     // kills (ffa: per pilot, team: per team); coop ignores
        timeLimit: 480,     // s
        respawn: 5,         // s
      },
      start: null,          // set once when the host starts the match:
                            // { seed, at (net clock s), roster: [{ id, name, suit, team, slot }] }
      clock: 0,             // s, shared match clock (host-synchronised); sim reads it
      inbox: [],            // messages received since the last frame, oldest first:
                            //   { from: peerId, kind: 'snap'|'ev', data }  — refilled by net.receive()
                            //   every frame (sim reads, never clears).
    },
    // ---- CR-003: written by sim only (net reads and sends, then empties `events`) -----------------
    netOut: {
      snap: null,           // latest own snapshot object (sent unreliably at NET_SNAP_HZ), or null
      events: [],           // reliable, ordered game messages to broadcast this frame
    },
    // ---- CR-003: written by sim only ---------------------------------------------------------
    match: {
      type: 'single',       // 'single' | 'ffa' | 'team' | 'coop'
      state: 'none',        // 'none' | 'countdown' | 'live' | 'over'
      countdown: 0,         // s left in 'countdown'
      timeLeft: 0,          // s
      respawnIn: 0,         // s until own respawn (phase 'respawn'), else 0
      spawnShield: 0,       // s of spawn protection left (no damage taken)
      selfTeam: null,       // 0 | 1 | null
      scores: [],           // [{ id, name, team, kills, deaths, isSelf, isHost, ping }] sorted for the board
      teamScores: [0, 0],
      feed: [],             // kill feed, newest last: [{ killer, victim, weapon, ttl }]
      winner: null,         // null | { name } (ffa) | { team } | { coop: true|false }
    },

    // ---- written by sim only -----------------------------------------------
    player: {
      // CR-004: cockpit hatch. state: 'closed' | 'unlocking' | 'opening' | 'open' | 'closing'
      //   t = 0..1 progress of the current transition; open = 0..1 how far the doors are apart (render/audio
      //   read this, eased by sim); locked = true only when fully closed and sealed.
      hatch: { state: 'closed', t: 0, open: 0, locked: true },
      suit: 'xi',          // CR-003: 'xi' (single player) | 'gustav' (multiplayer); drives loadout + line art
      position: new THREE.Vector3(0, 4800, 0),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(0, 0, -250),
      speed: 250,          // |velocity|
      mach: 250 / MACH,
      altitude: 4800,      // = position.y
      headingDeg: 0,       // 0 = -Z (north), 90 = +X (east), 0..360
      pitchDeg: 0,         // nose above horizon +
      rollDeg: 0,          // right wing down +
      verticalSpeed: 0,    // m/s
      throttle: 0,         // actual forward engine output -1..1 (follows input.moveZ)
      aim: {               // v2: where the rifle arm / head point (sim)
        yaw: 0, pitch: 0,  // crosshair offset actually in effect, radians, body space (+right, +up)
        dir: new THREE.Vector3(0, 0, -1), // unit WORLD direction of the crosshair
        turning: 0,        // 0..1 how hard the body is currently turning toward the crosshair
        centring: false,   // CR-002 item 8: true while auto-centre turns the body (crosshair in zone)
        limited: false,    // flight form: true when the crosshair is clamped to the forward cone
      },
      // CR-002: the enemy nearest the crosshair (HUD target block + lead pip). Not a lock.
      target: {
        id: null,          // entity id or null
        distance: 0,       // m
        closing: 0,        // m/s, + = closing
        leadPoint: null,   // THREE.Vector3 world point to aim at so a rifle shot meets the target, or null
                           // (null when mods.targetReadable is false: head destroyed)
      },
      gLoad: 1,            // signed felt g along pilot's spine (+ pushes pilot into seat)
      gVector: new THREE.Vector3(0, 1, 0), // felt acceleration in g, PLAYER-LOCAL space
      blackout: 0,         // 0..1 G-LOC vision loss
      stress: 0,           // 0..1 pilot panic (damage, sustained g, missile inbound)
      flightMode: 'hover', // 'hover' | 'minovsky' (supersonic flight form)
      // CR-002 item 12: transformation state machine (sim/transform.js)
      flightTransition: { state: 'idle', t: 0, cooldown: 0 }, // 'idle'|'toFlight'|'toHover', t 0..1
      weaponsLocked: false, // true while transforming: no weapon fires
      barrier: { active: false, integrity: 1 }, // beam barrier, 0..1
      hull: 1,             // 0..1
      thrusterHeat: 0,     // 0..1, overheats with boost
      sensors: {
        mode: 'optical',   // 'optical' | 'night' | 'thermal'
        zoom: 1,           // 1 | 3 | 8
        // health 0..1 of the 8 monitor sectors: 0 front,1 front-right,2 right,3 rear-right,
        // 4 rear,5 rear-left,6 left,7 front-left (by yaw around the pilot)
        sectors: [1, 1, 1, 1, 1, 1, 1, 1],
      },
      weapons: {
        // CR-002: the rifle uses E-Packs, not generator energy. No charge shot.
        rifle: { shots: EPACK_SHOTS, perPack: EPACK_SHOTS, reloading: false, reload: 0, cooldown: 0 },
                           // reload = 0..1 progress while reloading (2 s, tuning)
        active: 'rifle',   // 'rifle' | 'saber'  (CR-002 item 13)
        saber: { slash: 0, cooldown: 0 }, // slash = 0..1 progress of the current swing, 0 = idle
        funnel: { count: 24, max: 24 },
        vulcan: { ammo: 800, max: 800 },
        flares: { count: 12, max: 12 },
      },
      // CR-002 item 6: FUNNEL MISSILE auto-lock only. The single enemy nearest the crosshair inside
      // the lock cone locks after a short delay. The rifle never locks.
      lock: {
        targetId: null,     // entity id being locked / locked, or null
        state: 'none',      // 'none' | 'acquiring' | 'locked'
        progress: 0,        // 0..1 while acquiring
        leadPoint: null,    // legacy, always null (lead pip is player.target.leadPoint)
        multiLocks: [],     // legacy, always [] (single-target lock)
        distance: 0,        // m to the locked target
        closing: 0,         // m/s
      },
      threat: {
        missileInbound: false, nearestMissileDist: Infinity,
        // CR-002 item 10: every enemy missile homing on the player, nearest first
        incoming: [],       // [{ id, distance, tti }]  tti = seconds to impact (Infinity if opening)
      },
      // CR-002 item 16: sea-impact warning. active when time-to-impact < 3 s (altitude / sink rate,
      // along the velocity vector). Steady hover never warns.
      pullUp: { active: false, tti: Infinity },
      // CR-002 item 11: parts, each { hp: 0..1, status: 'ok'|'damaged'|'destroyed' }. Never repaired.
      // Core = hull. See docs/PLAN-parts-break.md.
      parts: {
        head: { hp: 1, status: 'ok' }, rArm: { hp: 1, status: 'ok' }, lArm: { hp: 1, status: 'ok' },
        legs: { hp: 1, status: 'ok' }, pack: { hp: 1, status: 'ok' }, pods: { hp: 1, status: 'ok' },
      },
      shield: { up: false, raise: 0 }, // raise 0..1 (0.3 s to raise)
      // Derived from parts by sim every frame so render/audio never recompute. 1 / true when healthy.
      mods: {
        speed: 1, turn: 1, radarRange: 1, lockTime: 1, spread: 0, rifleCd: 1,
        rifleOk: true, saberOk: true, saberDamage: 1, vulcanOk: true, funnelOk: true, shieldOk: true,
        flightOk: true, funnelRegen: 1, funnelSalvo: Infinity, targetReadable: true,
        // sim additions (CR-002 build): vertical thrust x, roll rate x, hover boost x, flight-form speed x,
        // boost heat x, transform time x, saber reach x, shield raise-time x / cone rad / block fraction
        vertical: 1, roll: 1, boost: 1, flightSpeed: 1, boostHeat: 1, xformTime: 1, saberReach: 1,
        shieldRaise: 1, shieldCone: 55 * Math.PI / 180, shieldBlock: 0.85,
      },
    },

    world: {
      minovskyDensity: 0.35, // 0..1, sim may vary it
      seaLevel: 0,
      sunDir: new THREE.Vector3(-0.6, 0.12, -0.78).normalize(), // dusk, constant
      night: false,          // CR-004: moonlit night (gawman mission)
      moonDir: new THREE.Vector3(0.1, 0.62, -0.78).normalize(), // CR-004: high moon ahead, as in the reference
      terrain: null,         // Chapter 3 (sim): null = open sea everywhere | 'oenbili' = West Arnhem Land (sim/terrain.js);
                             // render builds the land mesh from the same height function
    },

    // Everything in the sky except the player. Sim adds/removes. Each entity:
    //   { id:number, type:'gustav'|'penelope'|'missile'|'funnelMissile'|'beam'|'tracer'|'flare',
    //     faction:'enemy'|'player'|'ally'|'neutral', name:string,   (CR-004: 'neutral' = scripted, never a target)
    //     CR-004 type 'gawman': a person (radius ~1 m), with `light: Vector3` unit flashlight direction
    //     position:Vector3, velocity:Vector3, quaternion:Quaternion,
    //     radius:number (m), hp:number, maxHp:number, heat:0..1 (thermal view), ttl:number|Infinity,
    //     targetId:number|null|'player', alive:boolean,
    //     power:number  (beams only, v2) 1 = heavy shot (player rifle, Penelope), 0.45 = light (Gustav Karl),
    //     parts: (CR-002, gustav/penelope only, else null)  { [name]: { hp, maxHp, status } }
    //            gustav: head, gunArm, pod, thrusters    penelope: head, rifleArm, salvoArm, wingPack
    //     state: string (enemy AI state, read-only for render; CR-002 adds 'ram' and 'flee') }
    // CR-002: enemy 'missile' entities have hp > 0 and can be shot down (vulcan, beams).
    // radius already includes MODEL_SCALE.
    // CR-003 multiplayer:
    //   - faction may also be 'ally' (teammate suits, teammates' shots/missiles) and 'remote'-owned
    //     shots use faction 'enemy' when hostile to you.
    //   - type 'remote' = another human pilot's suit: { ...entity, peerId, name, suit:'gustav'|'penelope', team,
    //     shield:boolean (shield up), weapon:'rifle'|'saber', spawnShield:boolean, dead:boolean,
    //     form: 'ms' | 'flight' (penelope in flight form / transforming past halfway),
    //     parts: shaped like the AI suit of the same type so render reuses its model and part-break visuals,
    //       gustav { head, gunArm, pod, thrusters }   from pilot parts head, rArm, pods, worst(legs, pack)
    //       penelope { head, rifleArm, salvoArm, wingPack } from head, rArm, worst(lArm, pods), worst(legs, pack) }.
    //   - every entity may carry `owner`: peer id of the client that simulates it ('' or undefined = local).
    //     Entities owned elsewhere are mirrors: sim interpolates them from snapshots and never damages
    //     them locally (it sends a hit message instead).
    entities: [],

    mission: {
      wave: 0, waveCount: 3, kills: 0, elapsed: 0,
      objective: '',                 // short line for the HUD
      message: { text: '', ttl: 0 }, // radio/comms line, shown while ttl > 0
      result: null,                  // null | { victory:boolean, kills, elapsed, shotsFired, hits, reason? }
      id: 'waves',                   // CR-004: 'waves' | 'gawman' (copied from state.setup.mission)
      // CR-004 gawman mission readout (sim; null in other missions):
      //   { phase: 'approach'|'falling'|'aboard'|'lost',
      //     penelopeId, gawmanId,          entity ids or null
      //     distance, closing,              m and m/s from the hatch to Gawman (+ = closing)
      //     relVel: Vector3,                Gawman velocity minus player velocity, PLAYER-LOCAL axes
      //     catchPoint: Vector3,            world point in front of the open hatch where he must arrive
      //     inEnvelope: boolean,            distance and relative speed are inside the catch limits now
      //     timeToSea: number }             s until Gawman reaches the sea (Infinity before he jumps)
      //   CR-004 (sim) extra fields: relSpeed (m/s, |relVel|), assist (= syncW), sync ('off' | 'hover' | 'engaging' |
      //     'locked': SPEED SYNC, automatic once he has jumped and the catch point is inside 1.5 km; a flight-form Xi drops
      //     to hover; it matches his velocity only, never steers), syncW (0..1 strength), catchRadius (6 m),
      //     catchSpeed (8 m/s), dangerSpeed (15 m/s), hint (current rescueHint text or ''). distance/closing are measured
      //     from the CATCH POINT (player position + body forward x 7 m) to Gawman (to Penelope before the jump).
      rescue: null,
    },

    // Active warnings for the HUD, managed by sim:
    //   { id:string, text:string, level:'caution'|'warning', ttl:number }
    alerts: [],

    events: [], // one-frame queue, cleared by main after audio.update
  };
}
