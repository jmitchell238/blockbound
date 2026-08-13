/**
 * Tree felling.
 *
 * Chopping the base of a tree should bring the whole thing down. Leaving a
 * floating trunk reads, to a child, like the game ignored them — and a trunk
 * you can walk into but not walk past reads as being stuck.
 *
 * The hard part is telling a *tree* from a *wooden house*. A house made of
 * planks-in-the-rough is the same block id, and demolishing one because a kid
 * mined a corner would be heartbreaking. So felling only fires when the
 * connected wood looks like a trunk: narrow, small, and wearing leaves.
 */
import { BLOCK } from '../content/blocks.js';
import { getTile, setTile, markLightDirty, wrapX, wrapDeltaX } from './index.js';

/** A trunk wider than this is a wall, not a tree. */
const MAX_TRUNK_COLS = 3;
/** A wood blob bigger than this is a build, not a tree. */
const MAX_TRUNK_TILES = 96;
/** How far canopy leaves may sit from the wood they hang on. */
const CANOPY_REACH = 4;
const MAX_CANOPY_TILES = 320;

/**
 * Decide whether the wood above a freshly-mined tile is a tree, and if so
 * remove the trunk and its canopy.
 *
 * Call this *after* the mined tile itself has been cleared, passing the tile
 * that was mined. Nothing below the cut is touched, so chopping halfway up a
 * trunk fells only the top half.
 *
 * @param {any} world
 * @param {number} tx tile x of the block that was mined
 * @param {number} ty tile y of the block that was mined
 * @returns {{tx:number, ty:number, id:number}[]} tiles removed (empty if not a tree)
 */
export function fellTree(world, tx, ty) {
  tx = wrapX(Math.floor(tx));
  ty = Math.floor(ty);
  if (getTile(world, tx, ty - 1) !== BLOCK.WOOD) return [];

  const trunk = collectTrunk(world, tx, ty - 1, ty);
  if (!trunk) return [];

  const canopy = collectCanopy(world, trunk);
  if (!canopy.length) return []; // no leaves — a wooden pillar someone built

  const removed = [];
  const cols = new Set();
  for (const t of trunk.concat(canopy)) {
    const id = getTile(world, t.tx, t.ty);
    if (id !== BLOCK.WOOD && id !== BLOCK.LEAVES) continue;
    setTile(world, t.tx, t.ty, BLOCK.AIR, { silent: true });
    removed.push({ tx: t.tx, ty: t.ty, id });
    cols.add(t.tx);
  }
  // One light pass per column instead of one per tile: markLightDirty already
  // fans out sideways, so per-tile calls would be the same work many times.
  for (const cx of cols) markLightDirty(world, cx, ty);
  return removed;
}

/**
 * Flood the connected wood from a seed, never going below `floorY`.
 * Returns null when the shape fails the "this is a tree" test.
 */
function collectTrunk(world, sx, sy, floorY) {
  const seen = new Set();
  const out = [];
  const queue = [{ tx: wrapX(sx), ty: sy }];
  seen.add(key(sx, sy));

  while (queue.length) {
    const cur = queue.shift();
    out.push(cur);
    if (out.length > MAX_TRUNK_TILES) return null;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = wrapX(cur.tx + dx);
      const ny = cur.ty + dy;
      if (ny >= floorY) continue; // never chase wood at or below the cut
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      if (getTile(world, nx, ny) !== BLOCK.WOOD) continue;
      seen.add(k);
      queue.push({ tx: nx, ty: ny });
    }
  }

  // Width test, measured on the wrapped axis so a trunk at the world seam
  // isn't mistaken for one spanning the map.
  const spread = columnSpread(out.map((t) => t.tx));
  if (spread > MAX_TRUNK_COLS) return null;
  return out;
}

/** Leaves connected to the trunk, within CANOPY_REACH of some felled wood. */
function collectCanopy(world, trunk) {
  const near = (x, y) => trunk.some(
    (t) => Math.abs(wrapDeltaX(t.tx, x)) <= CANOPY_REACH && Math.abs(t.ty - y) <= CANOPY_REACH,
  );

  const seen = new Set();
  const out = [];
  const queue = [];
  for (const t of trunk) {
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = wrapX(t.tx + dx);
      const ny = t.ty + dy;
      const k = key(nx, ny);
      if (seen.has(k) || getTile(world, nx, ny) !== BLOCK.LEAVES) continue;
      seen.add(k);
      queue.push({ tx: nx, ty: ny });
    }
  }

  while (queue.length) {
    const cur = queue.shift();
    out.push(cur);
    if (out.length >= MAX_CANOPY_TILES) break;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = wrapX(cur.tx + dx);
      const ny = cur.ty + dy;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      if (getTile(world, nx, ny) !== BLOCK.LEAVES) continue;
      if (!near(nx, ny)) continue;
      seen.add(k);
      queue.push({ tx: nx, ty: ny });
    }
  }
  return out;
}

const NEIGHBOURS = [
  [0, -1], [0, 1], [-1, 0], [1, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

const key = (x, y) => `${wrapX(x)},${y}`;

/** Widest gap between any two trunk columns, wrap-aware. */
function columnSpread(xs) {
  const base = xs[0];
  let lo = 0;
  let hi = 0;
  for (const x of xs) {
    const d = wrapDeltaX(base, x);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return hi - lo + 1;
}
