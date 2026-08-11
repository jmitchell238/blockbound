'use strict';

/**
 * Grounded walking mobs + item drops.
 * y = feet position (same as player). Bodies draw upward from the feet.
 */

const MOB = {
  rabbit:   { hostile: false, hp: 8,  speed: 1.4, w: 0.55, h: 0.55, dmg: 0,  nightOnly: false },
  wolf:     { hostile: true,  hp: 22, speed: 2.1, w: 0.75, h: 0.7,  dmg: 11, nightOnly: false, aggroRange: 9 },
  zombie:   { hostile: true,  hp: 30, speed: 1.15, w: 0.6, h: 1.45, dmg: 12, nightOnly: true, aggroRange: 12 },
  skeleton: { hostile: true,  hp: 20, speed: 1.55, w: 0.55, h: 1.5,  dmg: 14, nightOnly: true, aggroRange: 14 },
};

function makeEntityState() {
  return {
    drops: [],
    critters: [], // rabbits (passive)
    hostiles: [], // wolf / zombie / skeleton
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

/** Snap feet to the top of the solid/platform under (x, preferY). */
function groundFeetY(world, x, preferY) {
  const tx = Math.floor(x);
  let y = Math.floor(preferY);
  y = Math.max(SKY_LIMIT + 1, Math.min(WORLD_H - 2, y));

  // If inside solid, push up
  while (y > SKY_LIMIT && isSolid(world, tx, Math.floor(y - 0.01))) {
    y -= 1;
  }
  // Fall down until standing on something
  let guard = 0;
  while (guard++ < WORLD_H) {
    const below = Math.floor(y + 0.001);
    if (isSolid(world, tx, below) || isPlatform(getTile(world, tx, below))) {
      return below; // feet on top of tile `below`
    }
    if (below >= WORLD_H - 1) return WORLD_H - 2;
    y += 1;
  }
  return preferY;
}

function solidUnder(world, x, feetY) {
  const tx = Math.floor(x);
  const below = Math.floor(feetY + 0.001);
  return isSolid(world, tx, below) || isPlatform(getTile(world, tx, below));
}

function wallAt(world, x, feetY, h) {
  const tx = Math.floor(x);
  // Check torso tiles
  const mid = Math.floor(feetY - h * 0.5);
  const head = Math.floor(feetY - h + 0.1);
  return isSolid(world, tx, mid) || isSolid(world, tx, head);
}

function makeMob(kind, x, feetY) {
  const def = MOB[kind] || MOB.rabbit;
  return {
    kind,
    x: x + 0.5,
    y: feetY,
    vx: (Math.random() < 0.5 ? -1 : 1) * def.speed * (0.6 + Math.random() * 0.4),
    facing: 1,
    anim: Math.random() * 10,
    hop: 0,
    hp: def.hp,
    maxHp: def.hp,
    atkCd: 0,
    w: def.w,
    h: def.h,
    hostile: !!def.hostile,
  };
}

function spawnCritter(ents, x, feetY) {
  // Passive rabbits only
  ents.critters.push(makeMob('rabbit', x, feetY));
}

function seedCritters(ents, world, n) {
  n = n || Math.min(50, Math.max(12, Math.floor(WORLD_W / 160)));
  let tries = 0;
  while (ents.critters.length < n && tries < n * 50) {
    tries++;
    const x = Math.floor(Math.random() * WORLD_W);
    const surface = world.surface[x];
    // First solid below surface air
    let feet = surface + 1;
    while (feet < WORLD_H - 1 && !isSolid(world, x, feet)) feet++;
    if (feet >= WORLD_H - 2) continue;
    if (getTile(world, x, feet - 1) !== BLOCK.AIR && getTile(world, x, feet - 1) !== BLOCK.LEAVES) continue;
    const bio = world.biome[x];
    if (bio === 1 && Math.random() < 0.4) continue; // fewer in desert
    spawnCritter(ents, x, feet);
  }
}

function spawnHostile(ents, x, feetY, kind) {
  const nightKinds = ['zombie', 'skeleton', 'wolf'];
  const k = kind || nightKinds[Math.floor(Math.random() * nightKinds.length)];
  ents.hostiles.push(makeMob(k, x, feetY));
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

    const ty = Math.floor(d.y + 0.15);
    const tx = Math.floor(d.x);
    if (isSolid(world, tx, ty)) {
      d.y = ty - 0.05;
      d.vy = 0;
      d.vx *= 0.7;
    }

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

    if (d.x < 0) d.x += WORLD_W;
    if (d.x >= WORLD_W) d.x -= WORLD_W;
  }
  return picked;
}

function hasLineOfSight(world, x0, y0, x1, y1) {
  const dx = wrapDeltaX(x0, x1);
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.15) return true;
  const steps = Math.max(2, Math.ceil(dist * 4));
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
    if (tile === BLOCK.DOOR && world.meta && world.meta.openDoors
        && world.meta.openDoors[tileKey(tx, ty)]) {
      continue;
    }
    if (isSolid(world, tx, ty)) return false;
  }
  return true;
}

function playerIsSheltered(world, player) {
  const px = Math.floor(player.x);
  const py = Math.floor(player.y - player.h * 0.5);
  let solids = 0;
  for (let dy = -2; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (isSolid(world, px + dx, py + dy)) solids++;
    }
  }
  const surface = world.surface[wrapX(px)];
  const depth = player.y - surface;
  return depth > 2.5 && solids >= 3;
}

function stepMobWalk(m, world, dt, targetVx) {
  const def = MOB[m.kind] || MOB.rabbit;
  m.anim += dt * (6 + Math.abs(targetVx) * 3);
  m.vx = targetVx;

  const face = Math.sign(m.vx) || m.facing || 1;
  m.facing = face;

  const nextX = m.x + m.vx * dt;
  const stepX = nextX + face * 0.25;

  // Cliff: no ground ahead → turn
  if (!solidUnder(world, stepX, m.y)) {
    m.vx *= -1;
    m.facing = Math.sign(m.vx) || 1;
  } else if (wallAt(world, stepX, m.y, def.h)) {
    m.vx *= -1;
    m.facing = Math.sign(m.vx) || 1;
  } else {
    m.x = nextX;
  }

  if (m.x < 0) m.x += WORLD_W;
  if (m.x >= WORLD_W) m.x -= WORLD_W;

  // Gravity-ish snap to ground (walk, don't float)
  const grounded = solidUnder(world, m.x, m.y);
  if (!grounded) {
    // Fall
    m.y += Math.min(8 * dt, 0.4);
    m.y = groundFeetY(world, m.x, m.y);
  } else {
    m.y = groundFeetY(world, m.x, m.y);
  }
}

/** Night hostiles + day wolves near player. */
function updateHostiles(ents, world, player, dt, timeOfDay, ui) {
  const day = Math.sin(timeOfDay * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
  const night = day < 0.35;
  const sheltered = playerIsSheltered(world, player);

  // Despawn pure night mobs at dawn; keep wolves
  if (!night) {
    for (let i = ents.hostiles.length - 1; i >= 0; i--) {
      const k = ents.hostiles[i].kind;
      if (k === 'zombie' || k === 'skeleton') ents.hostiles.splice(i, 1);
    }
  }

  // Spawn
  if (!sheltered && ents.hostiles.length < 6 && Math.random() < dt * 0.14) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const sx = wrapX(Math.floor(player.x) + side * (10 + Math.floor(Math.random() * 12)));
    let feet = world.surface[sx] + 1;
    while (feet < WORLD_H - 1 && !isSolid(world, sx, feet)) feet++;
    if (feet < WORLD_H - 2 && Math.abs(feet - player.y) < 10) {
      let kind;
      if (night) {
        const r = Math.random();
        kind = r < 0.4 ? 'zombie' : r < 0.75 ? 'skeleton' : 'wolf';
      } else {
        kind = 'wolf'; // rare day wolves
        if (Math.random() > 0.35) kind = null;
      }
      if (kind) spawnHostile(ents, sx, feet, kind);
    }
  }

  const hits = [];
  const pEyeX = player.x;
  const pEyeY = player.y - player.h * 0.45;

  for (let i = ents.hostiles.length - 1; i >= 0; i--) {
    const h = ents.hostiles[i];
    const def = MOB[h.kind] || MOB.zombie;
    h.atkCd = Math.max(0, h.atkCd - dt);

    if (def.nightOnly && !night) {
      ents.hostiles.splice(i, 1);
      continue;
    }

    const dx = wrapDeltaX(h.x, player.x);
    const dy = player.y - h.y;
    const dist = Math.hypot(dx, dy);
    const canSee = hasLineOfSight(world, h.x, h.y - def.h * 0.5, pEyeX, pEyeY);
    const aggro = def.aggroRange || 10;

    let targetVx;
    if (canSee && !sheltered && dist < aggro) {
      targetVx = Math.sign(dx || 1) * def.speed;
    } else {
      if (Math.random() < dt * 0.25) h.vx *= -1;
      targetVx = Math.sign(h.vx || 1) * def.speed * 0.55;
    }

    stepMobWalk(h, world, dt, targetVx);

    // Melee
    const reach = h.kind === 'skeleton' ? 1.35 : 1.2;
    if (canSee && !sheltered && dist < reach && h.atkCd <= 0 && player.invuln <= 0
        && !(player.attackT > 0)) {
      h.atkCd = h.kind === 'zombie' ? 1.25 : 1.0;
      hits.push({ dmg: def.dmg, kind: h.kind });
    }

    if (Math.abs(dx) > 45 || (sheltered && dist > 8)) {
      ents.hostiles.splice(i, 1);
      continue;
    }
    if (h.hp <= 0) {
      // Drops by type
      if (h.kind === 'rabbit') spawnDrop(ents, h.x, h.y - 0.3, 'apple', 1);
      else if (h.kind === 'wolf') {
        spawnDrop(ents, h.x, h.y - 0.3, BLOCK.LEAVES, 1);
        if (Math.random() < 0.4) spawnDrop(ents, h.x, h.y - 0.2, 'apple', 1);
      } else if (h.kind === 'skeleton') {
        spawnDrop(ents, h.x, h.y - 0.3, BLOCK.BONE || BLOCK.STONE, 1);
        if (Math.random() < 0.5) spawnDrop(ents, h.x, h.y - 0.2, 'stick', 1);
      } else {
        // zombie
        if (Math.random() < 0.5) spawnDrop(ents, h.x, h.y - 0.3, 'apple', 1);
        if (Math.random() < 0.3) spawnDrop(ents, h.x, h.y - 0.2, BLOCK.DIRT, 1);
      }
      ents.hostiles.splice(i, 1);
    }
  }
  return hits;
}

function updateCritters(ents, world, dt) {
  for (const c of ents.critters) {
    // Rabbits hop occasionally
    if (Math.random() < dt * 0.2) c.hop = 0.35;
    c.hop = Math.max(0, c.hop - dt);

    if (Math.random() < dt * 0.2) c.vx *= -1;
    const spd = (MOB.rabbit.speed) * (0.7 + Math.random() * 0.2);
    const targetVx = Math.sign(c.vx || 1) * spd;
    stepMobWalk(c, world, dt, targetVx);

    // Small hop offset for draw only (don't break feet permanently)
    c.drawHop = c.hop > 0 ? Math.sin(c.hop * Math.PI / 0.35) * 0.25 : 0;
  }
}

function tryMeleeAttack(player, inv, ents, world) {
  if (!player || player.attackCd > 0) return { kills: 0, hits: 0, dmg: 0, fist: false };
  const tool = typeof getMeleeWeapon === 'function'
    ? getMeleeWeapon(inv)
    : (TOOLS.hand || { damage: 9, reach: 1.65 });
  const fist = !tool.weapon && tool.id === 'hand';
  const dmg = tool.damage || (fist ? 9 : 5);
  const reach = tool.reach || 1.65;
  player.attackT = fist ? 0.18 : 0.22;
  player.attackCd = fist ? 0.28 : (tool.weapon ? 0.32 : 0.38);
  player.attackHit = false;
  player.invuln = Math.max(player.invuln, 0.2);

  let hits = 0;
  let kills = 0;
  if (!ents || !ents.hostiles) return { kills: 0, hits: 0, dmg, fist };

  const face = player.facing >= 0 ? 1 : -1;
  const px = player.x;
  const py = player.y - player.h * 0.5;

  for (let i = ents.hostiles.length - 1; i >= 0; i--) {
    const h = ents.hostiles[i];
    const def = MOB[h.kind] || MOB.zombie;
    const dx = wrapDeltaX(px, h.x);
    const dy = (h.y - def.h * 0.5) - py;
    const dist = Math.hypot(dx, dy);
    const maxR = reach + (fist ? 0.45 : 0.35);
    if (dist > maxR) continue;
    if (dist > 0.85 && Math.sign(dx || face) !== face) continue;
    if (!hasLineOfSight(world, px, py, h.x, h.y - def.h * 0.5)) continue;

    h.hp -= dmg;
    h.vx = face * (fist ? 2.8 : 3.5);
    hits++;
    player.attackHit = true;
    if (h.hp <= 0) {
      // death handled next updateHostiles pass — do it here
      if (h.kind === 'skeleton' && Math.random() < 0.5) spawnDrop(ents, h.x, h.y - 0.3, 'stick', 1);
      else if (Math.random() < 0.5) spawnDrop(ents, h.x, h.y - 0.3, 'apple', 1);
      ents.hostiles.splice(i, 1);
      kills++;
    }
  }

  // Also let players "hunt" rabbits for food
  if (ents.critters) {
    for (let i = ents.critters.length - 1; i >= 0; i--) {
      const c = ents.critters[i];
      const dx = wrapDeltaX(px, c.x);
      const dy = (c.y - 0.25) - py;
      const dist = Math.hypot(dx, dy);
      if (dist > reach) continue;
      if (dist > 0.7 && Math.sign(dx || face) !== face) continue;
      c.hp = (c.hp || 8) - dmg;
      hits++;
      if (c.hp <= 0) {
        spawnDrop(ents, c.x, c.y - 0.2, 'apple', 1 + (Math.random() < 0.5 ? 1 : 0));
        ents.critters.splice(i, 1);
        kills++;
      }
    }
  }

  if (hits > 0 && inv && !fist) {
    const slot = selectedSlot(inv);
    if (slot && isTool(slot.id) && TOOLS[slot.id] && TOOLS[slot.id].durability < Infinity) {
      slot.durability = (slot.durability != null ? slot.durability : TOOLS[slot.id].durability) - 1;
      if (slot.durability <= 0) {
        inv.hotbar[inv.selected] = null;
        inv.tool = 'hand';
      }
    }
  }

  return { kills, hits, dmg, fist };
}

// ─── Drawing (feet at origin, walk cycle) ───────────────────────────────────

function drawMobShadow(ctx, w) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, -1, w * 0.55, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawWalkLegs(ctx, anim, color, legH, legW, spread) {
  const stride = Math.sin(anim) * spread;
  ctx.fillStyle = color;
  ctx.fillRect(-legW * 1.1, -legH + stride, legW, legH - Math.min(stride, 0));
  ctx.fillRect(legW * 0.2, -legH - stride, legW, legH + Math.max(stride, 0));
}

function drawRabbit(ctx, m, ts) {
  const scale = ts;
  const hop = (m.drawHop || 0) * ts;
  ctx.save();
  ctx.translate(0, -hop);
  drawMobShadow(ctx, 14);
  const stride = Math.sin(m.anim * 2) * 3;
  // body
  ctx.fillStyle = '#f2ebe3';
  ctx.beginPath();
  ctx.ellipse(0, -10, 11, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // head
  ctx.beginPath();
  ctx.ellipse(9, -14, 6, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // ears
  ctx.fillStyle = '#f2ebe3';
  ctx.fillRect(6, -28, 3, 12);
  ctx.fillRect(11, -27, 3, 11);
  ctx.fillStyle = '#f7b0c0';
  ctx.fillRect(7, -26, 1.5, 8);
  // eye
  ctx.fillStyle = '#222';
  ctx.fillRect(11, -16, 2, 2);
  // feet
  ctx.fillStyle = '#e8ddd4';
  ctx.fillRect(-8 + stride, -4, 7, 3);
  ctx.fillRect(2 - stride, -4, 7, 3);
  ctx.restore();
}

function drawWolf(ctx, m, ts) {
  drawMobShadow(ctx, 18);
  const stride = Math.sin(m.anim * 2.2) * 4;
  // legs
  ctx.fillStyle = '#6a6a72';
  ctx.fillRect(-10, -12 + stride, 4, 12);
  ctx.fillRect(-3, -12 - stride, 4, 12);
  ctx.fillRect(4, -12 + stride * 0.8, 4, 12);
  ctx.fillRect(10, -12 - stride * 0.8, 4, 12);
  // body
  ctx.fillStyle = '#8a8a94';
  ctx.beginPath();
  ctx.ellipse(0, -18, 16, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  // head
  ctx.fillStyle = '#7a7a84';
  ctx.beginPath();
  ctx.ellipse(14, -22, 8, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // snout
  ctx.fillStyle = '#6a6a74';
  ctx.fillRect(18, -22, 8, 5);
  // ear
  ctx.fillStyle = '#8a8a94';
  ctx.beginPath();
  ctx.moveTo(10, -28);
  ctx.lineTo(14, -36);
  ctx.lineTo(16, -28);
  ctx.fill();
  // eye
  ctx.fillStyle = '#f0c040';
  ctx.fillRect(16, -24, 2.5, 2.5);
  // tail
  ctx.strokeStyle = '#7a7a84';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-14, -18);
  ctx.quadraticCurveTo(-22, -28 - Math.sin(m.anim) * 3, -18, -14);
  ctx.stroke();
}

function drawZombie(ctx, m, ts) {
  drawMobShadow(ctx, 12);
  const phase = m.anim;
  const stride = Math.sin(phase * 1.8) * 5;
  // legs
  ctx.fillStyle = '#3d4a38';
  ctx.fillRect(-6, -18 + stride, 5, 18);
  ctx.fillRect(1, -18 - stride, 5, 18);
  // torso
  ctx.fillStyle = '#4a6b3a';
  roundRectLocal(ctx, -8, -40, 16, 24, 2);
  ctx.fill();
  // arms outstretched shambling
  ctx.fillStyle = '#6a9a5a';
  ctx.fillRect(6, -38, 14, 4);
  ctx.fillRect(6, -32, 12, 4);
  // head
  ctx.fillStyle = '#7aba5a';
  roundRectLocal(ctx, -7, -54, 14, 14, 3);
  ctx.fill();
  // eyes
  ctx.fillStyle = '#222';
  ctx.fillRect(-3, -48, 2.5, 2.5);
  ctx.fillRect(2, -48, 2.5, 2.5);
  // tattered mouth
  ctx.fillStyle = '#2a3a22';
  ctx.fillRect(-3, -42, 7, 2);
}

function drawSkeleton(ctx, m, ts) {
  drawMobShadow(ctx, 11);
  const phase = m.anim;
  const stride = Math.sin(phase * 2) * 5;
  // legs (bones)
  ctx.strokeStyle = '#e8e4d8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.lineTo(-4, -18 + stride);
  ctx.moveTo(4, 0);
  ctx.lineTo(4, -18 - stride);
  ctx.stroke();
  // ribs
  ctx.strokeStyle = '#ddd8cc';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-7, -22 - i * 4);
    ctx.lineTo(7, -22 - i * 4);
    ctx.stroke();
  }
  // spine
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(0, -40);
  ctx.stroke();
  // arms + bow pose
  ctx.beginPath();
  ctx.moveTo(0, -36);
  ctx.lineTo(12, -30);
  ctx.moveTo(0, -36);
  ctx.lineTo(-8, -28);
  ctx.stroke();
  // skull
  ctx.fillStyle = '#f0ebe0';
  ctx.beginPath();
  ctx.arc(0, -48, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#222';
  ctx.fillRect(-4, -50, 2.5, 3);
  ctx.fillRect(2, -50, 2.5, 3);
  // bow
  ctx.strokeStyle = '#8b6914';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(14, -30, 8, -1.2, 1.2);
  ctx.stroke();
}

function roundRectLocal(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawEntities(ctx, ents, cam, ts) {
  // Drops
  for (const d of ents.drops) {
    const sx = (d.x - cam.x) * ts + W / 2;
    const sy = (d.y - cam.y) * ts + H / 2 + Math.sin(d.bob) * 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, d.life / 2);
    if (typeof d.id === 'number' && typeof getSoftTex === 'function' && getSoftTex(d.id)) {
      ctx.drawImage(getSoftTex(d.id), sx - 8, sy - 8, 16, 16);
    } else if (typeof d.id === 'number' && typeof getCubeTex === 'function' && getCubeTex(d.id)) {
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

  function drawOne(m) {
    const sx = (m.x - cam.x) * ts + W / 2;
    const sy = (m.y - cam.y) * ts + H / 2;
    // cull offscreen
    if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) return;

    ctx.save();
    ctx.translate(sx, sy);
    if ((m.facing || m.vx || 1) < 0) ctx.scale(-1, 1);

    // HP bar if hurt
    if (m.hp < m.maxHp && m.hostile) {
      const pct = Math.max(0, m.hp / m.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-12, -m.h * ts - 10, 24, 4);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(-12, -m.h * ts - 10, 24 * pct, 4);
    }

    if (m.kind === 'rabbit') drawRabbit(ctx, m, ts);
    else if (m.kind === 'wolf') drawWolf(ctx, m, ts);
    else if (m.kind === 'zombie') drawZombie(ctx, m, ts);
    else if (m.kind === 'skeleton') drawSkeleton(ctx, m, ts);
    else drawRabbit(ctx, m, ts);

    ctx.restore();
  }

  if (ents.hostiles) {
    for (const h of ents.hostiles) drawOne(h);
  }
  for (const c of ents.critters) drawOne(c);
}

function serializeEntities(ents) {
  return {
    drops: ents.drops.map(d => ({ x: d.x, y: d.y, id: d.id, count: d.count, life: d.life })),
    critters: ents.critters.map(c => ({
      x: c.x, y: c.y, vx: c.vx, kind: c.kind || 'rabbit', hp: c.hp, facing: c.facing,
    })),
    hostiles: (ents.hostiles || []).map(h => ({
      x: h.x, y: h.y, vx: h.vx, kind: h.kind, hp: h.hp, facing: h.facing,
    })),
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
      const kind = (c.kind === 'dodo' || c.kind === 'bunny') ? 'rabbit' : (c.kind || 'rabbit');
      const m = makeMob(kind, c.x - 0.5, c.y);
      m.x = c.x;
      m.y = c.y;
      m.vx = c.vx || m.vx;
      m.hp = c.hp != null ? c.hp : m.hp;
      ents.critters.push(m);
    }
  }
  if (data.hostiles) {
    for (const h of data.hostiles) {
      // Migrate old kinds
      let kind = h.kind;
      if (kind === 'scorpion' || kind === 'dropbear') kind = Math.random() < 0.5 ? 'zombie' : 'skeleton';
      if (!MOB[kind]) kind = 'zombie';
      const m = makeMob(kind, h.x - 0.5, h.y);
      m.x = h.x;
      m.y = h.y;
      m.vx = h.vx || m.vx;
      m.hp = h.hp != null ? h.hp : m.hp;
      ents.hostiles.push(m);
    }
  }
  return ents;
}
