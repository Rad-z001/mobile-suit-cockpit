// Seawrack's hull model (render/seawrack.js buildSeawrack): the deck is at SEAWRACK.deckY and hold two's opening is cut
// out of it. Regression (owner, 2026-11-13, "the Xi is going under the floor"): the hull section's climb-only clamp lifted
// the deck onto the bulwark (deckY + 3.5 m), so the cut-out (which looks for deck faces at deckY) never matched and the
// plating stayed across the open hold; the Xi sank through it in the homecoming shot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLD, hullSection, _shipGeometry } from '../src/render/seawrack.js';
import { SEAWRACK as C } from '../src/sim/tuning.js';

const D = C.deckY;
// up-facing triangles of the merged ship mesh, as { x, y, z } centroids
function upFaces() {
  const p = _shipGeometry.buildSeawrack().attributes.position.array, out = [];
  for (let i = 0; i < p.length; i += 9) {
    const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
    const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    if (ny / len < 0.7) continue;
    out.push({ x: (p[i] + p[i + 3] + p[i + 6]) / 3, y: (p[i + 1] + p[i + 4] + p[i + 7]) / 3, z: (p[i + 2] + p[i + 5] + p[i + 8]) / 3, area: len / 2 });
  }
  return out;
}

test('seawrack model: nothing spans hold two\'s opening above its floor (the covers and the pit are separate meshes)', () => {
  const over = upFaces().filter((f) => Math.abs(f.x) < HOLD.w - 0.3 && f.z > HOLD.z0 + 0.3 && f.z < HOLD.z1 - 0.3 && f.y > HOLD.floor + 0.5);
  assert.equal(over.length, 0, `faces over the open hold at y ${over.slice(0, 3).map((f) => f.y.toFixed(2)).join(', ')}`);
});

test('seawrack model: the deck plating is at deckY, not lifted onto the bulwark', () => {
  // the strip of deck between hold two's after coaming and the bridge front
  const strip = upFaces().filter((f) => Math.abs(f.x) < 15 && f.z > HOLD.z1 + 1.8 && f.z < -C.bridgeZ - C.bridgeHalf - 0.2);
  assert.ok(strip.some((f) => Math.abs(f.y - D) < 0.01 && f.area > 4), 'deck plates at deckY');
  assert.ok(!strip.some((f) => f.y > D + 0.5 && f.y < D + 3.6 && f.area > 4), 'no raised deck plates (small fittings aside)');
  // the section itself: the bulwark top stays flat and its inner face comes back down to the deck
  const s = hullSection({ z: 0, w: C.shipBeam / 2, wb: C.shipBeam / 2 * 0.94, keel: -12 }, D);
  const top = s.filter((v) => v.x > 0 && v.y > D + 0.01).map((v) => v.y);
  assert.ok(top.every((y) => y <= D + 2.8 + 1e-9), 'bulwark top at deckY + 2.8');
  assert.ok(s.filter((v) => v.x > 0 && Math.abs(v.y - D) < 1e-9).length >= 2, 'inner face foot and deck edge at deckY');
});
