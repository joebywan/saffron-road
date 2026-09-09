/**
 * Fails if retired vocabulary has crept back into the tree.
 *
 *   node tools/vocabulary.js
 *
 * WHY THIS EXISTS. The reskin renamed the game's whole vocabulary, and it was
 * declared finished four separate times before it actually was. Each miss had
 * the same shape: a grep of the code that never touched the prose, or a grep
 * for one retired word when a dozen were retired together. What escaped was
 * not obscure — an iOS home-screen title, a tooltip reading "Prestige points",
 * a section labelled "Development cards" for screen readers, and a move-log
 * line telling players a card came "from tier 3" while the board beside it said
 * "Routes".
 *
 * None of those are visible in a diff, none break a test, and the last one was
 * read out to players every time they reserved a card. So the check is
 * mechanical and it runs in CI, because "remember to grep" is not a control.
 *
 * THIS IS A WORD CHECK, NOT A STYLE GUIDE. It only knows words that were
 * deliberately retired and must never come back. Adding a word here is a claim
 * that it is wrong everywhere, which is why the allowlist below is per-word and
 * per-path rather than a blanket skip.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories that are not ours to police. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', '.gradle', 'docs']);
/** Binary and generated things a word search means nothing in. */
const SKIP_EXT = /\.(png|jpg|jpeg|webp|gif|ico|jks|keystore|apk|aab|zip|jar|woff2?)$/i;
const SKIP_FILES = new Set(['index.single.html', 'package-lock.json']);

/**
 * Retired words, and what to say when one turns up. Matched case-insensitively
 * on word boundaries, so "gems" and "Gem" are caught and "gemini" is not.
 */
const RETIRED = [
  ['splendor', 'the game this was reskinned from — must not appear anywhere'],
  ['gem', 'the tokens are goods; use the resource names or "token"'],
  ['gemstone', 'the tokens are goods'],
  ['noble', 'nobles are companies'],
  ['prestige', 'prestige points are just points'],
  ['development card', 'development cards are holdings'],
  ['diamond', 'a retired gem colour — and the mark is a crocus, not a diamond'],
  ['emerald', 'a retired gem colour'],
  ['sapphire', 'a retired gem colour'],
  ['onyx', 'a retired gem colour'],
];

/**
 * NOT in the list above, deliberately, and here is the reasoning so nobody has
 * to reconstruct it:
 *
 * `tier` is the internal name of the deck field — card.tier, move.tier,
 * TIER_SPEC, .tier-row. It is a neutral English word for a level, it appears
 * ~300 times across the engine, the data, the tests and the CSS, and renaming
 * it would be a large mechanical change to load-bearing code for no visible
 * gain. What matters is that a PLAYER never sees it, and that is enforced by
 * everything user-facing going through DECK_LABEL / DECK_LABEL_ONE in
 * contract.js. The one place that bypassed them was the reserve log line, and
 * that is what this file was written after.
 *
 * `gold` is likewise retired as a word (the wild is a coin) but is not listed,
 * because it is a real colour name and would fire on any future use of it in
 * CSS. It was swept by hand; if it comes back in prose it is cosmetic.
 */

/** Places a retired word is legitimately allowed, with the reason. */
const ALLOW = [
  // This file names the words in order to ban them.
  { path: 'tools/vocabulary.js', words: '*' },
];

function allowed(relPath, word) {
  return ALLOW.some(
    (a) => a.path === relPath && (a.words === '*' || a.words.includes(word)),
  );
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* files(full);
    } else if (!SKIP_EXT.test(name) && !SKIP_FILES.has(name)) {
      yield full;
    }
  }
}

const hits = [];
for (const file of files(ROOT)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // unreadable or not text; nothing to check
  }
  const lines = text.split('\n');
  for (const [word, why] of RETIRED) {
    if (allowed(rel, word)) continue;
    const re = new RegExp(`\\b${word.replace(/ /g, '\\s+')}s?\\b`, 'i');
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push({ rel, line: i + 1, word, why, text: line.trim().slice(0, 100) });
    });
  }
}

if (hits.length) {
  console.error(`Retired vocabulary is back in ${new Set(hits.map((h) => h.rel)).size} file(s):\n`);
  for (const h of hits) {
    console.error(`  ${h.rel}:${h.line}  "${h.word}" — ${h.why}`);
    console.error(`    ${h.text}`);
  }
  console.error(
    '\nIf one of these is genuinely correct, add it to ALLOW in tools/vocabulary.js\n' +
      'with the reason. Do not widen the word list to make it pass.',
  );
  process.exit(1);
}

console.log(`vocabulary check: ${RETIRED.length} retired words, none present`);
