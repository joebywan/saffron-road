/**
 * TOKEN ARTWORK — original inline SVG, drawn from scratch in this file.
 *
 * Six trade goods: saffron threads, a peppercorn cluster, a cardamom pod, a
 * cake of indigo, a cinnamon quill, and a milled coin for the wild. Nothing
 * here traces or embeds anyone's illustrations; it is polygons in a 24x24 box.
 *
 * COLOUR-BLIND POLICY: colour is NEVER the only cue. The six have deliberately
 * different OUTLINES — three loose threads / a three-lobed cluster / a pointed
 * pod / a squat wide block / a tall narrow capsule / a circle — so the set
 * still separates when rendered as flat black silhouettes. That silhouette
 * plus the accessible name IS the fallback.
 *
 * The set was settled against tools/reskin-check.html, which renders every
 * shape at the size the phone actually draws it. Three things it decided:
 *   - saffron stays LINE ART. It is the only stroke shape in a set of solids,
 *     which makes it the most distinctive outline of the six. The count is
 *     legible over it because the glyph carries its own halo (see below) — a
 *     shape with no interior is only a problem for the harsher knocked-out
 *     silhouette, which is a test state and never ships.
 *   - indigo is squat and wide where cinnamon is tall and narrow. Aspect ratio
 *     is what separates them; as two vertical blocks they were the same shape.
 *   - pepper is a warm grey, not near-black. Near-black on a near-black tile
 *     read as a hole at pip size.
 *
 * Colours come from CSS custom properties so both themes can retune them:
 * --t-mid (the body), --t-lite (one lit face), --t-deep (one shaded face),
 * --t-rim (the outline), --t-ink/--t-halo for the count.
 */

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * WHERE A COUNT SITS ON EACH SHAPE.
 *
 * The number rides ON the token rather than beside it, which halves the width
 * of a pip and roughly doubles the size the token can be in the same box. Each
 * shape therefore has to declare where its body actually is: `cy` is the
 * middle of the MASS, not of the 24x24 box, and `w` is how wide a two-digit
 * count may be before it condenses rather than overflowing.
 */
export const TOKEN_NUMBER = {
  // Threads: the halo does the work, so the digits sit dead centre.
  saffron: { cx: 12, cy: 12, size: 9.5, w: 11 },
  // The cluster's centre of mass sits a little low, between the three lobes.
  pepper: { cx: 12, cy: 12.2, size: 9.5, w: 12 },
  // A pointed pod is widest at the middle and narrows fast above and below.
  cardamom: { cx: 12, cy: 12, size: 10, w: 12 },
  // Squat and wide: the roomiest body of the six.
  indigo: { cx: 12, cy: 13.6, size: 10.5, w: 13.5 },
  // 9.6 units across, so this is the shape that condenses soonest.
  cinnamon: { cx: 12, cy: 12, size: 9, w: 8.4 },
  coin: { cx: 12, cy: 12, size: 10.5, w: 12 },
};

/** Below this the shading pass is dropped; only body, rim and count survive. */
export const DETAIL_MIN = 20;

/* ------------------------------------------------------------------ */
/* The six shapes                                                      */
/* ------------------------------------------------------------------ */

const THREADS = [
  'M7.5 4.5 Q11 12 9 19.5',
  'M12 4 Q13.2 12 12 20',
  'M16.5 4.5 Q13 12 15 19.5',
];
const THREAD_W = 2.6;

const PEPPERCORNS = [
  [8.8, 9, 5.1],
  [15.6, 10.4, 5.1],
  [11.9, 16.4, 5.1],
];

const POD = 'M12 2.2 Q20.6 12 12 21.8 Q3.4 12 12 2.2 Z';
const POD_SEAM = 'M12 4.4 L12 19.6';
const CAKE = 'M3.6 20.8 L20.4 20.8 L18.4 6.4 L5.6 6.4 Z';
const CAKE_TOP = 'M5.6 6.4 L18.4 6.4 L18.1 9.2 L5.9 9.2 Z';
const QUILL = 'M7.2 3.6 h9.6 a4.8 4.8 0 0 1 4.8 4.8 v7.2 a4.8 4.8 0 0 1 -4.8 4.8 h-9.6 '
  + 'a4.8 4.8 0 0 1 -4.8 -4.8 v-7.2 a4.8 4.8 0 0 1 4.8 -4.8 Z';
const QUILL_ROLL = 'M9.6 4.2 Q7.2 12 9.6 19.8';
const COIN_R = 10.6;
const COIN_RING_R = 7.4;

/**
 * Each token declares two renderers, because the set is not homogeneous:
 * five are filled bodies and saffron is strokes, and a silhouette built by
 * handing one `fill` attribute to everything would render saffron invisible.
 *
 *   paint(fill, rim, lite, deep, detail) — the coloured token
 *   flat(colour)                        — the bare silhouette
 */
const ART = {
  saffron: {
    paint: (fill, rim, lite, deep, detail) =>
      // The rim is a wider stroke UNDER the body stroke: on line art there is
      // no inside for an outline to sit against, so it has to be a backing.
      THREADS.map((d) => `<path d="${d}" fill="none" stroke="${rim}" stroke-width="${THREAD_W + 1.1}" stroke-linecap="round"/>`).join('')
      + THREADS.map((d) => `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${THREAD_W}" stroke-linecap="round"/>`).join('')
      + (detail
        ? `<path d="${THREADS[1]}" fill="none" stroke="${lite}" stroke-width="1" stroke-linecap="round" opacity=".8"/>`
        : ''),
    flat: (c) =>
      THREADS.map((d) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${THREAD_W}" stroke-linecap="round"/>`).join(''),
  },

  pepper: {
    paint: (fill, rim, lite, deep, detail) =>
      PEPPERCORNS.map(([cx, cy, r], i) =>
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${i === 2 ? deep : fill}" stroke="${rim}" stroke-width="1.1"/>`
        + (detail ? `<circle cx="${r2(cx - r * 0.32)}" cy="${r2(cy - r * 0.34)}" r="${r2(r * 0.3)}" fill="${lite}" opacity=".7"/>` : '')).join(''),
    flat: (c) => PEPPERCORNS.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`).join(''),
  },

  cardamom: {
    paint: (fill, rim, lite, deep, detail) =>
      `<path d="${POD}" fill="${fill}" stroke="${rim}" stroke-width="1.2" stroke-linejoin="round"/>`
      + (detail
        ? `<path d="M12 2.2 Q20.6 12 12 21.8 Z" fill="${deep}" opacity=".55"/>`
          + `<path d="${POD_SEAM}" fill="none" stroke="${lite}" stroke-width="1" opacity=".75"/>`
        : ''),
    flat: (c) => `<path d="${POD}" fill="${c}"/>`,
  },

  indigo: {
    paint: (fill, rim, lite, deep, detail) =>
      `<path d="${CAKE}" fill="${fill}" stroke="${rim}" stroke-width="1.2" stroke-linejoin="round"/>`
      + (detail ? `<path d="${CAKE_TOP}" fill="${lite}" opacity=".85"/>` : ''),
    flat: (c) => `<path d="${CAKE}" fill="${c}"/>`,
  },

  cinnamon: {
    paint: (fill, rim, lite, deep, detail) =>
      `<path d="${QUILL}" fill="${fill}" stroke="${rim}" stroke-width="1.2" stroke-linejoin="round"/>`
      + (detail
        ? `<path d="${QUILL}" fill="${deep}" opacity=".35" clip-path="inset(0 0 0 50%)"/>`
          + `<path d="${QUILL_ROLL}" fill="none" stroke="${lite}" stroke-width="1.1" opacity=".8"/>`
        : ''),
    flat: (c) => `<path d="${QUILL}" fill="${c}"/>`,
  },

  coin: {
    paint: (fill, rim, lite, deep, detail) =>
      `<circle cx="12" cy="12" r="${COIN_R}" fill="${fill}" stroke="${rim}" stroke-width="1.2"/>`
      + (detail
        ? `<circle cx="12" cy="12" r="${COIN_RING_R}" fill="none" stroke="${deep}" stroke-width="1.4" opacity=".6"/>`
          + `<path d="M5.6 7.4 A ${COIN_R} ${COIN_R} 0 0 1 16.6 3.6" fill="none" stroke="${lite}" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>`
        : ''),
    flat: (c) => `<circle cx="12" cy="12" r="${COIN_R}" fill="${c}"/>`,
  },
};

export const TOKEN_SHAPES = Object.keys(ART);

/* ------------------------------------------------------------------ */
/* Markup                                                              */
/* ------------------------------------------------------------------ */

/**
 * The count, drawn on the token.
 *
 * CONTRAST IS NOT LEFT TO LUCK. The digits land on bodies whose tones run from
 * a warm grey to a deep indigo, in two themes, so nothing about what is under
 * a given digit can be assumed. The glyph is stroked with --t-halo under
 * `paint-order: stroke`, which paints a thick halo in the token's own paired
 * scrim colour BEHIND the fill: the ink is only ever seen against that halo.
 *
 * A halo shaped like the glyph — rather than a plate behind it — is what makes
 * this work on SAFFRON at all. The threads have no interior; the halo is the
 * background the digits stand on, and it is why line art survives here.
 */
function numberMarkup(token, text) {
  const n = TOKEN_NUMBER[token];
  const fit = text.length > 1 ? ` textLength="${n.w}" lengthAdjust="spacingAndGlyphs"` : '';
  return (
    `<text class="token-num" x="${n.cx}" y="${r2(n.cy + n.size * 0.355)}" `
    + `font-size="${n.size}"${fit} text-anchor="middle" `
    + 'stroke="var(--t-halo)" fill="var(--t-ink)">'
    + text
    + '</text>'
  );
}

/**
 * The markup for one token, as an SVG string.
 * @param {string} token   saffron|pepper|cardamom|indigo|cinnamon|coin
 * @param {number} size    rendered pixel size; drives the detail level
 * @param {number|string|null} [count]  a count drawn ON the token; null for none
 * @returns {string}
 */
export function tokenSvgMarkup(token, size, count = null) {
  const detail = size >= DETAIL_MIN;
  const counted = count !== null && count !== undefined;
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" `
    + 'focusable="false" class="token-svg" shape-rendering="geometricPrecision">'
    + ART[token].paint('var(--t-mid)', 'var(--t-rim)', 'var(--t-lite)', 'var(--t-deep)', detail)
    + (counted ? numberMarkup(token, String(count)) : '')
    + '</svg>'
  );
}

/**
 * The bare silhouette, used for the washed-out token printed behind card art
 * and for the black-on-white silhouette check. Fill comes from CSS.
 *
 * `count` knocks the digits back OUT of the shape. That is the worst case the
 * silhouette is asked to survive — no colour, no shading, no rim, and a hole
 * where the number is — and it is HARSHER THAN ANYTHING THAT SHIPS: the
 * silhouette the product actually draws carries no count. tools/silhouette.html
 * and tools/reskin-check.html are that check.
 */
export function tokenSilhouetteMarkup(token, sizeAttrs = 'width="100%" height="100%"', count = null) {
  const num = TOKEN_NUMBER[token];
  const hasNum = count !== null && count !== undefined;
  const text = String(count).replace(/[^0-9]/g, '');
  const id = `gm-${token}-${text}`;
  return (
    `<svg viewBox="0 0 24 24" ${sizeAttrs} aria-hidden="true" focusable="false">`
    + (hasNum
      ? `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">`
        + '<rect x="0" y="0" width="24" height="24" fill="#fff"/>'
        + `<text class="token-num" x="${num.cx}" y="${r2(num.cy + num.size * 0.355)}" `
        + `font-size="${num.size}"`
        + (text.length > 1 ? ` textLength="${num.w}" lengthAdjust="spacingAndGlyphs"` : '')
        + ` text-anchor="middle" stroke="#000" fill="#000">${text}</text></mask>`
      : '')
    + `<g${hasNum ? ` mask="url(#${id})"` : ''}>${ART[token].flat('currentColor')}</g>`
    + '</svg>'
  );
}
