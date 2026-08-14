import { BLOCK, BLOCK_META } from '../content/blocks.js';
import { FOOD, isFood } from '../content/tools.js';
import {
  selectedSlot, removeItem, addItem,
} from '../inventory/inventory.js';
import { getTile, setTile, isSolid, wrapX, wrapDeltaX } from '../world/index.js';
import { isDoorOpen } from './meta.js';

export function isSolidWorld(world, meta, x, y) {
  const t = getTile(world, x, y);
  // Either half of an open door is walk-through; the bottom half holds the state.
  if (t === BLOCK.DOOR && meta && isDoorOpen(meta, x, y)) return false;
  if (t === BLOCK.DOOR_TOP && meta && isDoorOpen(meta, x, y + 1)) return false;
  return isSolid(world, x, y);
}

export function nearBlock(world, px, py, blockId, r) {
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

export function nearInteract(world, meta, px, py) {
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
        // Reaching for either half of a door works the handle. State lives on
        // the bottom half, so always report that cell.
        const isTop = t === BLOCK.DOOR_TOP;
        best = { x: wrapX(tx), y: isTop ? ty + 1 : ty, id: t, kind: m.interact };
      }
    }
  }
  return best;
}

export function tryEat(inv, player) {
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

export function trySleep(player, world, timeOfDay, bedPos) {
  const day = Math.sin(timeOfDay * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
  if (day > 0.45) return { ok: false, reason: 'You can only sleep at night' };
  player.hp = player.maxHp;
  player.energy = player.maxEnergy;
  player.hunger = Math.min(player.maxHunger, player.hunger + 15);
  if (bedPos) {
    player.spawnX = bedPos.x;
    player.spawnY = bedPos.y;
  }
  return { ok: true, timeOfDay: 0.28, setSpawn: !!bedPos };
}

export function tryBucket(inv, world, player, tx, ty) {
  const slot = selectedSlot(inv);
  if (!slot) return null;
  if (slot.id === 'bucket') {
    if (getTile(world, tx, ty) === BLOCK.WATER) {
      setTile(world, tx, ty, BLOCK.AIR);
      removeItem(inv, 'bucket', 1);
      addItem(inv, 'bucket_water', 1);
      return { ok: true, msg: 'Filled bucket' };
    }
    return { ok: false, reason: 'Aim at water' };
  }
  if (slot.id === 'bucket_water') {
    if (getTile(world, tx, ty) === BLOCK.AIR || getTile(world, tx, ty) === BLOCK.WATER) {
      setTile(world, tx, ty, BLOCK.WATER);
      removeItem(inv, 'bucket_water', 1);
      addItem(inv, 'bucket', 1);
      return { ok: true, msg: 'Placed water' };
    }
    return { ok: false, reason: 'Need empty space' };
  }
  return null;
}

export function tryMountBoat(inv, player, world) {
  const slot = selectedSlot(inv);
  if (!slot || slot.id !== 'boat') return null;
  const feet = getTile(world, Math.floor(player.x), Math.floor(player.y));
  const below = getTile(world, Math.floor(player.x), Math.floor(player.y + 0.2));
  if (feet === BLOCK.WATER || below === BLOCK.WATER) {
    player.inBoat = true;
    removeItem(inv, 'boat', 1);
    return { ok: true, msg: 'Boarded boat — sail the seas!' };
  }
  return { ok: false, reason: 'Stand in water to launch boat' };
}

export function tryDismountBoat(player, inv) {
  if (!player.inBoat) return false;
  player.inBoat = false;
  addItem(inv, 'boat', 1);
  return true;
}
