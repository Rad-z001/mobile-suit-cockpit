// All GLSL lives here. Conventions:
//  - every material is a plain THREE.ShaderMaterial (GLSL1-style source: varying / gl_FragColor / texture2D;
//    three maps these to GLSL ES 3.00 itself, so no glslVersion is set).
//  - world-pass materials write LINEAR colour into an RGBA8 render target.
//  - the monitor + overlay passes end with <colorspace_fragment> (linear -> sRGB for the canvas).
//  - three prepends: position/uv/normal attributes, modelMatrix, viewMatrix, projectionMatrix, normalMatrix,
//    modelViewMatrix, cameraPosition, and linearToOutputTexel().

export const NOISE = /* glsl */ `
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm4(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
float fbm3(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
`;

// Shared cloud density field: the cloud sheets and the sea (reflection + cloud shadow) use the same shape so they agree.
// Needs NOISE. cloudN = full detail for the sheets, cloudNLow = 3 octaves for the sea.
export const CLOUDF = /* glsl */ `
float cloudN(vec2 xz, float seed, vec2 wind, float t, float sc){
  vec2 p = xz * sc + vec2(seed, seed * 0.7) + wind * t * sc;
  vec2 w = vec2(vnoise(p * 1.9 + vec2(3.1, 7.7)), vnoise(p * 1.9 + vec2(11.3, 2.9))) - 0.5;
  p += w * 0.45;
  float b = 1.0 - abs(vnoise(p * 6.5 + vec2(5.0, 1.0)) * 2.0 - 1.0);
  return fbm4(p) * 0.86 + b * 0.10 + 0.02;
}
float cloudNLow(vec2 xz, float seed, vec2 wind, float t, float sc){
  vec2 p = xz * sc + vec2(seed, seed * 0.7) + wind * t * sc;
  vec2 w = vec2(vnoise(p * 1.9 + vec2(3.1, 7.7)), vnoise(p * 1.9 + vec2(11.3, 2.9))) - 0.5;
  p += w * 0.45;
  return fbm3(p) * 0.92 + 0.04;
}
`;

// Dusk sky. d = unit view direction in WORLD space (+Y up). uSunDir must be a uniform of the material.
export const SKY = /* glsl */ `
uniform vec3 uSunDir;
uniform float uThermal;
uniform float uNight;     // CR-004: 0 dusk .. 1 moonlit night (uSunDir then holds the MOON direction)
vec3 horizonAt(vec3 d){
  vec2 h = normalize(d.xz + vec2(1e-5));
  vec2 s = normalize(uSunDir.xz + vec2(1e-5));
  float warm = smoothstep(-0.35, 1.0, dot(h, s));
  return mix(vec3(0.20, 0.17, 0.30), vec3(1.0, 0.34, 0.09), warm * warm);
}
vec3 skyColorDusk(vec3 d){
  float h = d.y;
  float sd = max(dot(d, uSunDir), 0.0);
  vec3 hz = horizonAt(d);
  vec3 glow = vec3(1.0, 0.42, 0.15) * pow(sd, 6.0) * 0.35;
  vec3 c;
  if (h >= 0.0) {
    vec3 zen = vec3(0.010, 0.020, 0.075);
    vec3 mid = vec3(0.075, 0.105, 0.260);
    c = mix(hz, mid, smoothstep(0.0, 0.22, h));
    c = mix(c, zen, smoothstep(0.12, 0.85, h));
    c += hz * 0.30 * exp(-h * 9.0);
    c += glow + vec3(1.0, 0.6, 0.3) * pow(sd, 90.0) * 0.9;
    c += vec3(9.0, 6.0, 3.5) * smoothstep(0.99972, 0.99990, sd);
  } else {
    c = mix(hz * 0.85 + glow, vec3(0.012, 0.028, 0.045), 1.0 - smoothstep(-0.30, 0.0, h));
  }
  vec3 cold = vec3(0.030, 0.040, 0.065) + vec3(0.5) * smoothstep(0.9997, 0.9999, sd);
  return mix(c, cold, uThermal);
}
// Night: near-black navy, faint grey fog band at the horizon, a hard white moon with a soft halo.
vec3 skyColorNight(vec3 d){
  float h = d.y;
  float md = max(dot(d, uSunDir), 0.0);
  vec3 c = mix(vec3(0.020, 0.024, 0.034), vec3(0.0015, 0.0030, 0.0085), smoothstep(-0.02, 0.55, h));
  c += vec3(0.050, 0.056, 0.072) * exp(-abs(h) * 16.0);
  if (h < 0.0) c = mix(c, vec3(0.004, 0.006, 0.011), smoothstep(0.0, -0.25, h));
  c += vec3(0.80, 0.86, 1.0) * (pow(md, 260.0) * 0.55 + pow(md, 36.0) * 0.07 + pow(md, 7.0) * 0.016);
  c += vec3(11.0, 11.5, 12.0) * smoothstep(0.99986, 0.99995, md);
  vec3 cold = vec3(0.020, 0.024, 0.034) + vec3(0.5) * smoothstep(0.9997, 0.9999, md);
  return mix(c, cold, uThermal);
}
vec3 skyColor(vec3 d){
  vec3 a = skyColorDusk(d);
  return uNight > 0.001 ? mix(a, skyColorNight(d), uNight) : a;
}
`;

// ---------------------------------------------------------------------------------------------
export const skyDome = {
  vertex: /* glsl */ `
    varying vec3 vDir;
    void main(){
      vDir = position;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragment: /* glsl */ `
    varying vec3 vDir;
    ${NOISE}
    ${SKY}
    void main(){
      vec3 d = normalize(vDir);
      vec3 c = skyColor(d);
      // natural dusk gradient (CR-002b: the cel banding went with the cel clouds); a faint high alto-stratus haze
      // lit from below by the sun, and a 1-bit dither so the smooth gradient does not band in the 8-bit target
      if (d.y > 0.0) {
        float sd = max(dot(d, uSunDir), 0.0);
        vec2 q = d.xz / (d.y + 0.25) * 1.6;
        float hz = fbm3(q * vec2(1.0, 2.4) + vec2(3.7, 1.3));
        float haze = smoothstep(0.42, 0.72, hz) * smoothstep(0.02, 0.18, d.y) * (1.0 - smoothstep(0.5, 0.95, d.y));
        vec3 hc = mix(vec3(0.13, 0.15, 0.30), vec3(0.95, 0.42, 0.30), pow(sd, 1.6) * 0.9 + 0.1 * exp(-d.y * 4.0));
        hc = mix(hc, vec3(0.040, 0.046, 0.060) + vec3(0.30, 0.32, 0.38) * pow(sd, 14.0), uNight);
        c = mix(c, hc, haze * (0.38 + 0.3 * uNight) * (1.0 - uThermal));
      }
      if (uNight > 0.01 && d.y > 0.02) {
        vec3 q = d * 150.0; vec3 cell = floor(q);
        float hs = hash21(cell.xy * 1.31 + cell.z * 7.13);
        float st = step(0.987, hs) * smoothstep(0.24, 0.0, length(fract(q) - 0.5)) * (0.25 + 0.75 * (hs - 0.987) / 0.013);
        c += vec3(0.85, 0.9, 1.0) * st * 0.9 * uNight * smoothstep(0.02, 0.25, d.y) * (1.0 - uThermal);
      }
      c += (hash21(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

// ---------------------------------------------------------------------------------------------
export const ocean = {
  vertex: /* glsl */ `
    varying vec3 vWorld;
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragment: /* glsl */ `
    varying vec3 vWorld;
    uniform vec3 uCam;
    uniform float uTime;
    uniform float uPixAng;   // radians per pixel
    uniform float uDeckY, uDeckCover, uDeckSeed;   // lower cloud deck (same field as the cloud sheets)
    uniform vec2 uDeckWind;
    uniform float uLowQ;     // 1 = low quality tier: no cloud reflection tap, 3-octave foam
    ${NOISE}
    ${CLOUDF}
    ${SKY}
    void wave(inout vec2 g, inout float h, vec2 p, float t, vec2 dir, float wl, float slope, float fp){
      float k = 6.2831853 / wl;
      float ph = dot(dir, p) * k + t * sqrt(9.81 * k);
      float f = 1.0 - smoothstep(0.10, 0.45, fp / wl);
      g += dir * (cos(ph) * slope * f);
      h += sin(ph) * slope / k * f;
    }
    void main(){
      vec3 toP = vWorld - uCam;
      float dist = length(toP);
      vec3 V = toP / dist;
      float fp = dist * uPixAng / max(abs(V.y), 0.05);   // ground footprint of one pixel (m)
      vec2 p = vWorld.xz;
      p += vec2(vnoise(p * 0.0031), vnoise(p * 0.0031 + 17.3)) * 70.0;
      vec2 g = vec2(0.0); float h = 0.0;
      wave(g, h, p, uTime, normalize(vec2( 1.0, 0.35)), 230.0, 0.050, fp);
      wave(g, h, p, uTime, normalize(vec2( 0.7,-0.8 )),  97.0, 0.055, fp);
      wave(g, h, p, uTime, normalize(vec2( 0.9, 0.6 )),  41.0, 0.060, fp);
      wave(g, h, p, uTime, normalize(vec2(-0.3, 1.0 )),  17.0, 0.065, fp);
      wave(g, h, p, uTime, normalize(vec2( 0.2,-1.0 )),   7.0, 0.070, fp);
      wave(g, h, p, uTime, normalize(vec2( 1.0,-0.1 )),   3.1, 0.070, fp);
      vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
      float cosV = clamp(dot(n, -V), 0.0, 1.0);
      float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
      vec3 R = reflect(V, n); R.y = abs(R.y);
      vec3 refl = skyColor(R);
      // dusk reflections: the warm horizon glow and the violet band above it mirror in the water
      float hzk = exp(-max(R.y, 0.0) * 6.0);
      vec3 hzc = horizonAt(R);
      refl = refl * 1.15 + hzc * hzk * 0.35;
      // the lower cloud deck mirrored in the water (underside: cool blue-grey, warm where thin / sunward)
      float tr = (uDeckY - vWorld.y) / max(R.y, 0.03);
      if (tr < 70000.0 && uLowQ < 0.5) {
        vec2 cxz = vWorld.xz + R.xz * tr;
        float cn = cloudNLow(cxz, uDeckSeed, uDeckWind, uTime, 0.00022);
        float cm = smoothstep(uDeckCover - 0.03, uDeckCover + 0.17, cn) * (1.0 - smoothstep(30000.0, 70000.0, tr)) * 0.9;
        float sv = max(dot(R, uSunDir), 0.0);
        vec3 cc = mix(vec3(0.16, 0.19, 0.33), vec3(0.85, 0.46, 0.34), pow(sv, 2.0) * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 0.22, cn - uDeckCover))));
        cc = mix(cc, vec3(0.030, 0.034, 0.046) + vec3(0.10, 0.11, 0.13) * pow(sv, 3.0), uNight);
        refl = mix(refl, cc, cm * (1.0 - uThermal));
      }
      // cloud shadow on the water: the sun ray to the deck (low sun => the shadows fall far from their clouds)
      float ts = (uDeckY - vWorld.y) / max(uSunDir.y, 0.05);
      float sn = cloudNLow(vWorld.xz + uSunDir.xz * ts, uDeckSeed, uDeckWind, uTime, 0.00022);
      float sunLit = 1.0 - 0.85 * smoothstep(uDeckCover - 0.02, uDeckCover + 0.18, sn);
      vec3 deep = mix(vec3(0.004, 0.016, 0.040), vec3(0.0008, 0.0018, 0.0035), uNight);
      vec3 shallow = mix(vec3(0.020, 0.062, 0.100), vec3(0.0035, 0.0070, 0.0120), uNight);
      vec3 body = mix(deep, shallow, clamp(0.45 + h * 0.10, 0.0, 1.0));
      body += vec3(0.05, 0.02, 0.05) * pow(max(dot(normalize(vec3(uSunDir.x, 0.0, uSunDir.z)), vec3(V.x, 0.0, V.z)), 0.0), 3.0) * 0.35 * (0.25 + 0.75 * sunLit);
      vec3 col = mix(body, refl, F);
      // sun glitter: long path along the sun azimuth, broken into sparkles by the small waves
      float sunR = max(dot(R, uSunDir), 0.0);
      float spark = 0.6 + 0.8 * step(0.55, vnoise(p * 0.9 + uTime * 0.7));
      col += mix(vec3(1.0, 0.52, 0.22), vec3(0.72, 0.82, 1.0), uNight) * (pow(sunR, 700.0) * 5.0 + pow(sunR, 38.0) * 0.34 + pow(sunR, 9.0) * 0.07 * spark) * mix(sunLit, 0.5 + 0.5 * sunLit, uNight) * mix(1.0, 0.8, uNight);
      col *= 0.82 + 0.18 * sunLit;
      // foam: patches + whitecaps on crests + wind rows. Pattern scrolls with the world => speed cue.
      float fN;
      if (uLowQ > 0.5) fN = fbm3(p * 0.040 + vec2(uTime * 0.25, 0.0)); else fN = fbm4(p * 0.040 + vec2(uTime * 0.25, 0.0));
      float crest = smoothstep(0.8, 2.2, h) * fN;
      float rows = vnoise(vec2(dot(p, vec2(0.94, 0.34)) * 0.006, dot(p, vec2(-0.34, 0.94)) * 0.07));
      float foam = clamp(crest * 1.6 + smoothstep(0.60, 0.80, fN) * (0.35 + 0.5 * rows), 0.0, 1.0);
      foam *= 1.0 - smoothstep(3000.0, 16000.0, dist);
      col = mix(col, vec3(0.50, 0.55, 0.62) * (0.35 + 0.6 * refl.r + 0.4 * refl.b), foam * 0.75);
      col = mix(col, vec3(0.035, 0.040, 0.060), uThermal);
      col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))) * vec3(0.86, 0.95, 1.1), 0.85 * uNight);
      float fog = 1.0 - exp(-dist / mix(24000.0, 15000.0, uNight));
      col = mix(col, skyColor(V), fog);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// ---------------------------------------------------------------------------------------------
export const cloudDeck = {
  vertex: ocean.vertex,
  // Natural dusk cloud sheet (CR-002b). One density field, soft alpha (no outline, no flat bands). Lit by the low sun:
  // warm light on the sun-facing slopes, cool blue-grey shade away from it, a silver / warm rim where the cloud is thin
  // and the sun is behind it. Several of these are stacked a few tens of metres apart with a rising coverage threshold,
  // which reads as a thick stratocumulus layer with parallax when the camera moves. Seen from below it is a dark cool
  // underside with a warm glow toward the sun.
  fragment: /* glsl */ `
    varying vec3 vWorld;
    uniform vec3 uCam;
    uniform float uTime;
    uniform float uCover;
    uniform float uSeed;
    uniform float uK;        // 0 bottom layer .. 1 top layer (lit more)
    uniform float uAlpha;
    uniform float uScale;
    uniform vec2 uWind;
    uniform float uLowQ;     // 1 = low quality tier: 3-octave field, no sun-side density tap
    ${NOISE}
    ${CLOUDF}
    ${SKY}
    void main(){
      vec3 toP = vWorld - uCam;
      float dist = length(toP);
      vec3 V = toP / dist;
      vec2 xz = vWorld.xz;
      float n;
      if (uLowQ > 0.5) n = cloudNLow(xz, uSeed, uWind, uTime, uScale); else n = cloudN(xz, uSeed, uWind, uTime, uScale);
      float d = n - uCover;
      float a = smoothstep(-0.035, 0.20, d);
      if (a < 0.004) discard;
      // sun-side density tap: thicker toward the sun = this point is in the lee (shade); thinner = sunlit slope
      vec2 sd = normalize(uSunDir.xz + vec2(1e-5));
      float lit = 0.5;
      if (uLowQ < 0.5) { float nS = cloudN(xz + sd * 240.0, uSeed, uWind, uTime, uScale); lit = smoothstep(-0.06, 0.05, n - nS); }
      float cot = vnoise(xz * 0.0046 + uSeed * 5.0) * 0.6 + vnoise(xz * 0.013 + 4.0) * 0.4;
      lit = clamp(lit + (cot - 0.5) * 0.45, 0.0, 1.0);
      float thick = smoothstep(0.0, 0.32, d);
      float thin = 1.0 - thick;
      float sunV = max(dot(V, uSunDir), 0.0);
      float below = step(uCam.y, vWorld.y);
      vec3 shadowC = vec3(0.19, 0.22, 0.38);
      vec3 midC    = vec3(0.50, 0.43, 0.57);
      vec3 litC    = vec3(1.00, 0.64, 0.42);
      vec3 col = mix(shadowC, midC, 0.30 + 0.45 * uK + 0.25 * thin);
      col = mix(col, litC, lit * (0.40 + 0.55 * uK) * (0.55 + 0.45 * thin));
      col *= 0.86 + 0.24 * cot;
      // rim: thin cloud edges glow warm when the sun is behind / beside them
      col += vec3(1.0, 0.56, 0.30) * thin * pow(sunV, 2.5) * 1.15;
      // underside seen from below: cool, dark, warm toward the sun and at the thin edges
      vec3 under = mix(vec3(0.12, 0.14, 0.27), vec3(0.62, 0.34, 0.36), pow(sunV, 1.6) * (0.35 + 0.65 * thin));
      under = mix(under, shadowC * 1.3, 0.2 * (cot - 0.2));
      col = mix(col, under, below);
      if (uNight > 0.001) {
        vec3 nc = mix(vec3(0.016, 0.019, 0.029), vec3(0.20, 0.215, 0.255), lit * (0.45 + 0.55 * uK) * (0.5 + 0.5 * thin)) + vec3(0.30, 0.32, 0.38) * thin * pow(sunV, 3.0);
        nc = mix(nc, vec3(0.012, 0.014, 0.022) + vec3(0.07, 0.075, 0.09) * pow(sunV, 2.0) * (0.4 + 0.6 * thin), below);
        col = mix(col, nc, uNight);
      }
      float fog = 1.0 - exp(-dist / 34000.0);
      col = mix(col, skyColor(V), fog);
      col = mix(col, vec3(0.05, 0.055, 0.075) + 0.05 * lit, uThermal);
      float nearK = smoothstep(60.0, 520.0, abs(uCam.y - vWorld.y));
      gl_FragColor = vec4(col, a * uAlpha * nearK * (1.0 - fog * 0.5));
    }`,
};

// ---------------------------------------------------------------------------------------------
// Instanced cumulus puffs: camera-facing soft billboards (clustered into towers), xz wrapped around the player on the GPU.
// Each puff fakes a lumpy sphere: noise-perturbed sphere normal, a wide soft terminator, a cool ambient shade side, a warm
// rim on the sun side and forward-scattered glow at thin edges. No outlines, soft alpha, fades near the camera.
export const puffs = {
  vertex: /* glsl */ `
    attribute vec4 iData;   // x,z in [0,2H), y = absolute altitude, w = size (m)
    attribute vec2 iRand;
    uniform vec3 uPlayer;
    uniform float uH;
    varying vec2 vUv;
    varying float vFade;
    varying vec3 vLight;
    varying float vRand;
    varying float vDist;
    varying vec3 vDir;
    uniform vec3 uSunDir;
    void main(){
      vec2 rel = mod(iData.xz - uPlayer.xz + uH, 2.0 * uH) - uH;
      vec3 wp = vec3(uPlayer.x + rel.x, iData.y, uPlayer.z + rel.y);
      vec4 mv = viewMatrix * vec4(wp, 1.0);
      float ang = (iRand.x - 0.5) * 0.9;      // small tilt only: keeps the flat bases roughly level
      float c = cos(ang), s = sin(ang);
      vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
      mv.xy += q * iData.w * 2.0;
      gl_Position = projectionMatrix * mv;
      float d = length(rel);
      float md = length(mv.xyz);
      vFade = (1.0 - smoothstep(uH * 0.72, uH * 0.98, d)) * smoothstep(500.0, 2600.0, md);
      vUv = position.xy * 2.0;
      vRand = iRand.y;
      vDist = md;
      vDir = normalize(wp - uPlayer);
      vLight = (viewMatrix * vec4(uSunDir, 0.0)).xyz;
    }`,
  fragment: /* glsl */ `
    varying vec2 vUv;
    varying float vFade;
    varying vec3 vLight;
    varying float vRand;
    varying float vDist;
    varying vec3 vDir;
    ${NOISE}
    ${SKY}
    void main(){
      float d = length(vUv);
      if (d > 1.0 || vFade < 0.01) discard;
      vec2 q = vUv * 2.3 + vRand * 31.0;
      float n = fbm3(q);
      float shape = d + (n - 0.5) * 0.78;
      float dens = 1.0 - smoothstep(0.34, 0.92, shape);        // soft body, long feathered edge
      dens *= 1.0 - smoothstep(0.80, 1.0, d);                  // never touches the quad edge
      if (dens < 0.012) discard;
      // lumpy normal: sphere + two-tap noise bumps
      vec2 e = vec2(0.09, 0.0);
      vec2 bq = vUv * 3.4 + vRand * 17.0;
      vec2 bump = vec2(vnoise(bq + e.xy) - vnoise(bq - e.xy), vnoise(bq + e.yx) - vnoise(bq - e.yx));
      vec3 N = normalize(vec3(vUv * 0.9, sqrt(max(1.0 - d * d * 0.8, 0.06))) + vec3(bump * 1.9, 0.0));
      vec3 L = normalize(vLight);
      float ndl = dot(N, L);
      float diff = smoothstep(-0.45, 0.70, ndl);
      vec3 shadowC = vec3(0.22, 0.26, 0.44);
      vec3 midC    = vec3(0.60, 0.50, 0.58);
      vec3 litC    = vec3(1.00, 0.68, 0.44);
      vec3 col = mix(shadowC, midC, smoothstep(0.05, 0.55, diff));
      col = mix(col, litC, smoothstep(0.50, 1.0, diff));
      // cloud mass self-shadow: thick centres sit darker, flat-ish bottoms (screen-down) get cool ambient
      col *= mix(0.80, 1.0, 1.0 - smoothstep(0.35, 1.0, dens));
      col = mix(col, shadowC * 1.05, smoothstep(0.1, -0.9, vUv.y) * 0.30);
      // sun-side rim + forward scatter (sun in front of the camera => thin edges glow)
      float edge = 1.0 - smoothstep(0.0, 0.5, dens);
      float side = smoothstep(0.0, 0.8, dot(normalize(vUv + vec2(1e-4)), normalize(L.xy + vec2(1e-4))));
      float front = smoothstep(0.0, 0.7, -L.z);
      col += vec3(1.0, 0.58, 0.32) * (side * edge * 0.55 * (0.4 + 0.6 * smoothstep(-0.2, 0.6, L.y)) + edge * front * 0.9);
      col *= 0.92 + 0.16 * vnoise(vUv * 6.0 + vRand * 9.0);
      // aerial perspective toward the horizon colour
      float fog = 1.0 - exp(-vDist / 42000.0);
      if (uNight > 0.001) {
        vec3 nc = mix(vec3(0.020, 0.023, 0.034), vec3(0.24, 0.255, 0.30), smoothstep(0.05, 0.9, diff)) + vec3(0.2, 0.22, 0.27) * edge * front * 0.6;
        col = mix(col, nc, uNight);
      }
      col = mix(col, mix(horizonAt(vDir) * 0.8 + vec3(0.04, 0.05, 0.09), vec3(0.03, 0.035, 0.048), uNight), fog * 0.8);
      col = mix(col, vec3(0.05, 0.055, 0.075) + 0.05 * diff, uThermal);
      gl_FragColor = vec4(col, dens * vFade * 0.88);
    }`,
};

// ---------------------------------------------------------------------------------------------
// Wind / ice-crystal streaks: world-fixed particles that smear along the velocity => speed cue.
export const streaks = {
  vertex: /* glsl */ `
    attribute vec3 aSeed;
    attribute float aEnd;
    uniform vec3 uPlayer;
    uniform vec3 uVel;
    uniform float uLen;
    varying float vA;
    void main(){
      vec3 box = vec3(500.0, 300.0, 500.0);
      vec3 rel = mod(aSeed * box - uPlayer + box * 0.5, box) - box * 0.5;
      vec3 p = uPlayer + rel;
      p += uVel * uLen * aEnd;
      vec4 mv = viewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      vA = smoothstep(25.0, 140.0, length(rel)) * (1.0 - aEnd * 0.85);
    }`,
  fragment: /* glsl */ `
    varying float vA;
    uniform float uAlpha;
    void main(){ gl_FragColor = vec4(0.75, 0.82, 1.0, vA * uAlpha); }`,
};

// ---------------------------------------------------------------------------------------------
// Instanced camera-facing quads: particles (smoke/fire, age driven on the GPU) and per-frame glows.
export const quads = {
  vertex: /* glsl */ `
    attribute vec3 iPos;
    attribute vec3 iVel;
    attribute vec2 iSize;    // start, end (m, full width)
    attribute vec4 iColor;
    attribute vec3 iTime;    // birth, life, seed
    uniform float uNow;
    uniform float uDrag;
    varying vec4 vColor;
    varying vec2 vUv;
    varying float vT;
    varying float vSeed;
    void main(){
      float age = max(uNow - iTime.x, 0.0);
      float t = age / max(iTime.y, 1e-3);
      if (t >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec4(0.0); vUv = vec2(0.0); vT = 1.0; vSeed = 0.0; return; }
      vec3 wp = iPos + iVel * ((1.0 - exp(-uDrag * age)) / uDrag);
      float size = mix(iSize.x, iSize.y, 1.0 - (1.0 - t) * (1.0 - t));
      vec4 mv = viewMatrix * vec4(wp, 1.0);
      float ang = iTime.z * 6.2831853 + age * (iTime.z - 0.5) * 0.9;
      float c = cos(ang), s = sin(ang);
      vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
      mv.xy += q * size;
      gl_Position = projectionMatrix * mv;
      vColor = iColor; vUv = position.xy * 2.0; vT = t; vSeed = iTime.z;
    }`,
  fragment: /* glsl */ `
    uniform float uMode;     // 0 smoke, 1 fire, 2 glow/glint
    uniform float uThermal;
    varying vec4 vColor;
    varying vec2 vUv;
    varying float vT;
    varying float vSeed;
    ${NOISE}
    void main(){
      float d = length(vUv);
      if (d > 1.0 || vColor.a <= 0.0) discard;
      if (uMode < 0.5) {
        float n = vnoise(vUv * 2.6 + vSeed * 41.0);
        float shape = d + (n - 0.5) * 0.7;
        float a = 1.0 - smoothstep(0.80, 0.90, shape);
        float rim = smoothstep(0.58, 0.80, shape);
        float fade = pow(1.0 - vT, 1.2) * smoothstep(0.0, 0.05, vT);
        vec3 col = vColor.rgb * (0.78 + 0.35 * n);
        col *= mix(1.0, 0.45, rim);
        col += vec3(0.10, 0.05, 0.02) * (1.0 - rim) * smoothstep(0.5, 0.0, shape) * 0.5;
        col = mix(col, vec3(0.05, 0.055, 0.075), uThermal * 0.5);
        gl_FragColor = vec4(col, a * fade * vColor.a);
      } else if (uMode < 1.5) {
        // fireball: banded (cel) heat. white core, yellow, orange, deep red rim
        float n = vnoise(vUv * 3.0 + vSeed * 23.0);
        float core = exp(-d * d * 2.6) * (0.75 + 0.5 * n);
        float heat = pow(1.0 - vT, 1.4);
        float h = core * heat;
        vec3 c = vec3(0.55, 0.06, 0.02);
        c = mix(c, vec3(1.0, 0.26, 0.04), smoothstep(0.10, 0.14, h));
        c = mix(c, vec3(1.0, 0.62, 0.12), smoothstep(0.30, 0.34, h));
        c = mix(c, vec3(1.0, 0.92, 0.55), smoothstep(0.52, 0.56, h));
        c = mix(c, vec3(1.0), smoothstep(0.78, 0.82, h));
        float a = smoothstep(0.045, 0.075, h);
        gl_FragColor = vec4(c * vColor.rgb * 1.15, a * vColor.a);
      } else if (uMode > 3.5) {
        // tinted burst: soft round flash, white-hot core, colour from the instance
        float n = vnoise(vUv * 3.4 + vSeed * 19.0);
        float core = exp(-d * d * 3.0) * (0.8 + 0.4 * n);
        float k = pow(1.0 - vT, 1.5);
        vec3 c = mix(vColor.rgb, vec3(1.0), core * core * 0.9);
        gl_FragColor = vec4(c * core * k * vColor.a * 1.4, 1.0);
      } else if (uMode > 2.5) {
        // shock ring
        float w = 0.10 + 0.10 * vT;
        float r = abs(d - (0.78 - 0.1 * vT));
        float ring = exp(-(r * r) / (w * w * 0.5)) * pow(1.0 - vT, 1.2);
        gl_FragColor = vec4(vColor.rgb * ring * vColor.a * 1.3, 1.0);
      } else {
        float g = exp(-d * d * 7.0);
        float spike = exp(-abs(vUv.x) * 16.0) * exp(-abs(vUv.y) * 2.2) + exp(-abs(vUv.y) * 16.0) * exp(-abs(vUv.x) * 2.2);
        float a = (g + spike * 0.55) * vColor.a;
        gl_FragColor = vec4(vColor.rgb, a);
      }
    }`,
};

// ---------------------------------------------------------------------------------------------
// Instanced beam ribbons (bolts / tracers). Ribbon is billboarded around its own axis.
export const beams = {
  // Ribbon billboarded around its own axis. iP = (birth, life, crackle, minPx):
  //   life == 0  live bolt, drawn every frame;  life > 0  trail segment that widens / dims / wavers with age.
  //   iW = half width of the whole quad (glow); the saturated body is ~30% of it, the white core ~10%.
  //   minPx = minimum on-screen half width of the quad in pixels (far beams stay readable).
  vertex: /* glsl */ `
    attribute vec3 iA;       // tail (world)
    attribute vec3 iB;       // head (world)
    attribute float iW;
    attribute vec3 iOuter;
    attribute vec3 iCore;
    attribute vec4 iP;
    uniform float uNow;
    uniform float uPixAng;
    varying vec2 vUv;
    varying vec3 vOuter;
    varying vec3 vCore;
    varying float vS;        // 0 tail .. 1 head (of the unclipped ribbon)
    varying float vAge;      // 0 live, else 0..1
    varying float vLen;
    varying float vCrk;
    void main(){
      float life = iP.y;
      float age = life > 0.0 ? clamp((uNow - iP.x) / life, 0.0, 1.0) : 0.0;
      vec3 a = (viewMatrix * vec4(iA, 1.0)).xyz;
      vec3 b = (viewMatrix * vec4(iB, 1.0)).xyz;
      const float NZ = -0.6;
      if ((life > 0.0 && age >= 1.0) || (a.z > NZ && b.z > NZ)) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vUv = vec2(0.0); vS = 0.0; vAge = 1.0; vLen = 1.0; vCrk = 0.0; vOuter = vec3(0.0); vCore = vec3(0.0);
        return;
      }
      float len = length(iB - iA);
      float tA = 0.0, tB = 1.0;
      vec3 a0 = a, b0 = b;
      if (a0.z > NZ) { tA = (NZ - a0.z) / (b0.z - a0.z); a = mix(a0, b0, tA); }
      if (b0.z > NZ) { tB = (NZ - a0.z) / (b0.z - a0.z); b = mix(a0, b0, tB); }
      vec3 axis = b - a;
      vec3 mid = (a + b) * 0.5;
      vec3 side = cross(axis, mid);
      float sl = length(side);
      side = sl > 1e-6 ? side / sl : vec3(1.0, 0.0, 0.0);
      float ty = position.y + 0.5;
      float s = mix(tA, tB, ty);
      float wid = iW * (1.0 + 1.7 * age);
      float depth = max(-mix(a.z, b.z, ty), 0.5);
      wid = clamp(wid, uPixAng * depth * iP.w, max(uPixAng * depth * 95.0, uPixAng * depth * iP.w));
      vec3 wp = mix(iA, iB, s);
      float wob = life > 0.0 ? sin(dot(wp, vec3(0.005, 0.008, 0.006)) + uNow * 2.2 + iP.z * 7.0) * iW * 0.32 * age : 0.0;
      vec3 p = mix(a, b, ty) + side * (position.x * 2.0 * wid + wob);
      gl_Position = projectionMatrix * vec4(p, 1.0);
      vUv = vec2(position.x * 2.0, ty);
      vS = s; vAge = life > 0.0 ? max(age, 0.001) : 0.0; vLen = len; vCrk = iP.z;
      vOuter = iOuter; vCore = iCore;
    }`,
  fragment: /* glsl */ `
    uniform float uNow;
    varying vec2 vUv;
    varying vec3 vOuter;
    varying vec3 vCore;
    varying float vS;
    varying float vAge;
    varying float vLen;
    varying float vCrk;
    ${NOISE}
    // Look after reference 16: white-hot crisp core, saturated colour sheath, a long thin tail that fades to white.
    void main(){
      float x = vUv.x;
      float along = vS * vLen;
      float live = vAge > 0.0 ? 0.0 : 1.0;
      float n = vnoise(vec2(along * 0.09 - uNow * 38.0, x * 2.5 + 3.0)) * 0.6 + vnoise(vec2(along * 0.31 + uNow * 61.0, x * 5.0)) * 0.4;
      vec3 c;
      float k;
      if (live > 0.5) {
        float bodyK = smoothstep(0.58, 0.74, vS);
        float taper = mix(0.07, 1.0, bodyK);
        float ax = abs(x) / taper * (1.0 + vCrk * (n - 0.5) * 0.3 * bodyK);
        float core = 1.0 - smoothstep(0.085, 0.125, ax);
        float coreSoft = exp(-ax * ax * 55.0);
        float sheath = 1.0 - smoothstep(0.34, 0.62, ax);
        float glow = exp(-ax * ax * 7.0);
        float edgeK = 1.0 - smoothstep(0.55, 0.98, abs(x));
        float halo = exp(-ax * ax * 4.0) * edgeK;
        float whiten = 1.0 - bodyK;
        vec3 outer = mix(vOuter, vec3(1.0), whiten * 0.8);
        float tailFade = smoothstep(0.0, 0.22, vS);
        float headG = 1.0 + 1.3 * smoothstep(0.92, 1.0, vS);
        float cap = 1.0 - smoothstep(0.985, 1.0, vS);
        float pulse = 0.92 + 0.08 * sin(along * 0.05 - uNow * 55.0);
        c = vCore * (core * 3.0 + coreSoft * 0.8) + outer * (sheath * 1.2 + glow * 1.1 + halo * 0.5 * bodyK) * edgeK;
        k = tailFade * headG * cap * pulse;
      } else {
        float f = 1.0 - vAge;
        float spread = 1.0 / (1.0 + 1.5 * vAge);
        float ax = abs(x) * (1.0 + vCrk * (n - 0.5) * 0.3);
        float core = exp(-(ax * ax) / 0.015);
        float body = exp(-(ax * ax) / 0.09);
        float halo = exp(-ax * ax * 3.6) * (1.0 - smoothstep(0.55, 0.98, abs(x)));
        vec3 outer = mix(vOuter, vec3(1.0), vAge * 0.55);
        c = vCore * core * f * f * f * 0.9 + outer * (body * f * 1.1 + halo * f * 0.8);
        k = (1.0 + 0.25 * n) * spread;
      }
      gl_FragColor = vec4(c * k, 1.0);
    }`,
};

// ---------------------------------------------------------------------------------------------
// Thruster plume: unit cone, base at z=0 (radius 1), apex at z=1; the mesh is scaled per use.
export const plume = {
  vertex: /* glsl */ `
    varying float vL;
    varying vec3 vN;
    varying vec3 vV;
    void main(){
      vL = position.z;
      vN = normalize(normalMatrix * normal);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vV = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`,
  fragment: /* glsl */ `
    uniform float uTime;
    uniform vec3 uOuter;
    uniform vec3 uCore;
    varying float vL;
    varying vec3 vN;
    varying vec3 vV;
    void main(){
      float ndv = abs(dot(normalize(vN), normalize(vV)));
      float along = pow(max(1.0 - vL, 0.0), 1.3);
      float fl = 0.82 + 0.18 * sin(uTime * 70.0 + vL * 9.0) + 0.08 * sin(uTime * 131.0 + vL * 23.0);
      float a = pow(ndv, 1.4) * along * fl;
      vec3 c = mix(uOuter, uCore, ndv * (1.0 - vL));
      gl_FragColor = vec4(c, a);
    }`,
};

// ---------------------------------------------------------------------------------------------
// The 360 degree panoramic monitor. See research doc 08 sections 2-4.
//   cockpit-space direction of a pixel = uCamRot * viewRay, with the *display* FOV (uTan), so seams,
//   dead sectors and the diagnostic grid are glued to the cockpit shell, not to the world.
export const monitor = {
  vertex: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragment: /* glsl */ `
    uniform sampler2D tMap, tTargetMask;
    uniform float uTime, uMinovsky, uHit, uFlicker, uFlutter, uBarrier, uMach, uBlack, uGrid, uGridSweep;
    uniform float uGlitch, uZoomFrame, uMode, uDead, uClean, uTargetEffect;
    uniform float uSect[8];
    uniform float uSHit[8];
    uniform vec2 uRes, uTan;
    uniform mat3 uCamRot;
    uniform float uPixAng;
    uniform vec4 uHatch;     // open hatch: far-opening distance, half width, half height, on (render/hatch.js)
    uniform vec2 uHatchC;
    uniform vec3 uEye;
    varying vec2 vUv;
    ${NOISE}

    vec3 flirRamp(float h){   // doc 08 sec 4 table (linear values of the listed hex colours)
      vec3 c0 = vec3(0.0015, 0.0024, 0.0056);   // #050811
      vec3 c1 = vec3(0.0137, 0.0423, 0.0844);   // #1F3A52
      vec3 c2 = vec3(0.672, 0.105, 0.0176);     // #D65B24
      vec3 c3 = vec3(1.0, 0.451, 0.0);          // #FFB300
      vec3 c4 = vec3(1.0);                      // #FFFFFF
      vec3 c = c0;
      c = mix(c, c1, smoothstep(0.18, 0.50, h));
      c = mix(c, c2, smoothstep(0.50, 0.70, h));
      c = mix(c, c3, smoothstep(0.70, 0.90, h));
      c = mix(c, c4, smoothstep(0.90, 1.00, h));
      return c;
    }

    void main(){
      if (uClean > 0.5) { gl_FragColor = vec4(texture2D(tMap, vUv).rgb, 1.0);
#include <colorspace_fragment>
        return; }
      vec2 uv = vUv;
      vec2 uv0 = vUv;
      vec2 ndc = uv * 2.0 - 1.0;
      float t = uTime;

      // ---- cockpit-space direction ----
      vec3 cd = uCamRot * normalize(vec3(ndc * uTan, -1.0));
      float lon = atan(cd.x, -cd.z);
      float lat = asin(clamp(cd.y, -1.0, 1.0));
      float secF = mod(lon + 0.3926991 + 6.2831853, 6.2831853) / 0.7853982;
      int si = int(min(floor(secF), 7.0));
      float health = uSect[si];

      // ---- the open hatch: this sight line leaves through the tunnel's far opening, so it is the pilot's own eyes, not
      //      the monitor - no damage, static, tearing, sensor tint or seams there (soft 1 cm edge on the far rim) ----
      float eyeView = 0.0;
      if (uHatch.w > 0.5 && cd.z < -1e-4) {
        float tF = (-uHatch.x - uEye.z) / cd.z;
        vec2 pF = uEye.xy + tF * cd.xy - uHatchC;
        vec2 q = abs(pF) - uHatch.yz;
        eyeView = 1.0 - smoothstep(-0.01, 0.0, max(q.x, q.y));
      }
      if (eyeView > 0.999) { gl_FragColor = vec4(texture2D(tMap, vUv).rgb, 1.0);
#include <colorspace_fragment>
        return; }

      // ---- damaged-sector amount, FEATHERED across the sector edges and wobbling (CR-002b: no hard straight seams) ----
      float wob = (vnoise(vec2(lat * 5.0 + t * 0.6, 3.1)) - 0.5) * 0.34 + 0.04 * sin(lat * 21.0 + t * 1.1);
      float sfw = secF + wob;
      float fl0 = floor(sfw);
      float ffr = sfw - fl0;
      int ia = int(mod(fl0 + 8.0, 8.0));
      int ib = int(mod(fl0 + (ffr < 0.5 ? -1.0 : 1.0) + 8.0, 8.0));
      float bl = 0.5 * (1.0 - smoothstep(0.0, 0.24, min(ffr, 1.0 - ffr)));
      float dmg = clamp(1.0 - mix(uSect[ia], uSect[ib], bl), 0.0, 1.0);
      float fAvg = mix(uSHit[ia], uSHit[ib], bl);

      // ---- distortion: frame-sync flutter, Minovsky jitter, hit tearing ----
      uv.y += uFlutter * 0.018 * sin(t * 190.0);
      uv.x += uFlutter * 0.006 * sin(uv0.y * 60.0 + t * 220.0);
      float jn = sin(uv0.y * 320.0 + t * 45.0) * cos(uv0.y * 120.0 - t * 20.0);
      float jt = step(0.92, hash11(floor(t * 24.0) + floor(uv0.y * 15.0)));
      uv.x += jn * jt * (uMinovsky * 0.015);
      float tearAmt = uHit + uGlitch;
      float band = floor(uv0.y * 26.0);
      float tf = floor(t * 30.0);
      float tearOn = step(0.50, hash21(vec2(band * 1.3, tf + 9.0)));
      uv.x += (hash21(vec2(band, tf)) - 0.5) * tearAmt * 0.14 * tearOn;
      // scan tearing + slow vertical roll inside a damaged sector
      float dband = floor(uv0.y * 38.0);
      float dOn = step(0.62, hash21(vec2(dband * 1.7, floor(t * 22.0) + float(ia))));
      uv.x += (hash21(vec2(dband, floor(t * 22.0) + 5.0)) - 0.5) * dmg * 0.09 * dOn;
      uv.y += dmg * 0.0035 * sin(t * 40.0 + uv0.x * 30.0);

      // beam barrier heat shimmer, concentrated at the periphery (doc 08 sec 3)
      float rd = length(uv0 - 0.5);
      float edge = smoothstep(0.25, 0.75, rd);
      if (uBarrier > 0.01) {
        vec2 flow = vec2(0.0, t * uMach * 0.4);
        vec2 nz = vec2(vnoise(uv0 * 7.0 + flow), vnoise(uv0 * 7.0 + flow + 31.7)) * 2.0 - 1.0;
        uv += nz * edge * 0.02 * uBarrier;
      }
      uv = clamp(uv, vec2(0.001), vec2(0.999));

      // ---- chromatic split ----
      float split = uMinovsky * 0.008 + uHit * 0.012 + uGlitch * 0.01 + dmg * 0.010;
      vec3 col;
      col.r = texture2D(tMap, uv + vec2(split, 0.0)).r;
      col.g = texture2D(tMap, uv).g;
      col.b = texture2D(tMap, uv - vec2(split, 0.0)).b;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));

      // ---- sensor modes ----
      float grain = hash21(gl_FragCoord.xy + fract(t) * 91.0) - 0.5;
      if (uMode > 1.5) {
        // sqrt lifts the dimmed sky/sea into the cool-slate band so the horizon stays readable
        col = flirRamp(sqrt(clamp(luma, 0.0, 1.0)) * 1.25) * 1.6 + vec3(0.004, 0.007, 0.014) + vec3(grain * 0.004);
      } else if (uMode > 0.5) {
        float g = pow(luma, 0.6) * 1.8;
        col = vec3(0.20, 1.0, 0.40) * g * 0.80 + vec3(0.0, grain * 0.14, 0.0);
      } else {
        // CR-007: no tint, the picture is shown as it is
      }

      // ---- barrier glow ----
      if (uBarrier > 0.01) {
        float fil = pow(vnoise(vec2(atan(ndc.y, ndc.x) * 9.0, t * 2.5 + uMach)), 3.0);
        col += vec3(0.0, 0.9, 1.0) * edge * (0.28 + 0.35 * fil) * uBarrier;
      }

      // ---- scanlines / micro pixel grid / static ----
      float amt = uMinovsky * 0.22 + uHit * 0.08 + uGlitch * 0.035 + dmg * 0.05;
      col *= 1.0 - amt * (0.5 + 0.5 * sin(gl_FragCoord.y * 2.0944));
      float stat = hash21(gl_FragCoord.xy * 0.5 + fract(t * 7.0) * 100.0) - 0.5;
      // static is far more visible on the near-black thermal picture, so scale it down there
      float statScale = uMode > 1.5 ? 0.12 : 1.0;
      col += stat * (uMinovsky * 0.09 * statScale + uHit * 0.2 + uGlitch * 0.2);
      col = max(col, vec3(0.0));

      // ---- camera seam lines in cockpit space ----
      float dm = min(fract(secF), 1.0 - fract(secF)) * 0.7853982 * cos(lat);
      float dl = min(abs(abs(lat) - 0.5934), abs(abs(lat) - 1.2217));
      float w = uPixAng * 1.1;
      float seam = clamp((1.0 - smoothstep(w * 0.5, w * 1.5, dm)) * 0.6 + (1.0 - smoothstep(w * 0.5, w * 1.5, dl)), 0.0, 1.0);
      float seamBoost = 1.0;
      col = mix(col, col * 0.72 + vec3(0.006, 0.012, 0.016), clamp(seam * 0.38 * seamBoost, 0.0, 1.0));

      // ---- damaged sectors stay READABLE: colour shift, heavy static, tearing (above), dimmed to ~50% at worst ----
      if (dmg > 0.001) {
        float lumaD = dot(col, vec3(0.299, 0.587, 0.114));
        vec3 shifted = mix(col, vec3(lumaD) * vec3(0.70, 1.0, 1.12) + col.gbr * 0.25, 0.55);
        col = mix(col, shifted, dmg);
        float rowN = hash21(vec2(floor(gl_FragCoord.y * 0.5), floor(t * 30.0) + float(ia)));
        float pix = hash21(floor(gl_FragCoord.xy * vec2(0.5, 1.0)) + floor(t * 40.0));
        float blockN = step(0.6, rowN);
        col += (pix - 0.5) * dmg * (0.13 + 0.28 * blockN) + vec3(0.03, 0.0, 0.04) * blockN * dmg;
        float fk = 1.0 - 0.16 * dmg * step(0.72, hash11(floor(t * 17.0) + float(ia) * 7.13));
        col *= mix(1.0, 0.52, dmg) * fk;
      }
      col *= 1.0 - 0.93 * fAvg * fAvg;      // the brief near-black flash at the moment of the hit
      col = max(col, vec3(0.0));

      // ---- startup: monitor brightness, cyan diagnostic wireframe sweep ----
      col *= uBlack;
      if (uGrid > 0.001) {
        float a = lon / 0.2617994;
        float da = abs(fract(a + 0.5) - 0.5) * 0.2617994 * cos(lat);
        float b = lat / 0.2617994;
        float db = abs(fract(b + 0.5) - 0.5) * 0.2617994;
        float gw = uPixAng * 1.2;
        float gline = max(1.0 - smoothstep(gw * 0.6, gw * 1.6, da), 1.0 - smoothstep(gw * 0.6, gw * 1.6, db));
        float sweepLon = uGridSweep * 6.2831853 - 3.1415927;
        float dd = lon - sweepLon; dd = abs(mod(dd + 3.1415927, 6.2831853) - 3.1415927);
        float sw = exp(-dd * dd * 14.0) + 0.12 * step(lon, sweepLon);
        float lr = lat - (uGridSweep * 2.0 - 1.0) * 1.2;
        float ring = exp(-lr * lr * 40.0);
        col += vec3(0.0, 0.9, 1.0) * gline * uGrid * (0.12 + 1.4 * sw + 0.6 * ring);
        col += vec3(0.0, 0.14, 0.20) * sw * uGrid * 0.5;
      }

      // ---- zoom frame ----
      if (uZoomFrame > 0.01) {
        vec2 an = abs(ndc);
        float onV = step(abs(an.x - 0.90), 0.0035) * step(0.74, an.y) * step(an.y, 0.88);
        float onH = step(abs(an.y - 0.88), 0.0055) * step(0.78, an.x) * step(an.x, 0.90);
        float tick = step(abs(an.x), 0.0025) * step(0.82, an.y) * step(an.y, 0.88) + step(abs(an.y), 0.0035) * step(0.84, an.x) * step(an.x, 0.90);
        col += vec3(0.0, 0.9, 1.0) * clamp(onV + onH + tick, 0.0, 1.0) * 0.8 * uZoomFrame;
        col *= 1.0 - 0.25 * uZoomFrame * smoothstep(0.55, 1.1, length(ndc));
      }

      // CR-007: the RGB channel separation on the selected target's silhouette is removed (owner: enemies must look sharp).

      // ---- 0.2 s black flicker on hit ----
      col *= 1.0 - uFlicker;
      col = max(col, vec3(0.0));
      if (eyeView > 0.0) col = mix(col, texture2D(tMap, vUv).rgb, eyeView);   // the soft rim of the hatch view
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
};

// ---------------------------------------------------------------------------------------------
// Final overlay (over monitor AND cockpit): blackout tunnel, red-out, smoke haze, flashes, fades, UI card.
export const overlay = {
  vertex: monitor.vertex,
  fragment: /* glsl */ `
    uniform float uBlackout, uFadeWhite, uFadeBlack, uFlash, uRed, uSmoke, uTime, uAspect, uUI, uVig;
    uniform sampler2D tUI;
    varying vec2 vUv;
    ${NOISE}
    vec4 over(vec4 dst, vec4 src){
      float a = src.a + dst.a * (1.0 - src.a);
      vec3 c = (src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / max(a, 1e-4);
      return vec4(c, a);
    }
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      p.x *= uAspect;
      float r = length(p);
      vec4 acc = vec4(0.0);
      // smoke haze in the cabin
      if (uSmoke > 0.005) {
        float n = vnoise(p * 1.7 + vec2(uTime * 0.12, -uTime * 0.07)) * 0.6 + vnoise(p * 4.1 - uTime * 0.2) * 0.4;
        acc = over(acc, vec4(0.13, 0.115, 0.10, uSmoke * (0.20 + 0.55 * n)));
      }
      // red-out at the edges (emergency)
      acc = over(acc, vec4(0.85, 0.03, 0.02, uRed * smoothstep(0.6, 2.0, r) * 0.5));
      // blackout tunnel vision (G-LOC) + permanent faint lens vignette
      float R = mix(2.6, 0.05, smoothstep(0.0, 1.0, uBlackout));
      float vig = smoothstep(R - 0.75, R, r);
      vig = max(vig, smoothstep(0.55, 1.0, uBlackout) * 0.94);
      vig = max(vig, uVig * smoothstep(0.8, 2.1, r) * 0.55);
      acc = over(acc, vec4(0.0, 0.0, 0.0, clamp(vig, 0.0, 1.0)));
      acc = over(acc, vec4(1.0, 0.97, 0.9, uFlash));
      acc = over(acc, vec4(1.0, 1.0, 1.0, uFadeWhite));
      acc = over(acc, vec4(0.0, 0.0, 0.0, uFadeBlack));
      if (uUI > 0.001) {
        vec4 ui = texture2D(tUI, vUv);
        acc = over(acc, vec4(ui.rgb, ui.a * uUI));
      }
      gl_FragColor = acc;
      #include <colorspace_fragment>
    }`,
};

// ---------------------------------------------------------------------------------------------
// Cel-shaded mobile suit bodies (CR-002 item 15c): hard three-band lighting from the dusk sun, a cool sky rim,
// a small hard specular, plus an inverted-hull outline pass (BackSide mesh pushed out along smoothed normals).
export const toon = {
  vertex: /* glsl */ `
    attribute float glow;            // optional (Penelope mesh): 1 on emissive materials; other geometries read 0
    varying vec3 vWN;
    varying vec3 vCol;
    varying vec3 vWV;
    varying float vGlow;
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWN = normalize(mat3(modelMatrix) * normal);
      vCol = color;
      vGlow = glow;
      vWV = cameraPosition - w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragment: /* glsl */ `
    uniform vec3 uSun;
    uniform float uThermal, uHeat, uFlash, uDmg, uNight;
    varying vec3 vWN;
    varying vec3 vCol;
    varying vec3 vWV;
    varying float vGlow;
    void main(){
      vec3 N = normalize(vWN);
      vec3 V = normalize(vWV);
      float l = dot(N, uSun);
      float lit = smoothstep(0.02, 0.09, l);
      float mid = smoothstep(-0.48, -0.40, l);
      vec3 col = mix(vCol * vec3(0.26, 0.30, 0.52), vCol * vec3(0.58, 0.58, 0.76), mid);
      col = mix(col, vCol * vec3(1.25, 1.0, 0.82), lit);
      float s = pow(max(dot(reflect(-uSun, N), V), 0.0), 26.0);
      col += step(0.55, s) * vec3(1.0, 0.8, 0.55) * 0.35 * lit;
      float rim = smoothstep(0.64, 0.72, 1.0 - max(dot(N, V), 0.0));
      col += vec3(0.20, 0.30, 0.65) * rim * (0.25 + 0.5 * (1.0 - lit));
      if (uNight > 0.001) {
        vec3 nc = vCol * mix(vec3(0.15, 0.17, 0.24), vec3(0.66, 0.72, 0.88), lit) + vec3(0.12, 0.14, 0.20) * rim;
        nc += vec3(0.7, 0.78, 0.95) * step(0.55, s) * 0.3 * lit;
        col = mix(col, nc, uNight);
      }
      col = mix(col, vCol * 1.15 + 0.1, vGlow);
      col = mix(col, col * vec3(0.30, 0.27, 0.26), uDmg);
      col += vec3(1.0, 0.85, 0.7) * uFlash;
      col = mix(col, vec3(0.5 + 0.42 * uHeat) * 0.55, uThermal);
      gl_FragColor = vec4(col, 1.0);
    }`,
};
export const toonOutline = {
  vertex: /* glsl */ `
    uniform float uPixAng, uScale;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vec3 vn = normalize(normalMatrix * normal);
      float w = clamp(-mv.z * uPixAng * 1.5, 0.07 * uScale, 0.32 * uScale);
      mv.xyz += vn * w;
      gl_Position = projectionMatrix * mv;
    }`,
  fragment: /* glsl */ `
    uniform float uThermal;
    void main(){ gl_FragColor = vec4(mix(vec3(0.010, 0.012, 0.030), vec3(0.0), uThermal), 1.0); }`,
};
