// Rendering layer entry point (doc 08 "Approach A").
//   1. world scene  -> MSAA render target, from the pilot's eye:  quaternion = player.quaternion * rig.camQuat
//   2. monitor pass -> default framebuffer (scanlines, Minovsky noise, sensor modes, dead sectors, seams, startup)
//   3. cockpit scene (own camera, depth cleared) on top: consoles, stick, hands, HUD sphere patch ... unaffected
//      by monitor effects
//   4. overlay pass: blackout tunnel, red-out, smoke haze, flashes, white/black fades, result card
// This module only READS `state`; all visual state (springs, timers, particles) lives in the render modules.
import * as THREE from 'three';
import { createWorld } from './world.js';
import { createEntities } from './entities.js';
import { createCameraRig } from './cameraRig.js';
import { createCockpit } from './cockpit.js';
import { createHud } from './hud.js';
import { createHatch } from './hatch.js';
import { createHudWrap } from './hudWrap.js';
import { createChase } from './chase.js';
import { createBoarding } from './boarding.js';
import { createSeawrack } from './seawrack.js';
import { createAboard } from './aboard.js';
import { createMonitorPass } from './monitorPass.js';
import { clamp, num, isVec, damp, perfCount } from './util.js';

// ---- quality ---------------------------------------------------------------------------------------------------------
//   ?quality=high|medium|low  forces a fixed level.  Default / ?quality=auto: starts at the `high` look and steps down a
//   ladder when the measured frame interval stays above ~21 ms (below ~48 fps), steps back up when there is headroom.
//   prCap  = max devicePixelRatio of the main buffer        rtCap = world render target size in CSS px multiples (max)
//   samples = MSAA of the world RT   tier = world.setTier()  hudDt = HUD canvas redraw+upload interval (0 = every frame)
//   aa = antialias on the default framebuffer (fixed at context creation)
const PRESETS = {
  high:   { prCap: 2,   rtCap: 1.5,  samples: 4, tier: 0, hudDt: 0,      aa: true },
  medium: { prCap: 1.5, rtCap: 1.0,  samples: 2, tier: 1, hudDt: 1 / 30, aa: false },
  low:    { prCap: 1,   rtCap: 0.75, samples: 0, tier: 2, hudDt: 1 / 30, aa: false },
};
// auto ladder: rt = multiplier on the preset's world RT size, pr = main buffer pixel ratio cap
const LADDER = [
  { rt: 1.0,  pr: 2,    tier: 0, samples: 4, hudDt: 0 },
  { rt: 0.85, pr: 2,    tier: 0, samples: 4, hudDt: 0 },
  { rt: 0.72, pr: 2,    tier: 0, samples: 4, hudDt: 1 / 30 },
  { rt: 0.6,  pr: 1.5,  tier: 0, samples: 2, hudDt: 1 / 30 },
  { rt: 0.6,  pr: 1.25, tier: 1, samples: 2, hudDt: 1 / 30 },
  { rt: 0.6,  pr: 1,    tier: 1, samples: 0, hudDt: 1 / 30 },
  { rt: 0.5,  pr: 1,    tier: 2, samples: 0, hudDt: 1 / 30 },
];

export function createRenderer(canvas, state) {
  const qParam = (new URLSearchParams(location.search).get('quality') || 'auto').toLowerCase();
  const auto = !PRESETS[qParam];
  const prOverride = parseFloat(new URLSearchParams(location.search).get('pr')) || 0;   // debug: pretend this devicePixelRatio
  const dprNow = prOverride || window.devicePixelRatio || 1;
  // auto: the default framebuffer only carries the monitor quad + cockpit; at DPR >= 1.5 MSAA there is not worth its cost
  const useAA = auto ? dprNow < 1.5 : PRESETS[qParam].aa;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: useAA, powerPreference: 'high-performance' });
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x000000, 1);

  const world = createWorld(state);
  const entities = createEntities(world.scene, state, world.uniforms.uThermal);
  const seawrack = createSeawrack({ scene: world.scene, uniforms: world.uniforms });   // CR-013 story Chapter 2 ships
  const rig = createCameraRig(state);
  const cockpit = createCockpit(state, rig);
  const hatch = createHatch(cockpit.scene, state);
  const hud = createHud(state, cockpit, rig, hatch.anim);
  const wrap = createHudWrap(cockpit.scene, state, hatch);
  const monitor = createMonitorPass(renderer, state);
  const chase = createChase({ state, world, entities, monitor, rig });
  const boarding = createBoarding({ state, world, monitor, rig });   // CR-008 story: the pilot outside, first person
  const aboard = createAboard({ state, world, monitor, seawrack });             // CR-014 story interlude: on foot aboard Seawrack
  hatch.setBay(boarding.bayGeometries);                              // CR-010: the open hatch shows the real cargo bay at the story cold start

  let aspect = 16 / 9;
  let rtH = 720;
  // current quality settings (see PRESETS / LADDER); `cur` is what is applied now
  const base = auto ? { prCap: 2, rtCap: 1.5 } : PRESETS[qParam];
  let rung = 0;                                   // auto only: index into LADDER
  const cur = { rt: 1, pr: base.prCap, tier: 0, samples: 4, hudDt: 0 };
  function setLevel() {
    if (auto) { const L = LADDER[rung]; cur.rt = L.rt; cur.pr = Math.min(L.pr, base.prCap); cur.tier = L.tier; cur.samples = L.samples; cur.hudDt = L.hudDt; }
    else { const P = PRESETS[qParam]; cur.rt = 1; cur.pr = P.prCap; cur.tier = P.tier; cur.samples = P.samples; cur.hudDt = P.hudDt; }
    world.setTier(cur.tier);
    if (monitor.rt.samples !== cur.samples) { monitor.rt.samples = cur.samples; monitor.rt.dispose(); }
    if (monitor.targetRt.samples !== cur.samples) { monitor.targetRt.samples = cur.samples; monitor.targetRt.dispose(); }
  }
  let time = 0;
  let lastWorldFov = -1, lastDispFov = -1, lastAspect = -1;
  const view = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1), pixAng: 0.002, thermal: false };
  const FWD = new THREE.Vector3(0, 0, -1);
  let currentTargetId = null;
  let maskTargetId = null;
  let targetEffect = 0;

  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth || 1280);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight || 720);
    const pr = Math.min(prOverride || window.devicePixelRatio || 1, cur.pr);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    const bw = renderer.domElement.width, bh = renderer.domElement.height;
    const scale = Math.min(1, base.rtCap / pr) * cur.rt;   // world RT never exceeds rtCap x CSS pixels (high: 1.5x)
    monitor.resize(bw, bh, scale);
    rtH = Math.max(2, Math.floor(bh * scale));
    aspect = w / h;
    lastAspect = -1;
  }
  setLevel();
  resize();

  // ---- adaptive resolution (auto only) -----------------------------------------------------------------------------
  // Frame interval EMA; the GPU is the usual bottleneck so the interval is the measure. Down fast (0.6 s above 21 ms),
  // up slowly (4 s below 15.5 ms, and never within 6 s of the last change) so it cannot oscillate.
  let lastUpdateMs = 0, lastT = 0, ema = 16.7, slowT = 0, fastT = 0, sinceChange = 0;
  function adapt(dt) {
    const t = performance.now();
    const iv = lastT ? t - lastT : 16.7;
    lastT = t;
    if (!auto || !(dt > 0) || iv > 250) { slowT = fastT = 0; return; }     // paused / tab was hidden: ignore
    ema += (iv - ema) * 0.08;
    sinceChange += iv / 1000;
    // render-side CPU time dominating the interval means lower resolution would not help: do not step down for that
    const cpuBound = lastUpdateMs > 0.6 * iv;
    if (ema > 21 && !cpuBound) { slowT += iv / 1000; fastT = 0; } else if (ema < 15.5) { fastT += iv / 1000; slowT = 0; } else { slowT = fastT = 0; }
    let nr = rung;
    if (slowT > 0.6 && rung < LADDER.length - 1) nr = rung + 1;
    else if (fastT > 4 && sinceChange > 6 && rung > 0) nr = rung - 1;
    if (nr !== rung) { rung = nr; slowT = fastT = 0; sinceChange = 0; ema = 16.7; setLevel(); resize(); }
  }

  function handleEvents() {
    const evs = state.events;
    if (!Array.isArray(evs)) return;
    const pp = state.player && state.player.position;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (!e || typeof e.type !== 'string') continue;
      rig.onEvent(e);
      monitor.onEvent(e);
      cockpit.onEvent(e);
      hud.onEvent(e);
      hatch.onEvent(e);
      entities.onEvent(e);
      if (e.type === 'explosion' && isVec(e.position) && pp) {
        const dx = e.position.x - pp.x, dy = e.position.y - pp.y, dz = e.position.z - pp.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const size = num(e.size, 1);
        rig.onExplosion(d, size);
        monitor.addFlash(clamp(((size * 80) / (d + 80)) * 0.6 - 0.1, 0, 0.8));
      }
    }
  }

  function update(dt) {
    const tStart = now();
    dt = num(dt, 0);
    adapt(dt);
    time += dt;
    const p = state.player;
    handleEvents();
    rig.update(dt, aspect);

    // ---- cameras -----------------------------------------------------------------------------------------------
    const wc = world.camera, cc = cockpit.camera;
    if (isVec(p.position)) wc.position.copy(p.position);
    if (p.quaternion && typeof p.quaternion.w === 'number') wc.quaternion.copy(p.quaternion).multiply(rig.camQuat);
    else wc.quaternion.copy(rig.camQuat);
    if (Math.abs(rig.worldFov - lastWorldFov) > 1e-3 || aspect !== lastAspect) {
      wc.fov = rig.worldFov; wc.aspect = aspect; wc.updateProjectionMatrix(); lastWorldFov = rig.worldFov;
    }
    if (Math.abs(rig.dispFov - lastDispFov) > 1e-3 || aspect !== lastAspect) {
      cc.fov = rig.dispFov; cc.aspect = aspect; cc.updateProjectionMatrix(); lastDispFov = rig.dispFov;
    }
    lastAspect = aspect;
    cc.position.copy(rig.camPos);
    cc.quaternion.copy(rig.camQuat);
    chase.update(dt, wc, aspect);                      // CR-005: third-person chase camera + own-suit entity (V)
    boarding.update(dt, wc, aspect);                   // CR-008: phase 'boarding' puts the camera at the pilot's eye
    aboard.update(dt, wc, aspect);                     // CR-014: phase 'aboard' owns the camera (homecoming shot, then first person)
    const outside = chase.hidden || boarding.active || aboard.active;   // no cockpit, no sphere HUD

    view.pos.copy(wc.position);
    if (isVec(p.velocity)) view.vel.set(p.velocity.x, p.velocity.y, p.velocity.z); else view.vel.set(0, 0, 0);
    view.fwd.copy(FWD).applyQuaternion(wc.quaternion);
    view.pixAng = (2 * Math.tan((wc.fov * Math.PI) / 360)) / rtH;
    const sens = p.sensors || {};
    view.thermal = sens.mode === 'thermal';

    // ---- scene updates -------------------------------------------------------------------------------------------
    world.update(dt, { pos: view.pos, vel: view.vel, pixAng: view.pixAng, thermal: view.thermal ? 1 : 0 });
    entities.update(dt, view);
    seawrack.update(dt, state);

    const nextTargetId = p.target && p.target.id != null ? p.target.id : null;
    if (nextTargetId !== currentTargetId) {
      currentTargetId = nextTargetId;
      if (nextTargetId !== null) { maskTargetId = nextTargetId; targetEffect = 0; }
    }
    targetEffect = damp(targetEffect, currentTargetId === null ? 0 : 1, 0.14, dt || 0.016);
    if (currentTargetId === null && targetEffect < 0.01) maskTargetId = null;

    const alerts = Array.isArray(state.alerts) ? state.alerts : [];
    let emergency = state.phase === 'disabled' || (num(p.hull, 1) < 0.25 && state.phase !== 'respawn' && state.phase !== 'matchOver');
    for (let i = 0; i < alerts.length && !emergency && state.phase !== 'respawn'; i++) if (alerts[i] && alerts[i].level === 'warning') emergency = true;
    const ctx = { time, emergency: emergency ? 1 : 0, aspect, rig, pink: entities.flash.pink, hudDt: cur.hudDt, hatch: hatch.anim };
    cockpit.update(dt, ctx);
    hatch.update(dt, ctx);
    if (!outside) { hud.update(dt, ctx); wrap.update(dt, hud.power, renderer); }
    monitor.prepare(dt, ctx);
    monitor.setTargetEffect(0);                        // CR-007: the target colour fringe is off

    // ---- draw -------------------------------------------------------------------------------------------------------
    const info = renderer.info;
    info.reset();
    let c0 = 0, t0 = 0, m0 = now();
    const mark = (name) => {
      const r = info.render, m1 = now();
      passStat[name].calls = r.calls - c0; passStat[name].triangles = r.triangles - t0; passStat[name].ms += (m1 - m0 - passStat[name].ms) * 0.1;
      c0 = r.calls; t0 = r.triangles; m0 = m1;
    };
    renderer.setRenderTarget(monitor.rt);
    renderer.clear();
    renderer.render(world.scene, wc);
    mark('world');
    if (false && !chase.hidden && maskTargetId !== null && targetEffect > 0.001) {   // CR-007: mask pass not needed while the fringe is off
      entities.renderTargetMask(renderer, wc, monitor.targetRt, maskTargetId);
    }
    mark('target');
    renderer.setRenderTarget(null);
    renderer.clear();
    monitor.renderMonitor();
    mark('monitor');
    if (!outside) { renderer.clearDepth(); renderer.render(cockpit.scene, cc); }
    mark('cockpit');
    monitor.renderOverlay();
    chase.render(renderer, dt, wc);
    boarding.render(renderer, dt, wc);
    aboard.render(renderer, dt);
    mark('overlay');
    lastUpdateMs = now() - tStart;
  }

  // ---- perf readout (window.__game.perf() merges this with the CPU timers from main.js) ---------------------------
  const now = () => performance.now();
  const passStat = { world: { calls: 0, triangles: 0, ms: 0 }, target: { calls: 0, triangles: 0, ms: 0 }, monitor: { calls: 0, triangles: 0, ms: 0 }, cockpit: { calls: 0, triangles: 0, ms: 0 }, overlay: { calls: 0, triangles: 0, ms: 0 } };
  function stats() {
    const i = renderer.info;
    return {
      quality: auto ? `auto rung ${rung}/${LADDER.length - 1}` : qParam,
      level: { ...cur, rung, frameEmaMs: +ema.toFixed(1) },
      passes: passStat,
      memory: { textures: i.memory.textures, geometries: i.memory.geometries, programs: i.programs ? i.programs.length : 0 },
      sizes: {
        canvasCss: [canvas.clientWidth, canvas.clientHeight], pixelRatio: renderer.getPixelRatio(),
        buffer: [canvas.width, canvas.height], worldRT: [monitor.rt.width, monitor.rt.height], worldRTSamples: monitor.rt.samples,
        hudCanvas: [2048, 1152],
      },
      
    };
  }

  return { update, resize, stats, debug: { world, cockpit, hud, hatch, monitor, entities, renderer, boarding }, takeUploads() { const n = perfCount.uploads; perfCount.uploads = 0; return n; } };
}
