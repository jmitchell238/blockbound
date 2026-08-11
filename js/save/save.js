/**
 * Multi-world library + per-world payloads (Minecraft-style).
 *
 * library (small): world list meta + settings
 * each world: heavy payload under blockbound-w-<id>
 *
 * `save` is a live façade for the active world + global prefs (session code uses it).
 */
import { SAVE_KEY, LIBRARY_KEY, worldDataKey } from '../core/constants.js';
import { WORLD_W, WORLD_SIZE_PRESETS } from '../core/worldSize.js';
import { serializeWorld } from '../world/index.js';
import { serializeInv } from '../inventory/inventory.js';
import { serializeEntities } from '../entities/state.js';
import { parseSeed, formatSeedDisplay, randomSeed } from '../core/seed.js';
import { getDifficulty } from '../core/difficulty.js';

function defaultLibrary() {
  return {
    muted: false,
    reducedMotion: false,
    selectedWorldId: null,
    defaults: {
      difficultyId: 'normal',
      worldSizeId: 'standard',
    },
    /** @type {WorldMeta[]} */
    worlds: [],
  };
}

/**
 * @typedef {Object} WorldMeta
 * @property {string} id
 * @property {string} name
 * @property {number} seed
 * @property {string} seedString
 * @property {string} difficultyId
 * @property {string} worldSizeId
 * @property {number} worldSize
 * @property {number} createdAt
 * @property {number} lastPlayed
 * @property {number} blocksMined
 * @property {number} distanceWalked
 * @property {number} circumnavigations
 * @property {number} milestones
 * @property {boolean} hasData
 */

function emptyPayload() {
  return {
    world: null,
    player: null,
    inv: null,
    ents: null,
    timeOfDay: 0.3,
  };
}

export let library = defaultLibrary();
/** Active world id while playing / loaded for continue */
export let activeWorldId = null;
/** Façade used by session code (mirrors active world + prefs) */
export let save = {
  muted: false,
  reducedMotion: false,
  difficultyId: 'normal',
  worldSizeId: 'standard',
  worldSize: 4096,
  seed: 0,
  seedString: '',
  worldName: '',
  worldId: null,
  hasWorld: false,
  world: null,
  player: null,
  inv: null,
  ents: null,
  timeOfDay: 0.3,
  blocksMined: 0,
  distanceWalked: 0,
  circumnavigations: 0,
  milestones: 0,
  _payload: emptyPayload(),
};

function buildSaveFacade(payload) {
  const meta = activeWorldId
    ? library.worlds.find(w => w.id === activeWorldId)
    : null;
  const p = payload || emptyPayload();
  return {
    muted: library.muted,
    reducedMotion: library.reducedMotion,
    difficultyId: (meta && meta.difficultyId) || library.defaults.difficultyId || 'normal',
    worldSizeId: (meta && meta.worldSizeId) || library.defaults.worldSizeId || 'standard',
    worldSize: (meta && meta.worldSize) || 4096,
    seed: meta ? meta.seed : 0,
    seedString: meta ? meta.seedString : '',
    worldName: meta ? meta.name : '',
    worldId: activeWorldId,
    hasWorld: !!(meta && meta.hasData && p.world),
    world: p.world,
    player: p.player,
    inv: p.inv,
    ents: p.ents,
    timeOfDay: p.timeOfDay != null ? p.timeOfDay : 0.3,
    blocksMined: (meta && meta.blocksMined) || 0,
    distanceWalked: (meta && meta.distanceWalked) || 0,
    circumnavigations: (meta && meta.circumnavigations) || 0,
    milestones: (meta && meta.milestones) || 0,
    _payload: p,
  };
}

function refreshSave() {
  const prevPayload = (save && save._payload) ? save._payload : emptyPayload();
  save = buildSaveFacade(prevPayload);
  return save;
}

function newWorldId() {
  return 'w_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
}

function writeLibrary() {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch (e) {
    console.warn('[blockbound] library save failed', e);
  }
}

function writeWorldPayload(id, payload) {
  try {
    localStorage.setItem(worldDataKey(id), JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn('[blockbound] world save failed (quota?)', e);
    return false;
  }
}

function readWorldPayload(id) {
  try {
    const raw = localStorage.getItem(worldDataKey(id));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function removeWorldPayload(id) {
  try {
    localStorage.removeItem(worldDataKey(id));
  } catch (_) {}
}

/** Migrate legacy single-slot save into the library. */
function migrateLegacy() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data) return;

    library.muted = !!data.muted;
    library.reducedMotion = !!data.reducedMotion;
    if (data.difficultyId) library.defaults.difficultyId = data.difficultyId;
    if (data.worldSizeId) library.defaults.worldSizeId = data.worldSizeId;

    if (data.hasWorld && data.world) {
      const id = newWorldId();
      const seed = data.seed || (data.world && data.world.seed) || randomSeed();
      const meta = {
        id,
        name: 'My World',
        seed: seed >>> 0,
        seedString: String(seed >>> 0),
        difficultyId: data.difficultyId || 'normal',
        worldSizeId: data.worldSizeId || 'standard',
        worldSize: data.worldSize || (data.world && data.world.w) || 4096,
        createdAt: Date.now(),
        lastPlayed: Date.now(),
        blocksMined: data.blocksMined | 0,
        distanceWalked: data.distanceWalked || 0,
        circumnavigations: data.circumnavigations | 0,
        milestones: data.milestones | 0,
        hasData: true,
      };
      library.worlds.push(meta);
      library.selectedWorldId = id;
      writeWorldPayload(id, {
        world: data.world,
        player: data.player,
        inv: data.inv,
        ents: data.ents,
        timeOfDay: data.timeOfDay != null ? data.timeOfDay : 0.3,
      });
    }
    writeLibrary();
    // Keep legacy key as backup but mark migrated
    try {
      data._migratedToLibrary = true;
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (_) {}
  } catch (e) {
    console.warn('[blockbound] legacy migrate failed', e);
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      library = Object.assign(defaultLibrary(), data);
      if (!Array.isArray(library.worlds)) library.worlds = [];
      if (!library.defaults) library.defaults = defaultLibrary().defaults;
    } else {
      library = defaultLibrary();
      migrateLegacy();
    }
  } catch (_) {
    library = defaultLibrary();
  }
  activeWorldId = library.selectedWorldId || (library.worlds[0] && library.worlds[0].id) || null;
  save = buildSaveFacade(emptyPayload());
  // Don't auto-load heavy payload until play — just meta
  const meta = getWorldMeta(activeWorldId);
  if (meta) {
    save.difficultyId = meta.difficultyId;
    save.worldSizeId = meta.worldSizeId;
    save.worldSize = meta.worldSize;
    save.seed = meta.seed;
    save.seedString = meta.seedString;
    save.worldName = meta.name;
    // hasData means a payload exists; session still must loadWorldData before continue
    save.hasWorld = false;
  }
  return save;
}

export function writeSave() {
  // Persist library prefs (muted, selection, defaults) + current meta list
  library.muted = !!save.muted;
  library.reducedMotion = !!save.reducedMotion;
  if (save.difficultyId) library.defaults.difficultyId = save.difficultyId;
  if (save.worldSizeId) library.defaults.worldSizeId = save.worldSizeId;
  if (activeWorldId) library.selectedWorldId = activeWorldId;
  writeLibrary();
}

export function listWorlds() {
  return library.worlds.slice().sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
}

export function getWorldMeta(id) {
  return library.worlds.find(w => w.id === id) || null;
}

export function selectWorld(id) {
  activeWorldId = id || null;
  library.selectedWorldId = activeWorldId;
  writeLibrary();
  refreshSave();
  const meta = getWorldMeta(id);
  save.hasWorld = !!(meta && meta.hasData);
  return meta;
}

/**
 * Load full world payload into `save` for enterPlay(continue).
 * @returns {boolean}
 */
export function loadWorldData(id) {
  const meta = getWorldMeta(id);
  if (!meta) return false;
  activeWorldId = id;
  library.selectedWorldId = id;
  const payload = readWorldPayload(id) || emptyPayload();
  save = buildSaveFacade();
  save._payload = {
    world: payload.world || null,
    player: payload.player || null,
    inv: payload.inv || null,
    ents: payload.ents || null,
    timeOfDay: payload.timeOfDay != null ? payload.timeOfDay : 0.3,
  };
  save.world = save._payload.world;
  save.player = save._payload.player;
  save.inv = save._payload.inv;
  save.ents = save._payload.ents;
  save.timeOfDay = save._payload.timeOfDay;
  save.hasWorld = !!save.world;
  save.seed = meta.seed;
  save.seedString = meta.seedString;
  save.difficultyId = meta.difficultyId;
  save.worldSizeId = meta.worldSizeId;
  save.worldSize = meta.worldSize;
  save.worldName = meta.name;
  save.worldId = id;
  save.blocksMined = meta.blocksMined | 0;
  save.distanceWalked = meta.distanceWalked || 0;
  save.circumnavigations = meta.circumnavigations | 0;
  save.milestones = meta.milestones | 0;
  writeLibrary();
  return !!save.world;
}

/**
 * Create a new world meta entry (generation happens in session).
 * @param {object} opts
 * @param {string} opts.name
 * @param {string|number} [opts.seedInput]
 * @param {string} [opts.difficultyId]
 * @param {string} [opts.worldSizeId]
 */
export function createWorldEntry(opts) {
  opts = opts || {};
  const parsed = parseSeed(opts.seedInput);
  const sizeId = opts.worldSizeId || library.defaults.worldSizeId || 'standard';
  const preset = WORLD_SIZE_PRESETS.find(p => p.id === sizeId) || WORLD_SIZE_PRESETS[1];
  const diffId = opts.difficultyId || library.defaults.difficultyId || 'normal';
  const name = (opts.name && String(opts.name).trim()) || defaultWorldName();
  const id = newWorldId();
  const meta = {
    id,
    name,
    seed: parsed.seed,
    seedString: parsed.seedString || String(parsed.seed),
    difficultyId: getDifficulty(diffId).id,
    worldSizeId: preset.id,
    worldSize: preset.w,
    createdAt: Date.now(),
    lastPlayed: Date.now(),
    blocksMined: 0,
    distanceWalked: 0,
    circumnavigations: 0,
    milestones: 0,
    hasData: false,
  };
  library.worlds.push(meta);
  library.selectedWorldId = id;
  library.defaults.difficultyId = meta.difficultyId;
  library.defaults.worldSizeId = meta.worldSizeId;
  activeWorldId = id;
  writeLibrary();

  save = buildSaveFacade();
  save._payload = emptyPayload();
  save.world = null;
  save.player = null;
  save.inv = null;
  save.ents = null;
  save.hasWorld = false;
  save.seed = meta.seed;
  save.seedString = meta.seedString;
  save.difficultyId = meta.difficultyId;
  save.worldSizeId = meta.worldSizeId;
  save.worldSize = meta.worldSize;
  save.worldName = meta.name;
  save.worldId = id;
  return meta;
}

function defaultWorldName() {
  const n = library.worlds.length + 1;
  return 'New World' + (n > 1 ? ' ' + n : '');
}

export function renameWorld(id, name) {
  const meta = getWorldMeta(id);
  if (!meta) return false;
  const n = String(name || '').trim();
  if (!n) return false;
  meta.name = n.slice(0, 40);
  writeLibrary();
  if (activeWorldId === id) refreshSave();
  return true;
}

export function deleteWorld(id) {
  const idx = library.worlds.findIndex(w => w.id === id);
  if (idx < 0) return false;
  library.worlds.splice(idx, 1);
  removeWorldPayload(id);
  if (activeWorldId === id) {
    activeWorldId = library.worlds[0] ? library.worlds[0].id : null;
    library.selectedWorldId = activeWorldId;
    save = buildSaveFacade();
    save._payload = emptyPayload();
    save.world = null;
    save.hasWorld = false;
  }
  writeLibrary();
  return true;
}

/** Clear active payload without deleting meta (unused). */
export function clearWorldSave() {
  if (!activeWorldId) {
    save.hasWorld = false;
    save.world = null;
    save.player = null;
    save.inv = null;
    save.ents = null;
    return;
  }
  removeWorldPayload(activeWorldId);
  const meta = getWorldMeta(activeWorldId);
  if (meta) {
    meta.hasData = false;
    writeLibrary();
  }
  save._payload = emptyPayload();
  save.world = null;
  save.player = null;
  save.inv = null;
  save.ents = null;
  save.hasWorld = false;
}

/**
 * Persist current session into the active world slot.
 */
export function persistSession(world, player, inv, timeOfDay, stats, ents, difficultyId) {
  if (!activeWorldId) {
    // Create a slot if somehow missing
    createWorldEntry({
      name: 'World',
      seedInput: world && world.seed,
      difficultyId: difficultyId || 'normal',
      worldSizeId: library.defaults.worldSizeId,
    });
  }
  const meta = getWorldMeta(activeWorldId);
  if (!meta) return;

  const payload = {
    world: serializeWorld(world),
    player: {
      x: player.x,
      y: player.y,
      hp: player.hp,
      energy: player.energy,
      hunger: player.hunger,
      spawnX: player.spawnX,
      spawnY: player.spawnY,
      inBoat: !!player.inBoat,
    },
    inv: serializeInv(inv),
    ents: ents ? serializeEntities(ents) : null,
    timeOfDay,
  };

  const ok = writeWorldPayload(activeWorldId, payload);
  meta.hasData = ok;
  meta.lastPlayed = Date.now();
  meta.seed = world.seed;
  if (!meta.seedString) meta.seedString = String(world.seed >>> 0);
  meta.worldSize = world.w || WORLD_W;
  const preset = WORLD_SIZE_PRESETS.find(p => p.w === meta.worldSize);
  if (preset) meta.worldSizeId = preset.id;
  if (difficultyId) meta.difficultyId = difficultyId;
  if (stats) {
    meta.blocksMined = stats.blocksMined | 0;
    meta.distanceWalked = stats.distanceWalked || 0;
    meta.circumnavigations = stats.circumnavigations | 0;
    meta.milestones = stats.milestones | 0;
  }
  writeLibrary();

  save._payload = {
    world: payload.world,
    player: payload.player,
    inv: payload.inv,
    ents: payload.ents,
    timeOfDay,
  };
  save.hasWorld = true;
  save.world = payload.world;
  save.player = payload.player;
  save.inv = payload.inv;
  save.ents = payload.ents;
  save.timeOfDay = timeOfDay;
  save.seed = meta.seed;
  save.seedString = meta.seedString;
  save.difficultyId = meta.difficultyId;
  save.worldSizeId = meta.worldSizeId;
  save.worldSize = meta.worldSize;
  save.worldName = meta.name;
  if (stats) {
    save.blocksMined = stats.blocksMined | 0;
    save.distanceWalked = stats.distanceWalked || 0;
    save.circumnavigations = stats.circumnavigations | 0;
    save.milestones = stats.milestones | 0;
  }
}

/** Short line for world cards — never includes seed (seed lives in Edit). */
export function worldSummaryLine(meta) {
  if (!meta) return '';
  const diff = getDifficulty(meta.difficultyId);
  const size = WORLD_SIZE_PRESETS.find(p => p.id === meta.worldSizeId);
  const when = meta.lastPlayed ? formatRelativeTime(meta.lastPlayed) : '';
  return [
    diff.name,
    size ? size.name : (meta.worldSize + 'w'),
    when,
  ].filter(Boolean).join(' · ');
}

function formatRelativeTime(ts) {
  const sec = Math.max(0, (Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  if (sec < 86400 * 14) return Math.floor(sec / 86400) + 'd ago';
  try {
    return new Date(ts).toLocaleDateString();
  } catch (_) {
    return '';
  }
}

export { formatSeedDisplay, parseSeed };
