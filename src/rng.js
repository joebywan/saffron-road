/**
 * Deterministic PRNG (mulberry32) in two flavours:
 *   - pure:     nextFloat(state) -> [value, nextState]   for the engine's rngState
 *   - stateful: makeRng(seed) -> () => value             for bots / one-off shuffles
 * Same seed always produces the same game.
 */

/** @param {number} s @returns {[number, number]} [value in [0,1), next state] */
export function nextFloat(s) {
  s = (s + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** Integer in [0, n). @returns {[number, number]} */
export function nextInt(state, n) {
  const [v, s] = nextFloat(state);
  return [Math.floor(v * n), s];
}

/** Fisher-Yates. Does not mutate `arr`. @returns {[Array, number]} */
export function shuffle(arr, state) {
  const out = arr.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    let j;
    [j, s] = nextInt(s, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}

/** Stateful generator, for code that doesn't want to thread state. */
export function makeRng(seed) {
  let s = seed | 0;
  const rng = () => {
    let v;
    [v, s] = nextFloat(s);
    return v;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (arr) => arr[rng.int(arr.length)];
  rng.shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  rng.state = () => s;
  return rng;
}

/** A fresh non-deterministic seed for "new game" buttons. */
export function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff) | 0) >>> 0;
}
