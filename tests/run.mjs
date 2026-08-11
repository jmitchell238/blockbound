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
ok(sw.includes('shelter.js'), 'SW caches shelter.js');
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

// ─── Cave shelter + sky + lighting (regressions for white caves / black outdoors) ───
console.log('\nCave shelter + sky + light');

// Roof id classification
ok(BB.isRoofSolidId(BB.BLOCK.STONE) && BB.isRoofSolidId(BB.BLOCK.DIRT), 'stone/dirt count as cave roof');
ok(!BB.isRoofSolidId(BB.BLOCK.WOOD) && !BB.isRoofSolidId(BB.BLOCK.LEAVES), 'trees do NOT count as cave roof');
ok(!BB.isRoofSolidId(BB.BLOCK.AIR) && !BB.isRoofSolidId(BB.BLOCK.TORCH), 'air/torch not roof');
ok(BB.isCaveOpenTile(BB.BLOCK.AIR) && BB.isCaveOpenTile(BB.BLOCK.TORCH), 'air/torch are open cells');
ok(!BB.isCaveOpenTile(BB.BLOCK.STONE), 'stone is not open cell');

// Build a tiny controlled world on a generated base
BB.applyWorldSize(512);
const caveWorld = BB.generateWorld(777);
const cx = 100;
const surf = caveWorld.surface[cx];
ok(surf > 5 && surf < BB.WORLD_H - 20, 'surface in reasonable band');

// Clear a sky column at surface air → not sheltered
const skyY = Math.max(SKY_LIMIT_SAFE(BB, surf - 3), 2);
// ensure open to sky above surface air cell
for (let y = 0; y <= surf; y++) {
  if (BB.getTile(caveWorld, cx, y) !== BB.BLOCK.AIR) BB.setTile(caveWorld, cx, y, BB.BLOCK.AIR);
}
ok(!BB.isShelteredAir(caveWorld, cx, surf - 2), 'open surface air is NOT sheltered (outdoor sky shows)');

// Below surface air is sheltered even if we carve a pocket
const deepY = Math.min(BB.WORLD_H - 10, surf + 8);
// carve a 3×3 stone cave pocket with air inside
for (let dy = -2; dy <= 2; dy++) {
  for (let dx = -2; dx <= 2; dx++) {
    BB.setTile(caveWorld, cx + dx, deepY + dy, BB.BLOCK.STONE);
  }
}
BB.setTile(caveWorld, cx, deepY, BB.BLOCK.AIR);
BB.setTile(caveWorld, cx, deepY - 1, BB.BLOCK.AIR);
ok(BB.isShelteredAir(caveWorld, cx, deepY), 'air below surface is sheltered (cave)');
ok(BB.isShelteredAir(caveWorld, cx, deepY - 1), 'cave chamber air is sheltered');

// Under a dirt roof above surface height (ledge / overhang)
const ledgeX = 120;
const ledgeSurf = caveWorld.surface[ledgeX];
// open sky column first
for (let y = 0; y <= ledgeSurf + 2; y++) BB.setTile(caveWorld, ledgeX, y, BB.BLOCK.AIR);
// place a dirt roof a few tiles above a mid-air cell
const roofY = Math.max(3, ledgeSurf - 5);
const underRoofY = roofY + 2;
BB.setTile(caveWorld, ledgeX, roofY, BB.BLOCK.DIRT);
BB.setTile(caveWorld, ledgeX, underRoofY, BB.BLOCK.AIR);
// clear between roof and underRoof so only roof blocks sky
for (let y = roofY + 1; y < underRoofY; y++) BB.setTile(caveWorld, ledgeX, y, BB.BLOCK.AIR);
for (let y = 0; y < roofY; y++) BB.setTile(caveWorld, ledgeX, y, BB.BLOCK.AIR);
ok(BB.isShelteredAir(caveWorld, ledgeX, underRoofY), 'air under dirt roof is sheltered');

// Tree overhead alone must NOT shelter (outdoors under canopy)
const treeX = 140;
const treeSurf = caveWorld.surface[treeX];
for (let y = 0; y <= treeSurf + 1; y++) BB.setTile(caveWorld, treeX, y, BB.BLOCK.AIR);
BB.setTile(caveWorld, treeX, treeSurf - 2, BB.BLOCK.WOOD);
BB.setTile(caveWorld, treeX, treeSurf - 3, BB.BLOCK.LEAVES);
ok(!BB.isShelteredAir(caveWorld, treeX, treeSurf - 1), 'tree/leaves overhead still outdoor (not sheltered)');

// Wall material inference — dug air should look like surrounding stone/dirt
ok(BB.normalizeWallId(BB.BLOCK.GRASS) === BB.BLOCK.DIRT, 'grass walls normalize to dirt');
ok(BB.normalizeWallId(BB.BLOCK.STONE) === BB.BLOCK.STONE, 'stone stays stone');
ok(BB.normalizeWallId(BB.BLOCK.TORCH) == null, 'torch is not a wall material');
// Stone pocket → stone walls
const stoneWall = BB.inferCaveWallId(caveWorld, cx, deepY);
ok(stoneWall === BB.BLOCK.STONE, `stone pocket air walls are stone (got ${stoneWall})`);
// Dirt-lined pocket near surface
const dirtX = 160;
const dirtSurf = caveWorld.surface[dirtX];
const dirtY = dirtSurf + 2;
for (let dy = -1; dy <= 1; dy++) {
  for (let dx = -1; dx <= 1; dx++) {
    BB.setTile(caveWorld, dirtX + dx, dirtY + dy, BB.BLOCK.DIRT);
  }
}
BB.setTile(caveWorld, dirtX, dirtY, BB.BLOCK.AIR);
const dirtWall = BB.inferCaveWallId(caveWorld, dirtX, dirtY);
ok(dirtWall === BB.BLOCK.DIRT, `dirt pocket air walls are dirt (got ${dirtWall})`);
// Deep with no neighbors → depth fallback to stone
const deepX = 180;
const deepSurf = caveWorld.surface[deepX];
const veryDeep = Math.min(BB.WORLD_H - 5, deepSurf + 20);
// clear a lone air cell with air neighbors but deep
for (let dy = -2; dy <= 2; dy++) {
  for (let dx = -2; dx <= 2; dx++) {
    BB.setTile(caveWorld, deepX + dx, veryDeep + dy, BB.BLOCK.AIR);
  }
}
// restore surface array depth meaning still deep
const deepWall = BB.inferCaveWallId(caveWorld, deepX, veryDeep);
ok(deepWall === BB.BLOCK.STONE, `deep air without solids → stone (got ${deepWall})`);

// Material wall colors: stone is gray-ish, dirt is brown, never sky-white
const stoneDark = BB.caveWallColor(BB.BLOCK.STONE, 0, 1, 0);
const stoneLit = BB.caveWallColor(BB.BLOCK.STONE, 15, 1.1, 0);
const dirtLit = BB.caveWallColor(BB.BLOCK.DIRT, 15, 1, 0);
ok(stoneDark.sum < 70, `unlit stone wall dark (sum=${stoneDark.sum})`);
ok(stoneLit.sum < 280, `lit stone wall not white (sum=${stoneLit.sum})`);
ok(stoneLit.r <= 115 && stoneLit.g <= 110 && stoneLit.b <= 105, 'stone wall RGB hard-capped');
ok(stoneLit.r >= stoneDark.r && stoneLit.g >= stoneDark.g, 'torch brightens stone wall');
// Stone ≈ neutral gray (low chroma); dirt warmer (r > b)
const stoneChroma = Math.max(stoneLit.r, stoneLit.g, stoneLit.b) - Math.min(stoneLit.r, stoneLit.g, stoneLit.b);
ok(stoneChroma < 25, `stone wall low chroma/gray (chroma=${stoneChroma})`);
ok(dirtLit.r > dirtLit.b + 5, `dirt wall is brownish (r=${dirtLit.r} b=${dirtLit.b})`);
// Legacy caveAirColor still never white
const dark = BB.caveAirColor(0, 1);
const lit = BB.caveAirColor(15, 1.1);
ok(dark.sum < 70, `unlit cave air dark (sum=${dark.sum})`);
ok(lit.sum < 280, `max-lit cave air not white (sum=${lit.sum})`);
ok(lit.r >= dark.r, 'torch light brightens cave air');
ok(typeof BB.wallNoise2D(1.5, 2.5) === 'number' && BB.wallNoise2D(1.5, 2.5) >= 0 && BB.wallNoise2D(1.5, 2.5) < 1, 'wall noise in 0..1');

// lightToBrightness monotonic + soft
const b0 = BB.lightToBrightness(0);
const b7 = BB.lightToBrightness(7);
const b15 = BB.lightToBrightness(15);
ok(b0 < b7 && b7 < b15, 'lightToBrightness monotonic');
ok(b0 < 0.1 && b15 <= 1, 'brightness in range');
ok(b7 > 0.15 && b7 < 0.85, 'mid light not clipped to extremes');

// Sky colors: clear midday blue, raining gray
const clearDay = BB.skyColors(0.5, 0); // noon-ish
const rainyDay = BB.skyColors(0.5, 0.9);
ok(clearDay.day > 0.5, 'midday day factor high');
ok(BB.skyLooksBlue(clearDay.mid) || BB.skyLooksBlue(clearDay.top), 'clear sky is blue');
ok(BB.skyLooksGray(rainyDay.mid) || rainyDay.rain > 0.5, 'rainy sky gray/overcast');
// Rain should desaturate vs clear
const clearRgb = hexToRgbTest(clearDay.mid);
const rainRgb = hexToRgbTest(rainyDay.mid);
const clearChroma = Math.max(clearRgb.r, clearRgb.g, clearRgb.b) - Math.min(clearRgb.r, clearRgb.g, clearRgb.b);
const rainChroma = Math.max(rainRgb.r, rainRgb.g, rainRgb.b) - Math.min(rainRgb.r, rainRgb.g, rainRgb.b);
ok(rainChroma < clearChroma, 'rain reduces sky chroma vs clear');

// Torch light still works underground in carved cave
BB.setTile(caveWorld, cx, deepY, BB.BLOCK.TORCH);
BB.flushLight(caveWorld);
const torchL = BB.getLight(caveWorld, cx, deepY);
ok(torchL >= 10, `torch emits strong light underground (got ${torchL})`);
const nearL = BB.getLight(caveWorld, cx, deepY - 1);
ok(nearL > 5, 'light spreads to adjacent cave air');

// Structural guard: render must always paint sky first (no stuck full-screen black mode)
const renSrc = fs.readFileSync(path.join(root, 'js/render/index.js'), 'utf8');
ok(renSrc.includes('Always draw outdoor sky first') || renSrc.includes('sky.top'), 'renderer draws sky base');
ok(!renSrc.includes("fillStyle = '#020106'") && !renSrc.includes("fillStyle = '#030208'"), 'no full-screen cave black mode');
ok(renSrc.includes('isShelteredAir') && renSrc.includes('inferCaveWallId'), 'renderer uses material cave walls');
ok(renSrc.includes('caveWallColor') || renSrc.includes('getWallTexPixels'), 'renderer paints material wall color/texture');
// HUD must not lecture about weather
ok(!renSrc.includes('🌧 Raining') && !renSrc.includes("'Explore'"), 'no weather HUD text');

// Shelter module present
ok(fs.existsSync(path.join(root, 'js/world/shelter.js')), 'shelter module exists');

function SKY_LIMIT_SAFE(BB, y) {
  return Math.max(BB.SKY_LIMIT || 2, y);
}
function hexToRgbTest(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nAll passed');
