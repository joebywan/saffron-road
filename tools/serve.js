/** Minimal static file server so `npm start` just works. No dependencies. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT) || 8123;

/**
 * LAN BINDING. Default is loopback only — a dev server should not appear on
 * the network unless you say so. `--host` (or HOST=0.0.0.0, or SAFFRON_LAN=1)
 * binds every interface so a phone on the same wifi can reach the game.
 *
 * Worth knowing before you try it: over the LAN the address is a plain
 * `http://192.168.x.x`, which is NOT a secure context. The game plays fine in
 * the phone's browser, but the service worker will not register, so there is
 * no install and no offline. That needs https (or localhost). See the README.
 */
const LAN =
  process.argv.includes('--host') ||
  process.argv.includes('--lan') ||
  process.env.SAFFRON_LAN === '1';
const HOST = process.env.HOST || (LAN ? '0.0.0.0' : '127.0.0.1');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // The manifest MIME type is not optional: browsers ignore a manifest served
  // as text/plain or application/json, and the install prompt never appears.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    // Source is never cached (edit, reload, see it). The artwork under
    // assets/ would otherwise be re-fetched on every repaint, so it gets a
    // short TTL — long enough to be free during play, short enough that
    // adding or removing files shows up without a hard reload.
    const asset = path.startsWith('/assets/');
    // The service worker script itself: `no-cache` (revalidate every time),
    // not `no-store`. Browsers re-fetch sw.js to look for updates, and a
    // stored copy is exactly how a stale worker gets stuck in place.
    const isWorker = path === '/sw.js';
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': isWorker ? 'no-cache' : asset ? 'public, max-age=300' : 'no-store',
      // Belt and braces: sw.js is at the root, so root scope is already
      // allowed, but this keeps it true if the app ever moves down a level.
      ...(isWorker ? { 'Service-Worker-Allowed': '/' } : {}),
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
}).listen(PORT, HOST, () => {
  console.log(`Saffron Road running at http://localhost:${PORT}`);
  if (!LAN && !process.env.HOST) {
    console.log('Localhost only. Run `npm start -- --host` to reach it from a phone on the same wifi.');
    return;
  }
  for (const url of lanUrls(PORT)) console.log(`  on this network: ${url}`);
  console.log('LAN addresses are plain http, so no install and no offline there — see the README.');
});

/** Every non-internal IPv4 address this machine answers on. */
function lanUrls(port) {
  const urls = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.internal) continue;
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      urls.push(`http://${a.address}:${port}  (${name})`);
    }
  }
  if (!urls.length) urls.push('(no external network interface found)');
  return urls;
}
