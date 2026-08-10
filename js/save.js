'use strict';

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

let save = defaultSave();

function loadSave() {
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

function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (_) { /* quota */ }
}

function clearWorldSave() {
  save.hasWorld = false;
  save.world = null;
  save.player = null;
  save.inv = null;
  save.ents = null;
  save.timeOfDay = 0.3;
  writeSave();
}

function persistSession(world, player, inv, timeOfDay, stats, ents) {
  save.hasWorld = true;
  save.world = serializeWorld(world);
  save.player = {
    x: player.x,
    y: player.y,
    hp: player.hp,
    energy: player.energy,
    hunger: player.hunger,
  };
  save.inv = serializeInv(inv);
  if (ents && typeof serializeEntities === 'function') {
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
