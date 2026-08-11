import { BLOCK } from './blocks.js';

/** Tool power multiplies mining speed. Weapons also have damage + reach. */
export const TOOLS = {
  hand:      { id: 'hand', name: 'Hands', power: 1, durability: Infinity, damage: 9, reach: 1.65 },
  wood_pick: { id: 'wood_pick', name: 'Wood Pickaxe', power: 2.2, durability: 80, mineBonus: [BLOCK.STONE, BLOCK.COAL, BLOCK.COPPER], damage: 6, reach: 1.5 },
  stone_pick:{ id: 'stone_pick', name: 'Stone Pickaxe', power: 3.5, durability: 160, mineBonus: [BLOCK.STONE, BLOCK.COAL, BLOCK.IRON, BLOCK.COPPER], damage: 7, reach: 1.5 },
  iron_pick: { id: 'iron_pick', name: 'Iron Pickaxe', power: 5.5, durability: 320, mineBonus: [BLOCK.STONE, BLOCK.COAL, BLOCK.IRON, BLOCK.GOLD, BLOCK.COPPER], damage: 8, reach: 1.5 },
  gold_pick: { id: 'gold_pick', name: 'Gold Pickaxe', power: 7.5, durability: 200, mineBonus: [BLOCK.STONE, BLOCK.COAL, BLOCK.IRON, BLOCK.GOLD, BLOCK.COPPER], damage: 7, reach: 1.5 },
  wood_axe:  { id: 'wood_axe', name: 'Wood Axe', power: 2.5, durability: 80, mineBonus: [BLOCK.WOOD, BLOCK.LEAVES, BLOCK.PLANKS, BLOCK.DOOR, BLOCK.CHEST], damage: 7, reach: 1.5 },
  stone_axe: { id: 'stone_axe', name: 'Stone Axe', power: 3.8, durability: 160, mineBonus: [BLOCK.WOOD, BLOCK.LEAVES, BLOCK.PLANKS, BLOCK.DOOR, BLOCK.CHEST], damage: 8, reach: 1.5 },
  iron_axe:  { id: 'iron_axe', name: 'Iron Axe', power: 5.2, durability: 300, mineBonus: [BLOCK.WOOD, BLOCK.LEAVES, BLOCK.PLANKS, BLOCK.DOOR, BLOCK.CHEST, BLOCK.BED], damage: 9, reach: 1.5 },
  wood_sword:  { id: 'wood_sword', name: 'Wood Sword', power: 1.2, durability: 100, damage: 12, reach: 2.0, weapon: true },
  stone_sword: { id: 'stone_sword', name: 'Stone Sword', power: 1.3, durability: 180, damage: 16, reach: 2.1, weapon: true },
  iron_sword:  { id: 'iron_sword', name: 'Iron Sword', power: 1.4, durability: 350, damage: 22, reach: 2.25, weapon: true },
};

/** Food: eat with F when selected. hunger restore + optional heal. */
export const FOOD = {
  apple: { name: 'Apple', hunger: 28, heal: 6, color: '#e74c3c' },
  bread: { name: 'Bread', hunger: 45, heal: 12, color: '#d4a060' },
  stew:  { name: 'Hearty Stew', hunger: 70, heal: 25, color: '#c07040' },
};

export const ITEM_NAMES = {
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

export function isWeapon(id) {
  return !!(TOOLS[id] && TOOLS[id].weapon);
}

export function isTool(id) {
  return typeof id === 'string' && !!TOOLS[id];
}

export function isFood(id) {
  return typeof id === 'string' && !!FOOD[id];
}
