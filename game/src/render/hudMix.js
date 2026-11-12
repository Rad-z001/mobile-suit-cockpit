// CR-004 HUD "mix" layer: the video's shapes on top of the reference-01 structure (the faint honeycomb stays in hud.js).
// Drawn on the SAME 2048x1152 angular HUD canvas as everything else (no new canvases, no extra uploads). All geometry is
// authored in TANGENT-PLANE units: x,y on a plane one unit in front of the eye (the screen is y = +-1 at 90 deg vertical
// FOV, x = +-1.78 at 16:9), which is the video's own frame (1 unit = 540 px of a 1080p frame). UP(x, y) maps to canvas px.
// Motion: every moving marker is a critically damped spring (value springs for the ladders, 2D springs for tracked
// markers), element draw-on is staggered from `introT`, and mode changes fade (hatch frames, free-look ring).
import { Spring, clamp, damp, saturate, smoothstep, num, DEG } from './util.js';

const RAD = 180 / Math.PI;
const AMB = '255,196,40', ORG = '255,128,44', RED = '255,66,72', GRN = '150,255,190', PINK = '255,150,205', WHITE = '244,247,252';
const FR = '255,88,58', FRH = '255,160,130';           // hatch frame red-orange and its highlight
const rgba = (c, a) => `rgba(${c},${a})`;
const ease = (t) => { t = saturate(t); return t * t * (3 - 2 * t); };
const easeOut = (t) => { t = saturate(t); return 1 - (1 - t) * (1 - t) * (1 - t); };

export function createMix(kit) {
  const { ctx, W, H, CX, CY, PPD, state } = kit;
  const V = { x: 0, y: 0 };
  function UP(x, y) {
    V.x = CX + Math.atan(x) * RAD * PPD;
    V.y = CY - Math.atan2(y, Math.hypot(x, 1)) * RAD * PPD;
    return V;
  }
  const lw = (w) => w;                       // canvas px (the 2048 canvas shows at ~0.5 css px per canvas px at 720p)
  const st = (color, w) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); };
  const fl = (color) => { ctx.fillStyle = color; ctx.fill(); };
  function path(pts, close) {                // pts in tangent units
    for (let i = 0; i < pts.length; i++) { UP(pts[i][0], pts[i][1]); if (i === 0) ctx.moveTo(V.x, V.y); else ctx.lineTo(V.x, V.y); }
    if (close) ctx.closePath();
  }
  function hexPath(cx, cy, r) {              // canvas px
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.2832; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.87; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.closePath();
  }

  // ---- state -------------------------------------------------------------------------------------------------------------
  let introT = 0, prevOn = false, time = 0;
  const spd = new Spring(9, 1), alt = new Spring(9, 1);
  let sFirst = true;
  let freeK = 0, ringRot = 0, rescueK = 0;
  const tracks = new Map();                    // key -> { x, y, vx, vy, seen, born }
  let bannerT = 0, bannerText = '', bannerSub = '', bannerCol = GRN, hintT = 0, hintText = '';

  function onEvent(e) {
    switch (e.type) {
      case 'gawmanCaught': bannerT = 4.5; bannerText = 'GAWMAN ABOARD'; bannerSub = 'CLOSE THE HATCH'; bannerCol = GRN; break;
      case 'gawmanLost': bannerT = 5; bannerText = 'GAWMAN LOST'; bannerSub = String(e.reason || '').toUpperCase(); bannerCol = RED; break;
      case 'gawmanJump': bannerT = 3; bannerText = 'GAWMAN JUMPED'; bannerSub = state.world && state.world.night ? 'FIND THE FLASHLIGHT' : 'OPEN THE HATCH — GET UNDER HIM'; bannerCol = AMB; break;
      case 'rescueHint': hintT = 4; hintText = String(e.text || '').toUpperCase(); break;
      default: break;
    }
  }

  // dt each frame (also when the canvas redraw is throttled); `on` = HUD powered and drawing the flight layout
  function update(dt, on, p) {
    time += dt;
    if (on) { if (!prevOn) introT = 0; introT += dt; }
    prevOn = on;
    bannerT = Math.max(0, bannerT - dt); hintT = Math.max(0, hintT - dt);
    const sp = num(p.speed, 0), al = num(p.altitude, 0);
    if (sFirst) { spd.x = sp; alt.x = al; sFirst = false; }
    spd.step(sp, dt); alt.step(al, dt);
    const inp = state.input || {};
    const looking = Math.abs(num(inp.lookYaw, 0)) > 0.06 || Math.abs(num(inp.lookPitch, 0)) > 0.06;
    freeK = damp(freeK, looking ? 1 : 0, looking ? 5 : 3, dt);
    ringRot += dt * (0.25 + 0.5 * freeK);
    const r = state.mission && state.mission.rescue;
    rescueK = damp(rescueK, r ? 1 : 0, 4, dt);
  }
  const en = (delay, dur = 0.8) => easeOut((introT - delay) / dur);

  // smoothed 2D marker position (canvas px). Critically damped (omega 20: ~0.08 s lag), first sight snaps to the target.
  function track(key, x, y) {
    let t = tracks.get(key);
    if (!t) { t = { x, y, vx: 0, vy: 0, seen: time, born: time, last: time }; tracks.set(key, t); }
    let dt = time - t.last; t.last = time; t.seen = time;
    if (dt > 0.25) { t.x = x; t.y = y; t.vx = t.vy = 0; return t; }
    dt = Math.min(dt, 0.05);
    const w = 20;
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) {
      t.vx += (-w * w * (t.x - x) - 2 * w * t.vx) * h; t.x += t.vx * h;
      t.vy += (-w * w * (t.y - y) - 2 * w * t.vy) * h; t.y += t.vy * h;
    }
    return t;
  }
  function purge() { for (const [k, t] of tracks) if (time - t.seen > 0.6) tracks.delete(k); }

  // ======================================================================================================
  // TOP ARC: heavy double arc hanging from the top, notch + hex pip + yellow chevron below
  // ======================================================================================================
  function drawArc(ga) {
    const k = en(0.0, 1.1);
    if (k < 0.01) return;
    const X = 1.12 * k;
    const yy = (x) => 0.50 + 0.78 * x * x;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (const [off, w, col, a] of [[0, 12, '176,182,192', 0.55], [0.030, 2.0, WHITE, 0.9], [-0.026, 1.4, '210,216,226', 0.4]]) {
      ctx.beginPath();
      for (let i = 0; i <= 44; i++) { const x = -X + (2 * X * i) / 44; UP(x, yy(x) + off); if (i === 0) ctx.moveTo(V.x, V.y); else ctx.lineTo(V.x, V.y); }
      st(rgba(col, a * ga * k), w);
    }
    // notch on the right shoulder and the small tab at the bottom
    if (k > 0.8) {
      ctx.beginPath(); path([[0.80, yy(0.80) + 0.04], [0.86, yy(0.86) + 0.05], [0.87, yy(0.87) - 0.03], [0.81, yy(0.81) - 0.035]], true); fl(rgba('206,212,222', 0.7 * ga));
    }
    // hex pip + yellow chevron
    const a2 = en(0.35, 0.6) * ga;
    UP(0, 0.30); ctx.beginPath(); hexPath(V.x, V.y, 17); fl(rgba('110,115,125', 0.5 * a2)); st(rgba('225,230,238', 0.9 * a2), 2);
    ctx.beginPath(); path([[-0.018, 0.255 - 0.004 * Math.sin(time * 2.2)], [0, 0.238 - 0.004 * Math.sin(time * 2.2)], [0.018, 0.255 - 0.004 * Math.sin(time * 2.2)]], false); st(rgba(AMB, (0.8 + 0.2 * Math.sin(time * 2.2)) * a2), 3);
    ctx.beginPath(); path([[-0.05, 0.33], [-0.065, 0.345]], false); path([[0.05, 0.33], [0.065, 0.345]], false); st(rgba('225,230,238', 0.6 * a2), 1.6);
  }

  // ======================================================================================================
  // SIDE LADDERS: barrel-shaped, dense ticks, bold white wing markers (fixed pair + sliding)
  // ======================================================================================================
  // the video's wing marker: a long wedge, narrow at the outer end and wide at the inner end, with a square notch cut into the
  // wide end and a thin dark split line along its length (measured from owner_hud_night.webp)
  function wing(cx, cy, w, h, side, a, tilt = 0, outline = false) {
    const i = -side;                                    // inward direction (+1 on the left ladder)
    const hn = h * 0.23, nh = h * 0.26, nw = h * 0.26;
    const x0 = cx - i * w / 2, x1 = cx + i * w / 2;
    const pts = [[x0, cy - hn / 2 + tilt], [x1, cy - h / 2], [x1, cy - nh / 2], [x1 - i * nw, cy - nh / 2], [x1 - i * nw, cy + nh / 2], [x1, cy + nh / 2], [x1, cy + h / 2], [x0, cy + hn / 2 + tilt]];
    ctx.beginPath(); path(pts, true);
    if (outline) { st(rgba(WHITE, a), 2.2); ctx.beginPath(); path(pts.map((q) => [cx + (q[0] - cx) * 0.78, cy + (q[1] - cy) * 0.62]), true); fl(rgba('226,230,236', 0.9 * a)); return; }
    fl(rgba(WHITE, 0.95 * a)); st(rgba(WHITE, a), 1.4);
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); path([[x0 + i * w * 0.02, cy + tilt * 0.5], [x1 - i * nw - i * 0.004, cy]], false); st(`rgba(0,0,0,${0.7 * a})`, 2.2);
    ctx.restore();
  }
  function drawLadder(side, vs, valueReal, unit, period, label, sub, delay, ga, ax, extra) {
    const k = en(delay, 0.9);
    if (k < 0.01) return;
    const lx = (y) => side * (0.745 + 0.27 * y * y) * ax;
    const sy = 0.0175;
    ctx.lineCap = 'butt';
    // rail
    ctx.beginPath(); let first = true;
    const Y0 = -0.96 * k, Y1 = 0.99 * k;
    for (let i = 0; i <= 32; i++) { const y = Y0 + ((Y1 - Y0) * i) / 32; UP(lx(y), y); if (first) { ctx.moveTo(V.x, V.y); first = false; } else ctx.lineTo(V.x, V.y); }
    st(rgba(WHITE, 0.30 * ga), 1.4);
    // scrolling ticks, three classes
    const u = vs / unit;
    const iLo = Math.floor(u - 1.0 / sy), iHi = Math.ceil(u + 1.0 / sy);
    for (let pass = 0; pass < 3; pass++) {
      ctx.beginPath(); let any = false;
      for (let i = iLo; i <= iHi; i++) {
        if (i < 0) continue;
        const cls = i % 10 === 0 ? 2 : i % 5 === 0 ? 1 : 0;
        if (cls !== pass) continue;
        const y = (i - u) * sy;
        if (y < Y0 || y > Y1) continue;
        const fade = smoothstep(0.98, 0.72, Math.abs(y));
        if (fade < 0.05) continue;
        const L = (cls === 2 ? 0.05 : cls === 1 ? 0.03 : 0.016) * (0.5 + 0.5 * fade);
        UP(lx(y), y); ctx.moveTo(V.x, V.y); UP(lx(y) + side * L, y); ctx.lineTo(V.x, V.y);
        any = true;
      }
      if (any) st(rgba(WHITE, (pass === 2 ? 0.95 : pass === 1 ? 0.75 : 0.5) * ga), pass === 2 ? 2.2 : 1.5);
    }
    // numbers on the majors, inside the ladder
    for (let i = iLo; i <= iHi; i++) {
      if (i < 0 || i % 10 !== 0) continue;
      const y = (i - u) * sy;
      if (Math.abs(y) < 0.16 || Math.abs(y) > 0.78) continue;
      UP(lx(y) - side * 0.04, y);
      kit.T(String(Math.round(i * unit)), V.x, V.y + 7, rgba(WHITE, 0.62 * ga * smoothstep(0.8, 0.55, Math.abs(y))), 20, side < 0 ? 'left' : 'right');
    }
    // sliding small wing markers (two, half a period apart, fading at the ends so the wrap never snaps)
    for (let q = 0; q < 2; q++) {
      const f = (((vs / period + q * 0.5) % 1) + 1) % 1;
      const y = 0.80 - 1.60 * f;
      wing(lx(y), y, 0.085, 0.036, side, Math.pow(Math.sin(Math.PI * f), 0.7) * k * ga, 0, true);
    }
    // fixed bold pair + the readout between them
    const mx = side * (Math.abs(lx(0)) / ax + 0.29) * ax;
    const a2 = en(delay + 0.25, 0.7) * ga;
    const bob = 0.004 * Math.sin(time * 1.3 + side);
    wing(mx, 0.115 + bob, 0.17, 0.07, side, a2);
    wing(mx, -0.17 - bob, 0.17, 0.07, side, a2);
    UP(mx, -0.025);
    kit.T(label, V.x, V.y + 4, rgba(WHITE, 0.98 * a2), 32, 'center', 500);
    kit.T(sub, V.x, V.y + 30, rgba(WHITE, 0.62 * a2), 20, 'center');
    if (extra) extra(mx, a2);
  }

  // ======================================================================================================
  // RETICLE: thin cross with a double-dash centre, rungs, hatched wings, radial ticks
  // ======================================================================================================
  function drawReticle(p, ga) {
    const k = en(0.55, 0.8);
    if (k < 0.01) return;
    const aim = p.aim || {};
    const ay = num(aim.yaw, 0), ap = num(aim.pitch, 0);
    const ax = CX + ay * RAD * PPD, aY = CY - ap * RAD * PPD;
    const a = ga * k, sc = 1.25 - 0.25 * k;
    ctx.lineCap = 'butt';
    // the static set around the body-forward point (video: bars, hatched wings, rungs, radial ticks)
    UP(0, 0); const cx = V.x, cy = V.y;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(cx + s * 118 * sc, cy); ctx.lineTo(cx + s * 215 * sc, cy);
      for (let i = 0; i < 5; i++) { const x0 = cx + s * (226 + i * 10) * sc; ctx.moveTo(x0, cy + 10); ctx.lineTo(x0 + s * 9, cy - 10); }
      for (let r = -2; r <= 2; r++) { const y = cy + r * 15; ctx.moveTo(cx + s * 88 * sc, y); ctx.lineTo(cx + s * (88 + (Math.abs(r) === 2 ? 16 : 24)) * sc, y); }
    }
    st(rgba(WHITE, 0.72 * a), 1.7);
    ctx.beginPath();
    for (const s of [-1, 1]) for (const v of [-1, 1]) for (const ang of [10, 18, 26, 34]) {
      const t = ang * DEG, r0 = 200 * sc, r1 = (214 + ang * 0.45) * sc;
      ctx.moveTo(cx + s * Math.cos(t) * r0, cy + v * Math.sin(t) * r0); ctx.lineTo(cx + s * Math.cos(t) * r1, cy + v * Math.sin(t) * r1);
    }
    st(rgba(WHITE, 0.5 * a), 1.5);
    // the crosshair itself, at the aim point: gap cross, long tail down, double dash centre
    ctx.beginPath();
    ctx.moveTo(ax - 62, aY); ctx.lineTo(ax - 12, aY); ctx.moveTo(ax + 12, aY); ctx.lineTo(ax + 62, aY);
    ctx.moveTo(ax, aY - 46); ctx.lineTo(ax, aY - 12); ctx.moveTo(ax, aY + 12); ctx.lineTo(ax, aY + 100);
    st(rgba(WHITE, 0.95 * a), 2);
    ctx.beginPath(); ctx.moveTo(ax - 5, aY - 3); ctx.lineTo(ax + 5, aY - 3); ctx.moveTo(ax - 5, aY + 3); ctx.lineTo(ax + 5, aY + 3);
    st(rgba(WHITE, 0.95 * a), 1.8);
  }

  // ======================================================================================================
  // HORIZON: full-width double line, ticks, hex pips + yellow chevrons (draws with the player's own attitude)
  // ======================================================================================================
  function drawHorizon(ga) {
    const k = en(0.5, 1.0);
    if (k < 0.01) return;
    const a = ga * k;
    ctx.lineCap = 'butt';
    const gapA = 17;
    for (const [phi, A, w] of [[0, 0.95, 3.2], [-1.0, 0.6, 2.2]]) {
      ctx.beginPath();
      kit.arc(phi, -78 * k, -gapA - (phi ? 4 : 0), 40); kit.arc(phi, gapA + (phi ? 4 : 0), 78 * k, 40);
      st(rgba(WHITE, A * a), w);
    }
    ctx.beginPath();
    for (let al = -75; al <= 75; al += 5) {
      if (Math.abs(al) < gapA + 1) continue;
      const L = al % 15 === 0 ? 1.15 : 0.55;
      kit.ladderPt(al, 0); const x0 = kit.P.x, y0 = kit.P.y, ok0 = kit.ok;
      kit.ladderPt(al, L); if (ok0 && kit.ok) { ctx.moveTo(x0, y0); ctx.lineTo(kit.P.x, kit.P.y); }
    }
    st(rgba(WHITE, 0.75 * a), 1.5);
    for (const s of [-1, 1]) {
      kit.ladderPt(s * (gapA + 3), -0.5);
      if (!kit.ok) continue;
      ctx.beginPath(); hexPath(kit.P.x, kit.P.y, 19); fl(rgba('105,110,120', 0.5 * a)); st(rgba('226,231,238', 0.9 * a), 2);
      const cx = kit.P.x - s * 56;
      ctx.beginPath(); ctx.moveTo(cx - s * 7, kit.P.y - 15); ctx.lineTo(cx + s * 7, kit.P.y); ctx.lineTo(cx - s * 7, kit.P.y + 15); st(rgba(AMB, (0.82 + 0.18 * Math.sin(time * 2.2 + s)) * a), 3.2);
      // outward ticks on the pip
      ctx.beginPath(); ctx.moveTo(kit.P.x + s * 26, kit.P.y - 20); ctx.lineTo(kit.P.x + s * 35, kit.P.y - 28); ctx.moveTo(kit.P.x + s * 26, kit.P.y + 20); ctx.lineTo(kit.P.x + s * 35, kit.P.y + 28); st(rgba(WHITE, 0.55 * a), 1.5);
    }
  }

  // ======================================================================================================
  // BOTTOM CLUSTER: hex icons + MULTI-WALLED PANORAMIC MONITOR + yellow ^
  // ======================================================================================================
  function drawCluster(ga) {
    const k = en(0.9, 0.8);
    if (k < 0.01) return;
    const a = ga * k;
    UP(0, -0.43); const cx = V.x, cy = V.y + (1 - k) * 18;
    ctx.lineCap = 'butt';
    for (const [dx, r, f] of [[-92, 17, 0.55], [-50, 21, 0.9], [0, 0, 0], [50, 21, 0.9], [92, 17, 0.55]]) {
      if (!r) continue;
      ctx.beginPath(); hexPath(cx + dx, cy, r); fl(rgba('96,102,114', 0.4 * a)); st(rgba('226,231,238', f * a), 2);
      ctx.beginPath(); hexPath(cx + dx, cy, r * 0.5); st(rgba('226,231,238', f * 0.5 * a), 1.2);
    }
    ctx.beginPath(); ctx.moveTo(cx - 13, cy - 8); ctx.lineTo(cx, cy - 22); ctx.lineTo(cx + 13, cy - 8); st(rgba(AMB, 0.95 * a), 3.2);
    kit.T('MULTI-WALLED', cx, cy + 36, rgba(WHITE, 0.66 * a), 20, 'center');
    kit.T('PANORAMIC MONITOR', cx, cy + 58, rgba(WHITE, 0.66 * a), 20, 'center');
  }

  // ======================================================================================================
  // FREE-LOOK: dotted circle + rotating ring of grey hex segments + wide floor arcs (fade with freeK / hatch frames)
  // ======================================================================================================
  function drawFreeLook(ga, hatchK) {
    const fk = Math.max(freeK, 0);
    const fa = Math.max(fk, hatchK * 0.9);
    if (fa < 0.01) return;
    const inp = state.input || {};
    const cx = CX + num(inp.lookYaw, 0) * RAD * PPD, cy = CY - num(inp.lookPitch, 0) * RAD * PPD;
    if (fk > 0.01) {
      const a = fk * ga;
      const R = 330 * (0.9 + 0.1 * fk);
      ctx.fillStyle = rgba(WHITE, 0.62 * a);
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * 6.2832 + ringRot * 0.12;
        const s = i % 4 === 0 ? 3.2 : 2.2;
        ctx.beginPath(); ctx.arc(cx + Math.cos(t) * R, cy + Math.sin(t) * R, s, 0, 6.2832); ctx.fill();
      }
      const NSEG = 14;
      for (let i = 0; i < NSEG; i++) {
        const t = (i / NSEG) * 6.2832 - ringRot;
        const r = 178 + (i % 3) * 7, sz = 17 + (i % 3 === 0 ? 5 : 0);
        const x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r;
        ctx.save(); ctx.translate(x, y); ctx.rotate(t + Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(-sz * 0.6, -sz * 0.9); ctx.lineTo(sz * 0.6, -sz * 0.9); ctx.lineTo(sz * 0.9, 0); ctx.lineTo(sz * 0.4, sz * 0.9); ctx.lineTo(-sz * 0.5, sz * 0.8); ctx.lineTo(-sz * 0.9, 0); ctx.closePath();
        fl(rgba('150,156,168', (0.38 + 0.2 * Math.sin(t * 2 + time)) * a)); st(rgba('200,206,216', 0.5 * a), 1.2);
        ctx.restore();
      }
    }
    // wide curved floor arcs below the horizon
    ctx.lineCap = 'butt';
    for (const [pk, a0] of [[-0.50, 0.55], [-0.70, 0.45], [-0.92, 0.35]]) {
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) { const x = -2.1 + (4.2 * i) / 24; const y = pk - 0.42 * Math.pow(x / 2.1, 2); UP(x, y); if (i === 0) ctx.moveTo(V.x, V.y); else ctx.lineTo(V.x, V.y); }
      st(rgba('190,196,208', a0 * fa * ga), 1.8);
    }
  }

  // ======================================================================================================
  // OPEN-HATCH EXTRAS (owner_hatch_open): rotating ring of grey hex segments + dotted circle behind the left frame, hex cluster
  // and a PANORAMIC label fragment on the right
  function drawHatchExtras(ga, door, ax) {
    const k = ease((door - 0.3) / 0.5);
    if (k < 0.01) return;
    const a = k * ga;
    const c = UP(-0.9 * ax, 0.03); const cx = c.x, cy = c.y;
    ctx.fillStyle = rgba(WHITE, 0.55 * a);
    for (let i = 0; i < 72; i++) { const t = (i / 72) * 6.2832 + ringRot * 0.1; ctx.beginPath(); ctx.arc(cx + Math.cos(t) * 560, cy + Math.sin(t) * 560, i % 6 === 0 ? 3.2 : 2.1, 0, 6.2832); ctx.fill(); }
    for (let i = 0; i < 14; i++) {
      const t = (i / 14) * 6.2832 - ringRot * 0.8, r = 190 + (i % 3) * 6, sz = 22 + (i % 3 === 0 ? 5 : 0);
      ctx.save(); ctx.translate(cx + Math.cos(t) * r, cy + Math.sin(t) * r); ctx.rotate(t + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(-sz * 0.6, -sz * 0.9); ctx.lineTo(sz * 0.6, -sz * 0.9); ctx.lineTo(sz * 0.95, 0); ctx.lineTo(sz * 0.4, sz * 0.95); ctx.lineTo(-sz * 0.5, sz * 0.85); ctx.lineTo(-sz * 0.95, 0); ctx.closePath();
      fl(rgba('150,156,168', (0.42 + 0.18 * Math.sin(t * 2 + time * 0.6)) * a)); st(rgba('205,210,220', 0.45 * a), 1.2);
      ctx.restore();
    }
    const r1 = UP(1.19 * ax, -0.19), r2 = UP(1.41 * ax, -0.21);
    for (const [p, rr] of [[r1, 38], [r2, 34]]) { ctx.beginPath(); hexPath(p.x, p.y, rr); fl(rgba('86,92,104', 0.4 * a)); st(rgba('226,231,238', 0.85 * a), 2); ctx.beginPath(); hexPath(p.x, p.y, rr * 0.55); st(rgba('226,231,238', 0.5 * a), 1.3); }
    const ar = UP(1.27 * ax, -0.06); ctx.beginPath(); ctx.moveTo(ar.x + 16, ar.y - 16); ctx.lineTo(ar.x, ar.y); ctx.lineTo(ar.x + 16, ar.y + 16); st(rgba(WHITE, 0.55 * a), 1.8);
    const lb = UP(1.55 * ax, -0.2); kit.T('MULTI-WALLED', lb.x, lb.y - 4, rgba(WHITE, 0.5 * a), 20, 'left'); kit.T('PANORAMIC', lb.x, lb.y + 20, rgba(WHITE, 0.5 * a), 20, 'left');
  }

  // ======================================================================================================
  // TARGET MARKER: orange inverted triangle + hex, thin stem; used for the current target and Gawman
  // ======================================================================================================
  function triMarker(key, x, y, s, color, alpha, dy = -26) {
    const t = track(key, x, y + dy);
    const a = alpha * easeOut((time - t.born) / 0.35);
    const px = t.x, py = t.y, sc = s * (1.3 - 0.3 * easeOut((time - t.born) / 0.35));
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(px - sc, py - sc * 0.8); ctx.lineTo(px + sc, py - sc * 0.8); ctx.lineTo(px, py + sc * 0.75); ctx.closePath();
    st(rgba(color, a), 3);
    ctx.beginPath(); ctx.moveTo(px - sc * 1.15, py - sc * 0.95); ctx.lineTo(px - sc * 0.8, py - sc * 1.25); ctx.moveTo(px + sc * 1.15, py - sc * 0.95); ctx.lineTo(px + sc * 0.8, py - sc * 1.25);
    st(rgba(AMB, a), 2.6);
    ctx.beginPath(); hexPath(px, py - sc * 0.25, sc * 0.36); st(rgba(WHITE, 0.8 * a), 1.4);
    ctx.beginPath(); ctx.moveTo(px, py + sc * 0.95); ctx.lineTo(px, py + sc * 0.95 + 30); st(rgba(WHITE, 0.55 * a), 1.4);
    ctx.lineJoin = 'round';
    return { x: px, y: py, a };
  }

  // ======================================================================================================
  // HATCH: orange H-frames, bridge halves, HATCH UNLOCK / LOCK tabs
  // ======================================================================================================
  // Traced from assets/images/video_ref/owner_hatch_unlock.webp: pixel lists of the TOP-LEFT quarter of a crop (x_u = -0.9 + (px-36)/109.4,
  // v = (1034-py)/109.4, units = half the video height, v = 0 on the horizon axis). The other three quarters are mirrors.
  const cvx = (px) => -0.9 + (px - 36) / 1094, cvv = (py) => (1034 - py) / 1094;
  const conv = (l) => l.map((q) => [cvx(q[0]), cvv(q[1])]);
  const H_BAR = conv([[452, 45], [486, 45], [520, 165], [556, 300], [580, 430], [596, 560], [606, 700], [618, 780], [632, 855], [690, 905], [815, 905], [830, 930], [815, 948], [690, 950], [640, 935], [590, 885], [573, 860], [570, 700], [560, 560], [545, 430], [517, 300], [478, 165]]);
  const H_BAR_L = conv([[452, 45], [468, 45], [497, 165], [534, 300], [560, 430], [574, 560], [584, 700], [592, 800], [575, 860], [570, 700], [560, 560], [545, 430], [517, 300], [478, 165]]);
  const H_BRIDGE = conv([[828, 930], [862, 985], [1021, 985], [1021, 1030], [872, 1030], [848, 1000], [818, 950]]);
  const H_PA = conv([[295, 150], [332, 165], [440, 181], [468, 186], [508, 330], [530, 468], [497, 505], [462, 510], [447, 420], [410, 372], [375, 330], [340, 230]]);
  const H_PA_HI = conv([[455, 185], [468, 188], [526, 462], [508, 466], [496, 380]]);
  const H_PB = conv([[342, 393], [372, 402], [420, 475], [480, 545], [496, 600], [498, 720], [478, 725], [440, 690], [400, 672], [385, 600], [372, 540], [362, 470]]);
  const H_PC = conv([[395, 675], [430, 690], [472, 716], [492, 805], [493, 845], [470, 838], [430, 780], [418, 730]]);
  const H_PD = conv([[335, 895], [352, 870], [405, 822], [418, 826], [398, 860], [360, 900]]);
  const H_DIA = [[cvx(450), cvv(545)], [cvx(466), cvv(625)]];
  const H_TAB_HALF = [[-0.82, 0.0], [-0.82, 0.03], [-0.805, 0.03], [-0.805, 0.058], [-0.82, 0.058], [-0.82, 0.125], [-0.72, 0.125], [-0.72, 0.105], [-0.66, 0.105], [-0.64, 0.088], [-0.47, 0.066], [-0.446, 0.026], [-0.446, 0.0]];
  const H_TAB = H_TAB_HALF.concat(H_TAB_HALF.slice().reverse().map((q) => [q[0], -q[1]]));
  const H_TAB_IN = H_TAB.map((q) => [-0.63 + (q[0] + 0.63) * 0.93, q[1] * 0.7]);
  const stag = (f, a, b) => ease(saturate((f - a) / b));

  let HK = 1;
  const hc = (r, g, b, a) => `rgba(${Math.min(255, Math.round(r * HK))},${Math.min(255, Math.round(g * HK))},${Math.min(255, Math.round(b * HK))},${a})`;
  function drawHatch(anim) {
    const f = saturate(anim.frame);
    if (f < 0.003) return;
    HK = 1 + 0.5 * ease(saturate(anim.door * 3));
    const door = anim.door;
    const Aall = 1;
    const sBar = stag(f, 0.0, 0.55), sPl = stag(f, 0.22, 0.55), sTab = stag(f, 0.4, 0.6);
    const barA = (1 - ease((door - 0.2) / 0.55)) * sBar * Aall;
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
    for (const sx of [-1, 1]) for (const sv of [-1, 1]) {
      const poly = (pts, o) => path(pts.map((q) => [sx * (-q[0] + o), sv * q[1]]), true);
      const slideBar = (1 - sBar) * 1.9 + 0.04 * door, slidePl = (1 - sPl) * 1.9 + 0.05 * door;
      if (barA > 0.01) {
        ctx.beginPath(); poly(H_BAR, slideBar); fl(hc(172,50,30, 0.95 * barA)); st(hc(205,105,82, 0.95 * barA), 1.6);
        ctx.beginPath(); poly(H_BAR_L, slideBar); fl(hc(205,86,62, 0.75 * barA));
      }
      // bridge halves: the seam opens with the doors, the halves run outward and fade
      const ba = (1 - ease(door * 2.2)) * sBar * Aall;
      if (ba > 0.01) { ctx.beginPath(); poly(H_BRIDGE, slideBar + door * 0.22); fl(hc(172,50,30, 0.95 * ba)); st(hc(205,105,82, 0.95 * ba), 1.6); }
      const pa = sPl * Aall;
      if (pa > 0.01) {
        for (const pl of [H_PA, H_PB, H_PC, H_PD]) { ctx.beginPath(); poly(pl, slidePl); fl(hc(172,50,30, 0.95 * pa)); st(hc(210,112,92, 0.95 * pa), 1.6); }
        ctx.beginPath(); poly(H_PA_HI, slidePl); fl(hc(205,105,82, 0.9 * pa));
        for (const d of H_DIA) {
          const cx = sx * (-d[0] + slidePl), cy = sv * d[1];
          ctx.beginPath(); path([[cx - 0.014 * sx, cy + 0.03], [cx - 0.034 * sx, cy], [cx - 0.014 * sx, cy - 0.03], [cx + 0.024 * sx, cy - 0.02], [cx + 0.028 * sx, cy + 0.02]], true);
          fl(hc(175,150,146, 0.92 * pa)); st(hc(200,200,200, 0.6 * pa), 1);
        }
      }
    }
    // tabs
    for (const sx of [-1, 1]) {
      const ta = sTab * Aall;
      if (ta < 0.01) continue;
      const o = (1 - sTab) * 1.6;
      const X = (q) => [sx * (-q[0] + o), q[1]];
      ctx.beginPath(); path(H_TAB.map(X), true); fl(hc(165,62,44, 0.95 * ta)); st(hc(210,112,92, 0.95 * ta), 1.6);
      ctx.beginPath(); path(H_TAB_IN.map(X), true); fl(hc(79,15,12, 0.97 * ta));
      // small square notches on the border (stepped bracket look)
      for (const [nx, nv] of [[-0.80, 0.07], [-0.80, -0.07], [-0.735, 0.1], [-0.735, -0.1]]) {
        const c = X([nx, nv]); ctx.beginPath(); path([[c[0] - 0.012, c[1] + 0.012], [c[0] + 0.012, c[1] + 0.012], [c[0] + 0.012, c[1] - 0.012], [c[0] - 0.012, c[1] - 0.012]], true); fl(hc(172,50,30, 0.95 * ta));
      }
      // pink double chevron on the inner tip, grey hex pip + yellow chevron beyond it
      for (const dx of [0, 0.03]) { const a = X([-0.43 - dx, 0.05]), b = X([-0.40 - dx, 0.0]), c = X([-0.43 - dx, -0.05]); ctx.beginPath(); path([a, b, c], false); st(hc(175,100,140, 0.95 * ta), 2.6); }
      const ex = (1 - ease(door * 2.5)) * ta;
      if (ex > 0.01) {
        const h = X([-0.34, 0.0]); const hp = UP(h[0], h[1]); ctx.beginPath(); hexPath(hp.x, hp.y, 20); fl(hc(70,72,78, 0.6 * ex)); st(hc(150,154,160, 0.9 * ex), 1.8);
        const a = X([-0.285, 0.035]), b = X([-0.255, 0.0]), c = X([-0.285, -0.035]); ctx.beginPath(); path([a, b, c], false); st(hc(180,135,30, 0.95 * ex), 3);
      }
      const tx = anim.tab * sTab;
      if (tx > 0.01) {
        const tc = X([-0.555, 0.0]); const p0 = UP(tc[0], tc[1]);
        kit.T('HATCH', p0.x, p0.y - 6, hc(215,200,190, 0.97 * tx), 30, 'center', 400);
        kit.T(anim.label, p0.x, p0.y + 32, hc(215,200,190, 0.97 * tx), 30, 'center', 400);
      }
    }
    ctx.lineJoin = 'round';
  }

  // ======================================================================================================
  // GAWMAN RESCUE HUD (mission.rescue): marker, readout, MATCH SPEED, catch envelope, banners
  // ======================================================================================================
  function arrowGlyph(x, y, dir, len, color, a) {       // dir: 'u','d','l','r'
    const dx = dir === 'l' ? -1 : dir === 'r' ? 1 : 0, dy = dir === 'u' ? -1 : dir === 'd' ? 1 : 0;
    ctx.beginPath();
    ctx.moveTo(x - dx * len, y - dy * len); ctx.lineTo(x + dx * len, y + dy * len);
    ctx.moveTo(x + dx * len - dx * 7 - dy * 7, y + dy * len - dy * 7 - dx * 7); ctx.lineTo(x + dx * len, y + dy * len); ctx.lineTo(x + dx * len - dx * 7 + dy * 7, y + dy * len - dy * 7 + dx * 7);
    st(rgba(color, a), 3);
  }
  function drawMatchSpeed(r, ga, ax) {
    const k = rescueK * ga;
    if (k < 0.01 || !r.relVel) return;
    const inEnv = !!r.inEnvelope;
    const col = inEnv ? GRN : WHITE, hot = inEnv ? GRN : AMB;
    const xa = (0.76 * ax - 0.03) + ((1.24 * ax + 0.1) - (0.76 * ax - 0.03)) * ease(kit.hatchDoor ? kit.hatchDoor() : 0);
    UP(xa, 0.02); const x0 = V.x - 205 + 40 * ease(kit.hatchDoor ? kit.hatchDoor() : 0), y0 = V.y;   // panel left edge, right-anchored near the ladder
    UP(xa, 0.30); const ytop = V.y;
    const yTitle = Math.max(ytop, y0 - 96);
    kit.T('MATCH SPEED', x0 + 88, yTitle, rgba(col, 0.95 * k), 24, 'center', 500);
    ctx.beginPath(); ctx.moveTo(x0, yTitle + 8); ctx.lineTo(x0 + 176, yTitle + 8); st(rgba(col, 0.5 * k), 1.4);
    const v = r.relVel;
    const rows = [
      ['FWD', 'BACK', -num(v.z, 0), 'u', 'd'],
      ['UP', 'DOWN', num(v.y, 0), 'u', 'd'],
      ['RIGHT', 'LEFT', num(v.x, 0), 'r', 'l'],
    ];
    for (let i = 0; i < 3; i++) {
      const [pn, nn, val, pd, nd] = rows[i];
      const y = yTitle + 38 + i * 36;
      const mag = Math.abs(val), big = mag > 8;
      const c = inEnv || mag <= 8 ? (inEnv ? GRN : WHITE) : hot;
      const dir = val >= 0 ? pd : nd;
      kit.T(val >= 0 ? pn : nn, x0, y, rgba(c, 0.9 * k), 20, 'left');
      kit.T((val >= 0 ? '+' : '-') + mag.toFixed(1), x0 + 176 - 38, y, rgba(c, 1 * k), 22, 'right', 500);
      arrowGlyph(x0 + 176 - 17, y - 7, dir, 9 + Math.min(10, mag * 0.5), c, (big ? 1 : 0.6) * k);
    }
  }
  function drawRescue(p, byId, projEnt, hatchOpenK, ga, ax, hooks, markerOnly) {
    const m = state.mission || {};
    const r = m.rescue;
    if (!r) return;
    const g = byId.get(r.gawmanId);
    const ka = rescueK * ga;
    // objective + hint line
    if (!markerOnly && m.objective && hatchOpenK < 0.05) kit.T(String(m.objective).toUpperCase(), CX, UP(0, 0.64).y, rgba(WHITE, 0.78 * ka * en(0.4, 0.6)), 22, 'center');
    if (!markerOnly && hintT > 0 && hatchOpenK < 0.05) kit.T(hintText, CX, UP(0, 0.56).y, rgba(AMB, saturate(hintT / 0.6) * ka), 22, 'center');
    // Gawman marker + data
    if (g && g.alive !== false && r.phase !== 'aboard') {
      const pr = projEnt(g.position);
      const dist = num(r.distance, pr.dist), cl = num(r.closing, 0), tts = num(r.timeToSea, Infinity);
      const urgent = isFinite(tts) && tts < 6;
      if (pr.vis) {
        const mk = triMarker('gawman', pr.x, pr.y, 22, ORG, ka, -34);
        const lx = mk.x, ly = mk.y + 56;
        kit.T('GAWMAN', lx, ly, rgba('255,224,200', ka), 24, 'center', 500);
        kit.T(`${kit.fmt(dist)} M`, lx, ly + 26, rgba(WHITE, 0.92 * ka), 22, 'center');
        if (Math.abs(cl) > 0.5) kit.T(`${cl > 0 ? 'CLOSING' : 'OPENING'} ${Math.abs(Math.round(cl))}`, lx, ly + 50, rgba(cl > 0 ? GRN : AMB, 0.9 * ka), 20, 'center');
        if (isFinite(tts)) kit.T(`SEA ${tts.toFixed(1)} S`, lx, ly + 74, rgba(urgent && Math.sin(time * 14) > 0 ? RED : AMB, 0.95 * ka), 22, 'center', 500);
      } else if (!markerOnly) hooks.edge(pr, ORG, 'GAWMAN ' + kit.fmt(dist) + 'M', ka);
    }
    // catch envelope ring at the catch point (hatch open)
    if (hatchOpenK > 0.05 && r.catchPoint && r.phase !== 'aboard') {
      const pr = projEnt(r.catchPoint);
      if (pr.vis) {
        const t = track('catch', pr.x, pr.y);
        const rad = clamp(Math.atan2(6, Math.max(8, pr.dist)) * RAD * PPD, 22, 220);
        const col = r.inEnvelope ? GRN : AMB, a = hatchOpenK * ka;
        ctx.lineCap = 'butt';
        ctx.setLineDash([14, 10]); ctx.lineDashOffset = -time * 24;
        ctx.beginPath(); ctx.arc(t.x, t.y, rad, 0, 6.2832); st(rgba(col, 0.9 * a), 2.6);
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let i = 0; i < 4; i++) { const an = (i / 4) * 6.2832 + 0.785; ctx.moveTo(t.x + Math.cos(an) * (rad - 8), t.y + Math.sin(an) * (rad - 8)); ctx.lineTo(t.x + Math.cos(an) * (rad + 10), t.y + Math.sin(an) * (rad + 10)); }
        st(rgba(col, a), 2.6);
        kit.T('CATCH', t.x, t.y + rad + 28, rgba(col, a), 22, 'center', 500);
      }
    }
    if (!markerOnly) drawMatchSpeed(r, ga, ax);
  }
  function drawBanner(ga) {
    if (bannerT <= 0) return;
    const a = saturate(bannerT / 0.5) * saturate((5 - bannerT) / 0.3 + 0.2) * ga;
    if (kit.hatchDoor() > 0.3) { ctx.fillStyle = `rgba(2,5,8,${0.8 * a})`; ctx.fillRect(CX - 300, CY - 7 * PPD - 58, 600, 130); }
    kit.T(bannerText, CX, CY - 7 * PPD, rgba(bannerCol, a), 46, 'center', 500);
    if (bannerSub) kit.T(bannerSub, CX, CY - 7 * PPD + 36, rgba(WHITE, 0.85 * a), 24, 'center');
    ctx.beginPath(); ctx.moveTo(CX - 230, CY - 7 * PPD + 56); ctx.lineTo(CX + 230, CY - 7 * PPD + 56); st(rgba(bannerCol, 0.5 * a), 2);
  }

  return { update, onEvent, purge, drawArc, drawLadder, drawReticle, drawHorizon, drawCluster, drawFreeLook, drawHatchExtras, drawHatch, drawRescue, drawBanner, triMarker, track, UP, en, wing,
    get spd() { return spd.x; }, get alt() { return alt.x; }, get freeK() { return freeK; }, get rescueK() { return rescueK; }, get introT() { return introT; } };
}
