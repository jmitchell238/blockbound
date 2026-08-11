/**
 * Pure cave / outdoor shelter helpers — no canvas dependency.
 * Used by the renderer and by tests.
 */
import { BLOCK, BLOCK_META } from '../content/blocks.js';
import { SKY_LIMIT, SURFACE_Y } from '../core/constants.js';
import { getTile } from './index.js';

/**
 * Terrain roof material. Trees/leaves do NOT count — treating them as roofs
 * previously blacked out the entire outdoors under forest canopy.
 */
export function isRoofSolidId(id) {
  if (id == null || id === BLOCK.AIR) return false;
  if (id === BLOCK.LEAVES || id === BLOCK.WOOD || id === BLOCK.LADDER) return false;
  if (id === BLOCK.TORCH || id === BLOCK.LANTERN || id === BLOCK.WATER) return false;
  if (id === BLOCK.GLASS || id === BLOCK.PLATFORM || id === BLOCK.CAMPFIRE) return false;
  const m = BLOCK_META[id];
  return !!(m && m.solid);
}

/**
 * Open air / open cells that need a cave fill when sheltered.
 */
export function isCaveOpenTile(id) {
  return id === BLOCK.AIR || id === BLOCK.WATER || id === BLOCK.TORCH
    || id === BLOCK.LANTERN || id === BLOCK.LADDER || id === BLOCK.CAMPFIRE
    || id === BLOCK.GLASS || id === BLOCK.LEAVES || id === BLOCK.PLATFORM;
}

/**
 * This column/y is cave/dug-out if below the natural surface line,
 * or any terrain roof sits between it and the sky.
 */
export function isShelteredAir(world, wx, fromY) {
  fromY = Math.floor(fromY);
  if (fromY < 0) return false;
  const surf = (world.surface && world.surface[wx] != null) ? world.surface[wx] : SURFACE_Y;
  // Below natural ground surface → underground
  if (fromY > surf) return true;
  // Terrain roof overhead (dirt/stone/etc., not trees)
  for (let y = fromY - 1; y >= SKY_LIMIT; y--) {
    if (isRoofSolidId(getTile(world, wx, y))) return true;
  }
  return false;
}

/**
 * RGB for cave open-air fill given 0–15 light and optional flicker (0.9–1.1).
 * Hard-capped dim warm brown — NEVER pale/white.
 */
export function caveAirColor(lightLevel, flicker) {
  const voidR = 2, voidG = 2, voidB = 5;
  const litR = 22, litG = 16, litB = 10;
  const fl = flicker != null ? flicker : 1;
  const t = Math.max(0, Math.min(15, Number(lightLevel) || 0)) / 15;
  const smooth = t * t * (3 - 2 * t);
  const bri = Math.pow(smooth, 1.25);
  const r = Math.min(litR, (voidR + (litR - voidR) * bri) * fl);
  const g = Math.min(litG, (voidG + (litG - voidG) * bri) * fl);
  const b = Math.min(litB, (voidB + (litB - voidB) * bri));
  return {
    r: r | 0,
    g: g | 0,
    b: b | 0,
    /** Channel sum — must stay well below “white” (~765) */
    sum: (r | 0) + (g | 0) + (b | 0),
  };
}

/** Rough “is this sky color blue-ish by day?” helper for tests. */
export function skyLooksBlue(hex) {
  if (!hex || hex[0] !== '#') return false;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Blue channel dominates and isn't washed gray
  return b > r + 15 && b > g - 10 && b > 100;
}

/** Rough “is this sky gray/overcast?” helper for tests. */
export function skyLooksGray(hex) {
  if (!hex || hex[0] !== '#') return false;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min < 45; // low chroma
}
