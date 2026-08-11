/**
 * Difficulty / game-mode profiles for Blockbound.
 *
 * Hunger times are wall-clock seconds to empty a full bar at the base drain rate
 * (movement nudges rate slightly around that target).
 */
import { BLOCK } from '../content/blocks.js';
import { TOOLS, FOOD } from '../content/tools.js';
import { addItem } from '../inventory/inventory.js';

export const DIFFICULTY_IDS = ['creative', 'easy', 'normal', 'hard'];

/** @typedef {'creative'|'easy'|'normal'|'hard'} DifficultyId */

/**
 * @typedef {Object} DifficultyProfile
 * @property {DifficultyId} id
 * @property {string} name
 * @property {string} blurb
 * @property {boolean} creative
 * @property {boolean} invincible
 * @property {boolean} hostiles
 * @property {number|null} hungerDrainSec  seconds to empty full hunger (null = no drain)
 * @property {boolean} starveDamagesHp
 * @property {number|null} starveHpSec     seconds to empty full HP while starving
 * @property {number} mobDamageMul
 * @property {number} playerDamageMul
 * @property {number} sprintMinHungerFrac  hunger/max must be > this to sprint (0 = empty blocks sprint)
 */

/** @type {Record<DifficultyId, DifficultyProfile>} */
export const DIFFICULTIES = {
  creative: {
    id: 'creative',
    name: 'Creative',
    blurb: 'Build freely · no death',
    creative: true,
    invincible: true,
    hostiles: false,
    hungerDrainSec: null,
    starveDamagesHp: false,
    starveHpSec: null,
    mobDamageMul: 0,
    playerDamageMul: 1,
    sprintMinHungerFrac: -1, // always sprint
  },
  easy: {
    id: 'easy',
    name: 'Easy',
    blurb: 'Soft mobs · slow hunger',
    creative: false,
    invincible: false,
    hostiles: true,
    hungerDrainSec: 600, // ~10 min full bar
    starveDamagesHp: false,
    starveHpSec: null,
    mobDamageMul: 0.35,
    playerDamageMul: 1.85,
    sprintMinHungerFrac: 0, // empty hunger blocks sprint
  },
  normal: {
    id: 'normal',
    name: 'Normal',
    blurb: 'Classic survival',
    creative: false,
    invincible: false,
    hostiles: true,
    hungerDrainSec: 600, // ~10 min full bar
    starveDamagesHp: true,
    starveHpSec: 600, // ~10 min HP drain while starving
    mobDamageMul: 1,
    playerDamageMul: 1,
    sprintMinHungerFrac: 0,
  },
  hard: {
    id: 'hard',
    name: 'Hard',
    blurb: 'Harsh · empty pockets',
    creative: false,
    invincible: false,
    hostiles: true,
    hungerDrainSec: 300, // ~5 min full bar
    starveDamagesHp: true,
    starveHpSec: 300, // ~5 min HP drain while starving
    mobDamageMul: 1.55,
    playerDamageMul: 0.6,
    sprintMinHungerFrac: 0.25, // lost 75% → no sprint
  },
};

/** @param {string} [id] */
export function getDifficulty(id) {
  if (id && DIFFICULTIES[id]) return DIFFICULTIES[id];
  return DIFFICULTIES.normal;
}

/**
 * Can the player sprint at this hunger level?
 * @param {DifficultyProfile} diff
 * @param {number} hunger
 * @param {number} maxHunger
 */
export function canSprint(diff, hunger, maxHunger) {
  if (!diff) return hunger > 0;
  if (diff.creative || diff.sprintMinHungerFrac < 0) return true;
  const max = maxHunger > 0 ? maxHunger : 100;
  const frac = Math.max(0, hunger) / max;
  return frac > diff.sprintMinHungerFrac;
}

/**
 * Hunger points drained per second (base). Moving multiplies slightly.
 * @param {DifficultyProfile} diff
 * @param {number} maxHunger
 */
export function hungerDrainPerSec(diff, maxHunger) {
  if (!diff || diff.hungerDrainSec == null || diff.hungerDrainSec <= 0) return 0;
  const max = maxHunger > 0 ? maxHunger : 100;
  return max / diff.hungerDrainSec;
}

/**
 * HP lost per second while hunger is empty (when starveDamagesHp).
 * @param {DifficultyProfile} diff
 * @param {number} maxHp
 */
export function starveHpPerSec(diff, maxHp) {
  if (!diff || !diff.starveDamagesHp || diff.starveHpSec == null || diff.starveHpSec <= 0) return 0;
  const max = maxHp > 0 ? maxHp : 100;
  return max / diff.starveHpSec;
}

/**
 * Catalog of every placeable / useful item for creative mode.
 * @returns {Array<number|string>}
 */
export function creativeCatalog() {
  const skip = new Set([
    BLOCK.AIR,
    BLOCK.LAVA,
    BLOCK.BEDROCK,
    BLOCK.WATER, // use bucket instead
  ]);
  /** @type {Array<number|string>} */
  const out = [];
  for (const id of Object.values(BLOCK)) {
    if (typeof id !== 'number' || skip.has(id)) continue;
    out.push(id);
  }
  for (const id of Object.keys(TOOLS)) {
    if (id === 'hand') continue;
    out.push(id);
  }
  for (const id of Object.keys(FOOD)) out.push(id);
  const extras = [
    'stick', 'iron_ingot', 'gold_ingot', 'copper_ingot',
    'boat', 'bucket', 'bucket_water',
  ];
  for (const id of extras) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Fill inventory based on difficulty when starting a new world.
 * @param {import('../inventory/inventory.js').Inventory|ReturnType<typeof makeInventory>} inv
 * @param {DifficultyProfile|DifficultyId} diffOrId
 */
export function applyStarterKit(inv, diffOrId) {
  const diff = typeof diffOrId === 'string' ? getDifficulty(diffOrId) : diffOrId;
  if (!diff || diff.id === 'hard') {
    // Nothing — pure survival
    return inv;
  }
  if (diff.id === 'creative') {
    // Light tools on hotbar; full catalog is available via creative panel
    addItem(inv, 'gold_pick', 1);
    addItem(inv, 'iron_sword', 1);
    addItem(inv, BLOCK.TORCH, 64);
    addItem(inv, BLOCK.LANTERN, 16);
    addItem(inv, BLOCK.DIRT, 64);
    addItem(inv, BLOCK.STONE, 64);
    addItem(inv, BLOCK.WOOD, 64);
    addItem(inv, BLOCK.PLANKS, 64);
    return inv;
  }
  if (diff.id === 'easy') {
    addItem(inv, 'wood_pick', 1);
    addItem(inv, 'wood_axe', 1);
    addItem(inv, 'wood_sword', 1);
    addItem(inv, BLOCK.TORCH, 16);
    addItem(inv, BLOCK.DIRT, 32);
    addItem(inv, BLOCK.WOOD, 20);
    addItem(inv, BLOCK.PLANKS, 16);
    addItem(inv, BLOCK.STONE, 16);
    addItem(inv, BLOCK.LADDER, 12);
    addItem(inv, BLOCK.WORKBENCH, 1);
    addItem(inv, 'apple', 6);
    addItem(inv, 'bread', 2);
    return inv;
  }
  // Normal — pickaxe + some wood (and a few torches to get going)
  addItem(inv, 'wood_pick', 1);
  addItem(inv, BLOCK.WOOD, 10);
  addItem(inv, BLOCK.TORCH, 4);
  addItem(inv, 'apple', 2);
  return inv;
}

/**
 * Stack size when picking an item from the creative catalog.
 * @param {number|string} id
 */
export function creativeGiveCount(id) {
  if (typeof id === 'string' && TOOLS[id]) return 1;
  if (id === 'boat' || id === 'bucket' || id === 'bucket_water') return 1;
  return 64;
}
