// Panoramic monitor pass + final overlay pass + the full-screen result card.
//   world scene -> RT (MSAA) -> monitor shader (sensor and damage effects, selected-target RGB split)
//   -> default framebuffer. Cockpit scene is drawn on top by index.js, then overlay().
import * as THREE from 'three';
import { monitor, overlay } from './shaders.js';
import { clamp, saturate, smoothstep, num, hash1, damp, perfCount } from './util.js';

export function createMonitorPass(renderer, state) {
  const rt = new THREE.WebGLRenderTarget(4, 4, {
    samples: 4,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    generateMipmaps: false,
  });
  rt.texture.generateMipmaps = false;

  // A clean silhouette mask lets the monitor pass split only the selected target into RGB channels.
  const targetRt = new THREE.WebGLRenderTarget(4, 4, {
    samples: 4,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    generateMipmaps: false,
  });
  targetRt.texture.generateMipmaps = false;

  const camRot = new THREE.Matrix3();
  const m4 = new THREE.Matrix4();

  const MU = {
    tMap: { value: rt.texture },
    tTargetMask: { value: targetRt.texture },
    uTargetEffect: { value: 0 },
    uTime: { value: 0 }, uMinovsky: { value: 0 }, uHit: { value: 0 }, uFlicker: { value: 0 }, uFlutter: { value: 0 },
    uBarrier: { value: 0 }, uMach: { value: 0 }, uBlack: { value: 0 }, uGrid: { value: 0 }, uGridSweep: { value: 0 },
    uGlitch: { value: 0 }, uClean: { value: 0 }, uZoomFrame: { value: 0 }, uMode: { value: 0 }, uDead: { value: 0 },
    uSect: { value: [1, 1, 1, 1, 1, 1, 1, 1] },
    uSHit: { value: [0, 0, 0, 0, 0, 0, 0, 0] },
    uRes: { value: new THREE.Vector2(1280, 720) },
    uTan: { value: new THREE.Vector2(1.7, 1) },
    uCamRot: { value: camRot },
    uPixAng: { value: 0.002 },
  };
  const monitorMat = new THREE.ShaderMaterial({
    uniforms: MU,
    vertexShader: monitor.vertex,
    fragmentShader: monitor.fragment,
    depthTest: false,
    depthWrite: false,
  });

  // UI card texture (result screens). Drawn only when it changes.
  const uiCanvas = document.createElement('canvas');
  uiCanvas.width = 1280;
  uiCanvas.height = 720;
  const uiCtx = uiCanvas.getContext('2d');
  const uiTex = new THREE.CanvasTexture(uiCanvas);
  uiTex.colorSpace = THREE.SRGBColorSpace;
  uiTex.generateMipmaps = false;
  uiTex.minFilter = THREE.LinearFilter;

  const OU = {
    uBlackout: { value: 0 }, uFadeWhite: { value: 0 }, uFadeBlack: { value: 0 }, uFlash: { value: 0 },
    uRed: { value: 0 }, uSmoke: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 16 / 9 },
    uUI: { value: 0 }, uVig: { value: 0.6 }, tUI: { value: uiTex },
  };
  const overlayMat = new THREE.ShaderMaterial({
    uniforms: OU,
    vertexShader: overlay.vertex,
    fragmentShader: overlay.fragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const monScene = new THREE.Scene();
  const monMesh = new THREE.Mesh(quadGeo, monitorMat);
  monMesh.frustumCulled = false;
  monScene.add(monMesh);
  const ovScene = new THREE.Scene();
  const ovMesh = new THREE.Mesh(quadGeo, overlayMat);
  ovMesh.frustumCulled = false;
  ovScene.add(ovMesh);

  // effect timers -----------------------------------------------------------------------------------
  let hitT = 0, flickT = 0, flutterT = 0, glitchT = 0, flashV = 0, redHitT = 0;
  let minovskyK = 0, barrierK = 0, smokeK = 0, redK = 0;
  let phaseKey = '', phaseT = 0;
  let uiSig = '';
  let disT = 0;
  const secSm = [1, 1, 1, 1, 1, 1, 1, 1];     // smoothed sector health (the sim's value flickers hard)
  const secHit = [0, 0, 0, 0, 0, 0, 0, 0];    // brief near-black flash timers, one per sector

  function onEvent(e) {
    switch (e.type) {
      case 'playerHit': flickT = 0.2; hitT = 0.6; flashV = Math.max(flashV, 0.18); redHitT = 0.3; break;
      case 'partDestroyed': glitchT = 0.4; redHitT = 0.45; break;
      case 'rifleFire': break;                      // CR-002: no recoil feedback on the picture
      case 'sensorMode': glitchT = 0.28; break;
      case 'zoom': glitchT = 0.2; break;
      case 'sectorLost': if (Number.isInteger(e.index) && e.index >= 0 && e.index < 8) secHit[e.index] = 0.32; glitchT = 0.5; hitT = Math.max(hitT, 0.45); flickT = Math.max(flickT, 0.12); break;
      case 'sonicBoom': hitT = Math.max(hitT, 0.3); break;
      case 'startupStage': glitchT = 0.18; break;
      case 'hatchBlow': flashV = 1; break;
      default: break;
    }
  }
  function addFlash(v) { flashV = Math.max(flashV, clamp(v, 0, 0.9)); }

  function resize(wPx, hPx, scale) {
    const w = Math.max(2, Math.floor(wPx * scale));
    const h = Math.max(2, Math.floor(hPx * scale));
    rt.setSize(w, h);
    targetRt.setSize(w, h);
    MU.uRes.value.set(wPx, hPx);
    OU.uAspect.value = wPx / hPx;
  }

  function drawResult(kind, res) {
    const c = uiCtx, W = uiCanvas.width, H = uiCanvas.height;
    c.clearRect(0, 0, W, H);
    const victory = kind === 'victory';
    const failed = kind === 'failed';
    const gaw = (state.mission && state.mission.id) === 'gawman';
    if (victory) {
      const g = c.createLinearGradient(0, H * 0.2, 0, H * 0.8);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(2,8,12,0.78)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    } else {
      c.fillStyle = 'rgba(6,9,14,0.96)'; c.fillRect(0, 0, W, H);
    }
    const col = victory ? '#00E5FF' : '#FF1744';
    c.textAlign = 'center';
    c.fillStyle = col;
    c.font = '300 54px "Roboto Mono", Consolas, monospace';
    c.fillText(victory ? 'MISSION COMPLETE' : failed ? 'MISSION FAILED' : 'PILOT EJECTED', W / 2, H * 0.34);
    c.font = '16px "Roboto Mono", Consolas, monospace';
    c.fillStyle = '#9aa';
    c.fillText(victory ? (gaw ? 'GAWMAN RECOVERED  -  NIGHT RETRIEVAL' : 'ALL HOSTILES DESTROYED  -  DUSK INTERCEPT') : failed ? String((state.mission && state.mission.result && state.mission.result.reason) || 'MISSION FAILED').toUpperCase() : 'RX-105 LOST  -  POD RECOVERY BEACON ACTIVE', W / 2, H * 0.34 + 34);
    c.strokeStyle = col; c.globalAlpha = 0.5; c.lineWidth = 1;
    c.beginPath(); c.moveTo(W * 0.3, H * 0.42); c.lineTo(W * 0.7, H * 0.42); c.stroke(); c.globalAlpha = 1;
    c.font = '22px "Roboto Mono", Consolas, monospace';
    c.fillStyle = '#e8f0f4';
    const r = res || {};
    const el = num(r.elapsed, num(state.mission && state.mission.elapsed, 0));
    const mm = Math.floor(el / 60), ss = Math.floor(el % 60);
    const shots = num(r.shotsFired, 0), hits = num(r.hits, 0);
    const lines = [
      ['HOSTILES DESTROYED', String(num(r.kills, num(state.mission && state.mission.kills, 0)))],
      ['MISSION TIME', `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`],
      ['BEAM SHOTS FIRED', String(shots)],
      ['HITS', String(hits)],
      ['ACCURACY', shots > 0 ? `${Math.round((100 * hits) / shots)}%` : '--'],
    ];
    let y = H * 0.50;
    for (const [k, v] of (gaw ? lines.slice(1, 2) : lines)) {
      c.textAlign = 'right'; c.fillStyle = '#7b8a92'; c.fillText(k, W / 2 - 20, y);
      c.textAlign = 'left'; c.fillStyle = '#ffffff'; c.fillText(v, W / 2 + 20, y);
      y += 38;
    }
    c.textAlign = 'center';
    c.font = '15px "Roboto Mono", Consolas, monospace';
    c.fillStyle = '#FFD600';
    if (!failed) c.fillText('RELOAD THE PAGE FOR A NEW SORTIE', W / 2, H * 0.50 + 38 * 5 + 40);
    uiTex.needsUpdate = true; perfCount.uploads++;
  }

  // Called once per frame before renderMonitor(). ctx = { rig, aspect, dispFov, emergency }
  function prepare(dt, ctx) {
    const p = state.player || {};
    const sens = p.sensors || {};
    const phase = state.phase;
    const st = state.startup || {};
    const time = ctx.time;

    if (phase !== phaseKey) { phaseKey = phase; phaseT = 0; uiSig = ''; }
    phaseT += dt;

    hitT = Math.max(0, hitT - dt);
    flickT = Math.max(0, flickT - dt);
    flutterT = Math.max(0, flutterT - dt);
    glitchT = Math.max(0, glitchT - dt);
    flashV = Math.max(0, flashV - dt * 2.6);
    redHitT = Math.max(0, redHitT - dt);

    // startup stages ---------------------------------------------------------------------------------
    const stage = phase === 'startup' ? Math.max(0, Math.floor(num(st.stage, 0))) : 4;
    const prog = saturate(num(st.progress, 0));
    let black = 1, grid = 0, sweep = 0, gl = 0;
    if (phase === 'respawn') black = 1 - 0.88 * smoothstep(0, 0.7, phaseT);       // CR-003: dead suit, picture sinks to static
    if (stage <= 1) black = 0;
    else if (stage === 2) { black = 0; grid = 1; sweep = prog; }
    else if (stage === 3) {
      black = Math.pow(smoothstep(0, 1, prog), 1.5) * (0.88 + 0.12 * hash1(Math.floor(time * 30)));
      grid = 1 - prog;
      sweep = 1;
      gl = (1 - prog) * 0.7;
    }
    MU.uBlack.value = black;
    MU.uGrid.value = grid;
    MU.uGridSweep.value = sweep;

    // density, barrier ------------------------------------------------------------------------------------
    const dens = saturate(num(state.world && state.world.minovskyDensity, 0));
    let dis = 0;
    if (phase === 'disabled' || phase === 'ejected') {
      disT += dt;
      dis = 1;
    }
    const resp = phase === 'respawn' ? smoothstep(0, 0.6, phaseT) : 0;
    // CR-007: the screen is clear in normal flight: Minovsky density no longer adds colour split, scanlines, static or
    // jitter. That interference look is kept only for a dead suit and the respawn fade-in. (`dens` is still read above
    // so the field stays documented; the HUD and sensors use the density on their own.)
    minovskyK = damp(minovskyK, (dis ? 0.3 : 0) + resp * 0.9, 4, dt || 0.016);
    MU.uMinovsky.value = clamp(minovskyK, 0, 1.2);
    const bar = p.barrier || {};
    barrierK = damp(barrierK, bar.active ? 0.5 + 0.5 * saturate(num(bar.integrity, 1)) : 0, 5, dt || 0.016);
    MU.uBarrier.value = barrierK;
    MU.uMach.value = num(p.mach, 0);

    // hit effects ---------------------------------------------------------------------------------------------
    let hit = Math.pow(hitT / 0.6, 1.5);
    let flick = 0;
    if (flickT > 0) flick = hash1(Math.floor(time * 50)) > 0.28 ? 1 : 0.35;
    if (dis && phase === 'disabled') {
      const ph = (time % 2.1);
      if (ph < 0.16) flick = Math.max(flick, hash1(Math.floor(time * 40)) > 0.4 ? 0.9 : 0.3);
      hit = Math.max(hit, 0.15 + 0.1 * hash1(Math.floor(time * 6)));
    }
    if (resp > 0) { hit = Math.max(hit, 0.12 + 0.1 * hash1(Math.floor(time * 7))); if (hash1(Math.floor(time * 11) + 2) > 0.8) flick = Math.max(flick, 0.55); }
    MU.uHit.value = hit;
    MU.uFlicker.value = flick;
    MU.uFlutter.value = flutterT > 0 ? flutterT / 0.07 : 0;
    MU.uGlitch.value = Math.max(glitchT / 0.28, gl);
    MU.uTime.value = time;
    MU.uMode.value = sens.mode === 'thermal' ? 2 : sens.mode === 'night' ? 1 : 0;
    MU.uZoomFrame.value = smoothstep(1.05, 1.6, ctx.rig.zoomVis);

    const sec = Array.isArray(sens.sectors) ? sens.sectors : null;
    const arr = MU.uSect.value;
    const hitArr = MU.uSHit.value;
    for (let i = 0; i < 8; i++) {
      const target = sec ? clamp(num(sec[i], 1), 0, 1) : 1;
      // fast attack, slow release: the sim's 0.05..0.4 s flicker becomes a steady degraded picture
      secSm[i] = damp(secSm[i], target, target < secSm[i] ? 9 : 2.5, dt || 0.016);
      secHit[i] = Math.max(0, secHit[i] - dt);
      arr[i] = secSm[i];
      hitArr[i] = secHit[i] > 0 ? secHit[i] / 0.32 : 0;
    }

    m4.makeRotationFromQuaternion(ctx.rig.camQuat);
    camRot.setFromMatrix4(m4);
    const th = Math.tan((ctx.rig.dispFov * Math.PI) / 360);
    MU.uTan.value.set(th * ctx.aspect, th);
    MU.uPixAng.value = (2 * th) / MU.uRes.value.y;

    // overlay -------------------------------------------------------------------------------------------------------
    OU.uTime.value = time;
    OU.uBlackout.value = saturate(num(p.blackout, 0));
    OU.uFlash.value = flashV;
    const hullV = num(p.hull, 1);
    const hullSmoke = phase === 'respawn' ? 0 : hullV < 0.3 ? 0.12 + 0.3 * (1 - hullV / 0.3) : 0;     // thin cabin smoke when the hull is low
    smokeK = damp(smokeK, phase === 'disabled' ? 0.85 : phase === 'ejected' ? 0.5 : hullSmoke, 0.6, dt || 0.016);
    OU.uSmoke.value = smokeK;
    redK = damp(redK, ctx.emergency || 0, 6, dt || 0.016);
    OU.uRed.value = Math.max(redK * (0.5 + 0.5 * Math.sin(time * 7)), Math.min(1, (redHitT / 0.3) * 0.9));   // red edge tint on a hit
    let fw = 0, fb = 0, ui = 0;
    if (phase === 'ejected') {
      fw = smoothstep(0.1, 1.9, phaseT);
      ui = smoothstep(2.3, 3.5, phaseT);
      if (ui > 0 && uiSig !== 'e') { uiSig = 'e'; drawResult('ejected', state.mission && state.mission.result); }
    } else if (phase === 'failed') {
      fb = 0.7 * smoothstep(0, 2.0, phaseT);
      ui = smoothstep(1.2, 2.4, phaseT);
      if (ui > 0 && uiSig !== 'f') { uiSig = 'f'; drawResult('failed', state.mission && state.mission.result); }
    } else if (phase === 'victory') {
      fb = 0.55 * smoothstep(0, 3.0, phaseT);
      ui = smoothstep(1.4, 2.8, phaseT);
      if (ui > 0 && uiSig !== 'v') { uiSig = 'v'; drawResult('victory', state.mission && state.mission.result); }
    }
    OU.uFadeWhite.value = fw;
    OU.uFadeBlack.value = fb;
    OU.uUI.value = ui;
    OU.uVig.value = 0.6;
  }

  function renderMonitor() {
    renderer.render(monScene, cam);
  }
  function renderOverlay() {
    renderer.render(ovScene, cam);
  }

  const setClean = (v) => { MU.uClean.value = v; };
  const setTargetEffect = (v) => { MU.uTargetEffect.value = saturate(v); };
  return { rt, targetRt, prepare, setClean, setTargetEffect, renderMonitor, renderOverlay, resize, onEvent, addFlash, getPhaseTime: () => phaseT };
}
