'use strict';

/**
 * Doors, chests, beds, furnace proximity, eating, milestones.
 */

function makeWorldMeta() {
  return {
    openDoors: Object.create(null), // "x,y" -> true
    chests: Object.create(null),    // "x,y" -> slot[]
    milestones: Object.create(null),
  };
}

function isDoorOpen(meta, x, y) {
  return !!meta.openDoors[tileKey(x, y)];
}

function toggleDoor(meta, x, y) {
  const k = tileKey(x, y);
  meta.openDoors[k] = !meta.openDoors[k];
  return meta.openDoors[k];
}

function getChest(meta, x, y) {
  const k = tileKey(x, y);
  if (!meta.chests[k]) {
    meta.chests[k] = Array.from({ length: 16 }, () => null);
  }
  return meta.chests[k];
}

function removeChest(meta, x, y) {
  delete meta.chests[tileKey(x, y)];
  delete meta.openDoors[tileKey(x, y)];
}

/** isSolid that respects open doors. */
function isSolidWorld(world, meta, x, y) {
  const t = getTile(world, x, y);
  if (t === BLOCK.DOOR && meta && isDoorOpen(meta, x, y)) return false;
  return isSolid(world, x, y);
}

function nearBlock(world, px, py, blockId, r) {
  r = r || 2;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (getTile(world, x0 + dx, y0 + dy) === blockId) {
        return { x: wrapX(x0 + dx), y: y0 + dy };
      }
    }
  }
  return null;
}

function nearInteract(world, meta, px, py) {
  const r = 2;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py - 0.3);
  let best = null;
  let bestD = 99;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const tx = x0 + dx;
      const ty = y0 + dy;
      const t = getTile(world, tx, ty);
      const m = BLOCK_META[t];
      if (!m || !m.interact) continue;
      const d = Math.hypot(wrapDeltaX(px, tx + 0.5), (py - 0.8) - (ty + 0.5));
      if (d < bestD && d <= 2.6) {
        bestD = d;
        best = { x: wrapX(tx), y: ty, id: t, kind: m.interact };
      }
    }
  }
  return best;
}

function tryEat(inv, player) {
  const s = selectedSlot(inv);
  if (!s || !isFood(s.id)) return null;
  const food = FOOD[s.id];
  if (player.hunger >= player.maxHunger - 0.5 && player.hp >= player.maxHp) {
    return { ok: false, reason: 'Already full' };
  }
  removeItem(inv, s.id, 1);
  player.hunger = Math.min(player.maxHunger, player.hunger + food.hunger);
  player.hp = Math.min(player.maxHp, player.hp + (food.heal || 0));
  player.energy = Math.min(player.maxEnergy, player.energy + food.hunger * 0.35);
  return { ok: true, food };
}

function trySleep(player, world, timeOfDay) {
  // Must be night-ish
  const day = Math.sin(timeOfDay * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
  if (day > 0.45) return { ok: false, reason: 'You can only sleep at night' };
  player.hp = player.maxHp;
  player.energy = player.maxEnergy;
  player.hunger = Math.min(player.maxHunger, player.hunger + 15);
  // Skip to morning ~0.28
  return { ok: true, timeOfDay: 0.28 };
}

function unlockMilestone(meta, stats, ui, id) {
  if (!meta.milestones) meta.milestones = Object.create(null);
  if (meta.milestones[id]) return false;
  meta.milestones[id] = true;
  if (stats) {
    stats.milestones = (stats.milestones | 0) + 1;
  }
  if (ui && MILESTONES[id]) toast(ui, MILESTONES[id]);
  return true;
}

function serializeMeta(meta) {
  return {
    openDoors: Object.assign({}, meta.openDoors),
    chests: Object.assign({}, meta.chests),
    milestones: Object.assign({}, meta.milestones || {}),
  };
}

function deserializeMeta(data) {
  const meta = makeWorldMeta();
  if (!data) return meta;
  if (data.openDoors) meta.openDoors = Object.assign(Object.create(null), data.openDoors);
  if (data.chests) meta.chests = Object.assign(Object.create(null), data.chests);
  if (data.milestones) meta.milestones = Object.assign(Object.create(null), data.milestones);
  return meta;
}

/** Station check for recipes. */
function stationAvailable(world, px, py, station) {
  if (station === 'hand') return true;
  if (station === 'workbench') return !!nearBlock(world, px, py, BLOCK.WORKBENCH, 3);
  if (station === 'furnace') return !!nearBlock(world, px, py, BLOCK.FURNACE, 3);
  return false;
}

function availableRecipesAt(inv, world, px, py) {
  return RECIPES.filter(r => {
    if (r.hidden) return false;
    return stationAvailable(world, px, py, r.station);
  });
}
