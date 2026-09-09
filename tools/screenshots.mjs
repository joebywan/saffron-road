/**
 * Regenerates docs/screenshots/*.png — the images in the README.
 *
 *   npm run screenshots
 *
 * Nothing in the app reads these; they exist so that somebody deciding whether
 * to install can see what they are installing. They still get a generator, for
 * the same reason tools/icons.js does: a checked-in binary nobody can rebuild
 * is a binary that goes stale silently, and a screenshot of a UI that has since
 * moved is worse than no screenshot at all.
 *
 * HOW IT WORKS, because it is not obvious. The states are built by playing real
 * games with the real engine and the real bots from a fixed seed, so they are
 * reproducible and they are positions that can actually occur. Each one is then
 * written into a scratch Firefox profile's localStorage by loading a temporary
 * same-origin page, and a SECOND Firefox run loads the app, which restores that
 * saved game on boot exactly as it would on a phone. That second run is what is
 * captured. Two runs because localStorage persists in a profile between them,
 * and headless Firefox cannot be scripted mid-page.
 *
 * REQUIRES: firefox on PATH. That is all — no driver, no browser automation
 * dependency, nothing added to package.json.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGame, legalMoves, applyMove, isTerminal, redactFor } from '../src/engine.js';
import { chooseMove } from '../src/bots.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const PORT = 8177; // not 8123, so a dev server you are already running is left alone
const SIZE = { w: 412, h: 915 }; // a mid-range handset, and one of the two sizes the layout is held to

/** The save key the app boots from — must match STORE/GAME_KEY in src/ui/app.js. */
const GAME_KEY = 'saffron.game.v1';

const SEATS = [
  { name: 'You', isBot: false, botLevel: null },
  { name: 'Ada', isBot: true, botLevel: 'normal' },
  { name: 'Boris', isBot: true, botLevel: 'normal' },
];

/**
 * Play a real game and return a position to photograph.
 *
 * Stopping only when it is YOUR turn in the action phase matters: the app runs
 * the bot loop on restore, so a state captured mid-bot-turn would either move
 * under the screenshot or come up behind the turn-report beat.
 *
 * `want` is the position actually wanted; `rank` scores every candidate so that
 * if it never comes up, the best near-miss is used instead. Bots are stochastic
 * and the game can end before an unusual position occurs — an exact condition
 * would make regenerating the images fail on a good day and a bad seed, and a
 * generator that only works sometimes is one nobody reruns.
 */
async function playUntil(seed, want, rank = () => 0) {
  let s = createGame({ players: SEATS, seed });
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 4000 && !isTerminal(s); i++) {
    if (s.current === 0 && s.phase === 'action') {
      if (want(s)) return s;
      const score = rank(s);
      if (score > bestScore) [best, bestScore] = [s, score];
    }
    let proposed = null;
    try {
      proposed = await chooseMove(redactFor(s, s.current), { level: 'normal', seed: seed + i });
    } catch {
      proposed = null;
    }
    const legal = legalMoves(s);
    const key = (m) => JSON.stringify(m);
    s = applyMove(s, legal.find((l) => key(l) === key(proposed)) || legal[0]);
  }
  if (!best) throw new Error('the game produced no position on the human turn at all');
  return best;
}

function firefox(profile, url, shot) {
  const r = spawnSync(
    'firefox',
    ['--headless', '--profile', profile, '--window-size', `${SIZE.w},${SIZE.h}`, '--screenshot', shot, url],
    { stdio: 'ignore', timeout: 180_000 },
  );
  if (r.error) throw new Error(`could not run firefox: ${r.error.message}`);
}

function newProfile(work, name) {
  const dir = join(work, `profile-${name}`);
  mkdirSync(dir, { recursive: true });
  // The installed app is always dark, so the screenshots have to be. Of these
  // three, ui.systemUsesDarkTheme is the one that actually reaches
  // prefers-color-scheme in a headless profile; the others are belt and braces.
  writeFileSync(
    join(dir, 'user.js'),
    'user_pref("ui.systemUsesDarkTheme", 1);\n' +
      'user_pref("layout.css.prefers-color-scheme.content-override", 0);\n' +
      'user_pref("browser.theme.content-theme", 0);\n',
  );
  return dir;
}

async function main() {
  if (!spawnSync('firefox', ['--version'], { stdio: 'ignore' }).status === 0) {
    console.error('firefox is not on PATH — that is the only thing this needs');
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'saffron-shots-'));
  const seedPage = join(ROOT, '__screenshot-seed.html');

  console.log('building positions from real games...');
  const shots = [
    { name: 'title', state: null },
    {
      // Early enough to be legible: a few holdings bought, the decks still full.
      name: 'board',
      state: await playUntil(
        20260909,
        (s) => s.players[0].cards.length >= 3 && s.round >= 5,
        (s) => Math.min(s.players[0].cards.length, 4),
      ),
    },
    {
      // Late: engines built, a company signed, and the race close enough to see
      // why the position matters.
      name: 'endgame',
      state: await playUntil(
        20260909,
        (s) => s.players[0].companies.length >= 1 && s.players[0].cards.length >= 8,
        (s) => s.players[0].companies.length * 100 + s.players[0].cards.length + Math.max(...s.players.map((p) => p.points)),
      ),
    },
  ];

  const server = spawn(process.execPath, [join(ROOT, 'tools', 'serve.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const stop = () => {
    server.kill();
    rmSync(seedPage, { force: true });
    rmSync(work, { recursive: true, force: true });
  };
  process.on('exit', stop);

  try {
    await new Promise((r) => setTimeout(r, 800));
    for (const { name, state } of shots) {
      const profile = newProfile(work, name);
      if (state) {
        // Written synchronously in the page, not fetched: --screenshot captures
        // on load, and an async write would be a race it sometimes loses.
        const b64 = Buffer.from(JSON.stringify({ v: 1, state })).toString('base64');
        writeFileSync(
          seedPage,
          `<!doctype html><title>seed</title><script>localStorage.setItem(${JSON.stringify(GAME_KEY)},atob(${JSON.stringify(b64)}))</script>seeded`,
        );
        firefox(profile, `http://localhost:${PORT}/__screenshot-seed.html`, join(work, 'discard.png'));
        rmSync(seedPage, { force: true });
      }
      const out = join(OUT, `${name}.png`);
      firefox(profile, `http://localhost:${PORT}/`, out);
      if (!existsSync(out)) throw new Error(`${name}: firefox produced no image`);
      console.log(`  docs/screenshots/${name}.png`);
    }
  } finally {
    stop();
  }
  console.log('done');
}

await main();
