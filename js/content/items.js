import { BLOCK_META, isBlockItem, isPlatform, isGravityBlock } from './blocks.js';
import { FOOD, ITEM_NAMES, isTool, isFood, isWeapon } from './tools.js';
import { WORLD_W } from '../core/worldSize.js';

export { isBlockItem, isPlatform, isGravityBlock, isTool, isFood, isWeapon };

export function itemName(id) {
  if (typeof id === 'number') return (BLOCK_META[id] && BLOCK_META[id].name) || 'Item';
  if (FOOD[id]) return FOOD[id].name;
  return ITEM_NAMES[id] || String(id);
}

export function tileKey(x, y) {
  const w = (typeof WORLD_W === 'number' && WORLD_W > 0) ? WORLD_W : 4096;
  const wx = ((x % w) + w) % w;
  return wx + ',' + (y | 0);
}
