import {
  W, H, TILE, WORLD_H, SURFACE_Y,
} from '../core/constants.js';
import { WORLD_W } from '../core/worldSize.js';
import { getDifficulty, creativeCatalog } from '../core/difficulty.js';
import { BLOCK, BLOCK_META, isPlatform } from '../content/blocks.js';
import { TOOLS, FOOD, isTool, isFood, isWeapon } from '../content/tools.js';
import { itemName, isBlockItem } from '../content/items.js';
import {
  wrapX, wrapDeltaX, getTile, getLight, getRenderLight, sampleLight, lightToBrightness, isSolid, biomeNameAt,
} from '../world/index.js';
import { textures, getCubeTex, getTileTex, getSoftTex, getPlayerPose, getItemIcon } from '../textures/textures.js';
import { drawEntities } from '../entities/draw.js';
import { drawParticles } from '../particles/particles.js';
import { HOTBAR_SIZE, BAG_SIZE, canCraft, bagUsed, countItem } from '../inventory/inventory.js';
import {
  CRAFT_TABS, recipesInTab, missingMaterials, stationHint,
  stationAvailable, getChest, getTorchFacing, getLanternMode,
} from '../interact/index.js';

/**
 * High-quality 2.5D Blockheads-style renderer:
 * textured cubes, ambient occlusion, clouds, day/night, sprite player.
 */

export function skyColors(timeOfDay) {
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

export function lerpColor(a, b, t) { return mixHex(a, b, t); }

export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

export function mixHex(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

export function shadeHex(hex, mul) {
  const c = hexToRgb(hex);
  return rgbToHex(c.r * mul, c.g * mul, c.b * mul);
}

export function renderWorld(ctx, world, player, inv, cam, timeOfDay, ui, particles, ents) {
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

  // Visible light emitters (torches etc.) — shared by backdrop, blocks, blooms
  const emitters = collectEmitters(world, startTX, startTY, tilesX, tilesY);
  const now = performance.now();

  // Cave backdrop + smooth dynamic light (flicker + warm pulse)
  drawSmoothCaveBackdrop(ctx, world, cam, ts, startTX, startTY, tilesX, tilesY, emitters, now);

  // Terrain → soft offscreen layer (feathered tiles + smooth light + blur) so no grid
  drawBlendedTerrainLayer(ctx, world, cam, ts, startTX, startTY, tilesX, tilesY, sky, emitters, now);

  // Non-terrain solids + deferred non-solids (leaves, water, torch, ladder)
  const deferred = [];
  for (let ty = startTY; ty <= startTY + tilesY; ty++) {
    if (ty < 0 || ty >= WORLD_H) continue;
    for (let tx = startTX; tx <= startTX + tilesX; tx++) {
      const wx = wrapX(tx);
      const id = getTile(world, wx, ty);
      if (id === BLOCK.AIR || isTerrainBlock(id)) continue;
      const meta = BLOCK_META[id];
      const sx = (tx - cam.x) * ts + W / 2;
      const sy = (ty - cam.y) * ts + H / 2;
      let lvl = (
        sampleLight(world, wx + 0.2, ty + 0.2)
        + sampleLight(world, wx + 0.8, ty + 0.2)
        + sampleLight(world, wx + 0.2, ty + 0.8)
        + sampleLight(world, wx + 0.8, ty + 0.8)
      ) * 0.25;
      const fl = emitterFlickerAt(wx + 0.5, ty + 0.5, emitters, now);
      if (lvl > 2) lvl = Math.min(15, lvl * (0.9 + 0.12 * fl));
      let dayMul = lightToBrightness(lvl, { ambient: 0.03 });
      const nearSurface = ty <= (world.surface[wx] || SURFACE_Y) + 1;
      if (nearSurface && lvl >= 8) {
        const skyMul = 0.2 + 0.8 * sky.day;
        dayMul = Math.max(dayMul, skyMul * lightToBrightness(lvl, { ambient: 0.15 }));
      }
      if (!nearSurface && lvl > 5) {
        dayMul = Math.min(1.15, dayMul * (1 + (lvl / 15) * 0.12 * fl));
      }
      const ao = blockAO(world, wx, ty);
      if (meta && !meta.solid && id !== BLOCK.WORKBENCH) {
        deferred.push({ sx, sy, id, dayMul, wx, ty, ao });
      } else {
        drawBlock(ctx, sx, sy, ts, id, dayMul, wx, ty, ao, world);
      }
    }
  }
  for (const d of deferred) {
    drawBlock(ctx, d.sx, d.sy, ts, d.id, d.dayMul, d.wx, d.ty, d.ao, world);
  }

  // Multi-layer dancing blooms (core + mid + outer)
  drawEmitterBlooms(ctx, world, cam, ts, emitters, now);

  // Hover outline
  if (ui && ui.hoverTx != null && ui.hoverTy != null) {
    const htx = nearestViewX(cam.x, ui.hoverTx);
    const hsx = (htx - cam.x) * ts + W / 2;
    const hsy = (ui.hoverTy - cam.y) * ts + H / 2;
    ctx.save();
    // White while aiming; blue-ish when placing (not hold-mining)
    ctx.strokeStyle = (ui.hoverTx != null && ui.holdMining)
      ? 'rgba(255,200,100,0.9)'
      : 'rgba(140,210,255,0.85)';
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

  if (ents) drawEntities(ctx, ents, cam, ts);
  if (particles) drawParticles(ctx, particles, cam, ts);

  drawPlayer(ctx, player, cam, ts, inv);

  // Rain only outdoors (at / near surface) — never underground
  if (ui && ui.weather > 0.05) {
    const pCol = wrapX(Math.floor(player.x));
    const surfY = (world.surface && world.surface[pCol] != null)
      ? world.surface[pCol]
      : SURFACE_Y;
    // y increases downward: deeper = larger y. Only rain if near or above surface.
    if (player.y <= surfY + 1.25) {
      drawRain(ctx, ui.weather, cam, timeOfDay);
    }
  }

  // Local darkness around the player when underground / unlit
  // Soften strongly when standing in torch light so blooms aren't crushed.
  {
    const pLight = sampleLight(world, player.x, player.y - player.h * 0.5);
    const bri = lightToBrightness(pLight, { ambient: 0.03 });
    const under = player.y > (world.surface[wrapX(Math.floor(player.x))] || SURFACE_Y) + 2;
    if (under || pLight < 11) {
      // Less vignette when well-lit (torch nearby)
      const litRelief = Math.min(1, pLight / 12);
      const darkness = (under ? (1 - bri) * 0.62 : (1 - bri) * 0.38) * (1 - litRelief * 0.55);
      if (darkness > 0.06) {
        const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.12, W / 2, H / 2, H * 0.78);
        v.addColorStop(0, `rgba(0,0,0,${darkness * 0.08})`);
        v.addColorStop(0.5, `rgba(0,0,0,${darkness * 0.4})`);
        v.addColorStop(1, `rgba(0,0,0,${Math.min(0.88, darkness * 0.9)})`);
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, W, H);
      }
    }
  }

  // Night surface vignette
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
  if (ui.creativeOpen) drawCreativePanel(ctx, inv, ui);
  // Drag ghost + tooltip on top of any open menu
  if (ui.bagOpen || ui.creativeOpen || ui.chestOpen) {
    drawInvDragGhost(ctx, ui);
    drawHoverTip(ctx, ui);
  }
}

export function drawRain(ctx, intensity, cam, timeOfDay) {
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

export function nearestViewX(camX, tileX) {
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

/** Soft ambient occlusion — very light so it doesn't outline every tile. */
export function blockAO(world, x, y) {
  let s = 0;
  if (isSolid(world, x - 1, y)) s += 0.01;
  if (isSolid(world, x + 1, y)) s += 0.01;
  if (isSolid(world, x, y - 1)) s += 0.008;
  if (isSolid(world, x, y + 1)) s += 0.012;
  return Math.min(0.04, s);
}

/** Offscreen buffers for seamless terrain compositing. */
let _terrainLayer = null;
let _terrainLayerCtx = null;
let _terrainLight = null;
let _terrainLightCtx = null;

/**
 * Draw all terrain tiles onto a soft layer:
 * 1) full-bright feathered textures with heavy overlap
 * 2) smooth light multiply (no per-tile black squares)
 * 3) slight blur so remaining seams melt
 */
function drawBlendedTerrainLayer(ctx, world, cam, ts, startTX, startTY, tilesX, tilesY, sky, emitters, now) {
  if (!_terrainLayer) {
    _terrainLayer = document.createElement('canvas');
    _terrainLayerCtx = _terrainLayer.getContext('2d');
    _terrainLight = document.createElement('canvas');
    _terrainLightCtx = _terrainLight.getContext('2d');
  }
  if (_terrainLayer.width !== W || _terrainLayer.height !== H) {
    _terrainLayer.width = W;
    _terrainLayer.height = H;
    _terrainLight.width = W;
    _terrainLight.height = H;
  }
  const tctx = _terrainLayerCtx;
  const lctx = _terrainLightCtx;
  tctx.clearRect(0, 0, W, H);
  lctx.clearRect(0, 0, W, H);

  // Build a smooth light field at ~3 samples/tile, upscale with bilinear
  const RES = 3;
  const padT = 1;
  const tw = tilesX + 2 + padT * 2;
  const th = tilesY + 2 + padT * 2;
  const bw = Math.max(1, tw * RES);
  const bh = Math.max(1, th * RES);
  const otx = startTX - padT;
  const oty = startTY - padT;

  // Small light field canvas
  if (!drawBlendedTerrainLayer._lf) {
    drawBlendedTerrainLayer._lf = document.createElement('canvas');
    drawBlendedTerrainLayer._lfc = drawBlendedTerrainLayer._lf.getContext('2d', { willReadFrequently: true });
  }
  const lf = drawBlendedTerrainLayer._lf;
  const lfc = drawBlendedTerrainLayer._lfc;
  if (lf.width !== bw || lf.height !== bh) {
    lf.width = bw;
    lf.height = bh;
  }
  const img = lfc.createImageData(bw, bh);
  const data = img.data;

  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const p = (j * bw + i) * 4;
      const fx = otx + (i + 0.5) / RES;
      const fy = oty + (j + 0.5) / RES;
      const tileX = Math.floor(fx);
      const tileY = Math.floor(fy);
      if (tileY < 0 || tileY >= WORLD_H) {
        data[p] = data[p + 1] = data[p + 2] = 0;
        data[p + 3] = 255;
        continue;
      }
      const wx = wrapX(tileX);
      let lvl = sampleLight(world, fx, fy);
      const fl = emitterFlickerAt(fx, fy, emitters, now);
      const dyn = dynamicEmitterBoost(fx, fy, emitters, now);
      if (dyn > 0.05) lvl = Math.min(15, lvl + dyn * fl);
      else if (lvl > 1.5) lvl = Math.min(15, lvl * (0.92 + 0.1 * fl));

      let bri = lightToBrightness(lvl, { ambient: 0.04 });
      const nearSurface = fy <= ((world.surface && world.surface[wx]) || SURFACE_Y) + 1;
      if (nearSurface && lvl >= 8 && sky) {
        const skyMul = 0.25 + 0.75 * sky.day;
        bri = Math.max(bri, skyMul * lightToBrightness(lvl, { ambient: 0.18 }));
      }
      // Keep a floor so unlit rock still reads as shape (cave backdrop is black)
      const v = Math.floor(Math.max(8, Math.min(255, bri * 255)));
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = Math.floor(v * 0.97);
      data[p + 3] = 255;
    }
  }
  lfc.putImageData(img, 0, 0);

  // Stretch smooth light field over the view
  const sx0 = (otx - cam.x) * ts + W / 2;
  const sy0 = (oty - cam.y) * ts + H / 2;
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = 'high';
  lctx.drawImage(lf, sx0, sy0, tw * ts, th * ts);

  // Draw terrain tiles full-bright with heavy soft overlap
  const pad = Math.max(3.5, ts * 0.18);
  tctx.imageSmoothingEnabled = true;
  for (let ty = startTY; ty <= startTY + tilesY; ty++) {
    if (ty < 0 || ty >= WORLD_H) continue;
    for (let tx = startTX; tx <= startTX + tilesX; tx++) {
      const wx = wrapX(tx);
      const id = getTile(world, wx, ty);
      if (!isTerrainBlock(id)) continue;
      const soft = getSoftTex(id) || getTileTex(id);
      if (!soft) continue;
      const sx = (tx - cam.x) * ts + W / 2;
      const sy = (ty - cam.y) * ts + H / 2;
      tctx.globalAlpha = 1;
      tctx.drawImage(soft, sx - pad, sy - pad, ts + pad * 2, ts + pad * 2);
      // Soft grass top (no hard rect)
      if (id === BLOCK.GRASS || id === BLOCK.SNOW || id === BLOCK.SAND) {
        const m = BLOCK_META[id];
        const topH = Math.max(2, ts * 0.12);
        const g = tctx.createLinearGradient(sx, sy - pad, sx, sy - pad + topH + 3);
        g.addColorStop(0, m && m.top ? m.top : 'rgba(255,255,255,0.25)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        tctx.globalAlpha = 0.16;
        tctx.fillStyle = g;
        tctx.fillRect(sx - pad, sy - pad, ts + pad * 2, topH + 3);
        tctx.globalAlpha = 1;
      }
    }
  }

  // Multiply continuous light onto terrain (no square shade plates)
  tctx.save();
  tctx.globalCompositeOperation = 'multiply';
  tctx.drawImage(_terrainLight, 0, 0);
  tctx.restore();

  // Composite with a gentle blur so residual seams disappear
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'blur(1.1px)';
  ctx.drawImage(_terrainLayer, 0, 0);
  ctx.filter = 'none';
  // Second unblurred pass at low alpha keeps some texture crispness
  ctx.globalAlpha = 0.35;
  ctx.drawImage(_terrainLayer, 0, 0);
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawCelestial(ctx, sky, timeOfDay) {
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

export function drawClouds(ctx, camX, sky, timeOfDay) {
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

export function drawParallax(ctx, camX, day) {
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

/** Terrain types that should look seamless rather than toy-cubes. */
export function isTerrainBlock(id) {
  return id === BLOCK.GRASS || id === BLOCK.DIRT || id === BLOCK.STONE || id === BLOCK.SAND
    || id === BLOCK.SNOW || id === BLOCK.CLAY || id === BLOCK.COAL || id === BLOCK.IRON
    || id === BLOCK.GOLD || id === BLOCK.COPPER || id === BLOCK.BEDROCK || id === BLOCK.PLANKS
    || id === BLOCK.BRICK || id === BLOCK.WOOD;
}

/**
 * Infer torch mount face from neighboring solids (for old saves without meta).
 * Prefers walls so a torch next to a tree/wall angles off it.
 */
export function inferTorchFacing(world, tx, ty) {
  if (!world) return 'floor';
  const left = isSolid(world, tx - 1, ty);
  const right = isSolid(world, tx + 1, ty);
  const floor = isSolid(world, tx, ty + 1) || isPlatform(getTile(world, tx, ty + 1));
  const ceil = isSolid(world, tx, ty - 1);
  // Prefer walls over floor when both exist (the case in the user's screenshot)
  if (left && !right) return 'left';
  if (right && !left) return 'right';
  if (left && right) return 'left';
  if (floor) return 'floor';
  if (ceil) return 'ceil';
  return 'floor';
}

/**
 * Hanging / floor lantern — chain + metal cage + warm glow.
 * @param {'hang'|'floor'} mode
 */
export function drawLanternSprite(ctx, sx, sy, ts, mode, seed) {
  const flicker = 0.7 + 0.3 * Math.sin(performance.now() / 110 + (seed || 0));
  const hang = mode !== 'floor';
  const cx = sx + ts * 0.5;

  // Body position: hang lower from ceiling; floor sits near ground
  const cageTop = hang ? sy + ts * 0.28 : sy + ts * 0.22;
  const cageH = ts * 0.42;
  const cageW = ts * 0.38;
  const cageX = cx - cageW / 2;

  if (hang) {
    // Chain links from ceiling
    ctx.strokeStyle = '#8a9098';
    ctx.lineWidth = Math.max(1.2, ts * 0.06);
    ctx.lineCap = 'round';
    const chainTop = sy + ts * 0.04;
    const chainBot = cageTop + 2;
    // two small oval links
    const mid = (chainTop + chainBot) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, chainTop + (mid - chainTop) * 0.35, ts * 0.07, ts * 0.09, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, mid, ts * 0.07, ts * 0.09, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, mid + ts * 0.08);
    ctx.lineTo(cx, chainBot);
    ctx.stroke();
    // Ceiling hook
    ctx.strokeStyle = '#6a7078';
    ctx.lineWidth = Math.max(1.5, ts * 0.08);
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.12, sy + 2);
    ctx.lineTo(cx + ts * 0.12, sy + 2);
    ctx.stroke();
  } else {
    // Short post for floor lantern
    ctx.fillStyle = '#5a6068';
    ctx.fillRect(cx - ts * 0.05, cageTop + cageH - 2, ts * 0.1, ts * 0.28);
    ctx.fillStyle = '#3a4048';
    ctx.fillRect(cx - ts * 0.14, sy + ts * 0.88, ts * 0.28, ts * 0.08);
  }

  // Metal cap
  ctx.fillStyle = '#7a828c';
  ctx.beginPath();
  ctx.moveTo(cageX - 2, cageTop + 4);
  ctx.lineTo(cx, cageTop - ts * 0.08);
  ctx.lineTo(cageX + cageW + 2, cageTop + 4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#9aa2ac';
  ctx.fillRect(cageX - 1, cageTop + 2, cageW + 2, 3);

  // Glass body
  const glass = ctx.createLinearGradient(cageX, cageTop, cageX + cageW, cageTop + cageH);
  glass.addColorStop(0, `rgba(255, 210, 100, ${0.55 + 0.2 * flicker})`);
  glass.addColorStop(0.5, `rgba(255, 160, 50, ${0.45 + 0.2 * flicker})`);
  glass.addColorStop(1, `rgba(200, 100, 30, ${0.35 + 0.15 * flicker})`);
  ctx.fillStyle = glass;
  roundRect(ctx, cageX, cageTop + 4, cageW, cageH - 4, 3);
  ctx.fill();

  // Frame bars
  ctx.strokeStyle = '#5a626c';
  ctx.lineWidth = Math.max(1.2, ts * 0.05);
  ctx.strokeRect(cageX, cageTop + 4, cageW, cageH - 4);
  ctx.beginPath();
  ctx.moveTo(cx, cageTop + 4);
  ctx.lineTo(cx, cageTop + cageH);
  ctx.moveTo(cageX, cageTop + 4 + cageH * 0.45);
  ctx.lineTo(cageX + cageW, cageTop + 4 + cageH * 0.45);
  ctx.stroke();

  // Inner flame
  const fy = cageTop + cageH * 0.55;
  ctx.fillStyle = `rgba(255, 240, 140, ${0.9 * flicker})`;
  ctx.beginPath();
  ctx.arc(cx, fy, ts * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 180, 60, ${0.7 * flicker})`;
  ctx.beginPath();
  ctx.moveTo(cx, fy - ts * 0.14);
  ctx.lineTo(cx - ts * 0.06, fy + ts * 0.02);
  ctx.lineTo(cx + ts * 0.06, fy + ts * 0.02);
  ctx.fill();

  // Bottom plate
  ctx.fillStyle = '#6a727c';
  ctx.fillRect(cageX - 1, cageTop + cageH - 2, cageW + 2, 4);

  // Glow
  const gy = hang ? fy : fy;
  const g = ctx.createRadialGradient(cx, gy, 2, cx, gy, ts * 0.7);
  g.addColorStop(0, `rgba(255, 190, 60, ${0.38 * flicker})`);
  g.addColorStop(1, 'rgba(255, 140, 20, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, gy, ts * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Open cells that need a cave backdrop (air + torch/lantern so no gray “hole”
 * behind the sprite).
 */
function isCaveOpenTile(id) {
  return id === BLOCK.AIR || id === BLOCK.WATER || id === BLOCK.TORCH
    || id === BLOCK.LANTERN || id === BLOCK.LADDER || id === BLOCK.CAMPFIRE
    || id === BLOCK.GLASS || id === BLOCK.LEAVES || id === BLOCK.PLATFORM;
}

/** Reused offscreen buffer for smooth cave lighting. */
let _caveLightCanvas = null;
let _caveLightCtx = null;

/** Gather torch/lantern/lava emitters in the view for dynamic lighting. */
function collectEmitters(world, startTX, startTY, tilesX, tilesY) {
  const list = [];
  // Pad so off-screen torches still light the edge
  for (let ty = startTY - 2; ty <= startTY + tilesY + 2; ty++) {
    if (ty < 0 || ty >= WORLD_H) continue;
    for (let tx = startTX - 2; tx <= startTX + tilesX + 2; tx++) {
      const wx = wrapX(tx);
      const id = getTile(world, wx, ty);
      let power = 0;
      let reach = 0;
      let kind = 'torch';
      if (id === BLOCK.TORCH) {
        power = 1; reach = 9; kind = 'torch';
      } else if (id === BLOCK.LANTERN) {
        power = 1.25; reach = 11; kind = 'lantern';
      } else if (id === BLOCK.CAMPFIRE) {
        power = 1.1; reach = 8; kind = 'fire';
      } else if (id === BLOCK.LAVA) {
        power = 0.85; reach = 6; kind = 'lava';
      } else if (id === BLOCK.FURNACE) {
        power = 0.45; reach = 4; kind = 'furnace';
      } else {
        continue;
      }
      // Stable per-tile phase so each flame dances independently
      const phase = (wx * 12.9898 + ty * 78.233) * 0.017;
      list.push({
        x: wx + 0.5,
        y: ty + 0.45,
        tx, ty, wx,
        power, reach, kind, phase,
      });
    }
  }
  return list;
}

/**
 * Multi-harmonic flicker weight at a world point (1 = nominal).
 * Stronger near emitters, calm in unlit voids.
 */
function emitterFlickerAt(fx, fy, emitters, now) {
  if (!emitters || !emitters.length) return 1;
  let wSum = 0;
  let fSum = 0;
  const t = now * 0.001;
  for (let i = 0; i < emitters.length; i++) {
    const e = emitters[i];
    const dx = fx - e.x;
    // handle world wrap for x distance roughly
    let adx = dx;
    if (adx > WORLD_W * 0.5) adx -= WORLD_W;
    if (adx < -WORLD_W * 0.5) adx += WORLD_W;
    const dy = fy - e.y;
    const d = Math.sqrt(adx * adx + dy * dy);
    if (d >= e.reach) continue;
    const k = 1 - d / e.reach;
    const kk = k * k * e.power;
    // Irregular flame: 3 sines + a faster spark tick
    const ph = e.phase;
    const fl = 0.72
      + 0.16 * Math.sin(t * 6.2 + ph)
      + 0.08 * Math.sin(t * 13.7 + ph * 1.9)
      + 0.05 * Math.sin(t * 27.0 + ph * 0.4)
      + 0.04 * Math.sin(t * 41.0 + ph * 2.3);
    wSum += kk;
    fSum += fl * kk;
  }
  if (wSum < 0.02) return 1;
  return fSum / wSum;
}

/**
 * Extra dynamic brightness (0–~4 light levels) from dancing emitter cores.
 * Soft quadratic falloff so pools of light pulse without hard edges.
 */
function dynamicEmitterBoost(fx, fy, emitters, now) {
  if (!emitters || !emitters.length) return 0;
  let boost = 0;
  const t = now * 0.001;
  for (let i = 0; i < emitters.length; i++) {
    const e = emitters[i];
    let adx = fx - e.x;
    if (adx > WORLD_W * 0.5) adx -= WORLD_W;
    if (adx < -WORLD_W * 0.5) adx += WORLD_W;
    const dy = fy - e.y;
    const d = Math.sqrt(adx * adx + dy * dy);
    if (d >= e.reach) continue;
    const k = 1 - d / e.reach;
    const fall = k * k;
    const ph = e.phase;
    const pulse = 0.55
      + 0.28 * Math.sin(t * 5.5 + ph)
      + 0.12 * Math.sin(t * 11.0 + ph * 1.6)
      + 0.08 * Math.sin(t * 23.0 + ph * 0.7);
    boost += e.power * fall * pulse * 3.2;
  }
  return Math.min(5.5, boost);
}

/**
 * Paint underground open space as a low-res light field, then upscale with
 * bilinear filtering. Applies live flicker + warm pulse near emitters.
 */
function drawSmoothCaveBackdrop(ctx, world, cam, ts, startTX, startTY, tilesX, tilesY, emitters, now) {
  const RES = 3; // samples per tile edge
  const pad = 1;
  const tw = tilesX + 2 + pad * 2;
  const th = tilesY + 2 + pad * 2;
  const bw = Math.max(1, tw * RES);
  const bh = Math.max(1, th * RES);
  const otx = startTX - pad;
  const oty = startTY - pad;

  if (!_caveLightCanvas) {
    _caveLightCanvas = document.createElement('canvas');
    _caveLightCtx = _caveLightCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (_caveLightCanvas.width !== bw || _caveLightCanvas.height !== bh) {
    _caveLightCanvas.width = bw;
    _caveLightCanvas.height = bh;
  }
  const lctx = _caveLightCtx;
  const img = lctx.createImageData(bw, bh);
  const data = img.data;

  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const p = (j * bw + i) * 4;
      const fx = otx + (i + 0.5) / RES;
      const fy = oty + (j + 0.5) / RES;
      const tileX = Math.floor(fx);
      const tileY = Math.floor(fy);
      if (tileY < 0 || tileY >= WORLD_H) {
        data[p + 3] = 0;
        continue;
      }
      const wx = wrapX(tileX);
      const id = getTile(world, wx, tileY);
      if (!isCaveOpenTile(id)) {
        data[p + 3] = 0;
        continue;
      }
      const surf = (world.surface && world.surface[wx] != null) ? world.surface[wx] : SURFACE_Y;
      const below = fy > surf;
      let lvl = sampleLight(world, fx, fy);
      // Open sky: leave gradient (transparent)
      if (!below && lvl >= 12) {
        data[p + 3] = 0;
        continue;
      }

      // Live dynamic boost + flicker from nearby flames
      const dyn = dynamicEmitterBoost(fx, fy, emitters, now);
      const fl = emitterFlickerAt(fx, fy, emitters, now);
      if (dyn > 0.05) {
        lvl = Math.min(15, lvl + dyn * fl);
      } else if (lvl > 1.5) {
        lvl = Math.min(15, lvl * (0.92 + 0.1 * fl));
      }

      // Darker voids, brighter warm pools
      const bri = lightToBrightness(lvl, { ambient: 0.012 });
      const depth = Math.min(1, Math.max(0, (fy - surf) / 28));
      const warm = Math.max(0, lvl) / 15;
      const pulseWarm = warm * (0.85 + 0.25 * fl);
      const baseR = 4 + depth * 4;
      const baseG = 4 + depth * 3;
      const baseB = 8 + depth * 6;
      // Hot core: more orange/yellow when strongly lit
      const r = Math.min(255, (baseR + pulseWarm * 140) * bri + pulseWarm * 48 * fl);
      const g = Math.min(255, (baseG + pulseWarm * 78) * bri + pulseWarm * 22 * fl);
      const b = Math.min(255, (baseB + pulseWarm * 22) * bri + pulseWarm * 4);
      // Deeper black veil in unlit cave
      const veil = below ? (1 - bri) * 0.96 : (1 - bri) * 0.72;
      const vr = r * (1 - veil * 0.9);
      const vg = g * (1 - veil * 0.9);
      const vb = b * (1 - veil * 0.94);
      let a = below ? 255 : Math.floor(Math.min(255, (1 - Math.min(1, lvl / 13)) * 235));
      if (!below && a < 20) a = 0;

      data[p] = vr | 0;
      data[p + 1] = vg | 0;
      data[p + 2] = vb | 0;
      data[p + 3] = a;
    }
  }

  lctx.putImageData(img, 0, 0);
  const sx0 = (otx - cam.x) * ts + W / 2;
  const sy0 = (oty - cam.y) * ts + H / 2;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(_caveLightCanvas, sx0, sy0, tw * ts, th * ts);
  ctx.restore();
}

/**
 * Multi-layer additive blooms: bright dancing core, mid halo, soft outer wash.
 * Each emitter has independent phase + slight center drift (flame dance).
 */
function drawEmitterBlooms(ctx, world, cam, ts, emitters, now) {
  if (!emitters || !emitters.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const t = now * 0.001;

  for (let i = 0; i < emitters.length; i++) {
    const e = emitters[i];
    const ph = e.phase;
    // Independent multi-rate flicker
    const fl = 0.7
      + 0.18 * Math.sin(t * 6.0 + ph)
      + 0.08 * Math.sin(t * 14.5 + ph * 1.8)
      + 0.05 * Math.sin(t * 29.0 + ph * 0.5);
    // Flame center drifts a few pixels
    const jx = Math.sin(t * 7.3 + ph * 2.1) * ts * 0.12
      + Math.sin(t * 18.0 + ph) * ts * 0.05;
    const jy = Math.cos(t * 5.8 + ph * 1.4) * ts * 0.1
      + Math.sin(t * 21.0 + ph * 0.7) * ts * 0.06;

    const cx = (e.tx - cam.x) * ts + W / 2 + ts * 0.5 + jx;
    const cy = (e.ty - cam.y) * ts + H / 2 + ts * 0.38 + jy;

    let r = 255;
    let g = 165;
    let b = 40;
    let coreA = 0.42;
    let midR = ts * 2.8;
    let outR = ts * 5.2;
    if (e.kind === 'lantern') {
      g = 185; b = 55; coreA = 0.48; midR = ts * 3.4; outR = ts * 6.2;
    } else if (e.kind === 'lava' || e.kind === 'fire') {
      g = 100; b = 20; coreA = 0.38; midR = ts * 2.4; outR = ts * 4.4;
    } else if (e.kind === 'furnace') {
      g = 120; b = 30; coreA = 0.22; midR = ts * 1.6; outR = ts * 3.0;
    }

    const breathe = 0.9 + 0.12 * Math.sin(t * 3.4 + ph);
    midR *= breathe * (0.92 + 0.1 * fl);
    outR *= breathe * (0.94 + 0.08 * fl);

    // Outer soft wash
    {
      const g1 = ctx.createRadialGradient(cx, cy, ts * 0.3, cx, cy, outR);
      g1.addColorStop(0, `rgba(${r},${g},${b},${0.16 * fl * e.power})`);
      g1.addColorStop(0.45, `rgba(${r},${Math.max(0, g - 30)},${b},${0.07 * fl * e.power})`);
      g1.addColorStop(1, `rgba(${r},80,10,0)`);
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.arc(cx, cy, outR, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mid halo
    {
      const g2 = ctx.createRadialGradient(cx, cy, ts * 0.1, cx, cy, midR);
      g2.addColorStop(0, `rgba(${r},${g + 40},${b + 20},${0.32 * fl * e.power})`);
      g2.addColorStop(0.4, `rgba(${r},${g},${b},${0.16 * fl * e.power})`);
      g2.addColorStop(1, `rgba(${r},${Math.max(0, g - 40)},${b},0)`);
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(cx, cy, midR, 0, Math.PI * 2);
      ctx.fill();
    }
    // Hot white-yellow core
    {
      const cr = ts * (0.45 + 0.12 * fl);
      const g3 = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      g3.addColorStop(0, `rgba(255,250,210,${coreA * fl})`);
      g3.addColorStop(0.35, `rgba(255,200,80,${coreA * 0.55 * fl})`);
      g3.addColorStop(1, `rgba(255,120,20,0)`);
      ctx.fillStyle = g3;
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Procedural torch — upright on floor, angled off walls, hanging from ceiling. */
export function drawTorchSprite(ctx, sx, sy, ts, facing, seed) {
  const t = performance.now() * 0.001;
  const s = seed || 0;
  // Livelier irregular flame
  const flicker = 0.62
    + 0.22 * Math.sin(t * 7.1 + s)
    + 0.1 * Math.sin(t * 15.3 + s * 1.7)
    + 0.08 * Math.sin(t * 31.0 + s * 0.4);
  let baseX;
  let baseY;
  let tipX;
  let tipY;

  if (facing === 'left') {
    // Mounted on left wall → stick angles up-right out of the wall
    baseX = sx + ts * 0.12;
    baseY = sy + ts * 0.58;
    tipX = sx + ts * 0.62;
    tipY = sy + ts * 0.2;
  } else if (facing === 'right') {
    // Mounted on right wall → stick angles up-left
    baseX = sx + ts * 0.88;
    baseY = sy + ts * 0.58;
    tipX = sx + ts * 0.38;
    tipY = sy + ts * 0.2;
  } else if (facing === 'ceil') {
    // Hanging from ceiling — flame points down
    baseX = sx + ts * 0.5;
    baseY = sy + ts * 0.1;
    tipX = sx + ts * 0.5;
    tipY = sy + ts * 0.55;
  } else {
    // Floor / standing
    baseX = sx + ts * 0.5;
    baseY = sy + ts * 0.88;
    tipX = sx + ts * 0.5;
    tipY = sy + ts * 0.28;
  }

  // Stick (tapered look via two strokes)
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2a1a0c';
  ctx.lineWidth = Math.max(3, ts * 0.16);
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.strokeStyle = '#7a4e28';
  ctx.lineWidth = Math.max(2, ts * 0.1);
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // Ember wrap near tip
  const midX = baseX * 0.3 + tipX * 0.7;
  const midY = baseY * 0.3 + tipY * 0.7;
  ctx.strokeStyle = '#a85a20';
  ctx.lineWidth = Math.max(2.2, ts * 0.12);
  ctx.beginPath();
  ctx.moveTo(midX, midY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // Flame teardrop (not a flat yellow disc)
  const flameUp = facing === 'ceil' ? 1 : -1;
  ctx.fillStyle = `rgba(255, 120, 20, ${0.55 * flicker})`;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY + flameUp * ts * 0.02);
  ctx.quadraticCurveTo(tipX + ts * 0.12, tipY + flameUp * ts * 0.1, tipX, tipY + flameUp * ts * 0.28);
  ctx.quadraticCurveTo(tipX - ts * 0.12, tipY + flameUp * ts * 0.1, tipX, tipY + flameUp * ts * 0.02);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 210, 60, ${0.9 * flicker})`;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY + flameUp * ts * 0.01);
  ctx.quadraticCurveTo(tipX + ts * 0.07, tipY + flameUp * ts * 0.08, tipX, tipY + flameUp * ts * 0.18);
  ctx.quadraticCurveTo(tipX - ts * 0.07, tipY + flameUp * ts * 0.08, tipX, tipY + flameUp * ts * 0.01);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 255, 200, ${0.85 * flicker})`;
  ctx.beginPath();
  ctx.arc(tipX, tipY + flameUp * ts * 0.04, ts * 0.05, 0, Math.PI * 2);
  ctx.fill();

  // Local soft glow around flame
  const g = ctx.createRadialGradient(tipX, tipY, 1, tipX, tipY, ts * 0.7);
  g.addColorStop(0, `rgba(255, 190, 60, ${0.5 * flicker})`);
  g.addColorStop(0.45, `rgba(255, 120, 30, ${0.18 * flicker})`);
  g.addColorStop(1, 'rgba(255, 100, 20, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(tipX, tipY, ts * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

export function drawBlock(ctx, sx, sy, ts, id, lightMul, wx, ty, ao, world) {
  const m = BLOCK_META[id];
  if (!m || !m.color) return;
  ao = ao || 0;
  const alpha = m.alpha != null ? m.alpha : 1;
  const cube = getCubeTex(id);
  const face = getTileTex(id);
  const soft = getSoftTex(id) || face;
  const terrain = isTerrainBlock(id);

  // Light as continuous brightness — NOT a black square overlay (that made a grid)
  const shade = Math.max(0.04, Math.min(1.05, lightMul * (1 - ao * 0.25)));

  ctx.save();

  const useFlat = id === BLOCK.WATER || id === BLOCK.TORCH || id === BLOCK.LANTERN || id === BLOCK.LADDER
    || id === BLOCK.LEAVES || id === BLOCK.GLASS || id === BLOCK.PLATFORM || id === BLOCK.CAMPFIRE
    || terrain;

  // Terrain is drawn in drawBlendedTerrainLayer — skip here to avoid double grid
  if (terrain) {
    ctx.restore();
    return;
  }

  const pad = 0.6;

  if (useFlat && soft && id !== BLOCK.WATER && id !== BLOCK.TORCH && id !== BLOCK.LANTERN
      && id !== BLOCK.LADDER && id !== BLOCK.LEAVES && id !== BLOCK.CAMPFIRE && id !== BLOCK.PLATFORM) {
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = alpha * Math.min(1, 0.12 + shade * 0.92);
    ctx.drawImage(soft, sx - pad, sy - pad, ts + pad * 2, ts + pad * 2);
  } else if (cube && !useFlat) {
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = alpha * Math.min(1, 0.15 + shade * 0.9);
    ctx.drawImage(cube, sx - pad, sy - pad, ts + pad * 2, ts + pad * 2);
  } else if (face && !useFlat) {
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = alpha * Math.min(1, 0.15 + shade * 0.9);
    drawTexturedCube(ctx, sx, sy, ts, face, id);
  } else if (face && useFlat && id !== BLOCK.WATER && id !== BLOCK.TORCH && id !== BLOCK.LANTERN
      && id !== BLOCK.LADDER && id !== BLOCK.LEAVES) {
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = alpha * Math.min(1, 0.12 + shade * 0.92);
    ctx.drawImage(face, sx - pad, sy - pad, ts + pad * 2, ts + pad * 2);
  } else if (!face && !cube) {
    const base = shadeHex(m.color, 0.55 + 0.45 * Math.min(1, shade));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = base;
    ctx.fillRect(sx - pad, sy - pad, ts + pad * 2, ts + pad * 2);
  }

  // Special animated overlays
  if (id === BLOCK.LAVA) {
    const flicker = 0.5 + 0.5 * Math.sin(performance.now() / 180 + wx * 0.8 + ty * 0.5);
    const lg = ctx.createRadialGradient(sx + ts * 0.5, sy + ts * 0.5, 2, sx + ts * 0.5, sy + ts * 0.5, ts * 0.7);
    lg.addColorStop(0, `rgba(255,230,80,${0.35 * flicker})`);
    lg.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = lg;
    ctx.fillRect(sx - 1, sy - 1, ts + 2, ts + 2);
  }
  if (id === BLOCK.WATER) {
    ctx.globalAlpha = 0.75;
    if (face) ctx.drawImage(face, sx - 1, sy - 1, ts + 2, ts + 2);
    else {
      ctx.fillStyle = 'rgba(50,140,210,0.55)';
      ctx.fillRect(sx - 1, sy - 1, ts + 2, ts + 2);
    }
    const wave = Math.sin(performance.now() / 350 + wx * 0.9) * 2;
    ctx.fillStyle = 'rgba(200,240,255,0.2)';
    ctx.fillRect(sx + 2, sy + 4 + wave, ts - 4, 3);
  }
  if (id === BLOCK.TORCH) {
    // Prefer stored mount face; else infer from neighbors (walls → angled)
    let facing = 'floor';
    if (world && world.meta) {
      facing = getTorchFacing(world.meta, wx, ty) || inferTorchFacing(world, wx, ty);
    } else if (world) {
      facing = inferTorchFacing(world, wx, ty);
    }
    ctx.globalAlpha = 1;
    drawTorchSprite(ctx, sx, sy, ts, facing, wx * 3 + (ty || 0));
  }
  if (id === BLOCK.LANTERN) {
    let mode = 'hang';
    if (world && world.meta) {
      mode = getLanternMode(world.meta, wx, ty)
        || (isSolid(world, wx, ty - 1) || isPlatform(getTile(world, wx, ty - 1)) ? 'hang' : 'floor');
    } else if (world) {
      mode = (isSolid(world, wx, ty - 1) || isPlatform(getTile(world, wx, ty - 1))) ? 'hang' : 'floor';
    }
    ctx.globalAlpha = 1;
    drawLanternSprite(ctx, sx, sy, ts, mode, wx * 5 + (ty || 0));
  }
  if (id === BLOCK.LADDER) {
    if (face) {
      ctx.globalAlpha = 1;
      ctx.drawImage(face, sx, sy, ts, ts);
    }
  }
  if (id === BLOCK.LEAVES && face) {
    ctx.globalAlpha = 0.92 * Math.min(1, 0.2 + shade * 0.85);
    ctx.drawImage(face, sx - 1.5, sy - 1.5, ts + 3, ts + 3);
  }
  // Procedural furniture / specials
  if (id === BLOCK.DOOR || id === BLOCK.BED || id === BLOCK.CHEST || id === BLOCK.FURNACE
      || id === BLOCK.PLATFORM || id === BLOCK.CAMPFIRE) {
    ctx.globalAlpha = Math.min(1, 0.2 + shade * 0.85);
    if (face && id !== BLOCK.PLATFORM && id !== BLOCK.CAMPFIRE) {
      ctx.drawImage(face, sx, sy, ts, ts);
    } else {
      drawFurniture(ctx, sx, sy, ts, id, lightMul);
    }
  }

  // Subtle grass tufts only on surface grass (sparse)
  if (id === BLOCK.GRASS && shade > 0.65 && ((wx * 5 + ty * 3) % 4 === 0)) {
    ctx.globalAlpha = 0.45 * shade;
    ctx.fillStyle = '#6fbf45';
    const bx = sx + ts * 0.35;
    ctx.fillRect(bx, sy - 2, 2, 4);
  }

  ctx.restore();
}

export function drawTexturedCube(ctx, sx, sy, ts, face, id) {
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

export function drawFurniture(ctx, sx, sy, ts, id, lightMul) {
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

export function drawCrack(ctx, sx, sy, ts, p) {
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

/**
 * Draw the player — original orange-hoodie hero, procedural, with a real
 * pivoted walk cycle (same limb math that fixed the Steve prototype).
 */
/** Hero sprite canvas size (feet on bottom edge). */
const HERO_SW = 96;
const HERO_SH = 176;

/**
 * Front-hand tip anchors measured from hero PNG pixels (facing +X / right).
 * Values are canvas pixel coords; converted to feet-origin draw space at runtime.
 * Facing left is handled by the parent scale(-1,1) flip.
 */
const HAND_TIP = {
  idle:   { x: 72, y: 125 },
  walk0:  { x: 89, y: 116 },
  walk1:  { x: 71, y: 122 },
  walk2:  { x: 89, y: 122 },
  jump:   { x: 94, y: 119 },
  crouch: { x: 94, y: 125 },
  boat:   { x: 72, y: 125 },
  // Action poses (from baked mine/sword/shovel frames) for swing targets
  mine:   { x: 89, y: 107 },
  sword:  { x: 74, y: 107 },
  shovel: { x: 58, y: 123 },
};

/**
 * Handle grip on each item icon (normalized 0–1 within the 64×64 PNG).
 * Magenta = where the hand should pin the tool. Center (0.5,0.5) for blocks/misc.
 */
const ITEM_GRIP = {
  wood_pick:    { gx: 0.16, gy: 0.91 },
  stone_pick:   { gx: 0.16, gy: 0.90 },
  iron_pick:    { gx: 0.18, gy: 0.89 },
  gold_pick:    { gx: 0.17, gy: 0.92 },
  wood_axe:     { gx: 0.26, gy: 0.61 },
  stone_axe:    { gx: 0.19, gy: 0.64 },
  iron_axe:     { gx: 0.17, gy: 0.67 },
  gold_axe:     { gx: 0.19, gy: 0.67 },
  wood_shovel:  { gx: 0.36, gy: 0.54 },
  stone_shovel: { gx: 0.53, gy: 0.64 },
  iron_shovel:  { gx: 0.59, gy: 0.41 },
  wood_sword:   { gx: 0.16, gy: 0.87 },
  stone_sword:  { gx: 0.18, gy: 0.87 },
  iron_sword:   { gx: 0.16, gy: 0.81 },
  stick:        { gx: 0.25, gy: 0.76 },
  apple:        { gx: 0.50, gy: 0.55 },
  bread:        { gx: 0.50, gy: 0.55 },
  stew:         { gx: 0.50, gy: 0.55 },
  boat:         { gx: 0.50, gy: 0.55 },
  bucket:       { gx: 0.53, gy: 0.56 },
  bucket_water: { gx: 0.54, gy: 0.55 },
  iron_ingot:   { gx: 0.50, gy: 0.53 },
  gold_ingot:   { gx: 0.50, gy: 0.53 },
  copper_ingot: { gx: 0.50, gy: 0.53 },
};

/**
 * Aim from player chest toward the block being mined.
 * World y increases downward. Returns local aim after facing flip:
 *   ang = 0 forward, negative = up, positive = down.
 */
function getMiningAim(p) {
  if (!p.mining || p.mining.tx == null || p.mining.ty == null) return null;
  const chestY = p.y - p.h * 0.55;
  const dx = wrapDeltaX(p.x, p.mining.tx + 0.5);
  const dy = (p.mining.ty + 0.5) - chestY;
  const face = p.facing >= 0 ? 1 : -1;
  // After scale(-1) for left face, +X is always "forward"
  let lx = dx * face;
  // Straight above/below: keep a tiny forward component so atan2 is stable
  if (lx < 0.08) lx = 0.08;
  const ly = dy;
  const ang = Math.atan2(ly, lx);
  const len = Math.hypot(dx, dy) || 1;
  return { dx, dy, lx, ly, ang, len };
}

export function drawPlayer(ctx, p, cam, ts, inv) {
  const sx = (p.x - cam.x) * ts + W / 2;
  const sy = (p.y - cam.y) * ts + H / 2;
  const pw = p.w * ts;
  const ph = p.h * ts;
  const walking = p.onGround && Math.abs(p.vx) > 0.25 && !p.crouching;
  const run = Math.min(1, Math.abs(p.vx) / 4);
  const mineAim = getMiningAim(p);

  ctx.save();
  if (p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0) {
    ctx.globalAlpha = 0.45;
  }

  // Soft ground shadow
  const shadowW = pw * (0.55 + run * 0.1);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 1, shadowW, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Procedural boat under sprite if boat frame is missing
  if (p.inBoat && !(textures.playerAnims && textures.playerAnims.boat)) {
    ctx.fillStyle = '#8b5a2b';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 4, pw * 1.1, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c49a5a';
    ctx.fillRect(sx - pw * 0.9, sy - 10, pw * 1.8, 6);
  }

  const pose = getPlayerPose(p, inv);
  const img = pose.img || textures.player;
  const drawH = ph * (p.crouching ? 0.92 : 1.12);
  const drawW = drawH * (HERO_SW / HERO_SH);
  const footY = sy + (p.inBoat ? -6 : 0);

  // Continuous chop phase while mining (not tied to break progress — that was too fast to see)
  const minePhase = mineAim ? (performance.now() / 1000) * 7.5 : 0;
  const mineStrike = mineAim ? Math.sin(minePhase) : 0; // -1..1 wind-up ↔ strike

  ctx.save();
  ctx.translate(sx, footY);
  // Face +X locally; flip whole character (and held item) when facing left
  if (p.facing < 0) ctx.scale(-1, 1);

  // Lean + bob body toward the mined block (look up / down / forward)
  if (mineAim) {
    const lean = Math.max(-0.5, Math.min(0.5, mineAim.ang * 0.42 + mineStrike * 0.14));
    ctx.rotate(lean);
    ctx.translate(mineStrike * drawW * 0.04, Math.abs(mineStrike) * drawH * 0.03);
  }

  if (img) {
    // Fixed draw size for ALL frames so jump/mine never shrink the character.
    // Original hero sprites are 96×176 with feet on the bottom edge.
    ctx.imageSmoothingEnabled = false; // crisp pixel art
    ctx.drawImage(img, -drawW / 2, -drawH, drawW, drawH);
  } else {
    // Minimal procedural fallback (orange hoodie)
    const bob = walking ? Math.abs(Math.sin(p.anim * 2)) * 2 : 0;
    ctx.fillStyle = '#ee6c4d';
    roundRect(ctx, -pw * 0.4, -ph + bob + ph * 0.25, pw * 0.8, ph * 0.45, 3);
    ctx.fill();
    ctx.fillStyle = '#e8c49a';
    roundRect(ctx, -pw * 0.35, -ph + bob, pw * 0.7, ph * 0.28, 4);
    ctx.fill();
  }

  // Pin selected hotbar item to hand; swing toward mine target when mining
  drawHeldItem(ctx, p, inv, drawW, drawH, pose.key, mineAim, mineStrike);

  ctx.restore();
  ctx.restore();
}

/** Convert sprite-pixel hand tip → feet-origin draw coords. */
function handTipDraw(poseKey, drawW, drawH) {
  const tip = HAND_TIP[poseKey] || HAND_TIP.idle;
  return {
    x: ((tip.x - HERO_SW / 2) / HERO_SW) * drawW,
    y: ((tip.y - HERO_SH) / HERO_SH) * drawH,
  };
}

function itemGrip(id) {
  if (id != null && ITEM_GRIP[id]) return ITEM_GRIP[id];
  // Blocks / unknown: hold at icon center
  return { gx: 0.5, gy: 0.55 };
}

/**
 * Draw the selected hotbar item with its handle grip pinned to the pose hand tip.
 * Origin is feet; character faces +X (caller flips for left).
 * When mineAim is set, arm + tool swing hard toward the mined block.
 * Mining arm draws even with empty hands so dig always reads as motion.
 */
function drawHeldItem(ctx, p, inv, drawW, drawH, poseKey, mineAim, mineStrike) {
  if (p.inBoat) return;
  const slot = inv && inv.hotbar ? inv.hotbar[inv.selected] : null;
  const id = slot && slot.id != null && slot.id !== 'hand' ? slot.id : null;
  const walking = p.onGround && Math.abs(p.vx) > 0.25 && !p.crouching;
  const mining = !!(mineAim && p.mining);
  const swinging = (p.attackT || 0) > 0;
  const tool = id != null && isTool(id);
  const weapon = id != null && isWeapon(id);
  const sid = id != null ? String(id) : '';
  const isPickOrAxe = tool && (sid.indexOf('pick') >= 0 || sid.indexOf('axe') >= 0);
  const isShovel = tool && sid.indexOf('shovel') >= 0;

  let handX;
  let handY;
  let angle;

  if (mining) {
    // Shoulder pivot → big chop toward mined tile (time-based so it's always visible)
    const shoulderX = drawW * 0.05;
    const shoulderY = -drawH * 0.55;
    const armLen = drawH * 0.48;
    const aim = mineAim.ang; // 0 forward, -up, +down
    const strike = mineStrike != null ? mineStrike : Math.sin((performance.now() / 1000) * 7.5);
    // Wind-up raises tool opposite the aim; strike drives toward the block
    const windAng = aim - 1.15 + strike * 1.35;
    const reach = armLen * (0.55 + 0.45 * (0.5 + 0.5 * strike));
    const dirX = Math.cos(windAng);
    const dirY = Math.sin(windAng);
    handX = shoulderX + dirX * reach;
    handY = shoulderY + dirY * reach;

    // Icon tip along -Y at angle 0 → point tip along windAng
    const tipAng = Math.atan2(Math.cos(windAng), -Math.sin(windAng));
    angle = tipAng + strike * 0.35;

    // Draw raised arm so the body clearly "mines" (sprite arms stay idle)
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Orange hoodie sleeve
    ctx.strokeStyle = '#e85d3a';
    ctx.lineWidth = Math.max(4, drawW * 0.16);
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(shoulderX + dirX * reach * 0.62, shoulderY + dirY * reach * 0.62);
    ctx.stroke();
    // Skin forearm
    ctx.strokeStyle = '#e8b896';
    ctx.lineWidth = Math.max(3.2, drawW * 0.12);
    ctx.beginPath();
    ctx.moveTo(shoulderX + dirX * reach * 0.55, shoulderY + dirY * reach * 0.55);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    // Hand knuckle
    ctx.fillStyle = '#e8b896';
    ctx.beginPath();
    ctx.arc(handX, handY, Math.max(2.5, drawW * 0.07), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (id == null) return; // bare-hand dig: arm only
  } else {
    if (id == null) return; // idle empty hands

    // Base hand from current body frame (walk/idle/jump/crouch)
    let hand = handTipDraw(poseKey || 'idle', drawW, drawH);

    // Attack: blend toward sword/mine hand pose
    if (swinging) {
      const actionKey = weapon ? 'sword' : (isShovel ? 'shovel' : 'mine');
      const target = handTipDraw(actionKey, drawW, drawH);
      const atk = Math.min(1, (p.attackT || 0) / 0.22);
      const blend = Math.sin((1 - atk) * Math.PI);
      hand = {
        x: hand.x + (target.x - hand.x) * blend,
        y: hand.y + (target.y - hand.y) * blend,
      };
    }

    handX = hand.x;
    handY = hand.y;

    // Rest angles (canvas: + = clockwise). Icons have handles near bottom.
    angle = 0.35;
    if (weapon) angle = 0.70;
    else if (isPickOrAxe) angle = 0.55;
    else if (isShovel) angle = 0.85;
    else if (tool) angle = 0.50;
    else angle = 0.15;

    if (walking && !swinging) {
      angle += Math.sin((p.anim || 0) * 2.2) * 0.12;
    }
    if (swinging) {
      const atk = Math.min(1, (p.attackT || 0) / 0.22);
      const swing = Math.sin((1 - atk) * Math.PI);
      angle = 0.2 + swing * 1.15;
    }
  }

  // World size of the icon
  let size = drawH * 0.30;
  if (weapon) size = drawH * 0.36;
  else if (isPickOrAxe) size = drawH * 0.38;
  else if (isShovel) size = drawH * 0.36;
  else if (tool) size = drawH * 0.34;
  else size = drawH * 0.26;

  if (mining) size *= 1.12;

  const grip = itemGrip(id);

  ctx.save();
  ctx.translate(handX, handY);
  ctx.rotate(angle);
  ctx.imageSmoothingEnabled = false;

  // Pin grip pixel of the icon to (0,0) = hand tip
  drawItemIcon(ctx, -grip.gx * size, -grip.gy * size, size, id);
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawHUD(ctx, player, inv, world, cam, ui, sky) {
  // Status bars — clear top-left (menu chrome lives above the hotbar now)
  const barX = 12;
  const barY = 10;
  const diff = getDifficulty(ui.difficultyId);
  const isCreative = !!(ui.creative || diff.creative);

  if (!isCreative) {
    drawBar(ctx, barX, barY, 132, 14, player.hp / player.maxHp, '#e74c3c', '♥');
    drawBar(ctx, barX, barY + 18, 132, 12, player.hunger != null ? player.hunger / player.maxHunger : 1, '#e67e22', '🍖');
    drawBar(ctx, barX, barY + 34, 132, 12, player.energy / player.maxEnergy, '#f1c40f', '⚡');
  } else {
    // Compact creative badge instead of survival bars
    ctx.fillStyle = 'rgba(6,14,10,0.55)';
    roundRect(ctx, barX, barY, 132, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#7dffa0';
    ctx.font = '700 12px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('✦ Creative', barX + 10, barY + 18);
  }

  // Coords + biome under bars
  const bx2 = wrapX(Math.floor(player.x));
  const by2 = Math.floor(player.y);
  const biome = biomeNameAt(world, player.x);
  const infoTop = isCreative ? 46 : 62;
  ctx.fillStyle = 'rgba(6,14,10,0.55)';
  roundRect(ctx, 12, infoTop, 150, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#c8e8d8';
  ctx.font = '600 11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText(biome + ' · x' + bx2 + ' y' + by2, 20, infoTop + 14);
  if (player.spawnX != null) {
    ctx.fillStyle = '#7dffa0';
    ctx.font = '10px system-ui';
    ctx.fillText('Bed spawn set', 20, infoTop + 28);
  } else {
    ctx.fillStyle = '#9ec5b0';
    ctx.font = '10px system-ui';
    ctx.fillText(ui.weather > 0.3 ? '🌧 Raining' : (player.inBoat ? '⛵ Sailing' : 'Explore'), 20, infoTop + 28);
  }

  // World loop panel — top right, leave room for version tag
  ctx.fillStyle = 'rgba(8,16,12,0.5)';
  roundRect(ctx, W - 128, 28, 116, 48, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.stroke();
  ctx.fillStyle = '#e8fff0';
  ctx.font = '600 10px system-ui,sans-serif';
  ctx.textAlign = 'left';
  const circ = ((player.x % WORLD_W) + WORLD_W) % WORLD_W;
  const pct = ((circ / WORLD_W) * 100).toFixed(1);
  const wLabel = WORLD_W >= 1000 ? (WORLD_W / 1000).toFixed(WORLD_W % 1000 === 0 ? 0 : 1) + 'k' : String(WORLD_W);
  ctx.fillText(wLabel + ' blocks around', W - 120, 44);
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 13px system-ui,sans-serif';
  ctx.fillText(pct + '% lap', W - 120, 60);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, W - 120, 66, 100, 6, 3);
  ctx.fill();
  ctx.fillStyle = '#7dffa0';
  roundRect(ctx, W - 120, 66, Math.max(2, 100 * (circ / WORLD_W)), 6, 3);
  ctx.fill();

  // Minimap under lap panel
  drawMinimap(ctx, world, player, cam);

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

  // Tool + bag + world/seed under biome card
  const toolTop = infoTop + 40;
  ctx.fillStyle = 'rgba(6,14,10,0.5)';
  roundRect(ctx, 12, toolTop, 150, 58, 8);
  ctx.fill();
  ctx.fillStyle = '#e8fff0';
  ctx.font = '600 11px system-ui';
  ctx.textAlign = 'left';
  const tname = (TOOLS[inv.tool] && TOOLS[inv.tool].name) || 'Hands';
  ctx.fillText('Tool: ' + tname, 20, toolTop + 15);
  const bu = bagUsed(inv);
  ctx.fillStyle = bu >= BAG_SIZE ? '#ff8a80' : '#9ec5b0';
  ctx.font = '600 10px system-ui';
  ctx.fillText('🎒 Backpack ' + bu + '/' + BAG_SIZE, 20, toolTop + 28);
  ctx.fillStyle = isCreative ? '#7dffa0' : (player.sprinting ? '#f1c40f' : '#9ec5b0');
  ctx.font = '600 10px system-ui';
  const modeLine = diff.name
    + (player.sprinting ? ' · sprinting' : (player.canSprint === false ? ' · no sprint' : ''));
  ctx.fillText(modeLine, 20, toolTop + 41);
  // Seed (tiny) — helps recreate worlds
  if (ui.seedLabel) {
    ctx.fillStyle = 'rgba(158,197,176,0.85)';
    ctx.font = '600 9px system-ui';
    ctx.fillText(ui.seedLabel, 20, toolTop + 53);
  }

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

export function drawBar(ctx, x, y, w, h, pct, color, icon) {
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

export function drawItemIcon(ctx, x, y, s, id) {
  // Prefer real PNG icons when loaded
  const icon = typeof getItemIcon === 'function' ? getItemIcon(id) : null;
  if (icon) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(icon, x, y, s, s);
    return;
  }
  if (id === BLOCK.LANTERN || id === BLOCK.TORCH) {
    if (id === BLOCK.LANTERN) drawLanternSprite(ctx, x - 2, y - 2, s + 4, 'hang', 0);
    else drawTorchSprite(ctx, x - 2, y - 2, s + 4, 'floor', 0);
    return;
  }
  if (typeof id === 'number') {
    const cube = getCubeTex(id);
    const face = getTileTex(id);
    ctx.imageSmoothingEnabled = false;
    if (cube) ctx.drawImage(cube, x, y, s, s);
    else if (face) ctx.drawImage(face, x, y, s, s);
    else if (BLOCK_META[id]) drawBlock(ctx, x, y, s, id, 1, 0, 0, 0);
  }
}

export function drawMinimap(ctx, world, player, cam) {
  const mw = 88;
  const mh = 56;
  const mx = W - mw - 12;
  const my = 84;
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

export function drawInvSlot(ctx, x, y, cell, slot, selected) {
  ctx.fillStyle = selected ? 'rgba(125,255,160,0.2)' : 'rgba(255,255,255,0.07)';
  roundRect(ctx, x, y, cell, cell, 8);
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = 'rgba(125,255,160,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (slot) {
    drawItemIcon(ctx, x + 4, y + 4, cell - 8, slot.id);
    if (slot.count > 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, x + cell - 20, y + cell - 16, 18, 13, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 11px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(String(slot.count), x + cell - 4, y + cell - 5);
    }
  }
}

export function drawChestPanel(ctx, inv, ui) {
  const pw = 340;
  const ph = 560;
  const px = (W - pw) / 2;
  const py = Math.max(6, (H - ph) / 2 - 6);
  ui.chestHit = [];
  ui.bagHit = [];

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(12, 24, 20, 0.98)';
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(212,160,74,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#d4a04a';
  ctx.font = '700 20px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('📦 Chest', px + 16, py + 30);

  // Close
  const closeX = px + pw - 44;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, closeX, py + 10, 32, 32, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 16px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('✕', closeX + 16, py + 32);
  ui.chestHit.push({ kind: 'close', x: closeX, y: py + 10, w: 32, h: 32 });

  ctx.fillStyle = '#9ec5b0';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('Tap an item, then tap where to put it', px + 16, py + 52);

  const cell = 38;
  const gap = 6;
  const slots = ui.chestOpen.slots;

  // Chest grid 4x4
  ctx.fillStyle = '#d4a04a';
  ctx.font = '700 13px system-ui';
  ctx.fillText('Chest storage', px + 16, py + 74);
  const cStartY = py + 84;
  for (let i = 0; i < slots.length; i++) {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = px + 16 + col * (cell + gap);
    const y = cStartY + row * (cell + gap);
    const sel = ui.invPick && ui.invPick.from === 'chest' && ui.invPick.i === i;
    drawInvSlot(ctx, x, y, cell, slots[i], sel);
    ui.chestHit.push({ kind: 'slot', from: 'chest', i, x, y, w: cell, h: cell });
  }

  // Hotbar
  const hLabelY = cStartY + 4 * (cell + gap) + 18;
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 13px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('Hotbar (1–8)', px + 16, hLabelY);
  const hy = hLabelY + 10;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const x = px + 12 + i * (cell + 4);
    const sel = ui.invPick && ui.invPick.from === 'hotbar' && ui.invPick.i === i;
    drawInvSlot(ctx, x, hy, cell, inv.hotbar[i], sel);
    ui.chestHit.push({ kind: 'slot', from: 'hotbar', i, x, y: hy, w: cell, h: cell });
  }

  // Bag
  const bLabelY = hy + cell + 22;
  const used = bagUsed(inv);
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 13px system-ui';
  ctx.fillText('Backpack ' + used + '/' + BAG_SIZE, px + 16, bLabelY);
  const by = bLabelY + 10;
  const cols = 6;
  for (let i = 0; i < inv.bag.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = px + 16 + col * (cell + gap);
    const y = by + row * (cell + gap);
    const sel = ui.invPick && ui.invPick.from === 'bag' && ui.invPick.i === i;
    drawInvSlot(ctx, x, y, cell, inv.bag[i], sel);
    ui.chestHit.push({ kind: 'slot', from: 'bag', i, x, y, w: cell, h: cell });
  }

  ctx.fillStyle = '#8899aa';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(ui.invPick ? 'Tap a slot to move there · tap again to cancel' : 'Tap item to pick up · ⚒ to close', W / 2, py + ph - 14);
}

/**
 * Creative mode: catalog + full inventory, non-overlapping zones.
 * Landscape: catalog LEFT | inventory RIGHT
 * Portrait:  catalog TOP  | inventory BOTTOM
 */
export function drawCreativePanel(ctx, inv, ui) {
  const landscape = W > H;
  const cell = landscape ? 34 : 36;
  const gap = 5;
  const pad = 12;
  const headerH = 52;
  const footerH = 22;
  const scrollH = 28;

  // Inventory block needs: title + hotbar + bag label + 4 bag rows
  const bagCols = 6;
  const bagRows = Math.ceil(BAG_SIZE / bagCols); // 4
  const invInnerH = 18 + cell + 18 + bagRows * (cell + gap) + 8;

  let pw, ph, px, py;
  if (landscape) {
    pw = Math.min(720, W - 20);
    ph = Math.min(H - 16, Math.max(320, invInnerH + headerH + footerH + 24));
    px = (W - pw) / 2;
    py = Math.max(6, (H - ph) / 2);
  } else {
    pw = Math.min(360, W - 16);
    // Catalog gets at least 3 rows, inv gets full backpack
    const catMinH = scrollH + 3 * (cell + gap) + 16;
    ph = Math.min(H - 16, headerH + catMinH + 12 + invInnerH + footerH + 16);
    px = (W - pw) / 2;
    py = Math.max(4, (H - ph) / 2);
  }

  ui.creativeHit = [];

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);

  // Panel chrome
  ctx.fillStyle = 'rgba(12, 28, 22, 0.98)';
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(125,255,160,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Void target = full panel (hit-tested last / under controls)
  ui.creativeHit.push({ kind: 'void', x: px, y: py, w: pw, h: ph });

  // Header
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 17px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('✦ Creative', px + 16, py + 24);

  const closeX = px + pw - 42;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, closeX, py + 8, 30, 30, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 15px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('✕', closeX + 15, py + 28);
  ui.creativeHit.push({ kind: 'close', x: closeX, y: py + 8, w: 30, h: 30 });

  ctx.fillStyle = '#9ec5b0';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('Hover for names · drag · dbl-click moves · drop here to delete', px + 16, py + 42);

  // ——— Zone rectangles (no overlap) ———
  const bodyTop = py + headerH;
  const bodyBot = py + ph - footerH;
  const bodyH = bodyBot - bodyTop;

  let catX, catY, catW, catH;
  let invX, invY, invW, invH;

  if (landscape) {
    // Split ~55% catalog / 45% inventory
    const split = Math.floor(pw * 0.55);
    catX = px + pad;
    catY = bodyTop;
    catW = split - pad * 1.5;
    catH = bodyH;
    invX = px + split + 4;
    invY = bodyTop;
    invW = pw - split - pad - 4;
    invH = bodyH;

    // Divider
    ctx.strokeStyle = 'rgba(125,255,160,0.3)';
    ctx.beginPath();
    ctx.moveTo(px + split, bodyTop + 4);
    ctx.lineTo(px + split, bodyBot - 4);
    ctx.stroke();
  } else {
    // Stack: catalog top, inventory bottom (inventory height fixed)
    invH = invInnerH;
    invY = bodyBot - invH;
    invX = px + pad;
    invW = pw - pad * 2;
    catX = px + pad;
    catY = bodyTop;
    catW = pw - pad * 2;
    catH = invY - catY - 10;

    // Divider
    ctx.strokeStyle = 'rgba(125,255,160,0.3)';
    ctx.beginPath();
    ctx.moveTo(px + 12, invY - 5);
    ctx.lineTo(px + pw - 12, invY - 5);
    ctx.stroke();
  }

  // ——— CATALOG zone ———
  const catalog = creativeCatalog();
  const catCols = Math.max(4, Math.floor((catW + gap) / (cell + gap)));
  const scrY = catY + 2;

  ctx.fillStyle = 'rgba(125,255,160,0.15)';
  roundRect(ctx, catX, scrY, 56, scrollH - 2, 8);
  ctx.fill();
  roundRect(ctx, catX + 62, scrY, 56, scrollH - 2, 8);
  ctx.fill();
  ctx.fillStyle = '#c8f5d8';
  ctx.font = '600 12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('▲', catX + 28, scrY + 17);
  ctx.fillText('▼', catX + 90, scrY + 17);
  ui.creativeHit.push({ kind: 'scroll', dir: -1, x: catX, y: scrY, w: 56, h: scrollH - 2 });
  ui.creativeHit.push({ kind: 'scroll', dir: 1, x: catX + 62, y: scrY, w: 56, h: scrollH - 2 });

  const gridTop = scrY + scrollH + 4;
  const gridH = catY + catH - gridTop - 2;
  const rowsVisible = Math.max(1, Math.floor((gridH + gap) / (cell + gap)));
  const maxScroll = Math.max(0, Math.ceil(catalog.length / catCols) - rowsVisible);
  const scroll = Math.max(0, Math.min(maxScroll, ui.creativeScroll | 0));
  ui.creativeScroll = scroll;

  ctx.fillStyle = '#8899aa';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  const totalPages = Math.max(1, Math.ceil(catalog.length / catCols));
  ctx.fillText(
    'Blocks ' + (scroll + 1) + '–' + Math.min(scroll + rowsVisible, totalPages) + ' / ' + totalPages,
    catX + 128,
    scrY + 17
  );

  // Clip catalog so it never paints over inventory
  ctx.save();
  ctx.beginPath();
  ctx.rect(catX - 1, gridTop - 1, catW + 2, gridH + 2);
  ctx.clip();

  const start = scroll * catCols;
  const end = Math.min(catalog.length, start + catCols * rowsVisible);
  for (let i = start; i < end; i++) {
    const local = i - start;
    const col = local % catCols;
    const row = Math.floor(local / catCols);
    const x = catX + col * (cell + gap);
    const y = gridTop + row * (cell + gap);
    if (y + cell > gridTop + gridH) break;
    const id = catalog[i];
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(ctx, x, y, cell, cell, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    drawItemIcon(ctx, x + 3, y + 3, cell - 6, id);
    ui.creativeHit.push({ kind: 'give', id, x, y, w: cell, h: cell });
  }
  ctx.restore();

  // ——— INVENTORY zone ———
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 12px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('Your inventory', invX, invY + 14);

  // Hotbar — center within inv zone if wide enough
  const hotbarW = HOTBAR_SIZE * (cell + 4) - 4;
  let hy = invY + 22;
  let hx = invX + Math.max(0, Math.floor((invW - hotbarW) / 2));
  if (hx + hotbarW > invX + invW) hx = invX;

  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const x = hx + i * (cell + 4);
    if (x + cell > invX + invW + 2) break;
    const sel = ui.invPick && ui.invPick.from === 'hotbar' && ui.invPick.i === i;
    drawInvSlot(ctx, x, hy, cell, inv.hotbar[i], sel);
    ui.creativeHit.push({ kind: 'slot', from: 'hotbar', i, x, y: hy, w: cell, h: cell });
  }

  const used = bagUsed(inv);
  ctx.fillStyle = '#9ec5b0';
  ctx.font = '600 11px system-ui';
  ctx.fillText('Backpack ' + used + '/' + BAG_SIZE, invX, hy + cell + 16);

  const by = hy + cell + 22;
  const bagCell = cell;
  const bagGap = gap;
  // Fit as many bag columns as the inv zone allows (cap 6)
  const fitBagCols = Math.min(bagCols, Math.max(4, Math.floor((invW + bagGap) / (bagCell + bagGap))));
  for (let i = 0; i < inv.bag.length; i++) {
    const col = i % fitBagCols;
    const row = Math.floor(i / fitBagCols);
    const x = invX + col * (bagCell + bagGap);
    const y = by + row * (bagCell + bagGap);
    // Strictly stay inside inventory zone
    if (y + bagCell > invY + invH - 4) break;
    if (x + bagCell > invX + invW + 2) continue;
    const sel = ui.invPick && ui.invPick.from === 'bag' && ui.invPick.i === i;
    drawInvSlot(ctx, x, y, bagCell, inv.bag[i], sel);
    ui.creativeHit.push({ kind: 'slot', from: 'bag', i, x, y, w: bagCell, h: bagCell });
  }

  // Footer tip
  ctx.fillStyle = '#8899aa';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  const tip = ui.invPick
    ? 'Click a slot to place · click catalog / empty to delete'
    : 'Click catalog to take · drag items · dbl-click hotbar↔bag';
  ctx.fillText(tip, px + pw / 2, py + ph - 8);
}

export function drawHoverTip(ctx, ui) {
  const tip = ui && ui.hoverTip;
  if (!tip || !tip.text) return;
  ctx.font = '700 12px system-ui';
  const padX = 10;
  const padY = 6;
  const tw = ctx.measureText(tip.text).width;
  const bw = tw + padX * 2;
  const bh = 22;
  let bx = tip.x + 14;
  let by = tip.y - bh - 8;
  if (bx + bw > W - 6) bx = W - bw - 6;
  if (bx < 6) bx = 6;
  if (by < 6) by = tip.y + 16;
  ctx.fillStyle = 'rgba(6,14,10,0.92)';
  roundRect(ctx, bx, by, bw, bh, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(125,255,160,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#e8fff0';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(tip.text, bx + padX, by + bh / 2 + 0.5);
  ctx.textBaseline = 'alphabetic';
}

export function drawInvDragGhost(ctx, ui) {
  const d = ui && ui.invDrag;
  if (!d || !d.active || d.id == null) return;
  const size = 36;
  const x = d.x - size / 2;
  const y = d.y - size / 2;
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  roundRect(ctx, x, y, size, size, 8);
  ctx.fill();
  drawItemIcon(ctx, x + 4, y + 4, size - 8, d.id);
  if (d.count > 1) {
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(String(d.count), x + size - 3, y + size - 4);
  }
  ctx.globalAlpha = 1;
}

export function drawBagPanel(ctx, inv, ui) {
  const pw = 340;
  const ph = 480;
  const px = (W - pw) / 2;
  const py = Math.max(8, (H - ph) / 2 - 8);
  ui.bagHit = [];

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(12, 28, 22, 0.98)';
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(125,255,160,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const used = bagUsed(inv);
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 20px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('🎒 Inventory', px + 16, py + 30);

  const closeX = px + pw - 44;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, closeX, py + 10, 32, 32, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 16px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('✕', closeX + 16, py + 32);
  ui.bagHit.push({ kind: 'close', x: closeX, y: py + 10, w: 32, h: 32 });

  ctx.fillStyle = '#9ec5b0';
  ctx.font = '12px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('Backpack ' + used + '/' + BAG_SIZE + ' · tap to move ↔ hotbar', px + 16, py + 52);

  const cell = 40;
  const gap = 6;

  // Hotbar section
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 13px system-ui';
  ctx.fillText('Hotbar — what you hold', px + 16, py + 76);
  const hy = py + 86;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const x = px + 12 + i * (cell + 4);
    const sel = ui.invPick && ui.invPick.from === 'hotbar' && ui.invPick.i === i;
    drawInvSlot(ctx, x, hy, cell, inv.hotbar[i], sel);
    ui.bagHit.push({ kind: 'slot', from: 'hotbar', i, x, y: hy, w: cell, h: cell });
  }

  // Quick stow all extras button
  const stowY = hy + cell + 12;
  ctx.fillStyle = 'rgba(125,255,160,0.15)';
  roundRect(ctx, px + 16, stowY, pw - 32, 32, 10);
  ctx.fill();
  ctx.fillStyle = '#c8f5d8';
  ctx.font = '600 12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('⬇ Stow full stacks into backpack', W / 2, stowY + 21);
  ui.bagHit.push({ kind: 'stow', x: px + 16, y: stowY, w: pw - 32, h: 32 });

  // Bag grid
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 13px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('Backpack — extra storage', px + 16, stowY + 54);
  const by = stowY + 64;
  const cols = 6;
  for (let i = 0; i < inv.bag.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = px + 16 + col * (cell + gap);
    const y = by + row * (cell + gap);
    const sel = ui.invPick && ui.invPick.from === 'bag' && ui.invPick.i === i;
    drawInvSlot(ctx, x, y, cell, inv.bag[i], sel);
    ui.bagHit.push({ kind: 'slot', from: 'bag', i, x, y, w: cell, h: cell });
  }

  ctx.fillStyle = '#8899aa';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(
    ui.invPick
      ? 'Click a slot to place · same slot cancels · drag also works'
      : 'Click / drag to move · double-click hotbar↔bag · hover for names',
    W / 2,
    py + ph - 14
  );
}

export function drawCraftPanel(ctx, inv, world, player, ui) {
  const pw = 340;
  const ph = 520;
  const px = (W - pw) / 2;
  const py = Math.max(8, (H - ph) / 2 - 8);
  ui.craftHit = [];

  // Dim world behind
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);

  // Panel
  ctx.fillStyle = 'rgba(12, 28, 22, 0.98)';
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = 'rgba(125,255,160,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Title + close
  ctx.fillStyle = '#7dffa0';
  ctx.font = '700 20px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('Craft', px + 18, py + 32);
  // Close X
  const cx = px + pw - 44;
  const cy = py + 12;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, cx, cy, 32, 32, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '700 18px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('✕', cx + 16, cy + 22);
  ui.craftHit.push({ kind: 'close', x: cx, y: cy, w: 32, h: 32 });

  // Station status
  const atBench = stationAvailable(world, player.x, player.y, 'workbench');
  const atFurn = stationAvailable(world, player.x, player.y, 'furnace');
  ctx.font = '11px system-ui';
  ctx.textAlign = 'left';
  ctx.fillStyle = atBench ? '#7dffa0' : '#8899aa';
  ctx.fillText(atBench ? '✓ Workbench nearby' : '○ No workbench (tools locked)', px + 18, py + 52);
  ctx.fillStyle = atFurn ? '#7dffa0' : '#8899aa';
  ctx.fillText(atFurn ? '✓ Furnace nearby' : '○ No furnace (smelting locked)', px + 18, py + 68);

  // Tabs
  const tabY = py + 80;
  const tabs = CRAFT_TABS;
  const tabW = (pw - 36) / tabs.length;
  if (!ui.craftTab) ui.craftTab = 'basic';
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    const tx = px + 12 + i * tabW;
    const on = ui.craftTab === t.id;
    ctx.fillStyle = on ? 'rgba(125,255,160,0.22)' : 'rgba(255,255,255,0.06)';
    roundRect(ctx, tx, tabY, tabW - 6, 34, 10);
    ctx.fill();
    if (on) {
      ctx.strokeStyle = 'rgba(125,255,160,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = on ? '#e8fff0' : '#9ec5b0';
    ctx.font = '700 13px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(t.label, tx + (tabW - 6) / 2, tabY + 22);
    ui.craftHit.push({ kind: 'tab', tab: t.id, x: tx, y: tabY, w: tabW - 6, h: 34 });
  }

  // Recipe list
  const rows = recipesInTab(ui.craftTab, world, player.x, player.y);
  const listTop = tabY + 44;
  const listH = 200;
  const rowH = 48;
  const visible = Math.floor(listH / rowH);
  const maxScroll = Math.max(0, rows.length - visible);
  ui.craftScroll = Math.max(0, Math.min(maxScroll, ui.craftScroll || 0));

  // Scroll buttons
  if (rows.length > visible) {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    roundRect(ctx, px + pw - 40, listTop, 28, 28, 8);
    ctx.fill();
    roundRect(ctx, px + pw - 40, listTop + listH - 28, 28, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 16px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('▲', px + pw - 26, listTop + 20);
    ctx.fillText('▼', px + pw - 26, listTop + listH - 8);
    ui.craftHit.push({ kind: 'scroll', dir: -1, x: px + pw - 40, y: listTop, w: 28, h: 28 });
    ui.craftHit.push({ kind: 'scroll', dir: 1, x: px + pw - 40, y: listTop + listH - 28, w: 28, h: 28 });
  }

  // Clip list area
  ctx.save();
  ctx.beginPath();
  ctx.rect(px + 12, listTop, pw - 56, listH);
  ctx.clip();

  for (let i = 0; i < visible; i++) {
    const idx = i + ui.craftScroll;
    if (idx >= rows.length) break;
    const row = rows[idx];
    const r = row.recipe;
    const y = listTop + i * rowH;
    const can = row.stationOk && canCraft(inv, r);
    const sel = ui.craftSelected === r.id;

    ctx.fillStyle = sel
      ? 'rgba(125,255,160,0.2)'
      : can
        ? 'rgba(125,255,160,0.1)'
        : 'rgba(255,255,255,0.04)';
    roundRect(ctx, px + 12, y + 2, pw - 56, rowH - 4, 10);
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = 'rgba(125,255,160,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const outId = r.out[0];
    drawItemIcon(ctx, px + 20, y + 8, 30, outId);

    // Name (single line, ellipsize if long)
    ctx.fillStyle = can ? '#f0fff6' : '#99aabb';
    ctx.font = '700 13px system-ui';
    ctx.textAlign = 'left';
    const nameMaxW = pw - 100;
    let name = r.name;
    if (ctx.measureText(name).width > nameMaxW) {
      while (name.length > 4 && ctx.measureText(name + '…').width > nameMaxW) {
        name = name.slice(0, -1);
      }
      name += '…';
    }
    ctx.fillText(name, px + 58, y + 18);

    // Second line: locked station badge OR material chips (never both overlapping the name)
    if (!row.stationOk) {
      const hint = stationHint(r.station) || 'Need station';
      ctx.font = '600 10px system-ui';
      const hw = Math.min(pw - 100, ctx.measureText(hint).width + 12);
      ctx.fillStyle = 'rgba(255, 160, 60, 0.22)';
      roundRect(ctx, px + 58, y + 24, hw, 16, 5);
      ctx.fill();
      ctx.fillStyle = '#ffc878';
      ctx.fillText(hint, px + 64, y + 36);
    } else {
      let mx = px + 58;
      ctx.font = '600 10px system-ui';
      for (const [id, n] of r.in) {
        const have = countItem(inv, id);
        const okM = have >= n;
        ctx.fillStyle = okM ? 'rgba(125,255,160,0.2)' : 'rgba(255,100,100,0.18)';
        const label = have + '/' + n + ' ' + itemName(id);
        const tw = Math.min(100, ctx.measureText(label).width + 10);
        if (mx + tw > px + pw - 60) break;
        roundRect(ctx, mx, y + 24, tw, 16, 5);
        ctx.fill();
        ctx.fillStyle = okM ? '#b8f5c8' : '#ffb0b0';
        ctx.fillText(label, mx + 5, y + 36);
        mx += tw + 4;
      }
    }

    ui.craftHit.push({
      kind: 'select',
      recipe: r,
      stationOk: row.stationOk,
      x: px + 12,
      y: y + 2,
      w: pw - 56,
      h: rowH - 4,
    });
  }
  ctx.restore();

  // Detail + CRAFT button
  const detailY = listTop + listH + 12;
  let selected = rows.find(row => row.recipe.id === ui.craftSelected);
  if (!selected && rows.length) {
    selected = rows[0];
    ui.craftSelected = selected.recipe.id;
  }

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, px + 12, detailY, pw - 24, 120, 12);
  ctx.fill();

  if (selected) {
    const r = selected.recipe;
    const can = selected.stationOk && canCraft(inv, r);
    drawItemIcon(ctx, px + 24, detailY + 16, 40, r.out[0]);
    ctx.fillStyle = '#e8fff0';
    ctx.font = '700 16px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(r.name, px + 76, detailY + 34);

    ctx.font = '12px system-ui';
    ctx.fillStyle = '#9ec5b0';
    let line = 'Needs: ';
    for (const [id, n] of r.in) {
      const have = countItem(inv, id);
      line += itemName(id) + ' ' + have + '/' + n + '   ';
    }
    ctx.fillText(line.trim(), px + 76, detailY + 54);

    if (!selected.stationOk) {
      ctx.fillStyle = '#ffb347';
      ctx.font = '600 12px system-ui';
      ctx.fillText(stationHint(r.station), px + 76, detailY + 72);
    } else if (!can) {
      const miss = missingMaterials(inv, r);
      ctx.fillStyle = '#ff8a80';
      ctx.font = '600 12px system-ui';
      if (miss.length) {
        ctx.fillText('Missing ' + itemName(miss[0].id) + ' (have ' + miss[0].have + ', need ' + miss[0].need + ')', px + 76, detailY + 72);
      }
    } else {
      ctx.fillStyle = '#7dffa0';
      ctx.font = '600 12px system-ui';
      ctx.fillText('Ready to craft!', px + 76, detailY + 72);
    }

    // Big CRAFT button
    const btnY = detailY + 82;
    const btnH = 36;
    ctx.fillStyle = can ? 'rgba(125,255,160,0.85)' : 'rgba(120,120,120,0.35)';
    roundRect(ctx, px + 20, btnY, pw - 40, btnH, 12);
    ctx.fill();
    ctx.fillStyle = can ? '#0a1f12' : '#666';
    ctx.font = '700 16px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(can ? '⚒  CRAFT' : (selected.stationOk ? 'Need materials' : 'Need station'), W / 2, btnY + 24);
    ui.craftHit.push({
      kind: 'craft',
      recipe: r,
      stationOk: selected.stationOk,
      ok: can,
      x: px + 20,
      y: btnY,
      w: pw - 40,
      h: btnH,
    });
  } else {
    ctx.fillStyle = '#8899aa';
    ctx.font = '14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('No recipes in this tab', W / 2, detailY + 60);
  }

  ctx.fillStyle = '#7a9a8a';
  ctx.font = '11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('Tap a recipe, then CRAFT · ⚒ or C to close', W / 2, py + ph - 14);
}
