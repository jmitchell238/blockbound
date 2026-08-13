/** Engine constants — version, viewport, physics. Content catalogs live in content/. */

export const GAME_VERSION = '1.9.072';
export const GAME_VERSION_LABEL = 'v' + GAME_VERSION;
export const GAME_NAME = 'Blockbound';

/**
 * Logical stage size in CSS pixels. Mutable for portrait / landscape.
 * Importers use live bindings (`import { W, H }`) — reassign via applyViewport().
 */
export let W = 390;
export let H = 700;
/** 'portrait' | 'landscape' */
export let ORIENTATION = 'portrait';

export const SAVE_KEY = 'blockbound-save-v4'; // legacy single-world
export const LIBRARY_KEY = 'blockbound-library-v1';
export function worldDataKey(id) {
  return 'blockbound-w-' + id;
}

/** Logical tile size in pixels (render scale can differ slightly). */
export const TILE = 28;

/**
 * Fit logical W×H to the window aspect (letterbox scale is applied in main).
 * Portrait keeps a phone-like width; landscape keeps a short height and grows width.
 */
export function applyViewport(winW, winH) {
  winW = Math.max(1, winW | 0);
  winH = Math.max(1, winH | 0);
  if (winW > winH) {
    ORIENTATION = 'landscape';
    H = 400;
    W = Math.round(H * (winW / winH));
    W = Math.max(640, Math.min(1100, W));
  } else {
    ORIENTATION = 'portrait';
    W = 390;
    H = Math.round(W * (winH / winW));
    H = Math.max(600, Math.min(920, H));
  }
  return { W, H, ORIENTATION };
}

export const WORLD_H = 128;

/** Approximate sea / surface band (from top). */
export const SURFACE_Y = 36;
/** Magma starts near the bottom (impassable heat zone). */
export const MAGMA_Y = WORLD_H - 8;
/** Hard sky ceiling — cannot place/fly above this (y = 0 is space edge). */
export const SKY_LIMIT = 2;

/**
 * Light update / torch flood radius (tiles) around edits.
 * Must be >= brightest emitter (lantern = 14) so light fully spreads.
 */
export const LIGHT_RADIUS = 16;

export const GRAVITY = 2100;
export const MOVE_SPEED = 155;
export const JUMP_VEL = -540;
export const MAX_FALL = 900;
export const COYOTE = 0.1;
export const JUMP_BUFFER = 0.12;
export const REACH = 4.2; // tiles

/** Day length in seconds (full cycle). */
export const DAY_LEN = 480;
