'use strict';

const HOTBAR_SIZE = 8;
const BAG_SIZE = 24;

function makeInventory() {
  return {
    hotbar: Array.from({ length: HOTBAR_SIZE }, () => null),
    bag: Array.from({ length: BAG_SIZE }, () => null),
    selected: 0,
    tool: 'hand',
    toolDurability: Infinity,
  };
}

function makeSlot(id, count) {
  return { id, count: count || 1 };
}

function addItem(inv, id, count) {
  count = count || 1;
  if (count <= 0) return 0;
  // Stack in hotbar then bag
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
  // Empty slots hotbar first
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
  return count; // leftover
}

function canStack(id) {
  return !isTool(id);
}

function removeItem(inv, id, count) {
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

function countItem(inv, id) {
  let n = 0;
  for (const s of inv.hotbar) if (s && s.id === id) n += s.count;
  for (const s of inv.bag) if (s && s.id === id) n += s.count;
  return n;
}

function selectedSlot(inv) {
  return inv.hotbar[inv.selected] || null;
}

function selectHotbar(inv, i) {
  if (i >= 0 && i < HOTBAR_SIZE) inv.selected = i;
}

/** Equip tool if selected slot is a tool; otherwise keep current or hand. */
function syncEquippedTool(inv) {
  const s = selectedSlot(inv);
  if (s && isTool(s.id)) {
    inv.tool = s.id;
    inv.toolDurability = s.durability != null ? s.durability : (TOOLS[s.id] && TOOLS[s.id].durability) || 100;
  }
}

function toolPowerFor(inv, blockId) {
  const t = TOOLS[inv.tool] || TOOLS.hand;
  let power = t.power || 1;
  if (t.mineBonus && t.mineBonus.indexOf(blockId) >= 0) power *= 1.35;
  // Axes better on wood
  if ((inv.tool === 'wood_axe' || inv.tool === 'stone_axe') &&
      (blockId === BLOCK.WOOD || blockId === BLOCK.LEAVES || blockId === BLOCK.PLANKS)) {
    power *= 1.2;
  }
  return power;
}

function canCraft(inv, recipe) {
  for (const [id, n] of recipe.in) {
    if (countItem(inv, id) < n) return false;
  }
  return true;
}

function craft(inv, recipe) {
  if (!canCraft(inv, recipe)) return false;
  for (const [id, n] of recipe.in) removeItem(inv, id, n);
  const [outId, outN] = recipe.out;
  if (isTool(outId)) {
    addItem(inv, outId, 1);
    // stamp durability on the newly added tool slot
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

function nearWorkbench(world, px, py) {
  const r = 3;
  const x0 = Math.floor(px) - r;
  const y0 = Math.floor(py) - r;
  for (let y = y0; y <= y0 + r * 2; y++) {
    for (let x = x0; x <= x0 + r * 2; x++) {
      if (getTile(world, x, y) === BLOCK.WORKBENCH) return true;
    }
  }
  return false;
}

function availableRecipes(inv, world, px, py) {
  if (typeof availableRecipesAt === 'function') {
    return availableRecipesAt(inv, world, px, py);
  }
  const atBench = nearWorkbench(world, px, py);
  return RECIPES.filter(r => {
    if (r.hidden) return false;
    if (r.station === 'workbench' && !atBench) return false;
    if (r.station === 'furnace' && typeof nearBlock === 'function' && !nearBlock(world, px, py, BLOCK.FURNACE, 3)) return false;
    return true;
  });
}

function transferSlot(fromArr, fromI, toArr) {
  const s = fromArr[fromI];
  if (!s) return false;
  // stack into existing
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

/** Swap or move one slot into another array (bag ↔ hotbar). */
function moveOrSwap(fromArr, fromI, toArr, toI) {
  if (fromI < 0 || fromI >= fromArr.length) return false;
  if (toI < 0 || toI >= toArr.length) return false;
  const a = fromArr[fromI];
  const b = toArr[toI];
  if (!a) return false;
  // Stack if same stackable item
  if (b && a.id === b.id && canStack(a.id) && b.count < 99) {
    const space = 99 - b.count;
    const move = Math.min(space, a.count);
    b.count += move;
    a.count -= move;
    if (a.count <= 0) fromArr[fromI] = null;
    return true;
  }
  // Swap
  fromArr[fromI] = b;
  toArr[toI] = a;
  return true;
}

function bagUsed(inv) {
  let n = 0;
  for (const s of inv.bag) if (s) n++;
  return n;
}

function bagFree(inv) {
  return BAG_SIZE - bagUsed(inv);
}

/** Move entire hotbar slot into first free bag space (or stack). */
function stowToBag(inv, hotbarIndex) {
  return transferSlot(inv.hotbar, hotbarIndex, inv.bag);
}

/** Move bag slot into hotbar. */
function takeFromBag(inv, bagIndex) {
  return transferSlot(inv.bag, bagIndex, inv.hotbar);
}

function serializeInv(inv) {
  return {
    hotbar: inv.hotbar.map(s => s ? { id: s.id, count: s.count, durability: s.durability } : null),
    bag: inv.bag.map(s => s ? { id: s.id, count: s.count, durability: s.durability } : null),
    selected: inv.selected,
    tool: inv.tool,
  };
}

function deserializeInv(data) {
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

function starterKit(inv) {
  addItem(inv, BLOCK.TORCH, 4);
}
