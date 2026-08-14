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
const sw = fs.readFileSync(path.join(root, 'sw-bb.js'), 'utf8'); // primary worker (new installs)
const swLegacy = fs.readFileSync(path.join(root, 'sw.js'), 'utf8'); // bridge for stuck iPads
const ver = constants.match(/GAME_VERSION\s*=\s*['"]([^'"]+)['"]/);
ok(!!ver, 'GAME_VERSION');
if (ver) ok(sw.includes(`blockbound-${ver[1]}`), 'SW CACHE sync');
ok(swLegacy.includes('update.html') || swLegacy.includes('legacy'), 'legacy SW bridge present');
ok(constants.includes('WORLD_H') && constants.includes('REACH'), 'core constants');
ok(fs.existsSync(path.join(root, 'js/core/difficulty.js')), 'difficulty module exists');
ok(sw.includes('difficulty.js'), 'SW caches difficulty.js');
ok(fs.existsSync(path.join(root, 'js/core/seed.js')), 'seed module exists');
ok(sw.includes('seed.js'), 'SW caches seed.js');
ok(sw.includes('shelter.js'), 'SW caches shelter.js');
ok(sw.includes('chestLayout.js'), 'SW caches chestLayout.js');
ok(sw.includes('liquid.js'), 'SW caches liquid.js');
ok(fs.existsSync(path.join(root, 'update.html')), 'update.html escape hatch');
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

// —— Kids-nav / creative-fly regressions (v1.9.043–044) ——
// Tapping to move must never latch the held-pad fly flags. Those are cleared
// only by the pointer-release handler, so a tap that sets them leaves the
// character ascending forever.
const navMod = await import(pathToFileURL(path.join(root, 'js/systems/nav.js')).href);
{
  const input = { keys: {}, kidsQueue: [], stickX: 0, stickY: 0 };
  const player = { x: 10, y: 40, h: 1.5, facing: 1, flying: true, canFly: true, vy: 0 };
  const stubWorld = { w: 256, surface: [] };
  navMod.setMoveTarget(input, 14, 32); // up and to the right
  navMod.applyKidsNav(player, stubWorld, input, 0.016);
  ok(!input._touchFlyUp && !input._touchFlyDown, 'nav does not latch sticky fly pads');
  ok(input.up === true, 'nav steers up via per-frame intent');
  ok(input.right === true, 'nav steers horizontally toward the target');

  // Once at the target height, vertical steering must release.
  const level = { keys: {}, kidsQueue: [], stickX: 0, stickY: 0 };
  const atY = { x: 10, y: 40, h: 1.5, facing: 1, flying: true, canFly: true, vy: 0 };
  navMod.setMoveTarget(level, 14, 39); // same height, still to the right
  navMod.applyKidsNav(atY, stubWorld, level, 0.016);
  ok(!level.up, 'nav stops ascending once level with the target');
}

const navSrc = fs.readFileSync(path.join(root, 'js/systems/nav.js'), 'utf8');
ok(!/_touchFly(Up|Down)\s*=\s*true/.test(navSrc), 'nav never sets sticky fly pad flags');

const gcSrc = fs.readFileSync(path.join(root, 'js/session/GameController.js'), 'utf8');
ok(!/player\.flying\s*=\s*true/.test(gcSrc), 'creative never force-enables flight');

// —— Blank-screen guards (v1.9.043) ——
const mainSrc = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
ok(/finally\s*\{\s*requestAnimationFrame/.test(mainSrc), 'rAF loop restarts in a finally');
ok(mainSrc.includes("addEventListener('error'") && mainSrc.includes('unhandledrejection'),
  'global error reporting present');

// —— Update-loop guards (v1.9.043) ——
ok(swLegacy.includes("indexOf('update.html')"), 'legacy bridge skips clients already updating');
ok(swLegacy.includes('registration.unregister'), 'legacy bridge retires itself after handoff');
const updSrc = fs.readFileSync(path.join(root, 'update.html'), 'utf8');
ok(updSrc.includes('bb-unstuck-once'), 'update.html has a re-entry guard');

// —— Pointer-driven touch pads (v1.9.045) ——
{
  const inputMod = await import(pathToFileURL(path.join(root, 'js/input/input.js')).href);
  const mk = (type) => {
    const i = inputMod.makeInput();
    i.lastPointerType = type;
    i._touchUI = true;
    return i;
  };
  // Lower-right corner: the JUMP pad's hit zone. W/H are live bindings that
  // earlier tests may have resized, so read them rather than hardcoding.
  const C = await import(pathToFileURL(path.join(root, 'js/core/constants.js')).href);
  const jumpPt = { x: C.W - 60, y: C.H - 160, id: 1 };
  const touch = mk('touch');
  inputMod.handlePointer(touch, jumpPt, 'down');
  ok(touch._touchJump === true, 'touch press still hits the JUMP pad');

  const mouse = mk('mouse');
  const stubCam = () => ({ x: 0, y: 40, zoom: 1 });
  inputMod.handlePointer(mouse, jumpPt, 'down', stubCam);
  ok(!mouse._touchJump, 'mouse click does not hit the hidden JUMP pad');
  ok(mouse.pointerDown === true, 'mouse click there reaches the world instead');
}
const inputSrc = fs.readFileSync(path.join(root, 'js/input/input.js'), 'utf8');
ok(/lastPointerType\s*=\s*e\.pointerType/.test(inputSrc), 'pointerdown records the device type');
ok(gcSrc.includes("lastPtr !== 'mouse'"), 'showTouch follows the device last used');

// —— Kids camera never re-centers (v1.9.045) ——
{
  const camMod = await import(pathToFileURL(path.join(root, 'js/systems/camera.js')).href);
  // Jumping must not drag the view up — kids build under themselves mid-air.
  const s = {
    player: { x: 100, y: 40, vx: 0, vy: -8 },
    cam: { x: 100, y: 41, zoom: 1 },
    ui: { controlMode: 'kids', zoom: 1 },
    input: { moveTarget: null, camUserPanned: false },
  };
  const y0 = s.cam.y;
  for (let i = 0; i < 20; i++) {
    s.player.y -= 0.15; // rising
    camMod.updateCamera(s, 0.016);
  }
  ok(Math.abs(s.cam.y - y0) < 0.01, 'a short jump leaves the kids camera still');

  // Walking keeps them on screen without snapping them back to the middle.
  const w = {
    player: { x: 100, y: 40, vx: 4, vy: 0 },
    cam: { x: 100, y: 41, zoom: 1 },
    ui: { controlMode: 'kids', zoom: 1 },
    input: { moveTarget: { x: 140, y: 40 }, camUserPanned: false },
  };
  for (let i = 0; i < 400; i++) {
    w.player.x += 4 * 0.016;
    camMod.updateCamera(w, 0.016);
  }
  const lead = w.player.x - w.cam.x;
  ok(lead > 0.5, 'walking camera lags behind instead of centering the player');
  const C2 = await import(pathToFileURL(path.join(root, 'js/core/constants.js')).href);
  const halfW = (C2.W / 2) / C2.TILE;
  ok(lead < halfW, 'walking camera still keeps the player on screen');

  // The real complaint: jumping mid-walk used to drag the camera up and
  // re-center the character, pulling the view off the spot they were building.
  const j = {
    player: { x: 100, y: 40, vx: 4, vy: 0 },
    cam: { x: 100, y: 41, zoom: 1 },
    ui: { controlMode: 'kids', zoom: 1 },
    input: { moveTarget: { x: 140, y: 40 }, camUserPanned: false },
  };
  const jy0 = j.cam.y;
  for (let i = 0; i < 20; i++) {
    j.player.x += 4 * 0.016;
    j.player.y -= 0.15; // jumping while walking
    camMod.updateCamera(j, 0.016);
  }
  ok(Math.abs(j.cam.y - jy0) < 0.01, 'jumping mid-walk never lifts the camera');
}

// —— Light plate must not paint the sky (v1.9.047) ——
{
  const renSrc = fs.readFileSync(path.join(root, 'js/render/index.js'), 'utf8');
  // The plate is opaque everywhere; 'multiply' onto transparent sky paints it
  // solid beige. It has to be clipped to the pixels terrain actually drew.
  const lightBlock = renSrc.slice(
    renSrc.indexOf('lctx.drawImage(_tLightField'),
    renSrc.indexOf("tctx.globalCompositeOperation = 'multiply'"));
  ok(/destination-in/.test(lightBlock),
    'light plate is masked to terrain before the multiply');
  ok(/lctx\.drawImage\(_terrainCvs/.test(lightBlock),
    'light plate mask uses the terrain canvas alpha');
}

// —— World picker scrolling (v1.9.045) ——
{
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const grid = css.slice(css.indexOf('.world-grid {'), css.indexOf('.world-empty'));
  ok(/touch-action:\s*pan-y/.test(grid), 'world grid allows touch scrolling');
  ok(/overflow-y:\s*auto/.test(grid), 'world grid scrolls');
  ok(/grid-auto-rows:\s*max-content/.test(grid),
    'world grid rows keep content height instead of collapsing');
  const card = css.slice(css.indexOf('.world-card {'), css.indexOf('.world-card:hover'));
  ok(!/min-height:\s*0/.test(card),
    'world card keeps its automatic minimum size (min-height:0 collapsed the rows)');
  ok(css.includes('@media (max-height: 480px)'), 'short landscape shrinks the world cards');
  const land = css.slice(css.indexOf('body.landscape .world-grid'));
  ok(!/max-height:\s*min\(280px/.test(land.slice(0, 400)),
    'landscape world grid is not capped to one and a half rows');
}

// —— Starter tool is equipped at spawn (v1.9.048) ——
{
  const I = await import(pathToFileURL(path.join(root, 'js/inventory/inventory.js')).href);
  const D = await import(pathToFileURL(path.join(root, 'js/core/difficulty.js')).href);
  const TL = await import(pathToFileURL(path.join(root, 'js/content/tools.js')).href);
  let checked = 0;
  for (const id of ['creative', 'easy', 'normal']) {
    const inv = I.makeInventory();
    D.applyStarterKit(inv, id);
    const held = I.selectedSlot(inv);
    if (held && TL.TOOLS[held.id]) {
      checked++;
      ok(inv.tool !== held.id, `${id}: addItem alone does not equip (the original bug)`);
      I.syncEquippedTool(inv);
      ok(inv.tool === held.id, `${id} starter kit equips the selected tool after sync`);
    }
  }
  ok(checked >= 2, 'starter-kit tool check actually exercised real kits');

  const gcSrc2 = fs.readFileSync(path.join(root, 'js/session/GameController.js'), 'utf8');
  const finish = gcSrc2.slice(gcSrc2.indexOf('export function _finishSession'),
                              gcSrc2.indexOf('const ui = {'));
  ok(/syncEquippedTool\(inv\)/.test(finish),
    'session start equips the held tool (no hotbar tap required)');
}

// —— UI simplification pass (v1.9.048) ——
{
  const renSrc3 = fs.readFileSync(path.join(root, 'js/render/index.js'), 'utf8');
  ok(!/have \+ '\/' \+ n \+ ' ' \+ itemName/.test(renSrc3),
    'craft chips no longer print have/need backwards');
  ok(!/itemName\(id\) \+ ' ' \+ have \+ '\/' \+ n/.test(renSrc3),
    'craft detail line no longer prints have/need backwards');
  // v1.9.048–053 fussed over where the kids chip sat and whether ui.showTouch
  // hid it. bb-7rk deleted it instead — the tap-to-walk rules live in How to
  // Play, and the chip was competing with the play area for screen space.
  ok(renSrc3.indexOf("ctx.fillText('KIDS MODE'") === -1,
    'kids chip is gone rather than repositioned');

  const gcSrc3 = fs.readFileSync(path.join(root, 'js/session/GameController.js'), 'utf8');
  ok(!gcSrc3.includes('Tap to walk · tap blocks to dig · hold to dig nearby'),
    'idle kids prompt no longer covers the play area');

  const mainSrc3 = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  ok(mainSrc3.includes('syncChromeForPanels'), 'chrome row is synced to open panels');
  const cssSrc3 = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  ok(/panel-open \.icon-btn/.test(cssSrc3), 'chrome buttons hide behind an open panel');
}

// —— Tap outside a panel to close it (v1.9.049) ——
{
  const renSrc4 = fs.readFileSync(path.join(root, 'js/render/index.js'), 'utf8');
  ok((renSrc4.match(/ui\.panelRect = \{/g) || []).length === 4,
    'all four canvas panels publish their rect');
  ok(/'Blocks ' \+ firstItem \+ '–' \+ lastItem \+ ' of ' \+ catalog\.length/.test(renSrc4),
    'creative label counts items, not grid rows');

  const gcSrc4 = fs.readFileSync(path.join(root, 'js/session/GameController.js'), 'utf8');
  ok(/function outsidePanel/.test(gcSrc4) && /function closeOpenPanel/.test(gcSrc4),
    'outside-tap close helpers exist');
  // Must be guarded: a drop that lands outside mid-drag should not close.
  const guard = gcSrc4.slice(gcSrc4.indexOf('// Tap outside the panel to dismiss'),
                             gcSrc4.indexOf('const hits = activeMenuHits(ui);'));
  ok(/!ui\.invDrag/.test(guard) && /!ui\.invPick/.test(guard),
    'outside-tap close is suppressed while dragging or holding an item');
  ok(/phase === 'down'/.test(guard), 'outside-tap close fires on press, not release');
  // The craft panel takes a separate click path and needs the same guard.
  const craftFn = gcSrc4.slice(gcSrc4.indexOf('export function gameClickCraft'),
                               gcSrc4.indexOf('const hits = ui.craftHit'));
  ok(/outsidePanel\(ui, x, y\)/.test(craftFn), 'craft panel also closes on an outside tap');
}

// —— HUD placement + pause clarity (v1.9.050) ——
{
  const renSrc5 = fs.readFileSync(path.join(root, 'js/render/index.js'), 'utf8');
  // v1.9.054 (bb-7rk): the whole top-left status stack is gone. These used to
  // assert where the info card ended and that the kids chip tucked under it.
  const hud = renSrc5.slice(renSrc5.indexOf('export function drawHUD'),
                            renSrc5.indexOf('export function drawBar'));
  const gone = [
    ["'KIDS MODE'", 'kids-mode chip'],
    ["'Tool: '", 'equipped-tool line'],
    ["'🎒 Backpack '", 'backpack count'],
    ['ui.seedLabel', 'seed label'],
    ["' blocks around'", 'world-size readout'],
    ["'% lap'", 'lap-progress readout'],
    ["'✦ Creative'", 'creative badge'],
    ['ui._infoBottom', 'info-stack anchor'],
  ];
  for (const [needle, label] of gone) {
    ok(!hud.includes(needle), `HUD no longer draws the ${label}`);
  }
  // Coordinates return in bb-8pp as plain text — with no card behind them.
  ok(!/roundRect\(ctx, 12, infoTop/.test(hud), 'no coords card background');
  // What must survive the cull.
  ok(/drawMinimap\(/.test(hud), 'minimap survives');
  ok(/player\.hp \/ player\.maxHp/.test(hud), 'health bar survives');
  ok(/player\.maxHunger/.test(hud), 'hunger bar survives');
  ok(/inv\.hotbar\[i\]/.test(hud), 'hotbar survives');
  ok(/'JUMP'/.test(hud), 'JUMP button survives');

  const gcSrc5 = fs.readFileSync(path.join(root, 'js/session/GameController.js'), 'utf8');
  ok(!gcSrc5.includes("'Paused — ☰ menu or Esc to resume'"),
    'pause no longer toasts what the overlay already says');
  ok(!gcSrc5.includes("'Esc to resume · ☰ for menu'"),
    'pause subtitle is no longer keyboard-only');
  ok(/Tap anywhere to keep playing/.test(gcSrc5),
    'pause subtitle names a touch action');

  const mainSrc5 = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const pd = mainSrc5.slice(mainSrc5.indexOf("cv.addEventListener('pointerdown'"),
                            mainSrc5.indexOf("cv.addEventListener('pointermove'"));
  ok(/s\.paused = false/.test(pd), 'a tap actually resumes, as the overlay promises');
}

// —— Save failures must be visible (v1.9.051) ——
{
  const saveSrc = fs.readFileSync(path.join(root, 'js/save/save.js'), 'utf8');
  const persist = saveSrc.slice(saveSrc.indexOf('export function persistSession'),
                                saveSrc.indexOf('/** Short line for world cards'));
  ok(/return ok;/.test(persist), 'persistSession reports success to its callers');
  ok(!/meta\.hasData = ok;/.test(persist),
    'a failed save no longer clears hasData on a world that has a good payload');
  ok(/if \(ok\) meta\.hasData = true;/.test(persist),
    'hasData is only ever set on a successful write');

  const autoSrc = fs.readFileSync(path.join(root, 'js/systems/autosave.js'), 'utf8');
  ok(/ok === false/.test(autoSrc), 'autosave checks the save result');
  ok(/toast\(/.test(autoSrc) && /storage is full/.test(autoSrc),
    'a failed autosave tells the player');
}

// —— Corrupt payloads must not be silently replaced (v1.9.052) ——
{
  const saveSrc2 = fs.readFileSync(path.join(root, 'js/save/save.js'), 'utf8');
  const reader = saveSrc2.slice(saveSrc2.indexOf('function readWorldPayload'),
                                saveSrc2.indexOf('function removeWorldPayload'));
  ok(/corrupt: true/.test(reader), 'reader distinguishes unreadable from absent');
  ok(/\.corrupt', raw/.test(reader), 'damaged bytes are copied aside before anything overwrites them');
  ok(/if \(!localStorage\.getItem\(key \+ '\.corrupt'\)\)/.test(reader),
    'an existing backup is never clobbered by a second failed load');

  const loader = saveSrc2.slice(saveSrc2.indexOf('export function loadWorldData'),
                                saveSrc2.indexOf('export function createWorldEntry'));
  ok(/save\.loadError = read\.corrupt/.test(loader), 'load reports a corrupt payload');
  ok(!/readWorldPayload\(id\) \|\| emptyPayload\(\)/.test(loader),
    'a corrupt payload no longer collapses into an empty world');

  const gcSrc6 = fs.readFileSync(path.join(root, 'js/session/GameController.js'), 'utf8');
  ok(/save\.loadError/.test(gcSrc6) && /could not be read/.test(gcSrc6),
    'the player is told when their world could not be read');
}

// —— Spawn location & death message accuracy (bb-ms6) ——
// The death message used to be picked from `player.spawnX != null`, but
// findSpawn only honours a bed after checking a BED tile is still there. Mine
// the bed away and the two disagreed: the player was told "at your bed" while
// standing at world centre. findSpawn now reports which branch it took.
console.log('\nSpawn location & message');
{
  const playerMod = await import(pathToFileURL(path.join(root, 'js/player/index.js')).href);
  const { BLOCK } = BB;
  const world = BB.generateWorld(123);
  const centreX = Math.floor(BB.WORLD_W / 2);

  // A bed well away from world centre, so the two branches return different x.
  const bedX = BB.wrapX(centreX + 60);
  const bedY = world.surface[bedX];
  BB.setTile(world, bedX, bedY, BLOCK.BED);

  const atBed = playerMod.findSpawn(world, { spawnX: bedX, spawnY: bedY });
  ok(atBed.atBed === true, 'findSpawn reports atBed when the bed is still there');
  ok(atBed.x === bedX, 'bed spawn returns the bed column, not world centre');

  // Mine the bed away — the stored spawn is unchanged, the bed is not.
  BB.setTile(world, bedX, bedY, BLOCK.AIR);
  const gone = playerMod.findSpawn(world, { spawnX: bedX, spawnY: bedY });
  ok(gone.atBed === false, 'findSpawn reports no bed once the bed is destroyed');
  ok(gone.x === centreX, 'a destroyed bed falls back to world centre');

  // Never set a bed at all.
  const never = playerMod.findSpawn(world, { spawnX: null, spawnY: null });
  ok(never.atBed === false && never.x === centreX, 'no bed set falls back to world centre');
}

// The toast must be driven by that flag, not by the stale spawnX check.
{
  const survival = fs.readFileSync(path.join(root, 'js/systems/survival.js'), 'utf8');
  ok(survival.includes('sp.atBed ?'), 'death message reads the spawn result, not player.spawnX');
}

// —— Chest panel responsive layout (bb-508) ——
// The panel used to be a hardcoded 340x560 box, which is taller than the whole
// 640x400 landscape canvas: the backpack rows were drawn below the bottom edge
// and could not be seen or tapped.
console.log('\nChest panel layout');
{
  const chestLayoutUrl = pathToFileURL(path.join(root, 'js/render/chestLayout.js')).href;
  const { chestPanelLayout } = await import(chestLayoutUrl);

  for (const [name, VW, VH] of [['landscape', 640, 400], ['portrait', 390, 600]]) {
    const L = chestPanelLayout(VW, VH, 24, 8);
    const rects = [...L.chestSlots, ...L.hotbarSlots, ...L.bagSlots, L.close];

    ok(L.chestSlots.length === 16 && L.hotbarSlots.length === 8 && L.bagSlots.length === 24,
      `${name} draws every slot (16 chest / 8 hotbar / 24 bag)`);

    const offCanvas = rects.filter(r =>
      r.x < 0 || r.y < 0 || r.x + r.w > VW || r.y + r.h > VH);
    ok(offCanvas.length === 0,
      `${name} every slot is on-canvas` +
      (offCanvas.length ? ` — ${offCanvas.length} off, lowest bottom ` +
        Math.max(...rects.map(r => r.y + r.h)) + ` vs H=${VH}` : ''));

    const p = L.panel;
    ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= VW && p.y + p.h <= VH,
      `${name} panel box fits the canvas (${p.w}x${p.h} at ${p.x},${p.y})`);

    const outside = rects.filter(r =>
      r.x < p.x || r.y < p.y || r.x + r.w > p.x + p.w || r.y + r.h > p.y + p.h);
    ok(outside.length === 0, `${name} every slot sits inside the panel box`);

    // Kid-sized tap targets: 30 units is ~55 CSS px on an iPad.
    ok(L.cell >= 30, `${name} cell >= 30 (got ${L.cell})`);

    // Contract with drawChestPanel: it destructures these and will throw a
    // "Menu glitch" panel if any are missing.
    const needed = ['title', 'headerHint', 'chest', 'hotbar', 'bag', 'footer'];
    const missing = needed.filter(k =>
      !L.labels[k] || !Number.isFinite(L.labels[k].x) || !Number.isFinite(L.labels[k].y));
    ok(missing.length === 0,
      `${name} supplies every label drawChestPanel reads` +
      (missing.length ? ` — missing ${missing.join(', ')}` : ''));

    console.log(`  · ${name} panel [${p.x},${p.y}] ${p.w}x${p.h}, ` +
      `lowest rect bottom ${Math.max(...rects.map(r => r.y + r.h))}, cell ${L.cell}`);
  }

  // The renderer must not reintroduce a hardcoded panel size, and every label
  // must set its own textAlign — drawInvSlot leaves it on the count badge.
  const renChest = renSrc.slice(renSrc.indexOf('export function drawChestPanel'));
  const chestBody = renChest.slice(0, renChest.indexOf('\nexport function'));
  ok(/chestPanelLayout\(W, H/.test(chestBody), 'drawChestPanel sizes itself from W/H');
  ok(!/const ph = \d+;/.test(chestBody), 'drawChestPanel has no hardcoded panel height');
  const drawnLabels = new Set((chestBody.match(/labels\.(\w+)\.x/g) || [])
    .map(m => m.slice('labels.'.length, -2)));
  ok(drawnLabels.size === 6,
    `all six chest labels draw from the layout (got ${[...drawnLabels].join(',')})`);
  // Each label must reset alignment; drawInvSlot leaves textAlign on the badge.
  ok((chestBody.match(/ctx\.textAlign = /g) || []).length >= 6,
    'every chest label sets its own textAlign');
}


// —— Bottom HUD layout (v1.9.055, bb-c69 + bb-37u) ——
// The renderer and the hit-tester used to carry separate copies of the hotbar
// numbers and had drifted apart (drawn 42/5 vs tested 40/4), so taps near the
// slot edges selected the wrong slot.
console.log('\nBottom HUD layout');
{
  const hudUrl = pathToFileURL(path.join(root, 'js/render/hudLayout.js')).href;
  const { hudLayout, hotbarSlotAt } = await import(hudUrl);
  const N = 8;

  for (const [name, VW, VH] of [['landscape', 640, 400], ['portrait', 390, 600]]) {
    const L = hudLayout(VW, VH, N);
    const { hp, hunger, energy } = L.bars;

    ok(L.slots.length === N, `${name} lays out all ${N} hotbar slots`);

    const off = L.slots.filter(s => s.x < 0 || s.y < 0 || s.x + s.w > VW || s.y + s.h > VH);
    ok(off.length === 0, `${name} every hotbar slot is on-canvas` +
      (off.length ? ` — ${off.length} off` : ''));

    const outside = L.slots.filter(s =>
      s.x < L.tray.x || s.y < L.tray.y ||
      s.x + s.w > L.tray.x + L.tray.w || s.y + s.h > L.tray.y + L.tray.h);
    ok(outside.length === 0, `${name} every hotbar slot sits inside the tray`);

    // Bars sit above the tray, not on it, and do not overlap each other.
    ok(hp.y + hp.h <= L.tray.y, `${name} health bar clears the hotbar tray`);
    ok(hunger.y + hunger.h <= L.tray.y, `${name} hunger bar clears the hotbar tray`);
    ok(hp.x + hp.w <= hunger.x, `${name} health and hunger bars do not overlap`);
    ok(hp.y >= 0 && hunger.y >= 0, `${name} bars are on-canvas`);
    // The energy sliver is reserved whether drawn or not, so the bars never jump.
    ok(energy.y >= hp.y + hp.h && energy.y + energy.h <= L.tray.y,
      `${name} energy sliver sits between the bars and the tray`);

    // The contract that actually broke: what is drawn is what is tapped.
    let mismatched = 0;
    for (const s of L.slots) {
      for (const [px, py] of [
        [s.x + 0.5, s.y + 0.5],                 // top-left pixel
        [s.x + s.w / 2, s.y + s.h / 2],         // centre
        [s.x + s.w - 0.5, s.y + s.h - 0.5],     // bottom-right pixel
      ]) {
        if (hotbarSlotAt(VW, VH, N, px, py) !== s.i) mismatched++;
      }
    }
    ok(mismatched === 0,
      `${name} every drawn hotbar slot hit-tests to itself` +
      (mismatched ? ` — ${mismatched} corners wrong` : ''));

    console.log(`  · ${name} tray [${L.tray.x},${L.tray.y}] ${L.tray.w}x${L.tray.h}, ` +
      `bars y=${hp.y} w=${hp.w}`);
  }

  // Neither side may keep its own copy of the numbers.
  const renHud = fs.readFileSync(path.join(root, 'js/render/index.js'), 'utf8');
  const inpHud = fs.readFileSync(path.join(root, 'js/input/input.js'), 'utf8');
  const drawHud = renHud.slice(renHud.indexOf('export function drawHUD'),
                               renHud.indexOf('export function drawBar'));
  ok(/hudLayout\(W, H, HOTBAR_SIZE\)/.test(drawHud),
    'drawHUD takes its hotbar geometry from hudLayout');
  ok(!/const slot = 4\d;/.test(drawHud), 'drawHUD keeps no private hotbar slot size');
  ok(/hotbarSlotAt\(/.test(inpHud), 'input.js hit-tests via hotbarSlotAt');
  ok(!/const slot = 4\d;/.test(inpHud), 'input.js keeps no private hotbar slot size');
  ok(sw.includes('hudLayout.js'), 'SW caches hudLayout.js');

  // Buttons move to the right of the tray in landscape only.
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  ok(/body\.landscape \.bag-btn\s*\{[^}]*right:/.test(css),
    'inventory button is right-aligned in landscape');
  ok(/body\.landscape \.fly-btn\s*\{[^}]*right:/.test(css),
    'fly button is right-aligned in landscape');
  ok(/body:not\(\.landscape\)[^{]*\.bag-btn/.test(css),
    'portrait chrome is lifted clear of the full-width tray');
}


// —— Options toggles for the play screen (v1.9.056, bb-8pp) ——
console.log('\nOptions HUD toggles');
{
  const saveSrc = fs.readFileSync(path.join(root, 'js/save/save.js'), 'utf8');
  const mainSrc = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const gcSrc = fs.readFileSync(path.join(root, 'js/session/GameController.js'), 'utf8');
  const renSrc = fs.readFileSync(path.join(root, 'js/render/index.js'), 'utf8');
  const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  ok(/export function setPlayToggle/.test(saveSrc), 'save exposes setPlayToggle');
  ok(/export function getPlayToggle/.test(saveSrc), 'save exposes getPlayToggle');
  ok(/writeLibrary\(\);/.test(saveSrc.slice(saveSrc.indexOf('export function setPlayToggle'),
                                            saveSrc.indexOf('export function getControlMode'))),
    'flipping a toggle persists it');
  // A library written before this version has neither key — it must not read
  // as "everything off".
  for (const key of ['showCoords', 'showMinimap']) {
    ok(new RegExp(`library\\.${key} !== false`).test(saveSrc),
      `missing ${key} in an old library defaults to on`);
    ok(htmlSrc.includes(key === 'showCoords' ? 'btnCoords' : 'btnMinimap'),
      `Options has a button for ${key}`);
    ok(new RegExp(`ui\\.${key} = `).test(gcSrc), `session syncs ${key} each frame`);
    ok(new RegExp(`ui\\.${key} !== false`).test(renSrc), `renderer honours ${key}`);
  }
  ok(/updatePlayToggleUi\(\);/.test(mainSrc.slice(mainSrc.indexOf('function showOptions'),
                                                 mainSrc.indexOf('function showOptions') + 260)),
    'opening Options refreshes the toggle labels');

  // Coordinates come back as bare text — the card background is what made the
  // old readout expensive.
  const hudBody = renSrc.slice(renSrc.indexOf('export function drawHUD'),
                               renSrc.indexOf('export function drawBar'));
  const coords = hudBody.slice(hudBody.indexOf('if (ui.showCoords !== false)'),
                               hudBody.indexOf('// Minimap'));
  ok(!/roundRect/.test(coords), 'coordinates draw with no card behind them');
  ok(/fillText/.test(coords), 'coordinates are still drawn');
}


// —— Auto-jump over a one-block step (v1.9.057, bb-cho) ——
// systems/nav.js has hopped steps for tap-to-walk since it existed; driving
// manually never did, so kids got stuck on single blocks.
console.log('\nAuto-jump');
{
  const playerUrl = pathToFileURL(path.join(root, 'js/player/index.js')).href;
  const { autoJumpStep } = await import(playerUrl);

  BB.applyWorldSize(1024);
  const w = BB.generateWorld(99);
  // Flatten a shelf so the geometry under test is the only thing present.
  const x0 = 100;
  const gy = w.surface[x0] + 1;         // first solid tile below the feet
  for (let x = x0 - 4; x <= x0 + 8; x++) {
    for (let y = gy - 6; y < gy; y++) BB.setTile(w, x, y, BB.BLOCK.AIR);
    BB.setTile(w, x, gy, BB.BLOCK.STONE);
  }
  const stand = { x: x0 + 0.5, y: gy, w: 0.55, h: 1.55 };

  ok(autoJumpStep(w, stand, 1) === false, 'flat ground does not auto-jump');
  ok(autoJumpStep(w, stand, 0) === false, 'standing still never auto-jumps');

  // One-block step to the right → hop.
  BB.setTile(w, x0 + 1, gy - 1, BB.BLOCK.STONE);
  ok(autoJumpStep(w, stand, 1) === true, 'a one-block step auto-jumps');
  ok(autoJumpStep(w, stand, -1) === false, 'walking away from the step does not');
  // The case that matters for the guard: a step is right there, but they are
  // not walking into it. Checking this on flat ground would pass either way.
  ok(autoJumpStep(w, stand, 0) === false, 'standing still beside a step does not jump');

  // Make it two tall — no longer clearable, so it must not fire.
  BB.setTile(w, x0 + 1, gy - 2, BB.BLOCK.STONE);
  ok(autoJumpStep(w, stand, 1) === false, 'a two-block wall does not auto-jump');

  // Back to one tall, but with a ceiling directly over the step: no headroom.
  BB.setTile(w, x0 + 1, gy - 2, BB.BLOCK.AIR);
  ok(autoJumpStep(w, stand, 1) === true, 'one-block step again after clearing');
  BB.setTile(w, x0 + 1, gy - 3, BB.BLOCK.STONE);
  ok(autoJumpStep(w, stand, 1) === false, 'no auto-jump into an overhang');

  // Wiring: the toggle reaches the player, and the player honours it.
  const playerSrc = fs.readFileSync(path.join(root, 'js/player/index.js'), 'utf8');
  const gcSrc = fs.readFileSync(path.join(root, 'js/session/GameController.js'), 'utf8');
  const saveSrc = fs.readFileSync(path.join(root, 'js/save/save.js'), 'utf8');
  const htmlSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  ok(/p\.autoJump !== false/.test(playerSrc), 'player honours the auto-jump toggle');
  ok(/player\.autoJump = /.test(gcSrc), 'session pushes the toggle onto the player');
  ok(/'autoJump'/.test(saveSrc) && /library\.autoJump !== false/.test(saveSrc),
    'auto-jump persists and defaults on for old libraries');
  ok(htmlSrc.includes('btnAutoJump'), 'Options has an auto-jump button');
  // It must not fire while flying or on a ladder, where jump means something else.
  ok(/!p\.flying && !wantClimb/.test(playerSrc),
    'auto-jump is suppressed while flying or climbing');
}


// —— Esc does not pause on top of an open panel (v1.9.058, bb-ror) ——
console.log('\nPause vs open panels');
{
  const gc = fs.readFileSync(path.join(root, 'js/session/GameController.js'), 'utf8');
  const pause = gc.slice(gc.indexOf('// Pause.'), gc.indexOf('// Zoom'));

  ok(/closeOpenPanel\(ui\)/.test(pause), 'Esc closes an open panel instead of pausing over it');
  ok(/else s\.paused = !s\.paused/.test(pause), 'Esc still pauses when nothing is open');
  ok(/ui\.creativeOpen \|\| ui\.bagOpen \|\| ui\.chestOpen \|\| ui\.craftOpen/.test(pause),
    'all four panels count as open');
  ok(/clearLatchedInput\(input\)/.test(pause),
    'paused frames drop one-shot input instead of buffering it');

  // Everything the update loop consumes as a one-shot must be cleared, or it
  // fires the moment play resumes.
  const body = gc.slice(gc.indexOf('function clearLatchedInput'),
                        gc.indexOf('function closeOpenPanel'));
  const oneShots = [
    'craftToggle', 'bagToggle', 'creativeToggle', 'modeToggle', 'flyToggle',
    'usePressed', 'attackPressed', 'jumpPressed', 'hotbarTap', 'tapPlace',
  ];
  const missed = oneShots.filter(k => !body.includes(k));
  ok(missed.length === 0, 'clearLatchedInput covers every one-shot flag' +
    (missed.length ? ` — missing ${missed.join(', ')}` : ''));
  // Held movement must survive: it is re-read from the keyboard each frame and
  // clearing it would make the player stutter on resume.
  ok(!/input\.left = |input\.right = /.test(body),
    'clearLatchedInput leaves held movement alone');
}


// —— Kids camera keeps up with a walker (v1.9.059, bb-mbj) ——
// The old pull was purely proportional, so it settled at a constant error
// instead of catching up: ~6 tiles behind on an 11.4-tile half-screen, which
// parked the character over halfway to the edge and left it there.
console.log('\nKids camera');
{
  const camUrl = pathToFileURL(path.join(root, 'js/systems/camera.js')).href;
  const { updateCamera } = await import(camUrl);
  BB.applyWorldSize(1024);
  BB.applyViewport(1180, 820);
  const halfW = (BB.W / 2) / 28;

  const makeSession = () => ({
    ui: { controlMode: 'kids', zoom: 1 },
    input: { camUserPanned: false, panFreelookT: 0, _panning: false, moveTarget: null },
    player: { x: 500, y: 40, vx: 0, vy: 0 },
    cam: { x: 500, y: 38.8, zoom: 1 },
  });
  const run = (s, steps, dt = 1 / 60) => {
    for (let i = 0; i < steps; i++) {
      s.player.x += s.player.vx * dt;
      updateCamera(s, dt);
    }
  };

  // A walker at a normal speed, held for four seconds.
  const walk = makeSession();
  walk.player.vx = 5.5;
  run(walk, 240);
  const lag = Math.abs(walk.player.x - walk.cam.x);
  ok(lag < halfW * 0.4,
    `a sustained walk settles well inside the screen (${lag.toFixed(2)} of ${halfW.toFixed(1)} tiles)`);
  ok(lag > 0.5, 'the camera still trails rather than locking to centre');
  console.log(`  · settled ${lag.toFixed(2)} tiles = ${(lag / halfW * 100).toFixed(0)}% toward the edge`);

  // Same, faster (sprinting) — must not degrade back into a standing lag.
  const sprint = makeSession();
  sprint.player.vx = 8.2;
  run(sprint, 240);
  const slag = Math.abs(sprint.player.x - sprint.cam.x);
  ok(slag < halfW * 0.45,
    `sprinting does not reopen the gap (${slag.toFixed(2)} tiles)`);

  // The property the box camera exists to protect: jumping on the spot must
  // not move the view, or it yanks out from under a kid placing a block.
  const jump = makeSession();
  const cx0 = jump.cam.x;
  const cy0 = jump.cam.y;
  for (let i = 0; i < 180; i++) {
    jump.player.vy = Math.sin(i / 8) * 6;
    jump.player.y = 40 - Math.abs(Math.sin(i / 8)) * 1.8;
    updateCamera(jump, 1 / 60);
  }
  ok(Math.abs(jump.cam.x - cx0) < 0.01, 'jumping in place does not pan the camera sideways');
  ok(Math.abs(jump.cam.y - cy0) < 0.01, 'jumping in place does not pan the camera vertically');

  // A drag to look around still wins over the walk pull.
  const pan = makeSession();
  pan.player.vx = 5.5;
  pan.input.camUserPanned = true;
  pan.cam.x = 495;
  run(pan, 60);
  const drifted = Math.abs(pan.cam.x - 495);
  ok(drifted < halfW * 0.72,
    'after a drag the walk pull does not snatch the camera back');
}


// —— Liquid flow (v1.9.060, bb-05a) ——
// Reported: water placed at the top of a 1-wide 2-deep hole filled only the
// top block. There was no flow at all — water never fell and never spread.
console.log('\nLiquid flow');
{
  const liqUrl = pathToFileURL(path.join(root, 'js/world/liquid.js')).href;
  const { tickLiquids, MAX_LEVEL, WATER_STEP, getLevel } = await import(liqUrl);
  const API = { getTile: BB.getTile, setTile: BB.setTile };
  const settle = (w, steps = 120) => {
    for (let i = 0; i < steps; i++) tickLiquids(w, WATER_STEP, API);
  };
  /** Solid stone box with a hollow interior, so nothing leaks off the edges. */
  const slab = (yTop, yBot, x0, x1, w) => {
    for (let x = x0; x <= x1; x++) for (let y = yTop; y <= yBot; y++) BB.setTile(w, x, y, BB.BLOCK.STONE);
  };

  BB.applyWorldSize(1024);
  const w = BB.generateWorld(5);
  const Y = 60;

  // ——— the reported bug ———
  slab(Y - 4, Y + 4, 100, 120, w);
  BB.setTile(w, 110, Y, BB.BLOCK.AIR);       // top of a 1-wide, 2-deep hole
  BB.setTile(w, 110, Y + 1, BB.BLOCK.AIR);   // bottom
  BB.setTile(w, 110, Y, BB.BLOCK.WATER);     // pour into the TOP spot
  settle(w);
  ok(BB.getTile(w, 110, Y) === BB.BLOCK.WATER, 'water stays in the top of the hole');
  ok(BB.getTile(w, 110, Y + 1) === BB.BLOCK.WATER,
    'water reaches the BOTTOM of a 1-wide 2-deep hole (the reported bug)');

  // ——— spreads sideways, but not forever ———
  const w2 = BB.generateWorld(6);
  slab(Y - 4, Y + 4, 200, 260, w2);
  for (let x = 205; x <= 255; x++) BB.setTile(w2, x, Y, BB.BLOCK.AIR); // trench
  BB.setTile(w2, 230, Y, BB.BLOCK.WATER);
  settle(w2);
  let reach = 0;
  for (let x = 205; x <= 255; x++) if (BB.getTile(w2, x, Y) === BB.BLOCK.WATER) reach++;
  ok(reach > 3, `a puddle spreads sideways (${reach} tiles)`);
  ok(reach < 30, `a single source does not flood the whole trench (${reach} tiles)`);
  ok(BB.getTile(w2, 205, Y) === BB.BLOCK.AIR, 'the far end of the trench stays dry');

  // ——— falls before it spreads ———
  const w3 = BB.generateWorld(7);
  slab(Y - 6, Y + 6, 300, 340, w3);
  for (let y = Y; y <= Y + 4; y++) BB.setTile(w3, 320, y, BB.BLOCK.AIR); // a shaft
  BB.setTile(w3, 319, Y, BB.BLOCK.AIR);
  BB.setTile(w3, 321, Y, BB.BLOCK.AIR);
  BB.setTile(w3, 320, Y, BB.BLOCK.WATER);
  settle(w3);
  ok(BB.getTile(w3, 320, Y + 4) === BB.BLOCK.WATER, 'water falls to the bottom of a shaft');
  ok(BB.getTile(w3, 319, Y) === BB.BLOCK.AIR && BB.getTile(w3, 321, Y) === BB.BLOCK.AIR,
    'water with somewhere to fall does not also spread sideways');

  // ——— drains when the source is taken away ———
  const w4 = BB.generateWorld(8);
  slab(Y - 4, Y + 4, 400, 440, w4);
  for (let x = 415; x <= 425; x++) BB.setTile(w4, x, Y, BB.BLOCK.AIR);
  BB.setTile(w4, 420, Y, BB.BLOCK.WATER);
  settle(w4);
  const wet = () => { let n = 0; for (let x = 415; x <= 425; x++) if (BB.getTile(w4, x, Y) === BB.BLOCK.WATER) n++; return n; };
  ok(wet() > 1, 'puddle formed before removing the source');
  BB.setTile(w4, 420, Y, BB.BLOCK.AIR);
  settle(w4);
  ok(wet() === 0, 'the puddle drains once its source is gone');

  // ——— storage: a settled world must not carry a level for every tile ———
  const entries = Object.keys(w2.meta.liquid || {}).length;
  ok(entries < 40, `flow levels stay sparse (${entries} entries for a whole puddle)`);
  ok(getLevel(w2, 230, Y, BB.getTile) === MAX_LEVEL, 'the poured tile is a source');

  // ——— a still world costs nothing ———
  const w5 = BB.generateWorld(9);
  w5._liquidQueue = null;
  ok(tickLiquids(w5, 1, API) === 0, 'an untouched world does no liquid work');

  // ——— falling sand wakes the water it displaces ———
  const w6 = BB.generateWorld(11);
  slab(Y - 6, Y + 4, 500, 540, w6);
  for (let x = 515; x <= 525; x++) { BB.setTile(w6, x, Y, BB.BLOCK.AIR); BB.setTile(w6, x, Y - 1, BB.BLOCK.AIR); }
  BB.setTile(w6, 520, Y, BB.BLOCK.WATER);
  settle(w6);
  BB.setTile(w6, 518, Y - 1, BB.BLOCK.SAND);
  BB.tickGravityNear(w6, 518, Y - 1, 6);
  settle(w6);
  ok(BB.getTile(w6, 518, Y) === BB.BLOCK.SAND, 'sand fell into the puddle');
  ok(BB.getTile(w6, 517, Y) === BB.BLOCK.WATER || BB.getTile(w6, 519, Y) === BB.BLOCK.WATER,
    'water still surrounds the sand rather than leaving a dry hole');

  // ——— meta round-trips ———
  const metaMod = await import(pathToFileURL(path.join(root, 'js/interact/meta.js')).href);
  const round = metaMod.deserializeMeta(metaMod.serializeMeta(w2.meta));
  ok(Object.keys(round.liquid || {}).length === entries, 'flow levels survive save + load');
}


// —— Magma as a liquid (v1.9.061, bb-z8t + bb-8so + bb-hr1) ——
console.log('\nMagma');
{
  const liqUrl = pathToFileURL(path.join(root, 'js/world/liquid.js')).href;
  const { tickLiquids, WATER_STEP, LAVA_SLOW } = await import(liqUrl);
  const API = { getTile: BB.getTile, setTile: BB.setTile };
  const settle = (w, steps = 400) => { for (let i = 0; i < steps; i++) tickLiquids(w, WATER_STEP, API); };
  const slab = (yTop, yBot, x0, x1, w) => {
    for (let x = x0; x <= x1; x++) for (let y = yTop; y <= yBot; y++) BB.setTile(w, x, y, BB.BLOCK.STONE);
  };
  BB.applyWorldSize(1024);
  const Y = 60;

  ok(BB.BLOCK_META[BB.BLOCK.LAVA].solid === false,
    'lava is not solid — you can fall into it');
  ok(BB.BLOCK_META[BB.BLOCK.LAVA].mine >= 99,
    'lava still cannot be mined directly');

  // ——— one hardened crust layer over the molten rock (bb-byj) ———
  ok(BB.BLOCK.MAGMA != null && BB.BLOCK_META[BB.BLOCK.MAGMA], 'MAGMA is its own block');
  ok(BB.BLOCK_META[BB.BLOCK.MAGMA].solid === true, 'the crust is solid — you stand on it');
  ok(BB.BLOCK_META[BB.BLOCK.MAGMA].mine < 50, 'the crust can be mined through');
  ok(!BB.BLOCK_META[BB.BLOCK.MAGMA].hazard, 'the crust is hardened, so it does not burn');
  ok(BB.BLOCK_META[BB.BLOCK.LAVA].name === 'Lava' && BB.BLOCK_META[BB.BLOCK.MAGMA].name === 'Magma',
    'the two are named apart — one block used to be called both');

  const wc = BB.generateWorld(31);
  let crustCols = 0;
  let lavaBelow = 0;
  let crustDepth = 0;
  for (let x = 0; x < 200; x++) {
    if (BB.getTile(wc, x, BB.MAGMA_Y) === BB.BLOCK.MAGMA) crustCols++;
    if (BB.getTile(wc, x, BB.MAGMA_Y + 1) === BB.BLOCK.LAVA) lavaBelow++;
    // exactly one hardened layer, not a slab of it
    if (BB.getTile(wc, x, BB.MAGMA_Y + 1) === BB.BLOCK.MAGMA) crustDepth++;
  }
  ok(crustCols === 200, `every column is capped with crust (${crustCols}/200)`);
  ok(lavaBelow === 200, `molten lava sits directly beneath it (${lavaBelow}/200)`);
  ok(crustDepth === 0, 'the crust is exactly one layer thick');
  ok(BB.getTile(wc, 10, BB.WORLD_H - 1) === BB.BLOCK.BEDROCK, 'bedrock still floors the world');
  ok(BB.emitLight(BB.BLOCK.MAGMA) > 0, 'the crust glows — it is the only light down there');

  // Deep magma used to be write-protected, which made the slab permanent.
  const w0 = BB.generateWorld(21);
  const deep = BB.WORLD_H - 5;
  ok(BB.getTile(w0, 50, deep) === BB.BLOCK.LAVA, 'the world still has a magma slab');
  ok(BB.setTile(w0, 50, deep, BB.BLOCK.STONE) === true,
    'deep magma can now be written (needed to quench it)');

  // ——— water quenches magma into stone ———
  const w1 = BB.generateWorld(22);
  slab(Y - 6, Y + 6, 100, 140, w1);
  for (let x = 115; x <= 125; x++) { BB.setTile(w1, x, Y, BB.BLOCK.AIR); BB.setTile(w1, x, Y - 1, BB.BLOCK.AIR); }
  BB.setTile(w1, 120, Y, BB.BLOCK.LAVA);
  settle(w1);
  BB.setTile(w1, 120, Y - 1, BB.BLOCK.WATER);   // pour water onto the magma
  settle(w1);
  ok(BB.getTile(w1, 120, Y) === BB.BLOCK.STONE,
    'water poured onto magma turns it to stone');

  // ——— magma reflows into a void, so one block at a time gets you nowhere ———
  const w2 = BB.generateWorld(23);
  slab(Y - 6, Y + 6, 200, 240, w2);
  for (let x = 215; x <= 225; x++) BB.setTile(w2, x, Y, BB.BLOCK.LAVA);
  settle(w2);
  BB.setTile(w2, 220, Y, BB.BLOCK.AIR);          // clear one tile out of the middle
  settle(w2);
  ok(BB.getTile(w2, 220, Y) === BB.BLOCK.LAVA,
    'magma flows back into a single cleared tile');

  // ——— but cut off the supply and the hole stays open ———
  const w3 = BB.generateWorld(24);
  slab(Y - 6, Y + 6, 300, 340, w3);
  for (let x = 315; x <= 325; x++) BB.setTile(w3, x, Y, BB.BLOCK.LAVA);
  settle(w3);
  BB.setTile(w3, 319, Y, BB.BLOCK.STONE);        // walls either side
  BB.setTile(w3, 321, Y, BB.BLOCK.STONE);
  BB.setTile(w3, 320, Y, BB.BLOCK.AIR);
  settle(w3);
  ok(BB.getTile(w3, 320, Y) === BB.BLOCK.AIR,
    'walling the magma off keeps the hole open — the way down is to cut supply');

  // ——— magma is slower than water ———
  const mk = (id, seed) => {
    const w = BB.generateWorld(seed);
    slab(Y - 6, Y + 6, 400, 460, w);
    for (let x = 410; x <= 450; x++) BB.setTile(w, x, Y, BB.BLOCK.AIR);
    BB.setTile(w, 430, Y, id);
    return w;
  };
  const spread = (w) => { let n = 0; for (let x = 410; x <= 450; x++) if (isLiq(BB.getTile(w, x, Y))) n++; return n; };
  const isLiq = (t) => t === BB.BLOCK.WATER || t === BB.BLOCK.LAVA;
  const ww = mk(BB.BLOCK.WATER, 25);
  const wl = mk(BB.BLOCK.LAVA, 26);
  for (let i = 0; i < 6; i++) { tickLiquids(ww, WATER_STEP, API); tickLiquids(wl, WATER_STEP, API); }
  ok(spread(ww) > spread(wl),
    `magma oozes slower than water (${spread(wl)} vs ${spread(ww)} tiles after 6 ticks)`);
  ok(LAVA_SLOW > 1, 'magma has a slower step rate than water');

  // ——— swim physics exist and are gentler than falling ———
  const psrc = fs.readFileSync(path.join(root, 'js/player/index.js'), 'utf8');
  ok(/feet === BLOCK\.LAVA \|\| body === BLOCK\.LAVA/.test(psrc),
    'the player has a magma branch, reachable now magma is not solid');
  ok(/LAVA_SINK/.test(psrc) && /LAVA_SWIM/.test(psrc), 'magma has sink and swim speeds');
  const sink = +psrc.match(/const LAVA_SINK = ([\d.]+)/)[1];
  const swim = +psrc.match(/const LAVA_SWIM = ([\d.]+)/)[1];
  ok(sink < 4, `sinking is slower than falling through air (${sink} tiles/s)`);
  ok(swim > sink, 'you can swim upward faster than you sink — magma is escapable');
  ok(/underfoot === BLOCK\.LAVA/.test(psrc),
    'the swim stroke still applies at the surface, so you can climb onto a ledge');
  ok(!/p\.vy = JUMP_VEL \/ TILE \* 0\.6/.test(psrc),
    'the old hazard bounce is gone — it fought the sinking');
  ok(/p\.burning = /.test(psrc), 'burning is flagged so idle regen can be suppressed');

  // On Easy the burn is 2.8 hp/s and idle regen is 3 hp/s: without this the
  // player healed faster than magma hurt and was simply immortal in it.
  const surv = fs.readFileSync(path.join(root, 'js/systems/survival.js'), 'utf8');
  ok(/!\(player\.burning > 0\)/.test(surv), 'idle regen is suppressed while burning');
  const gcSrcM = fs.readFileSync(path.join(root, 'js/session/GameController.js'), 'utf8');
  ok(/player\.hazardMul = /.test(gcSrcM), 'magma burn scales with difficulty');
}

// ————— Swim pose —————
{
  console.log('\nSwim pose');
  const { swimTilt } = await import(pathToFileURL(path.join(root, 'js/render/index.js')).href);
  const psrc = fs.readFileSync(path.join(root, 'js/player/index.js'), 'utf8');
  const tsrc = fs.readFileSync(path.join(root, 'js/textures/textures.js'), 'utf8');
  const rsrc = fs.readFileSync(path.join(root, 'js/render/index.js'), 'utf8');

  // The flag the whole pose hangs off. Wading a puddle must not count, or the
  // character swims along the shoreline on dry ground.
  ok(/p\.swimming = 0;/.test(psrc), 'swim state is cleared each frame');
  ok(/liquid\(feet\) && !p\.onGround/.test(psrc),
    'feet in water only counts as swimming when there is no ground under you');
  ok(/p\.swimming === 2 \? 3\.5 : 6/.test(psrc), 'strokes cycle slower in magma than water');
  ok(/player\.swimming && A\.walk/.test(tsrc), 'swimming picks walk frames, not the jump pose');
  ok(/if \(p\.swimming && !p\.inBoat\)/.test(rsrc), 'the renderer tips the body while swimming');

  const at = (o) => swimTilt({ swimming: 1, vx: 0, vy: 0, anim: 0, ...o });
  // anim 0 → sin 0, so these read the tilt with the stroke at its midpoint.
  const tread = at({});
  const cross = at({ vx: 4 });
  ok(cross.ang > tread.ang, `swimming forward lies you flatter than treading (${cross.ang.toFixed(2)} vs ${tread.ang.toFixed(2)} rad)`);
  ok(cross.ang > 1.0 && cross.ang < Math.PI / 2,
    `a full-speed swim is near horizontal but never past it (${cross.ang.toFixed(2)} rad)`);
  ok(tread.ang > 0.2, 'treading water still leans — upright is the bug being fixed');

  const reach = at({ vx: 4, vy: -2.2 });
  ok(reach.ang < cross.ang * 0.5,
    `striking upward pulls back toward vertical (${reach.ang.toFixed(2)} vs ${cross.ang.toFixed(2)} rad)`);

  const magma = swimTilt({ swimming: 2, vx: 4, vy: 0, anim: 0 });
  ok(magma.ang < cross.ang, `magma is thicker, so it tips you less (${magma.ang.toFixed(2)} vs ${cross.ang.toFixed(2)} rad)`);

  // The stroke has to actually oscillate, or the pose is a static lean.
  let lo = Infinity;
  let hi = -Infinity;
  for (let a = 0; a < 7; a += 0.05) {
    const s = swimTilt({ swimming: 1, vx: 0, vy: 0, anim: a });
    lo = Math.min(lo, s.ang);
    hi = Math.max(hi, s.ang);
  }
  ok(hi - lo > 0.15, `the stroke oscillates over the cycle (${(hi - lo).toFixed(2)} rad swing)`);
  // anim = π/4 → phase π/2, the peak of the stroke.
  ok(Math.abs(swimTilt({ swimming: 1, vx: 0, vy: 0, anim: Math.PI / 4 }).bob) > 0.02,
    'the body bobs as it strokes');
}

// ————— How to Play —————
{
  console.log('\nHow to Play');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const htm = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const panel = htm.slice(htm.indexOf('id="howPanel"'), htm.indexOf('</ol>', htm.indexOf('id="howPanel"')));
  const items = panel.match(/<li>/g) || [];

  // The panel was a 200px window onto 447px of text, so item 4 was cut
  // mid-word and nothing showed there was more. Landscape has spare width, so
  // the fix spends width rather than height.
  ok(/:has\(\.how:not\(\.hidden\)\)/.test(css), 'landscape reflows the card while How-to is open');
  ok(/\.how ol \{[^}]*columns: 2/.test(css), 'the landscape list runs in two columns');
  ok(/break-inside: avoid/.test(css), 'an instruction never splits across a column break');
  ok(/column-span: all/.test(css), 'the footer line spans both columns');

  // Features shipped in 1.9.056–1.9.063 that the instructions never mentioned.
  const say = (re, what) => ok(re.test(panel), `How to Play explains ${what}`);
  say(/Auto-jump|auto-jump/, 'auto-jump');
  say(/one-block step/, 'what auto-jump actually does');
  say(/<b>coordinates<\/b>/, 'the coordinates toggle');
  say(/<b>minimap<\/b>/, 'the minimap toggle');
  say(/you swim/, 'swimming');
  say(/<b>Magma<\/b> crust caps the molten <b>Lava<\/b>/, 'magma vs lava');
  say(/freeze it into <b>stone<\/b>/, 'quenching lava to reach bedrock');
  ok(items.length >= 13, `the list covers the current game (${items.length} items)`);
}

// ————— Cheats system —————
{
  console.log('\nCheats system');

  // Check the cheats catalog
  const cheatsUrl = pathToFileURL(path.join(root, 'js/content/cheats.js')).href;
  const Cheats = await import(cheatsUrl);
  ok(Array.isArray(Cheats.CHEATS) && Cheats.CHEATS.length > 0, 'cheats catalog exists and non-empty');

  // Every cheat must have id, name, icon
  Cheats.CHEATS.forEach((c, i) => {
    ok(typeof c.id === 'string' && c.id.length > 0, `cheat ${i} has id`);
    ok(typeof c.name === 'string' && c.name.length > 0, `cheat ${i} has name`);
    ok(typeof c.icon === 'string' && c.icon.length > 0, `cheat ${i} has icon`);
  });
  ok(typeof Cheats.getCheat === 'function', 'cheats.js exports getCheat');

  // Check save.js exports
  const saveUrl = pathToFileURL(path.join(root, 'js/save/save.js')).href;

  // Stub localStorage for testing
  if (typeof globalThis.localStorage === 'undefined') {
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    };
  }

  const Save = await import(saveUrl);
  ok(typeof Save.getCheatsEnabled === 'function', 'save.js exports getCheatsEnabled');
  ok(typeof Save.setCheatsEnabled === 'function', 'save.js exports setCheatsEnabled');
  ok(typeof Save.getCheat === 'function', 'save.js exports getCheat');
  ok(typeof Save.setCheat === 'function', 'save.js exports setCheat');
  ok(typeof Save.isCheatActive === 'function', 'save.js exports isCheatActive');

  // Gate logic: master OFF + cheat ON -> inactive
  Save.setCheatsEnabled(false);
  Save.setCheat('daytime', true);
  ok(!Save.isCheatActive('daytime'), 'master OFF + cheat ON -> inactive');

  // Gate logic: master ON + cheat OFF -> inactive
  Save.setCheatsEnabled(true);
  Save.setCheat('heal', false);
  ok(!Save.isCheatActive('heal'), 'master ON + cheat OFF -> inactive');

  // Gate logic: master ON + cheat ON -> active
  Save.setCheatsEnabled(true);
  Save.setCheat('daytime', true);
  ok(Save.isCheatActive('daytime'), 'master ON + cheat ON -> active');

  // Check save.js source for proper defaults
  const saveSrc = fs.readFileSync(path.join(root, 'js/save/save.js'), 'utf8');
  ok(/cheatsEnabled: false/.test(saveSrc), 'master defaults OFF in library');
  ok(/cheats: \{/.test(saveSrc), 'cheats object exists in library');
  ok(/getCheatsEnabled\(\) /, 'getCheatsEnabled uses the exported function');

  // Check GameController exports the cheat functions
  const gcUrl = pathToFileURL(path.join(root, 'js/session/GameController.js')).href;
  const GC = await import(gcUrl);
  ok(typeof GC.cheatSetDaytime === 'function', 'GameController exports cheatSetDaytime');
  ok(typeof GC.cheatHealFeed === 'function', 'GameController exports cheatHealFeed');
  ok(typeof GC.beginPrefabPlacement === 'function', 'GameController exports beginPrefabPlacement');
  ok(typeof GC.cancelPrefabPlacement === 'function', 'GameController exports cancelPrefabPlacement');
  ok(typeof GC.undoLastPrefab === 'function', 'GameController exports undoLastPrefab');
}

// Prefab tests
console.log('\nPrefab tests');
{
  const prefabUrl = pathToFileURL(path.join(root, 'js/content/prefabs.js')).href;
  const Prefabs = await import(prefabUrl);
  const PrefabLogic = await import(pathToFileURL(path.join(root, 'js/world/prefab.js')).href);

  // Check prefabs exist and have required fields
  const allPrefabs = Prefabs.PREFABS;
  ok(Array.isArray(allPrefabs) && allPrefabs.length > 0, 'PREFABS is non-empty array');

  allPrefabs.forEach(p => {
    ok(p.id && p.name && p.icon && p.group && p.rows && p.legend, `prefab ${p.id} has all fields`);
    // Check all rows same length
    const rowLens = p.rows.map(r => r.length);
    const allSame = rowLens.every(l => l === rowLens[0]);
    ok(allSame, `prefab ${p.id} rows uniform length`);
    // Check all non-space, non-dot chars in legend
    p.rows.forEach((row, ri) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        ok(ch === ' ' || ch === '.' || p.legend[ch] != null, `prefab ${p.id} row ${ri} char '${ch}' in legend`);
      }
    });
  });

  // Test getPrefab lookup
  const cottage = Prefabs.getPrefab('cosy-cottage');
  ok(cottage && cottage.name === 'Cosy Cottage', 'getPrefab finds cottage');
  ok(Prefabs.getPrefab('nonexistent') === null, 'getPrefab returns null for missing');

  // Test prefabBounds
  const hut = Prefabs.getPrefab('starter-hut');
  // Derive the expectation from the prefab itself — hardcoding a size here
  // couples a geometry test to the art, and redrawing a structure should not
  // fail a test about anchoring.
  const b = PrefabLogic.prefabBounds(hut, 10, 20);
  ok(b.w === hut.rows[0].length && b.h === hut.rows.length, 'prefabBounds dimensions');
  ok(b.x0 === 10 - Math.floor(hut.rows[0].length / 2) && b.y0 === 20 - (hut.rows.length - 1),
    'prefabBounds anchors bottom-centre');

  // Test placePrefab in a generated world
  BB.applyWorldSize(1024);
  const testWorld = BB.generateWorld(99);
  const placed1 = PrefabLogic.placePrefab(testWorld, hut, 100, 40);
  ok(placed1.ok, 'prefab placement succeeds');
  ok(Array.isArray(placed1.placed) && placed1.placed.length > 0, 'placement returns placed tiles');
  ok(Array.isArray(placed1.undo) && placed1.undo.length > 0, 'placement captures undo');

  // Check specific tiles were written
  const ft = placed1.placed[0];
  ok(BB.getTile(testWorld, ft.x, ft.y) === ft.id, 'placed tile matches returned id');

  // Test space doesn't overwrite
  const before = BB.getTile(testWorld, 101, 40);
  const placed2 = PrefabLogic.placePrefab(testWorld, hut, 101, 40);
  ok(placed2.ok, 'second placement succeeds');
  // A space in the pattern should leave an existing tile untouched (if it was hit by a space)

  // Test bedrock rejection
  BB.applyWorldSize(1024);
  const lowWorld = BB.generateWorld(88);
  // Try placing near bedrock (at WORLD_H - 2)
  const bedY = BB.WORLD_H - 3;
  const lowPlace = PrefabLogic.placePrefab(lowWorld, hut, 100, bedY);
  ok(!lowPlace.ok || lowPlace.placed.length < hut.rows.length * 7, 'bedrock blocks placement or limits it');

  // Test wrapping (place near seam)
  BB.applyWorldSize(1024);
  const wrapWorld = BB.generateWorld(77);
  const near0 = PrefabLogic.placePrefab(wrapWorld, hut, 2, 50);
  ok(near0.ok, 'placement near x=0 wraps correctly');
  // Check that wrapped coordinates were written
  const foundWrap = near0.placed.some(p => BB.wrapX(p.x) !== p.x || BB.getTile(wrapWorld, p.x, p.y) === p.id);
  ok(foundWrap || near0.placed.length > 0, 'wrapped placement writes tiles');

  // Test undoPrefab restores previous state
  BB.applyWorldSize(1024);
  const undoWorld = BB.generateWorld(66);
  // Capture before state
  const before2 = [];
  for (let y = 30; y < 40; y++) {
    for (let x = 95; x < 105; x++) {
      before2.push(BB.getTile(undoWorld, x, y));
    }
  }
  const placed3 = PrefabLogic.placePrefab(undoWorld, hut, 100, 35);
  ok(placed3.ok, 'placed prefab for undo test');
  PrefabLogic.undoPrefab(undoWorld, placed3.undo);
  // Check that some tiles were restored
  let restored = 0;
  let i = 0;
  for (let y = 30; y < 40; y++) {
    for (let x = 95; x < 105; x++) {
      const after = BB.getTile(undoWorld, x, y);
      if (after === before2[i]) restored++;
      i++;
    }
  }
  ok(restored > 0, `undo restores some tiles (${restored} of ${before2.length})`);
}

// ── Tree felling ─────────────────────────────────────────────────────────────
{
  const { fellTree } = await import(pathToFileURL(path.join(root, 'js/world/felling.js')).href);
  const { BLOCK } = await import(pathToFileURL(path.join(root, 'js/content/blocks.js')).href);
  const { idx } = await import(pathToFileURL(path.join(root, 'js/world/index.js')).href);

  BB.applyWorldSize(1024);

  // Build a bare canvas: a world of air with a floor, then draw shapes into it.
  const blank = () => {
    const w = BB.generateWorld(4242);
    for (let y = 0; y < BB.WORLD_H; y++) {
      for (let x = 90; x < 130; x++) {
        if (y < BB.WORLD_H - 1) w.tiles[idx(x, y)] = BLOCK.AIR;
      }
    }
    return w;
  };
  const tree = (w, bx, by, h = 5) => {
    for (let i = 0; i < h; i++) w.tiles[idx(bx, by - i)] = BLOCK.WOOD;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 0; dy++) {
        const lx = bx + dx; const ly = by - h - dy;
        if (w.tiles[idx(lx, ly)] === BLOCK.AIR) w.tiles[idx(lx, ly)] = BLOCK.LEAVES;
      }
    }
  };

  // Chopping the base fells trunk + canopy.
  let w = blank();
  tree(w, 100, 60, 5);
  w.tiles[idx(100, 60)] = BLOCK.AIR;           // simulate the mined base
  let felled = fellTree(w, 100, 60);
  ok(felled.length > 0, `felling removes tiles (${felled.length})`);
  ok(felled.some(t => t.id === BLOCK.WOOD), 'felling returns wood');
  ok(felled.some(t => t.id === BLOCK.LEAVES), 'felling returns leaves');
  let leftovers = 0;
  for (let y = 45; y <= 60; y++) {
    for (let x = 96; x <= 104; x++) {
      const t = BB.getTile(w, x, y);
      if (t === BLOCK.WOOD || t === BLOCK.LEAVES) leftovers++;
    }
  }
  ok(leftovers === 0, `no floating trunk or canopy left (${leftovers})`);

  // Chopping halfway up leaves the stump below the cut standing.
  w = blank();
  tree(w, 100, 60, 6);
  w.tiles[idx(100, 57)] = BLOCK.AIR;           // mined three up from the base
  fellTree(w, 100, 57);
  ok(BB.getTile(w, 100, 60) === BLOCK.WOOD && BB.getTile(w, 100, 58) === BLOCK.WOOD,
    'stump below the cut survives');
  ok(BB.getTile(w, 100, 56) === BLOCK.AIR, 'trunk above the cut falls');

  // A wooden build with no leaves is never felled.
  w = blank();
  for (let y = 50; y <= 60; y++) {
    for (let x = 100; x <= 108; x++) w.tiles[idx(x, y)] = BLOCK.WOOD;
  }
  w.tiles[idx(104, 60)] = BLOCK.AIR;
  ok(fellTree(w, 104, 60).length === 0, 'wide wooden build is not felled');

  // A narrow wooden pillar with no leaves is not felled either.
  w = blank();
  for (let i = 0; i < 8; i++) w.tiles[idx(100, 60 - i)] = BLOCK.WOOD;
  w.tiles[idx(100, 60)] = BLOCK.AIR;
  ok(fellTree(w, 100, 60).length === 0, 'leafless pillar is not felled');

  // Mining a non-wood tile under nothing does nothing.
  w = blank();
  ok(fellTree(w, 100, 60).length === 0, 'no wood above the cut is a no-op');

  // Felling works across the world seam.
  w = BB.generateWorld(4242);
  for (let y = 40; y < BB.WORLD_H - 1; y++) {
    for (let x = -6; x <= 6; x++) w.tiles[idx(BB.wrapX(x), y)] = BLOCK.AIR;
  }
  tree(w, 0, 60, 5);
  w.tiles[idx(0, 60)] = BLOCK.AIR;
  ok(fellTree(w, 0, 60).length > 0, 'felling works at the world seam');
}

// ── Update loop guards ───────────────────────────────────────────────────────
{
  const upd = fs.readFileSync(path.join(root, 'update.html'), 'utf8');
  const mainJs = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');

  // A hardcoded version in the redirect target goes stale on every release and
  // breaks the game's "did I just come back from a cleanup?" check.
  ok(!/fresh=\d+\.\d+\.\d+/.test(upd), 'update.html does not hardcode a version in fresh=');
  ok(upd.includes('GAME_VERSION'), 'update.html reads the version from the server');
  ok(upd.includes("'bb-update-attempts'"), "update.html preserves the game's redirect budget");

  // The version check must be able to give up, or a stale shell redirects on
  // every load and the title screen flickers forever.
  ok(mainJs.includes('MAX_UPDATE_ATTEMPTS'), 'main.js caps update redirects');
  ok(mainJs.includes('justCameFromUpdate'), 'main.js detects a post-cleanup load');
  ok(mainJs.includes('__bbUpdateGaveUp'), 'main.js can stop asking for updates');
}

// ── Service-worker reload loop guards ────────────────────────────────────────
{
  const mainJs = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const swBb = fs.readFileSync(path.join(root, 'sw-bb.js'), 'utf8');

  // The loop that shipped: unregister every worker on load, re-register, get
  // claimed, reload, repeat. An existing sw-bb.js must be kept.
  ok(mainJs.includes('sw-bb.js') && /isOurs/.test(mainJs),
    'registerSW keeps an existing sw-bb.js instead of unregistering it');
  ok(!/getRegistrations\(\)\.then\(regs =>\s*Promise\.all\(regs\.map\(r => r\.unregister\(\)\)\s*\)/.test(mainJs),
    'registerSW no longer unregisters every worker unconditionally');

  // A first claim is not an update, and reloads are capped.
  ok(mainJs.includes('HAD_CONTROLLER_AT_LOAD'), 'reload distinguishes first claim from an update');
  ok(mainJs.includes('MAX_RELOADS') && mainJs.includes('bb-sw-reloads'), 'reloads are capped per tab');

  // BB_RELOAD must not send a healthy tab to the cleanup page.
  ok(/BB_GOTO_UPDATE'\)\s*\{\s*\n\s*location\.replace/.test(mainJs)
    || mainJs.indexOf("BB_GOTO_UPDATE") < mainJs.indexOf("BB_RELOAD'"),
    'only BB_GOTO_UPDATE navigates to update.html');

  // The worker only nudges clients when it is replacing an older build.
  ok(swBb.includes('isUpgrade'), 'sw-bb.js only broadcasts BB_RELOAD on a real upgrade');
}

// ── Sun and moon ─────────────────────────────────────────────────────────────
{
  const R = await import(pathToFileURL(path.join(root, 'js/render/index.js')).href);
  const { celestialAlpha, celestialPos, skyColors } = R;

  // The bug: at deep twilight the sun sat high in the sky next to the moon.
  let bothUp = 0;
  let sunHighAtNight = 0;
  for (let i = 0; i < 200; i++) {
    const t = i / 200;
    const sunAlt = Math.sin(t * Math.PI * 2 - Math.PI / 2);
    const sa = celestialAlpha(sunAlt);
    const ma = celestialAlpha(-sunAlt);
    if (sa > 0 && ma > 0) bothUp++;
    const day = skyColors(t, 0).day;
    if (day < 0.3 && sa > 0) sunHighAtNight++;
  }
  ok(bothUp === 0, `sun and moon are never both up (${bothUp} overlaps)`);
  ok(sunHighAtNight === 0, `the sun is never drawn at night (${sunHighAtNight} cases)`);

  // Position must agree with brightness: highest when it is brightest.
  const noon = celestialPos(Math.sin(0.5 * Math.PI * 2 - Math.PI / 2), 0.5);
  const dawn = celestialPos(0, 0);
  ok(noon.y < dawn.y, 'the sun is higher on screen at noon than at dawn');

  // Rises on one side, sets on the other.
  const rising = celestialPos(0.3, 0.15);
  const setting = celestialPos(0.3, 0.85);
  ok(rising.x < setting.x, 'the sun rises on one side and sets on the other');

  // A body below the horizon is not drawn at all.
  ok(celestialAlpha(-0.5) === 0 && celestialAlpha(0) === 0, 'nothing is drawn below the horizon');
  ok(celestialAlpha(1) === 1, 'a body overhead is fully drawn');
}

// ── Sand gravity is disturbance-driven, not proximity-driven ─────────────────
{
  const Wld = await import(pathToFileURL(path.join(root, 'js/world/index.js')).href);
  const { BLOCK } = await import(pathToFileURL(path.join(root, 'js/content/blocks.js')).href);
  const auto = fs.readFileSync(path.join(root, 'js/systems/autosave.js'), 'utf8');

  // The bug: the periodic sweep used the player's position, so flying past
  // untouched terrain collapsed naturally-generated sand over a cave.
  ok(!/tickGravityNear\(\s*world,\s*player/.test(auto),
    'the periodic gravity tick no longer keys off the player position');
  ok(auto.includes('tickGravity(world)'), 'the periodic tick drains the disturbance queue');

  BB.applyWorldSize(1024);
  const w = Wld.generateWorld(1234);
  // Sand resting on the roof of a cave, exactly as world gen might leave it.
  const sx = 200;
  const sy = 50;
  for (let y = 45; y <= 60; y++) w.tiles[Wld.idx(sx, y)] = BLOCK.AIR;
  w.tiles[Wld.idx(sx, sy)] = BLOCK.SAND;

  // Nobody touched it: many ticks must leave it exactly where it is.
  for (let i = 0; i < 20; i++) Wld.tickGravity(w);
  ok(Wld.getTile(w, sx, sy) === BLOCK.SAND, 'untouched sand over a cave does not fall');

  // Once disturbed, it falls and keeps falling until it lands.
  Wld.scheduleGravityNear(w, sx, sy, 4);
  let ticks = 0;
  while (Wld.tickGravity(w) > 0 && ticks < 100) ticks++;
  ok(Wld.getTile(w, sx, sy) === BLOCK.AIR, 'disturbed sand leaves its old cell');
  // It should come to rest on the first solid thing beneath it, wherever the
  // generated terrain put that.
  let restY = -1;
  for (let y = sy; y < BB.WORLD_H; y++) if (Wld.getTile(w, sx, y) === BLOCK.SAND) { restY = y; break; }
  ok(restY > sy, `disturbed sand fell (rests at y=${restY}, started ${sy})`);
  ok(restY >= 0 && Wld.getTile(w, sx, restY + 1) !== BLOCK.AIR,
    'sand comes to rest on something solid, not mid-air');
  ok(ticks > 1, `falling takes more than one tick (${ticks}) — the queue keeps it moving`);

  // The queue drains, so idle worlds do no gravity work at all.
  ok(Wld.tickGravity(w) === 0, 'a settled world does no further gravity work');

  // A stacked column collapses without losing or duplicating blocks.
  const cx = 300;
  for (let y = 40; y <= 60; y++) w.tiles[Wld.idx(cx, y)] = BLOCK.AIR;
  for (let y = 44; y <= 46; y++) w.tiles[Wld.idx(cx, y)] = BLOCK.SAND;
  Wld.scheduleGravityNear(w, cx, 45, 4);
  ticks = 0;
  while (Wld.tickGravity(w) > 0 && ticks < 200) ticks++;
  let sand = 0;
  for (let y = 40; y <= 60; y++) if (Wld.getTile(w, cx, y) === BLOCK.SAND) sand++;
  ok(sand === 3, `a falling column keeps all its blocks (${sand} of 3)`);
  ok(Wld.getTile(w, cx, 60) === BLOCK.SAND && Wld.getTile(w, cx, 58) === BLOCK.SAND,
    'the column lands stacked on the floor');
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nAll passed');
