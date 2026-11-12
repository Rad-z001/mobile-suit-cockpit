// Entry point (owner: manager). Wires the four modules around the shared state.
import { createState } from './state.js';
import { createInput } from './input.js';
import { createSim } from './sim/index.js';
import { createRenderer } from './render/index.js';
import { createAudio } from './audio.js';
import { createNet } from './net/index.js';
import { createLobby } from './ui/lobby.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const errorBox = document.getElementById('error');

function showError(err) {
  console.error(err);
  errorBox.style.display = 'block';
  errorBox.textContent = String(err && err.stack ? err.stack : err);
}
window.addEventListener('error', (e) => showError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

const state = createState();
const input = createInput(canvas, state);
const sim = createSim(state);
const renderer = createRenderer(canvas, state);
const audio = createAudio(state);
const net = createNet(state);

// Debug handle for testing from the console.
window.__game = { state, sim, renderer, audio, input, net };

let started = false;
// CR-003: the start overlay is the lobby (src/ui/lobby.js). board() must be called from a user gesture
// (click): it starts audio and captures the mouse. Single player calls it at once; multiplayer calls it
// after the host starts the match (each pilot clicks "board").
function board() {
  if (started) { input.capture(); return; }
  started = true;
  overlay.style.display = 'none';
  audio.resume();          // browsers need a user gesture before audio
  input.capture();         // pointer lock
}
function unboard() {       // back to the lobby overlay (match over / left the room)
  overlay.style.display = '';
  if (document.pointerLockElement) document.exitPointerLock();
}
const lobby = createLobby({ state, net, root: overlay, board, unboard });
window.__game.lobby = lobby;

window.addEventListener('resize', () => renderer.resize());

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  tick(dt);
}

// Debug: advance n fixed frames by hand (used for automated testing in a hidden tab).
window.__game.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); };

// Perf timers (EMA of per-frame CPU ms). window.__game.perf() merges these with renderer.stats(); add ?perf to the URL
// for an on-screen readout.
const T = { input: 0, sim: 0, render: 0, audio: 0, frame: 16.7 };
const ema = (k, v) => { T[k] += (v - T[k]) * 0.1; };
let lastFrameAt = 0, upT = 0, upRate = 0;
window.__game.perf = () => ({
  fps: +(1000 / T.frame).toFixed(1), frameMs: +T.frame.toFixed(2),
  cpuMs: { input: +T.input.toFixed(3), sim: +T.sim.toFixed(3), render: +T.render.toFixed(3), audio: +T.audio.toFixed(3) },
  canvasUploadsPerSec: +upRate.toFixed(1), ...renderer.stats(),
});
if (/[?&]perf/.test(location.search)) {
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:6px;top:6px;margin:0;padding:6px;background:#000a;color:#8f8;font:11px monospace;z-index:9;pointer-events:none';
  document.body.appendChild(box);
  setInterval(() => {
    const p = window.__game.perf(), w = p.passes;
    box.textContent = [
      `${p.fps} fps  ${p.frameMs} ms   quality ${p.quality}`,
      `cpu in ${p.cpuMs.input} sim ${p.cpuMs.sim} rnd ${p.cpuMs.render} aud ${p.cpuMs.audio}`,
      `calls w${w.world.calls} m${w.monitor.calls} c${w.cockpit.calls} o${w.overlay.calls}  tris ${w.world.triangles + w.cockpit.triangles}`,
      `RT ${p.sizes.worldRT.join('x')} s${p.sizes.worldRTSamples}  buf ${p.sizes.buffer.join('x')}  up/s ${p.canvasUploadsPerSec}`,
    ].join(' | ');
  }, 500);
}

function tick(dt) {
  const t0 = performance.now();
  if (lastFrameAt) ema('frame', t0 - lastFrameAt);
  lastFrameAt = t0;
  input.update(dt);
  const online = state.net.mode === 'match';
  if (online) state.paused = false;            // no pause in a multiplayer match
  else if (state.input.pauseToggle && started) state.paused = !state.paused;
  net.receive(dt);
  const t1 = performance.now();

  const running = (started || online) && !state.paused;
  if (running) {
    state.dt = dt;
    state.time += dt;
    sim.update(dt);
  } else {
    state.dt = 0;
  }
  net.send(dt);
  lobby.update(dt);
  const t2 = performance.now();
  renderer.update(running ? dt : 0);
  const t3 = performance.now();
  audio.update(running ? dt : 0);
  const t4 = performance.now();
  ema('input', t1 - t0);
  upT += dt || 0.016;
  if (upT >= 1) { upRate = renderer.takeUploads() / upT; upT = 0; } ema('sim', t2 - t1); ema('render', t3 - t2); ema('audio', t4 - t3);
  state.events.length = 0;
}
requestAnimationFrame(frame);
