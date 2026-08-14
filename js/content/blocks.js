/** Block IDs and simulation + presentation metadata. */

export const BLOCK = {
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
  LANTERN: 28,
  /** Hardened crust capping the molten LAVA below it. */
  MAGMA: 29,
  /**
   * Upper half of a door. Never placed or carried directly — DOOR writes it,
   * and breaking either half removes both. The player is 1.55 tiles tall, so a
   * one-tile doorway is a wall with a handle on it.
   */
  DOOR_TOP: 30,
};

export const BLOCK_META = {
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
  // Molten. Not solid: you fall in and sink. mine:99 keeps it unmineable —
  // the way down is to quench it with water and mine the stone that leaves.
  [BLOCK.LAVA]:      { name: 'Lava', solid: false, mine: 99, drops: null, color: '#ff4500', top: '#ff6a00', hazard: true },
  // The single hardened layer capping the lava. Cooled, so it does not burn;
  // mineable, so breaking through it is the deliberate act that opens the
  // molten layers below. Glows faintly, which is the only light down there.
  [BLOCK.MAGMA]:     { name: 'Magma', solid: true, mine: 1.8, drops: BLOCK.MAGMA, color: '#4a1f18', top: '#6d2a1d', spark: '#ff6a00', light: 6 },
  [BLOCK.BEDROCK]:   { name: 'Bedrock', solid: true, mine: 99, drops: null, color: '#1a1a22' },
  [BLOCK.WATER]:     { name: 'Water', solid: false, mine: 0, drops: null, color: '#3a8fd4', alpha: 0.55, fluid: true },
  [BLOCK.SNOW]:      { name: 'Snow', solid: true, mine: 0.25, drops: BLOCK.SNOW, color: '#eef6ff', top: '#ffffff', gravity: true },
  [BLOCK.CLAY]:      { name: 'Clay', solid: true, mine: 0.4, drops: BLOCK.CLAY, color: '#a07868', top: '#b08878' },
  [BLOCK.LADDER]:    { name: 'Ladder', solid: false, mine: 0.2, drops: BLOCK.LADDER, color: '#c4a060', climb: true },
  [BLOCK.TORCH]:     { name: 'Torch', solid: false, mine: 0.1, drops: BLOCK.TORCH, color: '#ffcc44', light: 13 },
  [BLOCK.WORKBENCH]: { name: 'Workbench', solid: true, walkThrough: true, mine: 0.5, drops: BLOCK.WORKBENCH, color: '#a07040', top: '#c09050', interact: 'craft' },
  [BLOCK.PLANKS]:    { name: 'Planks', solid: true, mine: 0.4, drops: BLOCK.PLANKS, color: '#c49a5a', top: '#d4aa6a' },
  [BLOCK.GLASS]:     { name: 'Glass', solid: true, mine: 0.25, drops: BLOCK.GLASS, color: '#a8d8ff', alpha: 0.45 },
  [BLOCK.BRICK]:     { name: 'Brick', solid: true, mine: 0.8, drops: BLOCK.BRICK, color: '#b05040', top: '#c06050' },
  [BLOCK.COPPER]:    { name: 'Copper Ore', solid: true, mine: 1.2, drops: BLOCK.COPPER, color: '#8a6a50', spark: '#e07a40' },
  [BLOCK.DOOR]:      { name: 'Door', solid: true, mine: 0.45, drops: BLOCK.DOOR, color: '#a07840', top: '#c09858', interact: 'door' },
  // The top half carries no drop of its own — the pair yields one door, and the
  // bottom half is the one that owns the open/closed state.
  [BLOCK.DOOR_TOP]:  { name: 'Door', solid: true, mine: 0.45, drops: null, color: '#a07840', top: '#c09858', interact: 'door' },
  // Floor furniture is `walkThrough`: you can walk past it and stand on top of
  // it, but it never blocks a doorway. A bed one tile from a gap used to wall
  // the gap off completely, and a chest in a corridor was a locked door you
  // could open but not pass.
  [BLOCK.BED]:       { name: 'Bed', solid: true, walkThrough: true, mine: 0.4, drops: BLOCK.BED, color: '#c45a6a', top: '#e87890', interact: 'bed' },
  [BLOCK.CHEST]:     { name: 'Chest', solid: true, walkThrough: true, mine: 0.5, drops: BLOCK.CHEST, color: '#b8863a', top: '#d4a04a', interact: 'chest' },
  [BLOCK.FURNACE]:   { name: 'Furnace', solid: true, walkThrough: true, mine: 0.7, drops: BLOCK.FURNACE, color: '#5a5a62', top: '#6e6e78', interact: 'furnace', light: 4 },
  [BLOCK.PLATFORM]:  { name: 'Platform', solid: true, mine: 0.25, drops: BLOCK.PLATFORM, color: '#c4a060', top: '#d4b070', platform: true },
  [BLOCK.CAMPFIRE]:  { name: 'Campfire', solid: false, mine: 0.3, drops: BLOCK.CAMPFIRE, color: '#8b4513', light: 10, interact: 'campfire' },
  /** Hangs from ceilings / platforms, or sits on the floor — brighter/farther than torch. */
  [BLOCK.LANTERN]:   { name: 'Lantern', solid: false, mine: 0.2, drops: BLOCK.LANTERN, color: '#ffc866', light: 14, hang: true },
};

export const BIOME_NAMES = ['Forest', 'Desert', 'Snow', 'Plains'];

export function isPlatform(id) {
  return id === BLOCK.PLATFORM || !!(BLOCK_META[id] && BLOCK_META[id].platform);
}

/**
 * Blocks you can walk straight through but still land on from above.
 *
 * Kept separate from `platform` on purpose: platforms skip the "needs support"
 * rule when placing, and furniture should still have to sit on something.
 */
export function isWalkThrough(id) {
  return !!(BLOCK_META[id] && BLOCK_META[id].walkThrough);
}

export function isGravityBlock(id) {
  return !!(BLOCK_META[id] && BLOCK_META[id].gravity);
}

export function isBlockItem(id) {
  return typeof id === 'number' && id > 0 && BLOCK_META[id];
}
