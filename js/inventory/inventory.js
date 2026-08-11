import { TOOLS } from '../content/tools.js';
import { BLOCK } from '../content/blocks.js';
import { isTool } from '../content/tools.js';

export const HOTBAR_SIZE = 8;
export const BAG_SIZE = 24;

export function makeInventory() {
  return {
    hotbar: Array.from({ length: HOTBAR_SIZE }, () => null),
    bag: Array.from({ length: BAG_SIZE }, () => null),
    selected: 0,
    tool: 'hand',
    toolDurability: Infinity,
  };
}

export function makeSlot(id, count) {
  return { id, count: count || 1 };
}

export function addItem(inv, id, count) {
  count = count || 1;
  if (count <= 0) return 0;
  const places = inv.hotbar.concat(inv.bag);
  for (const slot of places) {
    if (slot && slot.id === id && canStack(id) && slot.count < 99) {
      const space = 99 - slot.count;
      const add = Math.min(space, count);
      slot.count += add;
      count -= add;
      if (count <= 0) return 0;
    }
  }
  for (let i = 0; i < inv.hotbar.length && count > 0; i++) {
    if (!inv.hotbar[i]) {
      const add = canStack(id) ? Math.min(99, count) : 1;
      inv.hotbar[i] = makeSlot(id, add);
      count -= add;
    }
  }
  for (let i = 0; i < inv.bag.length && count > 0; i++) {
    if (!inv.bag[i]) {
      const add = canStack(id) ? Math.min(99, count) : 1;
      inv.bag[i] = makeSlot(id, add);
      count -= add;
    }
  }
  return count;
}

export function canStack(id) {
  return !isTool(id);
}

export function removeItem(inv, id, count) {
  count = count || 1;
  const takeFrom = (arr) => {
    for (let i = arr.length - 1; i >= 0 && count > 0; i--) {
      const s = arr[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.count, count);
      s.count -= take;
      count -= take;
      if (s.count <= 0) arr[i] = null;
    }
  };
  takeFrom(inv.hotbar);
  takeFrom(inv.bag);
  return count === 0;
}

export function countItem(inv, id) {
  let n = 0;
  for (const s of inv.hotbar) if (s && s.id === id) n += s.count;
  for (const s of inv.bag) if (s && s.id === id) n += s.count;
  return n;
}

export function selectedSlot(inv) {
  return inv.hotbar[inv.selected] || null;
}

export function selectHotbar(inv, i) {
  if (i >= 0 && i < HOTBAR_SIZE) inv.selected = i;
}

export function getHeldTool(inv) {
  const s = selectedSlot(inv);
  if (s && TOOLS[s.id]) return TOOLS[s.id];
  if (inv.tool && TOOLS[inv.tool]) return TOOLS[inv.tool];
  return TOOLS.hand;
}

/** What you fight with: selected tool/weapon, otherwise bare fists. */
export function getMeleeWeapon(inv) {
  const s = selectedSlot(inv);
  if (s && TOOLS[s.id]) return TOOLS[s.id];
  return TOOLS.hand;
}

export function syncEquippedTool(inv) {
  const s = selectedSlot(inv);
  if (s && isTool(s.id)) {
    inv.tool = s.id;
    inv.toolDurability = s.durability != null ? s.durability : (TOOLS[s.id] && TOOLS[s.id].durability) || 100;
  }
}

export function toolPowerFor(inv, blockId) {
  const t = TOOLS[inv.tool] || TOOLS.hand;
  let power = t.power || 1;
  if (t.mineBonus && t.mineBonus.indexOf(blockId) >= 0) power *= 1.35;
  if ((inv.tool === 'wood_axe' || inv.tool === 'stone_axe') &&
      (blockId === BLOCK.WOOD || blockId === BLOCK.LEAVES || blockId === BLOCK.PLANKS)) {
    power *= 1.2;
  }
  return power;
}

export function canCraft(inv, recipe) {
  for (const [id, n] of recipe.in) {
    if (countItem(inv, id) < n) return false;
  }
  return true;
}

export function craft(inv, recipe) {
  if (!canCraft(inv, recipe)) return false;
  for (const [id, n] of recipe.in) removeItem(inv, id, n);
  const [outId, outN] = recipe.out;
  if (isTool(outId)) {
    addItem(inv, outId, 1);
    for (const arr of [inv.hotbar, inv.bag]) {
      for (const s of arr) {
        if (s && s.id === outId && s.durability == null) {
          s.durability = TOOLS[outId].durability;
        }
      }
    }
  } else {
    addItem(inv, outId, outN);
  }
  return true;
}

export function transferSlot(fromArr, fromI, toArr) {
  const s = fromArr[fromI];
  if (!s) return false;
  for (let i = 0; i < toArr.length; i++) {
    if (toArr[i] && toArr[i].id === s.id && canStack(s.id) && toArr[i].count < 99) {
      const space = 99 - toArr[i].count;
      const move = Math.min(space, s.count);
      toArr[i].count += move;
      s.count -= move;
      if (s.count <= 0) { fromArr[fromI] = null; return true; }
    }
  }
  for (let i = 0; i < toArr.length; i++) {
    if (!toArr[i]) {
      toArr[i] = s;
      fromArr[fromI] = null;
      return true;
    }
  }
  return false;
}

export function moveOrSwap(fromArr, fromI, toArr, toI) {
  if (fromI < 0 || fromI >= fromArr.length) return false;
  if (toI < 0 || toI >= toArr.length) return false;
  const a = fromArr[fromI];
  const b = toArr[toI];
  if (!a) return false;
  if (b && a.id === b.id && canStack(a.id) && b.count < 99) {
    const space = 99 - b.count;
    const move = Math.min(space, a.count);
    b.count += move;
    a.count -= move;
    if (a.count <= 0) fromArr[fromI] = null;
    return true;
  }
  fromArr[fromI] = b;
  toArr[toI] = a;
  return true;
}

export function bagUsed(inv) {
  let n = 0;
  for (const s of inv.bag) if (s) n++;
  return n;
}

export function bagFree(inv) {
  return BAG_SIZE - bagUsed(inv);
}

export function stowToBag(inv, hotbarIndex) {
  return transferSlot(inv.hotbar, hotbarIndex, inv.bag);
}

export function takeFromBag(inv, bagIndex) {
  return transferSlot(inv.bag, bagIndex, inv.hotbar);
}

export function serializeInv(inv) {
  return {
    hotbar: inv.hotbar.map(s => s ? { id: s.id, count: s.count, durability: s.durability } : null),
    bag: inv.bag.map(s => s ? { id: s.id, count: s.count, durability: s.durability } : null),
    selected: inv.selected,
    tool: inv.tool,
  };
}

export function deserializeInv(data) {
  const inv = makeInventory();
  if (!data) return inv;
  if (data.hotbar) {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const s = data.hotbar[i];
      inv.hotbar[i] = s ? { id: s.id, count: s.count, durability: s.durability } : null;
    }
  }
  if (data.bag) {
    for (let i = 0; i < BAG_SIZE; i++) {
      const s = data.bag[i];
      inv.bag[i] = s ? { id: s.id, count: s.count, durability: s.durability } : null;
    }
  }
  inv.selected = data.selected | 0;
  inv.tool = data.tool || 'hand';
  return inv;
}

export function starterKit(inv) {
  addItem(inv, BLOCK.TORCH, 4);
}
