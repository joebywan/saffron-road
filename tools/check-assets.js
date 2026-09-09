/**
 * Asserts that every file the web app actually needs made it into a target
 * directory — the Android APK's synced assets.
 *
 * The copy list in android/app/build.gradle is an ALLOWLIST. Add a file to the
 * web app and forget to list it and the app works perfectly in a browser while
 * 404-ing inside the APK, silently. This turns that into a build failure.
 *
 * Usage: node tools/check-assets.js <dir>
 */
import { readFile, access } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const target = process.argv[2];
if (!target) {
  console.error('usage: node tools/check-assets.js <dir>');
  process.exit(2);
}

const rel = (p) => relative(ROOT, p).split('\\').join('/');
const required = new Set();

/** Walk the ES module graph, exactly as the bundler does. */
const IMPORT_RE = /(?:^|\n)[ \t]*import\s+(?:[\s\S]*?\s+from\s*)?['"](\.[^'"]+)['"]/g;
async function walk(entry, seen = new Set()) {
  const abs = resolve(entry);
  if (seen.has(abs)) return;
  seen.add(abs);
  let src;
  try {
    src = await readFile(abs, 'utf8');
  } catch {
    return; // reported later as missing, if something referenced it
  }
  required.add(rel(abs));
  for (const m of src.matchAll(IMPORT_RE)) {
    await walk(resolve(dirname(abs), m[1]), seen);
  }
}

const html = await readFile(join(ROOT, 'index.html'), 'utf8');
required.add('index.html');

// Anything index.html pulls in by href/src, ignoring data: and absolute URLs.
for (const m of html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/g)) {
  const ref = m[1];
  if (/^(data:|https?:|#|mailto:)/.test(ref)) continue;
  required.add(ref.replace(/^\.?\//, ''));
}

// The service worker's precache list is the app's own statement of what the
// shell needs, so trust it as a source of truth.
try {
  const sw = await readFile(join(ROOT, 'sw.js'), 'utf8');
  for (const m of sw.matchAll(/['"]\.?\/?([\w./-]+\.(?:js|css|html|webmanifest|png|svg))['"]/g)) {
    required.add(m[1].replace(/^\.?\//, ''));
  }
  required.add('sw.js');
} catch { /* no service worker is fine */ }

// Manifest icons.
try {
  const mf = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of mf.icons || []) {
    if (icon.src && !/^(data:|https?:)/.test(icon.src)) {
      required.add(icon.src.replace(/^\.?\//, ''));
    }
  }
  required.add('manifest.webmanifest');
} catch { /* no manifest is fine */ }

await walk(join(ROOT, 'src/ui/app.js'));

const missing = [];
for (const f of [...required].sort()) {
  try {
    await access(join(target, f));
  } catch {
    missing.push(f);
  }
}

if (missing.length) {
  console.error(`\nMissing from ${target}:\n`);
  for (const m of missing) console.error(`  ${m}`);
  console.error(`
${missing.length} file(s) the web app needs were not copied.
Add them to the copy list that built this directory:
  android/app/build.gradle          for the Android APK\n`);
  process.exit(1);
}

console.log(`asset check: ${required.size} required files all present in ${relative(ROOT, target) || target}`);
