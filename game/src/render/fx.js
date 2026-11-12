// GPU-driven effect batches: age-animated particles (smoke / fire), per-frame glow sprites and beam ribbons.
// Everything is instanced quads: ONE draw call per batch, no per-particle objects, no allocations per frame.
import * as THREE from 'three';
import { quads, beams } from './shaders.js';
import { clamp } from './util.js';

const R = Math.random;

function makeQuadGeometry(capacity, extra) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const attrs = {};
  for (const [name, size] of extra) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    attrs[name] = a;
  }
  geo.instanceCount = 0;
  return { geo, attrs };
}

// ---------------------------------------------------------------------------------------------
export class QuadBatch {
  // mode: 0 smoke (normal blend), 1 fire (additive), 2 glow (additive, rewritten every frame)
  constructor(scene, { capacity, mode, uniforms, drag = 0.0001, renderOrder = 10 }) {
    this.cap = capacity;
    this.mode = mode;
    const { geo, attrs } = makeQuadGeometry(capacity, [
      ['iPos', 3], ['iVel', 3], ['iSize', 2], ['iColor', 4], ['iTime', 3],
    ]);
    this.geo = geo;
    this.a = attrs;
    this.head = 0;
    this.n = 0;
    this.dirty = false;
    // dead on arrival: birth far in the past, life 1 s
    for (let i = 0; i < capacity; i++) attrs.iTime.array[i * 3] = -1e5, attrs.iTime.array[i * 3 + 1] = 1;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uNow: uniforms.uNow,
        uThermal: uniforms.uThermal,
        uDrag: { value: drag },
        uMode: { value: mode },
      },
      vertexShader: quads.vertex,
      fragmentShader: quads.fragment,
      transparent: true,
      depthWrite: false,
      blending: mode === 0 ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
    if (mode !== 2) geo.instanceCount = capacity;
    this.now = uniforms.uNow;
  }
  write(i, px, py, pz, vx, vy, vz, s0, s1, r, g, b, a, birth, life, seed) {
    const A = this.a;
    let k = i * 3;
    A.iPos.array[k] = px; A.iPos.array[k + 1] = py; A.iPos.array[k + 2] = pz;
    A.iVel.array[k] = vx; A.iVel.array[k + 1] = vy; A.iVel.array[k + 2] = vz;
    A.iTime.array[k] = birth; A.iTime.array[k + 1] = life; A.iTime.array[k + 2] = seed;
    k = i * 2;
    A.iSize.array[k] = s0; A.iSize.array[k + 1] = s1;
    k = i * 4;
    A.iColor.array[k] = r; A.iColor.array[k + 1] = g; A.iColor.array[k + 2] = b; A.iColor.array[k + 3] = a;
    this.dirty = true;
  }
  // persistent particle (ring buffer)
  spawn(px, py, pz, vx, vy, vz, s0, s1, r, g, b, a, life) {
    this.write(this.head, px, py, pz, vx, vy, vz, s0, s1, r, g, b, a, this.now.value, life, R());
    this.head = (this.head + 1) % this.cap;
  }
  // per-frame glow API (mode 2)
  begin() { this.n = 0; }
  add(px, py, pz, size, r, g, b, a) {
    if (this.n >= this.cap) return;
    this.write(this.n++, px, py, pz, 0, 0, 0, size, size, r, g, b, a, this.now.value, 1e6, 0.5);
  }
  end() {
    this.geo.instanceCount = this.n;
    this.flush();
  }
  flush() {
    if (!this.dirty) return;
    for (const k in this.a) this.a[k].needsUpdate = true;
    this.dirty = false;
  }
}

// ---------------------------------------------------------------------------------------------
export class BeamBatch {
  // Live ribbons are rewritten every frame (begin/add/end). With ring=true the same geometry is a ring buffer of
  // trail segments written once at spawn; the shader ages them from (birth, life).
  constructor(scene, material, capacity = 160, ring = false) {
    this.cap = capacity;
    const { geo, attrs } = makeQuadGeometry(capacity, [
      ['iA', 3], ['iB', 3], ['iW', 1], ['iOuter', 3], ['iCore', 3], ['iP', 4],
    ]);
    this.geo = geo;
    this.a = attrs;
    this.n = 0;
    this.head = 0;
    this.dirty = false;
    if (ring) {
      for (let i = 0; i < capacity; i++) { attrs.iP.array[i * 4] = -1e5; attrs.iP.array[i * 4 + 1] = 1; }
      geo.instanceCount = capacity;
    }
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = ring ? 11.5 : 12;
    scene.add(this.mesh);
  }
  _w(i, ax, ay, az, bx, by, bz, halfW, or, og, ob, cr, cg, cb, birth, life, crackle, minPx) {
    const A = this.a;
    let k = i * 3;
    A.iA.array[k] = ax; A.iA.array[k + 1] = ay; A.iA.array[k + 2] = az;
    A.iB.array[k] = bx; A.iB.array[k + 1] = by; A.iB.array[k + 2] = bz;
    A.iOuter.array[k] = or; A.iOuter.array[k + 1] = og; A.iOuter.array[k + 2] = ob;
    A.iCore.array[k] = cr; A.iCore.array[k + 1] = cg; A.iCore.array[k + 2] = cb;
    A.iW.array[i] = halfW;
    k = i * 4;
    A.iP.array[k] = birth; A.iP.array[k + 1] = life; A.iP.array[k + 2] = crackle; A.iP.array[k + 3] = minPx;
  }
  begin() { this.n = 0; }
  // live ribbon. halfW = half width of the glow quad (m); minPx = minimum on-screen half width (px)
  add(ax, ay, az, bx, by, bz, halfW, or, og, ob, cr, cg, cb, crackle = 0.6, minPx = 2) {
    if (this.n >= this.cap) return;
    this._w(this.n++, ax, ay, az, bx, by, bz, halfW, or, og, ob, cr, cg, cb, 0, 0, crackle, minPx);
  }
  end() {
    this.geo.instanceCount = this.n;
    for (const k in this.a) this.a[k].needsUpdate = true;
  }
  // trail segment (ring buffer)
  spawn(ax, ay, az, bx, by, bz, halfW, or, og, ob, cr, cg, cb, birth, life, seed, minPx) {
    this._w(this.head, ax, ay, az, bx, by, bz, halfW, or, og, ob, cr, cg, cb, birth, life, seed, minPx);
    this.head = (this.head + 1) % this.cap;
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    for (const k in this.a) this.a[k].needsUpdate = true;
    this.dirty = false;
  }
}

// ---------------------------------------------------------------------------------------------
export class Effects {
  constructor(scene, thermalUniform) {
    this.time = 0;
    this.uniforms = { uNow: { value: 0 }, uThermal: thermalUniform };
    this.smoke = new QuadBatch(scene, { capacity: 2600, mode: 0, uniforms: this.uniforms, drag: 0.7, renderOrder: 8 });
    this.fire = new QuadBatch(scene, { capacity: 1400, mode: 1, uniforms: this.uniforms, drag: 1.1, renderOrder: 11 });
    this.glow = new QuadBatch(scene, { capacity: 512, mode: 2, uniforms: this.uniforms, renderOrder: 13 });
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uNow: this.uniforms.uNow, uPixAng: { value: 0.002 } },
      vertexShader: beams.vertex,
      fragmentShader: beams.fragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beams = new BeamBatch(scene, this.beamMat, 160, false);
    this.trails = new BeamBatch(scene, this.beamMat, 1800, true);
    this.ring = new QuadBatch(scene, { capacity: 48, mode: 3, uniforms: this.uniforms, drag: 0.0001, renderOrder: 12.6 });
    this.burst = new QuadBatch(scene, { capacity: 96, mode: 4, uniforms: this.uniforms, drag: 0.8, renderOrder: 12.7 });
  }
  update(dt) {
    this.time += dt;
    this.uniforms.uNow.value = this.time;
    this.smoke.flush();
    this.fire.flush();
    this.trails.flush();
    this.ring.flush();
    this.burst.flush();
  }
  // size 1 small .. 3 huge. Fireball (banded fire sprites) + shock ring + dark cel smoke that billows and rises.
  explosion(x, y, z, size) {
    const s = clamp(size || 1, 0.5, 4);
    const f = this.fire, sm = this.smoke;
    f.spawn(x, y, z, 0, 0, 0, 30 * s, 110 * s, 1, 1, 1, 1.0, 0.24);               // flash
    f.spawn(x, y, z, 0, 0, 0, 18 * s, 70 * s, 1, 0.9, 0.7, 1.0, 0.55);            // core fireball
    const nf = Math.round(10 + 8 * s);
    for (let i = 0; i < nf; i++) {
      const th = R() * 6.2832, ph = Math.acos(2 * R() - 1);
      const sp = (14 + 50 * R()) * Math.pow(s, 0.7);
      f.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp,
        (9 + 6 * R()) * s, (34 + 24 * R()) * s, 1, 1, 1, 0.95, 0.5 + R() * 1.0);
    }
    for (let i = 0; i < 8 * s; i++) {                                              // sparks / debris
      const th = R() * 6.2832, ph = Math.acos(2 * R() - 1);
      const sp = 80 + 160 * R();
      f.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp,
        2.2 * s, 0.4, 1, 0.9, 0.6, 1, 0.5 + R() * 0.8);
    }
    this.ring.spawn(x, y, z, 0, 0, 0, 20 * s, 150 * s, 1.0, 0.6, 0.25, 1, 0.7);    // shock ring
    const ns = Math.round(9 + 8 * s);
    for (let i = 0; i < ns; i++) {                                                 // billowing smoke
      const th = R() * 6.2832, ph = Math.acos(2 * R() - 1);
      const sp = (5 + 24 * R()) * s;
      const g = 0.06 + R() * 0.06;
      sm.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp * 0.7 + 8 * s, Math.sin(ph) * Math.sin(th) * sp,
        16 * s, (60 + 34 * R()) * s, g * 1.25, g, g * 0.9, 0.9, 3.5 + R() * 3.5);
    }
    for (let i = 0; i < 4 + 2 * s; i++) {                                          // lingering lit smoke crown
      const th = R() * 6.2832;
      sm.spawn(x, y, z, Math.cos(th) * 10 * s, 22 * s + 10 * R(), Math.sin(th) * 10 * s,
        10 * s, 50 * s, 0.30, 0.17, 0.12, 0.8, 5 + R() * 2);
    }
  }
  spark(x, y, z, n = 8) {
    const f = this.fire;
    f.spawn(x, y, z, 0, 0, 0, 5, 14, 1, 1, 1, 1, 0.12);
    for (let i = 0; i < n; i++) {
      const th = R() * 6.2832, ph = Math.acos(2 * R() - 1), sp = 30 + 90 * R();
      f.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp,
        1.4, 0.3, 1, 0.8, 0.5, 1, 0.3 + R() * 0.4);
    }
  }
  muzzle(x, y, z, size) {
    this.fire.spawn(x, y, z, 0, 0, 0, size, size * 0.3, 1, 0.85, 0.7, 1, 0.12);
  }
  // film-style beam muzzle: tinted flash + shock ring (colour rgb in linear)
  beamMuzzle(x, y, z, size, r, g, b) {
    // soft saturated bloom puff (reference 16), then the tight flash on top
    this.burst.spawn(x, y, z, 0, 0, 0, size * 1.1, size * 3.0, r, g, b, 0.55, 0.45);
    this.burst.spawn(x, y, z, 0, 0, 0, size * 0.9, size * 2.2, r, g, b, 1, 0.28);
    this.burst.spawn(x, y, z, 0, 0, 0, size * 0.4, size * 0.9, 1, 1, 1, 1, 0.12);
    this.ring.spawn(x, y, z, 0, 0, 0, size * 0.3, size * 1.5, r, g, b, 1, 0.4);
  }
  // beam impact: big tinted-white burst, ring, sparks
  beamImpact(x, y, z, size, r, g, b) {
    this.burst.spawn(x, y, z, 0, 0, 0, size * 0.6, size * 3.0, r, g, b, 1, 0.55);
    this.burst.spawn(x, y, z, 0, 0, 0, size * 0.3, size * 1.4, 1, 1, 1, 1, 0.22);
    this.ring.spawn(x, y, z, 0, 0, 0, size * 0.8, size * 5.0, r, g, b, 1, 0.6);
    for (let i = 0; i < 10; i++) {
      const th = R() * 6.2832, ph = Math.acos(2 * R() - 1), sp = 60 + 140 * R();
      this.burst.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp,
        size * 0.12, size * 0.02, r * 0.6 + 0.4, g * 0.6 + 0.4, b * 0.6 + 0.4, 1, 0.3 + R() * 0.4);
    }
  }
}
