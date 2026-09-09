/**
 * Generates every icon the app ships — the PWA set under icons/, and the
 * Android launcher icons under android/app/src/main/res/ — from the app's own
 * crocus mark, the same geometry as the favicon in index.html.
 *
 * No dependencies, and no binary assets checked in that nobody can regenerate:
 * this file rasterises the facets itself and writes the PNGs with node's
 * built-in zlib. `npm run icons` re-emits the lot. There is exactly one
 * definition of the mark, here, so the launcher icon can never drift from the
 * favicon or the install icons.
 *
 * TWO DIFFERENT SAFE ZONES, AND THEY ARE NOT THE SAME NUMBER.
 *
 * - A *web* maskable icon may be cropped to a circle of 80% of the icon's
 *   width, so everything meaningful has to sit inside a centred circle of
 *   radius 0.4 * size. The maskable variant puts the mark's circumradius at
 *   0.36 * size; the "any" icons run larger because nothing crops them.
 * - An *Android adaptive* icon is a 108dp canvas of which only the central
 *   72dp is ever shown and only the central 66dp circle is guaranteed — the
 *   launcher picks the mask, and OEMs pick different ones. That is a radius
 *   of 33/108 = 0.3055 * size, so the adaptive layers put the circumradius at
 *   0.30 and the extra margin is simply the price of the format.
 *
 * The legacy square/round mipmaps are for API 24–25, which predate adaptive
 * icons; those are drawn with the backdrop baked in because there is no
 * separate background layer to sit behind them.
 */
import { deflateSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'icons');
const ANDROID_RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');

/* ------------------------------------------------------------------ */
/* The mark                                                            */
/* ------------------------------------------------------------------ */

/**
 * THE MARK: a crocus, which is where saffron comes from.
 *
 * One filled petal mass with the three stigmas cut OUT of it as negative
 * space, rather than drawn on top. That matters at launcher sizes: a mark made
 * of separate thin strokes merges into a blob below about 64px, and a mark
 * whose detail is painted over the body loses that detail the moment a themed
 * launcher flattens it to a stencil. Cutting the stigmas means they survive
 * both — the monochrome layer keeps its three notches, and so does the flat
 * silhouette.
 *
 * The shapes it was chosen over, and what each turned out to read as at 48px,
 * are in tools/icon-candidates.html. Two of them were a chess pawn and the
 * universal user-profile glyph, which is the failure this mark exists to
 * avoid: a launcher icon has to survive being small, flat and out of context.
 */

/** Points along a quadratic Bézier, inclusive of both ends. */
function quadPts(p0, p1, p2, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
  return out;
}

/**
 * A quadratic curve as a closed polygon of the given half-width — the stroked
 * curve turned into something the polygon filler can test. Fuller in the
 * middle than at the ends, which is the shape a stigma actually is.
 */
function ribbon(p0, p1, p2, halfW, n = 24) {
  const left = [], right = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
    const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const len = Math.hypot(dx, dy) || 1;
    const w = halfW * (0.45 + 0.55 * Math.sin(Math.PI * t));
    const nx = (-dy / len) * w, ny = (dx / len) * w;
    left.push([x + nx, y + ny]);
    right.push([x - nx, y - ny]);
  }
  return left.concat(right.reverse());
}

/** The petal mass, six quadratics walked into one closed polygon. */
const PETAL = [
  quadPts([12, 22], [4.6, 17.6], [4.6, 11.2], 14),
  quadPts([4.6, 11.2], [4.6, 5.4], [8.4, 2.6], 14),
  quadPts([8.4, 2.6], [10, 6], [12, 6], 10),
  quadPts([12, 6], [14, 6], [15.6, 2.6], 10),
  quadPts([15.6, 2.6], [19.4, 5.4], [19.4, 11.2], 14),
  quadPts([19.4, 11.2], [19.4, 17.6], [12, 22], 14),
].flatMap((seg, i) => (i ? seg.slice(1) : seg));

/** A lit face on the upper left, kept well inside the petal so it cannot spill. */
const HIGHLIGHT = [
  quadPts([9.4, 4.6], [6.4, 7.4], [6.6, 12.4], 12),
  quadPts([6.6, 12.4], [7.4, 8], [10.2, 5.6], 12).slice(1),
].flat();

const STIGMAS = [
  ribbon([9.2, 9.2], [7.9, 14], [9.6, 18.8], 0.85),
  ribbon([12, 8.4], [12, 14], [12, 19.4], 0.9),
  ribbon([14.8, 9.2], [16.1, 14], [14.4, 18.8], 0.85),
];

// The app's saffron ramp.
const C = {
  petal: [0xd8, 0x55, 0x1f],
  lit: [0xf0, 0x86, 0x3c],
};

/**
 * Facets in paint order; later entries win. A `cut` facet is NEGATIVE SPACE —
 * the sampler treats it as uncovered, so it shows the backdrop on the web
 * icons and stays transparent on the adaptive foreground and the monochrome
 * stencil. That is what keeps the stigmas when the mark is flattened.
 */
const FACETS = [
  { pts: PETAL, fill: C.petal },
  { pts: HIGHLIGHT, fill: C.lit },
  ...STIGMAS.map((pts) => ({ pts, cut: true })),
];

/** Bounding box of the mark, and the centre + circumradius it implies. */
const BOX = {
  x0: Math.min(...PETAL.map((p) => p[0])),
  y0: Math.min(...PETAL.map((p) => p[1])),
  x1: Math.max(...PETAL.map((p) => p[0])),
  y1: Math.max(...PETAL.map((p) => p[1])),
};
const CX = (BOX.x0 + BOX.x1) / 2;
const CY = (BOX.y0 + BOX.y1) / 2;
const CIRCUMRADIUS = Math.max(
  ...PETAL.map(([x, y]) => Math.hypot(x - CX, y - CY)),
);


/* ------------------------------------------------------------------ */
/* Rasteriser                                                          */
/* ------------------------------------------------------------------ */

const SS = 4; // supersampling factor per axis

function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * @param {number} size            edge length in px
 * @param {number} markPx          the mark's circumradius in px
 * @param {object} [opts]
 * @param {boolean} [opts.backdrop=true]  paint the dark gradient behind the
 *   mark. Off gives a transparent field, which is what an adaptive icon's
 *   foreground layer and a themed (monochrome) layer both need.
 * @param {boolean} [opts.circle=false]   clip to the inscribed circle, for the
 *   legacy round launcher icon on API 24–25.
 * @param {number[]} [opts.flat]          paint every facet this one colour,
 *   collapsing the mark to a silhouette. The themed icon is a stencil the
 *   launcher recolours, so its facets would only muddy the tint.
 * @returns {Buffer} RGBA pixels, row-major
 */
function draw(size, markPx, opts = {}) {
  const { backdrop = true, circle = false, flat = null } = opts;
  const scale = markPx / CIRCUMRADIUS;
  const px = FACETS.map((f) => ({
    // A cut stays a cut even in flat mode: the stencil keeps its notches.
    cut: !!f.cut,
    fill: flat || f.fill,
    pts: f.pts.map(([x, y]) => [size / 2 + (x - CX) * scale, size / 2 + (y - CY) * scale]),
    box: null,
  }));
  for (const f of px) {
    const xs = f.pts.map((p) => p[0]);
    const ys = f.pts.map((p) => p[1]);
    f.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  const out = Buffer.alloc(size * size * 4);
  const samples = SS * SS;
  const clipR = size / 2;
  for (let y = 0; y < size; y++) {
    // Backdrop: a slight top-to-bottom lift, the same move the app's dark
    // palette makes between --bg-panel and --bg.
    const t = y / (size - 1);
    const bg = [
      Math.round(0x19 + (0x0b - 0x19) * t),
      Math.round(0x20 + (0x0f - 0x20) * t),
      Math.round(0x2b + (0x15 - 0x2b) * t),
    ];
    for (let x = 0; x < size; x++) {
      // Colours are averaged over the COVERED subsamples only and alpha is
      // their share of the total. Averaging over all of them instead would
      // premultiply against black and fringe every transparent edge grey.
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        const py = y + (sy + 0.5) / SS;
        for (let sx = 0; sx < SS; sx++) {
          const pxx = x + (sx + 0.5) / SS;
          if (circle && Math.hypot(pxx - clipR, py - clipR) > clipR) continue;
          let c = null;
          for (let i = px.length - 1; i >= 0; i--) {
            const f = px[i];
            if (pxx < f.box[0] || pxx > f.box[2] || py < f.box[1] || py > f.box[3]) continue;
            if (inside(f.pts, pxx, py)) { c = f.cut ? null : f.fill; break; }
          }
          if (!c) {
            if (!backdrop) continue; // transparent field
            c = bg;
          }
          r += c[0]; g += c[1]; b += c[2]; hits++;
        }
      }
      const o = (y * size + x) * 4;
      if (!hits) continue; // Buffer.alloc already left it 0,0,0,0
      out[o] = Math.round(r / hits);
      out[o + 1] = Math.round(g / hits);
      out[o + 2] = Math.round(b / hits);
      out[o + 3] = Math.round((hits / samples) * 255);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* PNG encoder                                                         */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // 10..12: deflate / adaptive filtering / no interlace, all zero already

  // Filter type 0 on every scanline. The art is flat facets, so zlib finds
  // plenty to chew on without per-line filter heuristics.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */

/** Write one PNG and say so. */
async function emit(dir, name, size, radius, opts) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  const buf = png(size, draw(size, size * radius, opts));
  await writeFile(file, buf);
  console.log(`${relative(ROOT, file)} — ${size}x${size}, ${(buf.length / 1024).toFixed(1)} KB`);
}

/* ------------------------------------------------------------------ */
/* Web: icons/                                                         */
/* ------------------------------------------------------------------ */

// `any` icons are never cropped, so the mark can run large. The maskable one
// is pulled in to 0.36 * size — comfortably inside the web 0.4 safe circle.
const ICONS = [
  { name: 'icon-192.png', size: 192, radius: 0.44 },
  { name: 'icon-512.png', size: 512, radius: 0.44 },
  { name: 'icon-maskable-512.png', size: 512, radius: 0.36 },
  { name: 'apple-touch-icon-180.png', size: 180, radius: 0.42 },
];

for (const spec of ICONS) await emit(OUT, spec.name, spec.size, spec.radius, {});

/* ------------------------------------------------------------------ */
/* Android: android/app/src/main/res/                                  */
/* ------------------------------------------------------------------ */

/**
 * Density buckets, as multipliers on the dp figure. Nothing here is
 * conditional on the android/ project existing beyond the check below: a
 * clone that only wants the web icons should not be told off about a
 * directory it does not have.
 */
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
];

/** Adaptive layers are a 108dp canvas; legacy launcher icons are 48dp. */
const ADAPTIVE_DP = 108;
const LEGACY_DP = 48;

/**
 * Adaptive safe circle is 66dp of 108, i.e. radius 0.3055 * size. 0.30 sits
 * just inside it, so no launcher mask — circle, squircle, teardrop, whatever
 * the OEM ships — can clip a facet.
 */
const ADAPTIVE_R = 0.3;

async function android() {
  for (const [density, mult] of DENSITIES) {
    const dir = join(ANDROID_RES, `mipmap-${density}`);
    const big = Math.round(ADAPTIVE_DP * mult);
    const small = Math.round(LEGACY_DP * mult);

    // Adaptive foreground: transparent, the gradient lives in the background
    // layer (res/drawable/ic_launcher_background.xml) so the launcher can
    // parallax the two against each other.
    await emit(dir, 'ic_launcher_foreground.png', big, ADAPTIVE_R, { backdrop: false });
    // Themed icon: a white stencil the launcher tints. Facets would only
    // muddy a single-colour tint, so it is drawn flat.
    await emit(dir, 'ic_launcher_monochrome.png', big, ADAPTIVE_R, {
      backdrop: false,
      flat: [0xff, 0xff, 0xff],
    });
    // Legacy API 24–25: no adaptive icons there, so the backdrop is baked in
    // and the round variant is clipped here rather than by the launcher.
    await emit(dir, 'ic_launcher.png', small, 0.42, {});
    await emit(dir, 'ic_launcher_round.png', small, 0.4, { circle: true });
  }
}

if (existsSync(ANDROID_RES)) {
  await android();
} else {
  console.log(`(no ${relative(ROOT, ANDROID_RES)} — skipped the Android launcher icons)`);
}
