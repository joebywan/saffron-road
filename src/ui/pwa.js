/**
 * Progressive-web-app plumbing: register the service worker, and offer an
 * Install button only when installing is genuinely on the table.
 *
 * Everything here is opportunistic. The game does not depend on any of it, so
 * every branch below fails quietly and leaves the app exactly as it was.
 *
 * WHEN REGISTRATION IS SKIPPED, AND WHY.
 *
 * - No `serviceWorker` in navigator — old browser, or a private window that
 *   withholds it.
 * - `file://` — a service worker requires a SECURE CONTEXT, and a page opened
 *   off disk is not one. index.single.html has to keep working by
 *   double-click, so this is a silent no-op there rather than an error.
 * - Not a secure context — this is the case that bites over the LAN.
 *   `http://192.168.x.x:8123` is plain HTTP to a non-loopback host, so the
 *   browser gives the page no service worker at all. The game is perfectly
 *   playable there; it just cannot install or go offline. https or localhost
 *   is what unlocks that. See the README.
 * - The document declares no web app manifest. tools/bundle.js strips the PWA
 *   block out of index.single.html, so the self-contained build never goes
 *   looking for a sw.js that is not sitting next to it.
 *
 * UPDATES ARE THE OTHER HALF OF THIS FILE. sw.js refreshes the cached shell in
 * the background, so new code is on disk before anyone asks for it — but the
 * page in front of the player is still running the JavaScript it booted with,
 * and only a reload swaps that. So this listens for the new worker taking over
 * and hands the app a single callback. What to do about it is the app's call,
 * not this file's: reloading out from under someone's turn is worse than the
 * stale build was. See onUpdateReady in src/ui/app.js.
 */

/** Where the worker lives, relative to the page. */
const SW_URL = 'sw.js';

/**
 * How often to ask the browser whether sw.js has changed. Browsers check on
 * navigation anyway; an installed app can sit on one navigation for days, so
 * it is also asked when the app comes back to the foreground, at most this
 * often.
 */
const UPDATE_CHECK_MS = 30 * 60 * 1000;

/** Set once an update has been announced, so it is announced exactly once. */
let updateAnnounced = false;
/** The app's "there is new code" handler, from initPwa. */
let onUpdateReady = null;
/** The version the active worker reported, for diagnostics. */
let activeVersion = null;
let lastUpdateCheck = 0;

/** The stashed `beforeinstallprompt`, held until the user asks for it. */
let deferredPrompt = null;

function installButton() {
  return document.getElementById('btn-install');
}

/** Already running as an installed app? Then there is nothing to offer. */
function isInstalled() {
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    /* matchMedia can throw in odd embeddings */
  }
  // iOS Safari's own flag; it has no beforeinstallprompt at all.
  return navigator.standalone === true;
}

function showInstall(on) {
  const btn = installButton();
  if (btn) btn.hidden = !on;
}

/* ------------------------------------------------------------------ */
/* Service worker                                                      */
/* ------------------------------------------------------------------ */

/** Why registration was skipped, or null when it was attempted. Diagnostic. */
export function serviceWorkerSkipReason() {
  if (!('serviceWorker' in navigator)) return 'this browser has no service worker';
  if (location.protocol === 'file:') return 'opened from disk (file://), which is not a secure context';
  if (!window.isSecureContext) return 'not a secure context — needs https or localhost';
  if (!document.querySelector('link[rel="manifest"]')) return 'no web app manifest on this page';
  return null;
}

/** What the running worker calls itself, or null. Diagnostic. */
export function serviceWorkerVersion() {
  return activeVersion;
}

/**
 * Say, exactly once, that newer code is cached and a reload would pick it up.
 * Three signals feed this and any of them is enough, because the one that
 * matters most — the worker's own message — is the one a browser quirk is
 * most likely to swallow.
 */
function announceUpdate(version) {
  if (version) activeVersion = version;
  if (updateAnnounced) return;
  updateAnnounced = true;
  try {
    if (onUpdateReady) onUpdateReady(version || activeVersion || null);
  } catch (err) {
    console.warn('[saffron] update handler failed:', err);
  }
}

/** Ask the browser to re-fetch sw.js. Throttled; failure is uninteresting. */
function checkForUpdate(reg) {
  const now = Date.now();
  if (now - lastUpdateCheck < UPDATE_CHECK_MS) return;
  lastUpdateCheck = now;
  try {
    const p = reg.update();
    if (p && p.catch) p.catch(() => {});
  } catch {
    /* some embeddings reject update() outright */
  }
}

function watchForUpdates(reg, hadController) {
  // 1. The worker says so from activate(), and tells us whether it replaced
  //    an older version of itself or was a first install.
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== 'saffron:sw-activated') return;
    activeVersion = data.version || activeVersion;
    if (data.updated) announceUpdate(data.version);
  });

  // 2. A new worker took over this page. On a FIRST install there was no
  //    controller and nothing to announce — that is the whole point of the
  //    flag captured before register().
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) announceUpdate(null);
  });

  // 3. A worker finished installing while one was already in charge. Covers
  //    the case where skipWaiting is not honoured and it sits in `waiting`.
  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    if (!next) return;
    next.addEventListener('statechange', () => {
      if (next.state === 'installed' && navigator.serviceWorker.controller) announceUpdate(null);
    });
  });
}

async function registerServiceWorker() {
  if (serviceWorkerSkipReason()) return;
  // Captured BEFORE registering: with no controller this is a first install,
  // and a first install must not tell anyone anything.
  const hadController = !!navigator.serviceWorker.controller;
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: './' });
    watchForUpdates(reg, hadController);
    lastUpdateCheck = Date.now();
    // An installed app can go days without a navigation, which is when a
    // browser would otherwise look. Coming back to the foreground is the
    // natural moment to ask.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkForUpdate(reg);
    });
    window.addEventListener('focus', () => checkForUpdate(reg));
  } catch (err) {
    // Nothing to recover: the app just stays online-only.
    console.warn('[saffron] service worker registration failed:', err);
  }
}

/**
 * Reload onto the new code.
 *
 * The guard is not paranoia: a worker that somehow activated on every load
 * would turn "reload for the update" into an infinite reload loop, and a game
 * you cannot open is a worse bug than the one this fixes. One automatic reload
 * per session; after that the player has to ask.
 */
const RELOAD_KEY = 'saffron.sw.reloaded';

export function reloadForUpdate({ auto = false } = {}) {
  if (auto) {
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return false;
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    } catch {
      // No sessionStorage means no loop guard, so do not take the risk.
      return false;
    }
  }
  location.reload();
  return true;
}

/* ------------------------------------------------------------------ */
/* Install affordance                                                  */
/* ------------------------------------------------------------------ */

/** Is there a stashed install prompt to offer right now? */
export function installAvailable() {
  return deferredPrompt !== null && !isInstalled();
}

/**
 * Offer the stashed prompt. Exported because the phone layout has no header
 * to put a button in — the offer lives in the game menu there instead — and
 * both entry points must consume the same single-use prompt.
 */
export async function promptInstall() {
  await onInstallClick();
}

async function onInstallClick() {
  const prompt = deferredPrompt;
  if (!prompt) {
    showInstall(false);
    return;
  }
  // A saved prompt is single-use whichever way the user answers.
  deferredPrompt = null;
  showInstall(false);
  try {
    prompt.prompt();
    await prompt.userChoice;
  } catch (err) {
    console.warn('[saffron] install prompt failed:', err);
  }
}

function wireInstall() {
  const btn = installButton();
  if (!btn) return;
  btn.hidden = true;
  btn.addEventListener('click', onInstallClick);

  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep it rather than letting the browser show its own mini-infobar, so
    // the offer sits in the header where it belongs instead of over the board.
    event.preventDefault();
    deferredPrompt = event;
    if (!isInstalled()) showInstall(true);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    showInstall(false);
  });
}

/* ------------------------------------------------------------------ */

/**
 * Call once, at boot. Safe to call in any context.
 *
 * `onUpdateReady(version)` is called at most once, when a newer worker has
 * activated and the code on this page is therefore out of date.
 */
export function initPwa(options = {}) {
  onUpdateReady = typeof options.onUpdateReady === 'function' ? options.onUpdateReady : null;
  try {
    wireInstall();
    registerServiceWorker();
  } catch (err) {
    console.warn('[saffron] PWA setup skipped:', err);
  }
}
