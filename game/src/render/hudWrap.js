// CR-004: the panoramic HUD wraps the WHOLE cockpit sphere (video t06: looking left, the horizon keeps running across).
// The forward HUD stays on the 2048x1152 canvas (hud.js). This module adds, as static 3D line geometry at the HUD sphere radius:
//   world-fixed group (rotated by the inverse of the suit's attitude each frame, nothing is rebuilt):
//     - 360 deg horizon: the video's thin double line, 5/10/30 deg heading ticks, hex pips, heading labels (N/E/S/W yellow)
//       -- faded where the canvas horizon already draws (within ~80 deg of the heading), so there are never two lines
//     - pitch rungs (+-10/20/30/45/60) all the way round, numbers every 90 deg, zenith + nadir markers
//   cockpit-fixed group: faint barrel ladders (tick columns) at +-90 deg and behind
// Labels are ONE Points draw with a small atlas texture uploaded once. Total: 3 draw calls, zero per-frame uploads.
// Panoramic-monitor rules: dead sectors fade/flicker the lines inside them; while the hatch is open the lines are discarded
// inside the tunnel mouth (same ray test as hatch.js) so they never paint over the tunnel.
import * as THREE from 'three';
import { clamp, saturate, num, DEG } from './util.js';
import { TUNNEL } from './hatch.js';

const R = 1.04;
const WHITE = [1, 1, 1], YEL = [1, 0.62, 0.1], PALE = [0.86, 0.9, 0.97];

const VS = /* glsl */ `
  attribute vec3 aCol; attribute float aAlpha; attribute float aFade; attribute float aAz;
  #ifdef RIBBON
  attribute vec3 iA; attribute vec3 iB; attribute vec2 aQuad; attribute float aW;
  uniform vec2 uRes; uniform float uScale;
  #endif
  varying vec3 vCol; varying float vA; varying vec3 vW;
  uniform float uHeading, uPower, uTime;
  uniform float uSect[8];
  float h11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
  void main(){
    #ifdef RIBBON
    vec4 wa = modelMatrix * vec4(iA, 1.0), wb = modelMatrix * vec4(iB, 1.0);
    vec4 w = mix(wa, wb, aQuad.x);
    #else
    vec4 w = modelMatrix * vec4(position, 1.0);
    #endif
    vW = w.xyz;
    float d = abs(mod(aAz - uHeading + 3.14159265, 6.2831853) - 3.14159265);
    float front = mix(1.0, smoothstep(1.40, 1.62, d), aFade);                 // the canvas horizon owns +-80 deg of the heading
    float lon = atan(w.x, -w.z);
    float secF = mod(lon + 0.3926991 + 6.2831853, 6.2831853) / 0.7853982;
    int si = int(min(floor(secF), 7.0));
    float hl = uSect[si];
    float dead = hl > 0.65 ? 1.0 : (hl * 0.5 + 0.1) * step(0.45, h11(floor(uTime * 13.0) + float(si) * 7.3));
    vCol = aCol; vA = aAlpha * front * uPower * dead;
    #ifdef RIBBON
    // screen-space-width ribbon: both ends projected, the quad expanded perpendicular to the segment (width in device px)
    vec4 ca = projectionMatrix * viewMatrix * wa, cb = projectionMatrix * viewMatrix * wb;
    if (ca.w < 0.03 || cb.w < 0.03) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec2 sa = ca.xy / ca.w * uRes * 0.5, sb = cb.xy / cb.w * uRes * 0.5;
    vec2 dir = sb - sa; float l = length(dir); dir = l > 1e-4 ? dir / l : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float wpx = max(1.15, aW * uScale);
    vec4 c = mix(ca, cb, aQuad.x);
    vec2 off = (nrm * aQuad.y * wpx * 0.5 + dir * (aQuad.x * 2.0 - 1.0) * wpx * 0.5) / (uRes * 0.5);
    gl_Position = vec4(c.xy + off * c.w, c.z, c.w);
    #else
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_PointSize = 1.0;
    #endif
  }`;
const FS = /* glsl */ `
  varying vec3 vCol; varying float vA; varying vec3 vW;
  uniform float uMask, uCurve; uniform vec2 uHole;
  void main(){
    if (vA < 0.004) discard;
    if (uMask > 0.5) {
      vec3 d = vW - cameraPosition;
      float t = (-${TUNNEL.Z0.toFixed(3)} - cameraPosition.z) / d.z;
      vec2 p = cameraPosition.xy + t * d.xy;
      float hx = uHole.x - uCurve * (1.0 - (p.y * p.y) / (uHole.y * uHole.y));
      if (t > 0.0 && abs(p.x) < hx && abs(p.y) < uHole.y) discard;
    }
    gl_FragColor = vec4(vCol, vA);
    #include <colorspace_fragment>
  }`;

export function createHudWrap(scene, state, hatch) {
  const U = {
    uHeading: { value: 0 }, uPower: { value: 0 }, uTime: { value: 0 },
    uSect: { value: [1, 1, 1, 1, 1, 1, 1, 1] },
    uMask: { value: 0 }, uCurve: hatch.uniforms.curve, uHole: hatch.uniforms.hole,
    uRes: { value: new THREE.Vector2(1280, 720) }, uScale: { value: 0.49 },
  };
  const dirv = (az, el, r = R) => [r * Math.cos(el) * Math.sin(az), r * Math.sin(el), -r * Math.cos(el) * Math.cos(az)];
  const azOf = (p) => Math.atan2(p[0], -p[2]);

  // ---- line builder ----------------------------------------------------------------------------------------------------
  function lineBuffer() {
    const A = [], B = [], col = [], al = [], fade = [], az = [], wd = [];
    return {
      // w = line width in HUD-canvas pixels (the forward canvas horizon is 3.2 / 2.2), converted to device px in the shader
      seg(a, b, c, alpha, f, w = 2) { A.push(...a); B.push(...b); col.push(...c); al.push(alpha); fade.push(f); az.push(azOf(a)); wd.push(w); },
      mesh() {
        const g = new THREE.InstancedBufferGeometry();
        g.setAttribute('aQuad', new THREE.Float32BufferAttribute([0, -1, 0, 1, 1, -1, 1, 1], 2));
        g.setIndex([0, 1, 2, 2, 1, 3]);
        const inst = (name, arr, n) => g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(arr), n));
        inst('iA', A, 3); inst('iB', B, 3); inst('aCol', col, 3); inst('aAlpha', al, 1); inst('aFade', fade, 1); inst('aAz', az, 1); inst('aW', wd, 1);
        g.instanceCount = al.length;
        const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
          uniforms: U, vertexShader: VS, fragmentShader: FS, defines: { RIBBON: '' }, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }));
        m.frustumCulled = false; m.renderOrder = 18;
        return m;
      },
    };
  }

  // ---- world-fixed lines ---------------------------------------------------------------------------------------------------
  const W = lineBuffer();
  const circle = (el, a, c, f, w) => { for (let i = 0; i < 360; i++) W.seg(dirv(i * DEG, el * DEG), dirv((i + 1) * DEG, el * DEG), c, a, f, w); };
  circle(0, 0.95, WHITE, 1, 3.2);                // same weight as the forward canvas horizon (3.2 / 2.2 canvas px)
  circle(-1.0, 0.6, PALE, 1, 2.2);
  for (let h = 0; h < 360; h += 5) {                                         // heading ticks
    const L = h % 30 === 0 ? 2.2 : h % 10 === 0 ? 1.3 : 0.7;
    W.seg(dirv(h * DEG, 0), dirv(h * DEG, L * DEG), h % 90 === 0 ? YEL : WHITE, h % 30 === 0 ? 0.95 : 0.65, 1, h % 30 === 0 ? 2.4 : 1.8);
  }
  const hex = (az, el, rr, c, a) => {                                         // small hex pip on the ring (angular radius rr deg)
    const P = [];
    for (let i = 0; i < 6; i++) { const t = (i / 6) * 6.2832; P.push(dirv((az + Math.cos(t) * rr * 1.15) * DEG, (el + Math.sin(t) * rr) * DEG)); }
    for (let i = 0; i < 6; i++) W.seg(P[i], P[(i + 1) % 6], c, a, 1, 2.0);
  };
  for (let h = 15; h < 360; h += 30) hex(h, -0.5, 1.5, PALE, 0.7);
  // pitch rungs: short faint dashes all the way round (constant arc length)
  const RUNGS = [10, 20, 30, 45, 60];
  for (const sgn of [1, -1]) for (const ph of RUNGS) {
    const el = sgn * ph, span = 3.2 / Math.cos(el * DEG);
    for (let a = 0; a < 360; a += 15) W.seg(dirv((a - span / 2) * DEG, el * DEG), dirv((a + span / 2) * DEG, el * DEG), WHITE, ph === 30 || ph === 60 ? 0.5 : 0.38, 1, 2.0);
    for (let a = 0; a < 360; a += 90) {                                         // little end caps toward the horizon at the labelled azimuths
      const s0 = dirv((a - span / 2) * DEG, el * DEG), s1 = dirv((a - span / 2) * DEG, (el - sgn * 1.2) * DEG);
      W.seg(s0, s1, WHITE, 0.45, 1, 2.0);
    }
  }
  // zenith / nadir: ring + cross
  for (const el of [90, -90]) {
    const sgn = Math.sign(el);
    for (let i = 0; i < 32; i++) {
      const t0 = (i / 32) * 6.2832, t1 = ((i + 1) / 32) * 6.2832, e = (90 - 4.5) * sgn;
      W.seg(dirv(t0, e * DEG), dirv(t1, e * DEG), YEL, 0.85, 0, 2.6);
    }
    for (let k = 0; k < 4; k++) W.seg(dirv(k * Math.PI / 2, (90 - 1.2) * sgn * DEG), dirv(k * Math.PI / 2, (90 - 7.5) * sgn * DEG), YEL, 0.85, 0, 2.6);
  }
  const world = new THREE.Group();
  world.add(W.mesh());
  scene.add(world);

  // ---- cockpit-fixed peripheral barrel ladders ---------------------------------------------------------------------------------
  const F = lineBuffer();
  for (const yaw of [90, -90, 180, 135, -135]) {
    const dim = Math.abs(yaw) === 90 || yaw === 180 ? 1 : 0.55;
    const sg = yaw < 0 ? -1 : 1;
    const Y = (el) => (yaw + sg * 7 * Math.pow(el / 55, 2)) * DEG;
    for (let el = -54; el < 54; el += 3) F.seg(dirv(Y(el), el * DEG), dirv(Y(el + 3), (el + 3) * DEG), WHITE, 0.26 * dim, 0, 1.6);
    for (let el = -54; el <= 54; el += 2) {
      const L = el % 30 === 0 ? 2.6 : el % 10 === 0 ? 1.7 : 0.9;
      F.seg(dirv(Y(el), el * DEG), dirv(Y(el) + sg * L * DEG, el * DEG), WHITE, (el % 10 === 0 ? 0.5 : 0.32) * dim, 0, 1.7);
    }
    F.seg(dirv(Y(0) - sg * 1.0 * DEG, 0), dirv(Y(0) + sg * 4.5 * DEG, 0), YEL, 0.5 * dim, 0, 2.0);
  }
  const fixed = F.mesh();
  scene.add(fixed);

  // ---- labels: one Points draw + a 512x256 atlas (8x4 cells of 64 px), uploaded once --------------------------------------------
  const cells = [];
  for (let h = 0; h < 360; h += 30) cells.push(h === 0 ? 'N' : h === 90 ? 'E' : h === 180 ? 'S' : h === 270 ? 'W' : String(h).padStart(3, '0'));
  const NUMS = ['10', '20', '30', '45', '60'];
  const atlas = document.createElement('canvas');
  atlas.width = 512; atlas.height = 256;
  {
    const g = atlas.getContext('2d');
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    cells.concat(NUMS).forEach((s, i) => {
      g.font = `${s.length === 1 ? 600 : 400} ${s.length === 1 ? 40 : 30}px "Roboto Mono", Consolas, monospace`;
      g.fillText(s, (i % 8) * 64 + 32, Math.floor(i / 8) * 64 + 34);
    });
  }
  const tex = new THREE.CanvasTexture(atlas);
  tex.generateMipmaps = false; tex.minFilter = tex.magFilter = THREE.LinearFilter;
  const lp = [], lc = [], lcol = [], lal = [], laz = [];
  const label = (az, el, cell, col, alpha, fadeFront) => {
    const p = dirv(az * DEG, el * DEG);
    lp.push(...p); lc.push(cell); lcol.push(...col); lal.push(alpha); laz.push(fadeFront ? azOf(p) : 99);
  };
  for (let i = 0; i < 12; i++) label(i * 30, 4.0, i, i % 3 === 0 ? YEL : WHITE, i % 3 === 0 ? 0.95 : 0.7, true);
  for (let a = 0; a < 360; a += 90) for (const sgn of [1, -1]) NUMS.forEach((n, k) => label(a + 4.5, sgn * RUNGS[k] + sgn * 1.6, 12 + k, WHITE, 0.55, true));
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  pg.setAttribute('aCell', new THREE.Float32BufferAttribute(lc, 1));
  pg.setAttribute('aCol', new THREE.Float32BufferAttribute(lcol, 3));
  pg.setAttribute('aAlpha', new THREE.Float32BufferAttribute(lal, 1));
  pg.setAttribute('aAz', new THREE.Float32BufferAttribute(laz, 1));
  const PU = { ...U, tAtlas: { value: tex }, uSize: { value: 46 } };
  const pointMat = new THREE.ShaderMaterial({
    uniforms: PU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: VS.replace('attribute float aAz;', 'attribute float aAz; attribute float aCell; varying float vCell; uniform float uSize;')
      .replace('gl_PointSize = 1.0;', 'gl_PointSize = uSize; vCell = aCell;')
      .replace('float front = mix(1.0, smoothstep(1.40, 1.62, d), aFade);', 'float front = aAz > 50.0 ? 1.0 : smoothstep(1.40, 1.62, d);'),
    fragmentShader: FS.replace('varying vec3 vCol;', 'varying float vCell; uniform sampler2D tAtlas; varying vec3 vCol;')
      .replace('gl_FragColor = vec4(vCol, vA);', 'vec2 cuv = vec2(mod(vCell, 8.0) + gl_PointCoord.x, floor(vCell / 8.0) + gl_PointCoord.y); float ta = texture2D(tAtlas, vec2(cuv.x / 8.0, 1.0 - cuv.y / 4.0)).a; gl_FragColor = vec4(vCol, vA * ta);')
      .replace('if (vA < 0.004) discard;', 'if (vA < 0.004) discard;'),
  });
  const points = new THREE.Points(pg, pointMat);
  points.frustumCulled = false; points.renderOrder = 18;
  world.add(points);

  // ---- per-frame: orientation + a handful of uniforms only ------------------------------------------------------------------------
  const q = new THREE.Quaternion(), fw = new THREE.Vector3();
  let heading = 0;
  const sz = new THREE.Vector2();
  function update(dt, power, renderer) {
    if (renderer) { renderer.getDrawingBufferSize(sz); U.uRes.value.copy(sz); U.uScale.value = sz.y * 0.000682; }
    const p = state.player || {};
    if (p.quaternion && typeof p.quaternion.w === 'number') {
      q.copy(p.quaternion);
      world.quaternion.copy(q).invert();
      fw.set(0, 0, -1).applyQuaternion(q);
      if (fw.x * fw.x + fw.z * fw.z > 0.0025) heading = Math.atan2(fw.x, -fw.z);
    } else world.quaternion.identity();
    U.uHeading.value = heading;
    U.uPower.value = power;
    U.uTime.value += dt;
    const sec = p.sensors && p.sensors.sectors;
    const arr = U.uSect.value;
    for (let i = 0; i < 8; i++) arr[i] = sec ? clamp(num(sec[i], 1), 0, 1) : 1;
    U.uMask.value = hatch.anim.door > 0.05 ? 1 : 0;
    PU.uSize.value = 46 * Math.min(2, Math.max(1, window.devicePixelRatio || 1)) * 0.75;
    world.visible = fixed.visible = power > 0.01;
  }
  return { update, world, fixed, points };
}
