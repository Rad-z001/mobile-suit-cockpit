// The cockpit interior that the pilot can see OVER the panoramic monitor.
// Cockpit space: origin = sphere centre = neutral eye, +Y up, -Z forward, +X right, metres, shell R = 1.1.
//   scene
//    |- shell (fixed): hatch rims, hatch door, suspension housing + coils
//    |- hudRoot (fixed): index.js / hud.js hang the HUD patch here (so it stays put when the head moves)
//    '- seatPivot (rig.seatPos / rig.seatQuat)   -> everything attached to the linear seat:
//         seat parts, consoles (rattle group) with stick / throttle / MFD / switches, legs, pedals,
//         hatch lever, harness clamps, pilot's gloved hands + forearms.
// Colours / materials follow doc 07 sec 3 (gunmetal #2B2D31, nylon #1A1C1E, rubber #0D0E10, chrome #D8D8D8,
// lever #F5A623 / #1A1A1A stripes).
import * as THREE from 'three';
import { part, B, Cz } from './models.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COL, P, sph, mergeParts, seatParts, consoleParts, stickParts, triggerParts, throttleParts, handParts, pedalPadParts, pedalFrameParts, clampParts } from './cockpitParts.js';
import { SEAT_PIVOT } from './cameraRig.js';
import { AIM_MAX_YAW, AIM_MAX_PITCH } from '../state.js';
import { createSubMonitors } from './subMonitors.js';
import { clamp, damp, saturate, smoothstep, num, isVec, hash1, DEG, tmp } from './util.js';

const GUN = 0x2b2d31, NYL = 0x1a1c1e, RUB = 0x0d0e10, CHROME = 0xd8d8d8, PANEL = 0x16181b;
const SUIT = 0x1b1e26, GLOVE = 0x15181c;

function cylY(rt, rb, h, seg = 10) { return new THREE.CylinderGeometry(rt, rb, h, seg); }
function cylX(r, len, seg = 10) { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); return g; }
function torus(R, r, seg = 20) { const g = new THREE.TorusGeometry(R, r, 6, seg); g.rotateX(Math.PI / 2); return g; }

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#f5a623';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#1a1a1a';
  for (let k = -64; k < 128; k += 32) {
    x.beginPath();
    x.moveTo(k, 0); x.lineTo(k + 16, 0); x.lineTo(k + 80, 64); x.lineTo(k + 64, 64);
    x.closePath();
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

export function createCockpit(state, rig) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.012, 32);   // far 32: the story cold start shows the cargo bay through the hatch (render/hatch.js)
  const vis = { leverPull: 0, emergency: 0, lightLevel: 0, stage: 0 };

  const matSolid = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matMetal = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: 0x555a60 });
  const matTeal = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  // cheap rim light on the graphite shells (fresnel), tinted/scaled each frame: gives the cel-style edge glint
  const rimU = { value: new THREE.Color(0, 0, 0) };
  const addRim = (mat, key) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uRim = rimU;
      sh.fragmentShader = 'uniform vec3 uRim;' + String.fromCharCode(10) + sh.fragmentShader.replace('#include <opaque_fragment>', 'float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0); outgoingLight += uRim * rimF;' + String.fromCharCode(10) + '#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = () => key;
  };
  const matGlove = new THREE.MeshLambertMaterial({ vertexColors: true });
  addRim(matMetal, 'cpRimPhong'); addRim(matSolid, 'cpRimLambert'); addRim(matGlove, 'cpRimLambert');
  const matTritium = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const matLeds = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const matStripe = new THREE.MeshLambertMaterial({ map: stripeTexture() });
  const GRAD_SEAT = [-0.75, 0.3, 0.68, 1.12], GRAD_CON = [-0.46, -0.3, 0.8, 1.1];   // baked vertical gradient: top lighter, bottom darker
  const M = (parts, mat, grad) => { const m = new THREE.Mesh(mergeParts(parts, grad), mat); m.frustumCulled = false; return m; };

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0x3a5090, 0x0a1822, 0);
  const sunL = new THREE.DirectionalLight(0xff9a55, 0);
  const amb = new THREE.AmbientLight(0x1c3430, 0);
  const emerg = new THREE.PointLight(0xff3010, 0, 3.2, 2);
  emerg.position.set(0, 0.45, 0.1);
  const flashL = new THREE.PointLight(0x3dff7a, 0, 3.5, 1.6);   // beam rifle / enemy beam wash
flashL.position.set(0.25, -0.05, -0.25);
const rearL = new THREE.DirectionalLight(0x9fd0c4, 0);   // soft cabin fill from behind the pilot: lifts the seat back and the undersides facing the eye
  rearL.position.set(0.25, 0.45, 1.6);
  scene.add(hemi, sunL, amb, emerg, flashL, rearL);

  // ---------------------------------------------------------------- shell (fixed)
  const shell = new THREE.Group();
  scene.add(shell);
  {
    const P = [];
    P.push(part(torus(0.50, 0.025, 28), GUN, 0, 1.0, 0));         // ceiling hatch rim
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      P.push(part(B(0.05, 0.05, 0.05), CHROME, Math.cos(a) * 0.5, 0.97, Math.sin(a) * 0.5, 0, -a, 0));
    }
    // suspension arm housing on the rear wall + electromagnetic coils (copper)
    P.push(part(Cz(0.11, 0.11, 0.26, 14), GUN, 0, -0.35, 0.96));
    P.push(part(B(0.34, 0.34, 0.03), NYL, 0, -0.35, 1.06));
    // three thin hoses with clamps from the seat chassis down to the floor (replaces the old floor ring)
    for (const [x0, z0, x1, z1, sag] of [[-0.12, 0.30, -0.45, 0.35, 0.09], [0.02, 0.36, 0.05, 0.62, 0.12], [0.14, 0.26, 0.48, 0.2, 0.08]]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x0, -0.70, z0), new THREE.Vector3((x0 + x1) / 2, -0.78 - sag, (z0 + z1) / 2), new THREE.Vector3(x1, -0.97, z1)]);
      P.push(part(new THREE.TubeGeometry(curve, 10, 0.011, 6, false), 0x15191c, 0, 0, 0));
      for (const t of [0.18, 0.55, 0.9]) { const q = curve.getPoint(t); P.push(part(B(0.03, 0.02, 0.03), 0x8d93a8, q.x, q.y, q.z)); }
    }
    shell.add(M(P, matMetal));
    const C = [];
    for (let i = 0; i < 4; i++) C.push(part(torus(0.118, 0.014, 14).rotateX(Math.PI / 2), 0xb87333, 0, -0.35, 0.86 + i * 0.05));
    shell.add(M(C, matMetal));
  }
  // hatch door (blows off on 'hatchBlow')
  const hatchDoor = M([part(cylY(0.47, 0.47, 0.04, 28), GUN, 0, 1.02, 0), part(B(0.5, 0.012, 0.06), 0xf5a623, 0, 0.995, 0.0)], matMetal);
  shell.add(hatchDoor);
  const hudRoot = new THREE.Group();
  scene.add(hudRoot);

  // ---------------------------------------------------------------- seat
  const seatPivot = new THREE.Group();
  const seat = new THREE.Group();
  seat.position.copy(SEAT_PIVOT).negate();
  seatPivot.add(seat);
  scene.add(seatPivot);

  {
    const S0 = seatParts();
    seat.add(M(S0.cloth, matSolid, GRAD_SEAT), M(S0.armor, matMetal, GRAD_SEAT), M(S0.teal, matTeal));
  }


  // ---------------------------------------------------------------- consoles (rattle together)
  const consoles = new THREE.Group();
  seat.add(consoles);
  {
    const C0 = consoleParts();
    consoles.add(M(C0.armor, matMetal, GRAD_CON), M(C0.cloth, matSolid), M(C0.teal, matTeal), M(C0.trit, matTritium), M(C0.leds, matLeds));
  }

  // sub-monitors (centre suit/readout screen + threat radar + systems), see subMonitors.js
  const subs = createSubMonitors(state);
  consoles.add(subs.group);

  // flight-mode toggle
  const toggle = new THREE.Group();
  toggle.position.set(-0.29, -0.395, -0.275);
  toggle.add(M([P(cylY(0.005, 0.006, 0.035, 8), COL.chrome, 0, 0.0175, 0), P(sph(0.009, 8, 6), 0xdd3322, 0, 0.037, 0)], matMetal));
  consoles.add(toggle);

  // ---------------------------------------------------------------- right stick + hand
  const pitchG = new THREE.Group(), rollG = new THREE.Group(), twistG = new THREE.Group();
  pitchG.position.set(0.34, -0.385, -0.12);
  pitchG.add(rollG); rollG.add(twistG);
  consoles.add(pitchG);
  {
    const SP = stickParts();
    twistG.add(M(SP.cloth.concat(SP.armor), matMetal), M(SP.leds, matLeds));
  }
  const trigger = new THREE.Group();
  trigger.position.set(0, 0.165, -0.024);
  trigger.add(M(triggerParts(), matMetal));
  twistG.add(trigger);
  const handR = new THREE.Group();
  handR.add(M(handParts(1, 0.14), matGlove));
  twistG.add(handR);
  const wristR = new THREE.Object3D(); wristR.position.set(0, 0.112, 0.066); twistG.add(wristR);

  // ---------------------------------------------------------------- left throttle + hand
  const leverG = new THREE.Group();
  leverG.position.set(-0.34, -0.395, -0.10);
  consoles.add(leverG);
  {
    const TP = throttleParts();
    leverG.add(M(TP.cloth.concat(TP.armor), matMetal), M(TP.leds, matLeds));
  }
  const handL = new THREE.Group();
  handL.add(M(handParts(-1, 0.14), matGlove));
  leverG.add(handL);
  const wristL = new THREE.Object3D(); wristL.position.set(0, 0.112, 0.066); leverG.add(wristL);

  // forearms (stretched every frame between wrist and elbow)
  // slim suit sleeve: +Z = elbow end (thicker), -Z = wrist end; white with a purple stripe + band and a grey cuff
  const foreGeo = new THREE.CylinderGeometry(0.02, 0.0145, 1, 10, 6);
  foreGeo.rotateX(Math.PI / 2);
  {
    const pos = foreGeo.attributes.position, nor = foreGeo.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getZ(i) + 0.5;
      if (t < 0.12) c.set(0x2a2d38); else if (t < 0.2) c.set(0x4a3f86);
      else if (nor.getY(i) > 0.55 && t > 0.3 && t < 0.9) c.set(0x5d4f9e); else if (t > 0.5 && t < 0.58) c.set(0x4a3f86); else c.set(0x585b72);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    foreGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const foreR = new THREE.Mesh(foreGeo, matSolid), foreL = new THREE.Mesh(foreGeo, matSolid);
  foreR.frustumCulled = foreL.frustumCulled = false;
  seat.add(foreR, foreL);
  const elbowR = new THREE.Vector3(0.40, -0.358, 0.27), elbowL = new THREE.Vector3(-0.40, -0.358, 0.27);   // resting on the console tops, outboard

  // ---------------------------------------------------------------- pedals (child of the seat chassis, doc 07)
  function makePedal(sx) {
    const g = new THREE.Group();
    g.position.set(sx * 0.15, -0.80, -0.50);
    seat.add(g);
    const pad = new THREE.Group();
    const PP = pedalPadParts(sx);
    pad.add(M(PP.cloth, matSolid), M(PP.armor, matMetal));
    g.add(pad);
    const PF = pedalFrameParts(sx);
    g.add(M(PF.armor, matMetal));
    return pad;
  }
  const padL = makePedal(-1), padR = makePedal(1);

  // ---------------------------------------------------------------- manual hatch lever (yellow / black)
  const hatchLever = new THREE.Group();
  hatchLever.position.set(0, -0.63, -0.33);
  // owner request: the lever bar + pedestal are no longer drawn (read as a stray arm). The group stays (update() rotates it);
  // eject is driven by sim, only the visual is gone.
  seat.add(hatchLever);

  // ---------------------------------------------------------------- harness shoulder clamps
  const clamps = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(sx * 0.31, -0.10, 0.17);
    const CP = clampParts(sx);
    g.add(M(CP.armor.concat(CP.cloth), matMetal));
    seat.add(g);
    clamps.push(g);
  }


  // ---------------------------------------------------------------- hit sparks on the cockpit wall (parts plan sec 3)
  const SPK_N = 56;
  const spk = { pos: new Float32Array(SPK_N * 3), vel: new Float32Array(SPK_N * 3), age: new Float32Array(SPK_N).fill(1), life: new Float32Array(SPK_N).fill(1), col: new Float32Array(SPK_N * 3), head: 0 };
  const spkGeo = new THREE.BufferGeometry();
  spkGeo.setAttribute('position', new THREE.BufferAttribute(spk.pos, 3));
  spkGeo.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(SPK_N).fill(1), 1));
  spkGeo.setAttribute('aCol', new THREE.BufferAttribute(spk.col, 3));
  const spkMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aAge; attribute vec3 aCol; varying float vA; varying vec3 vC;
      void main(){
        vA = aAge; vC = aCol;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aAge >= 1.0 ? 0.0 : (2.0 + 8.0 * (1.0 - aAge)) * (900.0 / 720.0) / max(-mv.z, 0.2);
      }`,
    fragmentShader: `
      varying float vA; varying vec3 vC;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0 || vA >= 1.0) discard;
        float g = exp(-d * d * 3.0);
        gl_FragColor = vec4(mix(vec3(1.0), vC, smoothstep(0.0, 0.6, vA)) * g * (1.0 - vA), 1.0);
      }`,
  });
  const spkPts = new THREE.Points(spkGeo, spkMat);
  spkPts.frustumCulled = false;
  spkPts.renderOrder = 5;
  scene.add(spkPts);
  const sparkL = new THREE.PointLight(0xffa050, 0, 2.2, 1.6);
  scene.add(sparkL);
  let sparkLK = 0;
  const lastHit = new THREE.Vector3(0, 0, -1);
  function burst(dir, n, r, g, b, speed = 0.7) {
    const d = isVec(dir) ? tmp.v1.set(dir.x, dir.y, dir.z).normalize() : tmp.v1.set(0, 0, -1);
    lastHit.copy(d);
    // tangent basis on the wall
    const t1 = tmp.v2.set(0, 1, 0).cross(d);
    if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = tmp.v3.copy(d).cross(t1).normalize();
    for (let i = 0; i < n; i++) {
      const k = spk.head; spk.head = (spk.head + 1) % SPK_N;
      const a = Math.random() * 6.283, sp = (0.2 + Math.random()) * speed;
      const ox = (Math.random() - 0.5) * 0.06, oy = (Math.random() - 0.5) * 0.06;
      spk.pos[k * 3] = d.x * 1.04 + t1.x * ox + t2.x * oy;
      spk.pos[k * 3 + 1] = d.y * 1.04 + t1.y * ox + t2.y * oy;
      spk.pos[k * 3 + 2] = d.z * 1.04 + t1.z * ox + t2.z * oy;
      spk.vel[k * 3] = (t1.x * Math.cos(a) + t2.x * Math.sin(a)) * sp - d.x * 0.15;
      spk.vel[k * 3 + 1] = (t1.y * Math.cos(a) + t2.y * Math.sin(a)) * sp - d.y * 0.15 - 0.25 * Math.random();
      spk.vel[k * 3 + 2] = (t1.z * Math.cos(a) + t2.z * Math.sin(a)) * sp - d.z * 0.15;
      spk.col[k * 3] = r; spk.col[k * 3 + 1] = g; spk.col[k * 3 + 2] = b;
      spk.age[k] = 0; spk.life[k] = 0.3 + Math.random() * 0.45;
    }
    spkGeo.attributes.aCol.needsUpdate = true;
    sparkL.position.copy(d).multiplyScalar(0.8);
    sparkL.color.setRGB(r, g * 0.8, b * 0.6);
    sparkLK = 1;
  }

  // ---------------------------------------------------------------- per-frame state
  let leverPull = 0;
  let toggleRot = 0.55, clampKick = 0;
  let stickP = 0, stickR = 0, stickY = 0, thr = 0, pedL = 0, pedR = 0, trig = 0;
  let tense = 0, rattle = 0, blowT = -1, ledBlink = 0, flareBlink = 0;
  let greenK = 0, pinkK = 0;
  let closeK = 0, emergK = 0, lightK = 0, tritK = 0.55, ledK = 0;
  const upC = new THREE.Vector3();
  const sunC = new THREE.Vector3();
  const qInv = new THREE.Quaternion();
  const skyCol = new THREE.Color(), gndCol = new THREE.Color(), tmpC = new THREE.Color();
  const wrist = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3();
  const ZAX = new THREE.Vector3(0, 0, 1);

  function onEvent(e) {
    subs.onEvent(e);
    switch (e.type) {
      case 'rifleFire': tense = 1; rattle = Math.min(1, rattle + 0.9); greenK = 1; break;
      case 'vulcanFire': rattle = Math.min(1, rattle + 0.4); break;
      case 'playerHit': rattle = 1; burst(e.dir, 14, 1.0, 0.62, 0.22); break;
      case 'shieldBlock': burst(e.dir, 12, 0.35, 0.85, 1.0, 0.9); break;
      case 'partDestroyed': burst(lastHit, 26, 1.0, 0.5, 0.15, 1.0); break;
      case 'partDamaged': burst(e.dir || lastHit, 8, 1.0, 0.7, 0.3, 0.6); break;
      case 'flightTransformStart': clampKick = 1; break;
      case 'flightTransformEnd': clampKick = Math.max(clampKick, 0.5); break;
      case 'uiClick': ledBlink = 0.15; break;
      case 'flareDeploy': flareBlink = 0.5; break;
      case 'hatchBlow': blowT = 0; break;
      default: break;
    }
  }

  // ctx = { time, emergency (0|1), stage, progress, aspect }
  function update(dt, ctx) {
    const inp = state.input || {};
    const p = state.player || {};
    const phase = state.phase;
    const st = state.startup || {};
    const stage = phase === 'startup' ? Math.max(0, Math.floor(num(st.stage, 0))) : 4;
    const prog = saturate(num(st.progress, 0));
    vis.stage = stage;
    const time = ctx.time;
    const k = (r) => (dt > 0 ? 1 - Math.exp(-r * dt) : 1);

    // seat transform from the rig
    seatPivot.position.copy(rig.seatPos);
    seatPivot.quaternion.copy(rig.seatQuat);

    // ---- controls ----
    const aim = p.aim || {};
    const aimYn = clamp(num(aim.yaw, 0) / AIM_MAX_YAW, -1, 1), aimPn = clamp(num(aim.pitch, 0) / AIM_MAX_PITCH, -1, 1);
    const mvX = clamp(num(inp.moveX, 0), -1, 1), mvY = clamp(num(inp.moveY, 0), -1, 1), mvZ = clamp(num(inp.moveZ, 0), -1, 1);
    const tStickP = aimPn * 18 * DEG;
    const tStickR = -aimYn * 13 * DEG;
    const tStickY = -aimYn * 12 * DEG;
    stickP += (tStickP - stickP) * k(14); stickR += (tStickR - stickR) * k(14); stickY += (tStickY - stickY) * k(14);
    const stress = saturate(num(p.stress, 0));
    const tremor = stress * 0.012 * (hash1(Math.floor(time * 18)) - 0.5);
    pitchG.rotation.x = stickP + tremor; rollG.rotation.z = stickR - clamp(num(inp.roll, 0), -1, 1) * 0.28; twistG.rotation.y = stickY;
    const t01 = (mvZ + 1) / 2;
    thr += ((15 - 50 * t01) * DEG - thr) * k(12);
    leverG.rotation.x = thr;
    const tTrig = inp.triggerFull ? 0.55 : inp.triggerHalf ? 0.25 : 0;
    trig += (tTrig - trig) * k(25);
    trigger.rotation.x = trig;
    pedL += (25 * DEG * saturate(Math.abs(mvX) + Math.max(0, -mvY)) - pedL) * k(18);
    pedR += (30 * DEG * saturate(Math.max(num(inp.boost, 0), Math.max(0, mvY))) - pedR) * k(18);
    padL.rotation.x = 45 * DEG - pedL;
    padR.rotation.x = 45 * DEG - pedR;
    const xfs = p.flightTransition && p.flightTransition.state;
    const wantFlight = xfs === 'toFlight' || (xfs !== 'toHover' && p.flightMode === 'minovsky');
    toggleRot += ((wantFlight ? -0.55 : 0.55) - toggleRot) * k(9);          // swings over when the transform starts
    toggle.rotation.x = toggleRot;
    tense = Math.max(0, tense - dt * 5);
    rattle = Math.max(0, rattle - dt * 7);
    const hs = 1 - 0.07 * Math.max(tense, trig * 1.2);
    handR.scale.set(hs, hs, hs); handL.scale.setScalar(1 - 0.03 * Math.abs(t01 - 0.5));
    consoles.position.set(
      (hash1(Math.floor(time * 60) * 1.3) - 0.5) * 0.004 * rattle,
      (hash1(Math.floor(time * 60) * 2.7) - 0.5) * 0.004 * rattle,
      (hash1(Math.floor(time * 60) * 3.9) - 0.5) * 0.003 * rattle,
    );

    // hatch lever: pulled while ejectHold is held
    if (phase === 'ejected') leverPull = 1;
    else if (inp.ejectHold) leverPull = Math.min(1, leverPull + dt / 1.5);
    else leverPull = Math.max(0, leverPull - dt / 0.7);
    vis.leverPull = leverPull;
    hatchLever.rotation.x = -0.1 + Math.pow(leverPull, 1.4) * 1.25;

    // harness clamps close during stage 1
    let targetClose = phase !== 'startup' ? 1 : stage <= 0 ? 0 : stage === 1 ? prog : 1;
    closeK += (targetClose - closeK) * k(10);
    if (!(dt > 0)) closeK = targetClose;
    const open = 65 * DEG * (1 - smoothstep(0, 1, closeK));
    clampKick = Math.max(0, clampKick - dt * 5);
    for (const c of clamps) c.rotation.x = open + 0.18 * clampKick * Math.sin(clampKick * 9);   // one clamp thunk, camera untouched

    // hatch door blow-off
    if (blowT >= 0) {
      blowT += dt;
      hatchDoor.position.y = 6 * blowT * blowT;
      hatchDoor.rotation.x = blowT * 3;
      hatchDoor.visible = blowT < 0.6;
    }

    // ---- forearms ----
    seatPivot.updateMatrixWorld(true);
    function fore(mesh, wr, elbow) {
      wr.getWorldPosition(wrist);
      seat.worldToLocal(wrist);
      mid.copy(wrist).add(elbow).multiplyScalar(0.5);
      dir.copy(elbow).sub(wrist);
      const len = Math.max(0.05, dir.length());
      dir.multiplyScalar(1 / len);
      mesh.position.copy(mid);
      mesh.scale.set(1, 1, len);
      mesh.quaternion.setFromUnitVectors(ZAX, dir);
    }
    fore(foreR, wristR, elbowR);
    fore(foreL, wristL, elbowL);

    // ---- lighting ----
    let L = stage <= 0 ? 0 : stage === 1 ? 0.06 : stage === 2 ? 0.14 + 0.3 * prog : stage === 3 ? 0.45 + 0.55 * prog : 1;
    if (phase === 'disabled') L = 0.55 + 0.1 * Math.sin(time * 3.7);
    if (phase === 'respawn') L = 0.3 + 0.06 * Math.sin(time * 3.1);
    lightK = dt > 0 ? damp(lightK, L, 8, dt) : L;
    const em = ctx.emergency ? 1 : 0;
    emergK = dt > 0 ? damp(emergK, em, 6, dt) : em;
    vis.emergency = emergK;
    vis.lightLevel = lightK;
    const strobe = 0.5 + 0.5 * Math.sin(time * 7.5);
    const alt = 0.5 + 0.5 * Math.sin(time * 2.2);

    qInv.copy(state.player && state.player.quaternion ? state.player.quaternion : tmp.q1.identity()).invert();
    upC.set(0, 1, 0).applyQuaternion(qInv);
    const sd = state.world && isVec(state.world.sunDir) ? state.world.sunDir : { x: -0.6, y: 0.12, z: -0.78 };
    sunC.set(sd.x, sd.y, sd.z).applyQuaternion(qInv).normalize();
    hemi.position.copy(upC);
    sunL.position.copy(sunC).multiplyScalar(2);

    // ambient bounce sampled from the outside: blue sky over dark teal sea, dusk orange from the sun side
    skyCol.setRGB(0.10, 0.16, 0.38);
    gndCol.setRGB(0.05, 0.11, 0.115);
    const sens = p.sensors || {};
    if (sens.mode === 'night') { skyCol.lerp(tmpC.setRGB(0.05, 0.4, 0.12), 0.5); gndCol.lerp(tmpC.setRGB(0.02, 0.15, 0.05), 0.5); }
    else if (sens.mode === 'thermal') { skyCol.lerp(tmpC.setRGB(0.4, 0.14, 0.03), 0.5); gndCol.lerp(tmpC.setRGB(0.12, 0.04, 0.01), 0.5); }
    if (stage === 2) { skyCol.lerp(tmpC.setRGB(0.0, 0.45, 0.55), 0.7); }
    hemi.color.copy(skyCol).lerp(tmpC.setRGB(1.0, 0.12, 0.04), emergK * 0.45 * strobe);
    hemi.groundColor.copy(gndCol);
    // pack damage: the cabin lamps flicker (parts plan sec 3)
    const pk = p.parts && p.parts.pack ? p.parts.pack.status : 'ok';
    let lamp = 1;
    if (pk === 'damaged') lamp = hash1(Math.floor(time * 9) + 2) > 0.82 ? 0.4 : 1;
    else if (pk === 'destroyed') lamp = hash1(Math.floor(time * 14) + 5) > 0.55 ? 0.28 : 0.9;
    hemi.intensity = 2.6 * lightK * lamp;
    sunL.color.setRGB(1.0, 0.55, 0.28);
    sunL.intensity = 2.4 * lightK * lamp * smoothstep(-0.3, 0.2, sunC.y + 0.4);
    amb.intensity = 0.95 * lightK * lamp;
    rearL.intensity = 1.1 * lightK * lamp;
    emerg.color.setRGB(1.0, 0.1 + 0.3 * alt, 0.03);
    emerg.intensity = 1.6 * emergK * (0.15 + 0.85 * strobe);

    // beam flashes: green on our own shot (a few frames), pink when an enemy heavy shot passes
    greenK = Math.max(0, greenK - dt * 9);
    pinkK = Math.max(pinkK - dt * 4, num(ctx.pink, 0));
    if (pinkK >= greenK) flashL.color.setRGB(1.0, 0.25, 0.6); else flashL.color.setRGB(0.24, 1.0, 0.48);
    flashL.intensity = 2.4 * Math.max(greenK * greenK, pinkK * 0.8) * Math.max(0.35, lightK);

    // tritium / LEDs
    const tFlick = 1 + 0.08 * (hash1(Math.floor(time * 11)) - 0.5);
    matTritium.color.setScalar((stage === 0 ? 0.62 : 0.42) * tFlick);
    ledBlink = Math.max(0, ledBlink - dt);
    flareBlink = Math.max(0, flareBlink - dt);
    const ledTarget = stage <= 1 ? 0.0 : stage === 2 ? 0.45 : 1;
    ledK = dt > 0 ? damp(ledK, ledTarget, 6, dt) : ledTarget;
    let ledV = ledK * (0.85 + 0.15 * (ledBlink > 0 ? 0 : 1));
    if (emergK > 0.1) ledV = Math.max(ledV, emergK * strobe * 1.3);
    matLeds.color.setScalar(ledV * 0.9 * (pk === 'ok' ? 1 : lamp));
    // teal accent strips + rim light: dark at stage 0, come up with the systems, red in emergencies
    const tealV = (stage <= 0 ? 0.05 : stage === 1 ? 0.25 : stage === 2 ? 0.55 : 0.85) * (pk === 'ok' ? 1 : lamp);
    matTeal.color.setRGB(1, 1, 1).lerp(tmpC.setRGB(1.0, 0.1, 0.06), emergK * strobe).multiplyScalar(tealV);
    rimU.value.setRGB(0.10, 0.34, 0.40).lerp(tmpC.setRGB(0.6, 0.06, 0.03), emergK * 0.8).multiplyScalar(0.22 * lightK);

    // sparks: integrate, age, fade the wall light
    {
      const ageA = spkGeo.attributes.aAge;
      for (let i = 0; i < SPK_N; i++) {
        if (spk.age[i] >= 1) { ageA.array[i] = 1; continue; }
        spk.age[i] += dt / spk.life[i];
        spk.pos[i * 3] += spk.vel[i * 3] * dt; spk.pos[i * 3 + 1] += spk.vel[i * 3 + 1] * dt; spk.pos[i * 3 + 2] += spk.vel[i * 3 + 2] * dt;
        ageA.array[i] = Math.min(1, spk.age[i]);
      }
      spkGeo.attributes.position.needsUpdate = true; ageA.needsUpdate = true;
      sparkLK = Math.max(0, sparkLK - dt * 6);
      sparkL.intensity = 2.2 * sparkLK * sparkLK;
    }

    // sub-monitors: dark until the panoramic link (stage 3) comes up
    let power = stage <= 2 ? 0 : stage === 3 ? prog : 1;
    if (phase === 'disabled') power = 0.35 + 0.4 * hash1(Math.floor(time * 9));
    if (phase === 'respawn') power = 0.15 + 0.2 * hash1(Math.floor(time * 7));
    if (phase === 'ejected') power = 0;
    subs.update(dt, { time, power: power * (pk === 'ok' || power <= 0 ? 1 : 0.55 + 0.45 * lamp), stage });
  }

  return { scene, camera, hudRoot, update, onEvent, vis };
}
