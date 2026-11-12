// Chapter 3 land (state.world.terrain === 'oenbili'): West Arnhem Land around Oenbili, built from the SAME height function
// the sim collides with (sim/lands/oenbili.js). Built lazily the first time the land is needed.
//   - fine mesh: 100 m cells over the playable relief (river, billabongs, escarpment, outliers, the gorge and the pad) -
//     exactly the sim's baked grid and triangle split, so the Xi stands where the ground is drawn
//   - coarse mesh: 400 m cells over the rest of the +-32 km grid (coast and floodplain), with a skirt hiding the seam
//   - apron: 2 km cells out to +-64 km, a little lower, so the land runs into the haze instead of ending
//   - land mask: the sea shader discards where land stands above the water (no z-fighting on the flat coast)
//   - props: the town's roofs (only ever seen from a distance), the rebels' pad, sheds, nets and fuel drums, the green
//     smoke they light once they show themselves
// Shading: its own material - soft dusk bands from smoothed normals, the same distance fog as the sea, a dark slate in
// thermal (land must not glow like a target), the night palette.
import * as THREE from 'three';
import { NOISE, SKY } from './shaders.js';
import { sample, classAt, bake, GRID, PAD_H } from '../sim/lands/oenbili.js';
import { OENBILI as OB } from '../sim/tuning.js';

const FINE = { x0: -17200, x1: 20000, z0: -17200, z1: 17200 };   // 100 m mesh = the sim grid (bounds on the 400 m lattice)
const COARSE = 400, APRON = 2000, APRON_HALF = 64000, MASK_HALF = 64000, MASK_N = 1024;

// class colours (linear)
const CLS = [
  [0.020, 0.050, 0.060],   // 0 water / sea floor
  [0.230, 0.200, 0.160],   // 1 mud flat
  [0.045, 0.090, 0.045],   // 2 mangrove
  [0.150, 0.165, 0.060],   // 3 floodplain grass (dry season: straw and olive)
  [0.075, 0.130, 0.065],   // 4 wet grass
  [0.140, 0.110, 0.060],   // 5 savanna woodland
  [0.450, 0.180, 0.085],   // 6 sandstone
  [0.300, 0.270, 0.230],   // 7 town ground
  [0.320, 0.300, 0.270],   // 8 pad
];

const VERT = /* glsl */ `
  attribute vec3 color;
  varying vec3 vC; varying vec3 vN; varying vec3 vW;
  void main(){
    vC = color; vN = normalize(normal);
    vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const FRAG = /* glsl */ `
  varying vec3 vC; varying vec3 vN; varying vec3 vW;
  uniform vec3 uCam;
  ${NOISE}
  ${SKY}
  void main(){
    vec3 toP = vW - uCam; float dist = length(toP); vec3 V = toP / dist;
    vec3 n = normalize(vN);
    // dusk light: soft bands from the low sun, sky fill from above
    float l = dot(n, normalize(uSunDir));
    float band = smoothstep(-0.25, 0.05, l) * 0.55 + smoothstep(0.05, 0.35, l) * 0.45;
    float fill = 0.42 + 0.30 * n.y;
    vec3 warm = mix(vec3(1.0, 0.62, 0.42), vec3(0.62, 0.70, 0.95), uNight);
    float grain = 0.88 + 0.24 * vnoise(vW.xz * 0.045) * vnoise(vW.xz * 0.006 + 3.1);
    vec3 col = vC * grain * (fill * vec3(0.26, 0.29, 0.42) + band * warm * 0.92);   // dusk: dim, warm on the sunlit side
    // night: moonlit, desaturated and dark
    col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))) * vec3(0.55, 0.62, 0.85) * 0.5, 0.9 * uNight);
    // thermal: cool ground, a little warmer on sunlit rock
    col = mix(col, vec3(0.045 + 0.03 * band), uThermal);
    float fog = 1.0 - exp(-dist / mix(24000.0, 15000.0, uNight));
    col = mix(col, skyColor(V), fog);
    col += (hash21(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }`;

function grassGeo(cols, rows, x0, z0, step, heightFn, colourFn, skip) {
  const nV = (cols + 1) * (rows + 1);
  const pos = new Float32Array(nV * 3), col = new Float32Array(nV * 3);
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const x = x0 + i * step, z = z0 + j * step, k = j * (cols + 1) + i, h = heightFn(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
  }
  const idx = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (skip && skip(x0 + (i + 0.5) * step, z0 + (j + 0.5) * step)) continue;
    const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);                         // (00, 01, 10) and (10, 01, 11): the sim's diagonal
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // colours from class, using the smoothed normal for slope
  const nrm = g.attributes.normal.array;
  for (let k = 0; k < nV; k++) {
    const x = pos[k * 3], h = pos[k * 3 + 1], z = pos[k * 3 + 2];
    const slope = Math.sqrt(Math.max(0, 1 - nrm[k * 3 + 1] * nrm[k * 3 + 1]));
    const c = colourFn(x, z, h, slope);
    col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

function colourAt(x, z, h, slope) {
  const c = CLS[classAt(x, z, h, slope)];
  // speckle woodland and grass so the plains read at speed
  const s = 0.85 + 0.3 * ((Math.sin(x * 0.0123 + z * 0.0071) * 43758.5453) % 1 + 1) % 1;
  return [c[0] * s, c[1] * s, c[2] * s];
}

export function createLand({ scene, uniforms }) {
  const U = uniforms;
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  let built = false;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: U.uSunDir, uThermal: U.uThermal, uNight: U.uNight, uCam: U.uCam },
    vertexShader: VERT, fragmentShader: FRAG,
  });
  const smokeMats = [];
  const smoke = new THREE.Group();

  function build() {
    built = true;
    const g = bake();
    const n = g.n, a = g.a, half = GRID.half, cell = GRID.cell;
    const gridH = (x, z) => { const i = Math.round((x + half) / cell), j = Math.round((z + half) / cell); return a[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))]; };
    // fine mesh: exactly the sim's grid
    const fc = Math.round((FINE.x1 - FINE.x0) / cell), fr = Math.round((FINE.z1 - FINE.z0) / cell);
    const fine = new THREE.Mesh(grassGeo(fc, fr, FINE.x0, FINE.z0, cell, gridH, colourAt), mat);
    fine.frustumCulled = false;
    group.add(fine);
    // skirt around the fine mesh (hides the seam with the coarse mesh)
    {
      const P = [], C2 = [];
      const edge = [];
      for (let i = 0; i <= fc; i++) edge.push([FINE.x0 + i * cell, FINE.z0]);
      for (let j = 1; j <= fr; j++) edge.push([FINE.x1, FINE.z0 + j * cell]);
      for (let i = fc - 1; i >= 0; i--) edge.push([FINE.x0 + i * cell, FINE.z1]);
      for (let j = fr - 1; j >= 0; j--) edge.push([FINE.x0, FINE.z0 + j * cell]);
      for (let k = 0; k < edge.length - 1; k++) {
        const [x0, z0] = edge[k], [x1, z1] = edge[k + 1], h0 = gridH(x0, z0), h1 = gridH(x1, z1);
        P.push(x0, h0, z0, x1, h1, z1, x0, h0 - 160, z0, x1, h1, z1, x1, h1 - 160, z1, x0, h0 - 160, z0);   // deep enough for the relief
        const c = colourAt(x0, z0, h0, 0.8);
        for (let t = 0; t < 6; t++) C2.push(c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      sg.setAttribute('color', new THREE.Float32BufferAttribute(C2, 3));
      sg.computeVertexNormals();
      const skirt = new THREE.Mesh(sg, new THREE.ShaderMaterial({ uniforms: mat.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide }));
      skirt.frustumCulled = false;
      group.add(skirt);
    }
    // coarse mesh over the rest of the grid
    const cc = Math.round((2 * half) / COARSE);
    const inFine = (x, z) => x > FINE.x0 && x < FINE.x1 && z > FINE.z0 && z < FINE.z1;
    const coarse = new THREE.Mesh(grassGeo(cc, cc, -half, -half, COARSE, (x, z) => gridH(x, z) - 0.6, colourAt, inFine), mat);
    coarse.frustumCulled = false;
    group.add(coarse);
    // apron out to the haze, 15 m low (so it never shows through the grid where they overlap)
    const ac = Math.round((2 * APRON_HALF) / APRON);
    const inGrid = (x, z) => Math.abs(x) < half && Math.abs(z) < half;   // no overlap with the grid (its edge has a skirt)
    const apron = new THREE.Mesh(grassGeo(ac, ac, -APRON_HALF, -APRON_HALF, APRON, (x, z) => sample(x, z) - 15, colourAt, inGrid), mat);
    apron.frustumCulled = false;
    group.add(apron);
    // skirt down from the grid's outer edge, so the step to the lower, coarser apron never shows the sky
    {
      const P = [], C2 = [], e = [];
      for (let i = 0; i <= cc; i++) e.push([-half + i * COARSE, -half]);
      for (let j = 1; j <= cc; j++) e.push([half, -half + j * COARSE]);
      for (let i = cc - 1; i >= 0; i--) e.push([-half + i * COARSE, half]);
      for (let j = cc - 1; j >= 0; j--) e.push([-half, -half + j * COARSE]);
      for (let k = 0; k < e.length - 1; k++) {
        const [x0, z0] = e[k], [x1, z1] = e[k + 1], h0 = gridH(x0, z0) - 0.6, h1 = gridH(x1, z1) - 0.6;
        P.push(x0, h0, z0, x1, h1, z1, x0, h0 - 300, z0, x1, h1, z1, x1, h1 - 300, z1, x0, h0 - 300, z0);
        const c = colourAt(x0, z0, h0, 0.8);
        for (let t = 0; t < 6; t++) C2.push(c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      sg.setAttribute('color', new THREE.Float32BufferAttribute(C2, 3));
      sg.computeVertexNormals();
      const outer = new THREE.Mesh(sg, new THREE.ShaderMaterial({ uniforms: mat.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide }));
      outer.frustumCulled = false;
      group.add(outer);
    }
    // land mask for the sea: 1 where the ground stands above the water
    const m = new Uint8Array(MASK_N * MASK_N);
    const mstep = (2 * MASK_HALF) / MASK_N;
    for (let j = 0; j < MASK_N; j++) {
      const z = -MASK_HALF + (j + 0.5) * mstep;
      for (let i = 0; i < MASK_N; i++) {
        const x = -MASK_HALF + (i + 0.5) * mstep;
        const h = Math.abs(x) < half && Math.abs(z) < half ? gridH(x, z) : sample(x, z);
        m[j * MASK_N + i] = h > 0.4 ? 255 : 0;
      }
    }
    const tex = new THREE.DataTexture(m, MASK_N, MASK_N, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    if (U.uLand) U.uLand.value = tex;
    // props
    buildProps();
  }

  function buildProps() {
    const P = [];
    const box = (x, y, z, w, h, d, c, ry = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (ry) g.rotateY(ry);
      g.translate(x, y + h / 2, z);
      const nV = g.attributes.position.count, col = new Float32Array(nV * 3);
      for (let k = 0; k < nV; k++) { col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2]; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      P.push(g.toNonIndexed());
    };
    // the town: a scatter of small houses with pale roofs, seen from far away only
    for (let k = 0; k < 70; k++) {
      const a = k * 2.399, r = 120 + 22 * Math.sqrt(k) * 7;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.8, y = sample(x, z);
      if (y < 1) continue;
      const roof = (k % 3 === 0) ? [0.55, 0.20, 0.12] : (k % 3 === 1) ? [0.60, 0.62, 0.64] : [0.30, 0.42, 0.50];
      box(x, y, z, 11, 3.2, 8, [0.62, 0.58, 0.50], a);
      box(x, y + 3.2, z, 12, 0.6, 9, roof, a);
    }
    // the rebels' pad: concrete apron with markings, two sheds under nets, fuel drums, an antenna mast
    const [bx, bz] = OB.base, py = PAD_H;
    box(bx, py - 0.5, bz, 110, 1.1, 110, [0.36, 0.34, 0.31]);                       // top 0.6 m above the ground (no z-fight)
    for (let i = -2; i <= 2; i++) box(bx + i * 18, py + 0.6, bz, 1.2, 0.3, 70, [0.75, 0.62, 0.18]);
    box(bx - 80, py, bz + 40, 30, 9, 22, [0.30, 0.27, 0.22], 0.3);
    box(bx - 80, py + 9, bz + 40, 34, 0.8, 26, [0.20, 0.24, 0.14], 0.3);
    box(bx + 70, py, bz - 55, 24, 7, 18, [0.32, 0.28, 0.22], -0.4);
    box(bx + 70, py + 7, bz - 55, 28, 0.8, 22, [0.20, 0.24, 0.14], -0.4);
    for (let k = 0; k < 9; k++) box(bx - 45 + (k % 3) * 2.2, py, bz - 60 + Math.floor(k / 3) * 2.2, 1.3, 1.9, 1.3, [0.22, 0.30, 0.20]);
    box(bx + 40, py, bz + 58, 1.2, 38, 1.2, [0.55, 0.55, 0.55]);
    const merged = mergeList(P);
    const props = new THREE.Mesh(merged, new THREE.ShaderMaterial({ uniforms: mat.uniforms, vertexShader: VERT, fragmentShader: FRAG }));
    props.frustumCulled = false;
    group.add(props);
    // green smoke: soft additive puffs rising off the pad (shown once the rebels reveal themselves)
    for (let k = 0; k < 14; k++) {
      const m2 = new THREE.MeshBasicMaterial({ color: 0x3a9a4a, transparent: true, opacity: 0.0, depthWrite: false });
      smokeMats.push(m2);
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), m2);
      s.userData.k = k;
      smoke.add(s);
    }
    smoke.position.set(bx + 95, py, bz + 70);             // at the pad's edge, clear of where the Xi sets down
    smoke.visible = false;
    group.add(smoke);
  }

  function mergeList(list) {
    let total = 0;
    for (const g of list) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (const g of list) { pos.set(g.attributes.position.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  let t = 0;
  function update(dt, state) {
    const on = !!(state.world && state.world.terrain === 'oenbili');
    group.visible = on;
    if (U.uLandOn) U.uLandOn.value = on ? 1 : 0;
    if (!on) return;
    if (!built) build();
    t += dt;
    const ob = state.story && state.story.ob;
    smoke.visible = !!(ob && ob.revealed);
    if (smoke.visible) {
      smoke.children.forEach((s) => {
        const k = s.userData.k, life = ((t * 0.12 + k / 14) % 1);
        s.position.set(Math.sin(k * 1.7 + t * 0.2) * 6 * life + 40 * life, 6 + life * 140, Math.cos(k * 2.3) * 5 * life);
        s.scale.setScalar(4 + life * 22);
        smokeMats[k].opacity = 0.3 * Math.sin(Math.PI * life);
      });
    }
  }
  return { update };
}
