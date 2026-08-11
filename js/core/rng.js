/** Mulberry32 seeded PRNG. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, seed) {
  let n = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967296;
}

/** Value noise 1D for heightmap (smooth). */
export function valueNoise1D(x, seed, scale) {
  const sx = x / scale;
  const i = Math.floor(sx);
  const f = sx - i;
  const u = f * f * (3 - 2 * f);
  const a = hash2(i, 0, seed);
  const b = hash2(i + 1, 0, seed);
  return a * (1 - u) + b * u;
}

/** 2D value noise for caves. */
export function valueNoise2D(x, y, seed, scale) {
  const sx = x / scale;
  const sy = y / scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const fx = sx - ix;
  const fy = sy - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(ix, iy, seed);
  const n10 = hash2(ix + 1, iy, seed);
  const n01 = hash2(ix, iy + 1, seed);
  const n11 = hash2(ix + 1, iy + 1, seed);
  const nx0 = n00 * (1 - ux) + n10 * ux;
  const nx1 = n01 * (1 - ux) + n11 * ux;
  return nx0 * (1 - uy) + nx1 * uy;
}
