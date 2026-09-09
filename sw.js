/**
 * Service worker — offline play, and getting new code to people who already
 * have the app.
 *
 * The whole app is static files with no build step, so the shell IS the app:
 * precache it, serve it from the cache so the game runs with the network
 * unplugged, and refresh it in the background so the next load is current.
 *
 * FOUR RULES THIS FILE KEEPS.
 *
 * 1. ONE MISSING FILE MUST NOT SINK THE INSTALL. cache.addAll() is
 *    all-or-nothing; a single 404 there leaves the app with no offline
 *    support at all and no clue why. Each entry is added on its own and the
 *    results collected with allSettled, so a partial precache still works and
 *    says which entries it could not get.
 *
 * 2. THE SHELL IS SERVED STALE-WHILE-REVALIDATE, NOT CACHE-FIRST. This is the
 *    load-bearing half of the update story, and it is deliberately the half
 *    that does not depend on this file changing: the running worker answers
 *    from the cache immediately (so offline is untouched and the game still
 *    opens instantly), then fetches the same file in the background and
 *    overwrites the cached copy. The NEXT load gets the new code. Cache-first
 *    with no revalidation — what this used to be — pins an install to the
 *    bytes it first saw, for ever, and that is exactly the bug this replaces:
 *    a player reinstalled the Android app twice and was still running the
 *    JavaScript from the first release they ever opened.
 *
 *    A failed revalidate is silent and keeps the cached copy. Being offline
 *    is the normal case here, not an error.
 *
 * 3. THE VERSION IS INJECTED, NEVER TYPED. See below.
 */

/**
 * THE VERSION.
 *
 * `__APP_VERSION__` is a placeholder that every delivery path replaces
 * with something that changes on its own — the release tag plus a hash of the
 * shell's actual bytes:
 *
 *   web release   .github/workflows/release.yml   (knows the tag)
 *   Android APK   android/app/build.gradle        (stamps the synced assets)
 *   by hand       node tools/version.js --write .
 *
 * A hand-maintained `const VERSION = 'v1'` is how this broke: it never moved,
 * so the sw.js bytes were identical every release, so the browser never even
 * looked for new code. Nothing here relies on a human remembering to bump it.
 *
 * UN-INJECTED IS A SUPPORTED STATE. `npm start` serves the repo as it stands,
 * with no build step at all, and the placeholder is still sitting there. That
 * is what the fallback below is for: local development runs as version 'dev',
 * with a stable cache name, and rule 3 above still delivers every edit on the
 * next reload. Never make the un-injected path an error — it is the one
 * everyone develops against.
 */
const INJECTED_VERSION = '__APP_VERSION__';
const VERSION = /^__[A-Z_]+__$/.test(INJECTED_VERSION) ? 'dev' : INJECTED_VERSION;

const SHELL = `saffron-shell-${VERSION}`;
const RUNTIME = `saffron-runtime-${VERSION}`;
const CACHES = [SHELL, RUNTIME];

/** Everything this worker owns, so activate can tell ours from a stranger's. */
const CACHE_PREFIXES = ['saffron-'];

/**
 * The app shell. Everything the game needs to boot and play a full match with
 * no network — every ES module in the graph, the stylesheet, the manifest and
 * the icons. Relative so a copy served from a subdirectory (GitHub Pages
 * project sites) works unchanged.
 */
const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',

  'src/contract.js',
  'src/rng.js',
  'src/engine.js',
  'src/bots.js',
  'src/data/cards.js',
  'src/data/companies.js',
  'src/ui/app.js',
  'src/ui/components.js',
  'src/ui/tokens.js',
  'src/ui/pwa.js',
  'src/ui/render.js',
  'src/ui/report.js',
  'src/ui/seat.js',
  'src/ui/select.js',
  'src/ui/tick.js',

  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png',
];

/** Ours, and not a cache this worker is currently using. */
function isStaleCache(name) {
  return CACHE_PREFIXES.some((p) => name.startsWith(p)) && !CACHES.includes(name);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const results = await Promise.allSettled(
        SHELL_FILES.map(async (file) => {
          const url = new URL(file, self.registration.scope);
          // cache: 'reload' so an install never picks the old copy of a file
          // out of the HTTP cache and precaches a stale shell.
          const res = await fetch(new Request(url, { cache: 'reload' }));
          if (!res.ok) throw new Error(`${res.status} ${url.pathname}`);
          await cache.put(url, res);
        }),
      );
      const failed = results
        .map((r, i) => (r.status === 'rejected' ? SHELL_FILES[i] : null))
        .filter(Boolean);
      if (failed.length) {
        console.warn('[saffron sw] precache incomplete:', failed.join(', '));
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Read the cache list BEFORE deleting anything: a cache of ours under a
      // different version is the proof that this is an upgrade rather than a
      // first install, and it is the only chance to see it. The page uses it
      // to decide between "say nothing" and "there is new code waiting".
      const names = await caches.keys();
      const replaced = names.filter(isStaleCache);

      for (const name of replaced) await caches.delete(name);

      await self.clients.claim();

      // Tell every open page. The page it claimed is still RUNNING THE OLD
      // JAVASCRIPT — claiming does not swap the code already parsed into it —
      // so this is what turns a silent background update into something the
      // player can act on. src/ui/pwa.js listens.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({
          type: 'saffron:sw-activated',
          version: VERSION,
          // False on a first install, when there is nothing to tell anyone.
          updated: replaced.length > 0,
          replaced,
        });
      }

      console.info(
        `[saffron sw] ${VERSION} active` +
          (replaced.length ? `; evicted ${replaced.join(', ')}` : ''),
      );
    })(),
  );
});

/** A response the page can fail on cleanly, rather than a rejected fetch. */
function offlineResponse() {
  return new Response('', { status: 504, statusText: 'Offline' });
}

/** Only a complete, same-origin 200 is worth keeping. */
function isCacheable(res) {
  return !!res && res.ok && res.status === 200 && res.type !== 'opaque';
}

/**
 * Stale-while-revalidate against the shell cache.
 *
 * Returns the cached copy the instant there is one, and updates the cache
 * from the network in the background. With nothing cached it waits for the
 * network, and offline it returns `whenOffline()` rather than throwing —
 * a rejected respondWith is a browser error page, which is not what "you are
 * on a train" should look like.
 */
async function staleWhileRevalidate(event, req, whenOffline) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(req, { ignoreSearch: true });

  // `no-cache`, not the default: the HTTP cache is a second place stale bytes
  // can hide, and refreshing the shell FROM a stale HTTP cache entry would
  // rebuild this whole bug one layer down. This always asks the server; a 304
  // makes that nearly free. Rebuilt from the URL because a navigation request
  // cannot be re-issued as-is.
  const revalidate = fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }))
    .then(async (res) => {
      if (isCacheable(res)) await cache.put(req, res.clone());
      return res;
    })
    // Offline, DNS failure, server down: keep what we have and say nothing.
    .catch(() => null);

  if (cached) {
    // Hold the worker alive until the refresh lands, but do not make the
    // player wait for it.
    event.waitUntil(revalidate);
    return cached;
  }

  const fresh = await revalidate;
  return fresh || (await whenOffline()) || offlineResponse();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch other origins

  // A navigation is how a new version arrives: index.html is refreshed in the
  // background like everything else, and a navigation with nothing cached for
  // it still has to land somewhere — the shell's index.html is the whole app.
  if (req.mode === 'navigate') {
    event.respondWith(
      staleWhileRevalidate(event, req, async () =>
        (await caches.match(new URL('index.html', self.registration.scope))) ||
        (await caches.match(new URL('./', self.registration.scope))),
      ),
    );
    return;
  }


  // Everything else — the modules, the stylesheet, the icons: instant from
  // the cache, refreshed behind your back. See rule 3 at the top.
  event.respondWith(staleWhileRevalidate(event, req, async () => null));
});

/**
 * The page can ask what it is running, which is the difference between a bug
 * report that says "it still does the thing" and one that says which build.
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'saffron:which-version') return;
  const reply = { type: 'saffron:version', version: VERSION, caches: CACHES };
  if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
  else if (event.source) event.source.postMessage(reply);
});
