'use strict';

/**
 * High-quality 2.5D Blockheads-style renderer:
 * textured cubes, ambient occlusion, clouds, day/night, sprite player.
 */

function skyColors(timeOfDay) {
  const t = timeOfDay;
  const day = Math.sin(t * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
  const top = lerpColor('#07071c', '#3d7ec4', day);
  const mid = lerpColor('#101028', '#7eb6e8', day);
  const bot = lerpColor('#1a1430', '#d4e8f8', Math.min(1, day * 1.12));
  const rise = Math.max(0, 1 - Math.abs(t - 0.25) * 11);
  const set = Math.max(0, 1 - Math.abs(t - 0.75) * 11);
  const warm = Math.max(rise, set);
  return {
    top: mixHex(top, '#ff7a3a', warm * 0.5),
    mid: mixHex(mid, '#ffb04a', warm * 0.4),
    bot: mixHex(bot, '#ffd8a8', warm * 0.3),
    day,
    warm,
    sunAngle: t,
  };
}

function lerpColor(a, b, t) { return mixHex(a, b, t); }

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

function mixHex(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

function shadeHex(hex, mul) {
  const c = hexToRgb(hex);
  return rgbToHex(c.r * mul, c.g * mul, c.b * mul);
}

function renderWorld(ctx, world, player, inv, cam, timeOfDay, ui, particles, ents) {
  const sky = skyColors(timeOfDay);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, sky.top);
  g.addColorStop(0.45, sky.mid);
  g.addColorStop(1, sky.bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  drawCelestial(ctx, sky, timeOfDay);
  drawClouds(ctx, cam.x, sky, timeOfDay);
  drawParallax(ctx, cam.x, sky.day);

  const zoom = (cam && cam.zoom) || (ui && ui.zoom) || 1;
  const ts = TILE * zoom;
  const tilesX = Math.ceil(W / ts) + 3;
  const tilesY = Math.ceil(H / ts) + 3;
  const startTX = Math.floor(cam.x - W / (2 * ts)) - 1;
  const startTY = Math.floor(cam.y - H / (2 * ts)) - 1;

  // Cave backdrop
  for (let ty = startTY; ty <= startTY + tilesY; ty++) {
    if (ty < 0 || ty >= WORLD_H) continue;
    for (let tx = startTX; tx <= startTX + tilesX; tx++) {
      const wx = wrapX(tx);
      const t = getTile(world, wx, ty);
      if (t !== BLOCK.AIR && t !== BLOCK.WATER) continue;
      if (ty > world.surface[wx] + 1) {
        const sx = (tx - cam.x) * ts + W / 2;
        const sy = (ty - cam.y) * ts + H / 2;
        const depth = Math.min(1, (ty - world.surface[wx]) / 20);
        ctx.fillStyle = mixHex('#252536', '#12121c', depth);
        ctx.fillRect(sx, sy, ts + 0.6, ts + 0.6);
        // subtle rock noise
        if (((wx * 13 + ty * 7) & 7) === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.02)';
          ctx.fillRect(sx + 4, sy + 6, 3, 2);
        }
      }
    }
  }

  // Solid blocks first, then non-solid (leaves, water, torch, ladder)
  const deferred = [];
  for (let ty = startTY; ty <= startTY + tilesY; ty++) {
    if (ty < 0 || ty >= WORLD_H) continue;
    for (let tx = startTX; tx <= startTX + tilesX; tx++) {
      const wx = wrapX(tx);
      const id = getTile(world, wx, ty);
      if (id === BLOCK.AIR) continue;
      const meta = BLOCK_META[id];
      const sx = (tx - cam.x) * ts + W / 2;
      const sy = (ty - cam.y) * ts + H / 2;
      const light = getLight(world, wx, ty) / 15;
      let dayMul = 0.28 + 0.72 * light;
      // surface gets sky light boost
      if (ty <= world.surface[wx] + 1) {
        dayMul = Math.max(dayMul, 0.35 + 0.65 * sky.day * Math.max(0.4, light));
      }
      const ao = blockAO(world, wx, ty);
      if (meta && !meta.solid && id !== BLOCK.WORKBENCH) {
        deferred.push({ sx, sy, id, dayMul, wx, ty, ao });
      } else {
        drawBlock(ctx, sx, sy, ts, id, dayMul, wx, ty, ao);
      }
    }
  }
  for (const d of deferred) {
    drawBlock(ctx, d.sx, d.sy, ts, d.id, d.dayMul, d.wx, d.ty, d.ao);
  }

  // Hover outline
  if (ui && ui.hoverTx != null && ui.hoverTy != null) {
    const htx = nearestViewX(cam.x, ui.hoverTx);
    const hsx = (htx - cam.x) * ts + W / 2;
    const hsy = (ui.hoverTy - cam.y) * ts + H / 2;
    ctx.save();
    ctx.strokeStyle = ui.mode === 'place' ? 'rgba(100,200,255,0.85)' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(hsx + 1, hsy + 1, ts - 2, ts - 2);
    ctx.restore();
  }

  // Mining crack overlay
  if (player.mining) {
    const tx = nearestViewX(cam.x, player.mining.tx);
    const sx = (tx - cam.x) * ts + W / 2;
    const sy = (player.mining.ty - cam.y) * ts + H / 2;
    const p = Math.min(1, player.mining.progress / player.mining.need);
    drawCrack(ctx, sx, sy, ts, p);
  }

  if (ents && typeof drawEntities === 'function') drawEntities(ctx, ents, cam, ts);
  if (particles) drawParticles(ctx, particles, cam, ts);

  drawPlayer(ctx, player, cam, ts);

  // Rain
  if (ui && ui.weather > 0.05) {
    drawRain(ctx, ui.weather, cam, timeOfDay);
  }

  // Night vignette
  if (sky.day < 0.55) {
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(2,2,12,${(0.55 - sky.day) * 0.95})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  drawHUD(ctx, player, inv, world, cam, ui, sky);
  if (ui.chestOpen) drawChestPanel(ctx, inv, ui);
  if (ui.bagOpen) drawBagPanel(ctx, inv, ui);
}

function drawRain(ctx, intensity, cam, timeOfDay) {
  ctx.save();
  ctx.strokeStyle = `rgba(180,210,255,${0.25 + intensity * 0.35})`;
  ctx.lineWidth = 1;
  const n = Math.floor(40 + intensity * 80);
  const t = performance.now() / 30;
  for (let i = 0; i < n; i++) {
    const x = ((i * 97 + t * 3 + (cam.x * 7)) % W + W) % W;
    const y = ((i * 53 + t * 12) % H + H) % H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2, y + 10 + intensity * 6);
    ctx.stroke();
  }
  ctx.restore();
}

function nearestViewX(camX, tileX) {
  const base = wrapX(tileX);
  let best = base;
  let bestD = Infinity;
  for (let k = -1; k <= 1; k++) {
    const c = base + k * WORLD_W;
    const d = Math.abs(c + 0.5 - camX);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Cheap corner AO: darken if neighbors solid. */
function blockAO(world, x, y) {
  let s = 0;
  if (isSolid(world, x - 1, y)) s += 0.08;
  if (isSolid(world, x + 1, y)) s += 0.08;
  if (isSolid(world, x, y - 1)) s += 0.06;
  if (isSolid(world, x, y + 1)) s += 0.1;
  return Math.min(0.35, s);
}

function drawCelestial(ctx, sky, timeOfDay) {
  const ang = timeOfDay * Math.PI * 2 - Math.PI / 2;
  const cx = W / 2 + Math.cos(ang) * (W * 0.38);
  const cy = H * 0.38 + Math.sin(ang) * (H * 0.3);

  if (sky.day > 0.12) {
    const rg = ctx.createRadialGradient(cx, cy, 4, cx, cy, 48);
    rg.addColorStop(0, sky.warm > 0.25 ? '#ffe0a0' : '#fff6b0');
    rg.addColorStop(0.35, sky.warm > 0.25 ? 'rgba(255,170,60,0.55)' : 'rgba(255,230,120,0.4)');
    rg.addColorStop(1, 'rgba(255,200,80,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, cy, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = sky.warm > 0.25 ? '#ffb347' : '#ffe566';
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  const mx = W / 2 + Math.cos(ang + Math.PI) * (W * 0.38);
  const my = H * 0.38 + Math.sin(ang + Math.PI) * (H * 0.3);
  if (sky.day < 0.6) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(230,230,255,${(1 - sky.day) * 0.95})`;
    ctx.arc(mx, my, 13, 0, Math.PI * 2);
    ctx.fill();
    // crescent shadow
    ctx.fillStyle = sky.top;
    ctx.beginPath();
    ctx.arc(mx + 5, my - 2, 11, 0, Math.PI * 2);
    ctx.fill();
    // stars
    for (let i = 0; i < 48; i++) {
      const sx = ((i * 97 + 13) % W);
      const sy = ((i * 53 + 7) % (H * 0.48));
      const tw = 0.45 + 0.55 * Math.sin(timeOfDay * 18 + i * 1.7);
      ctx.globalAlpha = (1 - sky.day) * tw * 0.85;
      ctx.fillStyle = '#fff';
      const sz = 1 + (i % 3 === 0 ? 1 : 0);
      ctx.fillRect(sx, sy, sz, sz);
    }
    ctx.globalAlpha = 1;
  }
}

function drawClouds(ctx, camX, sky, timeOfDay) {
  if (sky.day < 0.15) return;
  const img = textures.clouds;
  const t = timeOfDay;
  ctx.save();
  ctx.globalAlpha = 0.25 + sky.day * 0.45;
  for (let i = 0; i < 5; i++) {
    const parallax = 0.08 + i * 0.03;
    const base = (i * 180 + camX * TILE * parallax + t * 40 * (i % 2 === 0 ? 1 : -0.5));
    const x = ((base % (W + 200)) + W + 200) % (W + 200) - 100;
    const y = 40 + i * 28 + Math.sin(t * 6 + i) * 6;
    const sc = 0.55 + (i % 3) * 0.18;
    if (img) {
      ctx.drawImage(img, x, y, 180 * sc, 70 * sc);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(x + 40, y + 20, 40 * sc, 16 * sc, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 70, y + 16, 30 * sc, 18 * sc, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 20, y + 22, 24 * sc, 12 * sc, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawParallax(ctx, camX, day) {
  ctx.save();
  const far = mixHex('#3a5c48', '#151a28', 1 - day);
  const near = mixHex('#2d4a38', '#1a2030', 1 - day);
  for (let layer = 0; layer < 3; layer++) {
    const parallax = 0.12 + layer * 0.08;
    const yBase = H * (0.52 + layer * 0.07);
    const amp = 34 - layer * 8;
    ctx.fillStyle = layer === 0 ? shadeHex(far, 0.75) : layer === 1 ? far : near;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) {
      const wx = camX * parallax + x / TILE;
      const n = Math.sin(wx * 0.32) * 0.55 + Math.sin(wx * 0.11 + layer * 2) * 0.35 + Math.sin(wx * 0.7) * 0.1;
      ctx.lineTo(x, yBase + n * amp);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.globalAlpha = 0.28 + layer * 0.14;
    ctx.fill();
  }
  ctx.restore();
}

function drawBlock(ctx, sx, sy, ts, id, lightMul, wx, ty, ao) {
  const m = BLOCK_META[id];
  if (!m || !m.color) return;
  ao = ao || 0;
  const alpha = m.alpha != null ? m.alpha : 1;
  const cube = typeof getCubeTex === 'function' ? getCubeTex(id) : null;
  const face = typeof getTileTex === 'function' ? getTileTex(id) : null;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Lighting via canvas filter-ish multiply overlay after draw
  const depth = Math.max(3, ts * 0.18);

  const useFlat = id === BLOCK.WATER || id === BLOCK.TORCH || id === BLOCK.LADDER
    || id === BLOCK.LEAVES || id === BLOCK.GLASS || id === BLOCK.PLATFORM || id === BLOCK.CAMPFIRE;
  if (cube && !useFlat) {
    ctx.imageSmoothingEnabled = false;
    // slight lift for solid blocks
    ctx.drawImage(cube, sx - 1, sy - 1, ts + 2, ts + 2);
  } else if (face && !useFlat) {
    ctx.imageSmoothingEnabled = false;
    // 2.5D from face live
    drawTexturedCube(ctx, sx, sy, ts, face, id);
  } else if (face && useFlat && id !== BLOCK.WATER && id !== BLOCK.TORCH && id !== BLOCK.LADDER && id !== BLOCK.LEAVES) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(face, sx, sy, ts, ts);
  } else if (!face && !cube) {
    // color fallback
    const base = shadeHex(m.color, 0.5 + 0.5 * lightMul);
    const topC = shadeHex(m.top || m.color, 0.6 + 0.45 * lightMul);
    ctx.fillStyle = topC;
    ctx.beginPath();
    ctx.moveTo(sx, sy + depth);
    ctx.lineTo(sx + depth, sy);
    ctx.lineTo(sx + ts, sy);
    ctx.lineTo(sx + ts - depth, sy + depth);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = base;
    ctx.fillRect(sx, sy + depth, ts - depth, ts - depth);
  }

  // Special animated overlays
  if (id === BLOCK.LAVA) {
    const flicker = 0.5 + 0.5 * Math.sin(performance.now() / 180 + wx * 0.8 + ty * 0.5);
    const lg = ctx.createRadialGradient(sx + ts * 0.5, sy + ts * 0.5, 2, sx + ts * 0.5, sy + ts * 0.5, ts * 0.7);
    lg.addColorStop(0, `rgba(255,230,80,${0.35 * flicker})`);
    lg.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = lg;
    ctx.fillRect(sx, sy, ts, ts);
  }
  if (id === BLOCK.WATER) {
    ctx.globalAlpha = 0.75;
    if (face) ctx.drawImage(face, sx, sy, ts, ts);
    else {
      ctx.fillStyle = 'rgba(50,140,210,0.55)';
      ctx.fillRect(sx, sy, ts, ts);
    }
    const wave = Math.sin(performance.now() / 350 + wx * 0.9) * 2;
    ctx.fillStyle = 'rgba(200,240,255,0.2)';
    ctx.fillRect(sx + 2, sy + 4 + wave, ts - 4, 3);
  }
  if (id === BLOCK.TORCH) {
    if (face) ctx.drawImage(face, sx, sy, ts, ts);
    else {
      ctx.fillStyle = '#5a3a1a';
      ctx.fillRect(sx + ts * 0.42, sy + ts * 0.4, ts * 0.16, ts * 0.5);
      ctx.fillStyle = '#ffcc44';
      ctx.beginPath();
      ctx.arc(sx + ts * 0.5, sy + ts * 0.32, ts * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    const flicker = 0.7 + 0.3 * Math.sin(performance.now() / 90 + wx);
    ctx.globalAlpha = 0.35 * flicker;
    ctx.fillStyle = '#ffaa33';
    ctx.beginPath();
    ctx.arc(sx + ts * 0.5, sy + ts * 0.3, ts * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  if (id === BLOCK.LADDER) {
    if (face) {
      ctx.globalAlpha = 1;
      ctx.drawImage(face, sx, sy, ts, ts);
    }
  }
  if (id === BLOCK.LEAVES && face) {
    ctx.globalAlpha = 0.92;
    ctx.drawImage(face, sx, sy, ts, ts);
  }
  // Procedural furniture / specials
  if (id === BLOCK.DOOR || id === BLOCK.BED || id === BLOCK.CHEST || id === BLOCK.FURNACE
      || id === BLOCK.PLATFORM || id === BLOCK.CAMPFIRE) {
    if (face && id !== BLOCK.PLATFORM && id !== BLOCK.CAMPFIRE) {
      ctx.globalAlpha = 1;
      ctx.drawImage(face, sx, sy, ts, ts);
    } else {
      drawFurniture(ctx, sx, sy, ts, id, lightMul);
    }
  }

  // Light multiply + AO
  const shade = Math.max(0.15, lightMul * (1 - ao));
  if (shade < 0.98 && id !== BLOCK.TORCH && id !== BLOCK.LAVA) {
    ctx.globalAlpha = 1 - shade;
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(sx, sy, ts + 0.5, ts + 0.5);
  }

  // Grass fringe when air above
  if (id === BLOCK.GRASS) {
    ctx.globalAlpha = 0.9 * lightMul;
    ctx.fillStyle = '#7dca4a';
    for (let i = 0; i < 5; i++) {
      const bx = sx + 3 + i * (ts / 5);
      const bh = 3 + ((wx * 3 + i * 7 + ty) % 4);
      ctx.fillRect(bx, sy - bh + 2, 2, bh);
    }
  }

  ctx.restore();
}

function drawTexturedCube(ctx, sx, sy, ts, face, id) {
  const depth = Math.max(3, ts * 0.18);
  ctx.imageSmoothingEnabled = false;

  // Top
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy + depth);
  ctx.lineTo(sx + depth, sy);
  ctx.lineTo(sx + ts, sy);
  ctx.lineTo(sx + ts - depth, sy + depth);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 1.1;
  ctx.drawImage(face, sx, sy - 2, ts, depth + 6);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();
  ctx.restore();

  // Front
  ctx.drawImage(face, sx, sy + depth, ts - depth, ts - depth);

  // Right
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx + ts - depth, sy + depth);
  ctx.lineTo(sx + ts, sy);
  ctx.lineTo(sx + ts, sy + ts - depth);
  ctx.lineTo(sx + ts - depth, sy + ts);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(face, sx + ts - depth - 2, sy, depth + 4, ts);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  ctx.restore();
}

function drawFurniture(ctx, sx, sy, ts, id, lightMul) {
  const L = 0.5 + 0.5 * lightMul;
  if (id === BLOCK.PLATFORM) {
    ctx.fillStyle = shadeHex('#c4a060', L);
    ctx.fillRect(sx + 1, sy + ts * 0.35, ts - 2, ts * 0.22);
    ctx.fillStyle = shadeHex('#8a6a30', L);
    ctx.fillRect(sx + 2, sy + ts * 0.52, 3, ts * 0.2);
    ctx.fillRect(sx + ts - 5, sy + ts * 0.52, 3, ts * 0.2);
    return;
  }
  if (id === BLOCK.CAMPFIRE) {
    ctx.fillStyle = shadeHex('#5a3a1a', L);
    ctx.fillRect(sx + ts * 0.2, sy + ts * 0.65, ts * 0.6, 4);
    ctx.strokeStyle = shadeHex('#6a4020', L);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx + 6, sy + ts * 0.7);
    ctx.lineTo(sx + ts - 6, sy + ts * 0.45);
    ctx.moveTo(sx + ts - 6, sy + ts * 0.7);
    ctx.lineTo(sx + 6, sy + ts * 0.45);
    ctx.stroke();
    const f = 0.6 + 0.4 * Math.sin(performance.now() / 120);
    ctx.fillStyle = `rgba(255,140,40,${0.7 * f})`;
    ctx.beginPath();
    ctx.moveTo(sx + ts * 0.5, sy + ts * 0.25);
    ctx.lineTo(sx + ts * 0.35, sy + ts * 0.6);
    ctx.lineTo(sx + ts * 0.65, sy + ts * 0.6);
    ctx.fill();
    ctx.fillStyle = `rgba(255,220,80,${0.8 * f})`;
    ctx.beginPath();
    ctx.arc(sx + ts * 0.5, sy + ts * 0.48, ts * 0.1, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (id === BLOCK.DOOR) {
    ctx.fillStyle = shadeHex('#a07840', L);
    ctx.fillRect(sx + ts * 0.15, sy + 2, ts * 0.7, ts - 4);
    ctx.fillStyle = shadeHex('#6a4820', L);
    ctx.fillRect(sx + ts * 0.15, sy + 2, 3, ts - 4);
    ctx.fillStyle = '#ddd';
    ctx.beginPath();
    ctx.arc(sx + ts * 0.7, sy + ts * 0.55, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === BLOCK.BED) {
    ctx.fillStyle = shadeHex('#8b5a2b', L);
    ctx.fillRect(sx + 2, sy + ts * 0.55, ts - 4, ts * 0.4);
    ctx.fillStyle = shadeHex('#e87890', L);
    ctx.fillRect(sx + 3, sy + ts * 0.35, ts - 6, ts * 0.28);
    ctx.fillStyle = shadeHex('#f0e8e0', L);
    ctx.fillRect(sx + 3, sy + ts * 0.28, ts * 0.35, ts * 0.14);
  } else if (id === BLOCK.CHEST) {
    ctx.fillStyle = shadeHex('#b8863a', L);
    ctx.fillRect(sx + 3, sy + ts * 0.3, ts - 6, ts * 0.65);
    ctx.fillStyle = shadeHex('#8a6020', L);
    ctx.fillRect(sx + 3, sy + ts * 0.52, ts - 6, 3);
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(sx + ts * 0.45, sy + ts * 0.48, ts * 0.12, ts * 0.12);
  } else if (id === BLOCK.FURNACE) {
    ctx.fillStyle = shadeHex('#5a5a62', L);
    ctx.fillRect(sx + 2, sy + 4, ts - 4, ts - 6);
    ctx.fillStyle = `rgba(255,120,40,${0.4 + 0.3 * Math.sin(performance.now() / 200)})`;
    ctx.fillRect(sx + ts * 0.28, sy + ts * 0.45, ts * 0.44, ts * 0.28);
    ctx.fillStyle = shadeHex('#3a3a42', L);
    ctx.fillRect(sx + ts * 0.2, sy + ts * 0.2, ts * 0.6, ts * 0.12);
  }
}

function drawCrack(ctx, sx, sy, ts, p) {
  const stage = Math.min(4, Math.floor(p * 5));
  if (textures.crack && textures.crack[stage]) {
    ctx.globalAlpha = 0.55 + p * 0.4;
    ctx.drawImage(textures.crack[stage], sx, sy, ts, ts);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.save();
  ctx.strokeStyle = `rgba(0,0,0,${0.35 + p * 0.5})`;
  ctx.lineWidth = 1.5;
  const cx = sx + ts / 2;
  const cy = sy + ts / 2;
  const arms = 3 + Math.floor(p * 4);
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + p;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * ts * 0.4 * p, cy + Math.sin(a) * ts * 0.4 * p);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayer(ctx, p, cam, ts) {
  const sx = (p.x - cam.x) * ts + W / 2;
  const sy = (p.y - cam.y) * ts + H / 2;
  const pw = p.w * ts;
  const ph = p.h * ts;

  ctx.save();
  if (p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0) {
    ctx.globalAlpha = 0.45;
  }

  // Soft ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 1, pw * 0.62, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const bob = p.onGround && Math.abs(p.vx) > 0.35 ? Math.sin(p.anim) * 2.2 : 0;
  const img = textures.player;

  // Boat under player
  if (p.inBoat) {
    ctx.fillStyle = '#8b5a2b';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 4, pw * 1.1, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c49a5a';
    ctx.fillRect(sx - pw * 0.9, sy - 10, pw * 1.8, 6);
  }

  if (img) {
    const drawW = ph * 0.72;
    const drawH = ph * 1.02;
    ctx.save();
    ctx.translate(sx, sy - drawH + bob + 2);
    if (p.facing < 0) {
      ctx.scale(-1, 1);
      ctx.translate(-drawW, 0);
    } else {
      ctx.translate(-drawW / 2, 0);
    }
    // walk squash
    if (p.onGround && Math.abs(p.vx) > 0.4) {
      const sq = 1 + Math.sin(p.anim * 2) * 0.04;
      ctx.translate(drawW / 2, drawH);
      ctx.scale(1 / sq, sq);
      ctx.translate(-drawW / 2, -drawH);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, drawW, drawH);
    ctx.restore();
  } else {
    // Procedural blockhead fallback
    const bodyTop = sy - ph + bob;
    const legW = pw * 0.28;
    const stride = p.onGround ? Math.sin(p.anim) * 3 : 0;
    ctx.fillStyle = '#3d5a80';
    ctx.fillRect(sx - pw * 0.32, sy - ph * 0.35 + stride, legW, ph * 0.35);
    ctx.fillRect(sx + pw * 0.05, sy - ph * 0.35 - stride, legW, ph * 0.35);
    ctx.fillStyle = '#ee6c4d';
    roundRect(ctx, sx - pw * 0.42, bodyTop + ph * 0.28, pw * 0.84, ph * 0.42, 3);
    ctx.fill();
    const hs = pw * 0.9;
    // cube head with top face
    ctx.fillStyle = '#e8c49a';
    roundRect(ctx, sx - hs / 2, bodyTop, hs, hs * 0.95, 3);
    ctx.fill();
    ctx.fillStyle = '#f4d6b0';
    ctx.fillRect(sx - hs / 2 + 1, bodyTop + 1, hs - 2, 4);
    ctx.fillStyle = '#5c3317';
    roundRect(ctx, sx - hs / 2, bodyTop, hs, hs * 0.3, 3);
    ctx.fill();
    ctx.fillStyle = '#222';
    const eyeX = p.facing >= 0 ? 0.1 : -0.25;
    ctx.fillRect(sx + hs * eyeX, bodyTop + hs * 0.45, 3.5, 3.5);
    ctx.fillRect(sx + hs * (eyeX + 0.32), bodyTop + hs * 0.45, 3.5, 3.5);
  }

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHUD(ctx, player, inv, world, cam, ui, sky) {
  // Frosted panels
  drawBar(ctx, 12, 12, 124, 12, player.hp / player.maxHp, '#e74c3c', '♥');
  drawBar(ctx, 12, 27, 124, 10, player.hunger != null ? player.hunger / player.maxHunger : 1, '#e67e22', '🍖');
  drawBar(ctx, 12, 40, 124, 10, player.energy / player.maxEnergy, '#f1c40f', '⚡');

  ctx.fillStyle = 'rgba(8,16,12,0.5)';
  roundRect(ctx, W - 128, 10, 116, 52, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.stroke();
  ctx.fillStyle = '#e8fff0';
  ctx.font = '600 10px system-ui,sans-serif';
  ctx.textAlign = 'left';
  const circ = ((player.x % WORLD_W) + WORLD_W) % WORLD_W;
  const pct = ((circ / WORLD_W) * 100).toFixed(1);
  const wLabel = WORLD_W >= 1000 ? (WORLD_W / 1000).toFixed(WORLD_W % 1000 === 0 ? 0 : 1) + 'k' : String(WORLD_W);
  ctx.fillText(wLabel + ' blocks around', W - 120, 25);
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 13px system-ui,sans-serif';
  ctx.fillText(pct + '% lap', W - 120, 42);
  // mini progress bar
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, W - 120, 48, 100, 6, 3);
  ctx.fill();
  ctx.fillStyle = '#7dffa0';
  roundRect(ctx, W - 120, 48, Math.max(2, 100 * (circ / WORLD_W)), 6, 3);
  ctx.fill();

  // Minimap
  drawMinimap(ctx, world, player, cam);

  // Coords + biome
  const bx2 = wrapX(Math.floor(player.x));
  const by2 = Math.floor(player.y);
  const biome = typeof biomeNameAt === 'function' ? biomeNameAt(world, player.x) : '';
  ctx.fillStyle = 'rgba(6,14,10,0.5)';
  roundRect(ctx, 12, 56, 150, 32, 8);
  ctx.fill();
  ctx.fillStyle = '#c8e8d8';
  ctx.font = '600 11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(biome + ' · x' + bx2 + ' y' + by2, 20, 70);
  if (player.spawnX != null) {
    ctx.fillStyle = '#7dffa0';
    ctx.font = '10px system-ui';
    ctx.fillText('Bed spawn set', 20, 84);
  } else {
    ctx.fillStyle = '#9ec5b0';
    ctx.font = '10px system-ui';
    ctx.fillText(ui.weather > 0.3 ? '🌧 Raining' : (player.inBoat ? '⛵ Sailing' : 'Explore'), 20, 84);
  }

  // Interact prompt
  if (ui.prompt) {
    ctx.fillStyle = 'rgba(6,14,10,0.65)';
    roundRect(ctx, W / 2 - 90, H - 118, 180, 26, 10);
    ctx.fill();
    ctx.fillStyle = '#e8fff0';
    ctx.font = '600 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(ui.prompt, W / 2, H - 100);
  }

  if (ui.mode === 'place') {
    ctx.fillStyle = 'rgba(60,160,255,0.9)';
    roundRect(ctx, W / 2 - 42, 10, 84, 24, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('PLACE', W / 2, 27);
  }

  // Hotbar with textured icons
  const slot = 42;
  const gap = 5;
  const total = HOTBAR_SIZE * slot + (HOTBAR_SIZE - 1) * gap;
  const hx = (W - total) / 2;
  const hy = H - 60;
  // tray
  ctx.fillStyle = 'rgba(6,14,10,0.55)';
  roundRect(ctx, hx - 8, hy - 8, total + 16, slot + 16, 14);
  ctx.fill();

  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const x = hx + i * (slot + gap);
    const sel = i === inv.selected;
    ctx.fillStyle = sel ? 'rgba(125,255,160,0.18)' : 'rgba(0,0,0,0.4)';
    roundRect(ctx, x, hy, slot, slot, 10);
    ctx.fill();
    ctx.strokeStyle = sel ? '#7dffa0' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = sel ? 2.2 : 1;
    ctx.stroke();
    const s = inv.hotbar[i];
    if (s) {
      drawItemIcon(ctx, x + 5, hy + 5, slot - 10, s.id);
      if (s.count > 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        roundRect(ctx, x + slot - 20, hy + slot - 16, 18, 13, 4);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '700 11px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText(String(s.count), x + slot - 4, hy + slot - 5);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '600 9px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(String(i + 1), x + 5, hy + 12);
  }

  ctx.fillStyle = 'rgba(6,14,10,0.5)';
  roundRect(ctx, 10, H - 102, 140, 30, 10);
  ctx.fill();
  ctx.fillStyle = '#e8fff0';
  ctx.font = '600 11px system-ui';
  ctx.textAlign = 'left';
  const tname = (TOOLS[inv.tool] && TOOLS[inv.tool].name) || 'Hands';
  ctx.fillText('Tool: ' + tname, 18, H - 83);

  if (ui.craftOpen) drawCraftPanel(ctx, inv, world, player, ui);

  if (ui.showTouch) {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.arc(70, H - 160, 50, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(W - 70, H - 160, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '700 12px system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText('JUMP', W - 70, H - 156);
  }

  if (ui.toast && ui.toastT > 0) {
    ctx.globalAlpha = Math.min(1, ui.toastT * 2);
    ctx.fillStyle = 'rgba(6,14,10,0.72)';
    roundRect(ctx, W / 2 - 130, 56, 260, 34, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '600 13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(ui.toast, W / 2, 78);
    ctx.globalAlpha = 1;
  }
}

function drawBar(ctx, x, y, w, h, pct, color, icon) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  const pw = Math.max(0, (w - 2) * Math.max(0, Math.min(1, pct)));
  if (pw > 0) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, color);
    g.addColorStop(1, shadeHex(color, 0.7));
    ctx.fillStyle = g;
    roundRect(ctx, x + 1, y + 1, pw, h - 2, 5);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.font = '700 10px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(icon, x + 4, y + h - 2);
}

function drawItemIcon(ctx, x, y, s, id) {
  if (isTool(id)) {
    const metal = id.indexOf('gold') >= 0 ? '#ffd700' : id.indexOf('iron') >= 0 ? '#c5ced6' : id.indexOf('stone') >= 0 ? '#8a9098' : '#c4a060';
    ctx.strokeStyle = '#6b4420';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.45, y + s * 0.95);
    ctx.lineTo(x + s * 0.55, y + s * 0.35);
    ctx.stroke();
    ctx.fillStyle = metal;
    ctx.beginPath();
    if (id.indexOf('axe') >= 0) {
      ctx.moveTo(x + s * 0.2, y + s * 0.25);
      ctx.lineTo(x + s * 0.85, y + s * 0.15);
      ctx.lineTo(x + s * 0.75, y + s * 0.5);
      ctx.closePath();
    } else {
      ctx.moveTo(x + s * 0.15, y + s * 0.35);
      ctx.lineTo(x + s * 0.85, y + s * 0.18);
      ctx.lineTo(x + s * 0.85, y + s * 0.48);
      ctx.closePath();
    }
    ctx.fill();
    return;
  }
  if (id === 'stick') {
    ctx.strokeStyle = '#a07040';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 5, y + s - 5);
    ctx.lineTo(x + s - 5, y + 5);
    ctx.stroke();
    return;
  }
  if (isFood(id) && FOOD[id]) {
    ctx.fillStyle = FOOD[id].color;
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(x + s * 0.38, y + s * 0.38, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (id === 'iron_ingot' || id === 'gold_ingot' || id === 'copper_ingot') {
    ctx.fillStyle = id.indexOf('gold') >= 0 ? '#ffd700' : id.indexOf('copper') >= 0 ? '#e07a40' : '#b0b8c0';
    roundRect(ctx, x + 4, y + s * 0.3, s - 8, s * 0.4, 4);
    ctx.fill();
    return;
  }
  if (id === 'boat') {
    ctx.fillStyle = '#8b5a2b';
    ctx.beginPath();
    ctx.ellipse(x + s / 2, y + s * 0.6, s * 0.4, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c49a5a';
    ctx.fillRect(x + s * 0.15, y + s * 0.4, s * 0.7, s * 0.15);
    return;
  }
  if (id === 'bucket' || id === 'bucket_water') {
    ctx.fillStyle = '#888';
    ctx.fillRect(x + s * 0.25, y + s * 0.35, s * 0.5, s * 0.45);
    ctx.fillStyle = id === 'bucket_water' ? '#3a8fd4' : '#aaa';
    ctx.fillRect(x + s * 0.3, y + s * 0.4, s * 0.4, s * 0.25);
    return;
  }
  if (typeof id === 'number') {
    const cube = typeof getCubeTex === 'function' ? getCubeTex(id) : null;
    const face = typeof getTileTex === 'function' ? getTileTex(id) : null;
    ctx.imageSmoothingEnabled = false;
    if (cube) ctx.drawImage(cube, x, y, s, s);
    else if (face) ctx.drawImage(face, x, y, s, s);
    else if (BLOCK_META[id]) drawBlock(ctx, x, y, s, id, 1, 0, 0, 0);
  }
}

function drawMinimap(ctx, world, player, cam) {
  const mw = 88;
  const mh = 56;
  const mx = W - mw - 12;
  const my = 70;
  ctx.fillStyle = 'rgba(6,14,10,0.55)';
  roundRect(ctx, mx - 4, my - 4, mw + 8, mh + 8, 8);
  ctx.fill();

  const spanX = 80; // tiles shown
  const spanY = 48;
  const pxPer = mw / spanX;
  const pyPer = mh / spanY;
  const originX = player.x - spanX / 2;
  const originY = player.y - spanY / 2;

  for (let sy = 0; sy < mh; sy += 2) {
    for (let sx = 0; sx < mw; sx += 2) {
      const tx = Math.floor(originX + sx / pxPer);
      const ty = Math.floor(originY + sy / pyPer);
      if (ty < 0 || ty >= WORLD_H) continue;
      const id = getTile(world, tx, ty);
      if (id === BLOCK.AIR) continue;
      let col = '#445';
      if (id === BLOCK.GRASS || id === BLOCK.LEAVES) col = '#4a8';
      else if (id === BLOCK.DIRT || id === BLOCK.WOOD || id === BLOCK.PLANKS) col = '#864';
      else if (id === BLOCK.STONE || id === BLOCK.COAL) col = '#778';
      else if (id === BLOCK.WATER) col = '#48c';
      else if (id === BLOCK.LAVA) col = '#f50';
      else if (id === BLOCK.SAND) col = '#db6';
      else if (id === BLOCK.SNOW) col = '#eef';
      else if (id === BLOCK.IRON || id === BLOCK.GOLD || id === BLOCK.COPPER) col = '#fc5';
      ctx.fillStyle = col;
      ctx.fillRect(mx + sx, my + sy, 2, 2);
    }
  }
  // Player blip
  ctx.fillStyle = '#fff';
  ctx.fillRect(mx + mw / 2 - 2, my + mh / 2 - 2, 4, 4);
  ctx.strokeStyle = '#7dffa0';
  ctx.strokeRect(mx - 4.5, my - 4.5, mw + 8, mh + 8);
}

function drawChestPanel(ctx, inv, ui) {
  const pw = 320;
  const ph = 360;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2 - 10;
  ctx.fillStyle = 'rgba(10, 22, 18, 0.96)';
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(212,160,74,0.4)';
  ctx.stroke();
  ctx.fillStyle = '#d4a04a';
  ctx.font = '700 18px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('Chest', W / 2, py + 28);
  ctx.fillStyle = '#9ec5b0';
  ctx.font = '12px system-ui';
  ctx.fillText('Tap chest items → inventory · hotbar → chest', W / 2, py + 48);

  ui.chestHit = [];
  const slots = ui.chestOpen.slots;
  const cell = 36;
  const gap = 6;
  const cols = 4;
  let startY = py + 64;
  for (let i = 0; i < slots.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = px + 40 + col * (cell + gap);
    const y = startY + row * (cell + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, x, y, cell, cell, 8);
    ctx.fill();
    if (slots[i]) {
      drawItemIcon(ctx, x + 4, y + 4, cell - 8, slots[i].id);
      if (slots[i].count > 1) {
        ctx.fillStyle = '#fff';
        ctx.font = '700 10px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText(String(slots[i].count), x + cell - 3, y + cell - 4);
      }
    }
    ui.chestHit.push({ from: 'chest', i, x, y, w: cell, h: cell });
  }

  ctx.fillStyle = '#7dffa0';
  ctx.font = '600 13px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('Hotbar', W / 2, py + 240);
  const hx = px + 24;
  const hy = py + 252;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const x = hx + i * (cell + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, x, hy, cell, cell, 8);
    ctx.fill();
    const s = inv.hotbar[i];
    if (s) {
      drawItemIcon(ctx, x + 4, hy + 4, cell - 8, s.id);
      if (s.count > 1) {
        ctx.fillStyle = '#fff';
        ctx.font = '700 10px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText(String(s.count), x + cell - 3, hy + cell - 4);
      }
    }
    ui.chestHit.push({ from: 'hotbar', i, x, y: hy, w: cell, h: cell });
  }
  ctx.fillStyle = '#8899aa';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('C / E to close', W / 2, py + ph - 16);
}

function drawBagPanel(ctx, inv, ui) {
  const pw = 300;
  const ph = 340;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2 - 10;
  ctx.fillStyle = 'rgba(10, 22, 18, 0.96)';
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(125,255,160,0.3)';
  ctx.stroke();
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 18px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('Backpack', W / 2, py + 28);
  ctx.fillStyle = '#9ec5b0';
  ctx.font = '12px system-ui';
  ctx.fillText('I / B to close · items auto-stack to hotbar', W / 2, py + 48);

  const cell = 34;
  const gap = 6;
  const cols = 6;
  for (let i = 0; i < inv.bag.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = px + 28 + col * (cell + gap);
    const y = py + 64 + row * (cell + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, x, y, cell, cell, 8);
    ctx.fill();
    const s = inv.bag[i];
    if (s) {
      drawItemIcon(ctx, x + 3, y + 3, cell - 6, s.id);
      if (s.count > 1) {
        ctx.fillStyle = '#fff';
        ctx.font = '700 10px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText(String(s.count), x + cell - 3, y + cell - 4);
      }
    }
  }
}

function drawCraftPanel(ctx, inv, world, player, ui) {
  const pw = 328;
  const ph = 430;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2 - 16;
  ctx.fillStyle = 'rgba(10, 22, 18, 0.96)';
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(125,255,160,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 20px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('Crafting', W / 2, py + 30);
  const at = nearWorkbench(world, player.x, player.y);
  ctx.fillStyle = at ? '#a8d4c0' : '#ffc06a';
  ctx.font = '12px system-ui';
  ctx.fillText(at ? 'Workbench nearby — full recipes' : 'Hand craft · place a Workbench for tools', W / 2, py + 50);

  const recipes = availableRecipes(inv, world, player.x, player.y);
  const startY = py + 66;
  const rowH = 38;
  ui.craftHit = [];
  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    const y = startY + i * rowH;
    if (y + rowH > py + ph - 48) break;
    const ok = canCraft(inv, r);
    ctx.fillStyle = ok ? 'rgba(125,255,160,0.14)' : 'rgba(255,255,255,0.04)';
    roundRect(ctx, px + 12, y, pw - 24, rowH - 4, 10);
    ctx.fill();
    // mini icon of output
    const outId = r.out[0];
    if (typeof outId === 'number' || isTool(outId) || outId === 'stick') {
      drawItemIcon(ctx, px + 18, y + 4, 26, outId);
    }
    ctx.fillStyle = ok ? '#f0fff6' : '#8899aa';
    ctx.font = '600 13px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(r.name, px + 50, y + 24);
    ctx.font = '11px system-ui';
    ctx.fillStyle = '#8eb5a4';
    const need = r.in.map(([id, n]) => n + '×' + itemName(id)).join(', ');
    ctx.fillText(need, px + 150, y + 24);
    ui.craftHit.push({ recipe: r, x: px + 12, y, w: pw - 24, h: rowH - 4, ok });
  }

  ctx.fillStyle = '#7a9a8a';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('Tap recipe · C / Craft to close', W / 2, py + ph - 18);
}
