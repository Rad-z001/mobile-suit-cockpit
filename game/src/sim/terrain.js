// Ground height for the sim (collision, landing, spawns) and the render (the land mesh is built from the same function).
// Pure and deterministic: no rt.rng, no THREE objects. state.world.terrain selects the land: null = the open sea of
// Chapters 1-2 (ground = sea level everywhere), 'oenbili' = West Arnhem Land for Chapter 3 (sim/missions/oenbili.js).
// API: heightAt(S, x, z) raw land/seabed height (may be below 0); groundAt(S, x, z) = max(height, sea level), the surface
// under a point; waterAt(S, x, z) true over water.
import { heightGrid as oenbiliHeight } from './lands/oenbili.js';

const LANDS = { oenbili: oenbiliHeight };   // Chapter 3 (baked lazily on the first call)

export function registerLand(id, fn) { LANDS[id] = fn; }

function seaLevel(S) { return (S && S.world && typeof S.world.seaLevel === 'number') ? S.world.seaLevel : 0; }

export function heightAt(S, x, z) {
  const id = S && S.world ? S.world.terrain : null;
  const f = id ? LANDS[id] : null;
  return f ? f(x, z) : seaLevel(S) - 30;
}
export function groundAt(S, x, z) { return Math.max(heightAt(S, x, z), seaLevel(S)); }
export function waterAt(S, x, z) { return heightAt(S, x, z) <= seaLevel(S); }
export const hasLand = (S) => !!(S && S.world && S.world.terrain);
// the highest ground under the track from pos along the horizontal velocity, over `horizon` s (terrain look-ahead)
export function groundAhead(S, pos, vel, horizon = 1.5, step = 0.5) {
  let g = groundAt(S, pos.x, pos.z);
  for (let t = step; t <= horizon + 1e-6; t += step) g = Math.max(g, groundAt(S, pos.x + vel.x * t, pos.z + vel.z * t));
  return g;
}
// how far the Xi's cockpit (player.position) must stay above solid ground: the suit stands about this tall below it
export const BODY_CLEAR = 18;
