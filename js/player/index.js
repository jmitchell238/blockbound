import {
  WORLD_H, SKY_LIMIT, MAGMA_Y, GRAVITY, MOVE_SPEED, JUMP_VEL, MAX_FALL,
  COYOTE, JUMP_BUFFER, REACH, TILE,
} from '../core/constants.js';
import { WORLD_W } from '../core/worldSize.js';
import { BLOCK, BLOCK_META, isPlatform, isWalkThrough, isBlockItem } from '../content/blocks.js';
import {
  getTile, setTile, isSolid, isClimbable, wrapX, wrapDeltaX,
} from '../world/index.js';
import { isShelteredAir } from '../world/shelter.js';

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
    /** Creative may fly (set from session) */
    canFly: false,
    /** Currently in fly mode (creative only) */
    flying: false,
    /** Double-tap jump window for fly toggle */
    _flyTapT: 0,
    /** Hold down to crouch (reduces height slightly, uses crouch sprite) */
    crouching: false,
  };
}

/**
 * Is the player walking into a single-block step they could hop onto?
 *
 * Deliberately stricter than steerClimbAndJump in systems/nav.js, which also
 * fires for two-tall walls and for "the target is above me". This one wants a
 * step exactly one tile high with two tiles of headroom, so it never triggers
 * against a wall the player could not clear anyway, and — because it needs a
 * horizontal intent — never while standing still or holding still under an
 * overhang.
 *
 * @param {number} ix horizontal intent, -1 / 0 / +1
 */
export function autoJumpStep(world, p, ix) {
  if (!ix) return false;
  const dir = Math.sign(ix);
  const ax = Math.floor(p.x + dir * 0.55);
  // p.y is the feet; the tile the body stands in is one above the ground.
  const footY = Math.floor(p.y - 0.02);
  // Furniture is walked through, not climbed — hopping onto every chest you
  // pass would be a twitchy mess.
  if (isWalkThrough(getTile(world, ax, footY))) return false;
  return isSolid(world, ax, footY)          // a step, exactly one tall...
    && !isSolid(world, ax, footY - 1)       // ...with room to stand on it...
    && !isSolid(world, ax, footY - 2);      // ...and room for their head.
}

/** Magma burn, hp/sec before difficulty scaling. Scaled by player.hazardMul. */
const LAVA_DPS = 8;
/** Terminal sink speed in magma, tiles/sec. Falling through air is much faster. */
const LAVA_SINK = 1.1;
/** Upward swim speed in magma. Slower than water (2.2) but enough to clear a ledge. */
const LAVA_SWIM = 2.0;

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

  // Creative fly toggle (set by session / double-tap JUMP / FLY button)
  if (!p.canFly) p.flying = false;
  if (input.flyToggle) {
    input.flyToggle = false;
    if (p.canFly) {
      p.flying = !p.flying;
      if (p.flying) {
        p.vy = 0;
        p.fallDist = 0;
        p.fallVy = 0;
        p.onGround = false;
      }
    }
  }

  // Horizontal intent
  let ix = 0;
  if (input.left) ix -= 1;
  if (input.right) ix += 1;
  if (Math.abs(input.stickX) > 0.2) ix = Math.sign(input.stickX);

  const onLadder = isClimbable(world, Math.floor(p.x), Math.floor(p.y - 0.5));
  const wantClimb = !p.flying && onLadder && (input.up || input.down || Math.abs(input.stickY) > 0.3);

  // Crouch: hold down while grounded (not climbing / flying)
  p.crouching = !!(!p.flying && p.onGround && !wantClimb
    && (input.down || (input.stickY != null && input.stickY > 0.55)));
  if (p.crouching) ix *= 0.45; // slow crawl

  // Sprint: Shift / stick full deflection when canSprint (not while crouching)
  const stickMag = Math.hypot(input.stickX || 0, input.stickY || 0);
  const wantSprint = !p.crouching && !!(input.sprint || stickMag > 0.88) && ix !== 0 && p.canSprint !== false
    && (p.energy == null || p.energy >= 12);
  p.sprinting = wantSprint && !p.flying;
  // Fly is a bit faster than walk; sprint-in-fly even faster
  const flyMul = p.flying ? (wantSprint || input.sprint ? 2.1 : 1.55) : 1;
  const speedMul = (p.sprinting ? 1.48 : 1) * flyMul;
  const targetVx = ix * (MOVE_SPEED * speedMul) / TILE; // tiles/sec
  const accel = p.flying ? 28 : (p.onGround ? 40 : 22);
  if (Math.abs(targetVx - p.vx) < accel * dt) p.vx = targetVx;
  else p.vx += Math.sign(targetVx - p.vx) * accel * dt;

  if (ix > 0.1) p.facing = 1;
  else if (ix < -0.1) p.facing = -1;

  // Auto-jump. Tap-to-walk has hopped steps since nav.js existed; driving
  // manually never did, so kids got stuck on single blocks the character
  // would have climbed on its own.
  const autoHop = p.autoJump !== false && !p.flying && !wantClimb && !p.crouching
    && p.onGround && autoJumpStep(world, p, ix);

  if (input.jump || autoHop) p.jumpBuf = JUMP_BUFFER;
  else p.jumpBuf = Math.max(0, p.jumpBuf - dt);

  if (p.flying) {
    // Free flight — no gravity. JUMP / W / stick-up = ascend, S / crouch / stick-down = descend
    let iy = 0;
    if (input.jump || input.up || input._touchFlyUp || (input.stickY != null && input.stickY < -0.28)) iy -= 1;
    if (input.down || input._touchFlyDown || (input.stickY != null && input.stickY > 0.28)) iy += 1;
    const flySpeed = (MOVE_SPEED * (input.sprint ? 1.9 : 1.35)) / TILE;
    const targetVy = iy * flySpeed;
    p.vy += (targetVy - p.vy) * Math.min(1, dt * 10);
    p.onGround = false;
    p.fallDist = 0;
    p.fallVy = 0;
    p.coyote = 0;
    p.jumpBuf = 0;
  } else if (wantClimb) {
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
    // Buoyancy. The swim stroke is applied at the end of a frame, so full
    // gravity at the start of the next one ate most of it before the player
    // actually moved — rising was under a tile per second and felt like the
    // stroke did nothing at all.
    const grav = p.swimming ? GRAVITY * 0.25 : GRAVITY;
    p.vy += (grav / TILE) * dt;
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
  if (!p.flying && p.vy > 0) {
    if (p.vy > p.fallVy) p.fallVy = p.vy;
    p.fallDist = (p.fallDist || 0) + p.vy * dt;
  }
  p.y += p.vy * dt;
  const wasGround = p.onGround;
  if (!p.flying) p.onGround = false;
  resolveAxis(p, world, 'y');

  // A player buried in solid rock cannot be resolved by overlap: every side is
  // blocked, and the smaller number happens to point down, so the collision
  // step pushed them a little deeper every frame until they reached the magma
  // at the bottom of the world. Flying into the ground is how you get buried;
  // stopping the flight is when the sinking starts. Lift them out instead.
  if (!p.flying && ejectFromSolid(p, world)) {
    p.fallDist = 0;
    p.fallVy = 0;
  }
  // Landing while flying: stay flying (hover) unless they toggled off
  if (p.flying) {
    p.onGround = false;
    p.fallVy = 0;
    p.fallDist = 0;
  } else if (p.onGround && !wasGround) {
    // Fall damage only after a real drop (~4+ tiles). 1–3 block hops are free.
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
  // The tile you are floating *on*. Bobbing at the surface of a magma pool
  // puts your feet exactly level with an adjacent ledge — a hair too low to
  // step onto, and too high to still count as submerged, so without this the
  // swim stroke cuts out at the surface and you can never climb out.
  const underfoot = getTile(world, Math.floor(p.x), Math.floor(p.y + 0.05));
  if ((BLOCK_META[feet] && BLOCK_META[feet].hazard) || (BLOCK_META[body] && BLOCK_META[body].hazard)) {
    // This branch was unreachable until magma stopped being solid: collision
    // always pushed the player out before it ran, so magma did nothing at all.
    // Waking it up needed two changes. The bounce is gone — it fought the
    // sinking magma is now supposed to allow, throwing the player up and down
    // instead of letting them swim. And 18 points every 0.8s made a four-deep
    // pool unsurvivable, so it burns continuously at a rate you can escape.
    if (!p.godMode) {
      const mul = p.hazardMul == null ? 1 : p.hazardMul;
      p.hp -= LAVA_DPS * mul * dt;
      // Block idle regen while burning. On Easy the burn is 2.8 hp/s and
      // survival regen is 3 hp/s, so standing still in magma healed faster
      // than it hurt and the player was simply immortal in it.
      p.burning = 0.75;
      p.burnFxT = (p.burnFxT || 0) - dt;
      if (mul > 0 && p.burnFxT <= 0) {
        p.burnFxT = 0.5;
        result.hurt = LAVA_DPS * mul * 0.5;
      }
    }
  }

  // Water / boat
  // Swim state for the renderer. Wading through a shallow puddle with your
  // feet wet is not swimming — that needs the chest under, or your feet under
  // with no ground beneath you. Kept separate from the physics branches below
  // because those also fire while standing in ankle-deep water.
  p.swimming = 0;
  if (!p.inBoat) {
    const liquid = (t) => t === BLOCK.WATER || t === BLOCK.LAVA;
    if (liquid(body)) p.swimming = body === BLOCK.LAVA ? 2 : 1;
    else if (liquid(feet) && !p.onGround) p.swimming = feet === BLOCK.LAVA ? 2 : 1;
  }

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
  } else if (feet === BLOCK.WATER || body === BLOCK.WATER || underfoot === BLOCK.WATER) {
    // `underfoot` matters for the same reason it does in magma: bobbing at the
    // surface puts your feet level with an adjacent ledge — a hair too low to
    // step onto, and too high to still count as being in the water. Without it
    // the stroke cuts out exactly where you need it and you can never get out.
    p.vx *= 0.92;
    if (p.vy > 1.5) p.vy *= 0.85;
    if (input.jump || input.up) p.vy = Math.min(p.vy, -2.2);
  } else if (feet === BLOCK.LAVA || body === BLOCK.LAVA || underfoot === BLOCK.LAVA) {
    // Magma is thick. You sink slowly rather than fall, and you can swim back
    // out under your own power — including up onto a one-block ledge, which is
    // what stops a fall into the slab being a dead end.
    p.vx *= 0.80;
    if (p.vy > LAVA_SINK) p.vy = LAVA_SINK;
    if (input.jump || input.up) p.vy = Math.min(p.vy, -LAVA_SWIM);
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
        // Keep a short minimum so dig animation always has a beat to read
        const need = p.godMode
          ? 0.16
          : Math.max(0.22, meta.mine / Math.max(0.5, toolPower));
        if (!p.mining || p.mining.tx !== wrapX(tx) || p.mining.ty !== ty) {
          p.mining = { tx: wrapX(tx), ty, progress: 0, need };
        }
        p.mining.progress += dt;
        // Face the block being mined (look left/right toward it)
        const aimDx = wrapDeltaX(p.x, p.mining.tx + 0.5);
        if (Math.abs(aimDx) > 0.12) {
          p.facing = aimDx > 0 ? 1 : -1;
        }
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

  // Walk cycle: ~10 frames/sec while moving (4-frame loop ≈ 2.5 cycles/sec)
  // Idle/air: slow phase for subtle motion only
  if (p.onGround && Math.abs(p.vx) > 0.25 && !p.crouching) {
    p.anim += dt * 10;
  } else if (p.swimming) {
    // Strokes are slower than a walk cycle, and magma is thicker than water.
    p.anim += dt * (p.swimming === 2 ? 3.5 : 6);
  } else {
    p.anim += dt * 2;
  }
  return result;
}

/**
 * Lift a player who is completely inside solid tiles up to the nearest space
 * tall enough to stand in. Returns true if they were moved.
 *
 * This is the case overlap resolution cannot answer. It is only reachable by
 * getting inside terrain in the first place — flying down through the ground —
 * so it should be rare, and doing nothing is not an option: the alternative is
 * sinking through the world.
 */
export function ejectFromSolid(p, world) {
  const cx = Math.floor(p.x);
  const feetY = Math.floor(p.y - 0.05);
  const headY = Math.floor(p.y - p.h + 0.05);
  if (!isSolid(world, cx, feetY) || !isSolid(world, cx, headY)) return false;

  // Scan up for two clear tiles — one to stand in, one for the head.
  for (let y = headY; y >= 1; y--) {
    if (isSolid(world, cx, y) || isSolid(world, cx, y - 1)) continue;
    p.y = y + 1;
    p.vy = 0;
    p.onGround = false;
    return true;
  }
  return false;
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
      // Furniture collides the same way a platform does: you land on top of it,
      // but it never stops you walking past. A bed beside a doorway should not
      // be a wall.
      const isPlat = isPlatform(tid) || isWalkThrough(tid);
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
 * @returns {{tx:number,ty:number,solidTx:number,solidTy:number}|null}
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
    return { tx: c.tx, ty: c.ty, solidTx, solidTy };
  }
  return null;
}

/**
 * Which face a torch is mounted on.
 * @returns {'floor'|'ceil'|'left'|'right'}
 */
export function resolveTorchAttach(world, placeTx, placeTy, solidTx, solidTy) {
  if (solidTx != null && solidTy != null) {
    const dx = wrapDeltaX(solidTx + 0.5, placeTx + 0.5); // solid → torch
    const dy = placeTy - solidTy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      // solid left of torch → mount on left wall
      return dx > 0 ? 'left' : 'right';
    }
    // solid above torch → hanging from ceiling
    return dy > 0 ? 'ceil' : 'floor';
  }
  // Infer from neighbors (prefer walls so standing next to a wall looks mounted)
  if (isSolid(world, placeTx - 1, placeTy)) return 'left';
  if (isSolid(world, placeTx + 1, placeTy)) return 'right';
  if (isSolid(world, placeTx, placeTy + 1) || isPlatform(getTile(world, placeTx, placeTy + 1))) {
    return 'floor';
  }
  if (isSolid(world, placeTx, placeTy - 1)) return 'ceil';
  return 'floor';
}

function hasHangSupport(world, tx, ty) {
  // Ceiling / underside of block or platform above
  return isSolid(world, tx, ty - 1) || isPlatform(getTile(world, tx, ty - 1));
}

function hasFloorSupport(world, tx, ty) {
  return isSolid(world, tx, ty + 1) || isPlatform(getTile(world, tx, ty + 1));
}

/**
 * Lanterns hang from something above, or sit on the floor.
 * Prefer hang when both possible (especially when attaching under a solid).
 * @returns {'hang'|'floor'|null} null = no valid support
 */
export function resolveLanternMode(world, placeTx, placeTy, solidTx, solidTy) {
  const hang = hasHangSupport(world, placeTx, placeTy);
  const floor = hasFloorSupport(world, placeTx, placeTy);
  if (solidTx != null && solidTy != null) {
    const dy = placeTy - solidTy;
    // Placed under the solid we tapped → hang
    if (dy > 0 && hang) return 'hang';
    // Placed on top of solid → floor
    if (dy < 0 && floor) return 'floor';
  }
  if (hang && floor) return 'hang'; // prefer hanging
  if (hang) return 'hang';
  if (floor) return 'floor';
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
  let solidTx = null;
  let solidTy = null;

  // Tap solid/occupied: attachables go on the face toward the player
  if (cur !== BLOCK.AIR && cur !== BLOCK.WATER) {
    if (!isAttachableBlock(blockId)) return false;
    const adj = adjacentPlaceCell(p, world, placeTx, placeTy);
    if (!adj) return false;
    solidTx = adj.solidTx;
    solidTy = adj.solidTy;
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
  let lanternMode = null;
  if (blockId === BLOCK.LANTERN) {
    // Lanterns only hang from above or rest on a floor — not free-floating on walls alone
    lanternMode = resolveLanternMode(world, placeTx, placeTy, solidTx, solidTy);
    if (!lanternMode) return false;
  } else if (!skipSupport) {
    let hasSupport =
      isSolid(world, placeTx - 1, placeTy) ||
      isSolid(world, placeTx + 1, placeTy) ||
      isSolid(world, placeTx, placeTy - 1) ||
      isSolid(world, placeTx, placeTy + 1) ||
      isPlatform(getTile(world, placeTx, placeTy + 1)) ||
      // Stack ladders vertically (climb shafts)
      (blockId === BLOCK.LADDER && (
        getTile(world, placeTx, placeTy - 1) === BLOCK.LADDER ||
        getTile(world, placeTx, placeTy + 1) === BLOCK.LADDER
      ));
    // Cave "back wall" is visual only (air) — ladders may mount anywhere underground/sheltered.
    if (!hasSupport && blockId === BLOCK.LADDER
        && isShelteredAir(world, wrapX(placeTx), placeTy)) {
      hasSupport = true;
    }
    if (!hasSupport) return false;
  }

  // A door is two tiles tall, so it needs headroom and writes both halves. The
  // tap always lands on the bottom half — that is where a child aims.
  if (blockId === BLOCK.DOOR) {
    const above = getTile(world, placeTx, placeTy - 1);
    if (above !== BLOCK.AIR && above !== BLOCK.WATER) return false;
    if (placeTy - 1 < SKY_LIMIT) return false;
    // Don't place the upper half inside the player either.
    const relD = nearestTileX(p.x, placeTx);
    const boxD = playerAABB(p);
    if (boxD.right > relD && boxD.left < relD + 1
        && boxD.bottom > placeTy - 1 && boxD.top < placeTy) return false;
    setTile(world, placeTx, placeTy, BLOCK.DOOR);
    setTile(world, placeTx, placeTy - 1, BLOCK.DOOR_TOP);
    p.placeCooldown = 0.12;
    return { tx: wrapX(placeTx), ty: placeTy };
  }

  setTile(world, placeTx, placeTy, blockId);
  p.placeCooldown = 0.12;
  const out = { tx: wrapX(placeTx), ty: placeTy };
  if (blockId === BLOCK.TORCH) {
    out.attach = resolveTorchAttach(world, placeTx, placeTy, solidTx, solidTy);
  }
  if (blockId === BLOCK.LANTERN) {
    out.attach = lanternMode;
  }
  return out;
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
      return { x: sx, y: sy, atBed: true };
    }
  }
  // No valid bed found; fall back to world-centre spawn
  const sx = Math.floor(WORLD_W / 2);
  let sy = world.surface[sx];
  while (sy < WORLD_H - 1 && !isSolid(world, sx, sy + 1)) sy++;
  while (sy > SKY_LIMIT && isSolid(world, sx, sy)) sy--;
  return { x: sx, y: sy + 1, atBed: false };
}
