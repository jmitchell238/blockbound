/**
 * Cheat catalog — data only, mirroring the style of content/ modules.
 * Cheats make the game easier and are meant for building and playing around.
 */

export const CHEATS = [
  { id: 'daytime', name: 'Always Daytime', icon: '☀️', blurb: 'Jump straight to morning' },
  { id: 'heal',    name: 'Heal & Feed',    icon: '❤️', blurb: 'Refill hearts and food' },
  { id: 'build',   name: 'Instant Builds', icon: '🏠', blurb: 'Place whole houses and fountains' },
];

/**
 * Lookup a cheat by id. Returns the cheat object or null if not found.
 * @param {string} id
 * @returns {object|null}
 */
export function getCheat(id) {
  return CHEATS.find(c => c.id === id) || null;
}
