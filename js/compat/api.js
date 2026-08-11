/**
 * Test / tooling façade — named surface expected by tests/run.mjs.
 * Prefer importing domain modules directly in app code.
 */
export {
  GAME_VERSION, GAME_VERSION_LABEL, WORLD_H, MAGMA_Y, SKY_LIMIT,
  W, H, ORIENTATION, applyViewport, LIBRARY_KEY,
} from '../core/constants.js';
export { WORLD_W, WORLD_SIZE_PRESETS, applyWorldSize, worldSizePreset } from '../core/worldSize.js';
export { parseSeed, hashStringToSeed, randomSeed, formatSeedDisplay } from '../core/seed.js';
export {
  DIFFICULTIES, DIFFICULTY_IDS, getDifficulty, canSprint,
  hungerDrainPerSec, starveHpPerSec, applyStarterKit, creativeCatalog,
} from '../core/difficulty.js';
export { BLOCK, BLOCK_META, BIOME_NAMES, isPlatform, isGravityBlock, isBlockItem } from '../content/blocks.js';
export { FOOD, TOOLS, isTool, isFood, isWeapon } from '../content/tools.js';
export { RECIPES, SMELTS } from '../content/recipes.js';
export { MILESTONES } from '../content/milestones.js';
export { tileKey, itemName } from '../content/items.js';
export {
  wrapX, wrapDeltaX, generateWorld, generateWorldAsync, getTile, setTile, getLight,
  isSolid, serializeWorld, deserializeWorld, markLightDirty, flushLight,
  recomputeSkyLight, tickGravityNear,
} from '../world/index.js';
export {
  makeInventory, addItem, canCraft, craft, countItem, removeItem, selectedSlot,
} from '../inventory/inventory.js';
export {
  makeWorldMeta, toggleDoor, isDoorOpen, getChest,
  hasLineOfSight, playerIsSheltered,
} from './entities_bridge.js';
