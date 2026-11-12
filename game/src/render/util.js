// Small math helpers shared by the render modules. No state is touched here.
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smoothstep(a, b, x) {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
// Frame-rate independent exponential smoothing.
export function damp(cur, target, rate, dt) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}
export function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
// Cheap smooth pseudo-noise in [-1,1] built from incommensurate sines.
export function wobble(t, seed = 0) {
  return (
    Math.sin(t * 1.0 + seed * 12.9) * 0.5 +
    Math.sin(t * 2.31 + seed * 78.2) * 0.3 +
    Math.sin(t * 4.77 + seed * 37.7) * 0.2
  );
}
export const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

// Second-order critically/under-damped spring, sub-stepped for stability.
export class Spring {
  constructor(omega = 12, zeta = 1) {
    this.w = omega;
    this.z = zeta;
    this.x = 0;
    this.v = 0;
  }
  step(target, dt) {
    if (!(dt > 0)) return this.x;
    const n = Math.min(12, Math.ceil(dt / 0.006));
    const h = dt / n;
    const w2 = this.w * this.w;
    const c = 2 * this.z * this.w;
    for (let i = 0; i < n; i++) {
      this.v += (-w2 * (this.x - target) - c * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

// Sector index (0 front, 1 front-right ... 7 front-left) from a yaw angle (+ = right).
export function sectorOfYaw(yaw) {
  const a = (((yaw + Math.PI / 8) % TAU) + TAU) % TAU;
  return Math.min(7, Math.floor(a / (Math.PI / 4)));
}

// Reusable temporaries for hot paths.
export const tmp = {
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  q1: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  m1: new THREE.Matrix4(),
  e1: new THREE.Euler(),
};

// Accept THREE.Vector3 or {x,y,z}; returns false if unusable.
export function isVec(v) {
  return !!v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number';
}

// Debug counters read by renderer.stats(): per-frame canvas-texture uploads (reset by the caller each second).
export const perfCount = { uploads: 0, uploadBytes: 0 };

// Canvas textures that are re-uploaded often must NOT use an sRGB internal format: with SRGB8_ALPHA8 the browser takes a
// slow CPU conversion path for texSubImage2D(canvas) (measured ~40 ms for 2048x1152 on an RTX 3050 laptop vs ~1 ms for
// RGBA8). So the canvas is uploaded as plain RGBA8 and the material decodes sRGB -> linear after the lookup instead.
export function decodeSRGBInShader(material) {
  material.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  sampledDiffuseColor.rgb = mix(pow(sampledDiffuseColor.rgb * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), sampledDiffuseColor.rgb * 0.0773993808, vec3(lessThanEqual(sampledDiffuseColor.rgb, vec3(0.04045))));
  diffuseColor *= sampledDiffuseColor;
#endif`);
  };
  material.customProgramCacheKey = () => 'srgbDecodeMap';
  return material;
}
