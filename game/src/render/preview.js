// CR-005: rotating suit preview for the lobby suit cards.
//   const p = createSuitPreview(canvas, { suit: 'xi' });  p.setSuit('gustav');  p.dispose();
// Runs its OWN small WebGLRenderer on the given canvas (never the game renderer), draws only while the canvas is on screen
// and the tab is visible, at most 30 fps, pixel ratio capped at 1.5. Works before the game starts. dispose() stops the loop and
// releases the GL context and per-preview GPU objects (shared geometry / textures of the Xi stay cached for the game).
import * as THREE from 'three';
import { toon, toonOutline } from './shaders.js';
import { buildGustav, buildPenelope, outlineGeometry } from './models.js';
import { onXiReady, makeXiSuit } from './xiSuit.js';

export function createSuitPreview(canvas, opts = {}) {
  let renderer = null;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' }); } catch (e) { return { setSuit() {}, dispose() {} }; }
  renderer.setClearColor(0x05070b, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
  const root = new THREE.Group();
  scene.add(root);
  // a dim floor glow + a simple backdrop gradient (a big dark disc behind the suit)
  const back = new THREE.Mesh(new THREE.CircleGeometry(60, 40), new THREE.MeshBasicMaterial({ color: 0x0b1220 }));
  back.position.set(0, 0, -45); scene.add(back);

  const sun = { value: new THREE.Vector3(-0.55, 0.35, 0.75).normalize() };
  const night = { value: 0 }, thermal = { value: 0 };
  const shared = { sun, night, thermal };
  const pix = { value: 0.002 };
  const disposables = [];
  let current = null, suit = '', t = 0, last = performance.now(), acc = 0, raf = 0, alive = true, visible = true, size = [0, 0];

  const toonMat = () => new THREE.ShaderMaterial({
    uniforms: { uSun: sun, uNight: night, uThermal: thermal, uHeat: { value: 0.5 }, uFlash: { value: 0 }, uDmg: { value: 0 } },
    vertexShader: toon.vertex, fragmentShader: toon.fragment, vertexColors: true,
  });
  function addToon(group, geo, scale) {
    const m = new THREE.Mesh(geo, toonMat());
    const o = new THREE.Mesh(outlineGeometry(geo), new THREE.ShaderMaterial({
      uniforms: { uPixAng: pix, uScale: { value: scale }, uThermal: thermal }, vertexShader: toonOutline.vertex, fragmentShader: toonOutline.fragment, side: THREE.BackSide,
    }));
    m.frustumCulled = o.frustumCulled = false;
    group.add(o, m);
    disposables.push(m.material, o.material, o.geometry);
  }

  // fit the camera to the model height (xi: 28 m; gustav / penelope: bounding box of the built geometry)
  function fit(h) {
    const d = (h * 1.15) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    camera.position.set(0, h * 0.04, d); camera.lookAt(0, 0, 0);
    camera.near = d * 0.05; camera.far = d * 6; camera.updateProjectionMatrix();
    back.position.z = -d * 0.8; back.scale.setScalar(d / 40);
  }
  function build(s) {
    if (current) { root.remove(current); current = null; }
    suit = s;
    const g = new THREE.Group();
    let radius = 10;
    if (s === 'xi') {
      radius = 31;                                              // 28 m tall + room for the raised beam rifle
      onXiReady(() => {
        if (!alive || suit !== 'xi') return;
        const xi = makeXiSuit(shared);                          // CR-006: shown in the rifle-holding pose
        xi.pose(0, { raise: true, snap: true });
        xi.root.position.z = 3;                                 // the rifle reaches far forward: keep the turntable centred
        disposables.push(...xi.mats); g.add(xi.root);
      });
    } else {
      const built = s === 'penelope' ? buildPenelope('ms') : buildGustav();
      addToon(g, built.body, 1);
      for (const k of Object.keys(built.parts)) addToon(g, built.parts[k], 1);
      const bb = new THREE.Box3().setFromObject(g); const hh = bb.max.y - bb.min.y; radius = Math.max(hh, (bb.max.x - bb.min.x) * 0.9);
      const c = bb.getCenter(new THREE.Vector3()); g.position.set(-c.x, -c.y, -c.z); g.updateMatrixWorld(true);
    }
    current = g; root.add(g);
    fit(radius);
  }
  function resize() {
    const w = Math.max(2, Math.floor(canvas.clientWidth || 200)), h = Math.max(2, Math.floor(canvas.clientHeight || 260));
    if (w === size[0] && h === size[1]) return;
    size = [w, h];
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; }, { threshold: 0.01 }) : null;
  if (io) io.observe(canvas);

  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    const dt = (now - last) / 1000; last = now;
    if (document.hidden || !visible) return;
    acc += dt;
    if (acc < 1 / 30) return;
    t += acc; acc = 0;
    resize();
    root.rotation.y = t * 0.45;
    root.position.y = Math.sin(t * 0.8) * 0.15;
    renderer.render(scene, camera);
  }
  build(opts.suit || 'xi');
  raf = requestAnimationFrame(frame);

  return {
    setSuit(s) { if (alive && s !== suit) build(s); },
    dispose() {
      alive = false; cancelAnimationFrame(raf); if (io) io.disconnect();
      for (const d of disposables) d.dispose && d.dispose();
      back.geometry.dispose(); back.material.dispose();
      renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss();
    },
  };
}
