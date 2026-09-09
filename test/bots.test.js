/**
 * Tests for src/bots.js.
 *
 * The properties that matter are all safety properties: a bot must never
 * return an illegal move, never mutate the caller's state, never need
 * information it is not allowed to see, and 'hard' must come back inside its
 * declared time budget.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGame,
  applyMove,
  legalMoves,
  isLegal,
  isTerminal,
  redactFor,
  cloneState,
  getCard,
} from '../src/engine.js';
import { RESOURCES, TOKEN_LIMIT, WIN_POINTS, total } from '../src/contract.js';
import { chooseMove, describeMove, moveId, HARD_TIME_BUDGET_MS } from '../src/bots.js';
import { makeRng } from '../src/rng.js';

const LEVELS = /** @type {const} */ (['easy', 'normal', 'hard']);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function newGame(nPlayers, seed) {
  return createGame({
    players: Array.from({ length: nPlayers }, (_, i) => ({
      name: `P${i}`,
      isBot: true,
      botLevel: 'normal',
    })),
    seed,
  });
}

/** Advance a game by `turns` uniformly random legal moves. */
function randomPosition(state, turns, rng) {
  let s = state;
  for (let i = 0; i < turns && !isTerminal(s); i++) {
    const moves = legalMoves(s);
    s = applyMove(s, moves[rng.int(moves.length)]);
  }
  return s;
}

/** The bot's view of the position it is to act in. */
const view = (s) => redactFor(s, s.current);

/** Recursively freeze everything reachable from `o`. */
function deepFreeze(o, seen = new Set()) {
  if (o === null || typeof o !== 'object' || seen.has(o)) return o;
  seen.add(o);
  for (const k of Object.keys(o)) deepFreeze(o[k], seen);
  return Object.freeze(o);
}

/** Structural snapshot for mutation checks. */
const snapshot = (s) => JSON.stringify(s);

function assertLegal(state, move, ctx) {
  assert.ok(move && typeof move === 'object', `${ctx}: no move returned`);
  assert.ok(
    isLegal(state, move),
    `${ctx}: returned an illegal move ${JSON.stringify(move)} in phase ${state.phase}`,
  );
  const ids = new Set(legalMoves(state).map(moveId));
  assert.ok(
    ids.has(moveId(move)),
    `${ctx}: ${moveId(move)} is not in legalMoves() [${[...ids].join(' ')}]`,
  );
}

/* ------------------------------------------------------------------ */
/* Legality across many random mid-game positions                      */
/* ------------------------------------------------------------------ */

test('every level returns a legal move from many random positions', () => {
  let checked = 0;
  for (let seed = 1; seed <= 7; seed++) {
    const rng = makeRng(seed * 7919);
    for (const players of [2, 3, 4]) {
      let s = newGame(players, seed * 31 + players);
      // Sample the whole arc of a game, not just the opening.
      for (let depth = 0; depth < 6; depth++) {
        s = randomPosition(s, rng.int(6) + 2, rng);
        if (isTerminal(s)) break;
        const v = view(s);
        for (const level of LEVELS) {
          const move = chooseMove(v, { level, seed: seed * 1000 + depth });
          assertLegal(v, move, `seed ${seed} p${players} depth ${depth} ${level}`);
          // ...and legal against the true (un-redacted) state too.
          assert.ok(isLegal(s, move), `${level}: illegal against the real state`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 300, `expected a decent sample, got ${checked}`);
});

/* ------------------------------------------------------------------ */
/* Determinism                                                         */
/* ------------------------------------------------------------------ */

test('same (state, level, seed) yields an identical move, twice', () => {
  const rng = makeRng(4242);
  for (let seed = 1; seed <= 4; seed++) {
    let s = newGame(seed % 3 === 0 ? 4 : 2, seed * 97);
    for (let depth = 0; depth < 5; depth++) {
      s = randomPosition(s, rng.int(5) + 3, rng);
      if (isTerminal(s)) break;
      const v = view(s);
      for (const level of LEVELS) {
        const a = chooseMove(v, { level, seed: 555 });
        const b = chooseMove(v, { level, seed: 555 });
        assert.equal(moveId(a), moveId(b), `${level} was not deterministic`);
        // A different seed is allowed to differ, but must still be legal.
        assertLegal(v, chooseMove(v, { level, seed: 556 }), `${level} alt seed`);
      }
    }
  }
});

test('determinism holds across a fresh copy of the same state', () => {
  const s = randomPosition(newGame(3, 8080), 25, makeRng(11));
  if (isTerminal(s)) return;
  const v = view(s);
  const copy = cloneState(v);
  for (const level of LEVELS) {
    assert.equal(
      moveId(chooseMove(v, { level, seed: 7 })),
      moveId(chooseMove(copy, { level, seed: 7 })),
      `${level} depends on object identity, not state`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Purity                                                              */
/* ------------------------------------------------------------------ */

test('chooseMove does not mutate the state it is given (deep-frozen)', () => {
  const rng = makeRng(2024);
  for (let seed = 1; seed <= 4; seed++) {
    let s = newGame(seed % 2 ? 2 : 4, seed * 613);
    for (let depth = 0; depth < 4; depth++) {
      s = randomPosition(s, rng.int(7) + 3, rng);
      if (isTerminal(s)) break;
      for (const level of LEVELS) {
        const v = deepFreeze(view(s));
        const before = snapshot(v);
        const move = chooseMove(v, { level, seed: 99 });
        assert.equal(snapshot(v), before, `${level} mutated the state`);
        assertLegal(v, move, `${level} after freeze`);
      }
    }
  }
});

/* ------------------------------------------------------------------ */
/* No cheating                                                         */
/* ------------------------------------------------------------------ */

test('bots work from redacted states and leave the redaction intact', () => {
  // The engine's redaction contract: face-down decks are hidden entirely, and
  // an opponent's BLIND-drawn reserves are hidden (a card reserved from the
  // face-up rows was seen by everyone, so it stays visible).
  const rng = makeRng(31337);
  let sawHiddenReserve = false;
  for (let seed = 1; seed <= 5; seed++) {
    let s = newGame(4, seed * 271);
    for (let depth = 0; depth < 5; depth++) {
      s = randomPosition(s, rng.int(6) + 4, rng);
      if (isTerminal(s)) break;
      const me = s.current;
      for (const level of LEVELS) {
        const v = redactFor(s, me);
        assert.equal(v.redacted, true);

        chooseMove(v, { level, seed: 13 });

        // Decks must still be entirely hidden...
        for (const t of [1, 2, 3]) {
          assert.ok(
            v.decks[t].every((x) => x === null),
            `${level}: deck ${t} is no longer redacted`,
          );
        }
        for (const p of v.players) {
          if (p.index === me) continue;
          // ...every blind card an opponent actually holds must read as null...
          const trulyBlind = s.players[p.index].reservedBlind.filter(Boolean);
          for (const id of trulyBlind) {
            assert.ok(
              !p.reserved.includes(id),
              `${level}: opponent ${p.index}'s blind card ${id} leaked`,
            );
          }
          assert.equal(
            p.reserved.filter((x) => x === null).length,
            trulyBlind.length,
            `${level}: opponent ${p.index}'s hidden-reserve count changed`,
          );
          // ...and the blind list itself must stay anonymised.
          assert.ok(
            p.reservedBlind.every((x) => x === null),
            `${level}: opponent ${p.index}'s blind list leaked`,
          );
          if (trulyBlind.length) sawHiddenReserve = true;
        }
        assert.equal(v.redacted, true);
      }
    }
  }
  assert.ok(sawHiddenReserve, 'fixture never produced a hidden opponent reserve');
});

test('a redacted state with hidden reserves and short decks is still playable', () => {
  // Push the game far enough that decks are thin and reserves are populated,
  // then hand every level the most heavily redacted view available.
  const rng = makeRng(515);
  let s = newGame(4, 90210);
  for (let i = 0; i < 120 && !isTerminal(s); i++) {
    const moves = legalMoves(s);
    // Bias toward reserving so opponents actually hold hidden cards.
    // Bias hard toward BLIND reserves so opponents end up holding hidden cards.
    const reserves = moves.filter((m) => m.type === 'reserve' && m.cardId === null);
    const pick = reserves.length && rng() < 0.5 ? reserves[rng.int(reserves.length)] : moves[rng.int(moves.length)];
    s = applyMove(s, pick);
  }
  if (isTerminal(s)) return;
  const v = view(s);
  const hidden = v.players
    .filter((p) => p.index !== v.current)
    .reduce((n, p) => n + p.reserved.filter((x) => x === null).length, 0);
  assert.ok(hidden > 0, 'expected at least one hidden opponent reserve in this fixture');
  for (const level of LEVELS) {
    assertLegal(v, chooseMove(v, { level, seed: 3 }), `${level} on a heavily hidden state`);
  }
});

/* ------------------------------------------------------------------ */
/* Full games                                                          */
/* ------------------------------------------------------------------ */

test('a full seeded game at every level never produces an illegal move', () => {
  for (const level of LEVELS) {
    for (const players of [2, 4]) {
      let s = newGame(players, 555 + players);
      let turns = 0;
      while (!isTerminal(s) && turns++ < 1500) {
        const v = view(s);
        const move = chooseMove(v, { level, seed: 4321 });
        assertLegal(v, move, `${level} ${players}p turn ${turns}`);
        s = applyMove(s, move);
      }
      assert.ok(isTerminal(s), `${level} ${players}p did not finish in ${turns} turns`);
      assert.ok(s.winners.length >= 1, `${level} ${players}p produced no winner`);
    }
  }
});

test('a mixed-level game runs to completion', () => {
  let s = createGame({
    players: [
      { name: 'E', isBot: true, botLevel: 'easy' },
      { name: 'N', isBot: true, botLevel: 'normal' },
      { name: 'H', isBot: true, botLevel: 'hard' },
    ],
    seed: 24680,
  });
  const seats = ['easy', 'normal', 'hard'];
  let turns = 0;
  while (!isTerminal(s) && turns++ < 1500) {
    const v = view(s);
    const move = chooseMove(v, { level: seats[s.current], seed: 17 });
    assertLegal(v, move, `${seats[s.current]} turn ${turns}`);
    s = applyMove(s, move);
  }
  assert.ok(isTerminal(s));
});

/* ------------------------------------------------------------------ */
/* Deliberate positions                                                */
/* ------------------------------------------------------------------ */

/**
 * Build a position where the player to act wins outright by buying any of the
 * high-point cards on the board. The acting seat is the LAST seat so that the
 * purchase ends the game immediately rather than merely opening the final
 * round (see the engine's equal-turns rule).
 */
function winningPosition(seed = 4711) {
  const base = newGame(2, seed);
  const s = cloneState(base);
  s.current = 1; // last seat: reaching 15 ends the game on the spot
  s.companies = []; // keep the assertion about the winner unambiguous
  s.companyChoices = [];
  const me = s.players[1];
  me.points = 12;
  // Enough permanent bonuses that every board card is free: the only question
  // left is which card the bot chooses.
  for (const g of RESOURCES) me.bonuses[g] = 7;
  s.players[0].points = 4;
  return s;
}

test('every level takes an immediately winning purchase', () => {
  const s = winningPosition();
  const winners = legalMoves(s).filter((m) => {
    if (m.type !== 'buy') return false;
    const next = applyMove(s, m);
    return isTerminal(next) && next.winners.length === 1 && next.winners[0] === 1;
  });
  assert.ok(winners.length > 0, 'fixture is wrong: no winning purchase exists');

  const v = redactFor(s, 1);
  for (const level of LEVELS) {
    const move = chooseMove(v, { level, seed: 2 });
    assertLegal(v, move, `${level} winning position`);
    const after = applyMove(s, move);
    assert.ok(isTerminal(after), `${level} did not end the game when it could`);
    assert.deepEqual(after.winners, [1], `${level} did not win outright`);
    assert.ok(after.players[1].points >= WIN_POINTS);
  }
});

test('every level returns a valid discard when over the token limit', () => {
  const base = newGame(3, 606);
  const s = cloneState(base);
  s.phase = 'discard';
  s.current = 0;
  const p = s.players[0];
  // 13 tokens: three must go back.
  p.tokens = { cinnamon: 3, indigo: 3, cardamom: 3, saffron: 2, pepper: 1, coin: 1 };
  for (const g of RESOURCES) s.bank[g] = Math.max(0, s.bank[g] - p.tokens[g]);
  s.bank.coin -= 1;
  assert.equal(total(p.tokens) - TOKEN_LIMIT, 3);

  const v = redactFor(s, 0);
  for (const level of LEVELS) {
    const move = chooseMove(v, { level, seed: 8 });
    assertLegal(v, move, `${level} discard phase`);
    assert.equal(move.type, 'discard');
    const after = applyMove(s, move);
    assert.equal(total(after.players[0].tokens), TOKEN_LIMIT);
    // Nothing may be discarded that was not held.
    for (const k of Object.keys(move.tokens)) {
      assert.ok(move.tokens[k] <= p.tokens[k], `${level} discarded tokens it did not hold`);
    }
  }
});

test('every level returns a valid company choice', () => {
  const base = newGame(2, 707);
  const s = cloneState(base);
  s.phase = 'company';
  s.current = 0;
  assert.ok(s.companies.length >= 2, 'fixture needs at least two companies');
  s.companyChoices = s.companies.slice(0, 2);

  const v = redactFor(s, 0);
  for (const level of LEVELS) {
    const move = chooseMove(v, { level, seed: 9 });
    assertLegal(v, move, `${level} company phase`);
    assert.equal(move.type, 'chooseCompany');
    assert.ok(s.companyChoices.includes(move.companyId), `${level} chose an unavailable company`);
    const after = applyMove(s, move);
    assert.ok(after.players[0].companies.includes(move.companyId));
  }
});

test('a bot in the final round with no winning line still returns a legal move', () => {
  const base = newGame(3, 909);
  const s = cloneState(base);
  s.finalRound = true;
  s.lastPlayer = 2;
  s.current = 1;
  s.players[0].points = 15;
  const v = redactFor(s, 1);
  for (const level of LEVELS) {
    assertLegal(v, chooseMove(v, { level, seed: 6 }), `${level} final round`);
  }
});

/* ------------------------------------------------------------------ */
/* Budget                                                              */
/* ------------------------------------------------------------------ */

test("'hard' respects its time budget on a worst-case-ish position", () => {
  // Worst case for the search: 4 players (most opponents to model), a full
  // board, plenty of tokens so nearly every take/buy is legal, and free
  // reserve slots so the move list is as wide as it gets.
  const base = newGame(4, 1337);
  const s = cloneState(base);
  for (const p of s.players) {
    p.tokens = { cinnamon: 1, indigo: 1, cardamom: 1, saffron: 1, pepper: 1, coin: 1 };
    for (const g of RESOURCES) p.bonuses[g] = 2;
    p.points = 6;
  }
  const v = redactFor(s, 0);
  assert.ok(legalMoves(v).length >= 25, 'fixture should have a wide move list');

  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const move = chooseMove(v, { level: 'hard', seed: 100 + i });
    samples.push(Date.now() - t0);
    assertLegal(v, move, 'hard budget position');
  }
  const worst = Math.max(...samples);
  // The budget is checked between simulated positions, so a small overshoot is
  // expected; a large one means the budget is not actually being enforced.
  assert.ok(
    worst < HARD_TIME_BUDGET_MS + 500,
    `hard took ${worst}ms, budget is ${HARD_TIME_BUDGET_MS}ms (samples: ${samples.join(', ')})`,
  );
  // And comfortably under the 2s ceiling the UI is written against.
  assert.ok(worst < 2000, `hard took ${worst}ms, must stay well under 2000ms`);
});

test("'hard' stays inside its budget through a whole 3-player game", () => {
  let s = newGame(3, 246);
  let worst = 0;
  let turns = 0;
  while (!isTerminal(s) && turns++ < 400) {
    const v = view(s);
    const t0 = Date.now();
    const move = chooseMove(v, { level: 'hard', seed: 77 });
    worst = Math.max(worst, Date.now() - t0);
    assertLegal(v, move, `hard turn ${turns}`);
    s = applyMove(s, move);
  }
  assert.ok(isTerminal(s), 'game did not finish');
  assert.ok(worst < 2000, `slowest hard decision was ${worst}ms`);
});

/* ------------------------------------------------------------------ */
/* describeMove                                                        */
/* ------------------------------------------------------------------ */

test('describeMove produces a short phrase for every move type', () => {
  const s = newGame(2, 1234);
  const boardCard = s.board[3].find(Boolean);
  const card = getCard(boardCard);
  const cases = [
    { type: 'take3', resources: ['cinnamon', 'indigo', 'cardamom'] },
    { type: 'take2', resource: 'saffron' },
    { type: 'buy', cardId: boardCard, fromReserve: false },
    { type: 'buy', cardId: boardCard, fromReserve: true },
    { type: 'reserve', cardId: boardCard, tier: null },
    { type: 'reserve', cardId: null, tier: 2 },
    { type: 'discard', tokens: { cinnamon: 1, indigo: 0, cardamom: 0, saffron: 0, pepper: 0, coin: 1 } },
    { type: 'chooseCompany', companyId: s.companies[0] },
    { type: 'pass' },
  ];
  for (const m of cases) {
    const text = describeMove(s, m);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0 && text.length < 120, `bad phrasing for ${m.type}: ${text}`);
    assert.ok(!/undefined|NaN|\[object/.test(text), `bad phrasing for ${m.type}: ${text}`);
  }
  // The spec's example shape: "reserves the 5-point Pepper".
  const reserved = describeMove(s, { type: 'reserve', cardId: boardCard, tier: null });
  assert.match(reserved, /^reserves /);
  if (card.points > 0) assert.match(reserved, new RegExp(`${card.points}-point`));
});

test('describeMove survives moves that reference unknown cards', () => {
  const s = newGame(2, 4);
  assert.equal(typeof describeMove(s, { type: 'buy', cardId: 'nope-99', fromReserve: false }), 'string');
  assert.equal(typeof describeMove(s, null), 'string');
});

/* ------------------------------------------------------------------ */
/* Sanity: the levels are actually ordered                             */
/* ------------------------------------------------------------------ */

test('normal beats easy over a short seeded match (sanity, not a balance test)', () => {
  // A small, fast smoke test. The real numbers come from tools/selfplay.js.
  let normalWins = 0;
  const games = 16;
  for (let g = 0; g < games; g++) {
    const seats = g % 2 === 0 ? ['normal', 'easy'] : ['easy', 'normal'];
    let s = createGame({
      players: seats.map((l, i) => ({ name: `${l}${i}`, isBot: true, botLevel: l })),
      seed: 1000 + g * 137,
    });
    let turns = 0;
    while (!isTerminal(s) && turns++ < 1200) {
      const v = view(s);
      s = applyMove(s, chooseMove(v, { level: seats[s.current], seed: 31 }));
    }
    for (const w of s.winners) if (seats[w] === 'normal') normalWins += 1 / s.winners.length;
  }
  assert.ok(
    normalWins >= games * 0.6,
    `normal won only ${normalWins}/${games} against easy — the levels may be inverted`,
  );
});
