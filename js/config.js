'use strict';

// Blockbound — keep CACHE in sw.js in sync: 'blockbound-' + GAME_VERSION
const GAME_VERSION = '1.5.003';
const GAME_VERSION_LABEL = 'v' + GAME_VERSION;
const GAME_NAME = 'Blockbound';

const W = 390;
const H = 700;
const SAVE_KEY = 'blockbound-save-v4';

/** Logical tile size in pixels (render scale can differ slightly). */
const TILE = 28;

/**
 * Horizontal circumference presets (blocks). World wraps — walk long enough and you loop.
 * Original The Blockheads single-player: 16,384 wide × ~1,024 tall.
 * Walk speed ≈ 5.5 tiles/s → rough one-way lap times below.
 */
const WORLD_SIZE_PRESETS = [
  { id: 'tour',     name: 'Tour',     w: 1024,  blurb: '~3 min lap',   default: false },
  { id: 'standard', name: 'Standard', w: 4096,  blurb: '~12 min lap',  default: true },
  { id: 'vast',     name: 'Vast',     w: 8192,  blurb: '~25 min lap',  default: false },
  { id: 'epic',     name: 'Epic',     w: 16384, blurb: 'Blockheads 1×', default: false },
];

/** Mutable so New World size / load can change circumference without rewrite. */
let WORLD_W = 4096;
const WORLD_H = 128;

function applyWorldSize(w) {
  const n = w | 0;
  const allowed = WORLD_SIZE_PRESETS.some(p => p.w === n);
  WORLD_W = allowed ? n : 4096;
  return WORLD_W;
}

function worldSizePreset(idOrW) {
  return WORLD_SIZE_PRESETS.find(p => p.id === idOrW || p.w === idOrW)
    || WORLD_SIZE_PRESETS.find(p => p.default)
    || WORLD_SIZE_PRESETS[1];
}

/** Approximate sea / surface band (from top). */
const SURFACE_Y = 36;
/** Magma starts near the bottom (impassable heat zone). */
const MAGMA_Y = WORLD_H - 8;
/** Hard sky ceiling — cannot place/fly above this (y = 0 is space edge). */
const SKY_LIMIT = 2;

/** Light update radius (tiles) around edits — keeps thousands-wide worlds smooth. */
const LIGHT_RADIUS = 14;

const GRAVITY = 2100;
const MOVE_SPEED = 155;
const JUMP_VEL = -540;
const MAX_FALL = 900;
const COYOTE = 0.1;
const JUMP_BUFFER = 0.12;
const REACH = 4.2; // tiles

/** Day length in seconds (full cycle). */
const DAY_LEN = 480;

const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  COAL: 7,
  IRON: 8,
  GOLD: 9,
  LAVA: 10,
  BEDROCK: 11,
  WATER: 12,
  SNOW: 13,
  CLAY: 14,
  LADDER: 15,
  TORCH: 16,
  WORKBENCH: 17,
  PLANKS: 18,
  GLASS: 19,
  BRICK: 20,
  COPPER: 21,
  DOOR: 22,
  BED: 23,
  CHEST: 24,
  FURNACE: 25,
  PLATFORM: 26,
  CAMPFIRE: 27,
};

const BLOCK_META = {
  [BLOCK.AIR]:       { name: 'Air', solid: false, mine: 0, drops: null, color: null },
  [BLOCK.GRASS]:     { name: 'Grass', solid: true, mine: 0.35, drops: BLOCK.DIRT, color: '#5a9e3a', top: '#6fbf45' },
  [BLOCK.DIRT]:      { name: 'Dirt', solid: true, mine: 0.35, drops: BLOCK.DIRT, color: '#8b5a2b', top: '#9a6a3a' },
  [BLOCK.STONE]:     { name: 'Stone', solid: true, mine: 0.9, drops: BLOCK.STONE, color: '#7a7f88', top: '#8e949e' },
  [BLOCK.SAND]:      { name: 'Sand', solid: true, mine: 0.3, drops: BLOCK.SAND, color: '#e0c878', top: '#edd89a', gravity: true },
  [BLOCK.WOOD]:      { name: 'Wood', solid: true, mine: 0.55, drops: BLOCK.WOOD, color: '#8b5a2b', top: '#a06a38', face: '#6e4520' },
  [BLOCK.LEAVES]:    { name: 'Leaves', solid: false, mine: 0.2, drops: BLOCK.LEAVES, color: '#3d8c3a', top: '#4eaa48', alpha: 0.92, fruitChance: 0.12 },
  [BLOCK.COAL]:      { name: 'Coal Ore', solid: true, mine: 1.1, drops: BLOCK.COAL, color: '#3a3a3a', spark: '#1a1a1a' },
  [BLOCK.IRON]:      { name: 'Iron Ore', solid: true, mine: 1.4, drops: BLOCK.IRON, color: '#8a7a70', spark: '#d4a574' },
  [BLOCK.GOLD]:      { name: 'Gold Ore', solid: true, mine: 1.6, drops: BLOCK.GOLD, color: '#9a8a50', spark: '#ffd700' },
  [BLOCK.LAVA]:      { name: 'Magma', solid: true, mine: 99, drops: null, color: '#ff4500', top: '#ff6a00', hazard: true },
  [BLOCK.BEDROCK]:   { name: 'Bedrock', solid: true, mine: 99, drops: null, color: '#1a1a22' },
  [BLOCK.WATER]:     { name: 'Water', solid: false, mine: 0, drops: null, color: '#3a8fd4', alpha: 0.55, fluid: true },
  [BLOCK.SNOW]:      { name: 'Snow', solid: true, mine: 0.25, drops: BLOCK.SNOW, color: '#eef6ff', top: '#ffffff', gravity: true },
  [BLOCK.CLAY]:      { name: 'Clay', solid: true, mine: 0.4, drops: BLOCK.CLAY, color: '#a07868', top: '#b08878' },
  [BLOCK.LADDER]:    { name: 'Ladder', solid: false, mine: 0.2, drops: BLOCK.LADDER, color: '#c4a060', climb: true },
  [BLOCK.TORCH]:     { name: 'Torch', solid: false, mine: 0.1, drops: BLOCK.TORCH, color: '#ffcc44', light: 8 },
  [BLOCK.WORKBENCH]: { name: 'Workbench', solid: true, mine: 0.5, drops: BLOCK.WORKBENCH, color: '#a07040', top: '#c09050', interact: 'craft' },
  [BLOCK.PLANKS]:    { name: 'Planks', solid: true, mine: 0.4, drops: BLOCK.PLANKS, color: '#c49a5a', top: '#d4aa6a' },
  [BLOCK.GLASS]:     { name: 'Glass', solid: true, mine: 0.25, drops: BLOCK.GLASS, color: '#a8d8ff', alpha: 0.45 },
  [BLOCK.BRICK]:     { name: 'Brick', solid: true, mine: 0.8, drops: BLOCK.BRICK, color: '#b05040', top: '#c06050' },
  [BLOCK.COPPER]:    { name: 'Copper Ore', solid: true, mine: 1.2, drops: BLOCK.COPPER, color: '#8a6a50', spark: '#e07a40' },
  [BLOCK.DOOR]:      { name: 'Door', solid: true, mine: 0.45, drops: BLOCK.DOOR, color: '#a07840', top: '#c09858', interact: 'door' },
  [BLOCK.BED]:       { name: 'Bed', solid: true, mine: 0.4, drops: BLOCK.BED, color: '#c45a6a', top: '#e87890', interact: 'bed' },
  [BLOCK.CHEST]:     { name: 'Chest', solid: true, mine: 0.5, drops: BLOCK.CHEST, color: '#b8863a', top: '#d4a04a', interact: 'chest' },
  [BLOCK.FURNACE]:   { name: 'Furnace', solid: true, mine: 0.7, drops: BLOCK.FURNACE, color: '#5a5a62', top: '#6e6e78', interact: 'furnace', light: 4 },
  [BLOCK.PLATFORM]:  { name: 'Platform', solid: true, mine: 0.25, drops: BLOCK.PLATFORM, color: '#c4a060', top: '#d4b070', platform: true },
  [BLOCK.CAMPFIRE]:  { name: 'Campfire', solid: false, mine: 0.3, drops: BLOCK.CAMPFIRE, color: '#8b4513', light: 10, interact: 'campfire' },
};

/** Tool power multiplies mining speed. Weapons also have damage + reach. */
const TOOLS = {
  hand:      { id: 'hand', name: 'Hands', power: 1, durability: Infinity, damage: 9, reach: 1.65 },
  wood_pick: { id: 'wood_pick', name: 'Wood Pickaxe', power: 2.2, durability: 80, mineBonus: [BLOCK.STONE, BLOCK.COAL, BLOCK.COPPER], damage: 6, reach: 1.5 },
  stone_pick:{ id: 'stone_pick', name: 'Stone Pickaxe', power: 3.5, durability: 160, mineBonus: [BLOCK.STONE, BLOCK.COAL, BLOCK.IRON, BLOCK.COPPER], damage: 7, reach: 1.5 },
  iron_pick: { id: 'iron_pick', name: 'Iron Pickaxe', power: 5.5, durability: 320, mineBonus: [BLOCK.STONE, BLOCK.COAL, BLOCK.IRON, BLOCK.GOLD, BLOCK.COPPER], damage: 8, reach: 1.5 },
  gold_pick: { id: 'gold_pick', name: 'Gold Pickaxe', power: 7.5, durability: 200, mineBonus: [BLOCK.STONE, BLOCK.COAL, BLOCK.IRON, BLOCK.GOLD, BLOCK.COPPER], damage: 7, reach: 1.5 },
  wood_axe:  { id: 'wood_axe', name: 'Wood Axe', power: 2.5, durability: 80, mineBonus: [BLOCK.WOOD, BLOCK.LEAVES, BLOCK.PLANKS, BLOCK.DOOR, BLOCK.CHEST], damage: 7, reach: 1.5 },
  stone_axe: { id: 'stone_axe', name: 'Stone Axe', power: 3.8, durability: 160, mineBonus: [BLOCK.WOOD, BLOCK.LEAVES, BLOCK.PLANKS, BLOCK.DOOR, BLOCK.CHEST], damage: 8, reach: 1.5 },
  iron_axe:  { id: 'iron_axe', name: 'Iron Axe', power: 5.2, durability: 300, mineBonus: [BLOCK.WOOD, BLOCK.LEAVES, BLOCK.PLANKS, BLOCK.DOOR, BLOCK.CHEST, BLOCK.BED], damage: 9, reach: 1.5 },
  // Swords — for fighting (swipe / Attack button)
  wood_sword:  { id: 'wood_sword', name: 'Wood Sword', power: 1.2, durability: 100, damage: 12, reach: 2.0, weapon: true },
  stone_sword: { id: 'stone_sword', name: 'Stone Sword', power: 1.3, durability: 180, damage: 16, reach: 2.1, weapon: true },
  iron_sword:  { id: 'iron_sword', name: 'Iron Sword', power: 1.4, durability: 350, damage: 22, reach: 2.25, weapon: true },
};

/** Food: eat with F when selected. hunger restore + optional heal. */
const FOOD = {
  apple: { name: 'Apple', hunger: 28, heal: 6, color: '#e74c3c' },
  bread: { name: 'Bread', hunger: 45, heal: 12, color: '#d4a060' },
  stew:  { name: 'Hearty Stew', hunger: 70, heal: 25, color: '#c07040' },
};

/** Furnace smelts (ore → ingot). Needs coal fuel in inventory when crafting at furnace. */
const SMELTS = [
  { in: BLOCK.IRON, out: 'iron_ingot', fuel: BLOCK.COAL },
  { in: BLOCK.GOLD, out: 'gold_ingot', fuel: BLOCK.COAL },
  { in: BLOCK.COPPER, out: 'copper_ingot', fuel: BLOCK.COAL },
  { in: BLOCK.SAND, out: BLOCK.GLASS, fuel: BLOCK.COAL, outCount: 1 },
  { in: BLOCK.CLAY, out: BLOCK.BRICK, fuel: BLOCK.COAL, outCount: 1 },
];

/** Crafting recipes. station: 'hand' | 'workbench' | 'furnace' */
const RECIPES = [
  { id: 'planks', name: 'Planks ×4', station: 'hand', in: [[BLOCK.WOOD, 1]], out: [BLOCK.PLANKS, 4] },
  { id: 'stick', name: 'Sticks ×4', station: 'hand', in: [[BLOCK.PLANKS, 1]], out: ['stick', 4] },
  { id: 'torch', name: 'Torch ×4', station: 'hand', in: [['stick', 1], [BLOCK.COAL, 1]], out: [BLOCK.TORCH, 4] },
  { id: 'ladder', name: 'Ladder ×4', station: 'hand', in: [['stick', 3]], out: [BLOCK.LADDER, 4] },
  { id: 'platform', name: 'Platform ×4', station: 'hand', in: [[BLOCK.PLANKS, 1]], out: [BLOCK.PLATFORM, 4] },
  { id: 'workbench', name: 'Workbench', station: 'hand', in: [[BLOCK.PLANKS, 4]], out: [BLOCK.WORKBENCH, 1] },
  { id: 'chest', name: 'Chest', station: 'hand', in: [[BLOCK.PLANKS, 6]], out: [BLOCK.CHEST, 1] },
  { id: 'door', name: 'Door', station: 'hand', in: [[BLOCK.PLANKS, 6]], out: [BLOCK.DOOR, 1] },
  { id: 'campfire', name: 'Campfire', station: 'hand', in: [['stick', 4], [BLOCK.COAL, 1]], out: [BLOCK.CAMPFIRE, 1] },
  { id: 'bed', name: 'Bed', station: 'workbench', in: [[BLOCK.PLANKS, 3], [BLOCK.LEAVES, 3]], out: [BLOCK.BED, 1] },
  { id: 'furnace', name: 'Furnace', station: 'workbench', in: [[BLOCK.STONE, 8]], out: [BLOCK.FURNACE, 1] },
  { id: 'boat', name: 'Boat', station: 'workbench', in: [[BLOCK.PLANKS, 5]], out: ['boat', 1] },
  { id: 'bucket', name: 'Bucket', station: 'workbench', in: [['iron_ingot', 3]], out: ['bucket', 1] },
  { id: 'bucket_water', name: 'Water Bucket', station: 'hand', in: [], out: ['bucket_water', 1], hidden: true },
  { id: 'wood_pick', name: 'Wood Pickaxe', station: 'workbench', in: [[BLOCK.PLANKS, 3], ['stick', 2]], out: ['wood_pick', 1] },
  { id: 'wood_axe', name: 'Wood Axe', station: 'workbench', in: [[BLOCK.PLANKS, 3], ['stick', 2]], out: ['wood_axe', 1] },
  { id: 'wood_sword', name: 'Wood Sword', station: 'workbench', in: [[BLOCK.PLANKS, 2], ['stick', 1]], out: ['wood_sword', 1] },
  { id: 'stone_pick', name: 'Stone Pickaxe', station: 'workbench', in: [[BLOCK.STONE, 3], ['stick', 2]], out: ['stone_pick', 1] },
  { id: 'stone_axe', name: 'Stone Axe', station: 'workbench', in: [[BLOCK.STONE, 3], ['stick', 2]], out: ['stone_axe', 1] },
  { id: 'stone_sword', name: 'Stone Sword', station: 'workbench', in: [[BLOCK.STONE, 2], ['stick', 1]], out: ['stone_sword', 1] },
  { id: 'iron_pick', name: 'Iron Pickaxe', station: 'workbench', in: [['iron_ingot', 3], ['stick', 2]], out: ['iron_pick', 1] },
  { id: 'iron_axe', name: 'Iron Axe', station: 'workbench', in: [['iron_ingot', 3], ['stick', 2]], out: ['iron_axe', 1] },
  { id: 'iron_sword', name: 'Iron Sword', station: 'workbench', in: [['iron_ingot', 2], ['stick', 1]], out: ['iron_sword', 1] },
  { id: 'gold_pick', name: 'Gold Pickaxe', station: 'workbench', in: [['gold_ingot', 3], ['stick', 2]], out: ['gold_pick', 1] },
  { id: 'bread', name: 'Bread', station: 'hand', in: [['apple', 2], [BLOCK.LEAVES, 1]], out: ['bread', 1] },
  { id: 'stew', name: 'Hearty Stew', station: 'furnace', in: [['apple', 2], [BLOCK.CLAY, 1], [BLOCK.COAL, 1]], out: ['stew', 1] },
  { id: 'smelt_iron', name: 'Iron Ingot', station: 'furnace', in: [[BLOCK.IRON, 1], [BLOCK.COAL, 1]], out: ['iron_ingot', 1] },
  { id: 'smelt_gold', name: 'Gold Ingot', station: 'furnace', in: [[BLOCK.GOLD, 1], [BLOCK.COAL, 1]], out: ['gold_ingot', 1] },
  { id: 'smelt_copper', name: 'Copper Ingot', station: 'furnace', in: [[BLOCK.COPPER, 1], [BLOCK.COAL, 1]], out: ['copper_ingot', 1] },
  { id: 'glass', name: 'Glass', station: 'furnace', in: [[BLOCK.SAND, 1], [BLOCK.COAL, 1]], out: [BLOCK.GLASS, 1] },
  { id: 'brick', name: 'Brick', station: 'furnace', in: [[BLOCK.CLAY, 1], [BLOCK.COAL, 1]], out: [BLOCK.BRICK, 1] },
];

const ITEM_NAMES = {
  stick: 'Stick',
  wood_pick: 'Wood Pickaxe',
  stone_pick: 'Stone Pickaxe',
  iron_pick: 'Iron Pickaxe',
  gold_pick: 'Gold Pickaxe',
  wood_axe: 'Wood Axe',
  stone_axe: 'Stone Axe',
  iron_axe: 'Iron Axe',
  wood_sword: 'Wood Sword',
  stone_sword: 'Stone Sword',
  iron_sword: 'Iron Sword',
  apple: 'Apple',
  bread: 'Bread',
  stew: 'Hearty Stew',
  iron_ingot: 'Iron Ingot',
  gold_ingot: 'Gold Ingot',
  copper_ingot: 'Copper Ingot',
  boat: 'Boat',
  bucket: 'Bucket',
  bucket_water: 'Water Bucket',
};

const BIOME_NAMES = ['Forest', 'Desert', 'Snow', 'Plains'];

const MILESTONES = {
  first_mine: 'First block mined!',
  first_craft: 'First craft!',
  first_tool: 'Tool time!',
  first_torch: 'Let there be light!',
  first_bed: 'Home sweet bed!',
  first_furnace: 'Fired up the furnace!',
  deep_dig: 'Deep underground…',
  loop: 'Circumnavigated the world! 🌍',
  fed: 'A proper meal!',
  first_boat: 'Set sail!',
  first_platform: 'Skywalk ready!',
  survived_night: 'Survived the night!',
  first_campfire: 'Warmth!',
  first_sword: 'Armed and ready!',
  first_kill: 'Monster down!',
};

function isWeapon(id) {
  return !!(TOOLS[id] && TOOLS[id].weapon);
}

function getHeldTool(inv) {
  const s = selectedSlot(inv);
  if (s && TOOLS[s.id]) return TOOLS[s.id];
  if (inv.tool && TOOLS[inv.tool]) return TOOLS[inv.tool];
  return TOOLS.hand;
}

/** What you fight with: selected tool/weapon, otherwise bare fists (not the last pickaxe). */
function getMeleeWeapon(inv) {
  const s = selectedSlot(inv);
  if (s && TOOLS[s.id]) return TOOLS[s.id];
  // Holding a block, food, empty slot, etc. → punch with hands
  return TOOLS.hand;
}

function isPlatform(id) {
  return id === BLOCK.PLATFORM || !!(BLOCK_META[id] && BLOCK_META[id].platform);
}

function isGravityBlock(id) {
  return !!(BLOCK_META[id] && BLOCK_META[id].gravity);
}

function itemName(id) {
  if (typeof id === 'number') return (BLOCK_META[id] && BLOCK_META[id].name) || 'Item';
  if (FOOD[id]) return FOOD[id].name;
  return ITEM_NAMES[id] || String(id);
}

function isTool(id) {
  return typeof id === 'string' && !!TOOLS[id];
}

function isFood(id) {
  return typeof id === 'string' && !!FOOD[id];
}

function isBlockItem(id) {
  return typeof id === 'number' && id > 0 && BLOCK_META[id];
}

function tileKey(x, y) {
  // WORLD_W may change; prefer wrap at call site when available
  const w = (typeof WORLD_W === 'number' && WORLD_W > 0) ? WORLD_W : 4096;
  const wx = ((x % w) + w) % w;
  return wx + ',' + (y | 0);
}
