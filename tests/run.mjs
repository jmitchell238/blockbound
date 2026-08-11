import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (c, m) => { if (c) console.log('  ✓', m); else { console.error('  ✗', m); failed++; } };

console.log('Blockbound tests\n');

const req = [
  'index.html', 'css/style.css', 'js/config.js', 'js/rng.js', 'js/world.js',
  'js/player.js', 'js/inventory.js', 'js/interact.js', 'js/entities.js',
  'js/textures.js', 'js/particles.js',
  'js/render.js', 'js/input.js', 'js/audio.js',
  'js/save.js', 'js/game.js', 'js/main.js', 'manifest.webmanifest', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'apple-touch-icon.png', 'art/cover.jpg',
  'assets/player/hero.png', 'assets/bg/clouds.png',
  'assets/tiles/grass.png', 'assets/tiles/dirt.png', 'assets/tiles/stone.png',
  'assets/tiles/lava.png', 'assets/tiles/wood.png', 'assets/tiles/atlas.png',
];
for (const f of req) ok(fs.existsSync(path.join(root, f)), `exists ${f}`);

const config = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const ver = config.match(/GAME_VERSION\s*=\s*['"]([^'"]+)['"]/);
ok(!!ver, 'GAME_VERSION');
if (ver) ok(sw.includes(`blockbound-${ver[1]}`), 'SW CACHE sync');
ok(config.includes('WORLD_SIZE_PRESETS') && config.includes('BLOCK'), 'config sizes + blocks');
ok(config.includes('16384') && config.includes('applyWorldSize'), 'epic 16k preset');

const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
ok(man.display === 'standalone', 'manifest standalone');
ok(man.name === 'Blockbound', 'manifest name');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let last = -1;
for (const s of [
  'config.js', 'rng.js', 'world.js', 'player.js', 'inventory.js',
  'interact.js', 'entities.js',
  'textures.js', 'particles.js', 'render.js', 'input.js', 'audio.js',
  'save.js', 'game.js', 'main.js',
]) {
  const i = html.indexOf(s);
  ok(i > last, `order ${s}`);
  last = i;
}

const tex = fs.readFileSync(path.join(root, 'js/textures.js'), 'utf8');
ok(tex.includes('loadTextures') && tex.includes('bakeCube'), 'texture loader + cube bake');
const ren = fs.readFileSync(path.join(root, 'js/render.js'), 'utf8');
ok(ren.includes('getCubeTex') || ren.includes('drawImage'), 'renderer uses images');
ok(ren.includes('drawClouds') && ren.includes('blockAO'), 'clouds + AO');

// Headless world gen + wrap (const/let are not global props — export explicitly)
const sandbox = {
  console,
  Math,
  Uint8Array,
  Int16Array,
  performance: { now: () => 0 },
};
const files = ['js/config.js', 'js/rng.js', 'js/world.js', 'js/inventory.js', 'js/interact.js', 'js/entities.js'];
let code = '';
for (const f of files) code += fs.readFileSync(path.join(root, f), 'utf8') + '\n';
code += `
globalThis.__BB = {
  get WORLD_W() { return WORLD_W; },
  WORLD_H, BLOCK, BLOCK_META, RECIPES, MAGMA_Y, SKY_LIMIT, WORLD_SIZE_PRESETS, FOOD,
  applyWorldSize, wrapX, wrapDeltaX, generateWorld, getTile, setTile, getLight, isSolid,
  serializeWorld, deserializeWorld, markLightDirty, flushLight, recomputeSkyLight,
  makeInventory, addItem, canCraft, craft, countItem, makeWorldMeta, toggleDoor, tileKey,
  tickGravityNear, isPlatform, isGravityBlock, hasLineOfSight, playerIsSheltered,
};
`;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const BB = sandbox.__BB;
ok(!!BB, 'sandbox exports');

// Use Tour size for fast unit tests
BB.applyWorldSize(1024);
ok(BB.WORLD_W === 1024, 'applyWorldSize 1024');

const world = BB.generateWorld(42);
ok(!!world && world.tiles.length === BB.WORLD_W * BB.WORLD_H, 'generateWorld size');
ok(BB.wrapX(-1) === BB.WORLD_W - 1, 'wrapX negative');
ok(BB.wrapX(BB.WORLD_W) === 0, 'wrapX overflow');
const wd = BB.wrapDeltaX(0, BB.WORLD_W - 1);
ok(wd === -1, 'wrapDeltaX shortest path');

// Magma near bottom
let magma = 0;
for (let x = 0; x < BB.WORLD_W; x++) {
  if (BB.getTile(world, x, BB.WORLD_H - 3) === BB.BLOCK.LAVA) magma++;
}
ok(magma > BB.WORLD_W * 0.5, 'magma layer present');

// Bedrock bottom
let bed = 0;
for (let x = 0; x < BB.WORLD_W; x++) {
  if (BB.getTile(world, x, BB.WORLD_H - 1) === BB.BLOCK.BEDROCK) bed++;
}
ok(bed === BB.WORLD_W, 'bedrock floor');

// Local light dirty path
BB.setTile(world, 50, world.surface[50] - 1, BB.BLOCK.TORCH);
ok(world.dirtyLight, 'mark dirty on place');
BB.flushLight(world);
ok(!world.dirtyLight, 'flush clears dirty');
ok(BB.getLight(world, 50, world.surface[50] - 1) >= 8, 'torch light');

// Door open walkthrough
const doorY = world.surface[60];
BB.setTile(world, 60, doorY, BB.BLOCK.DOOR);
world.meta = BB.makeWorldMeta();
ok(BB.isSolid(world, 60, doorY), 'door solid closed');
BB.toggleDoor(world.meta, 60, doorY);
ok(!BB.isSolid(world, 60, doorY), 'door open walkable');

// Food / recipes include furnace smelt
ok(BB.FOOD.apple && BB.RECIPES.some(r => r.id === 'smelt_iron'), 'food + smelt recipes');
ok(BB.BLOCK.PLATFORM && BB.BLOCK.CAMPFIRE, 'platform + campfire blocks');
ok(BB.RECIPES.some(r => r.id === 'boat') && BB.RECIPES.some(r => r.id === 'bucket'), 'boat + bucket recipes');
// Sand gravity
const sandY = world.surface[70] - 2;
BB.setTile(world, 70, sandY, BB.BLOCK.SAND);
BB.setTile(world, 70, sandY + 1, BB.BLOCK.AIR);
const fell = BB.tickGravityNear(world, 70, sandY, 4);
ok(fell >= 1 && BB.getTile(world, 70, sandY + 1) === BB.BLOCK.SAND, 'sand gravity falls');

// Line of sight blocked by solid wall
ok(typeof BB.hasLineOfSight === 'function', 'hasLineOfSight export');
if (typeof BB.hasLineOfSight === 'function') {
  const sx = 80;
  const sy = world.surface[sx];
  // Clear air ray at surface
  ok(BB.hasLineOfSight(world, sx + 0.5, sy - 1, sx + 2.5, sy - 1), 'LOS open air');
  // Place a dirt wall and ensure LOS fails through it
  BB.setTile(world, sx + 1, sy - 1, BB.BLOCK.DIRT);
  ok(!BB.hasLineOfSight(world, sx + 0.5, sy - 1, sx + 2.5, sy - 1), 'LOS blocked by dirt');
}

// Epic size can allocate (smoke, no full gen of 16k in CI if slow — gen Tour+Standard ok)
BB.applyWorldSize(4096);
const t0 = Date.now();
const w4 = BB.generateWorld(7);
const genMs = Date.now() - t0;
ok(w4.tiles.length === 4096 * BB.WORLD_H, 'standard 4096 gen');
ok(genMs < 15000, '4096 gen under 15s (' + genMs + 'ms)');
console.log('  · 4096×' + BB.WORLD_H + ' gen ' + genMs + 'ms');

// Inventory craft planks
const inv = BB.makeInventory();
BB.addItem(inv, BB.BLOCK.WOOD, 2);
ok(BB.canCraft(inv, BB.RECIPES[0]), 'can craft planks');
ok(BB.craft(inv, BB.RECIPES[0]), 'craft planks');
ok(BB.countItem(inv, BB.BLOCK.PLANKS) === 4, 'planks count');

// Serialize roundtrip
const ser = BB.serializeWorld(world);
const world2 = BB.deserializeWorld(ser);
ok(!!world2, 'deserialize world');
ok(world2.tiles[100] === world.tiles[100], 'tiles match after RLE');

const worldJs = fs.readFileSync(path.join(root, 'js/world.js'), 'utf8');
ok(worldJs.includes('wrapX') && worldJs.includes('MAGMA'), 'wrapping + magma in world');

const playerJs = fs.readFileSync(path.join(root, 'js/player.js'), 'utf8');
ok(playerJs.includes('SKY_LIMIT') && playerJs.includes('tryPlace'), 'sky limit + place');

console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
