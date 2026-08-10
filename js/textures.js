'use strict';

/**
 * Texture atlas loader + softer cube bake (less harsh outlines/seams).
 */

const TEX_SIZE = 64;
const TILE_FILES = {
  [BLOCK.GRASS]: 'grass',
  [BLOCK.DIRT]: 'dirt',
  [BLOCK.STONE]: 'stone',
  [BLOCK.SAND]: 'sand',
  [BLOCK.WOOD]: 'wood',
  [BLOCK.LEAVES]: 'leaves',
  [BLOCK.COAL]: 'coal',
  [BLOCK.IRON]: 'iron',
  [BLOCK.GOLD]: 'gold',
  [BLOCK.COPPER]: 'copper',
  [BLOCK.LAVA]: 'lava',
  [BLOCK.BEDROCK]: 'bedrock',
  [BLOCK.WATER]: 'water',
  [BLOCK.SNOW]: 'snow',
  [BLOCK.CLAY]: 'clay',
  [BLOCK.LADDER]: 'ladder',
  [BLOCK.TORCH]: 'torch',
  [BLOCK.WORKBENCH]: 'workbench',
  [BLOCK.PLANKS]: 'planks',
  [BLOCK.GLASS]: 'glass',
  [BLOCK.BRICK]: 'brick',
};

const textures = {
  ready: false,
  tiles: Object.create(null),
  cube: Object.create(null),
  /** Soft seamless face (no cube outline) for terrain blending */
  soft: Object.create(null),
  player: null,
  clouds: null,
  crack: [],
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('fail ' + src));
    img.src = src;
  });
}

/** Soft 2.5D cube — shallow depth, no hard black outline. */
function bakeCube(faceImg, transparent) {
  const S = 72;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  // Shallower bevel so blocks don't read as toy cubes
  const depth = Math.floor(S * 0.1);
  const frontW = S - depth;
  const frontH = S - depth;
  const frontX = 0;
  const frontY = depth;

  // Top face — soft
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(frontX, frontY);
  ctx.lineTo(frontX + depth, 0);
  ctx.lineTo(frontX + depth + frontW, 0);
  ctx.lineTo(frontX + frontW, frontY);
  ctx.closePath();
  ctx.clip();
  ctx.transform(1, 0, -0.35, 0.45, depth * 0.4, 0);
  ctx.globalAlpha = 0.95;
  ctx.filter = 'brightness(1.08)';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(faceImg, 0, 0, frontW + depth, depth + 6);
  ctx.filter = 'none';
  ctx.restore();

  // Right face — subtle
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(frontX + frontW, frontY);
  ctx.lineTo(frontX + frontW + depth, 0);
  ctx.lineTo(frontX + frontW + depth, frontH);
  ctx.lineTo(frontX + frontW, frontY + frontH);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fill();
  ctx.globalAlpha = 0.75;
  ctx.filter = 'brightness(0.82)';
  ctx.drawImage(faceImg, frontX + frontW - 4, frontY, depth + 6, frontH);
  ctx.filter = 'none';
  ctx.restore();

  // Front face
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(faceImg, frontX, frontY, frontW, frontH);
  // Very soft shading only
  const g = ctx.createLinearGradient(frontX, frontY, frontX, frontY + frontH);
  g.addColorStop(0, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.55, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.1)');
  ctx.fillStyle = g;
  ctx.fillRect(frontX, frontY, frontW, frontH);
  ctx.restore();

  // No hard outline — just a whisper of edge
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  ctx.strokeRect(frontX + 0.5, frontY + 0.5, frontW - 1, frontH - 1);

  return c;
}

/** Flat soft tile for seamless terrain (slight padding for overlap). */
function bakeSoftFace(faceImg) {
  const S = 68;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(faceImg, 0, 0, S, S);
  // Micro noise to break perfect grid
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 16) {
    const n = ((i * 13) % 7) - 3;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function bakeCracks() {
  textures.crack = [];
  for (let stage = 1; stage <= 5; stage++) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = `rgba(20,15,10,${0.2 + stage * 0.1})`;
    ctx.lineWidth = 1.2 + stage * 0.15;
    ctx.lineCap = 'round';
    const arms = 2 + stage;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2 + stage * 0.2;
      ctx.beginPath();
      ctx.moveTo(32, 32);
      const len = 10 + stage * 5;
      ctx.lineTo(32 + Math.cos(a) * len, 32 + Math.sin(a) * len);
      if (stage > 2) {
        ctx.lineTo(32 + Math.cos(a + 0.4) * len * 0.7, 32 + Math.sin(a + 0.5) * len * 0.65);
      }
      ctx.stroke();
    }
    textures.crack.push(c);
  }
}

function makeFallbackFace(id) {
  const c = document.createElement('canvas');
  c.width = TEX_SIZE;
  c.height = TEX_SIZE;
  const ctx = c.getContext('2d');
  const m = BLOCK_META[id];
  const col = (m && m.color) || '#888';
  ctx.fillStyle = col;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  if (m && m.top) {
    ctx.fillStyle = m.top;
    ctx.fillRect(0, 0, TEX_SIZE, 10);
  }
  return c;
}

async function loadTextures() {
  bakeCracks();
  const jobs = [];
  for (const [idStr, name] of Object.entries(TILE_FILES)) {
    const id = Number(idStr);
    jobs.push(
      loadImage('assets/tiles/' + name + '.png')
        .then(img => {
          textures.tiles[id] = img;
          const alpha = !!(BLOCK_META[id] && BLOCK_META[id].alpha != null && BLOCK_META[id].alpha < 1)
            || id === BLOCK.LADDER || id === BLOCK.TORCH || id === BLOCK.LEAVES || id === BLOCK.GLASS || id === BLOCK.WATER;
          textures.cube[id] = bakeCube(img, alpha);
          textures.soft[id] = bakeSoftFace(img);
        })
        .catch(() => {
          const fb = makeFallbackFace(id);
          textures.tiles[id] = fb;
          textures.cube[id] = bakeCube(fb, false);
          textures.soft[id] = bakeSoftFace(fb);
        })
    );
  }
  jobs.push(
    loadImage('assets/player/hero.png').then(img => { textures.player = img; }).catch(() => { textures.player = null; })
  );
  jobs.push(
    loadImage('assets/bg/clouds.png').then(img => { textures.clouds = img; }).catch(() => { textures.clouds = null; })
  );
  await Promise.all(jobs);
  textures.ready = true;
  return textures;
}

function getTileTex(id) {
  return textures.tiles[id] || null;
}

function getCubeTex(id) {
  return textures.cube[id] || null;
}

function getSoftTex(id) {
  return textures.soft[id] || textures.tiles[id] || null;
}
