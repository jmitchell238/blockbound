'use strict';

/**
 * Texture atlas loader + fallback procedural faces.
 * Loads assets/tiles/*.png and player/hero.png; game waits for ready.
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
  tiles: Object.create(null), // id -> HTMLImageElement | HTMLCanvasElement
  cube: Object.create(null),  // id -> pre-baked 2.5D cube canvas
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

/** Bake a 2.5D cube canvas from a square face texture. */
function bakeCube(faceImg, transparent) {
  const S = 72;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  const depth = Math.floor(S * 0.18);
  const frontW = S - depth;
  const frontH = S - depth;
  const frontX = 0;
  const frontY = depth;

  // Top face (parallelogram)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(frontX, frontY);
  ctx.lineTo(frontX + depth, 0);
  ctx.lineTo(frontX + depth + frontW, 0);
  ctx.lineTo(frontX + frontW, frontY);
  ctx.closePath();
  ctx.clip();
  ctx.transform(1, 0, -0.45, 0.55, depth * 0.5, 0);
  ctx.filter = 'brightness(1.18)';
  ctx.drawImage(faceImg, 0, 0, frontW + depth, depth + 4);
  ctx.filter = 'none';
  ctx.restore();

  // Right face
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(frontX + frontW, frontY);
  ctx.lineTo(frontX + frontW + depth, 0);
  ctx.lineTo(frontX + frontW + depth, frontH);
  ctx.lineTo(frontX + frontW, frontY + frontH);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.filter = 'brightness(0.72)';
  ctx.drawImage(faceImg, frontX + frontW - 4, frontY, depth + 8, frontH);
  ctx.filter = 'none';
  ctx.restore();

  // Front face
  ctx.save();
  if (!transparent) {
    ctx.drawImage(faceImg, frontX, frontY, frontW, frontH);
  } else {
    ctx.drawImage(faceImg, frontX, frontY, frontW, frontH);
  }
  // Soft bevel
  const g = ctx.createLinearGradient(frontX, frontY, frontX, frontY + frontH);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(frontX, frontY, frontW, frontH);
  ctx.restore();

  // Outline
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(frontX + 0.5, frontY + 0.5, frontW - 1, frontH - 1);

  return c;
}

function bakeCracks() {
  textures.crack = [];
  for (let stage = 1; stage <= 5; stage++) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = `rgba(20,15,10,${0.25 + stage * 0.12})`;
    ctx.lineWidth = 1.5 + stage * 0.2;
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
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  for (let i = 0; i < 20; i++) {
    ctx.fillRect((i * 17) % 64, (i * 29) % 64, 3, 3);
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
        })
        .catch(() => {
          const fb = makeFallbackFace(id);
          textures.tiles[id] = fb;
          textures.cube[id] = bakeCube(fb, false);
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
