// Chapter 3 land: an approximation of West Arnhem Land around Gunbalanya ("Oenbili" in the film; also written Oenpeli),
// compressed to fit the mission. Map frame: metres, origin = the town, +x east, -z north. NOT survey data: shapes and
// heights follow the real country loosely -
//   - the Van Diemen Gulf coast to the north-west, fringed with mangroves and tidal mud flats
//   - the East Alligator River meandering out of the south past the west side of town to its mouth on the coast
//   - wide grassy floodplains and billabongs (permanent lagoons) between the river, the coast and the town
//   - the Arnhem Land escarpment: a sandstone plateau (~200-260 m) east and south-east of town, cut by gorges, with
//     isolated sandstone outliers standing out of the plains (one of them, a hill just north-east of town)
//   - savanna woodland on the higher ground between
// The rebels' hidden pad (fictional) sits in a gorge in the stone country well south-east of town - not on any named hill.
// Cultural care: the town is a real Aboriginal community. It is only seen from a distance (a few roofs); nothing in the
// game fights over it, and no rock art or named site is used as set dressing.
//
// sample(x, z) -> height (m, below 0 = water); classAt(x, z) -> surface class for the render's colours. The sim reads a
// baked grid (bilinear) so collision matches the land mesh, which is built from the same grid.
import { OENBILI } from '../tuning.js';

// ---- small deterministic noise (no rt.rng) ----
function hash2(ix, iz) { let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x, z, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; } return s; }
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---- features (km in comments) ----
// coast: a line running south-west -> north-east, ~16-19 km north-west of town; the sea beyond it
const N_COAST = [-Math.SQRT1_2, -Math.SQRT1_2];          // toward the north-west
function coastDist(x, z) {                               // > 0: inland of the coastline (m)
  const d = x * N_COAST[0] + z * N_COAST[1];           // distance toward the NW
  const along = x * -N_COAST[1] + z * N_COAST[0];
  const wig = 1600 * (fbm(along / 9000 + 3.1, 1.7, 3) - 0.5) + 900 * Math.sin(along / 5200);
  return 17500 + wig - d;
}
// the East Alligator River: a polyline from the south (Cahills Crossing country) up past the west of town to the mouth
const RIVER = [[-6800, 30000], [-7600, 18000], [-9800, 9000], [-8600, 2000], [-10200, -5000], [-12400, -10500], [-13800, -14200], [-15500, -18500]];
function riverDist(x, z) {
  let best = 1e9, bt = 0;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, pz = az + dz * t;
    // meanders: shift the bank sideways along the segment
    const m = 420 * Math.sin((i + t) * 4.7) + 160 * Math.sin((i + t) * 13.1);
    const nx = -dz / Math.sqrt(L2), nz = dx / Math.sqrt(L2);
    const d = Math.hypot(x - (px + nx * m), z - (pz + nz * m));
    if (d < best) { best = d; bt = (i + t) / (RIVER.length - 1); }
  }
  return { d: best, t: bt };                               // t: 0 upstream (south) .. 1 at the mouth
}
// sandstone outliers on the plains (x, z, radius, height). [0] stands just north-east of town.
const OUTLIERS = [[1300, -1500, 650, 150], [-4200, -6500, 900, 140], [3800, -8800, 1200, 230], [-2600, 7600, 700, 120], [10500, -6200, 1500, 300], [-12000, 11000, 1100, 170], [5600, 13500, 1300, 220], [14500, 9000, 1600, 280]];
// billabongs: lagoons on the floodplain (x, z, rx, rz)
const BILLABONGS = [[-2200, 1900, 900, 380], [-5600, -2600, 1300, 520], [-3800, 4800, 700, 300], [-7400, 6500, 600, 900], [-1400, -4300, 500, 260]];

// the escarpment: the plateau edge runs roughly north-south about 5-7 km east of town, swinging east to the north
function scarpDist(x, z) {                               // > 0: on the plateau side (m)
  const edge = 5200 + 2600 * smooth(-4000, -16000, z) + 1500 * (fbm(z / 6000 + 9.3, 0.4, 3) - 0.5) * 2;
  return x - edge;
}

const P = OENBILI;
function padDist(x, z) { return Math.hypot(x - P.base[0], z - P.base[1]); }
// the gorge that leads to the pad from the plains to the west
function gorgeDist(x, z) {
  const ax = P.base[0] - 6500, az = P.base[1] + 600, bx = P.base[0], bz = P.base[1];
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t + 280 * Math.sin(t * 7.5), pz = az + dz * t + 220 * Math.sin(t * 5.1 + 1);
  return Math.hypot(x - px, z - pz);
}

export const PAD_H = 46;                                 // m: the pad's level, down in its gorge
const TOWN_H = 9;

// raw height (m). < 0 = water (the sea plane shows through: coast, river, billabongs).
export function sample(x, z) {
  const cd = coastDist(x, z);
  if (cd < -4000) return -24;                            // open gulf
  if (cd < 0) return lerp(-2, -24, smooth(0, -4000, cd)); // shelving sea floor
  // floodplain base: flat and low, rising slowly inland
  let h = 1.6 + 3.5 * smooth(0, 9000, cd) + 2.5 * (fbm(x / 1400, z / 1400, 3) - 0.5);
  // savanna rises away from the plain, south and east
  const rise = smooth(-2000, 12000, x * 0.6 + z * 0.4);
  h += rise * (18 + 22 * fbm(x / 3500 + 4, z / 3500, 4));
  // the escarpment plateau with gorges
  const sd = scarpDist(x, z);
  if (sd > -800) {
    const k = smooth(-800, 500, sd);
    const gorges = smooth(0.025, 0.11, Math.abs(fbm(x / 2600 + 1.3, z / 2600 + 7.7, 4) - 0.5));   // 0 in the narrow cuts, 1 on the tops
    const plateau = 300 + 120 * fbm(x / 5000, z / 5000 + 2.2, 3);   // exaggerated a little: the real scarp is ~200-300 m
    h = lerp(h, lerp(70, plateau, gorges), k);
  }
  // outliers: steep-sided, flat-topped sandstone hills
  for (const [ox, oz, r, oh] of OUTLIERS) {
    const d = Math.hypot(x - ox, z - oz) / r;
    if (d < 1.4) {
      const n = 0.85 + 0.3 * fbm(x / 420 + ox, z / 420, 3);
      const top = oh * n, k = 1 - smooth(0.62, 1.12, d + 0.18 * (fbm(x / 300, z / 300 + oz, 2) - 0.5));
      h = Math.max(h, h + (top - h) * k);
    }
  }
  // the gorge to the pad, and the pad itself: a flat floor cut into the stone country
  const gd = gorgeDist(x, z);
  if (gd < 900) h = lerp(PAD_H + 6 + 0.004 * Math.max(0, P.base[0] - x), h, smooth(260, 900, gd));
  const pd = padDist(x, z);
  if (pd < 700) h = lerp(PAD_H, h, smooth(160, 700, pd));
  // the town: a flat rise on the edge of the plain
  const td = Math.hypot(x, z);
  if (td < 1500) h = lerp(TOWN_H, h, smooth(600, 1500, td));
  // billabongs and the river (cut below sea level: water)
  for (const [bx, bz, rx, rz] of BILLABONGS) {
    const d = Math.hypot((x - bx) / rx, (z - bz) / rz);
    if (d < 1.6) h = lerp(-2.5, h, smooth(0.8, 1.6, d));
  }
  const rv = riverDist(x, z);
  const w = lerp(110, 340, rv.t);                       // wider toward the mouth
  if (rv.d < w * 3) h = lerp(-4, Math.min(h, 3 + rv.d * 0.02), smooth(w * 0.6, w * 3, rv.d));
  // mangrove band behind the coast: low and flat
  if (cd < 2600) h = lerp(1.2 + 1.6 * fbm(x / 300, z / 300, 2), h, smooth(400, 2600, cd));
  return h;
}

// surface classes for the render: 0 water, 1 mud flat, 2 mangrove, 3 floodplain grass, 4 wet grass, 5 savanna woodland,
// 6 sandstone, 7 town, 8 pad
export function classAt(x, z, h, slope) {
  if (h <= 0.05) return 0;
  if (padDist(x, z) < 130) return 8;
  if (Math.hypot(x, z) < 900) return 7;
  const cd = coastDist(x, z);
  if (cd < 700) return 1;
  if (cd < 2600) return 2;
  if (slope > 0.55 || h > 150) return 6;
  if (h < 7) return fbm(x / 800, z / 800, 2) > 0.55 ? 4 : 3;
  return slope > 0.3 ? 6 : 5;
}

// the baked grid the sim samples: CELL m cells over +-HALF m; outside it, the raw function (far, coarse, rarely asked)
export const GRID = { half: 32000, cell: 100 };
let grid = null;
export function bake() {
  if (grid) return grid;
  const n = Math.round((2 * GRID.half) / GRID.cell) + 1;
  const a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = -GRID.half + j * GRID.cell;
    for (let i = 0; i < n; i++) a[j * n + i] = sample(-GRID.half + i * GRID.cell, z);
  }
  grid = { n, a };
  return grid;
}
export function heightGrid(x, z) {
  const g = bake();
  const fx = (x + GRID.half) / GRID.cell, fz = (z + GRID.half) / GRID.cell;
  if (fx < 0 || fz < 0 || fx >= g.n - 1 || fz >= g.n - 1) return sample(x, z);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = g.n, a = g.a;
  const h00 = a[j * n + i], h10 = a[j * n + i + 1], h01 = a[(j + 1) * n + i], h11 = a[(j + 1) * n + i + 1];
  // the mesh splits each cell along the same diagonal (PlaneGeometry order): u + v < 1 -> triangle (00, 10, 01)
  return u + v < 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}
