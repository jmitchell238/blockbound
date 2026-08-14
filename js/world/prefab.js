/**
 * Prefab placement logic — pure, no DOM, no canvas.
 * Anchors at the bottom-centre of the grid and respects world wrapping.
 */

import { WORLD_H, SKY_LIMIT } from '../core/constants.js';
import { BLOCK } from '../content/blocks.js';
import { getTile, setTile, wrapX, flushLight } from './index.js';

/**
 * How far from the ground a tap still counts as "put it here on the ground".
 * Beyond this the player clearly meant to build in the air, so the tap stands.
 */
export const SNAP_RANGE = 12;

/** How deep to pack dirt under a build that overhangs a dip. */
export const BACKFILL_DEPTH = 6;

/**
 * Compute the bounding box of a prefab at a given anchor point.
 * Anchor is bottom-centre (ty is the bottom row).
 * @param {Object} prefab - { rows: [...], ... }
 * @param {number} tx - anchor x (centre)
 * @param {number} ty - anchor y (bottom)
 * @returns { x0, y0, w, h } - bounds in world coords
 */
export function prefabBounds(prefab, tx, ty) {
  const rows = prefab.rows || [];
  const w = rows[0] ? rows[0].length : 0;
  const h = rows.length;
  const x0 = tx - Math.floor(w / 2);
  // Which row lands on the tapped tile. Bottom row by default, so ordinary
  // builds sit on the ground exactly as before. A build with a basement sets
  // this to its ground-floor slab, and everything after that row is dug in
  // below — otherwise a dungeon would push the whole castle into the sky.
  const anchorRow = (prefab.anchorRow != null && prefab.anchorRow >= 0 && prefab.anchorRow < h)
    ? prefab.anchorRow
    : h - 1;
  const y0 = ty - anchorRow;
  return { x0, y0, w, h };
}

/**
 * Place a prefab into the world at the given anchor point.
 * Returns { ok, placed, undo, reason }.
 * - ok: true iff placement succeeded
 * - placed: array of { x, y, id } for placed tiles (only if ok)
 * - undo: array of { x, y, id } capturing PREVIOUS tile (for undoability)
 * - reason: child-readable error message (only if !ok)
 */
/**
 * The ground level a build should stand on, taken across its whole footprint
 * rather than at the single tapped column.
 *
 * A 45-wide castle dropped on the exact tile you touched will bury one end and
 * leave the other in the air the moment the land is not perfectly flat. The
 * median of the terrain under the footprint puts it on the ground instead, so
 * "where I tapped" and "where it appeared" agree.
 */
export function groundLevelUnder(world, x0, w) {
  if (!world.surface) return null;
  const heights = [];
  for (let i = 0; i < w; i++) {
    const s = world.surface[wrapX(x0 + i)];
    if (s != null) heights.push(s);
  }
  if (!heights.length) return null;
  heights.sort((a, b) => a - b);
  return heights[heights.length >> 1];
}

export function placePrefab(world, prefab, tx, ty) {
  if (!prefab || !prefab.rows || !prefab.legend) {
    return { ok: false, reason: 'Invalid prefab' };
  }

  // Settle the build onto the ground under it unless it opts out (a bridge is
  // meant to span a gap, not sit in one). Tapping high in the sky is still
  // honoured — that is a deliberate choice, not a mis-tap.
  if (prefab.snapToGround !== false) {
    const rows0 = prefab.rows || [];
    const wGuess = rows0[0] ? rows0[0].length : 0;
    const ground = groundLevelUnder(world, tx - Math.floor(wGuess / 2), wGuess);
    if (ground != null && Math.abs(ty - ground) <= SNAP_RANGE) ty = ground - 1;
  }

  const bounds = prefabBounds(prefab, tx, ty);
  const { x0, y0, w, h } = bounds;

  // Validate vertical bounds: never write above SKY_LIMIT or at/below bedrock
  if (y0 < SKY_LIMIT || y0 + h > WORLD_H - 1) {
    return { ok: false, reason: 'Too close to sky or bedrock' };
  }

  // Collect all tiles to write: check bedrock, build undo array
  const toWrite = [];
  const undoArray = [];

  for (let row = 0; row < h; row++) {
    const rowStr = prefab.rows[row];
    if (!rowStr) continue;
    for (let col = 0; col < rowStr.length; col++) {
      const char = rowStr[col];
      const wx = wrapX(x0 + col);
      const wy = y0 + row;

      // Space = leave existing tile; don't write
      if (char === ' ') {
        continue;
      }

      // Dot = force to AIR
      let blockId = BLOCK.AIR;
      if (char !== '.') {
        blockId = prefab.legend[char];
        if (blockId == null) {
          return { ok: false, reason: 'Invalid pattern in prefab' };
        }
      }

      // Check existing tile: bedrock cannot be overwritten
      const existingId = getTile(world, wx, wy);
      if (existingId === BLOCK.BEDROCK && blockId !== BLOCK.BEDROCK) {
        // Bedrock exists and we're trying to write something else; skip this tile
        // but continue — some tiles may still place.
        // Actually, per the spec, if ANY bedrock is touched, the whole placement fails.
        // Let me re-read... "never overwrite a BLOCK.BEDROCK tile". Let me check the
        // setTile contract: it returns false if trying to write non-bedrock over bedrock.
        // The spec says "do not count it as placed" — so we just skip bedrock tiles.
        continue;
      }

      toWrite.push({ wx, wy, blockId });
      undoArray.push({ x: wx, y: wy, id: existingId });
    }
  }

  // If nothing would be written, fail
  if (toWrite.length === 0) {
    return { ok: false, reason: 'Cannot place here (bedrock blocking)' };
  }

  // Write all tiles. Use setTile which handles lighting and liquids.
  const placed = [];
  for (const { wx, wy, blockId } of toWrite) {
    const wrote = setTile(world, wx, wy, blockId);
    if (wrote) {
      placed.push({ x: wx, y: wy, id: blockId });
    }
  }

  // A prefab legend marks a door with a single cell, but a door is two tiles
  // tall. Grow each one upward so structures ship with doorways you can
  // actually walk through — unless the prefab already drew the upper half.
  for (const p of placed.slice()) {
    if (p.id !== BLOCK.DOOR) continue;
    if (getTile(world, p.x, p.y - 1) === BLOCK.DOOR_TOP) continue;
    // Record the previous tile first — an undo that misses this cell would
    // leave a door top floating with nothing under it.
    const wasAbove = getTile(world, p.x, p.y - 1);
    if (setTile(world, p.x, p.y - 1, BLOCK.DOOR_TOP)) {
      undoArray.push({ x: p.x, y: p.y - 1, id: wasAbove });
      placed.push({ x: p.x, y: p.y - 1, id: BLOCK.DOOR_TOP });
    }
  }

  if (placed.length === 0) {
    return { ok: false, reason: 'Could not place structure' };
  }

  // Pack dirt under the base so a build straddling a slope does not stand on
  // stilts. Capped, so it fills a dip rather than plugging a whole cavern.
  for (let i = 0; i < w; i++) {
    const wx = wrapX(x0 + i);
    for (let d = 0; d < BACKFILL_DEPTH; d++) {
      const wy = y0 + h + d;
      if (wy >= WORLD_H - 1) break;
      if (getTile(world, wx, wy) !== BLOCK.AIR) break;
      const was = getTile(world, wx, wy);
      if (setTile(world, wx, wy, BLOCK.DIRT)) {
        undoArray.push({ x: wx, y: wy, id: was });
        placed.push({ x: wx, y: wy, id: BLOCK.DIRT });
      }
    }
  }

  // Flush light for the entire footprint
  flushLight(world);

  return {
    ok: true,
    placed,
    undo: undoArray.slice(0, placed.length), // trim to match placed count
    bounds,
    reason: null,
  };
}

/**
 * Restore a prefab placement using the undo array.
 * The undo array is { x, y, id }[] from placePrefab.
 */
export function undoPrefab(world, undoArray) {
  if (!undoArray || !Array.isArray(undoArray)) return;
  // Reverse order to undo stacked changes correctly
  for (let i = undoArray.length - 1; i >= 0; i--) {
    const { x, y, id } = undoArray[i];
    setTile(world, x, y, id, { silent: false });
  }
  flushLight(world);
}
