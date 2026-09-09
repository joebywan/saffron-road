#!/usr/bin/env node
/**
 * SELF-PLAY / BALANCE HARNESS
 *
 *   node tools/selfplay.js [--games N] [--players 2|3|4] [--levels easy,normal,hard]
 *                          [--seed S] [--quiet]
 *
 * Runs N seeded games between the given bot levels, ROTATING SEAT ORDER every
 * game so seat advantage cannot contaminate the comparison (game g uses seat
 * assignment rotated by g, so with L levels and N games each level sits in each
 * seat N/L times).
 *
 * Bots are handed engine.redactFor(state, seat) — exactly what the UI gives
 * them — so the measured strength is honest: no bot ever sees deck order or an
 * opponent's hidden reserve.
 *
 * Prints win rates with a 95% confidence interval, game length, winner scores,
 * how each game ended, cards/companies per game, and decision-time percentiles.
 */

import { createGame, applyMove, redactFor, isTerminal } from '../src/engine.js';
import { chooseMove } from '../src/bots.js';
import { WIN_POINTS } from '../src/contract.js';

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = { games: 100, players: 2, levels: ['normal', 'easy'], seed: 12345, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--games') out.games = Number(val());
    else if (a === '--players') out.players = Number(val());
    else if (a === '--levels') out.levels = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--seed') out.seed = Number(val());
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        'usage: node tools/selfplay.js [--games N] [--players 2|3|4] ' +
          '[--levels easy,normal,hard] [--seed S] [--quiet]',
      );
      process.exit(0);
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isFinite(out.games) || out.games < 1) throw new Error('--games must be >= 1');
  if (![2, 3, 4].includes(out.players)) throw new Error('--players must be 2, 3 or 4');
  for (const l of out.levels) {
    if (!['easy', 'normal', 'hard'].includes(l)) throw new Error(`bad level: ${l}`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Stats helpers                                                       */
/* ------------------------------------------------------------------ */

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

function percentile(xs, q) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i];
}

/** Wald 95% interval on a proportion, in percentage points. */
function ci95(wins, n) {
  if (n === 0) return 0;
  const p = wins / n;
  return 100 * 1.96 * Math.sqrt(Math.max(p * (1 - p), 1e-9) / n);
}

const pct = (x) => `${(100 * x).toFixed(1)}%`;
const fx = (x, d = 2) => x.toFixed(d);

/* ------------------------------------------------------------------ */
/* One game                                                            */
/* ------------------------------------------------------------------ */

/** Hard cap so a pathological position can never hang the harness. */
const MAX_TURNS = 4000;

/**
 * @param {object} opts
 * @param {string[]} opts.seatLevels  bot level per seat
 * @param {number} opts.seed
 * @param {Record<string, number[]>} opts.times  decision times accumulated per level
 */
function playGame({ seatLevels, seed, times }) {
  let state = createGame({
    players: seatLevels.map((lvl, i) => ({
      name: `${lvl}#${i}`,
      isBot: true,
      botLevel: lvl,
    })),
    seed,
  });

  let turns = 0;
  while (!isTerminal(state) && turns++ < MAX_TURNS) {
    const seat = state.current;
    const level = seatLevels[seat];
    // Bots only ever see what they are entitled to see.
    const view = redactFor(state, seat);
    const t0 = process.hrtime.bigint();
    const move = chooseMove(view, { level, seed: seed ^ (seat * 0x9e3779b1) });
    const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    times[level].push(dt);
    state = applyMove(state, move);
  }

  const timedOut = turns >= MAX_TURNS;
  const cards = state.players.reduce((a, p) => a + p.cards.length, 0);
  const companies = state.players.reduce((a, p) => a + p.companies.length, 0);
  const scores = state.players.map((p) => p.points);
  const reachedTarget = scores.some((s) => s >= WIN_POINTS);
  const stalemate =
    !reachedTarget && state.log.some((e) => e.text.includes('every player passed'));

  return {
    state,
    rounds: state.round,
    winners: state.winners,
    winnerScore: state.winners.length ? state.players[state.winners[0]].points : 0,
    scores,
    cards,
    companies,
    route: timedOut ? 'turn-cap' : reachedTarget ? 'points' : stalemate ? 'stalemate' : 'other',
    timedOut,
  };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { games, players, levels, seed } = opts;

  // Fill the seats by cycling the requested levels (e.g. 3 players from
  // [hard, normal] -> hard, normal, hard).
  const baseSeats = Array.from({ length: players }, (_, i) => levels[i % levels.length]);

  /** @type {Record<string, number[]>} */
  const times = {};
  for (const l of ['easy', 'normal', 'hard']) times[l] = [];

  const distinct = [...new Set(baseSeats)];
  const wins = Object.fromEntries(distinct.map((l) => [l, 0]));
  const shared = Object.fromEntries(distinct.map((l) => [l, 0]));
  const routes = {};
  const roundsAll = [];
  const winnerScores = [];
  const spreads = [];
  const cardsAll = [];
  const companiesAll = [];
  let ties = 0;

  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    // Rotate seats so each level sits in each seat equally often.
    const rot = g % players;
    const seatLevels = baseSeats.map((_, i) => baseSeats[(i + rot) % players]);

    const r = playGame({ seatLevels, seed: (seed + g * 7919) | 0, times });

    const winnerLevels = r.winners.map((i) => seatLevels[i]);
    if (winnerLevels.length > 1) ties += 1;
    for (const l of winnerLevels) {
      if (winnerLevels.length > 1) shared[l] += 1;
      else wins[l] += 1;
    }

    routes[r.route] = (routes[r.route] || 0) + 1;
    roundsAll.push(r.rounds);
    winnerScores.push(r.winnerScore);
    spreads.push(Math.max(...r.scores) - Math.min(...r.scores));
    cardsAll.push(r.cards);
    companiesAll.push(r.companies);

    if (!opts.quiet && games >= 20 && (g + 1) % Math.ceil(games / 10) === 0) {
      process.stderr.write(`  ...${g + 1}/${games}\r`);
    }
  }
  const elapsed = (Date.now() - t0) / 1000;
  if (!opts.quiet) process.stderr.write('                    \r');

  /* ---- report ---- */
  const seatsPer = Object.fromEntries(
    distinct.map((l) => [l, baseSeats.filter((x) => x === l).length]),
  );

  console.log('');
  console.log(`SELF-PLAY  ${games} games, ${players} players, levels: ${levels.join(' vs ')}`);
  console.log(`seed base ${seed}, seats rotated every game, ${fx(elapsed, 1)}s total`);
  console.log('='.repeat(72));

  console.log('\nWIN RATE (a shared win counts as half a win)');
  const namePad = Math.max(...distinct.map((l) => l.length), 6);
  console.log(
    '  (a level holding k of the n seats would win k/n of the games if all ' +
      'levels were equally strong)',
  );
  for (const l of distinct) {
    const w = wins[l] + shared[l] / 2;
    const rate = w / games;
    const interval = ci95(w, games);
    const nullRate = seatsPer[l] / players;
    console.log(
      `  ${l.padEnd(namePad)}  ${pct(rate).padStart(6)}  +/- ${fx(interval, 1).padStart(4)}pp` +
        `   vs ${pct(nullRate)} if equal` +
        `   (${wins[l]} outright, ${shared[l]} shared, ${seatsPer[l]} seat${seatsPer[l] > 1 ? 's' : ''}/game)`,
    );
  }
  console.log(`  drawn games: ${ties} (${pct(ties / games)})`);

  console.log('\nGAME LENGTH');
  console.log(
    `  rounds: avg ${fx(mean(roundsAll))}  min ${Math.min(...roundsAll)}  ` +
      `max ${Math.max(...roundsAll)}  sd ${fx(stdev(roundsAll))}`,
  );
  console.log(
    `  turns per player: avg ${fx(mean(roundsAll))} ` +
      `(one round = one turn each for ${players} players)`,
  );

  console.log('\nSCORES');
  console.log(
    `  winner's final score: avg ${fx(mean(winnerScores))}  ` +
      `min ${Math.min(...winnerScores)}  max ${Math.max(...winnerScores)}  ` +
      `sd ${fx(stdev(winnerScores))}`,
  );
  console.log(`  spread (best - worst): avg ${fx(mean(spreads))}  max ${Math.max(...spreads)}`);

  console.log('\nHOW GAMES ENDED');
  for (const [route, n] of Object.entries(routes).sort((a, b) => b[1] - a[1])) {
    const label = {
      points: `a player reached ${WIN_POINTS} points`,
      stalemate: 'stalemate (everyone passed)',
      'turn-cap': `harness turn cap (${MAX_TURNS}) — investigate!`,
      other: 'other',
    }[route];
    console.log(`  ${label.padEnd(40)} ${String(n).padStart(5)}  ${pct(n / games)}`);
  }
  console.log(`  cards bought per game:  avg ${fx(mean(cardsAll))}`);
  console.log(`  companies claimed per game: avg ${fx(mean(companiesAll))}`);

  console.log('\nDECISION TIME');
  for (const l of ['easy', 'normal', 'hard']) {
    const xs = times[l];
    if (!xs.length) continue;
    console.log(
      `  ${l.padEnd(namePad)}  n=${String(xs.length).padStart(6)}  ` +
        `avg ${fx(mean(xs), 2).padStart(7)}ms  p95 ${fx(percentile(xs, 0.95), 2).padStart(7)}ms  ` +
        `max ${fx(Math.max(...xs), 2).padStart(7)}ms`,
    );
  }
  console.log('');
}

main();
