'use strict';

function makePlayer(spawnTileX, spawnTileY) {
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
  };
}

function playerAABB(p) {
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
function updatePlayer(p, world, input, dt, toolPower) {
  const result = { mined: null, hurt: 0, placed: false };

  if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
  if (p.placeCooldown > 0) p.placeCooldown = Math.max(0, p.placeCooldown - dt);

  // Horizontal intent
  let ix = 0;
  if (input.left) ix -= 1;
  if (input.right) ix += 1;
  if (Math.abs(input.stickX) > 0.2) ix = Math.sign(input.stickX);

  const onLadder = isClimbable(world, Math.floor(p.x), Math.floor(p.y - 0.5));
  const wantClimb = onLadder && (input.up || input.down || Math.abs(input.stickY) > 0.3);

  const targetVx = ix * MOVE_SPEED / TILE; // tiles/sec
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
    if (dist > safeDist && p.invuln <= 0) {
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
    if (p.invuln <= 0) {
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

  // Mining
  if (input.mineTx != null && input.mineTy != null) {
    const tx = input.mineTx;
    const ty = input.mineTy;
    const dist = Math.hypot(wrapDeltaX(p.x, tx + 0.5), (p.y - p.h * 0.5) - (ty + 0.5));
    if (dist <= REACH) {
      const id = getTile(world, tx, ty);
      const meta = BLOCK_META[id];
      if (meta && meta.mine > 0 && meta.mine < 50 && id !== BLOCK.AIR) {
        const need = meta.mine / Math.max(0.5, toolPower);
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

  // Energy drain slowly while moving
  const moving = Math.abs(p.vx) > 0.1 || Math.abs(p.vy) > 0.5;
  if (moving) p.energy = Math.max(0, p.energy - dt * 1.2);
  else p.energy = Math.min(p.maxEnergy, p.energy + dt * 4);

  // Faster anim when moving so walk cycle reads clearly
  p.anim += dt * (p.onGround && Math.abs(p.vx) > 0.25 ? 14 : 5);
  return result;
}

function resolveAxis(p, world, axis) {
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
function nearestTileX(playerX, tileX) {
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

function tryPlace(p, world, tx, ty, blockId) {
  if (p.placeCooldown > 0) return false;
  if (!isBlockItem(blockId)) return false;
  if (blockId === BLOCK.LAVA || blockId === BLOCK.BEDROCK || blockId === BLOCK.WATER) return false;
  ty = Math.floor(ty);
  if (ty < SKY_LIMIT || ty >= MAGMA_Y) return false;
  const dist = Math.hypot(wrapDeltaX(p.x, tx + 0.5), (p.y - p.h * 0.5) - (ty + 0.5));
  if (dist > REACH) return false;
  const cur = getTile(world, tx, ty);
  if (cur !== BLOCK.AIR && cur !== BLOCK.WATER) return false;
  // Campfire/torch can sit in air with support; water bucket handled elsewhere
  const rel = nearestTileX(p.x, tx);
  const box = playerAABB(p);
  if (box.right > rel && box.left < rel + 1 && box.bottom > ty && box.top < ty + 1) return false;
  const meta = BLOCK_META[blockId];
  const needSupport = !(meta && (meta.light || meta.climb || meta.platform || blockId === BLOCK.CAMPFIRE));
  if (needSupport) {
    const adj =
      isSolid(world, tx - 1, ty) ||
      isSolid(world, tx + 1, ty) ||
      isSolid(world, tx, ty - 1) ||
      isSolid(world, tx, ty + 1) ||
      isPlatform(getTile(world, tx, ty + 1));
    if (!adj) return false;
  }
  setTile(world, tx, ty, blockId);
  p.placeCooldown = 0.12;
  return true;
}

function findSpawn(world, player) {
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
