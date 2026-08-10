'use strict';

/** Lightweight mining / place / spark particles. */
function makeParticleSystem() {
  return { list: [] };
}

function spawnBurst(ps, x, y, color, n) {
  n = n || 8;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 3.5;
    ps.list.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 1.5,
      life: 0.35 + Math.random() * 0.4,
      max: 0.7,
      size: 2 + Math.random() * 3,
      color: color || '#c4a060',
    });
  }
}

function updateParticles(ps, dt) {
  for (let i = ps.list.length - 1; i >= 0; i--) {
    const p = ps.list[i];
    p.life -= dt;
    if (p.life <= 0) {
      ps.list.splice(i, 1);
      continue;
    }
    p.vy += 12 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function drawParticles(ctx, ps, cam, ts) {
  for (const p of ps.list) {
    const sx = (p.x - cam.x) * ts + W / 2;
    const sy = (p.y - cam.y) * ts + H / 2;
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}
