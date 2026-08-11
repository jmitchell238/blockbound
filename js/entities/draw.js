import { W, H } from '../core/constants.js';
import { FOOD, isFood } from '../content/tools.js';
import { getSoftTex, getCubeTex } from '../textures/textures.js';

// ─── Drawing (feet at origin, walk cycle) ───────────────────────────────────

export function drawMobShadow(ctx, w) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(0, -1, w * 0.55, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawWalkLegs(ctx, anim, color, legH, legW, spread) {
  const stride = Math.sin(anim) * spread;
  ctx.fillStyle = color;
  ctx.fillRect(-legW * 1.1, -legH + stride, legW, legH - Math.min(stride, 0));
  ctx.fillRect(legW * 0.2, -legH - stride, legW, legH + Math.max(stride, 0));
}

export function drawRabbit(ctx, m, ts) {
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

export function drawWolf(ctx, m, ts) {
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

export function drawZombie(ctx, m, ts) {
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

export function drawSkeleton(ctx, m, ts) {
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

export function roundRectLocal(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawEntities(ctx, ents, cam, ts) {
  // Drops
  for (const d of ents.drops) {
    const sx = (d.x - cam.x) * ts + W / 2;
    const sy = (d.y - cam.y) * ts + H / 2 + Math.sin(d.bob) * 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, d.life / 2);
    if (typeof d.id === 'number' && getSoftTex(d.id)) {
      ctx.drawImage(getSoftTex(d.id), sx - 8, sy - 8, 16, 16);
    } else if (typeof d.id === 'number' && getCubeTex(d.id)) {
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
