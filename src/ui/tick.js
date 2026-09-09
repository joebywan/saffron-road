/**
 * NUMBERS THAT ARRIVE RATHER THAN APPEAR.
 *
 * A count that jumps from 7 to 5 between two frames is a change you can only
 * notice by having been looking at that exact number. A count that runs 7, 6,
 * 5 over a quarter of a second is a change you catch out of the corner of your
 * eye — which is the whole difficulty with several bots moving in a row.
 *
 * THE STATE IS ALWAYS ALREADY TRUE. This lags nothing but the DISPLAY: the
 * engine has applied the move, legality is computed from the real state, and
 * every decision anywhere in the app reads that state and not what is painted.
 * If an animation is interrupted, the screen snaps to the truth immediately.
 * There is no path in which a number that is mid-tick is treated as real.
 *
 * How it survives a wholesale repaint: the animation is keyed by a STRING, not
 * by a node. render.js rebuilds regions from scratch, so a node captured when
 * the tick started is detached a frame later. Each frame this looks up whoever
 * currently carries `data-tick="<key>"` and writes into that, so a repaint
 * mid-tick is simply the next frame landing somewhere else.
 */

/** key -> { from, to, at (ms), value } for everything currently in motion. */
const live = new Map();
/** key -> the value the screen is currently showing. */
const shown = new Map();

/** Long enough to read as movement, short enough not to be in the way. */
const TICK_MS = 280;
/** Above this the run would be a blur rather than a count, so it just lands. */
const TICK_MAX_STEP = 12;

let frame = 0;

function reduced() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/**
 * A hidden document does not run requestAnimationFrame AT ALL, so a tick
 * started while the tab is in the background would paint its first frame — the
 * OLD number — and then never take another. The screen would sit there showing
 * a stale count next to a state that had moved on, which is the one thing this
 * module must never do. So while hidden, numbers simply land.
 */
function canAnimate() {
  if (reduced()) return false;
  try {
    return !document.hidden;
  } catch {
    return true;
  }
}

/** Write `value` into the node's number, wherever that lives. */
function paint(node, value) {
  // A count on a resource is an SVG <text> inside the token; everything else is the
  // element's own text.
  const target = node.querySelector('.token-num') || node;
  const next = String(value);
  if (target.textContent !== next) target.textContent = next;
}

function nodeFor(key) {
  return document.querySelector(`[data-tick="${key.replace(/["\\]/g, (c) => `\\${c}`)}"]`);
}

function step() {
  frame = 0;
  const now = performance.now();
  for (const [key, run] of live) {
    const t = Math.min(1, (now - run.at) / TICK_MS);
    // Ease out: most of the distance early, so the last digit settles rather
    // than snapping.
    const eased = 1 - (1 - t) * (1 - t);
    const value = Math.round(run.from + (run.to - run.from) * eased);
    shown.set(key, t >= 1 ? run.to : value);
    const node = nodeFor(key);
    if (node) paint(node, shown.get(key));
    if (t >= 1) live.delete(key);
  }
  if (live.size) frame = requestAnimationFrame(step);
}

/**
 * Bring every `[data-tick]` number on screen up to date, running the ones that
 * changed rather than jumping them.
 *
 * Call it after a render. Nodes carry `data-tick` (a stable key) and
 * `data-tick-to` (the true value); the value already painted into the markup
 * is the truth, so an interrupted tick or a reduced-motion setting shows the
 * real number and nothing has to be undone.
 */
export function runTicks(root = document) {
  const nodes = root.querySelectorAll('[data-tick]');
  const skip = !canAnimate();
  const now = performance.now();
  const seen = new Set();

  for (const node of nodes) {
    const key = node.getAttribute('data-tick');
    const to = Number(node.getAttribute('data-tick-to'));
    if (!key || !Number.isFinite(to)) continue;
    seen.add(key);

    if (skip) {
      shown.set(key, to);
      live.delete(key);
      continue;
    }
    const from = shown.has(key) ? shown.get(key) : to;
    if (from === to) {
      // Already there — but a tick may be running towards a value this render
      // has just superseded, so cancel it and hold what is true.
      const run = live.get(key);
      if (run && run.to !== to) {
        live.delete(key);
        shown.set(key, to);
      } else if (!run) {
        shown.set(key, to);
      }
      continue;
    }
    if (Math.abs(to - from) > TICK_MAX_STEP) {
      shown.set(key, to);
      live.delete(key);
      continue;
    }
    live.set(key, { from, to, at: now });
    paint(node, from);
  }

  // Anything that has left the screen stops being tracked, so a new game does
  // not tick the old game's numbers down to the new ones.
  for (const key of [...shown.keys()]) if (!seen.has(key)) shown.delete(key);
  for (const key of [...live.keys()]) if (!seen.has(key)) live.delete(key);

  if (live.size && !frame) frame = requestAnimationFrame(step);
}

/**
 * Forget everything. A new game, or leaving the board: the next numbers on
 * screen are unrelated to the last ones and must not be counted towards.
 */
export function resetTicks() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  live.clear();
  shown.clear();
}

/**
 * A hidden tab does not paint and its timers are throttled, so a tick started
 * before it was backgrounded would land minutes later, mid-move. Drop them and
 * show the truth instead.
 */
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', () => {
    // Both directions land on the truth: going away, because nothing will
    // paint; coming back, because whatever was in flight is now stale by
    // however long the tab was gone.
    for (const [key, run] of live) {
      shown.set(key, run.to);
      const node = nodeFor(key);
      if (node) paint(node, run.to);
    }
    live.clear();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  });
}
