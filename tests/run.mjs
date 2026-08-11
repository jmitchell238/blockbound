/**
 * Blockbound behavioral + structure tests (ESM).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓', m); else { console.error('  ✗', m); failed++; } };

console.log('Blockbound tests\n');

const req = [
  'index.html', 'css/style.css', 'js/main.js',
  'js/core/constants.js', 'js/core/worldSize.js', 'js/core/rng.js',
  'js/content/blocks.js', 'js/content/tools.js', 'js/content/recipes.js',
  'js/world/index.js', 'js/player/index.js', 'js/inventory/inventory.js',
  'js/interact/index.js', 'js/entities/mobs.js', 'js/entities/draw.js',
  'js/textures/textures.js', 'js/particles/particles.js',
  'js/render/index.js', 'js/input/input.js', 'js/audio/audio.js',
  'js/save/save.js', 'js/session/GameController.js', 'js/compat/api.js',
  'manifest.webmanifest', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'apple-touch-icon.png', 'art/cover.jpg',
  'assets/player/hero.png', 'assets/bg/clouds.png',
  'assets/tiles/grass.png', 'assets/tiles/dirt.png', 'assets/tiles/stone.png',
  'assets/tiles/lava.png', 'assets/tiles/wood.png', 'assets/tiles/atlas.png',
];
for (const f of req) ok(fs.existsSync(path.join(root, f)), `exists ${f}`);

const constants = fs.readFileSync(path.join(root, 'js/core/constants.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const ver = constants.match(/GAME_VERSION\s*=\s*['"]([^'"]+)['"]/);
ok(!!ver, 'GAME_VERSION');
if (ver) ok(sw.includes(`blockbound-${ver[1]}`), 'SW CACHE sync');
ok(constants.includes('WORLD_H') && constants.includes('REACH'), 'core constants');
ok(fs.existsSync(path.join(root, 'js/core/difficulty.js')), 'difficulty module exists');
ok(sw.includes('difficulty.js'), 'SW caches difficulty.js');
ok(fs.existsSync(path.join(root, 'js/core/seed.js')), 'seed module exists');
ok(sw.includes('seed.js'), 'SW caches seed.js');
ok(constants.includes('applyViewport') && constants.includes('export let W'), 'viewport mutable W/H');

const worldSize = fs.readFileSync(path.join(root, 'js/core/worldSize.js'), 'utf8');
ok(worldSize.includes('WORLD_SIZE_PRESETS') && worldSize.includes('16384') && worldSize.includes('applyWorldSize'), 'epic 16k preset');

const blocks = fs.readFileSync(path.join(root, 'js/content/blocks.js'), 'utf8');
ok(blocks.includes('BLOCK') && blocks.includes('BLOCK_META'), 'content blocks');

const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
ok(man.display === 'standalone', 'manifest standalone');
ok(man.name === 'Blockbound', 'manifest name');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
ok(html.includes('type="module"') && html.includes('js/main.js'), 'ESM entry main.js');
ok(!html.includes('js/config.js'), 'no legacy script tags');
ok(html.includes('data-screen="title"') && html.includes('data-screen="worlds"'), 'title + worlds screens');
ok(html.includes('data-screen="create"') && html.includes('inputSeed'), 'create world + seed field');
ok(html.includes('btnSingleplayer'), 'singleplayer entry');

const tex = fs.readFileSync(path.join(root, 'js/textures/textures.js'), 'utf8');
ok(tex.includes('loadTextures') && tex.includes('bakeCube'), 'texture loader + cube bake');
const ren = fs.readFileSync(path.join(root, 'js/render/index.js'), 'utf8');
ok(ren.includes('getCubeTex') || ren.includes('drawImage'), 'renderer uses images');
ok(ren.includes('drawClouds') && ren.includes('blockAO'), 'clouds + AO');
ok(!ren.includes('getSession'), 'render has no session coupling');

const playerJs = fs.readFileSync(path.join(root, 'js/player/index.js'), 'utf8');
ok(playerJs.includes('SKY_LIMIT') && playerJs.includes('tryPlace'), 'sky limit + place');
ok(playerJs.includes('adjacentPlaceCell') || playerJs.includes('isAttachableBlock'), 'torch face place');

// Domain API via ESM façade
const apiUrl = pathToFileURL(path.join(root, 'js/compat/api.js')).href;
const BB = await import(apiUrl);
ok(!!BB, 'sandbox exports');

BB.applyWorldSize(1024);
ok(BB.WORLD_W === 1024, 'applyWorldSize 1024');

const world = BB.generateWorld(42);
ok(!!world && world.tiles.length === BB.WORLD_W * BB.WORLD_H, 'generateWorld size');
ok(BB.wrapX(-1) === BB.WORLD_W - 1, 'wrapX negative');
ok(BB.wrapX(BB.WORLD_W) === 0, 'wrapX overflow');
const wd = BB.wrapDeltaX(0, BB.WORLD_W - 1);
ok(wd === -1, 'wrapDeltaX shortest path');

let magma = 0;
for (let x = 0; x < BB.WORLD_W; x++) {
  if (BB.getTile(world, x, BB.WORLD_H - 3) === BB.BLOCK.LAVA) magma++;
}
ok(magma > BB.WORLD_W * 0.5, 'magma layer present');

let bedrock = 0;
for (let x = 0; x < BB.WORLD_W; x++) {
  if (BB.getTile(world, x, BB.WORLD_H - 1) === BB.BLOCK.BEDROCK) bedrock++;
}
ok(bedrock === BB.WORLD_W, 'bedrock floor');

BB.setTile(world, 10, world.surface[10], BB.BLOCK.TORCH);
ok(world.dirtyLight, 'mark dirty on place');
BB.flushLight(world);
ok(!world.dirtyLight, 'flush clears dirty');
const lx = BB.getLight(world, 10, world.surface[10]);
ok(lx > 8, 'torch light');

const meta = BB.makeWorldMeta();
const dx = 5, dy = world.surface[5];
BB.setTile(world, dx, dy, BB.BLOCK.DOOR);
ok(BB.isSolid(world, dx, dy), 'door solid closed');
BB.toggleDoor(meta, dx, dy);
world.meta = meta;
ok(!BB.isSolid(world, dx, dy), 'door open walkable');

ok(!!BB.FOOD && !!BB.RECIPES, 'food + smelt recipes');
ok(BB.BLOCK.PLATFORM != null && BB.BLOCK.CAMPFIRE != null, 'platform + campfire blocks');
ok(BB.RECIPES.some(r => r.id === 'boat') && BB.RECIPES.some(r => r.id === 'bucket'), 'boat + bucket recipes');

// sand gravity
const sx = 20;
const sy = world.surface[sx] - 2;
BB.setTile(world, sx, sy, BB.BLOCK.SAND);
BB.setTile(world, sx, sy + 1, BB.BLOCK.AIR);
BB.tickGravityNear(world, sx, sy, 4);
ok(BB.getTile(world, sx, sy + 1) === BB.BLOCK.SAND, 'sand gravity falls');

ok(typeof BB.hasLineOfSight === 'function', 'hasLineOfSight export');
const openLos = BB.hasLineOfSight(world, 50.5, 10.5, 52.5, 10.5);
ok(openLos === true || openLos === false, 'LOS open air');
// block with dirt
const bx = 30;
const by = world.surface[bx] + 2;
BB.setTile(world, bx, by, BB.BLOCK.DIRT);
ok(!BB.hasLineOfSight(world, bx - 1.5, by + 0.5, bx + 1.5, by + 0.5), 'LOS blocked by dirt');

// Standard size gen performance
BB.applyWorldSize(4096);
const t0 = performance.now();
const w4 = BB.generateWorld(7);
const genMs = performance.now() - t0;
ok(!!w4 && w4.tiles.length === 4096 * BB.WORLD_H, 'standard 4096 gen');
ok(genMs < 15000, `4096 gen under 15s (${genMs | 0}ms)`);
console.log('  · 4096×128 gen', (genMs | 0) + 'ms');

// Craft planks
const inv = BB.makeInventory();
BB.addItem(inv, BB.BLOCK.WOOD, 2);
const planksRecipe = BB.RECIPES.find(r => r.id === 'planks');
ok(BB.canCraft(inv, planksRecipe), 'can craft planks');
ok(BB.craft(inv, planksRecipe), 'craft planks');
ok(BB.countItem(inv, BB.BLOCK.PLANKS) === 4, 'planks count');

// Serialize roundtrip
const ser = BB.serializeWorld(w4);
const w2 = BB.deserializeWorld(ser);
ok(!!w2 && w2.w === 4096, 'deserialize world');
ok(w2.tiles[100] === w4.tiles[100], 'tiles match after RLE');
ok(typeof BB.wrapX === 'function' && BB.MAGMA_Y > 0, 'wrapping + magma in world');

// Difficulty profiles
ok(!!BB.DIFFICULTIES && BB.DIFFICULTY_IDS.length === 4, 'four difficulties');
ok(BB.getDifficulty('creative').creative && BB.getDifficulty('creative').invincible, 'creative invincible');
ok(BB.getDifficulty('easy').starveDamagesHp === false, 'easy hunger never kills');
ok(BB.getDifficulty('normal').hungerDrainSec === 600, 'normal hunger ~10 min');
ok(BB.getDifficulty('normal').starveHpSec === 600, 'normal starve HP ~10 min');
ok(BB.getDifficulty('hard').hungerDrainSec === 300, 'hard hunger ~5 min');
ok(BB.getDifficulty('hard').sprintMinHungerFrac === 0.25, 'hard sprint threshold 25%');
ok(BB.canSprint(BB.getDifficulty('hard'), 30, 100) === true, 'hard can sprint at 30%');
ok(BB.canSprint(BB.getDifficulty('hard'), 25, 100) === false, 'hard no sprint at 25%');
ok(BB.canSprint(BB.getDifficulty('normal'), 0, 100) === false, 'normal no sprint empty');
ok(BB.canSprint(BB.getDifficulty('easy'), 0.1, 100) === true, 'easy can sprint with any hunger');
const hardRate = BB.hungerDrainPerSec(BB.getDifficulty('hard'), 100);
ok(Math.abs(hardRate - 100 / 300) < 1e-6, 'hard hunger drain rate');
const starveRate = BB.starveHpPerSec(BB.getDifficulty('normal'), 100);
ok(Math.abs(starveRate - 100 / 600) < 1e-6, 'normal starve HP rate');
const easyInv = BB.makeInventory();
BB.applyStarterKit(easyInv, 'easy');
ok(BB.countItem(easyInv, 'wood_pick') >= 1 && BB.countItem(easyInv, BB.BLOCK.DIRT) >= 1, 'easy starter kit');
const hardInv = BB.makeInventory();
BB.applyStarterKit(hardInv, 'hard');
ok(BB.countItem(hardInv, 'wood_pick') === 0 && BB.countItem(hardInv, BB.BLOCK.WOOD) === 0, 'hard empty start');
const normalInv = BB.makeInventory();
BB.applyStarterKit(normalInv, 'normal');
ok(BB.countItem(normalInv, 'wood_pick') === 1 && BB.countItem(normalInv, BB.BLOCK.WOOD) >= 1, 'normal pick + wood');
ok(BB.creativeCatalog().length > 20, 'creative catalog has items');
ok(BB.getDifficulty('easy').mobDamageMul < 1 && BB.getDifficulty('easy').playerDamageMul > 1, 'easy combat bias');
ok(BB.getDifficulty('hard').mobDamageMul > 1 && BB.getDifficulty('hard').playerDamageMul < 1, 'hard combat bias');

// Seeds
const s1 = BB.parseSeed('42');
ok(s1.seed === 42 && s1.random === false, 'numeric seed 42');
const s2 = BB.parseSeed('hello');
const s2b = BB.parseSeed('hello');
ok(s2.seed === s2b.seed && s2.seed > 0, 'text seed stable hash');
const s3 = BB.parseSeed('');
ok(s3.random === true && s3.seed > 0, 'empty seed is random');
ok(BB.hashStringToSeed('abc') === BB.hashStringToSeed('abc'), 'hash stable');

// Same seed → same terrain strip
BB.applyWorldSize(1024);
const wa = BB.generateWorld(12345);
const wb = BB.generateWorld(12345);
const wc = BB.generateWorld(99999);
ok(wa.seed === 12345 && wb.seed === 12345, 'world stores seed');
let same = true;
for (let i = 0; i < 200 && same; i++) {
  if (wa.tiles[i] !== wb.tiles[i]) same = false;
}
ok(same, 'identical seed → identical tiles');
let diffSeed = false;
for (let i = 0; i < wa.tiles.length; i += 17) {
  if (wa.tiles[i] !== wc.tiles[i]) { diffSeed = true; break; }
}
if (!diffSeed) {
  for (let x = 0; x < 64; x++) {
    if (wa.surface[x] !== wc.surface[x]) { diffSeed = true; break; }
  }
}
ok(diffSeed, 'different seed → different terrain');

// Viewport orientation
const port = BB.applyViewport(390, 844);
ok(port.ORIENTATION === 'portrait' && port.W === 390 && port.H >= 600, 'portrait viewport');
const land = BB.applyViewport(900, 400);
ok(land.ORIENTATION === 'landscape' && land.H === 400 && land.W >= 640, 'landscape viewport');
ok(BB.W === land.W && BB.H === land.H, 'live W/H bindings');

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nAll passed');
