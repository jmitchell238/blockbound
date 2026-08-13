import {
  WORLD_H, SURFACE_Y, MAGMA_Y, SKY_LIMIT, LIGHT_RADIUS,
} from '../core/constants.js';
import { WORLD_W, applyWorldSize, WORLD_SIZE_PRESETS } from '../core/worldSize.js';
import { makeRng, valueNoise1D, valueNoise2D } from '../core/rng.js';
import { BLOCK, BLOCK_META, BIOME_NAMES, isPlatform, isGravityBlock } from '../content/blocks.js';
import { scheduleCell, isLiquid } from './liquid.js';
import { tileKey } from '../content/items.js';
import { makeWorldMeta, serializeMeta, deserializeMeta } from '../interact/meta.js';

/**
 * Wrapping 2D tile world — the signature Blockheads feel:
 * walk left or right long enough and you return to where you started.
 *
 * Scale notes:
 * - Tiles + light are flat Uint8Arrays (WORLD_W × WORLD_H). At 16384×128 ≈ 4MB.
 * - Render is view-local (always cheap).
 * - Lighting after gen is column-local so mining/placing stays fast at Epic size.
 */

export function wrapX(x) {
  return ((x % WORLD_W) + WORLD_W) % WORLD_W;
}

export function clampY(y) {
  return Math.max(0, Math.min(WORLD_H - 1, y));
}

export function makeWorld(seed) {
  const tiles = new Uint8Array(WORLD_W * WORLD_H);
  const light = new Uint8Array(WORLD_W * WORLD_H);
  const surface = new Int16Array(WORLD_W);
  const biome = new Uint8Array(WORLD_W); // 0 forest, 1 desert, 2 snow, 3 plains
  return {
    seed,
    w: WORLD_W,
    h: WORLD_H,
    tiles,
    light,
    surface,
    biome,
    dirtyLight: false,
    lightDirtyCols: null, // Set of column indices, or null
    meta: makeWorldMeta(),
  };
}

export function idx(x, y) {
  return wrapX(x) + y * WORLD_W;
}

export function getTile(world, x, y) {
  y = Math.floor(y);
  if (y < 0 || y >= WORLD_H) return BLOCK.BEDROCK;
  return world.tiles[idx(x, y)];
}

export function setTile(world, x, y, id, opts) {
  y = Math.floor(y);
  if (y < 0 || y >= WORLD_H) return false;
  const i = idx(x, y);
  if (world.tiles[i] === BLOCK.BEDROCK && id !== BLOCK.BEDROCK) return false;
  if (world.tiles[i] === BLOCK.LAVA && id !== BLOCK.LAVA && y >= MAGMA_Y) return false;
  if (world.tiles[i] === id) return true;
  const was = world.tiles[i];
  world.tiles[i] = id;
  if (!opts || !opts.silent) markLightDirty(world, wrapX(x), y);
  // Any tile change can start or stop a flow — wake the neighbourhood.
  if (isLiquid(id) || isLiquid(was) || was === BLOCK.AIR || id === BLOCK.AIR) {
    scheduleCell(world, wrapX(x), y);
  }
  return true;
}

export function markLightDirty(world, x, y) {
  world.dirtyLight = true;
  if (!world.lightDirtyCols) world.lightDirtyCols = new Set();
  const r = LIGHT_RADIUS;
  for (let dx = -r; dx <= r; dx++) {
    world.lightDirtyCols.add(wrapX(x + dx));
  }
}

export function isSolid(world, x, y) {
  const t = getTile(world, x, y);
  // Open doors are walkable
  if (t === BLOCK.DOOR && world.meta && world.meta.openDoors && world.meta.openDoors[tileKey(x, y)]) {
    return false;
  }
  const m = BLOCK_META[t];
  return !!(m && m.solid);
}

/** Platforms only block from above (one-way). */
export function blocksFromAbove(world, x, y) {
  const t = getTile(world, x, y);
  if (isPlatform(t)) return true;
  return isSolid(world, x, y);
}

/**
 * Local sand/snow gravity near a column (and player neighborhood).
 * Returns number of blocks that fell.
 */
export function tickGravityNear(world, cx, cy, radius) {
  radius = radius == null ? 10 : radius;
  let moved = 0;
  // Bottom-up so cascades work in one pass
  const y0 = Math.max(1, Math.floor(cy) - radius);
  const y1 = Math.min(WORLD_H - 2, Math.floor(cy) + radius);
  for (let y = y1; y >= y0; y--) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = wrapX(Math.floor(cx) + dx);
      const id = getTile(world, x, y);
      if (!isGravityBlock(id)) continue;
      const below = getTile(world, x, y + 1);
      if (below === BLOCK.AIR || below === BLOCK.WATER) {
        // Fall one step
        world.tiles[idx(x, y)] = below === BLOCK.WATER ? BLOCK.WATER : BLOCK.AIR;
        world.tiles[idx(x, y + 1)] = id;
        markLightDirty(world, x, y);
        markLightDirty(world, x, y + 1);
        // Gravity writes tiles directly rather than through setTile, so it has
        // to wake the liquid sim itself — otherwise sand dropping through a
        // puddle leaves a hole the water never fills.
        scheduleCell(world, x, y);
        scheduleCell(world, x, y + 1);
        moved++;
      }
    }
  }
  return moved;
}

export function biomeNameAt(world, x) {
  const b = world.biome[wrapX(Math.floor(x))];
  return (BIOME_NAMES && BIOME_NAMES[b]) || 'Wilds';
}

export function isClimbable(world, x, y) {
  const t = getTile(world, x, y);
  return !!(BLOCK_META[t] && BLOCK_META[t].climb);
}

export function isHazard(world, x, y) {
  const t = getTile(world, x, y);
  return !!(BLOCK_META[t] && BLOCK_META[t].hazard);
}

/**
 * Generate a full wrapping world. Optional onProgress(0..1) for UI.
 * Strip-based so huge (16k) worlds don't feel like a permanent freeze.
 */
export function generateWorld(seed, onProgress) {
  const world = makeWorld(seed | 0);
  const rng = makeRng(seed);
  const report = typeof onProgress === 'function' ? onProgress : function () {};

  // Noise wavelengths scale with circumference so biomes stay interesting
  const s1 = Math.max(48, WORLD_W / 80);
  const s2 = Math.max(18, WORLD_W / 220);
  const s3 = Math.max(8, WORLD_W / 480);
  const biomeScale = Math.max(64, WORLD_W / 64);

  // —— Heightmap + biomes ——
  for (let x = 0; x < WORLD_W; x++) {
    const n1 = valueNoise1D(x, seed, s1);
    const n2 = valueNoise1D(x + 1000, seed + 7, s2);
    const n3 = valueNoise1D(x + 2000, seed + 13, s3);
    let h = SURFACE_Y + Math.floor((n1 - 0.5) * 16 + (n2 - 0.5) * 7 + (n3 - 0.5) * 3);
    h = Math.max(14, Math.min(WORLD_H - 36, h));
    world.surface[x] = h;

    const b = valueNoise1D(x, seed + 99, biomeScale);
    if (b < 0.22) world.biome[x] = 1;
    else if (b > 0.78) world.biome[x] = 2;
    else if (b > 0.55 && b < 0.68) world.biome[x] = 3;
    else world.biome[x] = 0;
  }

  // Wrap-aware smooth
  for (let pass = 0; pass < 2; pass++) {
    const next = new Int16Array(WORLD_W);
    for (let x = 0; x < WORLD_W; x++) {
      const a = world.surface[wrapX(x - 1)];
      const b = world.surface[x];
      const c = world.surface[wrapX(x + 1)];
      next[x] = Math.round((a + b * 2 + c) / 4);
    }
    world.surface.set(next);
  }

  report(0.12);

  // —— Fill columns (strip progress) ——
  const strip = Math.max(256, Math.min(1024, Math.floor(WORLD_W / 16)));
  for (let x0 = 0; x0 < WORLD_W; x0 += strip) {
    const x1 = Math.min(WORLD_W, x0 + strip);
    for (let x = x0; x < x1; x++) {
      const surface = world.surface[x];
      const bio = world.biome[x];
      for (let y = 0; y < WORLD_H; y++) {
        let id = BLOCK.AIR;
        if (y >= WORLD_H - 2) {
          id = BLOCK.BEDROCK;
        } else if (y >= MAGMA_Y) {
          id = BLOCK.LAVA;
        } else if (y > surface) {
          const depth = y - surface;
          if (depth === 1) {
            if (bio === 1) id = BLOCK.SAND;
            else if (bio === 2) id = BLOCK.SNOW;
            else id = BLOCK.GRASS;
          } else if (depth < 5 + (bio === 1 ? 3 : 0)) {
            if (bio === 1) id = BLOCK.SAND;
            else if (bio === 2 && depth < 3) id = BLOCK.DIRT;
            else id = BLOCK.DIRT;
            if (bio !== 1 && depth > 2 && rng() < 0.08) id = BLOCK.CLAY;
          } else {
            id = BLOCK.STONE;
            const oreN = valueNoise2D(x, y, seed + 50, 6);
            if (depth > 10 && oreN > 0.78 && rng() < 0.35) id = BLOCK.COAL;
            else if (depth > 18 && oreN > 0.82 && rng() < 0.22) id = BLOCK.COPPER;
            else if (depth > 28 && oreN > 0.86 && rng() < 0.16) id = BLOCK.IRON;
            else if (depth > 40 && oreN > 0.9 && rng() < 0.1) id = BLOCK.GOLD;
          }
        } else {
          const sea = SURFACE_Y + 8;
          if (y > sea && surface > sea - 1) id = BLOCK.WATER;
          else id = BLOCK.AIR;
        }
        world.tiles[idx(x, y)] = id;
      }
    }
    report(0.12 + 0.45 * (x1 / WORLD_W));
  }

  // —— Caves ——
  for (let x0 = 0; x0 < WORLD_W; x0 += strip) {
    const x1 = Math.min(WORLD_W, x0 + strip);
    for (let x = x0; x < x1; x++) {
      for (let y = SURFACE_Y + 4; y < MAGMA_Y - 2; y++) {
        const t = world.tiles[idx(x, y)];
        if (t === BLOCK.BEDROCK || t === BLOCK.LAVA || t === BLOCK.AIR || t === BLOCK.WATER) continue;
        const n = valueNoise2D(x, y, seed + 200, 10);
        const n2 = valueNoise2D(x, y, seed + 300, 5);
        const depth = y - world.surface[x];
        if (depth > 6 && n > 0.58 && n2 > 0.42) {
          world.tiles[idx(x, y)] = BLOCK.AIR;
        }
      }
    }
    report(0.57 + 0.18 * (x1 / WORLD_W));
  }

  // —— Trees (density scales lightly so Epic isn't a solid forest wall) ——
  const treeChanceBase = 0.12 * Math.min(1.2, 4096 / Math.max(1024, WORLD_W) * 1.1 + 0.3);
  for (let x = 0; x < WORLD_W; x++) {
    const bio = world.biome[x];
    if (bio === 1) continue;
    const surface = world.surface[x];
    const ground = getTile(world, x, surface + 1);
    if (ground !== BLOCK.GRASS && ground !== BLOCK.SNOW && ground !== BLOCK.DIRT) continue;
    if (getTile(world, x, surface) !== BLOCK.AIR) continue;
    const chance = bio === 0 ? treeChanceBase : bio === 3 ? treeChanceBase * 0.4 : treeChanceBase * 0.3;
    if (rng() > chance) continue;
    let clear = true;
    for (let dx = -2; dx <= 2; dx++) {
      if (getTile(world, x + dx, surface - 1) === BLOCK.WOOD) clear = false;
    }
    if (!clear) continue;
    const trunkH = 3 + Math.floor(rng() * 3);
    for (let ty = 0; ty < trunkH; ty++) {
      const yy = surface - ty;
      if (yy <= SKY_LIMIT) break;
      const cur = getTile(world, x, yy);
      if (cur === BLOCK.AIR || cur === BLOCK.LEAVES) {
        world.tiles[idx(x, yy)] = BLOCK.WOOD;
      }
    }
    const top = surface - trunkH;
    const leafR = 2;
    for (let dy = -leafR; dy <= 1; dy++) {
      for (let dx = -leafR; dx <= leafR; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > leafR + 1) continue;
        const lx = x + dx;
        const ly = top + dy;
        if (ly <= SKY_LIMIT || ly >= WORLD_H) continue;
        if (getTile(world, lx, ly) === BLOCK.AIR) {
          world.tiles[idx(lx, ly)] = BLOCK.LEAVES;
        }
      }
    }
  }
  report(0.82);

  // Cacti
  for (let x = 0; x < WORLD_W; x++) {
    if (world.biome[x] !== 1) continue;
    if (rng() > 0.035) continue;
    const surface = world.surface[x];
    if (getTile(world, x, surface + 1) !== BLOCK.SAND) continue;
    const h = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < h; i++) {
      const yy = surface - i;
      if (yy > SKY_LIMIT) world.tiles[idx(x, yy)] = BLOCK.LEAVES;
    }
  }

  const spawnX = Math.floor(WORLD_W / 2);
  ensureSpawn(world, spawnX);
  report(0.9);

  // Full sky light once (no multi-pass flood over entire Epic world — torches use local flood)
  recomputeSkyLight(world);
  // One short flood for lava glow near bottom is enough region-wise skipped at gen
  report(1);
  world.dirtyLight = false;
  world.lightDirtyCols = null;
  return world;
}

export function _yieldFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

/**
 * Same as generateWorld but yields between strips so the progress UI can paint
 * (important for Epic 16k on slower devices).
 */
export async function generateWorldAsync(seed, onProgress) {
  // For small maps, sync path is fine
  if (WORLD_W <= 2048) {
    return generateWorld(seed, onProgress);
  }

  const world = makeWorld(seed | 0);
  const rng = makeRng(seed);
  const report = typeof onProgress === 'function' ? onProgress : function () {};
  const s1 = Math.max(48, WORLD_W / 80);
  const s2 = Math.max(18, WORLD_W / 220);
  const s3 = Math.max(8, WORLD_W / 480);
  const biomeScale = Math.max(64, WORLD_W / 64);
  const strip = Math.max(256, Math.min(512, Math.floor(WORLD_W / 32)));

  for (let x = 0; x < WORLD_W; x++) {
    const n1 = valueNoise1D(x, seed, s1);
    const n2 = valueNoise1D(x + 1000, seed + 7, s2);
    const n3 = valueNoise1D(x + 2000, seed + 13, s3);
    let h = SURFACE_Y + Math.floor((n1 - 0.5) * 16 + (n2 - 0.5) * 7 + (n3 - 0.5) * 3);
    h = Math.max(14, Math.min(WORLD_H - 36, h));
    world.surface[x] = h;
    const b = valueNoise1D(x, seed + 99, biomeScale);
    if (b < 0.22) world.biome[x] = 1;
    else if (b > 0.78) world.biome[x] = 2;
    else if (b > 0.55 && b < 0.68) world.biome[x] = 3;
    else world.biome[x] = 0;
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Int16Array(WORLD_W);
    for (let x = 0; x < WORLD_W; x++) {
      next[x] = Math.round((world.surface[wrapX(x - 1)] + world.surface[x] * 2 + world.surface[wrapX(x + 1)]) / 4);
    }
    world.surface.set(next);
  }
  report(0.1);
  await _yieldFrame();

  for (let x0 = 0; x0 < WORLD_W; x0 += strip) {
    const x1 = Math.min(WORLD_W, x0 + strip);
    for (let x = x0; x < x1; x++) {
      const surface = world.surface[x];
      const bio = world.biome[x];
      for (let y = 0; y < WORLD_H; y++) {
        let id = BLOCK.AIR;
        if (y >= WORLD_H - 2) id = BLOCK.BEDROCK;
        else if (y >= MAGMA_Y) id = BLOCK.LAVA;
        else if (y > surface) {
          const depth = y - surface;
          if (depth === 1) id = bio === 1 ? BLOCK.SAND : bio === 2 ? BLOCK.SNOW : BLOCK.GRASS;
          else if (depth < 5 + (bio === 1 ? 3 : 0)) {
            id = bio === 1 ? BLOCK.SAND : BLOCK.DIRT;
            if (bio !== 1 && depth > 2 && rng() < 0.08) id = BLOCK.CLAY;
          } else {
            id = BLOCK.STONE;
            const oreN = valueNoise2D(x, y, seed + 50, 6);
            if (depth > 10 && oreN > 0.78 && rng() < 0.35) id = BLOCK.COAL;
            else if (depth > 18 && oreN > 0.82 && rng() < 0.22) id = BLOCK.COPPER;
            else if (depth > 28 && oreN > 0.86 && rng() < 0.16) id = BLOCK.IRON;
            else if (depth > 40 && oreN > 0.9 && rng() < 0.1) id = BLOCK.GOLD;
          }
        } else {
          const sea = SURFACE_Y + 8;
          if (y > sea && surface > sea - 1) id = BLOCK.WATER;
        }
        world.tiles[idx(x, y)] = id;
      }
    }
    report(0.1 + 0.5 * (x1 / WORLD_W));
    await _yieldFrame();
  }

  for (let x0 = 0; x0 < WORLD_W; x0 += strip) {
    const x1 = Math.min(WORLD_W, x0 + strip);
    for (let x = x0; x < x1; x++) {
      for (let y = SURFACE_Y + 4; y < MAGMA_Y - 2; y++) {
        const t = world.tiles[idx(x, y)];
        if (t === BLOCK.BEDROCK || t === BLOCK.LAVA || t === BLOCK.AIR || t === BLOCK.WATER) continue;
        const n = valueNoise2D(x, y, seed + 200, 10);
        const n2 = valueNoise2D(x, y, seed + 300, 5);
        if ((y - world.surface[x]) > 6 && n > 0.58 && n2 > 0.42) world.tiles[idx(x, y)] = BLOCK.AIR;
      }
    }
    report(0.6 + 0.15 * (x1 / WORLD_W));
    await _yieldFrame();
  }

  // trees + cacti (reuse sync logic via second pass helpers)
  const treeChanceBase = 0.12 * Math.min(1.2, 4096 / Math.max(1024, WORLD_W) * 1.1 + 0.3);
  for (let x = 0; x < WORLD_W; x++) {
    const bio = world.biome[x];
    if (bio === 1) continue;
    const surface = world.surface[x];
    const ground = getTile(world, x, surface + 1);
    if (ground !== BLOCK.GRASS && ground !== BLOCK.SNOW && ground !== BLOCK.DIRT) continue;
    if (getTile(world, x, surface) !== BLOCK.AIR) continue;
    const chance = bio === 0 ? treeChanceBase : treeChanceBase * 0.35;
    if (rng() > chance) continue;
    let clear = true;
    for (let dx = -2; dx <= 2; dx++) {
      if (getTile(world, x + dx, surface - 1) === BLOCK.WOOD) clear = false;
    }
    if (!clear) continue;
    const trunkH = 3 + Math.floor(rng() * 3);
    for (let ty = 0; ty < trunkH; ty++) {
      const yy = surface - ty;
      if (yy <= SKY_LIMIT) break;
      const cur = getTile(world, x, yy);
      if (cur === BLOCK.AIR || cur === BLOCK.LEAVES) world.tiles[idx(x, yy)] = BLOCK.WOOD;
    }
    const top = surface - trunkH;
    for (let dy = -2; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 3) continue;
        const ly = top + dy;
        if (ly > SKY_LIMIT && ly < WORLD_H && getTile(world, x + dx, ly) === BLOCK.AIR) {
          world.tiles[idx(x + dx, ly)] = BLOCK.LEAVES;
        }
      }
    }
    if (x % strip === 0) {
      report(0.75 + 0.1 * (x / WORLD_W));
      await _yieldFrame();
    }
  }

  for (let x = 0; x < WORLD_W; x++) {
    if (world.biome[x] !== 1 || rng() > 0.035) continue;
    const surface = world.surface[x];
    if (getTile(world, x, surface + 1) !== BLOCK.SAND) continue;
    const h = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < h; i++) {
      const yy = surface - i;
      if (yy > SKY_LIMIT) world.tiles[idx(x, yy)] = BLOCK.LEAVES;
    }
  }

  ensureSpawn(world, Math.floor(WORLD_W / 2));
  report(0.92);
  await _yieldFrame();
  recomputeSkyLight(world);
  report(1);
  world.dirtyLight = false;
  world.lightDirtyCols = null;
  return world;
}

export function ensureSpawn(world, sx) {
  const surface = world.surface[wrapX(sx)];
  for (let y = 0; y <= surface; y++) {
    if (getTile(world, sx, y) !== BLOCK.WATER) {
      world.tiles[idx(sx, y)] = BLOCK.AIR;
    }
  }
  for (let dx = -2; dx <= 2; dx++) {
    world.tiles[idx(sx + dx, surface + 1)] = BLOCK.GRASS;
    world.tiles[idx(sx + dx, surface)] = BLOCK.AIR;
    if (surface - 1 > SKY_LIMIT) world.tiles[idx(sx + dx, surface - 1)] = BLOCK.AIR;
  }
}

export function isLightTransparent(t) {
  return t === BLOCK.AIR || t === BLOCK.WATER || t === BLOCK.LADDER
    || t === BLOCK.TORCH || t === BLOCK.LANTERN || t === BLOCK.LEAVES || t === BLOCK.GLASS;
}

export function emitLight(t) {
  const m = BLOCK_META[t];
  if (m && m.light) return m.light;
  if (t === BLOCK.LAVA) return 12;
  return 0;
}

/** Full-column sky light for whole world (gen / load). O(W×H), one pass. */
export function recomputeSkyLight(world) {
  const L = world.light;
  L.fill(0);
  for (let x = 0; x < WORLD_W; x++) {
    fillSkyColumn(world, x);
  }
}

export function fillSkyColumn(world, x) {
  const L = world.light;
  let sky = 15;
  for (let y = 0; y < WORLD_H; y++) {
    const t = world.tiles[idx(x, y)];
    const emit = emitLight(t);
    if (isLightTransparent(t)) {
      if (t === BLOCK.LEAVES) sky = Math.max(0, sky - 2);
      else if (t === BLOCK.WATER) sky = Math.max(0, sky - 1);
      else if (t === BLOCK.GLASS) sky = Math.max(0, sky - 0);
      L[idx(x, y)] = Math.max(sky, emit);
    } else {
      sky = 0;
      L[idx(x, y)] = emit;
    }
  }
}

/**
 * Can light travel *through* this tile into neighbors?
 * Solids block propagation (except glass/doors handled as non-blocking where needed).
 */
export function lightBlocksPropagation(t) {
  if (t === BLOCK.AIR || t === BLOCK.WATER || t === BLOCK.LADDER
      || t === BLOCK.TORCH || t === BLOCK.LANTERN || t === BLOCK.LEAVES
      || t === BLOCK.CAMPFIRE) {
    return false;
  }
  // Glass lets light through
  if (t === BLOCK.GLASS) return false;
  // Open platforms let light past vertically a bit — treat as non-blocking for glow
  if (isPlatform(t)) return false;
  const m = BLOCK_META[t];
  if (m && m.light) return false; // emitters always participate
  if (m && m.solid) return true;
  return false;
}

/**
 * Local light update for dirty columns: sky refill + limited flood.
 * Safe at 16k width because we never scan the whole map on mine/place.
 */
export function flushLight(world) {
  if (!world.dirtyLight && (!world.lightDirtyCols || world.lightDirtyCols.size === 0)) {
    world.dirtyLight = false;
    return;
  }

  let cols;
  if (world.lightDirtyCols && world.lightDirtyCols.size > 0) {
    cols = world.lightDirtyCols;
  } else {
    // Full refresh requested
    recomputeSkyLight(world);
    floodLightAll(world, LIGHT_RADIUS);
    world.dirtyLight = false;
    world.lightDirtyCols = null;
    return;
  }

  // Expand for torch / lantern bleed
  const set = new Set();
  for (const x of cols) {
    for (let d = -LIGHT_RADIUS; d <= LIGHT_RADIUS; d++) set.add(wrapX(x + d));
  }

  for (const x of set) fillSkyColumn(world, x);

  // Multi-pass flood only inside the dirty column set
  floodLightColumns(world, Array.from(set), LIGHT_RADIUS);

  world.lightDirtyCols = null;
  world.dirtyLight = false;
}

/**
 * Flood light through air; solid walls can *receive* light (so faces brighten)
 * but do not re-transmit it (except emitters / transparent).
 */
export function floodLightColumns(world, list, passes) {
  const L = world.light;
  passes = passes || LIGHT_RADIUS;
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      for (let y = 1; y < WORLD_H - 1; y++) {
        const i0 = idx(x, y);
        const t = world.tiles[i0];
        const blocks = lightBlocksPropagation(t);
        // Max light from neighbors that can transmit
        let n = 0;
        // left
        {
          const tn = world.tiles[idx(x - 1, y)];
          if (!lightBlocksPropagation(tn) || emitLight(tn) > 0) {
            n = Math.max(n, L[idx(x - 1, y)]);
          }
        }
        {
          const tn = world.tiles[idx(x + 1, y)];
          if (!lightBlocksPropagation(tn) || emitLight(tn) > 0) {
            n = Math.max(n, L[idx(x + 1, y)]);
          }
        }
        {
          const tn = world.tiles[idx(x, y - 1)];
          if (!lightBlocksPropagation(tn) || emitLight(tn) > 0) {
            n = Math.max(n, L[idx(x, y - 1)]);
          }
        }
        {
          const tn = world.tiles[idx(x, y + 1)];
          if (!lightBlocksPropagation(tn) || emitLight(tn) > 0) {
            n = Math.max(n, L[idx(x, y + 1)]);
          }
        }
        const cur = L[i0];
        // Emitters keep their own level; everyone can pick up neighbor-1
        const next = Math.max(cur, n - 1, emitLight(t));
        // Solid non-emitters: only receive (for face lighting), already handled
        // Transparent: receive and will transmit next pass via neighbor check
        if (next > cur) {
          L[i0] = next;
          changed = true;
        }
        // If this cell blocks propagation, clamp so it doesn't become a fake light source
        // (it still stores light for rendering faces)
        if (blocks && emitLight(t) === 0 && next > 0) {
          // keep the value for rendering — transmission is gated in neighbor checks
        }
      }
    }
    if (!changed) break;
  }
}

/** Cheap whole-map flood — only for load fallbacks. */
export function floodLightAll(world, passes) {
  const list = [];
  for (let x = 0; x < WORLD_W; x++) list.push(x);
  floodLightColumns(world, list, passes || 6);
}

/** Back-compat name used by game loop / load. */
export function recomputeLight(world) {
  if (world.lightDirtyCols && world.lightDirtyCols.size > 0) {
    flushLight(world);
    return;
  }
  recomputeSkyLight(world);
  // Skip expensive full flood on huge maps; local flush handles torches after place
  if (WORLD_W <= 2048) floodLightAll(world, 6);
  else floodLightAll(world, 2);
  world.dirtyLight = false;
  world.lightDirtyCols = null;
}

export function getLight(world, x, y) {
  y = Math.floor(y);
  if (y < 0) return 15;
  if (y >= WORLD_H) return 0;
  return world.light[idx(x, y)];
}

/**
 * Light used for drawing a tile face: self + brightest adjacent air/emitter,
 * so solid walls next to a torch actually brighten.
 */
export function getRenderLight(world, x, y) {
  y = Math.floor(y);
  if (y < 0) return 15;
  if (y >= WORLD_H) return 0;
  let L = getLight(world, x, y);
  L = Math.max(
    L,
    getLight(world, x - 1, y),
    getLight(world, x + 1, y),
    getLight(world, x, y - 1),
    getLight(world, x, y + 1)
  );
  return L;
}

/**
 * Map 0–15 light level → 0–1 brightness for rendering.
 * Very soft falloff so torch pools fade smoothly (no hard light/dark cut).
 */
export function lightToBrightness(level, opts) {
  opts = opts || {};
  const t = Math.max(0, Math.min(15, Number(level) || 0)) / 15;
  const ambient = opts.ambient != null ? opts.ambient : 0.03;
  // smoothstep then ease-out for long soft tail
  const s = t * t * (3 - 2 * t);
  const soft = s * s * (3 - 2 * s); // double smoothstep — very gentle edges
  const mixed = t * 0.25 + s * 0.35 + soft * 0.4;
  return ambient + (1 - ambient) * mixed;
}

/**
 * Bilinear sample of render light at continuous tile coords.
 * Used so cave darkness and block shading blend across tile edges.
 */
export function sampleLight(world, fx, fy) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const l00 = getRenderLight(world, x0, y0);
  const l10 = getRenderLight(world, x0 + 1, y0);
  const l01 = getRenderLight(world, x0, y0 + 1);
  const l11 = getRenderLight(world, x0 + 1, y0 + 1);
  return l00 * (1 - tx) * (1 - ty)
    + l10 * tx * (1 - ty)
    + l01 * (1 - tx) * ty
    + l11 * tx * ty;
}

export function wrapDeltaX(from, to) {
  let d = wrapX(to) - wrapX(from);
  if (d > WORLD_W / 2) d -= WORLD_W;
  if (d < -WORLD_W / 2) d += WORLD_W;
  return d;
}

export function serializeWorld(world) {
  const rle = [];
  let prev = world.tiles[0];
  let count = 1;
  for (let i = 1; i < world.tiles.length; i++) {
    if (world.tiles[i] === prev && count < 65535) count++;
    else {
      rle.push(prev, count);
      prev = world.tiles[i];
      count = 1;
    }
  }
  rle.push(prev, count);
  return {
    seed: world.seed,
    w: world.w || WORLD_W,
    h: world.h || WORLD_H,
    rle,
    surface: Array.from(world.surface),
    biome: Array.from(world.biome),
    meta: world.meta ? serializeMeta(world.meta) : null,
  };
}

export function deserializeWorld(data) {
  if (!data || !data.rle || !data.w || !data.h) return null;
  if (data.h !== WORLD_H) return null;
  if (!WORLD_SIZE_PRESETS.some(p => p.w === data.w)) return null;
  applyWorldSize(data.w);
  const world = makeWorld(data.seed);
  let i = 0;
  const need = WORLD_W * WORLD_H;
  for (let k = 0; k < data.rle.length; k += 2) {
    const id = data.rle[k];
    const count = data.rle[k + 1];
    for (let c = 0; c < count && i < need; c++) world.tiles[i++] = id;
  }
  if (i !== need) return null;
  if (data.surface && data.surface.length === WORLD_W) world.surface.set(data.surface);
  if (data.biome && data.biome.length === WORLD_W) world.biome.set(data.biome);
  if (data.meta) {
    world.meta = deserializeMeta(data.meta);
  } else if (!world.meta) {
    world.meta = makeWorldMeta();
  }
  recomputeSkyLight(world);
  if (WORLD_W <= 4096) floodLightAll(world, 3);
  world.dirtyLight = false;
  return world;
}
