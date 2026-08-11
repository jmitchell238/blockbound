import { BLOCK } from './blocks.js';

/** Furnace smelts (ore → ingot). Needs coal fuel in inventory when crafting at furnace. */
export const SMELTS = [
  { in: BLOCK.IRON, out: 'iron_ingot', fuel: BLOCK.COAL },
  { in: BLOCK.GOLD, out: 'gold_ingot', fuel: BLOCK.COAL },
  { in: BLOCK.COPPER, out: 'copper_ingot', fuel: BLOCK.COAL },
  { in: BLOCK.SAND, out: BLOCK.GLASS, fuel: BLOCK.COAL, outCount: 1 },
  { in: BLOCK.CLAY, out: BLOCK.BRICK, fuel: BLOCK.COAL, outCount: 1 },
];

/** Crafting recipes. station: 'hand' | 'workbench' | 'furnace' */
export const RECIPES = [
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
