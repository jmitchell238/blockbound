'use strict';

/**
 * Floating item drops + ambient critters (dodos).
 */

function makeEntityState() {
  return {
    drops: [],
    critters: [],
    hostiles: [],
  };
}

function spawnDrop(ents, x, y, id, count) {
  count = count || 1;
  ents.drops.push({
    x: x + (Math.random() - 0.5) * 0.3,
    y: y + 0.2,
    vx: (Math.random() - 0.5) * 2.5,
    vy: -2 - Math.random() * 1.5,
    id,
    count,
    life: 60,
    bob: Math.random() * Math.PI * 2,
  });
}

function spawnCritter(ents, x, y) {
  ents.critters.push({
    x: x + 0.5,
    y: y,
    vx: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8),
    facing: 1,
    anim: Math.random() * 10,
    hop: 0,
    kind: Math.random() < 0.7 ? 'dodo' : 'bunny',
  });
}

function seedCritters(ents, world, n) {
  n = n || Math.min(40, Math.max(8, Math.floor(WORLD_W / 200)));
  let tries = 0;
  while (ents.critters.length < n && tries < n * 40) {
    tries++;
    const x = Math.floor(Math.random() * WORLD_W);
    const sy = world.surface[x];
    if (getTile(world, x, sy) !== BLOCK.AIR) continue;
    if (!isSolid(world, x, sy + 1)) continue;
    const bio = world.biome[x];
    if (bio === 1 && Math.random() < 0.5) continue; // fewer in desert
    spawnCritter(ents, x, sy);
  }
}

function updateDrops(ents, world, player, inv, dt) {
  const picked = [];
  for (let i = ents.drops.length - 1; i >= 0; i--) {
    const d = ents.drops[i];
    d.life -= dt;
    d.bob += dt * 6;
    d.vy += (GRAVITY / TILE) * 0.35 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vx *= 0.96;

    // Ground collide
    const ty = Math.floor(d.y + 0.15);
    const tx = Math.floor(d.x);
    if (isSolid(world, tx, ty)) {
      d.y = ty - 0.05;
      d.vy = 0;
      d.vx *= 0.7;
    }

    // Magnet / pickup
    const dist = Math.hypot(wrapDeltaX(player.x, d.x), (player.y - player.h * 0.5) - d.y);
    if (dist < 1.4) {
      const left = addItem(inv, d.id, d.count);
      if (left < d.count) {
        picked.push({ id: d.id, n: d.count - left });
        if (left <= 0) ents.drops.splice(i, 1);
        else d.count = left;
      }
    } else if (d.life <= 0) {
      ents.drops.splice(i, 1);
    }

    // Wrap x
    if (d.x < 0) d.x += WORLD_W;
    if (d.x >= WORLD_W) d.x -= WORLD_W;
  }
  return picked;
}

function spawnHostile(ents, x, y) {
  ents.hostiles.push({
    x: x + 0.5,
    y: y,
    vx: (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random()),
    hp: 20,
    anim: 0,
    atkCd: 0,
    kind: Math.random() < 0.5 ? 'scorpion' : 'dropbear',
  });
}

/**
 * True if solid blocks block a ray from (x0,y0) to (x1,y1).
 * Open doors / platforms / ladders do not block. Used so mobs can't hit through dirt.
 */
function hasLineOfSight(world, x0, y0, x1, y1) {
  const dx = wrapDeltaX(x0, x1);
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.15) return true;
  const steps = Math.max(2, Math.ceil(dist * 4)); // ~0.25 tile samples
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const tile = getTile(world, tx, ty);
    if (tile === BLOCK.AIR || tile === BLOCK.WATER || tile === BLOCK.LADDER
        || tile === BLOCK.TORCH || tile === BLOCK.LEAVES || tile === BLOCK.GLASS
        || tile === BLOCK.CAMPFIRE || isPlatform(tile)) {
      continue;
    }
    // Open door is walkable
    if (tile === BLOCK.DOOR && world.meta && world.meta.openDoors
        && world.meta.openDoors[tileKey(tx, ty)]) {
      continue;
    }
    if (isSolid(world, tx, ty)) return false;
  }
  return true;
}

/** Player is sealed underground (solid/ceiling nearby) — surface mobs shouldn't aggro through dirt. */
function playerIsSheltered(world, player) {
  const px = Math.floor(player.x);
  const py = Math.floor(player.y - player.h * 0.5);
  // Head-adjacent solid above or on sides counts as cover
  let solids = 0;
  for (let dy = -2; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (isSolid(world, px + dx, py + dy)) solids++;
    }
  }
  const surface = world.surface[wrapX(px)];
  const depth = player.y - surface;
  // Deep enough under surface with nearby walls = safe from surface mobs
  return depth > 2.5 && solids >= 3;
}

/** Night surface hostiles near player. */
function updateHostiles(ents, world, player, dt, timeOfDay, ui) {
  const day = Math.sin(timeOfDay * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
  const night = day < 0.35;

  // Despawn in day
  if (!night) {
    if (ents.hostiles.length) ents.hostiles.length = 0;
    return [];
  }

  const sheltered = playerIsSheltered(world, player);

  // Spawn near player on surface only — never next to buried players
  if (!sheltered && ents.hostiles.length < 5 && Math.random() < dt * 0.12) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const sx = wrapX(Math.floor(player.x) + side * (8 + Math.floor(Math.random() * 10)));
    let sy = world.surface[sx];
    while (sy < WORLD_H - 1 && !isSolid(world, sx, sy + 1)) sy++;
    while (sy > SKY_LIMIT && isSolid(world, sx, sy)) sy--;
    // Only if surface-ish and dark, and near player's vertical band
    if (getTile(world, sx, sy) === BLOCK.AIR
        && Math.abs((sy + 1) - player.y) < 8) {
      spawnHostile(ents, sx, sy + 1);
    }
  }

  const hits = [];
  const pEyeX = player.x;
  const pEyeY = player.y - player.h * 0.45;

  for (let i = ents.hostiles.length - 1; i >= 0; i--) {
    const h = ents.hostiles[i];
    h.anim += dt * 10;
    h.atkCd = Math.max(0, h.atkCd - dt);

    const dx = wrapDeltaX(h.x, player.x);
    const dy = player.y - h.y;
    const dist = Math.hypot(dx, dy);
    const hEyeX = h.x;
    const hEyeY = h.y - 0.6;
    const canSee = hasLineOfSight(world, hEyeX, hEyeY, pEyeX, pEyeY);

    // Only chase when they can see the player (no wall-hacks)
    if (canSee && !sheltered) {
      h.vx = Math.sign(dx || 1) * (h.kind === 'dropbear' ? 1.8 : 1.3);
    } else {
      // Wander / give up if player is behind dirt
      if (Math.random() < dt * 0.4) h.vx *= -1;
      h.vx = Math.sign(h.vx || 1) * 0.7;
    }

    const nextX = h.x + h.vx * dt;
    const feet = Math.floor(h.y + 0.05);
    const ahead = Math.floor(nextX + Math.sign(h.vx) * 0.3);
    if (isSolid(world, ahead, feet - 1)) h.vx *= -1;
    else h.x = nextX;
    if (h.x < 0) h.x += WORLD_W;
    if (h.x >= WORLD_W) h.x -= WORLD_W;

    // Stick to ground
    const tx = Math.floor(h.x);
    let gy = Math.floor(h.y);
    while (gy < WORLD_H - 1 && !isSolid(world, tx, gy + 1) && !isPlatform(getTile(world, tx, gy + 1))) gy++;
    while (gy > SKY_LIMIT && isSolid(world, tx, gy)) gy--;
    h.y = gy;

    // Attack only in melee range WITH clear line of sight (no through-block hits)
    if (canSee && !sheltered && dist < 1.15 && h.atkCd <= 0 && player.invuln <= 0) {
      h.atkCd = 1.1;
      hits.push({ dmg: h.kind === 'dropbear' ? 14 : 10, kind: h.kind });
    }

    // Stomp only if same airspace (LOS + close + falling)
    if (canSee && dist < 1.0 && player.vy > 2) {
      h.hp -= 12;
      player.vy = JUMP_VEL / TILE * 0.45;
    }

    // Despawn far away, or if player is deep underground away from them
    if (Math.abs(dx) > 40 || (sheltered && dist > 6)) {
      ents.hostiles.splice(i, 1);
      continue;
    }
    if (h.hp <= 0) {
      spawnDrop(ents, h.x, h.y - 0.5, 'apple', 1);
      if (Math.random() < 0.3) spawnDrop(ents, h.x, h.y - 0.3, BLOCK.COAL, 1);
      ents.hostiles.splice(i, 1);
    }
  }
  return hits;
}

function updateCritters(ents, world, dt) {
  for (const c of ents.critters) {
    c.anim += dt * 8;
    c.hop = Math.max(0, c.hop - dt);

    // Simple wander + edge turn
    const nextX = c.x + c.vx * dt;
    const feetY = Math.floor(c.y + 0.05);
    const ahead = Math.floor(nextX + Math.sign(c.vx) * 0.3);
    const ground = isSolid(world, ahead, feetY);
    const wall = isSolid(world, ahead, feetY - 1);
    if (!ground || wall || Math.random() < dt * 0.15) {
      c.vx *= -1;
      if (Math.random() < 0.3) c.hop = 0.25;
    } else {
      c.x = nextX;
    }
    if (c.x < 0) c.x += WORLD_W;
    if (c.x >= WORLD_W) c.x -= WORLD_W;
    c.facing = c.vx >= 0 ? 1 : -1;

    // Stick to surface-ish
    const tx = Math.floor(c.x);
    let gy = Math.floor(c.y);
    while (gy < WORLD_H - 1 && !isSolid(world, tx, gy + 1)) gy++;
    while (gy > SKY_LIMIT && isSolid(world, tx, gy)) gy--;
    c.y = gy + (c.hop > 0 ? -0.35 * Math.sin(c.hop * Math.PI * 4) : 0);
  }
}

function drawEntities(ctx, ents, cam, ts) {
  // Drops
  for (const d of ents.drops) {
    const sx = (d.x - cam.x) * ts + W / 2;
    const sy = (d.y - cam.y) * ts + H / 2 + Math.sin(d.bob) * 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, d.life / 2);
    if (typeof d.id === 'number' && typeof getCubeTex === 'function' && getCubeTex(d.id)) {
      ctx.drawImage(getCubeTex(d.id), sx - 8, sy - 8, 16, 16);
    } else if (isFood(d.id) && FOOD[d.id]) {
      ctx.fillStyle = FOOD[d.id].color;
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#ddd';
      ctx.fillRect(sx - 4, sy - 4, 8, 8);
    }
    ctx.restore();
  }

  // Hostiles
  if (ents.hostiles) {
    for (const h of ents.hostiles) {
      const sx = (h.x - cam.x) * ts + W / 2;
      const sy = (h.y - cam.y) * ts + H / 2;
      const bob = Math.sin(h.anim) * 1.5;
      ctx.save();
      ctx.translate(sx, sy + bob);
      if (h.vx < 0) ctx.scale(-1, 1);
      if (h.kind === 'scorpion') {
        ctx.fillStyle = '#8b4513';
        ctx.beginPath();
        ctx.ellipse(0, -6, 12, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#5a2a0a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(8, -8);
        ctx.quadraticCurveTo(16, -18, 10, -14);
        ctx.stroke();
        ctx.fillStyle = '#222';
        ctx.fillRect(4, -10, 2, 2);
      } else {
        // dropbear
        ctx.fillStyle = '#6b4423';
        ctx.beginPath();
        ctx.ellipse(0, -10, 11, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4a2a12';
        ctx.beginPath();
        ctx.arc(-6, -18, 4, 0, Math.PI * 2);
        ctx.arc(6, -18, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f44';
        ctx.fillRect(-3, -12, 2, 2);
        ctx.fillRect(2, -12, 2, 2);
      }
      ctx.restore();
    }
  }

  // Critters
  for (const c of ents.critters) {
    const sx = (c.x - cam.x) * ts + W / 2;
    const sy = (c.y - cam.y) * ts + H / 2;
    const bob = Math.sin(c.anim) * 2;
    ctx.save();
    ctx.translate(sx, sy + bob);
    if (c.facing < 0) ctx.scale(-1, 1);
    if (c.kind === 'dodo') {
      // Chunky bird
      ctx.fillStyle = '#e8d0a0';
      ctx.beginPath();
      ctx.ellipse(0, -10, 10, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f0c070';
      ctx.beginPath();
      ctx.arc(8, -14, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e07040';
      ctx.beginPath();
      ctx.moveTo(12, -14);
      ctx.lineTo(18, -12);
      ctx.lineTo(12, -10);
      ctx.fill();
      ctx.fillStyle = '#222';
      ctx.fillRect(9, -16, 2, 2);
      ctx.fillStyle = '#c06040';
      ctx.fillRect(-3, -2, 3, 6);
      ctx.fillRect(2, -2, 3, 6);
    } else {
      // Bunny
      ctx.fillStyle = '#f0e8e0';
      ctx.beginPath();
      ctx.ellipse(0, -8, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f0e8e0';
      ctx.fillRect(-4, -20, 3, 10);
      ctx.fillRect(1, -20, 3, 10);
      ctx.fillStyle = '#f8a0b0';
      ctx.fillRect(-3, -18, 1, 5);
      ctx.fillStyle = '#222';
      ctx.fillRect(3, -10, 2, 2);
    }
    ctx.restore();
  }
}

function serializeEntities(ents) {
  return {
    drops: ents.drops.map(d => ({ x: d.x, y: d.y, id: d.id, count: d.count, life: d.life })),
    critters: ents.critters.map(c => ({ x: c.x, y: c.y, vx: c.vx, kind: c.kind })),
    // hostiles not saved — respawn at night
  };
}

function deserializeEntities(data) {
  const ents = makeEntityState();
  if (!data) return ents;
  if (data.drops) {
    for (const d of data.drops) {
      ents.drops.push({
        x: d.x, y: d.y, vx: 0, vy: 0, id: d.id, count: d.count || 1,
        life: d.life != null ? d.life : 30, bob: 0,
      });
    }
  }
  if (data.critters) {
    for (const c of data.critters) {
      ents.critters.push({
        x: c.x, y: c.y, vx: c.vx || 1, facing: 1, anim: 0, hop: 0, kind: c.kind || 'dodo',
      });
    }
  }
  return ents;
}
