'use strict';

/**
 * Floating item drops + ambient critters (dodos).
 */

function makeEntityState() {
  return {
    drops: [],
    critters: [],
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
