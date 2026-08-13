/**
 * Finite liquid flow.
 *
 * Blockbound had no liquid simulation at all: water was an inert block, so
 * pouring a bucket into a two-deep hole filled only the tile you clicked and
 * a single tile in a flat trench stayed a single tile forever.
 *
 * Two constraints shape the design.
 *
 * 1. Levels, not booleans. A purely binary "this tile is water" spreads without
 *    limit — one bucket floods a flat world. Each tile carries a level: a
 *    source is MAX_LEVEL, each tile it spreads sideways into is one lower, and
 *    it stops at zero. That bounds a puddle and makes a two-deep hole fill.
 *
 * 2. Levels live in a sparse map, not a parallel array. A Uint8Array of levels
 *    would be a second copy of the whole world — 2MB on a 16,384-wide "epic"
 *    world — in memory and in every save. Storage quota has been a real problem
 *    in this project. So only *flowing* tiles carry an entry; a source is just
 *    an ordinary tile with no entry, and a settled world stores almost nothing.
 *
 * Work is driven by an active-cell queue rather than by scanning the world: a
 * still world costs nothing per frame.
 */
import { BLOCK } from '../content/blocks.js';
import { WORLD_W } from '../core/worldSize.js';

/** A source tile. Spreading costs one level per tile of horizontal distance. */
export const MAX_LEVEL = 8;

/** Seconds between flow steps. Liquids creep; they don't teleport. */
export const WATER_STEP = 0.18;

/** Cells to settle per step, so a big pour can't stall a frame. */
export const MAX_CELLS_PER_STEP = 400;

export function isLiquid(id) {
  return id === BLOCK.WATER || id === BLOCK.LAVA;
}

/**
 * Magma is thick: it steps once every LAVA_SLOW flow ticks, so it visibly
 * oozes rather than snapping into place the way water does.
 */
export const LAVA_SLOW = 4;

/**
 * Level of the liquid at a tile, 0 when there is none.
 * A liquid tile with no map entry is a source — that is what makes ocean tiles
 * and bucket pours behave as infinite without storing anything for them.
 */
export function getLevel(world, x, y, getTile) {
  if (!isLiquid(getTile(world, x, y))) return 0;
  const m = world.meta && world.meta.liquid;
  if (!m) return MAX_LEVEL;
  const v = m[key(x, y)];
  return v === undefined ? MAX_LEVEL : v;
}

export function isSource(world, x, y, getTile) {
  if (!isLiquid(getTile(world, x, y))) return false;
  const m = world.meta && world.meta.liquid;
  return !m || m[key(x, y)] === undefined;
}

// Worlds wrap, so x = -1 and x = WORLD_W - 1 are the same tile. Normalising
// here keeps the level map from holding two entries for one tile at the seam.
const wrapCol = (x) => ((x % WORLD_W) + WORLD_W) % WORLD_W;
const key = (x, y) => wrapCol(x) + ',' + y;

function setLevel(world, x, y, level) {
  if (!world.meta) return;
  if (!world.meta.liquid) world.meta.liquid = Object.create(null);
  if (level >= MAX_LEVEL) delete world.meta.liquid[key(x, y)];
  else world.meta.liquid[key(x, y)] = level;
}

function clearLevel(world, x, y) {
  if (world.meta && world.meta.liquid) delete world.meta.liquid[key(x, y)];
}

/** Queue a cell and everything that could be affected by it changing. */
export function scheduleCell(world, x, y) {
  if (!world._liquidQueue) world._liquidQueue = new Set();
  world._liquidQueue.add(key(x, y));
  world._liquidQueue.add(key(x - 1, y));
  world._liquidQueue.add(key(x + 1, y));
  world._liquidQueue.add(key(x, y - 1));
  world._liquidQueue.add(key(x, y + 1));
}

/**
 * Settle one cell. Returns true when something changed.
 *
 * Order matters: falling is resolved before spreading, which is what makes a
 * one-wide two-deep hole fill both tiles instead of only the one you poured
 * into. Water that can fall does not spread sideways at all.
 */
function stepCell(world, x, y, api, tick) {
  const { getTile, setTile } = api;
  const here = getTile(world, x, y);

  // Magma quenched by water turns to stone. This is the whole route down
  // through the magma slab: pour water, get a stone tile, mine it, let magma
  // flow back in, pour again. Handled from the magma side so a single rule
  // covers both "water poured onto magma" and "magma flowed into water".
  if (here === BLOCK.LAVA && touches(world, x, y, BLOCK.WATER, getTile)) {
    setTile(world, x, y, BLOCK.STONE);
    clearLevel(world, x, y);
    scheduleCell(world, x, y);
    return true;
  }

  if (!isLiquid(here)) {
    if (!canHold(here)) return false;
    const feedWater = supportFor(world, x, y, api, BLOCK.WATER);
    const feedLava = supportFor(world, x, y, api, BLOCK.LAVA);
    // Both reaching the same empty tile is the same reaction as above.
    if (feedWater > 0 && feedLava > 0) {
      setTile(world, x, y, BLOCK.STONE);
      scheduleCell(world, x, y);
      return true;
    }
    if (feedWater > 0) {
      setTile(world, x, y, BLOCK.WATER);
      setLevel(world, x, y, feedWater);
      scheduleCell(world, x, y);
      return true;
    }
    if (feedLava > 0) {
      if (tick % LAVA_SLOW !== 0) { scheduleCell(world, x, y); return false; }
      setTile(world, x, y, BLOCK.LAVA);
      setLevel(world, x, y, feedLava);
      scheduleCell(world, x, y);
      return true;
    }
    return false;
  }

  if (here === BLOCK.LAVA && tick % LAVA_SLOW !== 0) {
    scheduleCell(world, x, y);
    return false;
  }

  // Sources never drain and never need topping up.
  if (isSource(world, x, y, getTile)) {
    if (canHold(getTile(world, x, y + 1))
      || canHold(getTile(world, x - 1, y))
      || canHold(getTile(world, x + 1, y))) {
      scheduleCell(world, x, y);
    }
    return false;
  }

  const level = getLevel(world, x, y, getTile);
  const support = supportFor(world, x, y, api, here);

  if (support <= 0) {
    // Nothing feeds this any more — the puddle drains rather than sitting
    // there forever after its source is removed.
    setTile(world, x, y, BLOCK.AIR);
    clearLevel(world, x, y);
    scheduleCell(world, x, y);
    return true;
  }
  if (support !== level) {
    setLevel(world, x, y, support);
    scheduleCell(world, x, y);
    return true;
  }
  return false;
}

/** Is any orthogonal neighbour this block? */
function touches(world, x, y, id, getTile) {
  return getTile(world, x - 1, y) === id || getTile(world, x + 1, y) === id
    || getTile(world, x, y - 1) === id || getTile(world, x, y + 1) === id;
}

/** Can liquid occupy this tile? */
function canHold(id) {
  return id === BLOCK.AIR;
}

/**
 * The level this cell is entitled to from liquid of one kind, given its
 * neighbours. Water and magma never prop each other up — where they meet they
 * react instead.
 * Fed from directly above at full strength (a waterfall stays full all the way
 * down); from the sides at one less than the neighbour.
 */
function supportFor(world, x, y, api, kind) {
  const { getTile } = api;
  const above = getTile(world, x, y - 1);
  if (above === kind) return MAX_LEVEL - 1;

  let best = 0;
  for (const nx of [x - 1, x + 1]) {
    if (getTile(world, nx, y) !== kind) continue;
    // A neighbour only spreads sideways when it has something solid to sit on.
    // If it can still go down — into air, or into a column of liquid that is
    // itself falling — it does that instead. Testing merely "is the tile below
    // occupied" is not enough: once a shaft fills, every tile in the column has
    // water beneath it, and the top of the column would start spreading
    // sideways as if it had landed.
    const below = getTile(world, nx, y + 1);
    if (canHold(below) || isLiquid(below)) continue;
    const n = getLevel(world, nx, y, api.getTile);
    if (n - 1 > best) best = n - 1;
  }
  return best;
}

/**
 * Drain the active-cell queue. Call once per frame with dt; it batches into
 * WATER_STEP ticks so liquids creep at a readable speed.
 * @returns {number} cells changed this call
 */
export function tickLiquids(world, dt, api) {
  if (!world._liquidQueue || world._liquidQueue.size === 0) return 0;
  world._liquidT = (world._liquidT || 0) + dt;
  if (world._liquidT < WATER_STEP) return 0;
  world._liquidT = 0;
  world._liquidTick = (world._liquidTick || 0) + 1;
  const tick = world._liquidTick;

  const queue = world._liquidQueue;
  world._liquidQueue = new Set();

  let changed = 0;
  let budget = MAX_CELLS_PER_STEP;
  for (const k of queue) {
    if (budget-- <= 0) {
      // Out of budget — carry the rest into the next step rather than
      // dropping it, or a big pour would leave half-finished water.
      world._liquidQueue.add(k);
      continue;
    }
    const c = k.indexOf(',');
    const x = +k.slice(0, c);
    const y = +k.slice(c + 1);
    if (stepCell(world, x, y, api, tick)) changed++;
  }
  return changed;
}
