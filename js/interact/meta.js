import { tileKey } from '../content/items.js';

export function makeWorldMeta() {
  return {
    openDoors: Object.create(null),
    chests: Object.create(null),
    milestones: Object.create(null),
    /** tileKey → 'floor'|'ceil'|'left'|'right' — wall torches angle off the mount */
    torchFacing: Object.create(null),
    /** tileKey → 'hang'|'floor' — lanterns hang from ceilings or sit on the ground */
    lanternMode: Object.create(null),
    /** 'x,y' → 1..7 flow level. Sources have no entry, so a settled world
        stores almost nothing here. See js/world/liquid.js. */
    liquid: Object.create(null),
    /** tileKey → the words written on a sign. */
    signText: Object.create(null),
  };
}

/**
 * A door occupies two tiles and the bottom one owns the open/closed state, so
 * both halves always agree. Given either half, this returns the bottom.
 *
 * `getTileAt` is passed in rather than imported to keep this module free of a
 * dependency on the world — it is only ever asked about two cells.
 */
export function doorRoot(getTileAt, x, y, DOOR, DOOR_TOP) {
  if (getTileAt(x, y) === DOOR_TOP) return { x, y: y + 1 };
  if (getTileAt(x, y) === DOOR) return { x, y };
  return null;
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

/** @param {'floor'|'ceil'|'left'|'right'} facing */
export function setTorchFacing(meta, x, y, facing) {
  if (!meta.torchFacing) meta.torchFacing = Object.create(null);
  meta.torchFacing[tileKey(x, y)] = facing || 'floor';
}

export function getTorchFacing(meta, x, y) {
  if (!meta || !meta.torchFacing) return null;
  return meta.torchFacing[tileKey(x, y)] || null;
}

export function clearTorchFacing(meta, x, y) {
  if (meta && meta.torchFacing) delete meta.torchFacing[tileKey(x, y)];
}

/** @param {'hang'|'floor'} mode */
export function setLanternMode(meta, x, y, mode) {
  if (!meta.lanternMode) meta.lanternMode = Object.create(null);
  meta.lanternMode[tileKey(x, y)] = mode === 'floor' ? 'floor' : 'hang';
}

export function getLanternMode(meta, x, y) {
  if (!meta || !meta.lanternMode) return null;
  return meta.lanternMode[tileKey(x, y)] || null;
}

export function clearLanternMode(meta, x, y) {
  if (meta && meta.lanternMode) delete meta.lanternMode[tileKey(x, y)];
}

/** Longest text a sign holds. Long enough for a name, short enough to read. */
export const SIGN_MAX = 48;

export function setSignText(meta, x, y, text) {
  if (!meta.signText) meta.signText = Object.create(null);
  const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, SIGN_MAX);
  if (!clean) delete meta.signText[tileKey(x, y)];
  else meta.signText[tileKey(x, y)] = clean;
  return clean;
}

export function getSignText(meta, x, y) {
  if (!meta || !meta.signText) return '';
  return meta.signText[tileKey(x, y)] || '';
}

export function clearSignText(meta, x, y) {
  if (meta && meta.signText) delete meta.signText[tileKey(x, y)];
}

export function serializeMeta(meta) {
  return {
    openDoors: Object.assign({}, meta.openDoors),
    chests: Object.assign({}, meta.chests),
    milestones: Object.assign({}, meta.milestones || {}),
    torchFacing: Object.assign({}, meta.torchFacing || {}),
    lanternMode: Object.assign({}, meta.lanternMode || {}),
    liquid: Object.assign({}, meta.liquid || {}),
    signText: Object.assign({}, meta.signText || {}),
  };
}

export function deserializeMeta(data) {
  const meta = makeWorldMeta();
  if (!data) return meta;
  if (data.openDoors) meta.openDoors = Object.assign(Object.create(null), data.openDoors);
  if (data.chests) meta.chests = Object.assign(Object.create(null), data.chests);
  if (data.milestones) meta.milestones = Object.assign(Object.create(null), data.milestones);
  if (data.torchFacing) meta.torchFacing = Object.assign(Object.create(null), data.torchFacing);
  if (data.lanternMode) meta.lanternMode = Object.assign(Object.create(null), data.lanternMode);
  if (data.liquid) meta.liquid = Object.assign(Object.create(null), data.liquid);
  if (data.signText) meta.signText = Object.assign(Object.create(null), data.signText);
  return meta;
}
