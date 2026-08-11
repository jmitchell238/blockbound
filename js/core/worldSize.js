/**
 * Mutable world circumference. applyWorldSize changes WORLD_W for gen/load.
 * Importers must read getWorldW() or the live WORLD_W binding via import.
 */

export const WORLD_SIZE_PRESETS = [
  { id: 'tour',     name: 'Tour',     w: 1024,  blurb: '~3 min lap',   default: false },
  { id: 'standard', name: 'Standard', w: 4096,  blurb: '~12 min lap',  default: true },
  { id: 'vast',     name: 'Vast',     w: 8192,  blurb: '~25 min lap',  default: false },
  { id: 'epic',     name: 'Epic',     w: 16384, blurb: 'Blockheads 1×', default: false },
];

/** Mutable so New World size / load can change circumference without rewrite. */
export let WORLD_W = 4096;

export function applyWorldSize(w) {
  const n = w | 0;
  const allowed = WORLD_SIZE_PRESETS.some(p => p.w === n);
  WORLD_W = allowed ? n : 4096;
  return WORLD_W;
}

export function worldSizePreset(idOrW) {
  return WORLD_SIZE_PRESETS.find(p => p.id === idOrW || p.w === idOrW)
    || WORLD_SIZE_PRESETS.find(p => p.default)
    || WORLD_SIZE_PRESETS[1];
}

export function getWorldW() {
  return WORLD_W;
}
