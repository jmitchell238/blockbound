import { tileKey } from '../content/items.js';

export function makeWorldMeta() {
  return {
    openDoors: Object.create(null),
    chests: Object.create(null),
    milestones: Object.create(null),
  };
}

export function isDoorOpen(meta, x, y) {
  return !!meta.openDoors[tileKey(x, y)];
}

export function toggleDoor(meta, x, y) {
  const k = tileKey(x, y);
  meta.openDoors[k] = !meta.openDoors[k];
  return meta.openDoors[k];
}

export function getChest(meta, x, y) {
  const k = tileKey(x, y);
  if (!meta.chests[k]) {
    meta.chests[k] = Array.from({ length: 16 }, () => null);
  }
  return meta.chests[k];
}

export function removeChest(meta, x, y) {
  delete meta.chests[tileKey(x, y)];
  delete meta.openDoors[tileKey(x, y)];
}

export function serializeMeta(meta) {
  return {
    openDoors: Object.assign({}, meta.openDoors),
    chests: Object.assign({}, meta.chests),
    milestones: Object.assign({}, meta.milestones || {}),
  };
}

export function deserializeMeta(data) {
  const meta = makeWorldMeta();
  if (!data) return meta;
  if (data.openDoors) meta.openDoors = Object.assign(Object.create(null), data.openDoors);
  if (data.chests) meta.chests = Object.assign(Object.create(null), data.chests);
  if (data.milestones) meta.milestones = Object.assign(Object.create(null), data.milestones);
  return meta;
}
