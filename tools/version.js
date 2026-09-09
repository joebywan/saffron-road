/**
 * Stamps a real version into the service worker.
 *
 * WHY THIS EXISTS. sw.js used to carry `const VERSION = 'v1'`, typed by hand
 * and never touched again. Two consequences, both invisible:
 *
 *   - the sw.js bytes were byte-identical every release, so no browser ever
 *     saw a service worker update, never re-ran install(), never re-precached;
 *   - the cache name never changed, so the shell cache from the very first
 *     install was still the one being served.
 *
 * An Android player reinstalled the app twice and kept running the JavaScript
 * from a release months old. So the version is DERIVED, here, and the thing it
 * is derived from is the shipping bytes themselves:
 *
 *     <base>-<8 hex of sha256 over the precached shell>
 *
 * `<base>` is the release tag when there is one (--version, or `git describe`),
 * and `dev` otherwise. The hash is the safety net: forget to tag, and the
 * version STILL changes the moment any shipped file does. There is no path
 * through this where a human forgetting something produces a stale version.
 *
 * USAGE
 *   node tools/version.js                     print the version for this tree
 *   node tools/version.js --write <dir>       stamp <dir>/sw.js in place
 *   node tools/version.js --check             sanity-check sw.js's placeholder
 *
 *   --version <base>   use this base instead of git (the release tag)
 *   --force            stamp even if <dir>/sw.js was already stamped
 *
 * STAMPING IS ONCE-ONLY BY DESIGN. Without --force this only replaces the
 * placeholder, so the paths compose: the release workflow stamps the checkout
 * with the tag, and the Android and Linux packagers then find it already done
 * and leave it alone, which is how the APK and the web build end up saying the
 * same thing. Run standalone, each packager stamps its own copy.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

/** The literal sw.js ships with. Kept in one place; sw.js has the only copy. */
export const PLACEHOLDER = '__APP_VERSION__';

/**
 * The declaration this rewrites. Matching the DECLARATION rather than the bare
 * token means a stamped file can be re-read, re-hashed and re-stamped, and
 * that a rename of the constant fails loudly here instead of silently
 * producing an unstamped worker.
 */
const DECL = /(const INJECTED_VERSION = ')([^']*)(')/;

/** Cache names go in a URL-ish key; keep the version boring. */
function sanitize(s) {
  return String(s).trim().replace(/[^A-Za-z0-9._+-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/** The files sw.js says make up the shell, read out of sw.js itself. */
export function shellFiles(swSource) {
  const block = swSource.match(/const SHELL_FILES = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error('sw.js: could not find the SHELL_FILES array');
  const files = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (files.length < 5) throw new Error(`sw.js: SHELL_FILES looks wrong (${files.length} entries)`);
  return files;
}

/**
 * A hash of exactly what will be served: every shell file, plus sw.js itself
 * with its version normalised back to the placeholder so that stamping a file
 * twice cannot change its own hash.
 */
export function contentHash(dir, swSource) {
  const h = createHash('sha256');
  const normalised = swSource.replace(DECL, `$1${PLACEHOLDER}$3`);
  h.update('sw.js\0');
  h.update(normalised);
  for (const file of shellFiles(swSource)) {
    // './' is the directory, served as index.html, which is in the list anyway.
    const rel = file === './' ? null : file.replace(/^\.\//, '');
    if (!rel) continue;
    const abs = join(dir, rel);
    h.update(`\0${rel}\0`);
    // A file that is not there is part of the truth about this build too, and
    // has to hash differently from one that is.
    h.update(existsSync(abs) ? readFileSync(abs) : Buffer.from('<absent>'));
  }
  return h.digest('hex').slice(0, 8);
}

/** The release tag, when this tree has one. */
function gitBase() {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'describe', '--tags', '--always', '--dirty'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null; // no git, or a tarball export — the hash still carries us
  }
}

/** `<base>-<hash>` for the app in `dir`. */
export function versionFor(dir, base) {
  const swPath = join(dir, 'sw.js');
  const src = readFileSync(swPath, 'utf8');
  const chosen = sanitize(base || process.env.SAFFRON_VERSION || gitBase() || 'dev');
  return `${chosen || 'dev'}-${contentHash(dir, src)}`;
}

/** Stamp dir/sw.js. Returns {version, changed, already}. */
export function stamp(dir, base, { force = false } = {}) {
  const swPath = join(dir, 'sw.js');
  const src = readFileSync(swPath, 'utf8');
  const found = src.match(DECL);
  if (!found) {
    throw new Error(
      `${swPath}: no \`const INJECTED_VERSION = '...'\` to stamp. ` +
        'If it was renamed, tools/version.js has to be renamed with it.',
    );
  }
  const current = found[2];
  if (current !== PLACEHOLDER && !force) {
    return { version: current, changed: false, already: true };
  }
  const version = versionFor(dir, base);
  writeFileSync(swPath, src.replace(DECL, `$1${version}$3`));
  return { version, changed: true, already: false };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? '';
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const base = arg('--version');
  const force = process.argv.includes('--force');

  if (process.argv.includes('--check')) {
    // The one thing that would make every injector above a silent no-op.
    const src = readFileSync(join(ROOT, 'sw.js'), 'utf8');
    const decl = src.match(DECL);
    const problems = [];
    if (!decl) problems.push("sw.js has no `const INJECTED_VERSION = '...'` declaration");
    else if (decl[2] !== PLACEHOLDER) {
      problems.push(`sw.js is committed already-stamped ('${decl[2]}'); it must ship the placeholder`);
    }
    // Prose may mention the placeholder as often as it likes; what must be
    // unambiguous is the DECLARATION every injector rewrites.
    const decls = src.split("const INJECTED_VERSION = '").length - 1;
    if (decls !== 1) problems.push(`expected exactly one INJECTED_VERSION declaration in sw.js, found ${decls}`);
    if (!/\/\^__\[A-Z_\]\+__\$\/\.test\(INJECTED_VERSION\)/.test(src)) {
      problems.push('sw.js lost the un-injected fallback that keeps `npm start` working');
    }
    try {
      shellFiles(src);
    } catch (err) {
      problems.push(err.message);
    }
    if (problems.length) {
      for (const p of problems) console.error(`sw version check: ${p}`);
      process.exit(1);
    }
    console.log(`sw version check: placeholder intact, dev fallback intact, ${shellFiles(src).length} shell files`);
  } else if (process.argv.includes('--write')) {
    const dir = resolve(arg('--write') || ROOT);
    const res = stamp(dir, base, { force });
    console.log(
      res.already
        ? `sw.js in ${dir} was already stamped ${res.version} — left alone`
        : `sw.js in ${dir} stamped ${res.version}`,
    );
  } else {
    process.stdout.write(`${versionFor(resolve(arg('--source') || ROOT), base)}\n`);
  }
}
