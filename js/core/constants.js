/** Engine constants — version, viewport, physics. Content catalogs live in content/. */

export const GAME_VERSION = '1.6.001';
export const GAME_VERSION_LABEL = 'v' + GAME_VERSION;
export const GAME_NAME = 'Blockbound';

export const W = 390;
export const H = 700;
export const SAVE_KEY = 'blockbound-save-v4';

/** Logical tile size in pixels (render scale can differ slightly). */
export const TILE = 28;

export const WORLD_H = 128;

/** Approximate sea / surface band (from top). */
export const SURFACE_Y = 36;
/** Magma starts near the bottom (impassable heat zone). */
export const MAGMA_Y = WORLD_H - 8;
/** Hard sky ceiling — cannot place/fly above this (y = 0 is space edge). */
export const SKY_LIMIT = 2;

/** Light update radius (tiles) around edits — keeps thousands-wide worlds smooth. */
export const LIGHT_RADIUS = 14;

export const GRAVITY = 2100;
export const MOVE_SPEED = 155;
export const JUMP_VEL = -540;
export const MAX_FALL = 900;
export const COYOTE = 0.1;
export const JUMP_BUFFER = 0.12;
export const REACH = 4.2; // tiles

/** Day length in seconds (full cycle). */
export const DAY_LEN = 480;
