/**
 * Bundles the ES-module app into ONE self-contained index.single.html.
 * No dependencies. Works because the codebase follows two rules:
 *   - named exports only (no `export default`)
 *   - no circular imports
 *
 * Modules are wrapped in a tiny registry rather than concatenated, so each
 * module keeps its own scope and top-level names can't collide.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const ENTRY = resolve(ROOT, 'src/ui/app.js');

const IMPORT_RE = /^[ \t]*import\s+([\s\S]*?)\s+from\s*['"](\.[^'"]+)['"]\s*;?[ \t]*$/gm;
const BARE_IMPORT_RE = /^[ \t]*import\s*['"](\.[^'"]+)['"]\s*;?[ \t]*$/gm;

/** Collect the module graph in dependency-first order. */
async function collect(entry, seen = new Map(), order = []) {
  const abs = resolve(entry);
  if (seen.has(abs)) return order;
  const src = await readFile(abs, 'utf8');
  seen.set(abs, src);
  const deps = new Set();
  for (const m of src.matchAll(IMPORT_RE)) deps.add(resolve(dirname(abs), m[2]));
  for (const m of src.matchAll(BARE_IMPORT_RE)) deps.add(resolve(dirname(abs), m[1]));
  for (const d of deps) await collect(d, seen, order);
  order.push({ abs, src });
  return order;
}

/** Rewrite ESM syntax into registry calls. */
function transform(abs, src) {
  const key = (p) => relative(ROOT, p).split('\\').join('/');
  let out = src;

  if (/^\s*export\s+default\b/m.test(out)) {
    throw new Error(`${key(abs)}: 'export default' is not supported by the bundler`);
  }

  out = out.replace(IMPORT_RE, (_all, clause, spec) => {
    const dep = JSON.stringify(key(resolve(dirname(abs), spec)));
    const c = clause.trim();
    if (c.startsWith('*')) {
      const ns = c.replace(/^\*\s*as\s*/, '');
      return `const ${ns} = __req(${dep});`;
    }
    // { a, b as c }  ->  destructuring with rename
    const inner = c.replace(/^\{|\}$/g, '').trim();
    if (!inner) return `__req(${dep});`;
    const names = inner
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\s+as\s+/, ': '))
      .join(', ');
    return `const { ${names} } = __req(${dep});`;
  });

  out = out.replace(BARE_IMPORT_RE, (_all, spec) =>
    `__req(${JSON.stringify(key(resolve(dirname(abs), spec)))});`);

  // `export { a, b as c };` -> record for the tail
  const reexports = [];
  out = out.replace(/^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (_all, inner) => {
    for (const part of inner.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [local, exported = local] = part.split(/\s+as\s+/).map((s) => s.trim());
      reexports.push([exported, local]);
    }
    return '';
  });

  // `export const X` / `export function X` / `export class X`
  const named = [];
  out = out.replace(
    /^[ \t]*export\s+(const|let|var|function\*?|async\s+function\*?|class)\s+([A-Za-z_$][\w$]*)/gm,
    (_all, kind, name) => {
      named.push(name);
      return `${kind} ${name}`;
    },
  );

  const assigns = [...named.map((n) => [n, n]), ...reexports]
    .map(([exported, local]) => `  __x[${JSON.stringify(exported)}] = ${local};`)
    .join('\n');

  return `__mod(${JSON.stringify(key(abs))}, (__x) => {\n${out}\n${assigns}\n});`;
}

const modules = await collect(ENTRY);
const runtime = `
const __reg = {}, __cache = {};
function __mod(id, fn) { __reg[id] = fn; }
function __req(id) {
  if (id in __cache) return __cache[id];
  const x = (__cache[id] = {});
  const fn = __reg[id];
  if (!fn) throw new Error('module not bundled: ' + id);
  fn(x);
  return x;
}`.trim();

const body = [runtime, ...modules.map((m) => transform(m.abs, m.src)),
  `__req(${JSON.stringify(relative(ROOT, ENTRY).split('\\').join('/'))});`].join('\n\n');

const html = await readFile(join(ROOT, 'index.html'), 'utf8');
const css = await readFile(join(ROOT, 'styles.css'), 'utf8');

/**
 * PWA WIRING IS NOT BUNDLED. index.single.html is opened by double-clicking
 * it, and a file:// page has no origin to install to, no secure context and
 * no sw.js sitting beside it. index.html marks that block off so it can be
 * lifted out cleanly here — src/ui/pwa.js then sees no <link rel="manifest">
 * and skips registration, which is what keeps the promise that the
 * single-file build makes no network requests at all.
 *
 * WHICH IS ALSO WHY NOTHING HERE STAMPS A SERVICE WORKER VERSION. sw.js is not
 * part of this bundle and never runs beside it; the file IS the version, and
 * you update it by replacing it. The other three delivery paths do stamp — see
 * tools/version.js and android/app/build.gradle.
 */
const PWA_BLOCK = /[ \t]*<!--\s*pwa:begin[\s\S]*?pwa:end\s*-->[ \t]*\n?/g;

/** Build the page with `artPayload` (possibly '') spliced in ahead of the app. */
function assemble(artPayload) {
  const js = artPayload ? `${artPayload}\n\n${body}` : body;
  return html
    .replace(PWA_BLOCK, '')
    .replace(/<link[^>]+href=["']\.?\/?styles\.css["'][^>]*>/i, `<style>\n${css}\n</style>`)
    .replace(/<script[^>]*type=["']module["'][^>]*><\/script>/i, `<script>\n${js}\n</script>`);
}

const single = assemble('');

if (single.includes('styles.css') || /src=["'][^"']*app\.js/.test(single)) {
  throw new Error('bundle failed: index.html still references external files');
}
// Markup only: src/ui/pwa.js legitimately mentions the manifest and sw.js in
// its own source, which is inlined into the page.
if (/pwa:begin/.test(single) || /<(?:link|meta)\b[^>]*(?:rel=["']?manifest|apple-touch-icon|apple-mobile-web-app)/i.test(single)) {
  throw new Error('bundle failed: index.single.html still carries the PWA block');
}

const outPath = join(ROOT, 'index.single.html');
await writeFile(outPath, single);
console.log(`bundled ${modules.length} modules -> ${relative(ROOT, outPath)} (${(single.length / 1048576).toFixed(2)} MB)`);

