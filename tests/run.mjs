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
  // The kids chip must be drawn outside the pointer-type-gated touch block.
  const chipAt = renSrc3.indexOf("ctx.fillText('KIDS MODE'");
  const touchAt = renSrc3.indexOf('if (ui.showTouch) {');
  ok(chipAt > 0 && touchAt > 0 && chipAt < touchAt,
    'kids chip is drawn independently of ui.showTouch');
  ok(renSrc3.split("ctx.fillText('KIDS MODE'").length - 1 === 1,
    'kids chip is drawn exactly once');

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
  ok(/ui\._infoBottom = /.test(renSrc5), 'HUD publishes where the info stack ends');
  const chip = renSrc5.slice(renSrc5.indexOf("if (ui.controlMode === 'kids') {"),
                             renSrc5.indexOf("if (ui.showTouch) {"));
  ok(!/H - 128/.test(chip),
    'kids chip no longer sits in the bottom-left band the chrome row owns');
  ok(/ui\._infoBottom/.test(chip), 'kids chip anchors under the info stack');

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

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nAll passed');
