/**
 * Kids-mode command queue (Blockheads-style):
 *  - Tap empty space  → walk there
 *  - Tap a solid block → stage dig (character walks over and mines it)
 *  - Tap with a block selected → stage place (walks in range and builds)
 *  - Tap same staged tile again → cancel that order
 *
 * Queue is FIFO; character auto-walks, auto-jumps, then acts when in range.
 */
import { isSolid, isClimbable, wrapDeltaX, wrapX, getTile } from '../world/index.js';
import { BLOCK, BLOCK_META } from '../content/blocks.js';
import { REACH } from '../core/constants.js';

/** Clear when this close to a pure go-target (tiles). */
const ARRIVE_GO = 0.5;
/** Close enough to start mining / placing. */
const ARRIVE_ACT = Math.min(REACH - 0.35, 3.4);
/** Clear stuck orders after this long (seconds). */
const STUCK_SEC = 3.2;
/** Max staged orders so a 4-year-old can't infinite-queue. */
const MAX_QUEUE = 24;

/**
 * @typedef {'go'|'mine'|'place'|'use'} KidsActionKind
 * @typedef {{ kind: KidsActionKind, tx: number, ty: number, x: number, y: number, blockId?: number|string, id?: string }} KidsAction
 */

export function ensureKidsQueue(input) {
  if (!input.kidsQueue) input.kidsQueue = [];
  return input.kidsQueue;
}

export function clearKidsQueue(input) {
  input.kidsQueue = [];
  input.moveTarget = null;
  input._navStuckT = 0;
  input._navLastX = null;
  input._navLastY = null;
  input.mineTx = null;
  input.mineTy = null;
}

export function clearMoveTarget(input) {
  // Legacy helper — clears walk intent but keeps staged dig/build
  input.moveTarget = null;
  input._navStuckT = 0;
  // Drop only pure "go" orders at the front
  const q = ensureKidsQueue(input);
  while (q.length && q[0].kind === 'go') q.shift();
}

function actionKey(kind, tx, ty) {
  return kind + ':' + wrapX(tx) + ',' + (ty | 0);
}

function makeAction(kind, tx, ty, extra) {
  tx = wrapX(Math.floor(tx));
  ty = Math.floor(ty);
  return Object.assign({
    kind,
    tx,
    ty,
    x: tx + 0.5,
    y: ty + 0.5,
    id: actionKey(kind, tx, ty),
  }, extra || {});
}

/** Find index of same kind+tile (for toggle cancel). */
function findQueued(q, kind, tx, ty) {
  const id = actionKey(kind, tx, ty);
  for (let i = 0; i < q.length; i++) {
    if (q[i].id === id) return i;
  }
  // Also match any action on that tile
  tx = wrapX(Math.floor(tx));
  ty = Math.floor(ty);
  for (let i = 0; i < q.length; i++) {
    if (q[i].tx === tx && q[i].ty === ty) return i;
  }
  return -1;
}

/**
 * Stage or toggle a walk-to order.
 * @returns {'set'|'cancel'|'full'}
 */
export function setMoveTarget(input, tx, ty) {
  const q = ensureKidsQueue(input);
  const act = makeAction('go', tx, ty);
  // Tap same go cell again → cancel only that go (or clear go orders)
  const idx = findQueued(q, 'go', tx, ty);
  if (idx >= 0) {
    q.splice(idx, 1);
    syncMoveTargetFromQueue(input);
    return 'cancel';
  }
  // Replace existing pure-go orders (one walk destination at a time)
  for (let i = q.length - 1; i >= 0; i--) {
    if (q[i].kind === 'go') q.splice(i, 1);
  }
  if (q.length >= MAX_QUEUE) return 'full';
  // Walk is highest priority when freshly tapped — put at front
  q.unshift(act);
  input._navStuckT = 0;
  input._navLastX = null;
  input._navLastY = null;
  input.camUserPanned = false;
  syncMoveTargetFromQueue(input);
  return 'set';
}

/**
 * Stage dig on a solid tile (toggle off if already staged).
 * @returns {'set'|'cancel'|'invalid'|'full'}
 */
export function queueMine(input, world, tx, ty) {
  tx = Math.floor(tx);
  ty = Math.floor(ty);
  const id = getTile(world, tx, ty);
  const meta = BLOCK_META[id];
  if (!meta || meta.mine <= 0 || id === BLOCK.AIR || meta.mine >= 50) {
    // Not mineable — treat as walk-to
    return setMoveTarget(input, tx, ty);
  }
  const q = ensureKidsQueue(input);
  const idx = findQueued(q, 'mine', tx, ty);
  if (idx >= 0) {
    q.splice(idx, 1);
    syncMoveTargetFromQueue(input);
    return 'cancel';
  }
  if (q.length >= MAX_QUEUE) return 'full';
  q.push(makeAction('mine', tx, ty));
  input._navStuckT = 0;
  input.camUserPanned = false;
  syncMoveTargetFromQueue(input);
  return 'set';
}

/**
 * Stage place at tile with a specific block id (toggle cancel).
 * @returns {'set'|'cancel'|'full'}
 */
export function queuePlace(input, tx, ty, blockId) {
  const q = ensureKidsQueue(input);
  const idx = findQueued(q, 'place', tx, ty);
  if (idx >= 0) {
    q.splice(idx, 1);
    syncMoveTargetFromQueue(input);
    return 'cancel';
  }
  if (q.length >= MAX_QUEUE) return 'full';
  q.push(makeAction('place', tx, ty, { blockId }));
  input._navStuckT = 0;
  input.camUserPanned = false;
  syncMoveTargetFromQueue(input);
  return 'set';
}

/**
 * Stage interact (door/chest) — walk up and use.
 */
export function queueUse(input, tx, ty) {
  const q = ensureKidsQueue(input);
  const idx = findQueued(q, 'use', tx, ty);
  if (idx >= 0) {
    q.splice(idx, 1);
    syncMoveTargetFromQueue(input);
    return 'cancel';
  }
  if (q.length >= MAX_QUEUE) return 'full';
  q.push(makeAction('use', tx, ty));
  input._navStuckT = 0;
  input.camUserPanned = false;
  syncMoveTargetFromQueue(input);
  return 'set';
}

function syncMoveTargetFromQueue(input) {
  const q = ensureKidsQueue(input);
  if (!q.length) {
    input.moveTarget = null;
    return;
  }
  const a = q[0];
  input.moveTarget = { x: a.x, y: a.y, kind: a.kind };
}

/**
 * Approach stand position for mine/place: stand beside the tile, not inside it.
 */
function approachPoint(player, action) {
  if (action.kind === 'go') {
    return { x: action.x, y: action.y };
  }
  // Prefer standing on the side closer to the player
  const dx = wrapDeltaX(player.x, action.x);
  const side = dx >= 0 ? -0.85 : 0.85; // stand left if target is to the right
  return {
    x: action.x + side,
    y: action.y + 0.5,
  };
}

function distToAction(player, action) {
  return Math.hypot(
    wrapDeltaX(player.x, action.x),
    (player.y - player.h * 0.45) - action.y
  );
}

function inActRange(player, action) {
  return distToAction(player, action) <= ARRIVE_ACT;
}

/**
 * Per-frame: steer + set mineTx when digging, return events for place/use completion.
 * @returns {{ placed?: {tx,ty,blockId}, used?: {tx,ty}, minedDone?: boolean, toast?: string }}
 */
export function applyKidsNav(player, world, input, dt) {
  const q = ensureKidsQueue(input);
  const out = {};

  // Manual control cancels the whole queue
  if (input.left || input.right || input.up || input.down
      || Math.abs(input.stickX) > 0.25 || Math.abs(input.stickY) > 0.25) {
    if (q.length) clearKidsQueue(input);
    return out;
  }

  // Drop invalid front actions
  while (q.length) {
    const a = q[0];
    if (a.kind === 'mine') {
      const id = getTile(world, a.tx, a.ty);
      const meta = BLOCK_META[id];
      if (!meta || meta.mine <= 0 || id === BLOCK.AIR || meta.mine >= 50) {
        q.shift();
        continue;
      }
    }
    if (a.kind === 'place') {
      // Still valid if air/water or attachable solid face — tryPlace decides later
      if (a.blockId == null) {
        q.shift();
        continue;
      }
    }
    break;
  }

  if (!q.length) {
    input.moveTarget = null;
    // Don't clear player-held mine unless we own it
    if (input._kidsMining) {
      input.mineTx = null;
      input.mineTy = null;
      input._kidsMining = false;
    }
    return out;
  }

  const action = q[0];
  const approach = approachPoint(player, action);
  input.moveTarget = { x: approach.x, y: approach.y, kind: action.kind };

  // Stuck detection
  if (input._navLastX != null) {
    const moved = Math.hypot(wrapDeltaX(input._navLastX, player.x), player.y - input._navLastY);
    if (moved < 0.035) input._navStuckT = (input._navStuckT || 0) + dt;
    else input._navStuckT = 0;
  }
  input._navLastX = player.x;
  input._navLastY = player.y;
  if ((input._navStuckT || 0) > STUCK_SEC) {
    q.shift();
    input._navStuckT = 0;
    out.toast = 'Couldn’t reach — try another spot';
    syncMoveTargetFromQueue(input);
    if (input._kidsMining) {
      input.mineTx = null;
      input.mineTy = null;
      input._kidsMining = false;
    }
    return out;
  }

  const dx = wrapDeltaX(player.x, approach.x);
  const bodyY = player.y - player.h * 0.45;
  const dy = approach.y - bodyY;
  const distApproach = Math.hypot(dx, dy);
  const closeEnough = action.kind === 'go'
    ? distApproach < ARRIVE_GO
    : inActRange(player, action);

  // Steer when not yet in range
  if (!closeEnough) {
    if (input._kidsMining) {
      input.mineTx = null;
      input.mineTy = null;
      input._kidsMining = false;
    }
    if (Math.abs(dx) > 0.18) {
      if (dx > 0) input.right = true;
      else input.left = true;
    }
    // Creative fly: free vertical toward the job
    if (player.flying || player.canFly) {
      if (!player.flying && player.canFly && Math.abs(dy) > 1.2) {
        // Auto-engage fly when a job is high above / deep below
        player.flying = true;
        player.vy = 0;
      }
      if (player.flying) {
        if (dy < -0.25) {
          input.up = true;
          input.jump = true;
          input._touchFlyUp = true;
        } else if (dy > 0.25) {
          input.down = true;
          input._touchFlyDown = true;
        }
      } else {
        steerClimbAndJump(player, world, input, dx, dy, approach);
      }
    } else {
      steerClimbAndJump(player, world, input, dx, dy, approach);
    }
    return out;
  }

  // —— In range: perform action ——
  if (action.kind === 'go') {
    q.shift();
    input._navStuckT = 0;
    syncMoveTargetFromQueue(input);
    return out;
  }

  if (action.kind === 'mine') {
    // Keep mining until tile is gone (updatePlayer does the dig)
    input.mineTx = action.tx;
    input.mineTy = action.ty;
    input._kidsMining = true;
    // Face the block
    const aimDx = wrapDeltaX(player.x, action.x);
    if (Math.abs(aimDx) > 0.1) player.facing = aimDx > 0 ? 1 : -1;
    // Stop horizontal drift while digging
    input.left = false;
    input.right = false;
    // If already air, complete
    const id = getTile(world, action.tx, action.ty);
    if (id === BLOCK.AIR || id === BLOCK.WATER) {
      q.shift();
      input.mineTx = null;
      input.mineTy = null;
      input._kidsMining = false;
      input._navStuckT = 0;
      syncMoveTargetFromQueue(input);
      out.minedDone = true;
    }
    return out;
  }

  if (action.kind === 'place') {
    out.placed = { tx: action.tx, ty: action.ty, blockId: action.blockId };
    q.shift();
    input._navStuckT = 0;
    syncMoveTargetFromQueue(input);
    return out;
  }

  if (action.kind === 'use') {
    out.used = { tx: action.tx, ty: action.ty };
    q.shift();
    input._navStuckT = 0;
    syncMoveTargetFromQueue(input);
    return out;
  }

  return out;
}

function steerClimbAndJump(player, world, input, dx, dy, approach) {
  const onLadder = isClimbable(world, Math.floor(player.x), Math.floor(player.y - 0.5))
    || isClimbable(world, Math.floor(player.x), Math.floor(player.y - 1.1));

  if (onLadder && Math.abs(dy) > 0.25) {
    if (dy < -0.15) input.up = true;
    else if (dy > 0.15) input.down = true;
  }

  const dir = Math.abs(dx) > 0.12 ? Math.sign(dx) : (player.facing || 1);
  const ax = Math.floor(player.x + dir * 0.55);
  const footY = Math.floor(player.y - 0.02);
  const midY = Math.floor(player.y - player.h * 0.5);

  const wallAtFeet = isSolid(world, ax, footY - 1) || isSolid(world, ax, midY);
  const headClear = !isSolid(world, ax, footY - 2) && !isSolid(world, ax, footY - 3);
  const stepUp = wallAtFeet && headClear;
  const wantHigher = dy < -0.9 && Math.abs(dx) < 2.2;
  const gapAhead = !isSolid(world, ax, footY) && !isSolid(world, ax, footY + 1)
    && isSolid(world, ax + dir, footY);

  if (player.onGround && (stepUp || wantHigher || gapAhead)) {
    input.jump = true;
  }

  if (wantHigher && !onLadder) {
    for (let dyL = -2; dyL <= 1; dyL++) {
      for (let dxL = -1; dxL <= 1; dxL++) {
        const lx = Math.floor(player.x) + dxL;
        const ly = Math.floor(player.y) + dyL;
        if (getTile(world, lx, ly) === BLOCK.LADDER || isClimbable(world, lx, ly)) {
          const ldx = wrapDeltaX(player.x, lx + 0.5);
          if (Math.abs(ldx) > 0.15) {
            input.left = ldx < 0;
            input.right = ldx > 0;
          }
          if (dyL < 0) input.up = true;
          return;
        }
      }
    }
  }
}

/** Snapshot for renderer: list of staged markers. */
export function kidsQueueMarkers(input) {
  return ensureKidsQueue(input).slice();
}
