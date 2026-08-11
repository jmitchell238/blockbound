import { BLOCK } from '../content/blocks.js';
import { RECIPES } from '../content/recipes.js';
import { isTool, isWeapon } from '../content/tools.js';
import { countItem } from '../inventory/inventory.js';
import { nearBlock } from './use.js';

export const CRAFT_TABS = [
  { id: 'all', label: 'All' },
  { id: 'basic', label: 'Basic' },
  { id: 'tools', label: 'Tools' },
  { id: 'smelt', label: 'Smelt' },
];

export function stationAvailable(world, px, py, station) {
  if (station === 'hand') return true;
  if (station === 'workbench') return !!nearBlock(world, px, py, BLOCK.WORKBENCH, 3);
  if (station === 'furnace') return !!nearBlock(world, px, py, BLOCK.FURNACE, 3);
  return false;
}

export function availableRecipesAt(inv, world, px, py) {
  return allRecipesForUi(world, px, py)
    .filter(row => row.stationOk)
    .map(row => row.recipe);
}

/** @deprecated alias — use availableRecipesAt */
export function availableRecipes(inv, world, px, py) {
  return availableRecipesAt(inv, world, px, py);
}

export function recipeTabId(r) {
  if (r.station === 'furnace') return 'smelt';
  if (r.station === 'workbench' || isTool(r.out[0]) || isWeapon(r.out[0])) return 'tools';
  return 'basic';
}

export function allRecipesForUi(world, px, py) {
  const atBench = stationAvailable(world, px, py, 'workbench');
  const atFurn = stationAvailable(world, px, py, 'furnace');
  return RECIPES.filter(r => !r.hidden).map(r => {
    let stationOk = false;
    if (r.station === 'hand') stationOk = true;
    else if (r.station === 'workbench') stationOk = atBench;
    else if (r.station === 'furnace') stationOk = atFurn;
    return { recipe: r, stationOk };
  });
}

export function recipesInTab(tabId, world, px, py) {
  const all = allRecipesForUi(world, px, py);
  if (tabId === 'all') return all;
  return all.filter(row => recipeTabId(row.recipe) === tabId);
}

export function missingMaterials(inv, recipe) {
  const miss = [];
  for (const [id, n] of recipe.in) {
    const have = countItem(inv, id);
    if (have < n) miss.push({ id, need: n, have });
  }
  return miss;
}

export function stationHint(station) {
  if (station === 'workbench') return 'Place a Workbench nearby';
  if (station === 'furnace') return 'Place a Furnace nearby';
  return '';
}
