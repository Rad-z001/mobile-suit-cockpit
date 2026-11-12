// =============================================================================
// Tuning numbers for the simulation layer. Designers: change values here.
// Units: metres, seconds, m/s, rad/s. "hull" and "energy" are 0..1 fractions.
// =============================================================================
import { MACH, EPACK_SHOTS, XI_COCKPIT } from '../state.js';
export { EPACK_SHOTS };

export const FLIGHT = {
  throttleTau: 0.7,         // s, minovsky engine output lag behind the lever
  boostHeatRate: 0.12,      // thrusterHeat per second at full boost (hover)
  boostHeatRateMinovsky: 0.055,
  coolRate: 0.14,           // thrusterHeat per second when not boosting
  overheatCoolRate: 0.09,   // while forced cooldown
  overheatResume: 0.45,     // heat at which boost is allowed again
  ceiling: 14000,
  floorClear: 60,           // hover ground-proximity assist: m above the sea it will not descend below
  // Hover = mobile-suit form: no gravity, thrust requests set a target velocity, the suit stops by itself.
  hover: {
    cruise: 280, boost: 520,                   // forward target speeds (m/s)
    strafeScale: 0.7, vertScale: 0.6, backScale: 0.65, // fraction of cruise/boost speed on the other axes
    tauUp: 0.42, tauDown: 0.32,                // s, velocity response when speeding up / slowing down
    maxAccel: 460,                             // m/s^2 cap (0 -> cruise in ~1.3 s, stop from boost in ~1.1 s)
    throttleTau: 0.2,
    turnYaw: 2.6, turnPitch: 1.9,              // rad/s body turn rate with the crosshair at its limit
    turnTau: 0.10,                             // s, smoothing of the turn rate
    rollRate: 1.2, rollTau: 0.15,              // CR-002 item 3: Q/E roll about the body forward axis, stays where left
    yawBiasScale: 0.5,                         // damaged-thruster yaw drift
    lateralThrust: 0,
  },
  // Minovsky flight form: fast travel. Velocity chases the nose, wide turns, mild gravity.
  minovsky: {
    cruise: 1.5 * MACH, boost: 2.2 * MACH,
    accel: 24, boostAccel: 34, decel: 14,
    retroMax: 0, retroDecel: 40,
    grip: 0.9,
    latAccel: 78,
    gravityScale: 0.6,
    turnYaw: 1.3, turnPitch: 0.95, turnTau: 0.16,
    rollRate: 1.6, rollTau: 0.2,               // free 360 deg roll, no level assist
    toFlightTime: 2.0, toHoverTime: 1.4, cooldown: 3.0, // CR-002 item 12: committed transformation
    xformThrustScale: 0.5, xformTurnScale: 0.6,
    launchAccel: 90, minSpeed: 150,            // jet: never slower than this once launched, no stall
    aimLimitYaw: 0.14, aimLimitPitch: 0.10,    // 8 / 6 deg forward weapon cone
    toHoverDecel: 100,                         // extra m/s^2 of braking while transforming back to hover
    yawBiasScale: 0.5,
    lateralThrust: 35,                         // m/s^2 from A/D/Space/Ctrl in this mode
  },
  liftSpeedLo: 60, liftSpeedHi: 220, // minovsky mode: wing lift fades in between these speeds
};

export const GFORCE = {
  blackoutThreshold: 5,   // effective g
  blackoutRate: 0.28,     // per second per g above threshold
  blackoutRecover: 0.3,
  negativeGWeight: 1.8,   // negative g counts this much worse
  damperJump: 2.5,        // g change vs slow average that triggers 'gDamper'
  highGCaution: 4.2,
  inputAttenuation: 0.12, // pilot input multiplier at blackout >= 0.85
  hoverLinearScale: 0.05, // hover: felt linear acceleration is damped (inertial dampers), 460 m/s^2 -> 2.3 g
  turnRadius: 5,          // m, head offset from the turn axis: felt g = w^2 * r (hover turns)
};

export const BARRIER = {
  absorb: 0.65,        // fraction of incoming damage absorbed while active
  integrityCost: 2.5,  // integrity lost per unit of absorbed damage
  regen: 0.035,        // per second
  regenDelay: 3,
  reactivate: 0.3,
};

export const WEAPONS = {
  beamSpeed: 2200,          // heavy single shot
  beamTtl: 4.6,             // s: crosses ~10 km
  beamRadius: 6,            // m, entity radius (thick beam)
  beamHitBonus: 14,         // m added to a target's radius for beam hits
  rifleShots: EPACK_SHOTS,  // CR-002 item 4: E-Pack, no generator energy
  rifleReload: 2.0,         // s to swap a pack (R, or automatic when empty)
  rifleCooldown: 1.4,       // s between shots
  rifleDamage: 105,         // Gustav 260 hp: 3 hits; Penelope 800 hp: 8 hits
  targetCone: 25 * Math.PI / 180, // HUD target / lead pip: enemy nearest the crosshair inside this cone
  // beam saber (item 13)
  saberReach: 40,           // m along the crosshair
  saberSwing: 0.5,          // s per slash
  saberHitAt: 0.4,          // swing progress at which the blade connects
  saberCooldown: 0.25,
  saberDamage: 105 * 1.5,   // about 1.5 heavy beams
  vulcanRate: 20,           // rounds/s
  vulcanSpeed: 1100,
  vulcanDamage: 1.6,
  vulcanSpread: 0.011,      // rad
  vulcanTtl: 1.2,
  vulcanConverge: 700,      // CR-006: m, where Xi head-vulcan rounds cross the crosshair line when nothing is under it
  missileHitBonus: { tracer: 3, beam: 8, saber: 0 }, // m added to an enemy missile's radius when shooting it down
  funnelSalvo: 6,           // funnels per launch (all at the one locked target)
  funnelCooldown: 1.5,
  funnelDamage: 20,
  funnelSpeed: 480,
  funnelTurn: 2.6,          // rad/s
  funnelRegenSeconds: 12,
  podSalvo: 4,              // CR-003: Gustav Karl missile pods (F): missiles per salvo, carried, damage vs AI
  podMax: 8,
  podDamage: 45,
  funnelRange: 9000,
  flareTtl: 5,
  flareDecoyChance: 0.75,   // per enemy missile in view of a deployed flare
  // CR-002 item 6: funnel auto-lock. Enemy nearest the crosshair inside the cone locks after lockTime.
  lockCone: 8 * Math.PI / 180,
  lockKeepCone: 12 * Math.PI / 180,
  lockTime: 0.7,            // x (0.7 + minovskyDensity) x mods.lockTime
  lockRange: 12000,
};

export const ENEMY = {
  minAlt: 600, maxAlt: 9500,
  beamSpeedHeavy: 1300, beamSpeedLight: 1650,
  spawnDistMin: 5500, spawnDistMax: 8000,
  // Gustav Karl: sluggish sub-flight sled, light beam (power 0.45)
  gustav: {
    name: 'FD-03 GUSTAV KARL', hp: 260, radius: 16, heat: 0.5,
    cruise: 150, max: 230, accel: 45,
    engageRange: 4200, holdMin: 1600, holdMax: 3600, breakRange: 850,
    fireRange: 5200, fireMin: 500,
    fireInterval: [4.8, 3.9],   // by wave index (wave 1, wave 2)
    burst: [1, 1],              // shots per burst by wave
    dodgeChance: 0.35, beamDamage: 0.04, beamPower: 0.45, beamRadius: 2,
    leadMin: 0.55, leadMax: 1.1, spread: 0.012,
    missileInterval: [11, 16], missileMin: 1800, missileMax: 6500, missileCap: 4,
  },
  // Penelope: fast mobile suit, heavy beam (power 1), circles, makes high-speed passes
  penelope: {
    name: 'RX-104FF PENELOPE', hp: 800, radius: 22, heat: 0.85,
    cruise: 300, max: 470, accel: 160,
    fireRange: 5200, fireInterval: 4.8, burst: 1,
    dodgeChance: 0.5, beamDamage: 0.14, beamPower: 1, beamRadius: 5,
    leadMin: 0.45, leadMax: 0.95, spread: 0.005,
    salvoInterval: [13, 18], salvoSize: 2, missileMin: 1500, missileMax: 5000,
    circleIn: 1900, circleOut: 3300, circleTime: [5, 8], passTime: 5, extendTime: [4, 6],
    decoyChance: 0.6, decoyCooldown: 3.5,
  },
  // CR-005: remote Xi pilots only (never AI): hit radius in model units (x MODEL_SCALE), 28 m tall humanoid with wing binders
  xi: { name: 'RX-105 XI', radius: 21 },   // CR-006: centred on the chest cockpit, so it must still reach the feet
  missile: {
    name: 'HOMING MISSILE', speedStart: 240, speedMax: 470, accel: 150, turn: 0.9,
    damage: 0.12, fuse: 24, ttl: 13, hp: 3, // hp: vulcan 1.6 per round, beam/saber kill outright
  },
};

export const DAMAGE = {
  playerRadius: 14,
  sectorHitChance: 0.35,
  sectorHitPerDamage: 2.5,
  ejectHoldTime: 2.5,
  ejectHullThreshold: 0.25,
  ramDamage: 0.25,
};

export const ALERTS = { pullUpTti: 3.0, pullUpFastTti: 1.5 };

export const WAVES = [
  { gustav: 2, penelope: 0, missiles: false, density: 0.35 },
  { gustav: 3, penelope: 0, missiles: true, density: 0.6 },
  { gustav: 0, penelope: 1, missiles: true, density: 0.85 },
];

export const MISSION = {
  firstWaveDelay: 6,
  betweenWaves: 10,
  clearDelay: 2,
  victoryDelay: 1.5,
  densityDriftRate: 0.02,
};

// ---- CR-008 story Chapter 1: inside the falling cargo (sim/boarding.js). Distances in metres, real scale (the pilot is
// 1.8 m, the Xi 28 m); positions are relative to the Xi's cockpit point in the cargo, world axes. The Xi faces -Z; the
// gangway runs from the forward airlock (most negative z) to the chest hatch.
export const BOARD = {
  startAlt: 4800,              // m, cargo altitude for the whole boarding scene and cold start
  cargoVel: [0, 0, -120],      // CR-009: NO time pressure. The cargo holds its altitude while the pilot / the Xi is aboard;
                               // it only falls after the release (freeVel)
  freeVel: [0, -115, -40],     // the EMPTY cargo's velocity after the release (it eases to this)
  start: [0, 1.0, -66.5],      // pilot eye at the start, in the airlock (floor is 1.7 m below)
  backZ: -68.2,                // rear wall of the airlock
  doorZ: -62,                  // inner hex door
  doorRange: 3.4, doorTime: 1.5,   // it starts opening when the pilot is this close; seconds to open
  corridorHalf: 1.25,          // walkable half width in the corridor
  bayZ: -14,                   // the corridor ends here, at a ledge overlooking the bay where the Xi stands
  endZ: -14.6,                 // reaching this z (the end of the gangway) boards the Xi: the scene cuts to the outside shot
  hatch: [0, 1.0, -6.0],       // the Xi's chest, straight ahead of the ledge (no modelled door or walkway to it)
  walk: 4.5, run: 7.5,         // m/s (Shift runs)
  enterTime: 0.5,              // s, quick fade to black before the outside shot
  cineTime: 6,                 // s, the outside shot of the falling cargo (Enter skips after 1 s)
  titleTime: 5,
};

export const STARTUP = {
  stageTime: [0, 2.4, 2.8, 2.6], // seconds for stages 1..3
  glideVelocity: [0, -28, -120],
};

// ---- CR-002 item 11: parts (docs/PLAN-parts-break.md) -------------------------------------
const D2R = Math.PI / 180;
export const PARTS = {
  dmgScale: 2.0,            // part hp lost per unit of hit damage
  damagedAt: 0.5,           // hp below this = 'damaged'
  hullShare: 0.6,           // hull takes this share of a hit that landed on a part (core hits take all)
  lastWeaponHp: 0.1,        // the last working weapon is held together at this hp
  // weighted part pick by the side the hit came from (weights need not add to 100)
  zones: {
    front: { head: 20, rArm: 22, lArm: 22, legs: 14, core: 22 },
    rear: { pack: 45, pods: 20, legs: 15, core: 20 },
    top: { head: 40, pack: 30, pods: 30 },
    low: { legs: 70, core: 30 },
    side: { arm: 40, pods: 25, legs: 15, core: 20 }, // 'arm' = the arm on the hit side
  },
  frontZ: -0.4, rearZ: 0.4, topY: 0.5, lowY: -0.5,
  // effect numbers by part and status (multipliers unless noted)
  effects: {
    head: { damaged: { radarRange: 0.6, lockTime: 1.5 }, destroyed: { radarRange: 0.25, lockTime: 1.5 } },
    rArm: { damaged: { spread: 0.6 * D2R, rifleCd: 1.3, saberReach: 0.8 } },
    lArm: { damaged: { shieldRaise: 0.6, shieldCone: 40 * D2R, shieldBlock: 0.7 } },
    legs: {
      damaged: { speed: 0.8, turn: 0.85, roll: 0.8 },
      destroyed: { speed: 0.6, turn: 0.7, roll: 0.7, vertical: 0.5, bias: 0.04 },
    },
    pack: {
      damaged: { flightSpeed: 0.7, boostHeat: 1.5, xformTime: 1.5 },
      destroyed: { boost: 0.6 },
    },
    pods: { damaged: { funnelRegen: 0.5, funnelSalvo: 3 } },
  },
  saberLeftHandDamage: 0.6, // rArm destroyed, saber from the left hand
};

export const SHIELD = {
  cone: 55 * D2R, conePartial: 40 * D2R,
  block: 0.85, blockPartial: 0.7,
  leak: 0.15,               // (partial: 1 - blockPartial) goes to the hull
  wear: 0.5,                // L-arm hp lost per unit of raw damage blocked
  raise: 0.3,               // s to raise
  lower: 0.15,              // s to lower
  moveScale: 0.6,           // movement speed while up
};

// Boxes are [cx, cy, cz, hx, hy, hz] in MODEL units (forward -Z), taken from render/models.js.
// The sim scales them by MODEL_SCALE x MODEL_BASE_SCALE[type] (what the render draws). 'torso' boxes exist so that a hit on the body picks no part.
// Drawn size per model unit, before MODEL_SCALE. render/models.js (GUSTAV.baseScale, PENELOPE.baseScale) reads these, so the
// part boxes below are scaled by exactly what the player sees: MODEL_SCALE * MODEL_BASE_SCALE[type].
// (= sim base hit radius / nominal model radius: gustav 16/10, penelope 22/18.)
export const MODEL_BASE_SCALE = { gustav: 1.6, penelope: 22 / 18, xi: 1 }; // xi: render normalises the mesh to XI_MODEL_HEIGHT (28 m) units, so scale 1
export const ENEMY_PARTS = {
  damagedAt: 0.5,
  partDamage: { beam: 1, funnel: 1, vulcan: 4, saber: 2 }, // part damage = hit damage x this
  hp: {
    gustav: { head: 140, gunArm: 160, pod: 120, thrusters: 160 },
    penelope: { head: 260, rifleArm: 300, salvoArm: 260, wingPack: 320 },
  },
  ranged: { gustav: ['gunArm', 'pod'], penelope: ['rifleArm', 'salvoArm'] },
  mobility: { gustav: 'thrusters', penelope: 'wingPack' },
  boxes: {
    // Gustav Karl humanoid (FD-03-00 model, ~19 units tall, facing -Z; right arm +X, shield arm -X). First box of a part = its centre.
    gustav: {
      head: [[0, 8.4, 0, 1.6, 1.5, 1.6]],
      gunArm: [[4.0, 3.0, 0, 1.25, 3.4, 1.25], [3.9, 6.1, 0.1, 2.05, 1.9, 2.05], [4.05, -0.1, -3.2, 0.7, 0.9, 4.4]],
      pod: [[-4.0, 3.0, 0, 1.25, 3.4, 1.25], [-3.9, 6.1, 0.1, 2.2, 2.0, 2.2],
        [-6.4, 0.4, 0.3, 0.95, 2.4, 1.95], [-6.2, 5.2, 0.3, 1.0, 2.6, 1.95], [-4.0, 8.7, 0.3, 2.0, 1.0, 1.95], [-7.7, 1.2, 0.3, 0.55, 1.1, 1.25]],
      thrusters: [[-0.1, 5.2, 2.35, 1.8, 1.7, 0.9], [-1.2, 4.6, 3.6, 2.4, 1.0, 0.6], [-2.0, 7.1, 2.5, 0.6, 0.5, 0.6],
        [-3.0, -4.8, 2.55, 0.8, 2.0, 0.5], [3.0, -4.8, 2.55, 0.8, 2.0, 0.5], [-3.0, -6.7, 2.7, 0.5, 0.5, 0.4], [3.0, -6.7, 2.7, 0.5, 0.5, 0.4]],
      torso: [[0, 5.1, -0.1, 2.4, 1.8, 1.6], [0, 1.6, 0, 2.4, 2.2, 1.5], [0, 1.55, 1.95, 2.3, 1.5, 0.6],
        [-2.5, -1.0, 0, 1.5, 1.6, 1.4], [2.5, -1.0, 0, 1.5, 1.6, 1.4], [-3.0, -4.7, 0.1, 2.0, 3.0, 2.1], [3.0, -4.7, 0.1, 2.0, 3.0, 2.1],
        [-3.0, -8.0, -0.8, 1.9, 0.5, 2.9], [3.0, -8.0, -0.8, 1.9, 0.5, 2.9]],
    },
    // CR-005 Xi Gundam (owner's Meshy model), model units = metres of a 28 m humanoid, origin = bbox centre (y -14 feet .. +14 head top),
    // facing -Z, +X = right (rifle) side. Part names are the PLAYER part names (a remote Xi mirrors the pilot's parts).
    // Assumption: the render normalises the mesh to height 28 and centres the bbox, so the figure is about 11 m wide with the wing binders.
    xi: {
      head: [[0, 11.7, -0.3, 1.9, 2.3, 2.0]],
      rArm: [[5.2, 7.4, -0.2, 1.7, 1.8, 1.9], [5.5, 3.6, 0, 1.2, 2.8, 1.3], [5.6, -0.6, -1.2, 1.3, 3.3, 1.8]],
      lArm: [[-5.2, 7.4, -0.2, 1.7, 1.8, 1.9], [-5.5, 3.6, 0, 1.2, 2.8, 1.3], [-5.6, -0.6, -1.2, 1.3, 3.3, 1.8]],
      legs: [[1.9, -5.6, 0, 1.7, 3.6, 2.0], [-1.9, -5.6, 0, 1.7, 3.6, 2.0], [2.0, -11.2, -0.2, 1.6, 3.0, 2.0], [-2.0, -11.2, -0.2, 1.6, 3.0, 2.0]],
      pack: [[0, 6.5, 3.2, 3.0, 3.6, 1.6], [5.0, 10.5, 3.4, 1.2, 4.6, 1.8], [-5.0, 10.5, 3.4, 1.2, 4.6, 1.8]],
      pods: [[3.6, 12.4, 2.6, 1.0, 1.8, 1.2], [-3.6, 12.4, 2.6, 1.0, 1.8, 1.2]],
      torso: [[0, 6.6, -0.2, 3.4, 3.6, 2.3], [0, 1.6, 0, 2.5, 1.6, 1.9], [0, -1.4, 0, 3.3, 1.5, 2.1]],
    },
    // Penelope Gundam (owner's model, normalised to a bounding radius of ~17.5; +X = rifle side, origin = bbox centre).
    // Legs are part of the torso list: a leg hit counts as a core hit.
    penelope: {
      head: [[0, 5.4, -0.5, 1.3, 1.4, 1.2], [0, 9.6, -1.1, 1.2, 3.5, 2.4]],
      rifleArm: [[4.0, -0.3, -0.4, 0.7, 3.1, 0.8], [3.8, -3.4, -5.8, 0.5, 1.5, 6.2]],
      salvoArm: [[-4.0, -0.3, -0.5, 0.7, 3.1, 0.8], [-3.4, -2.1, -0.9, 2.9, 3.0, 2.0]],
      wingPack: [
        [0, 2.8, 2.4, 2.3, 2.8, 0.9],
        [4.6, 6.1, 6.2, 3.7, 4.1, 5.0], [-4.6, 6.1, 6.2, 3.7, 4.1, 5.0],
        [8, 8.4, -0.5, 2.6, 5.7, 2.0], [-8, 8.4, -0.5, 2.6, 5.7, 2.0],
      ],
      torso: [[0, -0.5, -0.3, 2.8, 3.2, 1.5], [0, -9.5, -0.3, 2.6, 6.5, 1.4]],
    },
  },
  // numbers multiply into e.sim.mods; booleans AND; 'salvo' is a cap on missiles per salvo
  effects: {
    gustav: {
      head: { damaged: { spread: 1.5 }, destroyed: { spread: 2.5, leadOk: false, dodge: 0.5 } },
      gunArm: { damaged: { fireRate: 1.4 }, destroyed: { beamOk: false } },
      pod: { damaged: { missileRate: 1.5 }, destroyed: { missileOk: false } },
      thrusters: { damaged: { speed: 0.8, accel: 0.8, dodge: 0.7 }, destroyed: { speed: 0.5, accel: 0.5, dodge: 0.7, breakOk: false } },
    },
    penelope: {
      head: { damaged: { spread: 1.5 }, destroyed: { spread: 2.5, leadOk: false, dodge: 0.5 } },
      rifleArm: { damaged: { fireRate: 1.4 }, destroyed: { beamOk: false } },
      salvoArm: { damaged: { salvo: 1, decoyCd: 1.5 }, destroyed: { missileOk: false, decoyOk: false } },
      wingPack: { damaged: { speed: 0.8, accel: 0.8, passTime: 0.7 }, destroyed: { speed: 0.5, accel: 0.5, passOk: false, circle: 0.7 } },
    },
  },
  ramDamage: 0.15,
  fleeHp: 0.3, fleeRange: 8000, returnDelay: 20,
};
// CR-006: the boxes above are measured from the mesh's bbox centre; a Xi entity's position is its chest cockpit (XI_COCKPIT).
for (const list of Object.values(ENEMY_PARTS.boxes.xi)) for (const b of list) { b[0] -= XI_COCKPIT.x; b[1] -= XI_COCKPIT.y; b[2] -= XI_COCKPIT.z; }

// ---- CR-003 multiplayer ------------------------------------------------------------------------
// Damage one weapon does to another PILOT, as a fraction of hull (a pilot's hull is 0..1). Damage to AI uses
// the normal hp numbers above.
export const PVP = { rifle: 0.34, saber: 0.5, vulcan: 0.007, funnel: 0.1 };
export const MATCH = {
  spawnRadius: 2500, spawnAlt: 1500,
  spawnShield: 2,           // s of spawn protection after the match starts / a respawn
  coopScale: 0.5,           // co-op waves: +50 % enemies per extra pilot
  aiRespawn: 8, aiFirst: 3, // ffa/team with AI: seconds until a replacement / the first AI show up
  startupSpeed: 2.4,        // cold start runs this much faster in a match so it ends inside the countdown
  feedTtl: 7,
  hitFlushVulcan: 0.2,      // vulcan hits are batched into one `hit` message per this many seconds
  matchMsgEvery: 0.5,       // host `match` broadcast period
  mirrorGrace: 1.0,         // s a mirrored AI / missile may stay silent before it is dropped
};

// ---- CR-004 hatch + Gawman retrieval ---------------------------------------------------------------
export const HATCH = {
  windSpeed: 120,           // m/s: above this an open hatch buffets the pilot and raises WIND
  damageSpeed: 200,         // m/s: above this the open hatch slowly damages the hull
  damageRate: 0.012,        // hull per second at damageSpeed (grows with speed, scales with how far open)
  damageFloor: 0.05,        // the wind alone never takes the hull below this
  buffet: 0.05,             // g of random jitter per frame at (speed - windSpeed) = 80 m/s
  windEvery: 1.0,           // s between 'hatchWind' events while buffeting
};

export const GAWMAN = {
  startAlt: 2400,           // m, player altitude at the start of the mission
  penelopeAhead: 1500,      // m ahead of the player at the start
  penelopeSpeed: 110,       // m/s
  weaveAmp: [26, 12],       // m: lateral, vertical weave amplitude
  weavePeriod: [9, 13],     // s
  jumpDist: 450,            // m: he jumps when the player is this close to Penelope ...
  jumpTime: 60,             // s: ... or this long after the flight starts
  terminal: 55,             // m/s terminal fall speed (quadratic drag k = g / terminal^2, all axes)
  radius: 1,
  catchOffset: 7,           // m: catch point = player position + body forward * this
  catchRadius: 6,           // m: Gawman must be this close to the catch point ...
  catchSpeed: 8,            // m/s: ... with at most this relative speed, hatch fully open
  contactRadius: 10,        // m from the player centre = the hull
  contactSpeed: 15,         // m/s: hull contact above this relative speed is fatal for him
  seaAlt: 30,               // m: below this he is lost
  // SPEED SYNC (owner: "automatic", "match speed only"): once he has jumped and the catch point is inside syncRange,
  // a flight-form Xi drops to hover by itself (flight form cannot fly as slow as he falls), then the hover's no-thrust
  // velocity becomes HIS velocity, ramping in over syncEngage s. It never steers: the pilot closes the gap, with thrust
  // relative to him and a full stick worth at most max(syncMinRel, syncGain x gap) m/s - so holding the stick toward
  // him slows the approach down by itself (300 m: 180 m/s, 30 m: 18, at the catch point 5) and he is never rammed.
  syncRange: 1500, syncEngage: 0.8, syncRelease: 0.3, syncGain: 0.6, syncMinRel: 5,
  syncHullStop: 8,          // m: with the hatch not fully open, no thrust toward him inside this gap to the hull
  hintCooldown: 2.5,
};

// ---- story Chapter 1, third wave (sim/missions/lane.js): the Penelope brings Gawman, lets him go over the Xi, then Lane
// Aim duels the player. Story only; the 'waves' mission keeps its plain third wave.
export const LANE = {
  spawnAhead: 2800,         // m: she appears ahead of the Xi ...
  spawnUp: 600,             // ... and this much higher
  stationAhead: 320,        // m: where she holds over the Xi: ahead of it ...
  stationUp: 170,           // ... and above it (about 28 degrees up: on the panoramic monitor without looking up)
  minAlt: 1300,             // m: never lower than this (his fall needs room: ~20 s from here to the sea)
  stationGain: 0.8,         // 1/s: how hard she closes on the station
  approachSpeed: 420,       // m/s: cap on her speed relative to the Xi while closing
  arriveRange: 160,         // m from the station: the talk starts
  lineTime: 6.5,            // s between the radio lines of the talk
  slowSpeed: 90,            // m/s: she lets him go once the Xi is this slow ...
  dropWait: 16,             // s: ... or this long after asking
  awayAhead: 650, awayUp: 450,   // after the drop she backs off to here and watches
  maxElev: 0.61,            // rad (35 deg): a low Xi - she moves further ahead so she stays this far above the nose at most
  maxAhead: 1300,           // m: ... but never further than this (his drop stays inside GAWMAN.syncRange)
  arriveFallback: 25,       // s: the talk starts anyway once she is within 1.5 km of the Xi after this long
  duelDelay: 3.5,           // s from the hatch sealing to her attack
};

// ---- CR-013 story Chapter 2 "Return to Seawrack" (sim/missions/seawrack.js) ----------------------------------------
// Straight on from the Chapter 1 battle: fly home to the carrier ship Seawrack past three enemy radar pickets.
export const SEAWRACK = {
  shipDistance: 42000,      // m from the player to Seawrack when the chapter starts
  shipBearing: 2.3,         // rad from the player's heading at the start (+ = turn right): the ship is behind and to the right
  shipSpeed: 12,            // m/s, steady course at right angles to the route
  shipLength: 300, shipBeam: 50, deckY: 25,   // m; deck height above the sea
  bridgeZ: -65, bridgeHalf: 20, bridgeTop: 75,  // superstructure aft of amidships: centre (ship-local z, + = bow), half length, roof height
  portalZ: 45, portalHalf: 7, portalTop: 81,    // the portal crane over the forward hatches: centre, half depth, top (m above the sea)
  shipHits: 40,             // enemy beam hits Seawrack survives (undefended: sunk about 2 min after it is found)
  pickets: [[0.30, 3500], [0.56, -4200], [0.80, 2600]],   // [fraction of the route, sideways offset m]
  radarRadius: 9000,        // m, horizontal radar range of a picket
  radarFloor: 300,          // m: below this cockpit altitude the radar cannot see you ...
  closeRange: 1800,         // ... unless you are this close to the picket
  fillTime: 4.5,            // s of full exposure to fill the detection meter (more at the edge of coverage)
  drainTime: 7,             // s for a full meter to drain once hidden
  flightFormRate: 2,        // flight form fills the meter this much faster
  alertCooldown: 8,         // s after a detection before the meter fills again
  interceptorsPerAlert: 2, maxAlerts: 3,
  interceptSpawnDist: 1500, interceptSpawnAlt: 900,  // interceptors launch from the picket toward the player
  foundRange: 10000,        // detected this close to Seawrack -> the ship is found
  chaseRange: 6000,         // a hostile this close to the player blocks landing; this close to Seawrack -> the ship is found
  strikeCount: 3, strikeSpawnDist: 9000, strikeSpawnAlt: 1400,
  strikeEngagePlayer: 1500, // m: strike-group Gustavs turn on the player when he is this close, else attack the ship
  landZ: -2, landHalfWidth: 18, landHalfLength: 30,  // m: the yellow landing box on the deck between the portal crane and the bridge
  landHeight: 45,           // m: feet at most this far above the deck
  landSpeed: 25,            // m/s horizontal speed relative to the ship
  landTime: 3,              // s held inside the landing envelope
  cockpitAboveDeck: 41,     // m: the standing Xi's chest cockpit above its feet (the drawn suit is 56 m tall)
  minHull: 0.5,             // a checkpoint restart tops the hull up to at least this
  startAlt: 3600,           // m: checkpoint restart altitude
  titleTime: 6,             // s the chapter title card shows
};


// ---- CR-014 story interlude "Aboard Seawrack" (sim/missions/aboard.js): ends Chapter 2 ------------------------------------
// Positions are in the ship's model frame (render/seawrack.js): metres, bow toward -Z, +X starboard, y up from the waterline.
export const ABOARD = {
  homeRange: 1200,          // m: horizontal distance to Seawrack that starts the homecoming (no pursuers, no strike group)
  cineTime: 12,             // s: the outside landing shot (Enter skips after 1 s)
  fadeTime: 0.8,            // s: fades between the deck, the corridor and Command
  liftTime: 2.2,            // s: the lift ride (black)
  endTime: 2.5,             // s: fade out after the briefing
  walk: 1.7, run: 4.2, eye: 1.7,
  start: [6, 0, 16],        // where the pilot stands after the cut (beside the closed hold, facing the bridge)
  talkRange: 3.4, talkCos: 0.78,
  deck: { x: 22.4, z0: -34, z1: 44.4 },
  hold: [-14, -30, 2.4],    // the open access hatch into hold two: x, z, half size (blocked, look down into it)
  door: { x: 1.5, z: 44.2 },
  corridor: { x: 1.4, z0: 45.8, z1: 58.6 },        // walls at x +-2.5 (the world camera's near plane needs the room)
  command: { x: 21, z0: 48.8, z1: 58.6, floor: 39.2 },   // floor height above the deck; consoles under the front windows
  captainDesk: [8.5, 49.6, 11.5, 52.5],                  // x0, z0, x1, z1: the captain's desk and chair in Command (solid)
  table: [0, 52.5, 2.8],    // x, z, radius of the map table
  briefRange: 4.6,          // m from the table that starts the briefing
};
