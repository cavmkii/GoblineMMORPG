// Seeded PRNG (mulberry32). Rules code takes an rng so outcomes are testable.
export function makeRng(seed = Date.now() >>> 0) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.weighted = (entries) => {
    // entries: [[value, weight], ...]
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total;
    for (const [v, w] of entries) {
      if ((r -= w) < 0) return v;
    }
    return entries[entries.length - 1][0];
  };
  return rng;
}
