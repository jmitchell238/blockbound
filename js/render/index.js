import {
  W, H, TILE, WORLD_H, SURFACE_Y,
} from '../core/constants.js';
import { WORLD_W } from '../core/worldSize.js';
import { getDifficulty, creativeCatalog } from '../core/difficulty.js';
import { BLOCK, BLOCK_META, isPlatform } from '../content/blocks.js';
import { TOOLS, FOOD, isTool, isFood, isWeapon } from '../content/tools.js';
import { itemName, isBlockItem } from '../content/items.js';
import {
  wrapX, getTile, getLight, getRenderLight, lightToBrightness, isSolid, biomeNameAt,
} from '../world/index.js';
import { textures, getCubeTex, getTileTex, getSoftTex, getItemIcon } from '../textures/textures.js';
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

  // Cave / underground air — pitch dark without light, lit by torches/lanterns
  for (let ty = startTY; ty <= startTY + tilesY; ty++) {
    if (ty < 0 || ty >= WORLD_H) continue;
    for (let tx = startTX; tx <= startTX + tilesX; tx++) {
      const wx = wrapX(tx);
      const t = getTile(world, wx, ty);
      if (t !== BLOCK.AIR && t !== BLOCK.WATER) continue;
      const belowSurface = ty > (world.surface[wx] || SURFACE_Y) + 0;
      const lvl = getRenderLight(world, wx, ty);
      // Open sky air: leave the sky gradient showing
      if (!belowSurface && lvl >= 12) continue;

      const sx = (tx - cam.x) * ts + W / 2;
      const sy = (ty - cam.y) * ts + H / 2;
      const bri = lightToBrightness(lvl, { ambient: 0.02 });
      // Unlit cave = near black; lit pocket = warm rock tone
      const depth = Math.min(1, Math.max(0, (ty - (world.surface[wx] || SURFACE_Y)) / 28));
      const baseR = 18 + depth * 8;
      const baseG = 16 + depth * 6;
      const baseB = 22 + depth * 10;
      // When lit, show a faint warm fill so torch glow reads in empty air
      const warm = lvl > 0 ? (lvl / 15) * 0.35 : 0;
      const r = Math.min(255, (baseR + warm * 80) * bri + warm * 20);
      const g = Math.min(255, (baseG + warm * 50) * bri + warm * 12);
      const b = Math.min(255, (baseB + warm * 20) * bri);
      // Always paint a darkness plate for underground / dim air
      const darkA = belowSurface ? (1 - bri) * 0.97 : (1 - bri) * 0.75;
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      if (belowSurface || lvl < 12) {
        ctx.fillRect(sx, sy, ts + 0.6, ts + 0.6);
      }
      // Extra black veil when nearly unlit
      if (darkA > 0.15) {
        ctx.fillStyle = `rgba(0,0,0,${Math.min(0.92, darkA)})`;
        ctx.fillRect(sx, sy, ts + 0.6, ts + 0.6);
      }
      // Subtle rock speck only when somewhat lit
      if (bri > 0.12 && belowSurface && ((wx * 13 + ty * 7) & 7) === 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.03 * bri})`;
        ctx.fillRect(sx + 4, sy + 6, 3, 2);
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
      const lvl = getRenderLight(world, wx, ty);
      let dayMul = lightToBrightness(lvl, { ambient: 0.03 });
      // Surface / open sky: blend in daylight
      const nearSurface = ty <= (world.surface[wx] || SURFACE_Y) + 1;
      if (nearSurface && lvl >= 8) {
        const skyMul = 0.2 + 0.8 * sky.day;
        dayMul = Math.max(dayMul, skyMul * lightToBrightness(lvl, { ambient: 0.15 }));
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

  // Rain
  if (ui && ui.weather > 0.05) {
    drawRain(ctx, ui.weather, cam, timeOfDay);
  }

  // Local darkness around the player when underground / unlit
  {
    const pLight = getRenderLight(world, Math.floor(player.x), Math.floor(player.y - 0.5));
    const bri = lightToBrightness(pLight, { ambient: 0.02 });
    const under = player.y > (world.surface[wrapX(Math.floor(player.x))] || SURFACE_Y) + 2;
    if (under || pLight < 10) {
      const darkness = under ? (1 - bri) * 0.72 : (1 - bri) * 0.45;
      if (darkness > 0.08) {
        const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.72);
        v.addColorStop(0, `rgba(0,0,0,${darkness * 0.15})`);
        v.addColorStop(0.55, `rgba(0,0,0,${darkness * 0.55})`);
        v.addColorStop(1, `rgba(0,0,0,${Math.min(0.92, darkness * 0.95)})`);
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

/** Soft ambient occlusion — keep light so seams don't look like a grid. */
export function blockAO(world, x, y) {
  let s = 0;
  if (isSolid(world, x - 1, y)) s += 0.04;
  if (isSolid(world, x + 1, y)) s += 0.04;
  if (isSolid(world, x, y - 1)) s += 0.03;
  if (isSolid(world, x, y + 1)) s += 0.05;
  return Math.min(0.18, s);
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

/** Procedural torch — upright on floor, angled off walls, hanging from ceiling. */
export function drawTorchSprite(ctx, sx, sy, ts, facing, seed) {
  const flicker = 0.62 + 0.38 * Math.sin(performance.now() / 85 + (seed || 0));
  let baseX;
  let baseY;
  let tipX;
  let tipY;

  if (facing === 'left') {
    // Mounted on left wall → stick angles up-right out of the wall
    baseX = sx + ts * 0.1;
    baseY = sy + ts * 0.62;
    tipX = sx + ts * 0.68;
    tipY = sy + ts * 0.22;
  } else if (facing === 'right') {
    // Mounted on right wall → stick angles up-left
    baseX = sx + ts * 0.9;
    baseY = sy + ts * 0.62;
    tipX = sx + ts * 0.32;
    tipY = sy + ts * 0.22;
  } else if (facing === 'ceil') {
    // Hanging from ceiling
    baseX = sx + ts * 0.5;
    baseY = sy + ts * 0.08;
    tipX = sx + ts * 0.5;
    tipY = sy + ts * 0.58;
  } else {
    // Floor / standing
    baseX = sx + ts * 0.5;
    baseY = sy + ts * 0.9;
    tipX = sx + ts * 0.5;
    tipY = sy + ts * 0.3;
  }

  // Stick
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#3d2812';
  ctx.lineWidth = Math.max(2.5, ts * 0.14);
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.strokeStyle = '#6b4420';
  ctx.lineWidth = Math.max(1.8, ts * 0.1);
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // Ember band near tip
  const midX = baseX * 0.25 + tipX * 0.75;
  const midY = baseY * 0.25 + tipY * 0.75;
  ctx.strokeStyle = '#8a4a18';
  ctx.lineWidth = Math.max(2, ts * 0.12);
  ctx.beginPath();
  ctx.moveTo(midX, midY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // Flame core
  ctx.fillStyle = '#ffcc44';
  ctx.beginPath();
  ctx.arc(tipX, tipY, ts * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 240, 120, ${0.75 * flicker})`;
  ctx.beginPath();
  ctx.arc(tipX, tipY - ts * 0.03, ts * 0.09, 0, Math.PI * 2);
  ctx.fill();

  // Soft glow
  const g = ctx.createRadialGradient(tipX, tipY, 1, tipX, tipY, ts * 0.55);
  g.addColorStop(0, `rgba(255, 170, 40, ${0.4 * flicker})`);
  g.addColorStop(1, 'rgba(255, 120, 20, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(tipX, tipY, ts * 0.55, 0, Math.PI * 2);
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

  ctx.save();
  ctx.globalAlpha = alpha;

  const depth = Math.max(2, ts * 0.08);
  const useFlat = id === BLOCK.WATER || id === BLOCK.TORCH || id === BLOCK.LANTERN || id === BLOCK.LADDER
    || id === BLOCK.LEAVES || id === BLOCK.GLASS || id === BLOCK.PLATFORM || id === BLOCK.CAMPFIRE
    || isTerrainBlock(id);

  // Overlap neighbors slightly so grid lines disappear
  const pad = isTerrainBlock(id) ? 0.75 : 0.35;

  if (useFlat && soft && id !== BLOCK.WATER && id !== BLOCK.TORCH && id !== BLOCK.LANTERN
      && id !== BLOCK.LADDER && id !== BLOCK.LEAVES && id !== BLOCK.CAMPFIRE && id !== BLOCK.PLATFORM) {
    // Seamless terrain: soft face, slight top highlight only if air above
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(soft, sx - pad, sy - pad, ts + pad * 2, ts + pad * 2);
    // Soft top edge only when open to sky (reads as ground without cube seams)
    // (caller doesn't pass world here — lightMul high on surface is enough)
    if (lightMul > 0.75 && (id === BLOCK.GRASS || id === BLOCK.SNOW || id === BLOCK.SAND)) {
      ctx.globalAlpha = alpha * 0.18;
      ctx.fillStyle = m.top || '#fff';
      ctx.fillRect(sx - pad, sy - pad, ts + pad * 2, Math.max(2, ts * 0.12));
      ctx.globalAlpha = alpha;
    }
  } else if (cube && !useFlat) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cube, sx - pad, sy - pad, ts + pad * 2, ts + pad * 2);
  } else if (face && !useFlat) {
    ctx.imageSmoothingEnabled = true;
    drawTexturedCube(ctx, sx, sy, ts, face, id);
  } else if (face && useFlat && id !== BLOCK.WATER && id !== BLOCK.TORCH && id !== BLOCK.LANTERN
      && id !== BLOCK.LADDER && id !== BLOCK.LEAVES) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(face, sx - pad, sy - pad, ts + pad * 2, ts + pad * 2);
  } else if (!face && !cube) {
    const base = shadeHex(m.color, 0.55 + 0.45 * lightMul);
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

  // Darkness multiply — unlit blocks go nearly black (need torches/lanterns)
  const shade = Math.max(0.02, lightMul * (1 - ao * 0.4));
  if (shade < 0.97 && id !== BLOCK.TORCH && id !== BLOCK.LANTERN && id !== BLOCK.LAVA && id !== BLOCK.CAMPFIRE) {
    ctx.globalAlpha = Math.min(0.96, (1 - shade) * 0.98);
    ctx.fillStyle = '#010308';
    ctx.fillRect(sx - 0.5, sy - 0.5, ts + 1, ts + 1);
  }

  // Subtle grass tufts only on surface grass (sparse)
  if (id === BLOCK.GRASS && lightMul > 0.7 && ((wx * 5 + ty * 3) % 4 === 0)) {
    ctx.globalAlpha = 0.55 * lightMul;
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
export function drawPlayer(ctx, p, cam, ts, inv) {
  const sx = (p.x - cam.x) * ts + W / 2;
  const sy = (p.y - cam.y) * ts + H / 2;
  const pw = p.w * ts;
  const ph = p.h * ts;
  const walking = p.onGround && Math.abs(p.vx) > 0.25 && !p.crouching;
  const run = Math.min(1, Math.abs(p.vx) / 4);

  ctx.save();
  if (p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0) {
    ctx.globalAlpha = 0.45;
  }

  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 1, pw * (0.5 + run * 0.12), 4.2, 0, 0, Math.PI * 2);
  ctx.fill();

  if (p.inBoat) {
    ctx.fillStyle = '#8b5a2b';
    ctx.beginPath();
    ctx.ellipse(sx, sy - 4, pw * 1.15, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c49a5a';
    ctx.fillRect(sx - pw * 0.9, sy - 10, pw * 1.8, 6);
  }

  const footY = sy + (p.inBoat ? -6 : 0);
  const drawH = ph * (p.crouching ? 0.88 : 1.05);
  ctx.save();
  ctx.translate(sx, footY);
  if (p.facing < 0) ctx.scale(-1, 1);
  drawHeroSide(ctx, p, drawH);
  ctx.restore();

  ctx.restore();
}

/**
 * Original Blockbound hero (orange hoodie, curly hair, jeans) —
 * side view, feet at origin, faces +X.
 * Limbs pivot from hips/shoulders for a real forward/back stride.
 */
function drawHeroSide(ctx, p, H) {
  const crouch = !!p.crouching;
  const walking = p.onGround && Math.abs(p.vx) > 0.25 && !crouch;
  const airborne = !p.onGround;
  const mining = !!(p.mining && p.mining.progress > 0);
  const swinging = (p.attackT || 0) > 0;

  const sprint = p.sprinting ? 1.18 : 1;
  const phase = p.anim * 2.55 * sprint;
  const step = walking ? Math.sin(phase) : airborne ? 0.5 : 0;
  const bob = walking ? Math.abs(Math.sin(phase)) * (H * 0.03) : 0;

  // Slightly taller/softer proportions than pure Steve (matches original art)
  const u = H / 34;
  const headS = 9.2 * u;
  const torsoH = (crouch ? 10 : 12.5) * u;
  const torsoW = 9 * u;
  const limbW = 3.8 * u;
  const legH = (crouch ? 8 : 12.5) * u;
  const armH = 12 * u;

  const maxLeg = walking ? 0.78 : airborne ? 0.4 : 0.06;
  const maxArm = walking ? 0.82 : 0.1;
  const legA = step * maxLeg;
  const legB = -step * maxLeg;
  let armA = step * maxArm;
  let armB = -step * maxArm;

  if (mining || swinging) {
    const t = mining ? p.mining.progress * 8 : (p.attackT || 0) * 14;
    armB = -0.4 - Math.sin(t) * 1.2;
  }

  // Original character palette (orange hoodie boy)
  const skin = '#e8b896';
  const skinSh = '#d49a72';
  const hoodie = '#e85d3a';
  const hoodieSh = '#c44a2c';
  const hoodieHi = '#f07855';
  const jeans = '#3a5fad';
  const jeansSh = '#2a4688';
  const hair = '#6b4423';
  const hairSh = '#4a2e16';
  const hairHi = '#8a5a32';
  const boot = '#3d2918';
  const bootHi = '#5a3d24';

  const hipY = -bob - legH;
  const shoulderY = hipY - torsoH;
  const headY = shoulderY - headS + u * 0.4;
  const lean = walking ? step * 0.05 : 0;

  function limb(px, py, angle, w, h, fill, isLeg) {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = fill;
    // Slightly rounded look via double rect (blocky but soft edge)
    ctx.fillRect(-w / 2, 0, w, h);
    if (isLeg) {
      // boot
      ctx.fillStyle = boot;
      ctx.fillRect(-w / 2 - u * 0.2, h - u * 1.5, w + u * 0.7, u * 1.65);
      ctx.fillStyle = bootHi;
      ctx.fillRect(-w / 2 - u * 0.1, h - u * 1.5, w + u * 0.35, u * 0.45);
    } else {
      // hand
      ctx.fillStyle = skin;
      ctx.fillRect(-w / 2 + u * 0.1, h - w * 0.92, w * 0.9, w * 0.9);
    }
    ctx.restore();
  }

  const farHipX = -limbW * 0.4;
  const nearHipX = limbW * 0.4;
  const farShX = -torsoW / 2 + limbW * 0.2;
  const nearShX = torsoW / 2 - limbW * 0.2;

  // FAR limbs (behind)
  limb(farHipX, hipY, legA, limbW, legH, jeansSh, true);
  limb(farShX, shoulderY, armA, limbW * 0.95, armH, hoodieSh, false);

  // Torso / hoodie
  ctx.save();
  ctx.translate(0, hipY);
  ctx.rotate(lean);
  // hoodie body
  ctx.fillStyle = hoodie;
  ctx.fillRect(-torsoW / 2, -torsoH, torsoW, torsoH);
  // shade
  ctx.fillStyle = hoodieSh;
  ctx.fillRect(torsoW / 2 - u * 1.6, -torsoH, u * 1.6, torsoH);
  // hood/collar fold at top of torso
  ctx.fillStyle = hoodieHi;
  ctx.fillRect(-torsoW / 2, -torsoH, torsoW, u * 1.4);
  ctx.fillStyle = hoodieSh;
  ctx.fillRect(-torsoW / 2 + u * 0.5, -torsoH + u * 0.3, torsoW - u, u * 0.9);
  // pocket
  ctx.fillStyle = hoodieSh;
  ctx.fillRect(-u * 1.6, -torsoH * 0.45, u * 3.2, u * 2.2);
  // waist / jeans peek
  ctx.fillStyle = jeans;
  ctx.fillRect(-torsoW / 2 + u * 0.3, -u * 1.4, torsoW - u * 0.6, u * 1.5);
  ctx.restore();

  // NEAR limbs (front)
  limb(nearHipX, hipY, legB, limbW, legH, jeans, true);
  limb(nearShX, shoulderY, armB, limbW * 0.95, armH, hoodie, false);

  // Tool while mining / attacking
  if (mining || swinging) {
    ctx.save();
    ctx.translate(nearShX, shoulderY);
    ctx.rotate(armB);
    ctx.translate(0, armH * 0.9);
    ctx.rotate(-0.4);
    ctx.fillStyle = '#6b3f1a';
    ctx.fillRect(-u * 0.55, -u * 0.3, u * 1.1, armH * 0.55);
    ctx.fillStyle = '#9aa3ab';
    ctx.fillRect(-u * 2.5, -u * 2.0, u * 5.0, u * 2.2);
    ctx.fillStyle = '#6d757c';
    ctx.fillRect(-u * 2.5, -u * 0.35, u * 5.0, u * 0.65);
    ctx.restore();
  }

  // ── Head: original hero face (curly hair, friendly — not googly) ──
  ctx.save();
  ctx.translate(lean * torsoH * 0.35, 0);

  // neck
  ctx.fillStyle = skinSh;
  ctx.fillRect(-u * 1.4, shoulderY - u * 0.8, u * 2.8, u * 1.2);

  // face block (slightly rounded via layered rects)
  ctx.fillStyle = skin;
  ctx.fillRect(-headS / 2, headY, headS, headS * 0.95);
  ctx.fillStyle = skinSh;
  ctx.fillRect(headS / 2 - u * 1.3, headY + headS * 0.35, u * 1.3, headS * 0.5);

  // ear
  ctx.fillStyle = skinSh;
  ctx.fillRect(-headS / 2 - u * 1.0, headY + headS * 0.36, u * 1.2, headS * 0.26);

  // curly hair mass (messy top + side + fringe)
  ctx.fillStyle = hair;
  // main cap
  ctx.fillRect(-headS / 2 - u * 0.4, headY - u * 1.2, headS + u * 0.8, headS * 0.42);
  // curls / tufts
  ctx.fillRect(-headS / 2 - u * 0.8, headY - u * 0.3, u * 2.2, u * 2.0);
  ctx.fillRect(headS / 2 - u * 1.4, headY - u * 0.6, u * 2.0, u * 1.6);
  ctx.fillRect(-u * 1.2, headY - u * 2.0, u * 2.4, u * 1.6);
  ctx.fillRect(u * 0.4, headY - u * 1.8, u * 2.0, u * 1.4);
  // side hair over ear
  ctx.fillRect(-headS / 2 - u * 0.5, headY + headS * 0.2, u * 1.8, headS * 0.55);
  // fringe
  ctx.fillStyle = hairHi;
  ctx.fillRect(-headS / 2 + u * 0.3, headY + u * 0.2, headS * 0.55, u * 1.3);
  ctx.fillStyle = hairSh;
  ctx.fillRect(-headS / 2 - u * 0.2, headY - u * 0.4, headS * 0.4, u * 1.8);

  // Eyes — dark ovals like the original sprite (small, not googly white discs)
  const eyeY = headY + headS * 0.42;
  // white of eye (thin)
  ctx.fillStyle = '#f4efe8';
  ctx.fillRect(headS * 0.02, eyeY, headS * 0.32, headS * 0.2);
  // iris / pupil
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(headS * 0.12, eyeY + u * 0.25, headS * 0.16, headS * 0.14);
  // tiny specular
  ctx.fillStyle = '#fff';
  ctx.fillRect(headS * 0.2, eyeY + u * 0.35, u * 0.45, u * 0.4);

  // brow
  ctx.fillStyle = hairSh;
  ctx.fillRect(headS * 0.0, eyeY - u * 0.55, headS * 0.34, u * 0.45);

  // nose
  ctx.fillStyle = skinSh;
  ctx.fillRect(headS * 0.26, headY + headS * 0.54, headS * 0.16, headS * 0.12);

  // small smile
  ctx.fillStyle = '#b07050';
  ctx.fillRect(headS * 0.04, headY + headS * 0.72, headS * 0.28, u * 0.55);
  ctx.fillStyle = skin;
  ctx.fillRect(headS * 0.06, headY + headS * 0.72, headS * 0.24, u * 0.28);

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
