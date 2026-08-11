import {
  WORLD_H, SKY_LIMIT, MAGMA_Y, GRAVITY, MOVE_SPEED, JUMP_VEL, MAX_FALL,
  COYOTE, JUMP_BUFFER, REACH, TILE,
} from '../core/constants.js';
import { WORLD_W } from '../core/worldSize.js';
import { BLOCK, BLOCK_META, isPlatform, isBlockItem } from '../content/blocks.js';
import {
  getTile, setTile, isSolid, isClimbable, wrapX, wrapDeltaX,
} from '../world/index.js';

export function makePlayer(spawnTileX, spawnTileY) {
  return {
    // Continuous world coords in tiles (x wraps conceptually via camera)
    x: spawnTileX + 0.5,
    y: spawnTileY - 0.01,
    vx: 0,
    vy: 0,
    w: 0.55,
    h: 1.55,
    facing: 1,
    onGround: false,
    coyote: 0,
    jumpBuf: 0,
    hp: 100,
    maxHp: 100,
    energy: 100,
    maxEnergy: 100,
    hunger: 100,
    maxHunger: 100,
    invuln: 0,
    anim: 0,
    mining: null, // { tx, ty, progress, need }
    placeCooldown: 0,
    fallVy: 0,
    fallDist: 0, // tiles fallen this airtime
    inBoat: false,
    spawnX: null,
    spawnY: null,
    /** Melee swing 0 = idle, >0 animating */
    attackT: 0,
    attackCd: 0,
    attackHit: false, // already applied damage this swing
    /** Set by survival each frame from difficulty + hunger */
    canSprint: true,
    sprinting: false,
    /** Creative / invincible flag (set from session difficulty) */
    godMode: false,
  };
}

export function playerAABB(p) {
  return {
    left: p.x - p.w / 2,
    right: p.x + p.w / 2,
    top: p.y - p.h,
    bottom: p.y,
  };
}

/**
 * Integrate platformer movement with wrapping tile collision.
 * @returns {{ mined: null|{tx,ty,id}, hurt: number }}
 */
export function updatePlayer(p, world, input, dt, toolPower) {
  const result = { mined: null, hurt: 0, placed: false };

  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
  if (p.placeCooldown > 0) p.placeCooldown = Math.max(0, p.placeCooldown - dt);
  if (p.attackCd > 0) p.attackCd = Math.max(0, p.attackCd - dt);
  if (p.attackT > 0) p.attackT = Math.max(0, p.attackT - dt);

  // Horizontal intent
  let ix = 0;
  if (input.left) ix -= 1;
  if (input.right) ix += 1;
  if (Math.abs(input.stickX) > 0.2) ix = Math.sign(input.stickX);

  const onLadder = isClimbable(world, Math.floor(p.x), Math.floor(p.y - 0.5));
  const wantClimb = onLadder && (input.up || input.down || Math.abs(input.stickY) > 0.3);

  // Sprint: Shift / stick full deflection when canSprint
  const stickMag = Math.hypot(input.stickX || 0, input.stickY || 0);
  const wantSprint = !!(input.sprint || stickMag > 0.88) && ix !== 0 && p.canSprint !== false
    && (p.energy == null || p.energy >= 12);
  p.sprinting = wantSprint;
  const speedMul = wantSprint ? 1.48 : 1;
  const targetVx = ix * (MOVE_SPEED * speedMul) / TILE; // tiles/sec
  const accel = p.onGround ? 40 : 22;
  if (Math.abs(targetVx - p.vx) < accel * dt) p.vx = targetVx;
  else p.vx += Math.sign(targetVx - p.vx) * accel * dt;

  if (ix > 0.1) p.facing = 1;
  else if (ix < -0.1) p.facing = -1;

  if (input.jump) p.jumpBuf = JUMP_BUFFER;
  else p.jumpBuf = Math.max(0, p.jumpBuf - dt);

  if (wantClimb) {
    p.vy = 0;
    let iy = 0;
    if (input.up || input.stickY < -0.3) iy = -1;
    if (input.down || input.stickY > 0.3) iy = 1;
    p.vy = iy * (MOVE_SPEED * 0.7) / TILE;
    if (p.jumpBuf > 0 && !input.down) {
      p.vy = JUMP_VEL / TILE;
      p.jumpBuf = 0;
      p.onGround = false;
    }
  } else {
    p.vy += (GRAVITY / TILE) * dt;
    if (p.vy > MAX_FALL / TILE) p.vy = MAX_FALL / TILE;

    if (p.onGround) p.coyote = COYOTE;
    else p.coyote = Math.max(0, p.coyote - dt);

    if (p.jumpBuf > 0 && p.coyote > 0) {
      p.vy = JUMP_VEL / TILE;
      p.jumpBuf = 0;
      p.coyote = 0;
      p.onGround = false;
    }
  }

  // Move X with collision
  p.x += p.vx * dt;
  // Keep x in a comfortable numeric range while preserving wrap equivalence
  if (p.x < 0) p.x += WORLD_W;
  if (p.x >= WORLD_W) p.x -= WORLD_W;
  resolveAxis(p, world, 'x');

  // Move Y — track peak fall speed and distance for damage
  if (p.vy > 0) {
    if (p.vy > p.fallVy) p.fallVy = p.vy;
    p.fallDist = (p.fallDist || 0) + p.vy * dt;
  }
  p.y += p.vy * dt;
  const wasGround = p.onGround;
  p.onGround = false;
  resolveAxis(p, world, 'y');
  // Fall damage only after a real drop (~4+ tiles). 1–3 block hops are free.
  if (p.onGround && !wasGround) {
    const dist = p.fallDist || 0;
    const safeDist = 3.75; // tiles free-fall before hurt
    if (!p.godMode && dist > safeDist && p.invuln <= 0) {
      const dmg = Math.floor((dist - safeDist) * 5);
      if (dmg > 0) {
        p.hp -= Math.min(40, dmg); // cap single hits
        p.invuln = 0.55;
        result.hurt = dmg;
        result.fall = true;
      }
    }
    p.fallVy = 0;
    p.fallDist = 0;
  }
  if (p.onGround) {
    p.fallVy = 0;
    p.fallDist = 0;
  }

  // Sky limit — soft clamp
  if (p.y - p.h < SKY_LIMIT) {
    p.y = SKY_LIMIT + p.h;
    if (p.vy < 0) p.vy = 0;
  }
  // Magma / bottom
  if (p.y > WORLD_H - 1.2) {
    p.y = WORLD_H - 1.2;
    p.vy = Math.min(0, p.vy);
  }

  // Hazards
  const feet = getTile(world, Math.floor(p.x), Math.floor(p.y - 0.05));
  const body = getTile(world, Math.floor(p.x), Math.floor(p.y - p.h * 0.5));
  if ((BLOCK_META[feet] && BLOCK_META[feet].hazard) || (BLOCK_META[body] && BLOCK_META[body].hazard)) {
    if (!p.godMode && p.invuln <= 0) {
      p.hp -= 18;
      p.invuln = 0.8;
      p.vy = JUMP_VEL / TILE * 0.6;
      result.hurt = 18;
    }
  }

  // Water / boat
  if (p.inBoat) {
    // Fast horizontal on water, no fall through
    const targetBoat = ix * (MOVE_SPEED * 1.35) / TILE;
    p.vx += (targetBoat - p.vx) * Math.min(1, dt * 6);
    p.vy = Math.min(p.vy, 1.2);
    if (feet !== BLOCK.WATER && body !== BLOCK.WATER) {
      // Beached
      p.vy = 0;
      if (p.onGround) p.inBoat = false; // leave boat on shore — recovered in game loop
    }
    if (input.jump || input.up) p.vy = -2.5;
  } else if (feet === BLOCK.WATER || body === BLOCK.WATER) {
    p.vx *= 0.92;
    if (p.vy > 1.5) p.vy *= 0.85;
    if (input.jump || input.up) p.vy = Math.min(p.vy, -2.2);
  }

  // Mining (creative: near-instant break)
  if (input.mineTx != null && input.mineTy != null) {
    const tx = input.mineTx;
    const ty = input.mineTy;
    const dist = Math.hypot(wrapDeltaX(p.x, tx + 0.5), (p.y - p.h * 0.5) - (ty + 0.5));
    if (dist <= REACH) {
      const id = getTile(world, tx, ty);
      const meta = BLOCK_META[id];
      // Creative can break almost anything except bedrock/magma
      const mineable = meta && meta.mine > 0 && id !== BLOCK.AIR
        && (p.godMode ? meta.mine < 99 : meta.mine < 50);
      if (mineable) {
        const need = p.godMode
          ? 0.05
          : meta.mine / Math.max(0.5, toolPower);
        if (!p.mining || p.mining.tx !== wrapX(tx) || p.mining.ty !== ty) {
          p.mining = { tx: wrapX(tx), ty, progress: 0, need };
        }
        p.mining.progress += dt;
        if (p.mining.progress >= p.mining.need) {
          const drop = meta.drops;
          setTile(world, tx, ty, BLOCK.AIR);
          result.mined = { tx: wrapX(tx), ty, id, drop };
          p.mining = null;
        }
      } else {
        p.mining = null;
      }
    } else {
      p.mining = null;
    }
  } else {
    p.mining = null;
  }

  // Energy drain slowly while moving (creative keeps full energy)
  if (!p.godMode) {
    const moving = Math.abs(p.vx) > 0.1 || Math.abs(p.vy) > 0.5;
    if (moving) p.energy = Math.max(0, p.energy - dt * (p.sprinting ? 2.4 : 1.2));
    else p.energy = Math.min(p.maxEnergy, p.energy + dt * 4);
  } else {
    p.energy = p.maxEnergy;
  }

  // Faster anim when moving so walk cycle reads clearly
  p.anim += dt * (p.onGround && Math.abs(p.vx) > 0.25 ? 14 : 5);
  return result;
}

export function resolveAxis(p, world, axis) {
  const box = playerAABB(p);
  const minTX = Math.floor(box.left);
  const maxTX = Math.floor(box.right);
  const minTY = Math.floor(box.top);
  const maxTY = Math.floor(box.bottom - 0.001);

  for (let ty = minTY; ty <= maxTY; ty++) {
    for (let txi = minTX; txi <= maxTX; txi++) {
      const tx = txi;
      const tid = getTile(world, tx, ty);
      const isPlat = isPlatform(tid);
      if (!isSolid(world, tx, ty) && !isPlat) continue;

      const rel = nearestTileX(p.x, tx);
      const tl = rel;
      const tr = rel + 1;
      const tt = ty;
      const tb = ty + 1;

      if (box.right <= tl || box.left >= tr || box.bottom <= tt || box.top >= tb) continue;

      // One-way platforms: only collide when falling onto top
      if (isPlat) {
        if (axis !== 'y') continue;
        if (p.vy < 0) continue; // jumping up through
        if (box.bottom - p.vy * 0.02 > tt + 0.35) continue; // already deep inside
        // only land on top surface
        const overlapT = box.bottom - tt;
        if (overlapT > 0 && overlapT < 0.55 && p.vy >= 0) {
          p.y -= overlapT;
          p.vy = 0;
          p.onGround = true;
          const b2 = playerAABB(p);
          box.left = b2.left; box.right = b2.right; box.top = b2.top; box.bottom = b2.bottom;
        }
        continue;
      }

      if (axis === 'x') {
        const overlapL = box.right - tl;
        const overlapR = tr - box.left;
        if (overlapL < overlapR) {
          p.x -= overlapL;
          p.vx = Math.min(0, p.vx);
        } else {
          p.x += overlapR;
          p.vx = Math.max(0, p.vx);
        }
      } else {
        const overlapT = box.bottom - tt;
        const overlapB = tb - box.top;
        if (overlapT < overlapB) {
          p.y -= overlapT;
          p.vy = Math.min(0, p.vy);
          p.onGround = true;
        } else {
          p.y += overlapB;
          p.vy = Math.max(0, p.vy);
        }
      }
      const b2 = playerAABB(p);
      box.left = b2.left;
      box.right = b2.right;
      box.top = b2.top;
      box.bottom = b2.bottom;
    }
  }
}

/** Tile world-x as continuous coordinate nearest to playerX. */
export function nearestTileX(playerX, tileX) {
  const base = wrapX(tileX);
  // candidates: base + k*WORLD_W
  let best = base;
  let bestD = Infinity;
  for (let k = -1; k <= 1; k++) {
    const c = base + k * WORLD_W;
    // compare center
    const d = Math.abs((c + 0.5) - playerX);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  // Also handle player near 0 with tile near WORLD_W
  const c2 = base - WORLD_W;
  if (Math.abs((c2 + 0.5) - playerX) < bestD) best = c2;
  const c3 = base + WORLD_W;
  if (Math.abs((c3 + 0.5) - playerX) < bestD) best = c3;
  return best;
}

/**
 * When the player taps a solid block with an attachable item (torch, ladder, campfire),
 * place into the adjacent empty cell on the face toward the player.
 * @returns {{tx:number,ty:number}|null}
 */
export function adjacentPlaceCell(p, world, solidTx, solidTy) {
  const scx = nearestTileX(p.x, solidTx) + 0.5;
  const scy = solidTy + 0.5;
  const pcy = p.y - p.h * 0.5;
  const dx = p.x - scx;
  const dy = pcy - scy;

  // Prefer dominant axis (face the player is looking at), then other sides
  const order = Math.abs(dx) >= Math.abs(dy)
    ? [
        { tx: solidTx + (dx >= 0 ? 1 : -1), ty: solidTy },
        { tx: solidTx, ty: solidTy + (dy >= 0 ? 1 : -1) },
        { tx: solidTx, ty: solidTy + (dy >= 0 ? -1 : 1) },
        { tx: solidTx + (dx >= 0 ? -1 : 1), ty: solidTy },
      ]
    : [
        { tx: solidTx, ty: solidTy + (dy >= 0 ? 1 : -1) },
        { tx: solidTx + (dx >= 0 ? 1 : -1), ty: solidTy },
        { tx: solidTx + (dx >= 0 ? -1 : 1), ty: solidTy },
        { tx: solidTx, ty: solidTy + (dy >= 0 ? -1 : 1) },
      ];

  for (const c of order) {
    if (c.ty < SKY_LIMIT || c.ty >= MAGMA_Y) continue;
    const t = getTile(world, c.tx, c.ty);
    if (t !== BLOCK.AIR && t !== BLOCK.WATER) continue;
    const dist = Math.hypot(wrapDeltaX(p.x, c.tx + 0.5), pcy - (c.ty + 0.5));
    if (dist > REACH) continue;
    return c;
  }
  return null;
}

/** Non-solid attachables: tap a solid face to place against it (torch, ladder, campfire). */
export function isAttachableBlock(blockId) {
  const meta = BLOCK_META[blockId];
  if (!meta || meta.solid) return false;
  return !!(meta.light || meta.climb || blockId === BLOCK.CAMPFIRE);
}

/**
 * Try to place a block. On success returns { tx, ty } of the cell written.
 * Tap solid wall with torch/ladder/campfire → places on the face toward the player.
 */
export function tryPlace(p, world, tx, ty, blockId) {
  if (p.placeCooldown > 0) return false;
  if (!isBlockItem(blockId)) return false;
  if (blockId === BLOCK.LAVA || blockId === BLOCK.BEDROCK || blockId === BLOCK.WATER) return false;
  ty = Math.floor(ty);
  tx = Math.floor(tx);
  if (ty < SKY_LIMIT || ty >= MAGMA_Y) return false;

  const meta = BLOCK_META[blockId];
  let placeTx = tx;
  let placeTy = ty;
  let cur = getTile(world, placeTx, placeTy);

  // Tap solid/occupied: attachables go on the face toward the player
  if (cur !== BLOCK.AIR && cur !== BLOCK.WATER) {
    if (!isAttachableBlock(blockId)) return false;
    const adj = adjacentPlaceCell(p, world, placeTx, placeTy);
    if (!adj) return false;
    placeTx = adj.tx;
    placeTy = adj.ty;
    cur = getTile(world, placeTx, placeTy);
  }

  if (cur !== BLOCK.AIR && cur !== BLOCK.WATER) return false;

  const dist = Math.hypot(wrapDeltaX(p.x, placeTx + 0.5), (p.y - p.h * 0.5) - (placeTy + 0.5));
  if (dist > REACH) return false;

  // Don't place inside the player
  const rel = nearestTileX(p.x, placeTx);
  const box = playerAABB(p);
  if (box.right > rel && box.left < rel + 1 && box.bottom > placeTy && box.top < placeTy + 1) return false;

  // Full blocks need a neighbor; attachables need support too (no floating mid-air torches)
  const skipSupport = meta && meta.platform;
  if (!skipSupport) {
    const hasSupport =
      isSolid(world, placeTx - 1, placeTy) ||
      isSolid(world, placeTx + 1, placeTy) ||
      isSolid(world, placeTx, placeTy - 1) ||
      isSolid(world, placeTx, placeTy + 1) ||
      isPlatform(getTile(world, placeTx, placeTy + 1));
    if (!hasSupport) return false;
  }

  setTile(world, placeTx, placeTy, blockId);
  p.placeCooldown = 0.12;
  return { tx: wrapX(placeTx), ty: placeTy };
}

export function findSpawn(world, player) {
  if (player && player.spawnX != null && player.spawnY != null) {
    const sx = wrapX(player.spawnX);
    let sy = player.spawnY | 0;
    // Validate bed still nearby
    let ok = false;
    for (let dy = -2; dy <= 2 && !ok; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (getTile(world, sx + dx, sy + dy) === BLOCK.BED) ok = true;
      }
    }
    if (ok) {
      while (sy < WORLD_H - 1 && isSolid(world, sx, sy)) sy++;
      return { x: sx, y: sy };
    }
  }
  const sx = Math.floor(WORLD_W / 2);
  let sy = world.surface[sx];
  while (sy < WORLD_H - 1 && !isSolid(world, sx, sy + 1)) sy++;
  while (sy > SKY_LIMIT && isSolid(world, sx, sy)) sy--;
  return { x: sx, y: sy + 1 };
}
