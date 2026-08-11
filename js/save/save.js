import { SAVE_KEY } from '../core/constants.js';
import { WORLD_W, WORLD_SIZE_PRESETS } from '../core/worldSize.js';
import { serializeWorld } from '../world/index.js';
import { serializeInv } from '../inventory/inventory.js';
import { serializeEntities } from '../entities/state.js';

const defaultSave = () => ({
  muted: false,
  reducedMotion: false,
  hasWorld: false,
  world: null,
  player: null,
  inv: null,
  ents: null,
  timeOfDay: 0.3,
  seed: 0,
  worldSizeId: 'standard',
  worldSize: 4096,
  blocksMined: 0,
  distanceWalked: 0,
  circumnavigations: 0,
  milestones: 0,
});

export let save = defaultSave();

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) {
      save = defaultSave();
      return save;
    }
    const data = JSON.parse(raw);
    save = Object.assign(defaultSave(), data);
    return save;
  } catch (_) {
    save = defaultSave();
    return save;
  }
}

export function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (_) { /* quota */ }
}

export function clearWorldSave() {
  save.hasWorld = false;
  save.world = null;
  save.player = null;
  save.inv = null;
  save.ents = null;
  save.timeOfDay = 0.3;
  writeSave();
}

export function persistSession(world, player, inv, timeOfDay, stats, ents) {
  save.hasWorld = true;
  save.world = serializeWorld(world);
  save.player = {
    x: player.x,
    y: player.y,
    hp: player.hp,
    energy: player.energy,
    hunger: player.hunger,
    spawnX: player.spawnX,
    spawnY: player.spawnY,
    inBoat: !!player.inBoat,
  };
  save.inv = serializeInv(inv);
  if (ents) {
    save.ents = serializeEntities(ents);
  }
  save.timeOfDay = timeOfDay;
  save.seed = world.seed;
  save.worldSize = world.w || WORLD_W;
  const preset = WORLD_SIZE_PRESETS.find(p => p.w === save.worldSize);
  if (preset) save.worldSizeId = preset.id;
  if (stats) {
    save.blocksMined = stats.blocksMined | 0;
    save.distanceWalked = stats.distanceWalked || 0;
    save.circumnavigations = stats.circumnavigations | 0;
    save.milestones = stats.milestones | 0;
  }
  try {
    writeSave();
  } catch (e) {
    console.warn('[blockbound] save failed (quota?)', e);
  }
}
