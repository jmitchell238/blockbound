import { BLOCK, BLOCK_META } from '../content/blocks.js';
import { GAME_VERSION } from '../core/constants.js';

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

export const textures = {
  ready: false,
  tiles: Object.create(null),
  cube: Object.create(null),
  /** Soft seamless face (no cube outline) for terrain blending */
  soft: Object.create(null),
  player: null,
  /** Animation frames: idle, walk[4], jump, crouch, mine, sword, shovel, boat */
  playerAnims: Object.create(null),
  /** Item/tool icons by id string or block number */
  items: Object.create(null),
  clouds: null,
  crack: [],
};

/** Player animation frame filenames under assets/player/ */
export const PLAYER_ANIM_FILES = {
  idle: 'hero_idle.png',
  walk0: 'hero_walk_0.png',
  walk1: 'hero_walk_1.png',
  walk2: 'hero_walk_2.png',
  walk3: 'hero_walk_3.png',
  jump: 'hero_jump.png',
  crouch: 'hero_crouch.png',
  mine: 'hero_mine.png',
  sword: 'hero_sword.png',
  shovel: 'hero_shovel.png',
  boat: 'hero_boat.png',
};

/** Inventory/tool icon files under assets/items/ */
export const ITEM_ICON_FILES = [
  'wood_pick', 'stone_pick', 'iron_pick', 'gold_pick',
  'wood_axe', 'stone_axe', 'iron_axe',
  'wood_shovel', 'stone_shovel', 'iron_shovel',
  'wood_sword', 'stone_sword', 'iron_sword',
  'stick', 'apple', 'bread', 'stew',
  'iron_ingot', 'gold_ingot', 'copper_ingot',
  'boat', 'bucket', 'bucket_water',
];

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('fail ' + src));
    // Bust SW/browser cache when GAME_VERSION changes (critical for sprite fixes)
    const join = src.includes('?') ? '&' : '?';
    img.src = src + join + 'v=' + GAME_VERSION;
  });
}

/** Soft 2.5D cube — shallow depth, no hard black outline. */
export function bakeCube(faceImg, transparent) {
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
export function bakeSoftFace(faceImg) {
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

export function bakeCracks() {
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

export function makeFallbackFace(id) {
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

export async function loadTextures() {
  bakeCracks();
  const jobs = [];
  for (const [idStr, name] of Object.entries(TILE_FILES)) {
    const id = Number(idStr);
    jobs.push(
      loadImage('assets/tiles/' + name + '.png')
        .then(img => {
          textures.tiles[id] = img;
          const alpha = !!(BLOCK_META[id] && BLOCK_META[id].alpha != null && BLOCK_META[id].alpha < 1)
            || id === BLOCK.LADDER || id === BLOCK.TORCH || id === BLOCK.LANTERN
            || id === BLOCK.LEAVES || id === BLOCK.GLASS || id === BLOCK.WATER;
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
    loadImage('assets/player/hero_idle.png')
      .then(img => { textures.player = img; textures.playerAnims.idle = img; })
      .catch(() => loadImage('assets/player/hero.png')
        .then(img => { textures.player = img; textures.playerAnims.idle = img; })
        .catch(() => { textures.player = null; }))
  );
  for (const [key, file] of Object.entries(PLAYER_ANIM_FILES)) {
    if (key === 'idle') continue;
    jobs.push(
      loadImage('assets/player/' + file)
        .then(img => { textures.playerAnims[key] = img; })
        .catch(() => { /* fallback handled at draw time */ })
    );
  }
  for (const name of ITEM_ICON_FILES) {
    jobs.push(
      loadImage('assets/items/' + name + '.png')
        .then(img => { textures.items[name] = img; })
        .catch(() => {})
    );
  }
  jobs.push(
    loadImage('assets/bg/clouds.png').then(img => { textures.clouds = img; }).catch(() => { textures.clouds = null; })
  );
  await Promise.all(jobs);
  // Walk cycle: 0 / 1 / 2 are clean side-view strides; bounce back through
  // mid (1) instead of walk3 (which was a front-facing / jump-ish pose).
  const w0 = textures.playerAnims.walk0 || textures.player;
  const w1 = textures.playerAnims.walk1 || w0;
  const w2 = textures.playerAnims.walk2 || w0;
  textures.playerAnims.walk = [w0, w1, w2, w1].filter(Boolean);
  textures.ready = true;
  return textures;
}

/**
 * Body pose for the current player state.
 * Returns { img, key } so held items can use the matching hand anchor.
 * Tool graphics are overlaid via drawHeldItem (not baked into poses).
 */
export function getPlayerPose(player, inv) {
  const A = textures.playerAnims || {};
  const idle = A.idle || textures.player;
  if (!player) return { img: idle, key: 'idle' };

  if (player.inBoat) return { img: A.boat || idle, key: 'boat' };

  if (player.onGround && player.crouching) {
    return { img: A.crouch || idle, key: 'crouch' };
  }

  if (!player.onGround) return { img: A.jump || idle, key: 'jump' };

  const walking = player.onGround && Math.abs(player.vx) > 0.2;
  if (walking && A.walk && A.walk.length) {
    // Must match walk array build: [walk0, walk1, walk2, walk1]
    const walkKeys = ['walk0', 'walk1', 'walk2', 'walk1'];
    const fi = Math.floor(Math.abs(player.anim)) % A.walk.length;
    return { img: A.walk[fi] || idle, key: walkKeys[fi] || 'walk0' };
  }

  return { img: idle, key: 'idle' };
}

/** Best player frame image for current action state. */
export function getPlayerFrame(player, inv) {
  return getPlayerPose(player, inv).img;
}

export function getItemIcon(id) {
  if (id == null) return null;
  if (textures.items[id]) return textures.items[id];
  if (typeof id === 'number' && textures.tiles[id]) return textures.tiles[id];
  return null;
}

export function getTileTex(id) {
  return textures.tiles[id] || null;
}

export function getCubeTex(id) {
  return textures.cube[id] || null;
}

export function getSoftTex(id) {
  return textures.soft[id] || textures.tiles[id] || null;
}
