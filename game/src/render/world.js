// The outside world: dusk sky dome, animated ocean, two cloud decks, cumulus puffs, wind streaks, lights.
// World coordinates: +Y up, sea at y = state.world.seaLevel. The camera is placed at the player by index.js.
import * as THREE from 'three';
import { skyDome, ocean, cloudDeck, puffs, streaks } from './shaders.js';
import { num, isVec, smoothstep, damp } from './util.js';

const PLANE = 190000;

export function createWorld(state) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(90, 16 / 9, 1, 160000);
  camera.rotation.order = 'YXZ';

  // uniforms shared by several materials ------------------------------------------------------
  const U = {
    uSunDir: { value: new THREE.Vector3(-0.6, 0.12, -0.78).normalize() },
    uThermal: { value: 0 },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uPixAng: { value: 0.002 },
    uPlayer: { value: new THREE.Vector3() },
    uVel: { value: new THREE.Vector3() },
    // lower cloud deck: shared with the sea shader (reflection + cloud shadow) so the water matches the sky
    uDeckY: { value: 2600 },
    uDeckCover: { value: 0.47 },
    uDeckSeed: { value: 3.1 },
    uDeckWind: { value: new THREE.Vector2(9, 3) },
    uLowQ: { value: 0 },
  };

  // sky ------------------------------------------------------------------------------------------
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 20),
    new THREE.ShaderMaterial({
      uniforms: { uSunDir: U.uSunDir, uThermal: U.uThermal, uNight: U.uNight },
      vertexShader: skyDome.vertex,
      fragmentShader: skyDome.fragment,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  scene.add(dome);

  // ocean ----------------------------------------------------------------------------------------
  const seaGeo = new THREE.PlaneGeometry(1, 1);
  seaGeo.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(
    seaGeo,
    new THREE.ShaderMaterial({
      uniforms: { uSunDir: U.uSunDir, uThermal: U.uThermal, uNight: U.uNight, uTime: U.uTime, uCam: U.uCam, uPixAng: U.uPixAng,
        uDeckY: U.uDeckY, uDeckCover: U.uDeckCover, uDeckSeed: U.uDeckSeed, uDeckWind: U.uDeckWind, uLowQ: U.uLowQ },
      vertexShader: ocean.vertex,
      fragmentShader: ocean.fragment,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 4,
    }),
  );
  sea.scale.set(PLANE, 1, PLANE);
  sea.frustumCulled = false;
  scene.add(sea);

  // cloud sheets: a thick stratocumulus layer BELOW the usual flight altitude (three thin sheets stacked with a rising
  // coverage threshold => volume + parallax, gaps show the sea) and a thin high alto layer ABOVE ----------------------
  function deck(alt, cover, seed, wind, order, k, alpha, scale) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: U.uSunDir, uThermal: U.uThermal, uNight: U.uNight, uTime: U.uTime, uCam: U.uCam, uLowQ: U.uLowQ,
          uCover: { value: cover }, uSeed: { value: seed }, uWind: { value: new THREE.Vector2(wind[0], wind[1]) },
          uK: { value: k }, uAlpha: { value: alpha }, uScale: { value: scale },
        },
        vertexShader: cloudDeck.vertex,
        fragmentShader: cloudDeck.fragment,
        transparent: true,
        depthWrite: false,
      }),
    );
    m.scale.set(PLANE, 1, PLANE);
    m.userData.alt = alt;
    m.userData.order = order;
    m.renderOrder = order;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  }
  const LOW_ALT = 2600;
  const decks = [
    deck(LOW_ALT, 0.47, 3.1, [9, 3], 1, 0.0, 0.80, 0.00022),
    deck(LOW_ALT + 70, 0.53, 3.1, [9, 3], 1.1, 0.5, 0.70, 0.00022),
    deck(LOW_ALT + 150, 0.59, 3.1, [9, 3], 1.2, 1.0, 0.62, 0.00022),
    deck(7800, 0.56, 9.4, [-5, 6], 2, 1.0, 0.62, 0.00031),
  ];

  // cumulus: instanced soft billboards, grouped in towers (wide flat base, smaller lumps piled above), xz wrapped
  // around the player on the GPU. Seeded so the sky looks the same every run.
  let seedR = 1337;
  const rnd = () => { seedR = (seedR + 0x6d2b79f5) | 0; let t = Math.imul(seedR ^ (seedR >>> 15), 1 | seedR); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const H = 16000;
  const NC = 26, PER = 6;
  const NP = NC * PER;
  const pg = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  pg.index = quad.index;
  pg.setAttribute('position', quad.attributes.position);
  const iData = new Float32Array(NP * 4);
  const iRand = new Float32Array(NP * 2);
  let ip = 0;
  for (let c = 0; c < NC; c++) {
    const cx = rnd() * 2 * H, cz = rnd() * 2 * H;
    const base = LOW_ALT + 450 + rnd() * 1500;            // cloud base (flat bottom)
    const tower = 500 + rnd() * rnd() * 2600;             // how tall this one grows
    const rad = 500 + rnd() * 900;
    for (let k = 0; k < PER; k++) {
      const hgt = k === 0 ? 0 : rnd();
      const sz = (260 + rnd() * 380) * (1.25 - 0.55 * hgt) * (0.8 + tower / 3000);
      const ang = rnd() * 6.2832, rr = rad * Math.sqrt(rnd()) * (1 - 0.55 * hgt);
      iData[ip * 4] = (cx + Math.cos(ang) * rr + 2 * H) % (2 * H);
      iData[ip * 4 + 1] = base + hgt * tower + sz * 0.3;
      iData[ip * 4 + 2] = (cz + Math.sin(ang) * rr + 2 * H) % (2 * H);
      iData[ip * 4 + 3] = sz;
      iRand[ip * 2] = rnd();
      iRand[ip * 2 + 1] = rnd();
      ip++;
    }
  }
  // vec4 iData: (x, y, z, size); the shader reads xz + y + w
  pg.setAttribute('iData', new THREE.InstancedBufferAttribute(iData, 4));
  pg.setAttribute('iRand', new THREE.InstancedBufferAttribute(iRand, 2));
  pg.instanceCount = NP;
  const puffMat = new THREE.ShaderMaterial({
    uniforms: { uPlayer: U.uPlayer, uH: { value: H }, uSunDir: U.uSunDir, uThermal: U.uThermal, uNight: U.uNight },
    vertexShader: puffs.vertex,
    fragmentShader: puffs.fragment,
    transparent: true,
    depthWrite: false,
  });
  const puffMesh = new THREE.Mesh(pg, puffMat);
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 3;
  scene.add(puffMesh);

  // wind streaks -----------------------------------------------------------------------------------
  const NS = 220;
  const sPos = new Float32Array(NS * 6);
  const sSeed = new Float32Array(NS * 6);
  const sEnd = new Float32Array(NS * 2);
  for (let i = 0; i < NS; i++) {
    const a = Math.random(), b = Math.random(), c = Math.random();
    for (let k = 0; k < 2; k++) {
      sSeed[(i * 2 + k) * 3] = a; sSeed[(i * 2 + k) * 3 + 1] = b; sSeed[(i * 2 + k) * 3 + 2] = c;
      sEnd[i * 2 + k] = k;
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(sSeed, 3));
  sg.setAttribute('aEnd', new THREE.BufferAttribute(sEnd, 1));
  const streakU = { uPlayer: U.uPlayer, uVel: U.uVel, uLen: { value: 0.035 }, uAlpha: { value: 0 } };
  const streakMesh = new THREE.LineSegments(
    sg,
    new THREE.ShaderMaterial({
      uniforms: streakU,
      vertexShader: streaks.vertex,
      fragmentShader: streaks.fragment,
      transparent: true,
      depthWrite: false,
    }),
  );
  streakMesh.frustumCulled = false;
  streakMesh.renderOrder = 14;
  scene.add(streakMesh);

  // lights for lit entities (linear, physically scaled: ~pi * desired albedo multiplier) ------------
  const sun = new THREE.DirectionalLight(0xffa060, 3.0);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x3550a0, 0x0c1a26, 1.5);
  scene.add(hemi);

  let thermalK = 0;
  const _sun = new THREE.Vector3(), _moon = new THREE.Vector3();
  let nightFirst = true;
  const sunC = new THREE.Color(0xffa060), moonC = new THREE.Color(0x9db4e0), hemiSky = new THREE.Color(0x3550a0), hemiSkyN = new THREE.Color(0x12192c), hemiGr = new THREE.Color(0x0c1a26), hemiGrN = new THREE.Color(0x05070b);

  function update(dt, view) {
    // view = { pos: Vector3 (camera world pos), vel: Vector3, pixAng, thermal (0|1) }
    const w = state.world || {};
    // CR-004 night: smoothed 0..1 (a mode change fades over ~1.5 s; the first frame snaps). uSunDir carries the moon.
    const nt = w.night ? 1 : 0;
    U.uNight.value = nightFirst ? nt : damp(U.uNight.value, nt, 2.2, dt || 0.016);
    nightFirst = false;
    if (U.uNight.value < 0.002) U.uNight.value = nt ? U.uNight.value : 0;
    if (isVec(w.sunDir)) _sun.set(w.sunDir.x, w.sunDir.y, w.sunDir.z).normalize();
    else _sun.set(-0.6, 0.12, -0.78).normalize();
    if (isVec(w.moonDir) && U.uNight.value > 0.001) { _moon.set(w.moonDir.x, w.moonDir.y, w.moonDir.z).normalize(); _sun.lerp(_moon, Math.min(1, U.uNight.value * 4)).normalize(); }
    U.uSunDir.value.copy(_sun);
    U.uTime.value += dt;
    U.uCam.value.copy(view.pos);
    U.uPlayer.value.copy(view.pos);
    U.uVel.value.copy(view.vel);
    U.uPixAng.value = view.pixAng;
    thermalK = damp(thermalK, view.thermal, 10, dt || 0.016);
    U.uThermal.value = thermalK;

    const sea0 = num(w.seaLevel, 0);
    dome.position.copy(view.pos);
    sea.position.set(view.pos.x, sea0, view.pos.z);
    U.uDeckY.value = LOW_ALT + sea0;
    for (const d of decks) {
      d.position.set(view.pos.x, d.userData.alt + sea0, view.pos.z);
      // blend order: far-to-near for the sheets of one stack (bottom first when seen from above, top first from below)
      if (d.userData.order < 2) d.renderOrder = view.pos.y > d.position.y ? d.userData.order : 2.2 - d.userData.order;
    }

    const sp = view.vel.length();
    streakU.uAlpha.value = 0.32 * smoothstep(60, 260, sp);

    const nk = U.uNight.value;
    sun.color.copy(sunC).lerp(moonC, nk); sun.intensity = 3.0 + (1.2 - 3.0) * nk;
    hemi.color.copy(hemiSky).lerp(hemiSkyN, nk); hemi.groundColor.copy(hemiGr).lerp(hemiGrN, nk); hemi.intensity = 1.5 + (0.7 - 1.5) * nk;
    sun.position.copy(view.pos).addScaledVector(_sun, 1000);
    sun.target.position.copy(view.pos);
    // sun fades as it sinks / when the player's below the deck? keep constant: dusk is constant per contract
  }

  // Quality tiers (render/index.js picks one): 0 = the approved look; 1 = middle cloud sheet off, 70% of the cumulus;
  // 2 = only the bottom + alto sheets (a little denser), 3-octave cloud field, no cloud reflection in the sea, 45% cumulus.
  const alpha0 = decks[0].material.uniforms.uAlpha.value;
  function setTier(t) {
    t = t | 0;
    decks[0].visible = true; decks[3].visible = true;
    decks[1].visible = t < 1;
    decks[2].visible = t < 2;
    decks[0].material.uniforms.uAlpha.value = t >= 2 ? Math.min(1, alpha0 * 1.12) : alpha0;
    pg.instanceCount = Math.round(NP * (t >= 2 ? 0.45 : t === 1 ? 0.7 : 1));
    U.uLowQ.value = t >= 2 ? 1 : 0;
  }

  return { scene, camera, update, uniforms: U, setTier };
}
