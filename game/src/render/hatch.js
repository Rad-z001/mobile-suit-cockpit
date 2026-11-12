// CR-004: the cockpit hatch, seen from the pilot's seat (render only: reads state.player.hatch, never writes).
//   - a white ribbed TUNNEL (one merged mesh, one draw call) that extends forward from the front of the shell as the
//     doors part, driven by hatch.open (smoothed here with a critically damped spring on top of the sim's easing);
//   - a black "bulkhead" panel with a rectangular hole (the doors): while the hatch is open the front of the panoramic
//     view is masked, so the world is visible only through the far opening of the tunnel (plus the side monitors);
//   - at cold start (phase 'startup') the cargo container interior beyond the tunnel, dimly lit (one more draw call).
// Everything lives in the COCKPIT scene, which is drawn after the monitor pass, so monitor effects never paint over it.
// The orange H-frames and HATCH UNLOCK / LOCK tabs are drawn by hud.js from `anim` (the smoothed values published here).
import * as THREE from 'three';
import { part, B, merge } from './models.js';
import { Spring, clamp, damp, saturate, smoothstep, num } from './util.js';

// geometry of the tunnel in cockpit space (metres). Mouth plane z = -Z0; extends to -(Z0 + LEN).
export const TUNNEL = { Z0: 1.2, LEN: 2.4, HW: 0.53, HH: 0.95 };

export function createHatch(scene, state) {
  const { Z0, LEN, HW, HH } = TUNNEL;
  const anim = {
    frame: 0,        // 0..1 orange H-frames slid in
    door: 0,         // 0..1 doors apart (spring on hatch.open)
    length: 0,       // 0..1 tunnel length
    dock: 0,         // 0..1 frames shrink to the docked look once the hatch has been open a while
    tab: 0,          // 0..1 HATCH UNLOCK / LOCK tab text alpha
    label: 'UNLOCK', // 'UNLOCK' | 'LOCK'
    dim: 0,          // 0..1 how much the rest of the HUD dims
    wind: 0,         // 0..1 buffeting (hatchWind events)
    active: false,   // anything of the hatch is on screen
    curve: 0,        // concave edge depth (m at the mouth plane)
    open: false,     // doors are open enough that the tunnel is the front view
  };
  const group = new THREE.Group();
  scene.add(group);

  // ---- tunnel (local z 0 .. -LEN, scaled along z by the open amount) ---------------------------------------------------
  const P = [];
  // plain light floor + ceiling (the shader adds the near-to-far gradient), louvred side walls (slats are made in the
  // fragment shader), a grey mid-rail with T-brackets at horizon height, a pale rim at the mouth. One merged mesh.
  const WALL = 0xeeebe2, FLOOR = 0xd2cec3, CEIL = 0xdedbd0, RAIL = 0x9a978c, RIM = 0xd4d1c7;
  P.push(part(B(2 * HW + 0.04, 0.03, LEN), FLOOR, 0, -HH - 0.015, -LEN / 2));
  P.push(part(B(2 * HW + 0.04, 0.03, LEN), CEIL, 0, HH + 0.015, -LEN / 2));
  P.push(part(B(0.03, 2 * HH, LEN), WALL, -HW - 0.015, 0, -LEN / 2));
  P.push(part(B(0.03, 2 * HH, LEN), WALL, HW + 0.015, 0, -LEN / 2));
  for (const sx of [-1, 1]) {
    P.push(part(B(0.035, 0.06, LEN), RAIL, sx * (HW - 0.018), 0.0, -LEN / 2));
    for (let i = 0; i < 4; i++) P.push(part(B(0.06, 0.16, 0.05), 0xb4b1a6, sx * (HW - 0.03), 0, -(0.25 + i * 0.6)));
    P.push(part(B(0.05, 2 * HH, 0.05), RIM, sx * (HW - 0.025), 0, -0.025));
  }
  P.push(part(B(2 * HW, 0.06, 0.05), RIM, 0, HH - 0.03, -0.025), part(B(2 * HW, 0.06, 0.05), RIM, 0, -HH + 0.03, -0.025));
    const holeU = { value: new THREE.Vector2(0.012, HH) };
  const curveU = { value: 0 };                                    // concave (barrel) left/right door edges, metres at the mouth plane           // door hole (half extents on the mouth plane); clips the tunnel + container
  const tunnelU = { uLit: { value: 1 }, uLen: { value: LEN }, uDepth: { value: 0.6 }, uHole: holeU, uCurve: curveU };
  const VS = `attribute vec3 color; varying vec3 vC; varying float vK; varying vec3 vW, vO; uniform float uLen;
    void main(){ vC = color; vO = position; vK = -position.z / uLen; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
  // the hole clip: the viewing ray must cross the mouth plane (z = -Z0) inside the door hole, so nothing behind the doors leaks out
  const FS = `varying vec3 vC; varying float vK; varying vec3 vW, vO; uniform float uLit, uDepth, uCurve; uniform vec2 uHole;
    void main(){
      vec3 d = vW - cameraPosition;
      float t = (-${Z0.toFixed(3)} - cameraPosition.z) / d.z;
      vec2 p = cameraPosition.xy + t * d.xy;
      float hx = uHole.x - uCurve * (1.0 - (p.y * p.y) / (uHole.y * uHole.y));
      if (t > 0.0 && (abs(p.x) > hx + 0.002 || abs(p.y) > uHole.y + 0.002)) discard;
      vec3 base = vC;
      if (abs(abs(vO.x) - ${HW.toFixed(3)}) < 0.003 && abs(vO.y) < ${(HH - 0.07).toFixed(3)} && uDepth > 0.0) {
        float f = fract(-vO.z / 0.34);
        float slat = smoothstep(0.0, 0.16, f) * (1.0 - smoothstep(0.84, 0.97, f));
        float rail = 1.0 - smoothstep(0.03, 0.05, abs(vO.y));
        base = mix(vec3(0.46, 0.45, 0.43), vC, mix(slat, 1.0, rail));
        base *= 0.93 + 0.07 * f;
        base *= 0.9 + 0.1 * smoothstep(-${HH.toFixed(2)}, ${HH.toFixed(2)}, vO.y);
      }
      vec3 c = base * uLit * (1.0 - uDepth * vK);
      gl_FragColor = vec4(c, 1.0);
#include <colorspace_fragment>
    }`;
  const tunnelMat = new THREE.ShaderMaterial({ uniforms: tunnelU, vertexShader: VS, fragmentShader: FS });
  const tunnel = new THREE.Mesh(merge(P), tunnelMat);
  tunnel.frustumCulled = false;
  tunnel.position.z = -Z0;
  group.add(tunnel);

  // ---- doors / mask panel ---------------------------------------------------------------------------------------------
  const PHW = 1.0, PHH = 1.18;
  const maskU = { uHole: holeU, uAlpha: { value: 0 }, uCurve: curveU };
  const mask = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * PHW, 2 * PHH),
    new THREE.ShaderMaterial({
      uniforms: { ...maskU, uPH: { value: new THREE.Vector2(PHW, PHH) } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        varying vec2 vP; uniform vec2 uHole, uPH; uniform float uAlpha, uCurve;
        void main(){
          float hx = uHole.x - uCurve * (1.0 - (vP.y * vP.y) / (uHole.y * uHole.y));
          float d = max(abs(vP.x) - hx, abs(vP.y) - uHole.y);
          if (d < 0.0) discard;
          vec3 c = mix(vec3(0.74, 0.73, 0.70), vec3(0.012, 0.013, 0.018), smoothstep(0.014, 0.075, d));
          c = mix(c, vec3(0.92), (1.0 - smoothstep(0.0, 0.014, d)) * 0.5);
          
          float e = max(abs(vP.x) / uPH.x, abs(vP.y) / uPH.y);
          gl_FragColor = vec4(c, uAlpha * (1.0 - smoothstep(0.7, 1.0, e)));
        }`,
      transparent: true, depthWrite: false,
    }),
  );
  mask.position.z = -Z0;
  mask.renderOrder = 5;
  mask.frustumCulled = false;
  maskU.uAlpha = mask.material.uniforms.uAlpha;
  group.add(mask);

  // ---- cargo container interior (cold start): ribbed dim box beyond the far end ------------------------------------------
  const C = [];
  const CW = 1.5, CH = 1.45, CZ0 = Z0 + LEN, CL = 6.5;
  const cz = -(CZ0 + CL / 2);
  const CWALL = 0x2c3540, CFLOOR = 0x1d242c, CCEIL = 0x252d36, CRIB = 0x3a4654;
  C.push(part(B(2 * CW, 0.05, CL), CFLOOR, 0, -CH, cz), part(B(2 * CW, 0.05, CL), CCEIL, 0, CH, cz));
  C.push(part(B(0.05, 2 * CH, CL), CWALL, -CW, 0, cz), part(B(0.05, 2 * CH, CL), CWALL, CW, 0, cz));
  C.push(part(B(2 * CW, 2 * CH, 0.05), CWALL, 0, 0, -(CZ0 + CL)));
  for (let i = 0; i < 13; i++) {
    const z = -(CZ0 + 0.3 + i * 0.5);
    C.push(part(B(0.08, 2 * CH, 0.07), CRIB, -CW + 0.04, 0, z), part(B(0.08, 2 * CH, 0.07), CRIB, CW - 0.04, 0, z));
    C.push(part(B(2 * CW, 0.08, 0.07), CRIB, 0, CH - 0.04, z));
  }
  // crates against the far wall, a hanging lamp and a floor stripe
  C.push(part(B(0.9, 0.8, 0.8), 0x3b3a30, -0.7, -CH + 0.4, -(CZ0 + CL - 0.6)), part(B(0.7, 0.5, 0.7), 0x30363e, 0.55, -CH + 0.25, -(CZ0 + CL - 0.6)));
  C.push(part(B(0.5, 0.5, 0.5), 0x4a3b28, 0.1, -CH + 0.75, -(CZ0 + CL - 0.7)));
  C.push(part(B(0.4, 0.02, CL - 0.4), 0x5c5130, 0, -CH + 0.03, cz));
  C.push(part(B(0.6, 0.05, 0.12), 0xffd89a, 0, CH - 0.07, -(CZ0 + 2.6)), part(B(0.6, 0.05, 0.12), 0xffd89a, 0, CH - 0.07, -(CZ0 + 5.2)));
  const contU = { uLit: { value: 1 }, uLen: { value: 1 }, uDepth: { value: 0 }, uHole: holeU, uCurve: curveU };
  const contMat = new THREE.ShaderMaterial({ uniforms: contU, vertexShader: VS, fragmentShader: FS });
  const container = new THREE.Mesh(merge(C), contMat);
  container.frustumCulled = false;
  container.renderOrder = 3;
  group.add(container);

  // ---- CR-010 story: the REAL cargo bay beyond the tunnel (the same geometry the monitors show once they are on) ----------
  // Cockpit space and the bay model share their origin (the Xi's cockpit point), axes and scale. The copy is drawn at
  // BAY_SCALE about that origin, which leaves the picture unchanged from the seat but brings it inside the cockpit
  // camera's far plane and keeps it beyond the tunnel's far end.
  const BAY_SCALE = 0.45;
  const bayU = { uLit: { value: 1 }, uLen: { value: 1 }, uDepth: { value: 0 }, uHole: holeU, uCurve: curveU };
  const bayMat = new THREE.ShaderMaterial({ uniforms: bayU, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide });
  const bay = new THREE.Group();
  bay.scale.setScalar(BAY_SCALE); bay.visible = false;
  group.add(bay);
  function setBay(geometries) {
    for (const g of geometries || []) { const m = new THREE.Mesh(g, bayMat); m.frustumCulled = false; m.renderOrder = 3; bay.add(m); }
  }

  const lenSpring = new Spring(11, 1), doorSpring = new Spring(13, 1), frameSpring = new Spring(5.5, 1);
  let first = true, openFor = 0, windT = 0, lastState = 'closed';

  function onEvent(e) {
    if (e.type === 'hatchWind') windT = 0.3;
  }

  function update(dt, ctx) {
    const h = (state.player && state.player.hatch) || null;
    const st = h ? h.state : 'closed';
    const o = h ? saturate(num(h.open, st === 'open' ? 1 : 0)) : 0;
    const phase = state.phase;
    const k = dt > 0 ? dt : 0.016;
    const eased = o * o * (3 - 2 * o);
    const frameT = st === 'closed' ? 0 : 1;
    if (first) {
      lenSpring.x = doorSpring.x = eased; frameSpring.x = frameT; first = false;
      lastState = st;
    }
    doorSpring.step(smoothstep(0, 0.62, o), k);
    lenSpring.step(smoothstep(0.08, 1, o), k);
    frameSpring.step(frameT, k);
    const door = clamp(doorSpring.x, 0, 1), len = clamp(lenSpring.x, 0, 1);
    anim.door = door; anim.length = len; anim.frame = clamp(frameSpring.x, 0, 1);
    if (st === 'unlocking' || st === 'opening') anim.label = 'UNLOCK'; else if (st === 'closing') anim.label = 'LOCK';
    if (st === 'open') openFor += k; else openFor = 0;
    anim.dock = damp(anim.dock, st === 'open' && openFor > 1.4 ? 1 : 0, 2.2, k);
    anim.tab = damp(anim.tab, st !== 'closed' ? 1 : 0, st === 'closed' ? 6 : 3, k);
    anim.dim = anim.frame * (0.5 + 0.12 * (1 - anim.dock));
    windT = Math.max(0, windT - k);
    anim.wind = damp(anim.wind, windT > 0 ? 1 : 0, 6, k);
    anim.active = anim.frame > 0.01 || door > 0.01;
    anim.open = door > 0.05;
    lastState = st;

    // 3D -----------------------------------------------------------------------------------------------------------------
    group.visible = door > 0.004;
    if (!group.visible) return;
    const startup = phase === 'startup';
    tunnel.scale.z = 0.2 + 0.8 * len;                       // never collapses: the doors close over a short stub, so the reverse of the opening is exact
    tunnel.visible = true;
    maskU.uHole.value.set(Math.max(0.012, HW * door), HH);
    curveU.value = 0.085 * smoothstep(0.05, 0.5, door);
    anim.curve = curveU.value;
    maskU.uAlpha.value = smoothstep(0.0, 0.3, door);
    // story cold start: the pilot sits in the Xi inside the cargo, so the hatch looks out on the cargo bay, not the crate room
    const story = !!(state.story && state.story.chapter === 1 && state.story.stage === 'cockpit') && bay.children.length > 0;
    container.visible = startup && door > 0.004 && !story;
    if (container.visible) { const f = smoothstep(0.004, 0.3, door); contU.uLit.value = f; }
    bay.visible = startup && door > 0.004 && story;
    if (bay.visible) bayU.uLit.value = smoothstep(0.004, 0.3, door);
    tunnelU.uLit.value = startup ? 0.85 : 0.9;
    const w = anim.wind;
    group.position.set(w * 0.004 * Math.sin(ctx.time * 61), w * 0.004 * Math.sin(ctx.time * 53 + 1.3), 0);
  }

  return { group, anim, update, onEvent, setBay, uniforms: { hole: holeU, curve: curveU } };
}
