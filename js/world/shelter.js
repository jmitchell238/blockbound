/**
 * Pure cave / outdoor shelter helpers — no canvas dependency.
 * Used by the renderer and by tests.
 */
import { BLOCK, BLOCK_META } from '../content/blocks.js';
import { SKY_LIMIT, SURFACE_Y } from '../core/constants.js';
import { getTile, wrapX } from './index.js';

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
 * How far sideways to look for daylight before calling a space enclosed.
 * Wide enough to cross a room, short enough that a real cave stays dark.
 */
export const MAX_ESCAPE = 12;

/** Any terrain roof between this cell and the sky. */
export function hasRoofAbove(world, wx, fromY) {
  for (let y = fromY - 1; y >= SKY_LIMIT; y--) {
    if (isRoofSolidId(getTile(world, wx, y))) return true;
  }
  return false;
}

/**
 * Cells you could actually walk through when looking for a way outside.
 *
 * Glass is the exception that matters: it needs a wall drawn behind it like any
 * other open cell, but it is a window, not a doorway. Letting the search pass
 * through it made a walled room with a window read as outdoors along the window
 * row and as a cave everywhere else — stripes of sky through the middle of a
 * castle wall.
 */
function isEscapeOpen(id) {
  return isCaveOpenTile(id) && id !== BLOCK.GLASS;
}

/**
 * Walk sideways along one row looking for a way out to daylight. Stops at the
 * first tile you could not walk through — a wall is a wall — and succeeds at
 * the first column that has nothing but sky overhead.
 */
function canReachOpenSky(world, wx, y, dir) {
  for (let i = 1; i <= MAX_ESCAPE; i++) {
    const x = wrapX(wx + dir * i);
    if (!isEscapeOpen(getTile(world, x, y))) return false;
    if (!hasRoofAbove(world, x, y)) return true;
  }
  return false;
}

/**
 * This column/y is cave/dug-out if below the natural surface line, or a terrain
 * roof sits between it and the sky *and* it is genuinely enclosed.
 *
 * A roof overhead is not the same as being indoors. The floor of a treehouse,
 * a bridge, or any overhang would otherwise paint a cave backdrop over open air
 * that is one step from daylight — you should see sky behind you when you are
 * standing under a tree, not rock.
 */
export function isShelteredAir(world, wx, fromY) {
  fromY = Math.floor(fromY);
  if (fromY < 0) return false;
  const surf = (world.surface && world.surface[wx] != null) ? world.surface[wx] : SURFACE_Y;
  // Below natural ground surface → underground
  if (fromY > surf) return true;
  // Terrain roof overhead (dirt/stone/etc., not trees)
  if (!hasRoofAbove(world, wx, fromY)) return false;
  // Roofed, but open to the side within a few steps → an overhang, not a room.
  if (canReachOpenSky(world, wx, fromY, -1)) return false;
  if (canReachOpenSky(world, wx, fromY, 1)) return false;
  return true;
}

/**
 * Map a solid block to the wall material that should appear behind dug air.
 * Grass → dirt; ores stay as themselves (dark flecks) or fold into stone.
 */
export function normalizeWallId(id) {
  if (id == null || id === BLOCK.AIR) return null;
  if (id === BLOCK.GRASS) return BLOCK.DIRT;
  if (id === BLOCK.SNOW) return BLOCK.DIRT; // snow surface walls still earthy
  if (id === BLOCK.LAVA || id === BLOCK.MAGMA || id === BLOCK.BEDROCK) return BLOCK.STONE;
  if (id === BLOCK.WATER || id === BLOCK.LEAVES || id === BLOCK.WOOD) return null;
  if (id === BLOCK.TORCH || id === BLOCK.LANTERN || id === BLOCK.LADDER) return null;
  if (id === BLOCK.CAMPFIRE || id === BLOCK.GLASS || id === BLOCK.PLATFORM) return null;
  if (id === BLOCK.DOOR || id === BLOCK.BED || id === BLOCK.CHEST) return null;
  if (id === BLOCK.WORKBENCH || id === BLOCK.FURNACE) return null;
  // Terrain / built solids that read as cave walls
  if (id === BLOCK.DIRT || id === BLOCK.STONE || id === BLOCK.SAND
    || id === BLOCK.CLAY || id === BLOCK.COAL || id === BLOCK.IRON
    || id === BLOCK.GOLD || id === BLOCK.COPPER || id === BLOCK.PLANKS
    || id === BLOCK.BRICK) {
    return id;
  }
  const m = BLOCK_META[id];
  if (m && m.solid && m.color) return id;
  return null;
}

/**
 * Infer what material the dug-out wall should show at (wx, y).
 * Prefers neighboring solids (what you actually mined through),
 * then falls back to depth band matching world gen (dirt near surface, stone deeper).
 */
export function inferCaveWallId(world, wx, y) {
  y = Math.floor(y);
  const counts = Object.create(null);
  let best = null;
  let bestN = 0;

  // Cardinal + diagonal neighbors, then one tile further on cardinals
  const offsets = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 0], [-2, 0], [0, 2], [0, -2],
  ];
  for (let i = 0; i < offsets.length; i++) {
    const [dx, dy] = offsets[i];
    const id = getTile(world, wx + dx, y + dy);
    const wall = normalizeWallId(id);
    if (wall == null) continue;
    // Closer neighbors weigh more
    const w = (Math.abs(dx) + Math.abs(dy) <= 1) ? 3 : (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) ? 2 : 1;
    counts[wall] = (counts[wall] || 0) + w;
    if (counts[wall] > bestN) {
      bestN = counts[wall];
      best = wall;
    }
  }
  if (best != null && bestN >= 2) return best;

  // Depth fallback — mirrors generateWorld layers
  const surf = (world.surface && world.surface[wx] != null) ? world.surface[wx] : SURFACE_Y;
  const depth = y - surf;
  const bio = world.biome ? world.biome[wx] : 0;
  if (depth < 5) {
    if (bio === 1) return BLOCK.SAND;
    return BLOCK.DIRT;
  }
  return BLOCK.STONE;
}

function parseHexRgb(hex) {
  if (!hex || hex[0] !== '#') return { r: 80, g: 84, b: 90 };
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Dim wall color for cave open-air fill, tinted by material.
 * Walls stay clearly darker than foreground blocks — never pale/white sky.
 * @param {number} wallId BLOCK id
 * @param {number} lightLevel 0–15
 * @param {number} [flicker=1]
 * @param {number} [noise=0] -1…1 grain
 */
export function caveWallColor(wallId, lightLevel, flicker, noise) {
  const meta = BLOCK_META[wallId] || BLOCK_META[BLOCK.STONE];
  const base = parseHexRgb(meta.color || '#7a7f88');
  const fl = flicker != null ? flicker : 1;
  const t = Math.max(0, Math.min(15, Number(lightLevel) || 0)) / 15;
  const smooth = t * t * (3 - 2 * t);
  // Unlit walls ~14% of material; fully lit walls ~48% — still clearly "wall" not sky
  const bri = (0.14 + 0.34 * Math.pow(smooth, 1.1)) * fl;
  const n = noise != null ? noise : 0;
  const grain = 1 + n * 0.12; // subtle speckles
  // Slight warm lift near light so torch doesn't turn stone green-gray wrong
  const warm = smooth * 0.06;
  let r = base.r * bri * grain + warm * 18;
  let g = base.g * bri * grain + warm * 10;
  let b = base.b * bri * grain;
  // Hard cap — never approach white/sky
  r = Math.min(115, Math.max(0, r));
  g = Math.min(110, Math.max(0, g));
  b = Math.min(105, Math.max(0, b));
  return {
    r: r | 0,
    g: g | 0,
    b: b | 0,
    sum: (r | 0) + (g | 0) + (b | 0),
    wallId: wallId || BLOCK.STONE,
  };
}

/**
 * Legacy flat cave air (stone-tinted). Prefer caveWallColor + inferCaveWallId.
 * Kept so older call sites / tests stay stable on "never white".
 */
export function caveAirColor(lightLevel, flicker) {
  return caveWallColor(BLOCK.STONE, lightLevel, flicker, 0);
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

/** Cheap 0–1 hash for wall grain (stable per world pixel). */
export function wallNoise2D(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
