// HUD projected onto the inside of the sphere (CR-002 item 9: smaller and more useful). Thin, faint, pale vector line
// work in the style of reference 01. Everything that is not flight-critical lives on the sub-monitors.
// On screen: speed + altitude ladders, E-Pack shots with reload bar, missile (funnel) count, active weapon, shield
// indicator, target block (name / distance / HP), small radar, funnel-lock bracket, lead pip, incoming-missile
// diamonds + edge arrows, alerts (incl. PULL UP), "RIFLE / VULCAN / FUNNEL LOST". Flight form adds Mach, a short
// pitch ladder, a flight-path marker, the FLIGHT tag, the clamp bracket and a barrier icon (cross-fade over the
// transform). No rifle lock-on visuals and no central-zone ring.
//
// It lives in COCKPIT space (fixed to the shell), NOT on the lens: a spherical patch of radius 1.05 m centred on
// the neutral eye carries a 2048x1152 canvas texture mapped LINEARLY in angle.
//   Canvas x = CX + yawDeg * PPD,  y = CY - pitchDeg * PPD   (PPD = 12.8 px / deg).
//
// PROJECTION CONVENTION:
//   world direction d -> cockpit direction c = inverse(player.quaternion) * d   (cockpit axes = player-local axes)
//   yaw   = atan2(c.x, -c.z)     (+ = right of the nose)
//   pitch = atan2(c.y, hypot(c.x, c.z))   (+ = above the nose)
//   directions with c.z >= 0 (behind the pilot) are "off screen" and get edge arrows.
// STATIC LAYOUT uses a "virtual screen" in reference-image pixels (854x480): S(rx, ry) inverse-projects such a point
// through the 90 deg vertical-FOV cockpit camera onto the angular canvas.
import * as THREE from 'three';
import { clamp, saturate, smoothstep, num, isVec, hash1, DEG, perfCount, decodeSRGBInShader } from './util.js';
import { createMix } from './hudMix.js';
import { TUNNEL } from './hatch.js';

const W = 2048, H = 1152;
const YAW_RANGE = 80, PITCH_RANGE = 45;
const PPD = W / (YAW_RANGE * 2);           // 12.8
const CX = W / 2, CY = H / 2;
const R = 1.05;
const RAD = 180 / Math.PI;
// flight-form aim clamp cone (matches sim FLIGHT.minovsky.aimLimit*)
const CLAMP_YAW = 0.14, CLAMP_PITCH = 0.10;

// ---- LOOK KNOBS ---------------------------------------------------------------------------------------
const LW = 1.25;              // base line width (canvas px, ~1 screen px)
const A_LINE = 0.62;          // base alpha of the live line work
const GLOW_OPACITY = 0.55;    // soft blurred copy under the crisp lines
// -------------------------------------------------------------------------------------------------------

const WHITE = '244,247,252';
const PALE = '214,226,242', GREEN = '196,255,214', WARM = '255,232,200';
const AMB = '255,196,40', ORG = '255,112,44', RED = '255,66,72', CYAN = '120,230,255', ALLY = '110,255,200';
const FONT = '"Roboto Mono", Consolas, "Courier New", monospace';
const rgba = (c, a) => `rgba(${c},${a})`;

const EMPTY = [];
const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const DIAG = [
  'OPTICAL ARRAY ........... OK', 'LIDAR SCANNERS ......... OK', 'IR SENSORS ............. OK',
  'LINEAR SEAT ACTUATORS .. OK', 'GIMBAL SERVO ........... OK', 'MINOVSKY REACTOR ....... STABLE',
  'FLIGHT UNIT NOZZLES .... OK', 'BEAM BARRIER GEN ....... OK', 'PSYCOMMU LINK .......... STANDBY',
  'FUNNEL RACKS ........... ARMED', 'PANORAMIC MONITOR ...... SYNC', 'HUD PROJECTOR .......... OK',
];

// ---- reference layout (854x480 virtual screen) ----------------------------------------------------------
const RW = 854, RH = 480, RCX = RW / 2, RCY = RH / 2;
const LAD_Y0 = 150, LAD_Y1 = 312, LAD_EYE = 231;          // ladder span + eye-level row
const LAD_XL = 236, LAD_XR = RW - 236;
const TICK_PX = 5;

export function createHud(state, cockpit, rig, hatchAnim) {
  const HA = hatchAnim || { frame: 0, door: 0, dock: 0, tab: 0, label: 'UNLOCK', dim: 0, wind: 0, open: false, active: false };
  const group = new THREE.Group();

  // ---- canvases ---------------------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = W / 4; glowCanvas.height = H / 4;
  const gctx = glowCanvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  const gtex = new THREE.CanvasTexture(glowCanvas);
  gtex.generateMipmaps = false; gtex.minFilter = THREE.LinearFilter; gtex.magFilter = THREE.LinearFilter;

  // ---- spherical patch --------------------------------------------------------------------------------
  function patch(radius) {
    const nx = 80, ny = 48;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const u = i / nx, v = j / ny;
        const yaw = (u * 2 - 1) * YAW_RANGE * DEG, pit = (v * 2 - 1) * PITCH_RANGE * DEG;
        pos.push(radius * Math.cos(pit) * Math.sin(yaw), radius * Math.sin(pit), -radius * Math.cos(pit) * Math.cos(yaw));
        uv.push(u, v);
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  const mk = (map, r, op) => {
    const m = new THREE.Mesh(patch(r), decodeSRGBInShader(new THREE.MeshBasicMaterial({
      map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
      side: THREE.DoubleSide, toneMapped: false, opacity: op,
    })));
    m.frustumCulled = false;
    return m;
  };
  const meshMain = mk(tex, R, 1);
  const meshGlow = mk(gtex, R - 0.002, GLOW_OPACITY);
  meshMain.renderOrder = 20; meshGlow.renderOrder = 19;
  group.add(meshGlow, meshMain);
  cockpit.hudRoot.add(group);

  // ---- temporaries ----------------------------------------------------------------------------------------
  const qInv = new THREE.Quaternion();
  const c1 = new THREE.Vector3(), c2 = new THREE.Vector3(), hh = new THREE.Vector3(), rt = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const fw = new THREE.Vector3(), uu = new THREE.Vector3();
  const P = { x: 0, y: 0 };
  const VP = { x: 0, y: 0 };
  const byId = new Map();
  let lastFont = '';
  let asp = 16 / 9;
  let base = PALE;

  // ---- hud visual state ---------------------------------------------------------------------------------------
  let time = 0;
  let jitter = 0, lockFlash = 0, lostFlash = 0, waveBanner = 0, waveNum = 0, killText = '', killT = 0, sectorText = '', sectorT = 0;
  let uiClickT = 0, funnelT = 0, swapT = 0, swapText = '', refusedT = 0, refusedText = '';
  let fK = 0;                                   // flight-form layout cross-fade 0..1
  let headStatus = 'ok';
  let hitT = 0, hitDur = 0.18, hitKill = false, commsT = 0, commsText = '', engageT = 0, mpOn = false;   // CR-003 match HUD

  function onEvent(e) {
    switch (e.type) {
      case 'playerHit': jitter = 0.4; break;
      case 'lockAcquiring': lockFlash = 0.3; break;
      case 'lockConfirmed': lockFlash = 0.45; break;
      case 'lockLost': lostFlash = 1.0; break;
      case 'waveStart': waveBanner = 3; waveNum = num(e.wave, 0); break;
      case 'kill': killText = 'SPLASH  ' + String(e.name || 'TARGET').toUpperCase(); killT = 2.5; break;
      case 'sectorLost': sectorText = `SENSOR SECTOR ${num(e.index, 0)} LOST`; sectorT = 3; break;
      case 'funnelLaunch': funnelT = 1.2; break;
      case 'uiClick': uiClickT = 0.12; break;
      case 'weaponSwap': swapT = 1.2; swapText = String(e.active || '').toUpperCase(); break;
      case 'flightRefused': refusedT = 2.5; refusedText = e.reason === 'notEquipped' ? 'NOT EQUIPPED' : String(e.reason || 'FLIGHT UNIT LOST').toUpperCase(); break;
      case 'hitConfirm': hitKill = !!e.kill; hitDur = hitKill ? 0.55 : 0.18; hitT = hitDur; break;
      case 'peerJoined': commsText = `PILOT ${String(e.name || '?').toUpperCase()} JOINED`; commsT = 4; break;
      case 'peerLeft': commsText = `PILOT ${String(e.name || '?').toUpperCase()} LEFT`; commsT = 4; break;
      case 'hostChanged': commsText = e.isHost ? 'YOU ARE NOW HOST' : 'HOST CHANGED'; commsT = 4; break;
      case 'matchStart': engageT = 1.6; break;
      case 'gawmanCaught': case 'gawmanLost': case 'gawmanJump': case 'rescueHint': mix.onEvent(e); break;
      default: break;
    }
  }

  // ---- virtual screen mapping -----------------------------------------------------------------------------
  function S(rx, ry) {
    const x = ((rx - RCX) / RCX) * asp, y = (RCY - ry) / RCY;
    const yaw = Math.atan(x) * RAD;
    const pit = Math.atan2(y, Math.hypot(x, 1)) * RAD;
    VP.x = CX + yaw * PPD; VP.y = CY - pit * PPD;
    return VP;
  }
  const pm = (g, rx, ry) => { S(rx, ry); g.moveTo(VP.x, VP.y); };
  const pl = (g, rx, ry) => { S(rx, ry); g.lineTo(VP.x, VP.y); };
  function vseg(g, x1, y1, x2, y2) {            // straight screen line, subdivided so it stays straight
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 20));
    pm(g, x1, y1);
    for (let i = 1; i <= n; i++) pl(g, x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n);
  }
  function vshape(g, cx, cy, pts, close) {
    for (let i = 0; i < pts.length; i++) {
      const x = cx + pts[i][0], y = cy + pts[i][1];
      if (i === 0) pm(g, x, y); else pl(g, x, y);
    }
    if (close) g.closePath();
  }
  function vhex(g, cx, cy, w, h) {
    const a = w / 2, b = h / 2;
    vshape(g, cx, cy, [[-a, 0], [-a + b, -b], [a - b, -b], [a, 0], [a - b, b], [-a + b, b]], true);
  }

  // ---- 2D primitives (canvas space) ------------------------------------------------------------------------------
  const entList = () => (Array.isArray(state.entities) ? state.entities : EMPTY);
  // CR-004: the 2048-wide canvas shows at ~0.5 css px per canvas px at 720p, so the old 8-12 px labels were ~5 css px.
  const textScale = (s) => (s <= 10 ? 2.1 : s <= 12 ? 1.85 : s <= 14 ? 1.6 : s <= 16 ? 1.4 : 1);
  function font(size, weight = 400) {
    size = Math.round(size * textScale(size));
    const f = `${weight} ${size}px ${FONT}`;
    if (f !== lastFont) { ctx.font = f; lastFont = f; }
  }
  function T(s, x, y, color, size = 12, align = 'center', weight = 400) {
    font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  }
  function TV(s, rx, ry, color, size, align = 'center') { S(rx, ry); T(s, VP.x, VP.y + size * 0.35, color, size, align); }
  function line(x1, y1, x2, y2) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  function stroke(color, w = LW) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); }
  function circle(x, y, r, color, w = LW) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); stroke(color, w); }
  function thinBar(x, y, w, h, f, color, back) {
    ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * saturate(f), h);
  }
  // px per reference px around (rx, ry), horizontally
  function refScale(rx, ry) {
    S(rx, ry); const x0 = VP.x;
    S(rx + 10, ry); return Math.abs(VP.x - x0) / 10;
  }

  // world dir -> canvas px; returns false if behind the pilot
  function projCockpit(c) {
    if (c.z >= -1e-3) return false;
    const yaw = Math.atan2(c.x, -c.z) * RAD;
    const pit = Math.atan2(c.y, Math.hypot(c.x, c.z)) * RAD;
    P.x = CX + yaw * PPD; P.y = CY - pit * PPD;
    return true;
  }
  function projWorldDir(d) { c1.copy(d).applyQuaternion(qInv); return projCockpit(c1); }
  const onCanvas = (m = 0) => P.x > m && P.x < W - m && P.y > m && P.y < H - m;

  function ladderDir(out, alpha, phi) {
    const ca = Math.cos(alpha), sa = Math.sin(alpha), cp = Math.cos(phi), sp = Math.sin(phi);
    out.set(
      cp * (ca * hh.x + sa * rt.x) + sp * up.x,
      cp * (ca * hh.y + sa * rt.y) + sp * up.y,
      cp * (ca * hh.z + sa * rt.z) + sp * up.z,
    );
    return out;
  }
  function arc(phiDeg, a0Deg, a1Deg, n) {
    let pen = false;
    for (let i = 0; i <= n; i++) {
      const a = (a0Deg + ((a1Deg - a0Deg) * i) / n) * DEG;
      ladderDir(c2, a, phiDeg * DEG);
      if (projWorldDir(c2)) {
        if (!pen) { ctx.moveTo(P.x, P.y); pen = true; } else ctx.lineTo(P.x, P.y);
      } else pen = false;
    }
  }

  // ---- CR-004 mix layer (hudMix.js) --------------------------------------------------------------------------
  const kit = {
    ctx, W, H, CX, CY, PPD, state, P, ok: false,
    T: (s, x, y, color, size, align, weight) => { font(size, weight || 400); ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.fillText(s, x, y); },
    fmt, arc: (...a) => arc(...a),
    ladderPt: (al, phi) => { ladderDir(c2, al * DEG, phi * DEG); kit.ok = projWorldDir(c2); },
    aspectFactor: () => clamp(asp / 1.78, 0.8, 1.35),
    hatchDoor: () => HA.door,
  };
  const mix = createMix(kit);

  // ======================================================================================================
  // DECORATIVE LAYER (CR-002b, reference 01 + 04 + 07): the thin pale vector work that frames the panoramic screen.
  // Honeycomb plates and an outer scale rail on each side, the pipe-like diagonal rails ending in hex markers, hex-arrow
  // pairs and chevrons either side of the weapon block, slanted hatch dashes, scattered radial dashes, a faint
  // broken arc, dot grids. Unfilled, thin, faint, and kept to the outer thirds of the screen (the old, oversized
  // layout is not coming back; there is no ring around the centre). Static, so it is drawn once into its own canvas
  // and blitted every frame; only the travelling highlight dashes on the rails are live.
  // ======================================================================================================
  const decoCanvas = document.createElement('canvas');
  decoCanvas.width = W; decoCanvas.height = H;
  const dctx = decoCanvas.getContext('2d');
  let decoKey = '';
  const railX = (y) => 172 + 0.115 * (y - 240) - 0.00022 * (y - 240) * (y - 240);   // left outer rail (reference px)
  const mirX = (m, xl) => (m < 0 ? xl : RW - xl);
  function decoStroke(g, a, w) { g.strokeStyle = rgba(base, a); g.lineWidth = w; g.stroke(); }
  function buildDeco() {
    const g = dctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.lineCap = 'butt'; g.lineJoin = 'round';
    const w1 = LW * 0.85;
    for (const m of [-1, 1]) {
      const X = (xl) => mirX(m, xl);
      // honeycomb plates: a column of rounded hexagons, big ones with a smaller satellite on alternate rows
      for (let i = 0; i < 8; i++) {
        const y = 72 + i * 46;
        const cx = railX(y) - 84 + 7 * Math.sin((i / 7) * Math.PI);
        g.beginPath(); vhex(g, X(cx), y, 60, 24); decoStroke(g, 0.20, w1);
        g.beginPath(); vhex(g, X(cx), y, 46, 14); decoStroke(g, 0.08, w1);
        if (i % 2 === 0) { g.beginPath(); vhex(g, X(cx - 30), y + 23, 34, 15); decoStroke(g, 0.13, w1); }
        else { g.beginPath(); vhex(g, X(cx + 30), y + 23, 30, 13); decoStroke(g, 0.13, w1); }
      }
      // outer scale rail with ticks on the inner side
      g.beginPath();
      for (let y = 40; y <= 430; y += 10) { if (y === 40) pm(g, X(railX(y)), y); else pl(g, X(railX(y)), y); }
      decoStroke(g, 0.20, w1);
      g.beginPath();
      for (let y = 46, k = 0; y <= 424; y += 7, k++) {
        const x = railX(y), L = k % 5 === 0 ? 9 : 4.5;
        pm(g, X(x), y); pl(g, X(x + (m < 0 ? L : -L)), y);
      }
      decoStroke(g, 0.24, w1);
      // hex tags on the rail (eye row and the lower end), pointing at the centre
      for (const ty of [232, 408]) {
        const x = railX(ty);
        g.beginPath(); vhex(g, X(x), ty, 38, 15); decoStroke(g, 0.42, w1);
        g.beginPath(); pm(g, X(x - 4 * m), ty - 3); pl(g, X(x - 9 * m), ty); pl(g, X(x - 4 * m), ty + 3); decoStroke(g, 0.4, w1);
      }
      // pipe-like diagonal rails from the lower outer corner to a hex marker beside the central block
      for (const off of [0, 7]) {
        g.beginPath(); vseg(g, X(0), 352 + off, X(250), 288 + off * 0.9); decoStroke(g, off ? 0.14 : 0.24, w1);
      }
      g.beginPath(); vhex(g, X(266), 286, 28, 22); decoStroke(g, 0.50, w1);
      g.beginPath(); pm(g, X(262), 280); pl(g, X(268), 286); pl(g, X(262), 292); decoStroke(g, 0.55, w1);
      g.beginPath(); pm(g, X(280), 283); pl(g, X(285), 286); pl(g, X(280), 289); decoStroke(g, 0.45, w1);
      // hex-arrow pairs flanking the weapon block + dot grid
      for (let k = 0; k < 2; k++) {
        const xx = X(350 - k * 26);
        g.beginPath(); vhex(g, xx, 274, 22, 15); decoStroke(g, 0.30 - k * 0.08, w1);
        const cx = 350 - k * 26;
        g.beginPath(); pm(g, X(cx + 3 * m), 271); pl(g, X(cx - 3 * m), 274); pl(g, X(cx + 3 * m), 277); decoStroke(g, 0.30 - k * 0.08, w1);
      }
      g.fillStyle = rgba(base, 0.30);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { S(X(312 - a * 5), 292 + b * 5); g.fillRect(VP.x - 0.7, VP.y - 0.7, 1.4, 1.4); }
      // slanted hatch dashes above the horizon
      g.beginPath();
      for (let i = 0; i < 15; i++) { const x = 340 - i * 11; pm(g, X(x), 100); pl(g, X(x + 5), 92); }
      decoStroke(g, 0.26, w1);
      g.beginPath(); vseg(g, X(172), 100, X(214), 100); vseg(g, X(228), 100, X(250), 100); decoStroke(g, 0.12, w1);
      // broken arc of a large arch over the sky (very faint, far from the centre so it never reads as a ring)
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a0 = 210 + (36 * i) / 24;
        const a = (m < 0 ? a0 : 540 - a0) * DEG;
        const x = RCX + 300 * Math.cos(a), y = 430 + 300 * Math.sin(a);
        if (i === 0) pm(g, x, y); else pl(g, x, y);
      }
      decoStroke(g, 0.13, w1);
    }
    // centre-top vertical hairline with ticks (reference 01 / 04)
    g.beginPath(); vseg(g, RCX, 28, RCX, 84);
    for (let y = 36; y <= 80; y += 11) { pm(g, RCX - 3, y); pl(g, RCX + 3, y); }
    decoStroke(g, 0.16, w1);
    // two chevrons above the weapon block (reference 01, bottom centre)
    for (let k = 0; k < 2; k++) {
      const y = 252 + k * 8;
      g.beginPath(); pm(g, RCX - 8, y + 4); pl(g, RCX, y - 2); pl(g, RCX + 8, y + 4); decoStroke(g, 0.32 - k * 0.1, w1);
    }
    // scattered radial dashes around the centre, deterministic; skipped where text / blocks live
    let sd = 7;
    const rr = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    g.beginPath();
    let placed = 0, tries = 0;
    while (placed < 44 && tries++ < 400) {
      const th = rr() * 6.2832, r = 72 + rr() * 150;
      const x = RCX + Math.cos(th) * r * 1.25, y = 240 + Math.sin(th) * r * 0.78;
      if (y < 30 || y > 330 || x < 60 || x > RW - 60) continue;
      if (Math.abs(x - RCX) < 175 && y > 56 && y < 130) continue;          // radio / caution text
      if (Math.abs(x - 500) < 90 && y > 180 && y < 240) continue;        // target block
      if (Math.abs(x - RCX) < 120 && y > 215 && y < 330) continue;       // crosshair + weapon block
      if (x < 285 && y > 118 && y < 344) continue;                       // speed ladder
      if (x > RW - 285 && y > 118 && y < 344) continue;                  // altitude ladder
      if (x > RW - 150 && y > 230 && y < 320) continue;                  // radar
      const L = 4 + rr() * 6;
      const tang = rr() < 0.3;
      const ax = tang ? -Math.sin(th) : Math.cos(th), ay = tang ? Math.cos(th) : Math.sin(th);
      pm(g, x, y); pl(g, x + ax * L, y + ay * L * 0.8);
      placed++;
    }
    decoStroke(g, 0.20, w1);
  }
  // travelling highlight dashes along the two outer rails (live)
  function drawDecoLive() {
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const m of [-1, 1]) {
      const t = ((time * 0.17 + (m > 0 ? 0.5 : 0)) % 1);
      const y = 44 + t * 380;
      vseg(ctx, mirX(m, railX(y)), y, mirX(m, railX(y + 14)), y + 14);
    }
    stroke(rgba(base, 0.42), LW * 1.2);
    ctx.lineCap = 'butt';
  }

  // ======================================================================================================
  // LADDERS: short scrolling ticks with numbers on the majors. side 0 = speed (left), 1 = altitude (right).
  // ======================================================================================================
  function drawLadder(side, value, unit, floorMark) {
    const u = value / unit;
    const out = side ? 1 : -1;                  // ticks point away from the centre
    const ex = side ? LAD_XR : LAD_XL;
    const iLo = Math.floor(u - (LAD_Y1 - LAD_EYE) / TICK_PX) - 1, iHi = Math.ceil(u + (LAD_EYE - LAD_Y0) / TICK_PX) + 1;
    const yOf = (idx) => LAD_EYE - (idx - u) * TICK_PX;      // the current value sits on the eye row
    ctx.beginPath(); vseg(ctx, ex, LAD_Y0, ex, LAD_Y1); stroke(rgba(base, 0.22), LW);
    for (let pass = 0; pass < 3; pass++) {
      ctx.beginPath();
      let any = false;
      for (let idx = iLo; idx <= iHi; idx++) {
        if (idx < 0) continue;
        const y = yOf(idx);
        if (y < LAD_Y0 || y > LAD_Y1) continue;
        const cls = idx % 10 === 0 ? 2 : idx % 5 === 0 ? 1 : 0;
        if (cls !== pass) continue;
        const fade = Math.min(1, (y - LAD_Y0) / 26, (LAD_Y1 - y) / 26);
        if (fade < 0.08) continue;
        const len = cls === 2 ? 14 : cls === 1 ? 9 : 5;
        pm(ctx, ex, y); pl(ctx, ex + out * len * (0.4 + 0.6 * fade), y);
        any = true;
      }
      if (any) stroke(rgba(base, A_LINE * (pass === 2 ? 1 : pass === 1 ? 0.8 : 0.55)), LW * (pass === 2 ? 1.3 : 1));
    }
    for (let idx = iLo; idx <= iHi; idx++) {
      if (idx < 0 || idx % 10 !== 0) continue;
      const y = yOf(idx);
      if (y < LAD_Y0 + 12 || y > LAD_Y1 - 12 || Math.abs(y - LAD_EYE) < 9) continue;
      TV(String(Math.round(idx * unit)), ex + out * 30, y + 0.4, rgba(base, 0.5), 8);
    }
    // 150 m/s floor tick in flight form
    if (floorMark > 0.02 && !side) {
      const ry = yOf(150 / unit);
      if (ry > LAD_Y0 + 6 && ry < LAD_Y1 - 6) {
        ctx.beginPath(); pm(ctx, ex - 2, ry); pl(ctx, ex + out * 18, ry);
        stroke(rgba(RED, 0.85 * floorMark), LW * 1.5);
      }
    }
    // index caret at the eye-level mark
    const ey = LAD_EYE;
    ctx.beginPath(); pm(ctx, ex - out * 3, ey); pl(ctx, ex - out * 11, ey - 4); pl(ctx, ex - out * 11, ey + 4); ctx.closePath();
    stroke(rgba(base, A_LINE * 0.9), LW);
  }

  // ======================================================================================================
  // CENTRE: crosshair (no ring), clamp bracket, flight path marker, horizon / short pitch ladder
  // ======================================================================================================
  function drawReticle(p) {
    ctx.lineCap = 'round';
    const aim = p.aim || {};
    const ay = num(aim.yaw, 0), ap = num(aim.pitch, 0);
    const ax = CX + ay * RAD * PPD, aY = CY - ap * RAD * PPD;
    // small body-forward mark
    ctx.beginPath(); ctx.arc(CX, CY, 2.6, 0, 6.2832);
    line(CX - 9, CY, CX - 5, CY); line(CX + 5, CY, CX + 9, CY);
    stroke(rgba(base, 0.28), LW);
    // flight-form clamp bracket at the cone edge; amber while the crosshair is pinned to it
    const kF = Math.max(fK, aim.limited ? 1 : 0);
    if (kF > 0.02) {
      const lx = CLAMP_YAW * RAD * PPD, ly = CLAMP_PITCH * RAD * PPD;
      const lim = !!aim.limited;
      ctx.beginPath();
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = CX + sx * lx, y = CY + sy * ly;
        line(x, y, x - sx * 12, y); line(x, y, x, y - sy * 12);
      }
      stroke(lim ? rgba(AMB, 0.9 * kF) : rgba(base, 0.32 * kF), LW * (lim ? 1.4 : 1));
    }
    // the crosshair: gap cross + centre dot, no ring
    const rc = rgba(base, 0.85);
    ctx.beginPath();
    line(ax - 17, aY, ax - 5, aY); line(ax + 5, aY, ax + 17, aY);
    line(ax, aY - 17, ax, aY - 5); line(ax, aY + 5, ax, aY + 17);
    stroke(rc, LW * 1.25);
    ctx.beginPath(); ctx.arc(ax, aY, 1.5, 0, 6.2832); ctx.fillStyle = rc; ctx.fill();
    ctx.lineCap = 'butt';
  }

  // world-frame horizon (short, always) + short pitch ladder (flight form only, alpha = fK) -----------------------
  function drawHorizon() {
    ctx.lineCap = 'butt';
    ctx.beginPath();
    arc(0, -16, -6, 8); arc(0, 6, 16, 8);
    stroke(rgba('255,92,80', 0.42), LW);
    ctx.beginPath();
    for (const a of [-12, 12]) { ladderDir(c2, a * DEG, 0); if (projWorldDir(c2)) line(P.x, P.y - 4, P.x, P.y + 4); }
    stroke(rgba('255,92,80', 0.35), LW);
  }
  function drawPitchLadder(k) {
    if (k < 0.02) return;
    ctx.lineCap = 'butt';
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    for (const phi of [-30, -20, -10, 10, 20, 30]) { arc(phi, -7, -3, 3); arc(phi, 3, 7, 3); }
    stroke(rgba(base, A_LINE * 0.7 * k), LW);
    ctx.setLineDash([]);
    for (const phi of [-20, -10, 10, 20]) {
      ladderDir(c2, 9 * DEG, phi * DEG);
      if (projWorldDir(c2) && onCanvas(40)) T(String(Math.abs(phi)), P.x, P.y + 3, rgba(base, 0.5 * k), 9);
    }
  }
  function drawFlightPath(p, k) {
    if (k < 0.02 || !isVec(p.velocity)) return;
    const sp = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z);
    if (sp < 20) return;
    c2.set(p.velocity.x / sp, p.velocity.y / sp, p.velocity.z / sp);
    if (!projWorldDir(c2) || !onCanvas(30)) return;
    const col = rgba(base, 0.85 * k);
    ctx.beginPath(); ctx.arc(P.x, P.y, 7, 0, 6.2832);
    line(P.x - 17, P.y, P.x - 7, P.y); line(P.x + 7, P.y, P.x + 17, P.y); line(P.x, P.y - 7, P.x, P.y - 14);
    stroke(col, LW * 1.2);
  }

  // ======================================================================================================
  // WEAPON BLOCK: active weapon, E-Pack shots + reload bar, missile count, lost systems, shield, saber blade
  // ======================================================================================================
  function drawWeaponBlock(p) {
    const w = p.weapons || {}, rifle = w.rifle || {}, fun = w.funnel || {};
    const mods = p.mods || {};
    const saber = w.active === 'saber';
    const shots = Math.max(0, Math.round(num(rifle.shots, 15))), per = Math.max(1, Math.round(num(rifle.perPack, 15)));
    const reloading = !!rifle.reloading;
    const blink = Math.sin(time * 10) > -0.2;
    const x = RCX, y0 = 304;
    // active weapon tag
    const swapFlash = swapT > 0 ? 0.6 + 0.4 * Math.sin(time * 30) : 0;
    TV(saber ? 'SABER' : 'RIFLE', x - 40, y0, saber ? rgba(CYAN, 0.95) : rgba(base, 0.9 + swapFlash * 0.1), 11, 'center');
    if (mods.rifleOk === false) {
      TV('RIFLE LOST', x + 22, y0, rgba(RED, blink ? 0.95 : 0.55), 11, 'center');
    } else {
      const low = shots <= 3;
      const col = low ? RED : base;
      TV(`${shots}/${per}`, x + 22, y0, rgba(col, low && !blink ? 0.5 : 0.95), 11, 'center');
      // reload progress bar (or a pip row of the pack)
      S(x - 36, y0 + 9); const bx = VP.x, by = VP.y;
      const bw = 72 * refScale(x, y0 + 9);
      if (reloading) {
        thinBar(bx, by, bw, 3, num(rifle.reload, 0), rgba(AMB, 0.9), rgba(AMB, 0.2));
        TV('RELOAD', x, y0 + 19, rgba(AMB, blink ? 0.95 : 0.5), 10);
      } else if (shots <= 0) {
        thinBar(bx, by, bw, 3, 0, rgba(RED, 0.9), rgba(RED, 0.3));
        TV('RELOAD', x, y0 + 19, rgba(RED, blink ? 0.95 : 0.4), 10);
      } else {
        thinBar(bx, by, bw, 3, shots / per, rgba(base, 0.7), rgba(base, 0.16));
      }
    }
    // missile (funnel) count and lost systems
    const fc = Math.round(num(fun.count, 0));
    let ly = y0 + (reloading || num(rifle.shots, 15) <= 0 ? 31 : 21);
    const pods = p.suit === 'gustav';
    if (mods.funnelOk === false) TV(pods ? 'PODS LOST' : 'FUNNEL LOST', x, ly, rgba(RED, 0.9), 10);
    else TV((pods ? 'PODS ' : 'MSL ') + fc, x, ly, funnelT > 0 ? rgba(AMB, 0.95) : rgba(base, 0.8), 10);
    if (mods.vulcanOk === false) { ly += 11; TV('VULCAN LOST', x, ly, rgba(RED, 0.9), 10); }
    if (saber && mods.saberOk === false) { ly += 11; TV('SABER LOST', x, ly, rgba(RED, 0.9), 10); }
  }

  // shield: edge + tint at the lower left, small SHIELD tag
  function drawShield(p) {
    const sh = p.shield || {};
    const k = sh.up ? saturate(num(sh.raise, 1)) : 0;
    if (k < 0.02) return;
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = 0 + t * 250, y = 214 + 128 * Math.pow(t, 1.9);
      pts.push([x, y]);
    }
    ctx.beginPath();
    pm(ctx, 0, 480);
    for (const pt of pts) pl(ctx, pt[0] * k, pt[1] + (1 - k) * 60);
    pl(ctx, 250 * k, 480);
    ctx.closePath();
    ctx.fillStyle = rgba(CYAN, 0.07 * k); ctx.fill();
    ctx.beginPath();
    pts.forEach((pt, i) => { if (i === 0) pm(ctx, pt[0] * k, pt[1] + (1 - k) * 60); else pl(ctx, pt[0] * k, pt[1] + (1 - k) * 60); });
    stroke(rgba(CYAN, 0.7 * k), LW * 1.6);
    ctx.beginPath();
    pts.forEach((pt, i) => { const x = pt[0] * k * 0.92, y = pt[1] + 14 + (1 - k) * 60; if (i === 0) pm(ctx, x, y); else pl(ctx, x, y); });
    stroke(rgba(CYAN, 0.28 * k), LW);
    TV('SHIELD', 70, 300, rgba(CYAN, 0.9 * k), 11);
  }

  // beam saber blade + swing arc (when active weapon is the saber and a slash is in progress)
  function drawSaber(p) {
    const w = p.weapons || {};
    const sl = num(w.saber && w.saber.slash, 0);
    if (w.active !== 'saber' || sl <= 0) return;
    const t = saturate(sl);
    const px = RW * 0.78, py = 440;                         // wrist pivot (lower right)
    const a0 = 215 * DEG, a1 = 330 * DEG;                    // sweep angle (screen, 0 = right, + = down... y up is negative)
    const ease = t * t * (3 - 2 * t);
    const ang = a0 + (a1 - a0) * ease;
    const L = 290;
    const dx = (a) => Math.cos(a) * L, dy = (a) => Math.sin(a) * L;
    // trail wedge
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      const aa = a0 + (ang - a0) * (i / steps), ab = a0 + (ang - a0) * ((i + 1) / steps);
      if (ang - a0 < 0.05) break;
      ctx.beginPath(); pm(ctx, px, py);
      pl(ctx, px + dx(aa) * 0.97, py + dy(aa) * 0.97); pl(ctx, px + dx(ab) * 0.97, py + dy(ab) * 0.97);
      ctx.closePath();
      ctx.fillStyle = rgba('255,150,230', 0.20 * (i / steps) * (1 - Math.max(0, t - 0.7) / 0.3));
      ctx.fill();
    }
    // arc edge
    ctx.beginPath();
    for (let i = 0; i <= 18; i++) { const a = a0 + (ang - a0) * (i / 18); if (i === 0) pm(ctx, px + Math.cos(a) * L, py + Math.sin(a) * L); else pl(ctx, px + Math.cos(a) * L, py + Math.sin(a) * L); }
    stroke(rgba('255,190,240', 0.55), LW * 1.5);
    // blade: glow, body, white core
    for (const [wd, col, al] of [[16, '255,110,210', 0.26], [8, '255,150,230', 0.6], [3, '255,255,255', 1]]) {
      ctx.beginPath(); vseg(ctx, px + Math.cos(ang) * 30, py + Math.sin(ang) * 30, px + dx(ang), py + dy(ang));
      ctx.lineCap = 'round'; stroke(rgba(col, al), wd); ctx.lineCap = 'butt';
    }
  }

  // ======================================================================================================
  // TARGET BLOCK + lead pip + funnel-lock bracket + incoming missiles
  // ======================================================================================================
  const isShip = (t) => t === 'gustav' || t === 'penelope' || t === 'remote';
  function edgeArrow(c, color, label, size, alpha, wide = false) {
    let ax = c.x, ay = c.y;
    const l = Math.hypot(ax, ay);
    if (l < 1e-4) { ax = 0; ay = -1; } else { ax /= l; ay /= l; }
    const ex = CX + ax * 40 * PPD;
    let ey = CY - ay * 31 * PPD;
    if (ey > CY + 12 * PPD) ey = CY + 12 * PPD;            // the consoles hide the lower part of the sphere
    const ang = Math.atan2(-((CY - ey) / (31 * PPD)), ax);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(ex, ey); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(-size * 0.5, -size * 0.8); ctx.lineTo(size * 0.5, 0); ctx.lineTo(-size * 0.5, size * 0.8);
    ctx.lineJoin = 'miter'; stroke(color, LW * (wide ? 2.6 : 1.4));
    ctx.beginPath(); ctx.moveTo(-size * 1.1, -size * 0.8); ctx.lineTo(-size * 0.1, 0); ctx.lineTo(-size * 1.1, size * 0.8);
    stroke(color, wide ? LW * 1.8 : LW);
    ctx.restore();
    lastFont = '';
    if (label) T(label, ex - ax * 34, ey + ay * 30 + 4, wide ? rgba('255,214,218', 1) : color, wide ? 12 : 10, 'center', wide ? 600 : 400);
  }
  function vMark(x, y, s, color, w) {
    ctx.beginPath(); ctx.moveTo(x - s, y - s * 0.75); ctx.lineTo(x, y + s * 0.55); ctx.lineTo(x + s, y - s * 0.75);
    stroke(color, w);
  }
  function corners(x, y, half, color, w, len = 0.34) {
    ctx.beginPath();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const px = x + sx * half, py = y + sy * half, l = half * len;
      line(px, py, px - sx * l, py); line(px, py, px, py - sy * l);
    }
    stroke(color, w);
  }

  function drawTargetBlock(p, mods) {
    const tg = p.target || {};
    const e = tg.id != null ? byId.get(tg.id) : null;
    if (!e) return;
    const x = 488, y = 124;
    const readable = mods.targetReadable !== false;
    const name = String(e.name || e.type || 'TARGET').toUpperCase();
    const glitch = headStatus !== 'ok' && hash1(Math.floor(time * 12) + 3) > (headStatus === 'destroyed' ? 0.35 : 0.8);
    const jx = glitch ? (hash1(Math.floor(time * 30)) - 0.5) * 6 : 0;
    ctx.beginPath(); vseg(ctx, x - 6, y - 12, x - 6, y + 28); stroke(rgba(base, 0.35), LW);
    TV(name, x + jx, y - 6, rgba(base, 0.9), 10, 'left');
    const d = num(tg.distance, 0) > 0 ? tg.distance : (p.position ? Math.hypot(e.position.x - p.position.x, e.position.y - p.position.y, e.position.z - p.position.z) : 0);
    const cl = num(tg.closing, 0);
    TV(`${fmt(d)} M`, x + jx, y + 6, rgba(base, 0.8), 10, 'left');
    if (Math.abs(cl) > 5) TV(`${cl > 0 ? '+' : ''}${Math.round(cl)}`, x + 62 + jx, y + 6, rgba(cl > 0 ? AMB : base, 0.7), 9, 'left');
    // HP bar
    S(x, y + 15); const bx = VP.x, by = VP.y;
    const bw = 76 * refScale(x, y + 15);
    if (readable && !glitch) {
      const f = saturate(num(e.hp, 0) / Math.max(1, num(e.maxHp, 1)));
      thinBar(bx, by, bw, 3, f, rgba(f < 0.3 ? RED : base, 0.85), rgba(base, 0.16));
    } else {
      T('HP --', bx, by + 5, rgba(AMB, 0.8), 9, 'left');
    }
  }

  function drawTargets(p, mods) {
    const pos = p.position;
    if (!pos) return;
    ctx.lineJoin = 'miter';
    const lock = p.lock || {};
    const lstate = lock.state || 'none';
    const lprog = saturate(num(lock.progress, 0));
    const tg = p.target || {};
    let arrows = 0;
    const ents = entList();
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e || e.alive === false || !isVec(e.position)) continue;
      if (e.faction === 'player' || e.faction === 'ally' || e.faction === 'neutral' || e.dead || !isShip(e.type)) continue;      // allies / neutrals never get target / lock / lead visuals
      c2.set(e.position.x - pos.x, e.position.y - pos.y, e.position.z - pos.z);
      const dist = Math.max(1, c2.length());
      c2.applyQuaternion(qInv);
      const vis = projCockpit(c2);
      const isLock = e.id === lock.targetId && lstate !== 'none';
      const isTgt = e.id === tg.id;
      if (!vis || P.x < 30 || P.x > W - 30 || P.y < 30 || P.y > H - 30) {
        if (isLock && arrows < 8) { edgeArrow(c2.normalize(), rgba(lstate === 'locked' ? ORG : AMB, 1), null, 8, 1); arrows++; }
        continue;
      }
      const rad = Math.atan2(num(e.radius, 10), dist) * RAD;
      const half = clamp(rad * PPD * 1.15, 13, 120);
      const x = P.x, y = P.y;
      if (isLock) {
        // funnel-lock bracket
        let h = Math.max(half, 20), col, w = LW * 1.6;
        if (lstate === 'locked') col = rgba(ORG, 0.95);
        else { h *= 1 + (1 - lprog) * 1.2; col = Math.sin(time * 22) > -0.3 ? rgba(AMB, 0.95) : rgba(AMB, 0.3); }
        if (lockFlash > 0) h *= 1 + lockFlash * 0.5;
        corners(x, y, h, col, w);
        corners(x, y, h * 0.62, col, w * 0.8, 0.22);
        T(lstate === 'locked' ? 'FNL LOCK' : 'FNL ...', x, y + h + 14, col, 9);
      } else if (isTgt) {
        mix.triMarker('tgt' + e.id, x, y - clamp(half * 0.9, 12, 80), 20, ORG, 0.95, -18);
      } else if (e.type !== 'remote') {
        vMark(x, y - 12, 6, rgba(base, 0.5), LW);
      }
    }
    // lead pip: where to aim so a rifle shot meets the target (no magnetism)
    if (isVec(tg.leadPoint) && mods.targetReadable !== false) {
      c2.set(tg.leadPoint.x - pos.x, tg.leadPoint.y - pos.y, tg.leadPoint.z - pos.z).applyQuaternion(qInv);
      if (projCockpit(c2) && onCanvas(10)) {
        const col = rgba(WARM, 0.95);
        circle(P.x, P.y, 6, col, LW);
        ctx.beginPath(); ctx.moveTo(P.x + 1.3, P.y); ctx.arc(P.x, P.y, 1.3, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
      }
    }
    ctx.lineJoin = 'round';
  }


  // CR-004 neutral scripted carrier (Penelope): white bracket + tag, never an enemy.
  function drawNeutrals(p) {
    const pos = p.position;
    if (!pos) return;
    const ents = entList();
    ctx.lineJoin = 'miter';
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e || e.faction !== 'neutral' || e.type === 'gawman' || e.alive === false || !isVec(e.position)) continue;
      c2.set(e.position.x - pos.x, e.position.y - pos.y, e.position.z - pos.z);
      const dist = Math.max(1, c2.length());
      c2.applyQuaternion(qInv);
      const name = String(e.name || 'PENELOPE').toUpperCase().replace(/^RX-\S+\s+/, '');
      const vis = projCockpit(c2);
      if (!vis || P.x < 30 || P.x > W - 30 || P.y < 30 || P.y > H - 30) { edgeArrow(c2.normalize(), rgba(WHITE, 0.9), name, 9, 0.9); continue; }
      const rad = Math.atan2(num(e.radius, 20), dist) * RAD;
      const half = clamp(rad * PPD * 1.15, 16, 130);
      const t = mix.track('neu' + e.id, P.x, P.y);
      corners(t.x, t.y, half * 0.85, rgba(WHITE, 0.85), LW * 1.8, 0.28);
      T(name, t.x, t.y - half * 0.85 - 12, rgba(WHITE, 0.95), 24, 'center', 500);
      T(`${fmt(dist)} M`, t.x, t.y + half * 0.85 + 26, rgba(WHITE, 0.85), 20);
    }
    ctx.lineJoin = 'round';
  }

  // ======================================================================================================
  // CR-013 STORY CHAPTER 2: Seawrack bracket (green; amber once found, with its hull bar), radar pickets (red diamonds),
  // the radar exposure panel, landing guidance and the chapter title card. Reads state.story only.
  // ======================================================================================================
  function drawStory2(p) {
    const st = state.story;
    if (!st || st.chapter !== 2 || !st.seawrack || !isVec(p.position)) return;
    const pos = p.position, sw = st.seawrack, rd = st.radar || {}, L = st.landing || {};
    const onScreen = () => P.x >= 30 && P.x <= W - 30 && P.y >= 30 && P.y <= H - 30;
    ctx.lineJoin = 'miter';
    for (const pk of st.pickets || []) {
      if (!isVec(pk.position)) continue;
      c2.set(pk.position.x - pos.x, 25 - pos.y, pk.position.z - pos.z);
      const dist = Math.max(1, c2.length());
      if (dist > 30000) continue;
      c2.applyQuaternion(qInv);
      if (!projCockpit(c2) || !onScreen()) continue;
      const a = pk.painted ? 0.55 + 0.45 * Math.sin(time * 14) : 0.8;
      ctx.beginPath(); ctx.moveTo(P.x, P.y - 9); ctx.lineTo(P.x + 9, P.y); ctx.lineTo(P.x, P.y + 9); ctx.lineTo(P.x - 9, P.y); ctx.closePath();
      stroke(rgba(RED, a), LW * 1.6);
      T(`PICKET ${num(pk.id, 0) + 1}`, P.x, P.y - 16, rgba(RED, a), 18, 'center', 500);
      T(`${fmt(dist)} M`, P.x, P.y + 26, rgba(RED, 0.7), 16);
    }
    if (isVec(sw.position)) {
      c2.set(sw.position.x - pos.x, sw.position.y + 40 - pos.y, sw.position.z - pos.z);
      const dist = Math.max(1, c2.length());
      c2.applyQuaternion(qInv);
      const col = sw.alive === false ? RED : sw.found ? AMB : ALLY;
      if (!projCockpit(c2) || !onScreen()) edgeArrow(c2.normalize(), rgba(col, 0.95), 'SEAWRACK', 10, 0.95, true);
      else {
        const half = clamp(Math.atan2(160, dist) * RAD * PPD, 14, 160);
        const t = mix.track('seawrack', P.x, P.y);
        corners(t.x, t.y, half, rgba(col, 0.9), LW * 1.8, 0.28);
        T('SEAWRACK', t.x, t.y - half - 12, rgba(col, 0.95), 24, 'center', 600);
        T(`${fmt(dist)} M`, t.x, t.y + half + 26, rgba(col, 0.85), 20);
        if (sw.found || num(sw.hp, 1) < 1) thinBar(t.x - 60, t.y + half + 36, 120, 6, saturate(num(sw.hp, 1)), rgba(num(sw.hp, 1) < 0.3 ? RED : AMB, 0.95), rgba(AMB, 0.2));
      }
    }
    // radar exposure panel under the radio line
    S(RCX, 132); const py = VP.y;
    const meter = saturate(num(rd.meter, 0));
    const state2 = rd.state === 'painted' ? 'RADAR PAINT' : rd.state === 'hidden' ? 'UNDER RADAR' : 'NO RADAR COVER';
    const colR = rd.state === 'painted' ? (meter > 0.6 ? RED : AMB) : rd.state === 'hidden' ? ALLY : base;
    const blink = rd.state === 'painted' && meter > 0.6 ? 0.6 + 0.4 * Math.sin(time * 16) : 1;
    T(state2, CX, py, rgba(colR, 0.95 * blink), 20, 'center', 600);
    thinBar(CX - 110, py + 10, 220, 6, meter, rgba(colR, 0.95), rgba(colR, 0.2));
    if (num(rd.cooldown, 0) > 0) T('DETECTED', CX, py + 34, rgba(RED, 0.6 + 0.4 * Math.sin(time * 10)), 18, 'center', 600);
    // landing guidance near the ship
    if (sw.alive !== false && isVec(sw.position) && pos.distanceTo(sw.position) < 3500) {
      const gy = CY + 9 * PPD;
      if (L.blocked === 'strike') T('LANDING DENIED — STRIKE GROUP', CX, gy, rgba(RED, 0.9), 20, 'center', 600);
      else if (L.blocked === 'chased') T('LANDING DENIED — LOSE YOUR PURSUERS', CX, gy, rgba(RED, 0.9), 20, 'center', 600);
      else {
        T(L.ready ? 'HOLD — TOUCHING DOWN' : L.over ? 'LOWER AND SLOWER' : 'LAND ON THE MARKED DECK', CX, gy, rgba(L.ready ? ALLY : AMB, 0.95), 20, 'center', 600);
        thinBar(CX - 90, gy + 10, 180, 6, saturate(num(L.progress, 0)), rgba(ALLY, 0.95), rgba(ALLY, 0.2));
      }
    }
    // title card
    const tt = num(st.title, 0);
    if (tt > 0) {
      const ga1 = ctx.globalAlpha;
      ctx.globalAlpha = ga1 * saturate(tt / 1.0) * saturate((6 - tt) / 0.6);
      T('CHAPTER 2', CX, CY - 12 * PPD, rgba(WHITE, 0.95), 26, 'center', 600);
      T('RETURN TO SEAWRACK', CX, CY - 12 * PPD + 34, rgba(WHITE, 0.9), 36, 'center', 600);
      ctx.globalAlpha = ga1;
    }
    ctx.lineJoin = 'round';
  }

  // ======================================================================================================
  // CR-003 REMOTE PILOTS: IFF brackets + callsign tags (reads entities type 'remote': name, faction, radius, dead)
  // allies cyan-green, enemies red. Allies never get target / lock / lead visuals (drawTargets skips faction 'ally').
  // ======================================================================================================
  function drawRemotes(p) {
    const pos = p.position;
    if (!pos) return;
    const ents = entList();
    let arrows = 0;
    ctx.lineJoin = 'miter';
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e || e.type !== 'remote' || e.alive === false || e.dead || !isVec(e.position)) continue;
      const ally = e.faction === 'ally';
      const col = ally ? ALLY : RED;
      c2.set(e.position.x - pos.x, e.position.y - pos.y, e.position.z - pos.z);
      const dist = Math.max(1, c2.length());
      c2.applyQuaternion(qInv);
      const name = String(e.name || 'PILOT').toUpperCase();
      const vis = projCockpit(c2);
      if (!vis || P.x < 30 || P.x > W - 30 || P.y < 30 || P.y > H - 30) {
        if (ally && arrows < 4) { edgeArrow(c2.normalize(), rgba(ALLY, 0.9), name, 8, 0.9); arrows++; }
        continue;
      }
      const rad = Math.atan2(num(e.radius, 20), dist) * RAD;
      const half = clamp(rad * PPD * 1.15, 13, 120);
      const x = P.x, y = P.y;
      corners(x, y, half * 0.82, rgba(col, ally ? 0.95 : 0.85), LW * 1.8, 0.3);
      const ty = y - half * 0.82 - 32;
      ctx.beginPath(); line(x, ty + 28, x, y - half * 0.82 - 2); stroke(rgba(col, 0.55), LW * 1.2);
      T(name, x, ty, rgba(ally ? ALLY : '255,214,190', 1), 22, 'center', 600);
      T(`${fmt(dist)} M`, x, ty + 20, rgba(col, 0.95), 16);
      if (ally) T('ALLY', x, y + half * 0.82 + 16, rgba(ALLY, 0.8), 11);
    }
    ctx.lineJoin = 'round';
  }

  // ======================================================================================================
  // CR-003 MATCH HUD (only when match.type !== 'single'): timer + score, kill feed, hit marker, countdown, spawn
  // protection, comms line, scoreboard (Tab or matchOver), respawn screen, end card. Everything on this canvas.
  // ======================================================================================================
  const pad2 = (n) => String(n).padStart(2, '0');
  const mmss = (t) => { t = Math.max(0, Math.ceil(num(t, 0))); return `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`; };
  const MODE_NAME = { ffa: 'FREE FOR ALL', team: 'TEAM BATTLE', coop: 'CO-OP' };
  const TEAM_NAME = ['ALPHA', 'BRAVO'];
  const scoresOf = (m) => (Array.isArray(m.scores) ? m.scores : EMPTY);
  const selfOf = (m) => { const sc = scoresOf(m); for (let i = 0; i < sc.length; i++) if (sc[i] && sc[i].isSelf) return sc[i]; return null; };
  const teamCol = (m, t) => (m.selfTeam == null ? PALE : t === m.selfTeam ? ALLY : RED);

  function winnerText(m) {
    const w = m.winner;
    if (!w) return { text: 'MATCH OVER', col: PALE };
    const me = selfOf(m);
    if (w.coop === true) return { text: 'MISSION COMPLETE', col: CYAN };
    if (w.coop === false) return { text: 'ALL PILOTS LOST', col: RED };
    if (typeof w.team === 'number') return m.selfTeam === w.team ? { text: `VICTORY  -  TEAM ${TEAM_NAME[w.team] || w.team} WINS`, col: CYAN } : { text: `DEFEAT  -  TEAM ${TEAM_NAME[w.team] || w.team} WINS`, col: RED };
    if (w.name) return me && me.name === w.name ? { text: 'VICTORY', col: CYAN } : { text: `${String(w.name).toUpperCase()} WINS`, col: AMB };
    return { text: 'MATCH OVER', col: PALE };
  }

  function drawMatch(p, phase) {
    const m = state.match || {};
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'round';
    if (phase === 'respawn') drawRespawn(m);
    if (phase !== 'matchOver') {
      if (m.state === 'countdown') drawCountdown(m);
      drawMatchStatus(m);
      if (num(m.spawnShield, 0) > 0 && phase !== 'respawn') {
        const blink = 0.65 + 0.35 * Math.sin(time * 8);
        TV(`SPAWN PROTECTION  ${num(m.spawnShield, 0).toFixed(1)}`, RCX, 52, rgba(CYAN, blink), 10);
      }
    }
    drawFeed(m);
    if (commsT > 0) TV(commsText, RCX, 76, rgba(GREEN, saturate(commsT / 0.5)), 11);
    if (engageT > 0) T('ENGAGE', CX, CY - 4 * PPD, rgba(GREEN, saturate(engageT / 0.6)), 44, 'center', 500);
    if (hitT > 0 && phase !== 'respawn') drawHitMarker(p);
    if (phase === 'matchOver' || (state.input && state.input.scoreboard)) drawScoreboard(m, phase === 'matchOver');
  }

  function drawMatchStatus(m) {
    const type = m.type;
    const self = selfOf(m);
    const live = m.state === 'live';
    TV(`${MODE_NAME[type] || String(type).toUpperCase()}   ${live ? mmss(m.timeLeft) : m.state === 'countdown' ? 'STANDBY' : '--:--'}`, RCX, 30, rgba(base, 0.92), 14, 'center');
    let line2 = '';
    let col = base;
    if (type === 'team') {
      const ts = Array.isArray(m.teamScores) ? m.teamScores : [0, 0];
      const st = m.selfTeam === 1 ? 1 : 0;
      line2 = `ALLY ${num(ts[st], 0)}  -  ${num(ts[1 - st], 0)} ENEMY`;
    } else if (type === 'coop') {
      const ms = state.mission || {};
      line2 = `WAVE ${num(ms.wave, 0)}/${num(ms.waveCount, 3)}   KILLS ${num(ms.kills, self ? self.kills : 0)}`;
    } else {
      const lim = num(state.net && state.net.settings && state.net.settings.scoreLimit, 0);
      line2 = `KILLS ${self ? num(self.kills, 0) : 0}${lim > 0 ? ' / ' + lim : ''}   DEATHS ${self ? num(self.deaths, 0) : 0}`;
    }
    TV(line2, RCX, 41, rgba(col, 0.8), 10, 'center');
  }

  function drawFeed(m) {
    const feed = Array.isArray(m.feed) ? m.feed : EMPTY;
    const me = selfOf(m);
    const myName = me ? me.name : (state.net && state.net.profile && state.net.profile.name) || '';
    let row = 0;
    for (let i = Math.max(0, feed.length - 5); i < feed.length; i++) {
      const f = feed[i];
      if (!f) continue;
      const a = saturate(num(f.ttl, 3) / 1.0);
      if (a <= 0) continue;
      const kn = String(f.killer || '?').toUpperCase(), vn = String(f.victim || '?').toUpperCase();
      const mine = f.killer === myName, died = f.victim === myName;
      const col = mine ? ALLY : died ? RED : PALE;
      TV(`${kn}  [${String(f.weapon || '').toUpperCase()}]  ${vn}`, RW - 96, 56 + row * 13, rgba(col, 0.9 * a), 10, 'right');
      row++;
    }
  }

  function drawHitMarker(p) {
    const aim = p.aim || {};
    const ax = CX + num(aim.yaw, 0) * RAD * PPD, ay = CY - num(aim.pitch, 0) * RAD * PPD;
    const k = hitT / hitDur;
    const d = hitKill ? 10 + 8 * (1 - k) : 8, len = hitKill ? 14 : 7;
    ctx.beginPath();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) line(ax + sx * d, ay + sy * d, ax + sx * (d + len), ay + sy * (d + len));
    ctx.lineCap = 'round';
    stroke(hitKill ? rgba(RED, saturate(k * 1.6)) : rgba('255,255,255', saturate(k * 1.5)), hitKill ? LW * 2.6 : LW * 1.6);
    ctx.lineCap = 'butt';
  }

  function drawCountdown(m) {
    const cd = Math.max(0, num(m.countdown, 0));
    const n = Math.max(1, Math.ceil(cd));
    const frac = n - cd;
    T('MATCH STARTS IN', CX, CY - 7 * PPD, rgba(PALE, 0.7), 16, 'center');
    T(String(n), CX, CY + 60, rgba(PALE, 0.95 - 0.5 * frac), 210, 'center', 300);
    ctx.beginPath(); ctx.arc(CX, CY, 150 + 60 * frac, 0, 6.2832); stroke(rgba(PALE, 0.4 * (1 - frac)), LW * 1.4);
  }

  function drawRespawn(m) {
    // dead suit: static bands + dark; the monitor pass blanks the picture in this phase
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = rgba(PALE, 1);
    for (let i = 0; i < 22; i++) {
      const y = hash1(Math.floor(time * 14) + i * 3.1) * H;
      ctx.fillRect(CX - 40 * PPD + hash1(i + Math.floor(time * 14)) * 80 * PPD, y, 40 + hash1(i) * 260, 1.5);
    }
    ctx.globalAlpha = 1;
    const pulse = 0.65 + 0.35 * Math.sin(time * 6);
    T('SIGNAL LOST', CX, CY - 7 * PPD, rgba(RED, pulse), 38, 'center', 500);
    const left = Math.max(0, num(m.respawnIn, 0));
    T(`RESPAWN IN ${Math.ceil(left)}`, CX, CY - 7 * PPD + 40, rgba(AMB, 0.95), 22, 'center', 500);
    const total = Math.max(1, num(state.net && state.net.settings && state.net.settings.respawn, 5));
    thinBar(CX - 130, CY - 7 * PPD + 54, 260, 3, 1 - left / total, rgba(AMB, 0.9), rgba(AMB, 0.2));
    const feed = Array.isArray(m.feed) ? m.feed : EMPTY;
    const me = selfOf(m);
    const myName = me ? me.name : (state.net && state.net.profile && state.net.profile.name) || '';
    for (let i = feed.length - 1; i >= 0; i--) {
      if (feed[i] && feed[i].victim === myName) { T(`DESTROYED BY ${String(feed[i].killer || '?').toUpperCase()}`, CX, CY - 7 * PPD + 78, rgba(PALE, 0.8), 14, 'center'); break; }
    }
  }

  function drawScoreboard(m, over) {
    ctx.save();
    ctx.translate(CX, CY); ctx.scale(1.55, 1.55); ctx.translate(-CX, -CY);
    drawScoreboardInner(m, over);
    ctx.restore();
    lastFont = '';
  }
  function drawScoreboardInner(m, over) {
    const sc = scoresOf(m);
    const rows = Math.min(sc.length, 8);
    const x0 = CX - 330, w = 660;
    const top = CY - (over ? 250 : 190);
    const rowH = 27;
    const h = 96 + rows * rowH + (m.type === 'team' ? 34 : 0) + (over ? 40 : 0);
    // panel
    ctx.fillStyle = 'rgba(4,9,20,0.84)'; ctx.fillRect(x0, top, w, h);
    ctx.beginPath(); ctx.rect(x0, top, w, h); stroke(rgba(base, 0.5), LW * 1.2);
    let y = top + 28;
    if (over) {
      const wt = winnerText(m);
      T(wt.text, CX, y + 6, rgba(wt.col, 1), 30, 'center', 500);
      y += 40;
    } else {
      T(`${MODE_NAME[m.type] || String(m.type).toUpperCase()}   ${m.state === 'live' ? mmss(m.timeLeft) : ''}`, CX, y, rgba(base, 0.9), 16, 'center');
      y += 6;
    }
    if (m.type === 'team') {
      const ts = Array.isArray(m.teamScores) ? m.teamScores : [0, 0];
      T(`${TEAM_NAME[0]}  ${num(ts[0], 0)}`, CX - 90, y + 20, rgba(teamCol(m, 0), 0.95), 18, 'right', 500);
      T('-', CX, y + 20, rgba(PALE, 0.6), 18, 'center');
      T(`${num(ts[1], 0)}  ${TEAM_NAME[1]}`, CX + 90, y + 20, rgba(teamCol(m, 1), 0.95), 18, 'left', 500);
      y += 34;
    }
    y += 22;
    ctx.beginPath(); line(x0 + 14, y + 6, x0 + w - 14, y + 6); stroke(rgba(base, 0.35), LW);
    const colx = { n: x0 + 26, name: x0 + 52, team: x0 + 350, k: x0 + 460, d: x0 + 525, ping: x0 + w - 26 };
    T('#', colx.n, y, rgba(base, 0.55), 11, 'center');
    T('PILOT', colx.name, y, rgba(base, 0.55), 11, 'left');
    if (m.type === 'team') T('TEAM', colx.team, y, rgba(base, 0.55), 11, 'center');
    T('K', colx.k, y, rgba(base, 0.55), 11, 'right');
    T('D', colx.d, y, rgba(base, 0.55), 11, 'right');
    T('PING', colx.ping, y, rgba(base, 0.55), 11, 'right');
    y += rowH - 2;
    for (let i = 0; i < rows; i++) {
      const r = sc[i];
      if (!r) continue;
      const c = r.isSelf ? CYAN : m.type === 'team' ? teamCol(m, r.team) : PALE;
      if (r.isSelf) { ctx.fillStyle = rgba(CYAN, 0.12); ctx.fillRect(x0 + 8, y - 17, w - 16, 23); ctx.beginPath(); line(x0 + 8, y - 17, x0 + 8, y + 6); stroke(rgba(CYAN, 0.9), LW * 2); }
      T(String(i + 1), colx.n, y, rgba(c, 0.8), 14, 'center');
      const nm = String(r.name || 'PILOT').toUpperCase().slice(0, 16);
      T(nm, colx.name, y, rgba(c, 0.98), 15, 'left', r.isSelf ? 600 : 400);
      if (r.isHost) { font(15, r.isSelf ? 600 : 400); const nw = ctx.measureText(nm).width; T('HOST', colx.name + nw + 12, y - 1, rgba(AMB, 0.9), 10, 'left'); }
      if (m.type === 'team') T(TEAM_NAME[r.team] || '-', colx.team, y, rgba(teamCol(m, r.team), 0.9), 13, 'center');
      T(String(num(r.kills, 0)), colx.k, y, rgba(c, 0.98), 15, 'right', 500);
      T(String(num(r.deaths, 0)), colx.d, y, rgba(c, 0.8), 15, 'right');
      T(r.isSelf ? '--' : String(Math.round(num(r.ping, 0))), colx.ping, y, rgba(c, 0.7), 13, 'right');
      y += rowH;
    }
    if (over) T('WAITING FOR THE HOST', CX, top + h - 14, rgba(PALE, 0.55), 12, 'center');
  }

  // incoming missiles: bright red diamond + range + time to impact; edge arrows when off-screen / behind
  function drawIncoming(p) {
    const pos = p.position;
    if (!pos) return;
    const thr = p.threat || {};
    let list = Array.isArray(thr.incoming) ? thr.incoming : EMPTY;
    let fallback = null;
    if (!list.length) {                       // contract field still empty: derive from the missile entities
      fallback = [];
      const ents = entList();
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (!e || e.alive === false || e.type !== 'missile' || e.faction === 'player' || !isVec(e.position)) continue;
        if (e.targetId !== 'player') continue;
        const d = Math.hypot(e.position.x - pos.x, e.position.y - pos.y, e.position.z - pos.z);
        if (d > 6000) continue;
        const vr = isVec(e.velocity) && isVec(p.velocity) ? (e.velocity.x - p.velocity.x) * (pos.x - e.position.x) / d + (e.velocity.y - p.velocity.y) * (pos.y - e.position.y) / d + (e.velocity.z - p.velocity.z) * (pos.z - e.position.z) / d : 0;
        fallback.push({ id: e.id, distance: d, tti: vr > 1 ? d / vr : Infinity });
      }
      list = fallback;
    }
    const pulse = 0.5 + 0.5 * Math.sin(time * 14);
    let arrows = 0;
    ctx.lineJoin = 'miter';
    for (let i = 0; i < list.length && i < 10; i++) {
      const m = list[i];
      const e = byId.get(m.id);
      if (!e || !isVec(e.position)) continue;
      c2.set(e.position.x - pos.x, e.position.y - pos.y, e.position.z - pos.z).applyQuaternion(qInv);
      const d = num(m.distance, c2.length());
      const tti = num(m.tti, Infinity);
      const label = isFinite(tti) ? `${tti.toFixed(1)}S` : '';
      const vis = projCockpit(c2);
      if (vis && P.x > 30 && P.x < W - 30 && P.y > 30 && P.y < H - 30) {
        // CR-002b (reference 12 / 15): a bold pulsing red diamond, bright core, tick marks, bold range + time-to-impact
        const urgent = tti < 3.5;
        const s = 19 + (urgent ? 6 : 2) * pulse;
        const dm = (r) => { ctx.beginPath(); ctx.moveTo(P.x, P.y - r); ctx.lineTo(P.x + r, P.y); ctx.lineTo(P.x, P.y + r); ctx.lineTo(P.x - r, P.y); ctx.closePath(); };
        dm(s); ctx.fillStyle = rgba(RED, 0.16 + 0.26 * pulse); ctx.fill();
        dm(s); stroke(rgba(RED, 0.8 + 0.2 * pulse), LW * 2.8);
        dm(s * 0.5); stroke(rgba('255,205,210', 0.55 + 0.4 * pulse), LW * 1.3);
        ctx.beginPath();
        for (const [sx, sy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { line(P.x + sx * (s + 3), P.y + sy * (s + 3), P.x + sx * (s + 8 + 3 * pulse), P.y + sy * (s + 8 + 3 * pulse)); }
        stroke(rgba(RED, 0.9), LW * 1.8);
        T(`${fmt(d)} M`, P.x, P.y + s + 20, rgba('255,214,218', 1), 15, 'center', 600);
        if (label) T(label, P.x, P.y + s + 37, urgent && pulse > 0.5 ? rgba('255,255,255', 1) : rgba(RED, 1), 17, 'center', 600);
      } else if (arrows < 8) {
        edgeArrow(c2.normalize(), rgba(RED, 1), (label ? label + '  ' : '') + fmt(d) + 'M', 12 + 2 * pulse, 0.7 + 0.3 * pulse, true); arrows++;
      }
    }
    ctx.lineJoin = 'round';
  }

  // ======================================================================================================
  // RADAR (small): heading-up, range scales with mods.radarRange, static when the head is damaged
  // ======================================================================================================
  const RADAR = { x: RW - 98, y: 268, r: 34 };
  function drawRadar(p, mods) {
    const pos = p.position;
    S(RADAR.x, RADAR.y); const cx = VP.x, cy = VP.y;
    const r = RADAR.r * refScale(RADAR.x, RADAR.y);
    const range = 8000 * clamp(num(mods.radarRange, 1), 0.1, 1);
    const dens = saturate(num(state.world && state.world.minovskyDensity, 0));
    const jam = dens > 0.8;
    ctx.lineCap = 'butt';
    circle(cx, cy, r, rgba(base, 0.5), LW);
    circle(cx, cy, r * 0.5, rgba(base, 0.2), LW);
    ctx.beginPath(); line(cx - r, cy, cx + r, cy); line(cx, cy - r, cx, cy + r); stroke(rgba(base, 0.16), LW);
    ctx.beginPath();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * 6.2832; line(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3), cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    stroke(rgba(base, 0.3), LW);
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 4, cy + 4); ctx.lineTo(cx - 4, cy + 4); ctx.closePath(); ctx.fillStyle = rgba(base, 0.85); ctx.fill();
    if (pos) {
      const ents = entList();
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (!e || e.alive === false || e.faction === 'player' || e.dead || !isVec(e.position)) continue;
        const ship = isShip(e.type), msl = e.type === 'missile';
        const gaw = e.type === 'gawman';
        if (!ship && !msl && !gaw) continue;
        const ally = e.faction === 'ally' || e.faction === 'neutral';
        if (ally && msl) continue;
        c2.set(e.position.x - pos.x, e.position.y - pos.y, e.position.z - pos.z);
        const d = c2.length();
        if (d > range) continue;
        if ((jam || headStatus === 'damaged') && hash1(Math.floor(time * 8) + i * 7.3) < (jam ? 0.35 : 0.2)) continue;
        c2.applyQuaternion(qInv);
        const k = Math.sqrt(d / range) * r * 0.94 / Math.max(1e-3, Math.hypot(c2.x, c2.z));
        let bx = cx + c2.x * k, by = cy + c2.z * k;                 // forward (-z) is up on the radar
        if (headStatus === 'destroyed') { bx += (hash1(Math.floor(time * 20) + i) - 0.5) * 10; by += (hash1(Math.floor(time * 17) + i * 3) - 0.5) * 10; }
        if (gaw) {
          ctx.beginPath(); ctx.moveTo(bx - 4, by - 3); ctx.lineTo(bx + 4, by - 3); ctx.lineTo(bx, by + 4); ctx.closePath(); ctx.fillStyle = rgba(ORG, 0.95); ctx.fill();
        } else if (msl) {
          ctx.beginPath(); ctx.moveTo(bx, by - 3.5); ctx.lineTo(bx + 3.5, by); ctx.lineTo(bx, by + 3.5); ctx.lineTo(bx - 3.5, by); ctx.closePath();
          ctx.fillStyle = rgba(RED, 0.95); ctx.fill();
        } else {
          ctx.beginPath(); ctx.moveTo(bx - 4, by + 3); ctx.lineTo(bx, by - 3.5); ctx.lineTo(bx + 4, by + 3);
          stroke(rgba(e.faction === 'neutral' ? WHITE : ally ? ALLY : RED, 0.95), LW * 1.5);
          const dy = c2.y;
          if (Math.abs(dy) > 250) { ctx.beginPath(); line(bx, by + (dy > 0 ? -7 : 7), bx, by + (dy > 0 ? -10 : 10)); stroke(rgba(RED, 0.7), LW); }
          const tg = p.target && p.target.id;
          if (e.id === tg) circle(bx, by, 7, rgba(AMB, 0.8), LW);
        }
      }
    }
    // static when the head is damaged / lost
    if (headStatus !== 'ok' || jam) {
      const n = headStatus === 'destroyed' ? 9 : 4;
      ctx.fillStyle = rgba(base, 0.5);
      for (let i = 0; i < n; i++) {
        const yy = cy - r + hash1(Math.floor(time * 18) + i * 3.7) * r * 2;
        const half = Math.sqrt(Math.max(0, r * r - (yy - cy) * (yy - cy)));
        ctx.fillRect(cx - half * hash1(i + Math.floor(time * 18)), yy, half * (0.4 + hash1(i * 2.1 + Math.floor(time * 18))), 1);
      }
    }
    TV(`${(range / 1000).toFixed(1)}K`, RADAR.x, RADAR.y + RADAR.r + 9, rgba(base, 0.55), 8);
    const hd = Math.round(((num(p.headingDeg, 0) % 360) + 360) % 360);
    TV(String(hd).padStart(3, '0'), RADAR.x, RADAR.y - RADAR.r - 8, rgba(base, 0.55), 8);
  }

  // ======================================================================================================
  // main update  (hctx = { dt, time, emergency, aspect })
  // ======================================================================================================
  let hudAcc = 1, wrapPower = 0;
  function update(dt, hctx) {
    time += dt;
    jitter = Math.max(0, jitter - dt); lockFlash = Math.max(0, lockFlash - dt); lostFlash = Math.max(0, lostFlash - dt);
    waveBanner = Math.max(0, waveBanner - dt); killT = Math.max(0, killT - dt); sectorT = Math.max(0, sectorT - dt);
    hitT = Math.max(0, hitT - dt); commsT = Math.max(0, commsT - dt); engageT = Math.max(0, engageT - dt);
    funnelT = Math.max(0, funnelT - dt); uiClickT = Math.max(0, uiClickT - dt); swapT = Math.max(0, swapT - dt); refusedT = Math.max(0, refusedT - dt);

    const p = state.player || {};
    const phase = state.phase;
    const st = state.startup || {};
    const stage = phase === 'startup' ? Math.max(0, Math.floor(num(st.stage, 0))) : 4;
    const prog = saturate(num(st.progress, 0));
    const dens = saturate(num(state.world && state.world.minovskyDensity, 0));
    const stress = saturate(num(p.stress, 0));

    const mode = (p.sensors && p.sensors.mode) || 'optical';
    base = mode === 'night' ? GREEN : mode === 'thermal' ? WARM : PALE;
    asp = clamp(num(hctx && hctx.aspect, 16 / 9), 1.3, 2.6);
    headStatus = (p.parts && p.parts.head && p.parts.head.status) || 'ok';

    // flight-form layout cross-fade (0.5 s window in the middle of the transform)
    const ft = p.flightTransition || {};
    const ftT = num(ft.t, 0);
    let fTarget;
    if (ft.state === 'toFlight') fTarget = smoothstep(0.3, 0.7, ftT);
    else if (ft.state === 'toHover') fTarget = 1 - smoothstep(0.3, 0.7, ftT);
    else fTarget = p.flightMode === 'minovsky' ? 1 : 0;
    fK = fTarget;

    // HUD power envelope
    let a = 1;
    if (stage <= 1) a = 0;
    else if (stage === 2) a = 0.28 * prog;
    else if (stage === 3) a = 0.28 + 0.72 * prog;
    if (stage === 3 || stage === 2) a *= 0.8 + 0.2 * hash1(Math.floor(time * 24));
    if (phase === 'disabled') a = 0.45 + 0.35 * hash1(Math.floor(time * 9));
    if (phase === 'ejected') a = 0;
    if (phase === 'victory' || phase === 'failed') a = 0.35;
    const mt = state.match && state.match.type;
    mpOn = !!mt && mt !== 'single';
    if (phase === 'respawn') a = 0;
    // scoreboard / end card sit on a dark panel: the HUD layer is additive, so it switches to normal alpha blending meanwhile
    const coldTunnel = HA.door > 0.3;      // CR-004: start-up prompts sit over the white tunnel: opaque plate, normal blending
    meshMain.material.blending = (mpOn && (phase === 'matchOver' || (state.input && state.input.scoreboard))) || coldTunnel ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (phase === 'matchOver') a = 0.25;

    wrapPower = a * (1 - HA.dim * 0.6);
    mix.update(dt, a > 0.5 && phase !== 'startup' || (phase === 'startup' && stage >= 4), p);
    // redraw + 2048x1152 canvas upload only at hctx.hudDt (0 = every frame); the timers above still run every frame
    const hudDt = (hctx && hctx.hudDt) || 0;
    if (hudDt > 0) { hudAcc += dt; if (hudAcc < hudDt * 0.98) return; hudAcc = hudAcc > hudDt * 2 ? 0 : hudAcc - hudDt; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    lastFont = '';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round'; ctx.lineWidth = LW;

    // whole-projection jitter: only on a hit (the cockpit itself no longer shakes)
    let jx = 0, jy = 0;
    const js = jitter > 0 ? 7 * (jitter / 0.4) : 0;
    jx += (hash1(Math.floor(time * 60) * 1.7) - 0.5) * (js + rig.shake * 6);
    jy += (hash1(Math.floor(time * 60) * 2.3) - 0.5) * (js + rig.shake * 6);
    if (dens > 0.8 && hash1(Math.floor(time * 12) + 5) > 0.7) jx += (hash1(Math.floor(time * 12)) - 0.5) * 10 * dens;
    if (headStatus === 'destroyed' && hash1(Math.floor(time * 9) + 11) > 0.8) jx += (hash1(Math.floor(time * 31)) - 0.5) * 8;
    ctx.translate(jx, jy);

    // cockpit frame basis for this frame
    if (state.player && state.player.quaternion) qInv.copy(state.player.quaternion).invert(); else qInv.identity();
    const pq = state.player && state.player.quaternion ? state.player.quaternion : null;
    if (pq) {
      fw.set(0, 0, -1).applyQuaternion(pq);
      uu.set(0, 1, 0).applyQuaternion(pq);
    } else { fw.set(0, 0, -1); uu.set(0, 1, 0); }
    hh.set(fw.x, 0, fw.z);
    if (hh.lengthSq() < 0.0025) { hh.set(fw.y > 0 ? -uu.x : uu.x, 0, fw.y > 0 ? -uu.z : uu.z); }
    if (hh.lengthSq() < 1e-6) hh.set(0, 0, -1);
    hh.normalize();
    rt.set(-hh.z, 0, hh.x);

    if (phase === 'startup') drawStartup(stage, prog);

    if (a > 0.01) {
      ctx.globalAlpha = a;
      drawFlight(p, phase, stage, prog, dens, stress, hctx);
      if (stage === 2) drawDiag(prog);
    }
    ctx.globalAlpha = 1;
    if (HA.frame > 0.003) drawHatchLayer();
    if (mpOn) drawMatch(p, phase);
    if (phase === 'disabled') drawDisabled(hctx);
    if (dens > 0.8 && a > 0.01) drawStatic(dens);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, W / 4, H / 4);
    gctx.drawImage(canvas, 0, 0, W / 4, H / 4);
    tex.needsUpdate = true;
    gtex.needsUpdate = true;
    perfCount.uploads += 2;
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  // Start-up prompts: the player must read these, so they are larger and brighter than the rest.
  // straight-on-screen text: each glyph is placed through the tangent-plane projection, so a horizontal line stays horizontal
  function textStraight(s, ux, uy, color, size, weight = 400) {
    font(size, weight); ctx.fillStyle = color; ctx.textAlign = 'left';
    const k = PPD * RAD;
    const total = ctx.measureText(s).width;
    let x = ux - total / 2 / (k / (1 + ux * ux));
    for (let i = 0; i < s.length; i++) {
      const w = ctx.measureText(s[i]).width;
      const q = mix.UP(x, uy);
      if (s[i] !== ' ') ctx.fillText(s[i], q.x, q.y + size * 0.35);
      x += w / (k / (1 + x * x));
    }
  }
  function drawRadio(a) {
    const msg = state.mission && state.mission.message;
    if (!msg || !(msg.ttl > 0) || !msg.text) return;
    const words = String(msg.text).split(/\s+/), lines = [];
    let cur = '';
    for (const w of words) { if ((cur + ' ' + w).trim().length > 64 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
    if (cur) lines.push(cur);
    if (lines.length > 3) lines.length = 3;
    const f = saturate(msg.ttl / 0.6) * a;
    const y0 = 0.43 + (lines.length === 1 ? -0.005 : 0);
    if (HA.door > 0.3) {                                   // dark plate when the tunnel is behind the text
      const x0 = mix.UP(-0.85, y0).x, x1 = mix.UP(0.85, y0).x, yA = mix.UP(0, y0 + 0.03).y, yB = mix.UP(0, y0 - lines.length * 0.036).y;
      ctx.fillStyle = `rgba(2,5,8,${0.75 * f})`; ctx.fillRect(x0, yA, x1 - x0, yB - yA);
    }
    for (let i = 0; i < lines.length; i++) textStraight(lines[i], 0, y0 - i * 0.036, rgba(PALE, 0.92 * f), 24);
  }
  // clip helpers (CR-004): while the hatch is open the HUD is masked to OUTSIDE the tunnel mouth; only the far opening gets
  // the Gawman marker + catch ring (second pass)
  function rectPath(hx, hy, cv = 0) {
    const n = 14;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([-hx + (2 * hx * i) / n, hy]);
    for (let i = 0; i < n; i++) { const y = hy - (2 * hy * i) / n; pts.push([hx - cv * (1 - (y * y) / (hy * hy)), y]); }
    for (let i = 0; i < n; i++) pts.push([hx - (2 * hx * i) / n, -hy]);
    for (let i = 0; i < n; i++) { const y = -hy + (2 * hy * i) / n; pts.push([-hx + cv * (1 - (y * y) / (hy * hy)), y]); }
    for (let i = 0; i < pts.length; i++) { const p = mix.UP(pts[i][0], pts[i][1]); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
    ctx.closePath();
  }
  function clipOutsideMouth() {
    const hx = Math.max(0.01, (TUNNEL.HW / TUNNEL.Z0) * HA.door), hy = TUNNEL.HH / TUNNEL.Z0;
    ctx.beginPath(); ctx.rect(-80, -80, W + 160, H + 160); rectPath(hx, hy, (HA.curve || 0) / TUNNEL.Z0); ctx.clip('evenodd');
  }
  function clipFarOpening() {
    const zf = TUNNEL.Z0 + TUNNEL.LEN * (0.2 + 0.8 * HA.length) * 1.0;
    const hx = (TUNNEL.HW / zf) * 0.97 * Math.min(1, HA.door * 1.6), hy = (TUNNEL.HH / zf) * 0.97;
    ctx.beginPath(); rectPath(hx, hy); ctx.clip();
  }

  function drawHatchLayer() {
    // the orange frames need the angular basis only for the horizon of other layers; drawn on top of everything else
    mix.drawHatch(HA);
  }

  function drawStartup(stage, prog) {
    const blink = 0.55 + 0.45 * Math.sin(time * 4);
    ctx.globalAlpha = 0.95;
    const tun = HA.door > 0.3;
    const y = tun ? CY + 9 * PPD : CY - 10 * PPD;
    const G = rgba('156,255,196', 1);
    if (tun && !mpOn) {
      ctx.globalAlpha = 0.82 * smoothstep(0.3, 0.9, HA.door);
      ctx.fillStyle = 'rgb(3,6,8)'; ctx.fillRect(CX - 400, y - 62, 800, 150);
      ctx.strokeStyle = rgba(G, 0.5); ctx.lineWidth = 1.6; ctx.strokeRect(CX - 400, y - 62, 800, 150);
      ctx.globalAlpha = 0.95;
    }
    if (stage === 0) {
      T('COLD START', CX, y, G, tun ? 40 : 28, 'center', 500);
      ctx.globalAlpha = blink;
      if (!mpOn) T('[ENTER]  ENGAGE START-UP SEQUENCE', CX, y + (tun ? 50 : 40), G, tun ? 30 : 22, 'center', 500);
    } else if (stage === 1) {
      T('RESTRAINT HARNESS  LOCKING', CX, y, G, 24, 'center');
      thinBar(CX - 100, y + 14, 200, 4, prog, G, 'rgba(156,255,196,0.15)');
    } else if (stage === 2) {
      T('OPTICAL LINE DIAGNOSTIC', CX, y, rgba(PALE, 1), 24, 'center');
    } else if (stage === 3) {
      T('PANORAMIC LINK  ' + Math.round(prog * 100) + '%', CX, y, rgba(PALE, 1), 24, 'center');
    }
    if (!mpOn && (stage === 0 || stage === 1 || stage === 2) && prog >= 0.999) {
      ctx.globalAlpha = blink;
      T('[ENTER]  NEXT', CX, y + (stage === 0 ? 76 : 48), rgba(AMB, 1), 22, 'center', 500);
    }
    ctx.globalAlpha = 1;
  }

  function drawDiag(prog) {
    const n = Math.floor(prog * (DIAG.length + 2));
    const x = CX - 36 * PPD, y0 = CY - 12 * PPD;
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < Math.min(n, DIAG.length); i++) {
      const last = i === n - 1;
      T(DIAG[i], x, y0 + i * 18, last ? rgba(PALE, 1) : rgba(PALE, 0.6), 12, 'left');
    }
  }

  function drawDisabled() {
    const pulse = 0.5 + 0.5 * Math.sin(time * 9);
    ctx.globalAlpha = 0.6 + 0.4 * pulse;
    T('SYSTEM FAILURE', CX, CY - 8 * PPD, rgba(RED, 1), 30, 'center', 500);
    ctx.globalAlpha = 1;
    T('HULL INTEGRITY LOST', CX, CY - 8 * PPD + 26, rgba(RED, 0.9), 14, 'center');
    const pull = saturate(cockpit.vis.leverPull);
    T('HOLD  [X]  -  MANUAL HATCH RELEASE', CX, CY + 5 * PPD, rgba(AMB, 1), 17, 'center', 500);
    thinBar(CX - 150, CY + 5 * PPD + 12, 300, 4, pull, rgba(AMB, 1), 'rgba(255,196,40,0.18)');
  }

  function drawStatic(dens) {
    ctx.globalAlpha = 0.2 * (dens - 0.7);
    ctx.fillStyle = rgba(PALE, 1);
    for (let i = 0; i < 14; i++) {
      const y = hash1(Math.floor(time * 20) + i * 3.1) * H;
      ctx.fillRect(CX - 38 * PPD + hash1(i + Math.floor(time * 20)) * 60 * PPD, y, 30 + hash1(i) * 160, 1);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------------------------------------------------------------------
  function drawFlight(p, phase, stage, prog, dens, stress, hctx) {
    const spd = num(p.speed, 0), mach = num(p.mach, 0), alt = num(p.altitude, 0);
    const mods = p.mods || {};
    byId.clear();
    const ents = entList();
    for (let i = 0; i < ents.length; i++) { const e = ents[i]; if (e && e.alive !== false) byId.set(e.id, e); }
    const ga = ctx.globalAlpha;

    const masked = HA.door > 0.05;
    if (masked) { ctx.save(); clipOutsideMouth(); }
    const dk = asp.toFixed(2) + base;
    if (dk !== decoKey) { decoKey = dk; buildDeco(); }
    const hd = 1 - HA.dim;                           // CR-004: the rest of the HUD dims while the hatch frames are in
    const gh = ga * hd;
    const axf = kit.aspectFactor();
    ctx.globalAlpha = gh * 0.6 * (0.9 + 0.1 * Math.sin(time * 0.9)) * mix.en(0.1, 1.2);
    ctx.drawImage(decoCanvas, 0, 0);
    ctx.globalAlpha = gh;
    drawDecoLive();
    drawShield(p);
    mix.drawFreeLook(gh, HA.frame);
    mix.drawHatchExtras(ga, HA.door, axf);
    mix.drawArc(gh);
    mix.drawHorizon(gh);
    if (fK > 0.02) { ctx.globalAlpha = gh * fK; drawPitchLadder(1); drawFlightPath(p, 1); ctx.globalAlpha = gh; }
    mix.drawLadder(-1, mix.spd, spd, 5, 100, glitchTxt(String(Math.round(spd))), 'M/S', 0.25, gh, axf, (mx, a) => {
      const y0 = mix.UP(mx, -0.30).y;
      if (mach >= 0.3 || fK > 0.5) kit.T('MACH ' + mach.toFixed(2), mx, y0, mach >= 1 ? rgba(WARM, 0.95 * a) : rgba(base, 0.8 * a), 22, 'center');
      const ft = p.flightTransition || {}, xf = ft.state && ft.state !== 'idle';
      if (fK > 0.05 || xf) kit.T(xf ? (ft.state === 'toFlight' ? 'TRANSFORM' : 'REVERT') : 'FLIGHT', mx, mix.UP(mx, 0.34).y, rgba(xf ? AMB : base, 0.95 * a * Math.max(fK, xf ? 1 : 0)), 22, 'center');
      if (xf) thinBar(mx - 60, mix.UP(mx, 0.34).y + 10, 120, 5, num(ft.t, 0), rgba(AMB, 0.9), rgba(AMB, 0.2));
      if (fK > 0.02) { const ry = mix.UP(0, 0).y; void ry; }
    });
    mix.drawLadder(1, mix.alt, alt, 25, 500, glitchTxt(fmt(alt)), 'ALT M', 0.3, gh, axf, (mx, a) => {
      const vs = num(p.verticalSpeed, 0);
      kit.T('VS ' + (vs >= 0 ? '+' : '') + Math.round(vs), mx, mix.UP(mx, -0.30).y, Math.abs(vs) > 120 ? rgba(AMB, 0.95 * a) : rgba(base, 0.8 * a), 22, 'center');
      const agl = state.world && state.world.terrain && Number.isFinite(p.agl) ? p.agl : alt - num(state.world && state.world.seaLevel, 0);   // Chapter 3: above the land
      if (agl < 1500) kit.T('RA ' + fmt(agl), mx, mix.UP(mx, -0.37).y, agl < 400 ? rgba(RED, 0.95 * a) : rgba(AMB, 0.9 * a), 22, 'center');
      if (p.barrier && p.barrier.active && fK > 0.05) {
        const bx = mx, by = mix.UP(mx, 0.34).y, r = 14;
        ctx.beginPath(); ctx.arc(bx, by, r, Math.PI * 1.1, Math.PI * 1.9); ctx.arc(bx, by, r * 0.6, Math.PI * 1.1, Math.PI * 1.9); stroke(rgba(CYAN, 0.9 * fK), LW * 1.5);
        thinBar(bx - r, by + r * 0.9, r * 2, 3, saturate(num(p.barrier.integrity, 1)), rgba(CYAN, 0.9), rgba(CYAN, 0.2));
      }
    });
    mix.drawReticle(p, gh);
    mix.drawCluster(gh);
    drawWeaponBlock(p);
    drawTargetBlock(p, mods);
    drawRadar(p, mods);
    drawTargets(p, mods);
    drawNeutrals(p);
    drawStory2(p);
    drawRemotes(p);
    drawIncoming(p);
    drawSaber(p);
    drawMessages(p, phase, dens);
    drawAlerts(p, stress);
    // CR-004 rescue + hatch warnings
    mix.drawRescue(p, byId, projEnt, HA.door, ga, axf, { edge: (pr, col, label, a) => { ctx.globalAlpha = ga; edgeArrow(pr.c, rgba(col, 1), label, 10, a, true); ctx.globalAlpha = ga; } });
    if (masked) {
      ctx.restore();
      ctx.save(); clipFarOpening(); ctx.globalAlpha = ga;
      mix.drawRescue(p, byId, projEnt, HA.door, ga, axf, null, true);
      ctx.restore();
    }
    ctx.globalAlpha = ga;
    drawRadio(ga);
    mix.drawBanner(ga);
    mix.purge();
  }
  const glitchTxt = (t) => (headStatus === 'destroyed' && hash1(Math.floor(time * 10) + 4) > 0.5 ? '---' : t);
  function projEnt(pos) {
    const p = state.player;
    c2.set(pos.x - p.position.x, pos.y - p.position.y, pos.z - p.position.z);
    const dist = Math.max(1, c2.length());
    c2.applyQuaternion(qInv);
    const vis = projCockpit(c2) && P.x > 30 && P.x < W - 30 && P.y > 30 && P.y < H - 30;
    return { vis, x: P.x, y: P.y, dist, c: c2.clone().normalize() };
  }

  // value tags above / below the ladders, FLIGHT tag, barrier icon, transform progress
  function drawTags(p, spd, mach, alt) {
    const c = rgba(base, 0.92);
    const glitch = headStatus === 'destroyed' && hash1(Math.floor(time * 10) + 4) > 0.5;
    ctx.beginPath(); vhex(ctx, LAD_XL, 138, 50, 16); stroke(rgba(base, 0.55), LW);
    ctx.beginPath(); vhex(ctx, LAD_XR, 138, 50, 16); stroke(rgba(base, 0.55), LW);
    TV(glitch ? '---' : String(Math.round(spd)), LAD_XL, 138, c, 12);
    TV(glitch ? '---' : fmt(alt), LAD_XR, 138, c, 12);
    TV('M/S', LAD_XL, 150, rgba(base, 0.5), 8);
    TV('ALT M', LAD_XR, 150, rgba(base, 0.5), 8);
    // Mach under the speed ladder (always when >= 0.3, amber past 1)
    if (mach >= 0.3 || fK > 0.5) TV('M ' + mach.toFixed(2), LAD_XL, 321, mach >= 1 ? rgba(WARM, 0.95) : rgba(base, 0.8), 10);
    const vs = num(p.verticalSpeed, 0);
    TV((vs >= 0 ? '+' : '') + Math.round(vs), LAD_XR, 321, Math.abs(vs) > 120 ? rgba(AMB, 0.9) : rgba(base, 0.7), 10);
    const agl = state.world && state.world.terrain && Number.isFinite(p.agl) ? p.agl : alt - num(state.world && state.world.seaLevel, 0);   // Chapter 3: above the land
    if (agl < 1500) TV('RA ' + fmt(agl), LAD_XR, 332, agl < 400 ? rgba(RED, 0.95) : rgba(AMB, 0.9), 9);
    // FLIGHT tag + barrier icon + transform progress
    const ft = p.flightTransition || {};
    const xf = ft.state && ft.state !== 'idle';
    if (fK > 0.05 || xf) {
      const blink = xf ? (Math.sin(time * 14) > -0.2 ? 0.95 : 0.4) : 0.9;
      TV(xf ? (ft.state === 'toFlight' ? 'TRANSFORM' : 'REVERT') : 'FLIGHT', LAD_XL, 120, rgba(xf ? AMB : base, blink * Math.max(fK, xf ? 1 : 0)), 10);
      if (xf) {
        S(LAD_XL - 24, 109); const bx = VP.x, by = VP.y;
        thinBar(bx, by, 48 * refScale(LAD_XL, 109), 3, num(ft.t, 0), rgba(AMB, 0.9), rgba(AMB, 0.2));
      }
    }
    if (p.barrier && p.barrier.active && fK > 0.05) {
      const bx = LAD_XL + 38, by = 120;
      S(bx, by); const x = VP.x, y = VP.y, r = 6 * refScale(bx, by);
      ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.9); ctx.arc(x, y, r * 0.6, Math.PI * 1.1, Math.PI * 1.9); line(x, y + r * 0.7, x, y + r * 0.2);
      stroke(rgba(CYAN, 0.9 * fK), LW * 1.3);
      const integ = saturate(num(p.barrier.integrity, 1));
      thinBar(x - r, y + r * 0.9, r * 2, 2, integ, rgba(CYAN, 0.9), rgba(CYAN, 0.2));
    }
    if (refusedT > 0) TV(refusedText, RCX, 190, rgba(RED, saturate(refusedT)), 12);
  }

  // ---- messages -----------------------------------------------------------------------------------------------------------------------------------------
  // Small pale lines: radio subtitle at the top, tiny amber cautions below it, wave banner, splash text.
  function drawMessages(p, phase, dens) {
    const m = state.mission || {};
    // caution-level alerts: tiny amber lines under the radio line
    const al = Array.isArray(state.alerts) ? state.alerts : EMPTY;
    let ly = 86;
    for (let i = 0; i < al.length && ly < 124; i++) {
      const a = al[i];
      if (!a || a.level === 'warning') continue;
      TV(String(a.text || '').toUpperCase(), RCX, ly, rgba(AMB, 0.85), 10);
      ly += 12;
    }
    if (sectorT > 0) TV(sectorText, RCX, ly, rgba(AMB, 0.8), 10);
    if (dens > 0.8) TV('MINOVSKY JAM', RW - 100, 218, rgba(RED, 0.8), 9, 'center');
    if (waveBanner > 0) {
      const ga1 = ctx.globalAlpha;
      ctx.globalAlpha = ga1 * saturate(waveBanner / 0.5) * saturate((3 - waveBanner) / 0.3 + 0.3);
      S(RCX, 100); T(`WAVE ${waveNum}`, CX, VP.y, rgba(AMB, 0.95), 18, 'center', 500);
      ctx.beginPath(); S(RCX - 90, 100); ctx.moveTo(VP.x, VP.y - 5); S(RCX - 50, 100); ctx.lineTo(VP.x, VP.y - 5);
      S(RCX + 50, 100); ctx.moveTo(VP.x, VP.y - 5); S(RCX + 90, 100); ctx.lineTo(VP.x, VP.y - 5);
      stroke(rgba(AMB, 0.6), LW);
      ctx.globalAlpha = ga1;
    }
    if (killT > 0) T(killText, CX, CY + 6 * PPD, rgba(ORG, 0.9), 13, 'center');
    if (lostFlash > 0) T('LOCK LOST', CX, CY + 4 * PPD, rgba(AMB, lostFlash), 13, 'center');
    if (uiClickT > 0) T('·', CX + 8, CY + 22, rgba(PALE, 0.8), 10);
  }

  // ---- warnings: thin red outlined tags (all the same size, PULL UP included) ------------------------------------------------------------------
  function tag(x, y, w, h, color, on) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - h / 2); ctx.lineTo(x + w / 2, y - h / 2); ctx.lineTo(x + w / 2 + 6, y); ctx.lineTo(x + w / 2, y + h / 2);
    ctx.lineTo(x - w / 2, y + h / 2); ctx.lineTo(x - w / 2 - 6, y); ctx.closePath();
    stroke(rgba(color, on ? 0.9 : 0.4), LW * 1.15);
  }
  function drawAlerts(p, stress) {
    const threat = p.threat || {};
    const al = Array.isArray(state.alerts) ? state.alerts : EMPTY;
    const warns = [];
    const pu = p.pullUp && p.pullUp.active;
    if (pu) warns.push({ text: 'PULL UP' });
    for (let i = 0; i < al.length; i++) {
      if (!al[i] || al[i].level !== 'warning') continue;
      if (pu && /PULL\s*UP/i.test(String(al[i].text || ''))) continue;
      warns.push(al[i]);
    }
    const inc = Array.isArray(threat.incoming) ? threat.incoming.length : 0;
    const missile = !!threat.missileInbound || inc > 0;
    const pulse = Math.sin(time * 12) > 0;
    if (missile) {
      const y = CY - 11 * PPD;
      tag(CX, y, 150, 26, RED, pulse);
      T('MISSILE', CX, y + 5, rgba(RED, pulse ? 1 : 0.55), 15, 'center', 500);
    }
    const n = Math.min(6, warns.length);
    const k = saturate(0.2 * warns.length + 0.7 * stress + (missile ? 0.2 : 0));
    ctx.lineJoin = 'miter';
    for (let i = 0; i < n; i++) {
      font(13, 400);
      const txt = String(warns[i].text || 'WARNING').toUpperCase();
      const w = ctx.measureText(txt).width * (1 + 0.25 * k) + 30;
      const h = 22 * (1 + 0.3 * k);
      const baseY = CY - 17 * PPD - 0 + i * 30;
      const y = baseY + (CY - 40 - baseY) * k * 0.8;
      const x = CX + (i % 2 ? 1 : -1) * k * 60 * (i / 2 + 0.3);
      const on = Math.sin(time * 9 + i * 1.7) > -0.2;
      ctx.save();
      ctx.translate(x, y); ctx.rotate((i % 2 ? 1 : -1) * k * 0.06);
      tag(0, 0, w, h, RED, on);
      ctx.beginPath(); ctx.moveTo(-w / 2 - 14, 0); ctx.lineTo(-w / 2 - 36, 0); ctx.moveTo(w / 2 + 14, 0); ctx.lineTo(w / 2 + 36, 0);
      stroke(rgba(RED, 0.45), LW);
      ctx.restore();
      lastFont = '';
      ctx.save();
      ctx.translate(x, y); ctx.rotate((i % 2 ? 1 : -1) * k * 0.06);
      font(Math.round(13 * (1 + 0.25 * k)), 400);
      ctx.fillStyle = on ? rgba('255,214,218', 1) : rgba(RED, 0.6); ctx.textAlign = 'center';
      ctx.fillText(txt, 0, 4 + 2 * k);
      ctx.restore();
      lastFont = '';
    }
    ctx.lineJoin = 'round';
  }

  return { group, update, onEvent, get power() { return wrapPower; } };
}
