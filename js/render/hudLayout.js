/**
 * Pure layout for the bottom HUD — hotbar tray, slots, and the status bars
 * that sit directly above them. No canvas, no browser globals, so the
 * geometry can be unit-tested in node.
 *
 * This module exists because the renderer and the hit-tester used to carry
 * their own copies of the hotbar numbers, and they had drifted: drawHUD drew
 * slot=42/gap=5 while handlePointer tested slot=40/gap=4. At W=640 that put a
 * tap at x=460 inside the drawn slot 7 but selected slot 8, and made the outer
 * edges of the first and last slots select nothing (bb-37u). Both sides now
 * read the numbers from here, so they cannot disagree again.
 */

export const HOTBAR_SLOT = 42;
export const HOTBAR_GAP = 5;

/** Height of the health / hunger bars. */
const BAR_H = 10;
/** Gap between the tray and the bar row. */
const BAR_LIFT = 8;
/** The energy sliver is deliberately thin — see `bars.energy` below. */
const ENERGY_H = 3;

/**
 * @param {number} W viewport width in render units
 * @param {number} H viewport height in render units
 * @param {number} hotbarSize number of hotbar slots
 */
export function hudLayout(W, H, hotbarSize) {
  const slot = HOTBAR_SLOT;
  const gap = HOTBAR_GAP;
  const total = hotbarSize * slot + (hotbarSize - 1) * gap;
  const hx = (W - total) / 2;
  const hy = H - 60;

  const tray = { x: hx - 8, y: hy - 8, w: total + 16, h: slot + 16 };

  const slots = [];
  for (let i = 0; i < hotbarSize; i++) {
    slots.push({ i, x: hx + i * (slot + gap), y: hy, w: slot, h: slot });
  }

  // Health left, hunger right, both riding just above the tray the way most
  // games put them. Each takes a bit under half the tray so they never touch.
  const barW = Math.min(132, (total - 16) / 2);
  const barsY = tray.y - BAR_LIFT - BAR_H;

  const bars = {
    hp: { x: hx, y: barsY, w: barW, h: BAR_H },
    hunger: { x: hx + total - barW, y: barsY, w: barW, h: BAR_H },
    // Energy gates sprinting, so hiding it entirely would slow a player down
    // with no visible cause. It gets a thin full-width sliver tucked between
    // the bars and the tray, drawn only while below full: invisible in normal
    // play, present exactly when it explains something. Its slot is reserved
    // whether or not it is drawn, so the bars above never jump.
    energy: { x: hx, y: barsY + BAR_H + 3, w: total, h: ENERGY_H },
  };

  return { slot, gap, total, hx, hy, tray, slots, bars };
}

/**
 * Which hotbar slot is at this point, or -1.
 * Callers still own the decision to swallow taps that land in the tray but
 * between slots — otherwise a tap in a gap would fall through and place a
 * block behind the hotbar.
 */
export function hotbarSlotAt(W, H, hotbarSize, x, y) {
  const L = hudLayout(W, H, hotbarSize);
  for (const s of L.slots) {
    if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return s.i;
  }
  return -1;
}
