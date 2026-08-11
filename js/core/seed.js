/**
 * World seed helpers — numbers or free-text seeds (Minecraft-style).
 */

/** FNV-1a style hash → uint32 */
export function hashStringToSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0) || 1;
}

/**
 * Parse a seed field.
 * - empty / whitespace → random seed, seedString ''
 * - integer string → that number (uint32)
 * - any other text → hashed to uint32, seedString kept as typed
 *
 * @param {string|number|null|undefined} input
 * @returns {{ seed: number, seedString: string, random: boolean }}
 */
export function parseSeed(input) {
  if (input == null) {
    const seed = randomSeed();
    return { seed, seedString: String(seed), random: true };
  }
  const raw = String(input).trim();
  if (!raw) {
    const seed = randomSeed();
    return { seed, seedString: String(seed), random: true };
  }
  // Pure integer (optional leading -)
  if (/^-?\d+$/.test(raw)) {
    let n = Number(raw);
    // JS bit ops force int32; keep uint32 space for mulberry
    n = (n >>> 0) || 1;
    return { seed: n, seedString: raw, random: false };
  }
  return { seed: hashStringToSeed(raw), seedString: raw, random: false };
}

export function randomSeed() {
  return ((Math.random() * 0x7fffffff) | 0) || 1;
}

/** Display string for UI (prefer original text seed if present). */
export function formatSeedDisplay(seed, seedString) {
  if (seedString != null && String(seedString).trim() !== '') return String(seedString);
  if (seed != null) return String(seed >>> 0);
  return '—';
}
