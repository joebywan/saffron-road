/**
 * Engine tests. These deliberately do NOT depend on src/data/* — every game is
 * built from synthetic fixtures declared here, so the suite is standalone and
 * stable while the real card data evolves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RESOURCES,
  TOKENS,
  BANK_BY_PLAYERS,
  COMPANIES_BY_PLAYERS,
  COIN_COUNT,
  CARDS_PER_ROW,
  TOKEN_LIMIT,
  MAX_RESERVED,
  emptyCost,
  emptyPurse,
  total,
} from '../src/contract.js';
import { makeRng } from '../src/rng.js';
import {
  createGame,
  legalMoves,
  applyMove,
  isLegal,
  getCard,
  getCompany,
  cloneState,
  redactFor,
  determinize,
  isTerminal,
  finalScores,
  affordability,
} from '../src/engine.js';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const cost = (partial) => ({ ...emptyCost(), ...partial });
const card = (id, tier, resource, points, c) => ({ id, tier, resource, points, cost: cost(c) });
const company = (id, name, requires) => ({ id, name, points: 3, requires: cost(requires) });

/** 6 cards per tier: enough for 4 face up plus a 2-card deck. */
function smallPool() {
  const cards = [];
  for (const tier of [1, 2, 3]) {
    for (let i = 0; i < 6; i++) {
      const resource = RESOURCES[i % RESOURCES.length];
      cards.push(
        card(`s${tier}-${i}`, tier, resource, tier === 1 ? 0 : tier, {
          indigo: tier,
          saffron: i % 3,
        }),
      );
    }
  }
  return cards;
}

function smallCompanies() {
  return [
    company('sn-1', 'Alpha', { cinnamon: 3, indigo: 3 }),
    company('sn-2', 'Beta', { indigo: 3, cardamom: 3 }),
    company('sn-3', 'Gamma', { cardamom: 3, saffron: 3 }),
    company('sn-4', 'Delta', { saffron: 3, pepper: 3 }),
    company('sn-5', 'Epsilon', { pepper: 3, cinnamon: 3 }),
    company('sn-6', 'Zeta', { cinnamon: 2, indigo: 2, cardamom: 2 }),
  ];
}

/**
 * A full-size synthetic set (40/30/20) with a sane cost curve, used for the
 * random playthrough so games actually reach 15 points.
 */
function bigPool() {
  const cards = [];
  const at = (i, off) => RESOURCES[(i + off) % RESOURCES.length];

  for (let i = 0; i < 40; i++) {
    const k = Math.floor(i / 5); // 0..7 within a colour
    const c = emptyCost();
    c[at(i, 1)] = 1 + (k % 3);
    c[at(i, 2)] = 1 + ((k + 1) % 3);
    if (k >= 4) c[at(i, 3)] = 1;
    cards.push(card(`b1-${i}`, 1, RESOURCES[i % 5], k === 7 ? 1 : 0, c));
  }
  const t2points = [1, 1, 2, 2, 3, 3];
  for (let i = 0; i < 30; i++) {
    const k = Math.floor(i / 5); // 0..5
    const c = emptyCost();
    c[at(i, 1)] = 2 + (k % 3);
    c[at(i, 2)] = 2 + ((k + 1) % 2);
    c[at(i, 3)] = 1 + (k % 2);
    cards.push(card(`b2-${i}`, 2, RESOURCES[i % 5], t2points[k], c));
  }
  const t3points = [3, 4, 4, 5];
  for (let i = 0; i < 20; i++) {
    const k = Math.floor(i / 5); // 0..3
    const c = emptyCost();
    c[at(i, 1)] = 3 + (k % 2);
    c[at(i, 2)] = 3;
    c[at(i, 3)] = 2 + (k % 2);
    c[at(i, 4)] = 1;
    cards.push(card(`b3-${i}`, 3, RESOURCES[i % 5], t3points[k], c));
  }
  return cards;
}

function bigCompanies() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    out.push(
      company(`bn-${i}`, `Patron ${i}`, {
        [RESOURCES[i]]: 4,
        [RESOURCES[(i + 1) % 5]]: 4,
      }),
    );
  }
  for (let i = 0; i < 5; i++) {
    out.push(
      company(`bn-${5 + i}`, `Patron ${5 + i}`, {
        [RESOURCES[i]]: 3,
        [RESOURCES[(i + 1) % 5]]: 3,
        [RESOURCES[(i + 2) % 5]]: 3,
      }),
    );
  }
  return out;
}

const NAMES = ['Ada', 'Brin', 'Cleo', 'Dev'];
function seats(n) {
  return NAMES.slice(0, n).map((name, i) => ({ name, isBot: i > 0, botLevel: i > 0 ? 'easy' : null }));
}

/** A game on the small fixture pool. */
function game(n = 2, seed = 42, pool = smallPool(), companies = smallCompanies()) {
  return createGame({ players: seats(n), seed, cards: pool, companies });
}

function deepFreeze(obj, seen = new Set()) {
  if (obj === null || typeof obj !== 'object' || seen.has(obj)) return obj;
  seen.add(obj);
  Object.freeze(obj);
  for (const k of Object.keys(obj)) deepFreeze(obj[k], seen);
  return obj;
}

/** Every token id in play, per colour. */
function tokenTotals(s) {
  const t = emptyPurse();
  for (const k of TOKENS) {
    t[k] = s.bank[k];
    for (const p of s.players) t[k] += p.tokens[k];
  }
  return t;
}

function cardIdsInState(s) {
  const ids = [];
  for (const tier of [1, 2, 3]) {
    for (const id of s.board[tier]) if (id) ids.push(id);
    for (const id of s.decks[tier]) if (id) ids.push(id);
  }
  for (const p of s.players) {
    ids.push(...p.cards);
    for (const id of p.reserved) if (id) ids.push(id);
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

test('setup: bank, companies, board and decks for 2/3/4 players', () => {
  for (const n of [2, 3, 4]) {
    const s = game(n);
    assert.equal(s.players.length, n);
    for (const g of RESOURCES) assert.equal(s.bank[g], BANK_BY_PLAYERS[n], `bank ${g} for ${n}p`);
    assert.equal(s.bank.coin, COIN_COUNT);
    assert.equal(s.companies.length, COMPANIES_BY_PLAYERS[n]);
    assert.equal(new Set(s.companies).size, s.companies.length, 'companies are distinct');

    for (const tier of [1, 2, 3]) {
      assert.equal(s.board[tier].length, CARDS_PER_ROW);
      assert.ok(s.board[tier].every((id) => id !== null));
      assert.equal(s.decks[tier].length, 6 - CARDS_PER_ROW);
      for (const id of [...s.board[tier], ...s.decks[tier]]) {
        assert.equal(getCard(id).tier, tier);
      }
    }
    assert.equal(new Set(cardIdsInState(s)).size, 18, 'all 18 fixture cards present exactly once');

    assert.equal(s.current, 0);
    assert.equal(s.round, 1);
    assert.equal(s.phase, 'action');
    assert.equal(s.finalRound, false);
    assert.equal(s.lastPlayer, null);
    assert.equal(s.redacted, false);
    assert.deepEqual(s.winners, []);
    for (const p of s.players) {
      assert.equal(total(p.tokens), 0);
      assert.equal(p.points, 0);
      assert.deepEqual(p.cards, []);
      assert.deepEqual(p.reserved, []);
      assert.deepEqual(p.bonuses, emptyCost());
    }
  }
});

test('setup: rejects fewer than 2 or more than 4 players', () => {
  assert.throws(() => game(1));
  assert.throws(() => createGame({ players: seats(4).concat({ name: 'E' }), seed: 1, cards: smallPool(), companies: smallCompanies() }));
});

/* ------------------------------------------------------------------ */
/* Determinism / purity                                                */
/* ------------------------------------------------------------------ */

test('determinism: same seed gives an identical game, different seed does not', () => {
  const a = game(3, 12345);
  const b = game(3, 12345);
  const c = game(3, 999);
  assert.deepEqual(a, b);
  assert.notDeepEqual(
    { decks: a.decks, board: a.board, companies: a.companies },
    { decks: c.decks, board: c.board, companies: c.companies },
  );
});

test('determinism: identical move sequences yield identical states', () => {
  const run = () => {
    let s = game(2, 7);
    const rng = makeRng(3);
    for (let i = 0; i < 12 && !isTerminal(s); i++) {
      s = applyMove(s, rng.pick(legalMoves(s)));
    }
    return s;
  };
  assert.deepEqual(run(), run());
});

test('purity: applyMove does not mutate a deep-frozen input', () => {
  const s = game(2, 5);
  deepFreeze(s);
  const moves = legalMoves(s);
  for (const m of moves) {
    const next = applyMove(s, m);
    assert.notEqual(next, s);
    assert.equal(s.log.length, 0);
    assert.ok(next.log.length >= 1);
  }
  assert.equal(s.phase, 'action');
});

test('cloneState is a deep, independent copy', () => {
  const s = game(2, 5);
  const c = cloneState(s);
  assert.deepEqual(c, s);
  c.players[0].tokens.indigo = 5;
  c.decks[1].push('nope');
  c.board[1][0] = null;
  assert.equal(s.players[0].tokens.indigo, 0);
  assert.equal(s.decks[1].length, 2);
  assert.notEqual(s.board[1][0], null);
});

/* ------------------------------------------------------------------ */
/* Taking tokens                                                       */
/* ------------------------------------------------------------------ */

test('take3: generates all 10 distinct triples from a full bank', () => {
  const s = game(2);
  const takes = legalMoves(s).filter((m) => m.type === 'take3');
  assert.equal(takes.length, 10);
  assert.ok(takes.every((m) => m.resources.length === 3));
  const next = applyMove(s, { type: 'take3', resources: ['cinnamon', 'indigo', 'cardamom'] });
  assert.equal(next.players[0].tokens.cinnamon, 1);
  assert.equal(next.bank.cinnamon, BANK_BY_PLAYERS[2] - 1);
  assert.equal(next.current, 1);
  assert.equal(next.log.at(-1).text, 'Ada took cinnamon, indigo, cardamom');
});

test('take3: resource order does not matter', () => {
  const s = game(2);
  assert.ok(isLegal(s, { type: 'take3', resources: ['cardamom', 'cinnamon', 'indigo'] }));
});

test('take3: repeated colours are illegal', () => {
  const s = game(2);
  assert.equal(isLegal(s, { type: 'take3', resources: ['indigo', 'indigo', 'saffron'] }), false);
});

test('take3: fewer than 3 colours left allows (and requires) a short take', () => {
  const s = game(2);
  for (const g of RESOURCES) s.bank[g] = 0;
  s.bank.cinnamon = 1;
  s.bank.indigo = 2;

  const takes = legalMoves(s).filter((m) => m.type === 'take3');
  assert.equal(takes.length, 1);
  assert.deepEqual(takes[0].resources.slice().sort(), ['cinnamon', 'indigo']);
  // A single resource is not allowed while two colours remain.
  assert.equal(isLegal(s, { type: 'take3', resources: ['indigo'] }), false);
  assert.equal(isLegal(s, { type: 'take3', resources: ['indigo', 'cinnamon', 'cardamom'] }), false);

  const next = applyMove(s, takes[0]);
  assert.equal(next.bank.cinnamon, 0);
  assert.equal(next.bank.indigo, 1);
});

test('take3: exactly one colour left allows a single take', () => {
  const s = game(2);
  for (const g of RESOURCES) s.bank[g] = 0;
  s.bank.saffron = 1;
  const takes = legalMoves(s).filter((m) => m.type === 'take3');
  assert.deepEqual(takes, [{ type: 'take3', resources: ['saffron'] }]);
});

test('take2: needs a pile of 4 before the take', () => {
  const s = game(2); // 2p bank = 4 per colour
  assert.ok(isLegal(s, { type: 'take2', resource: 'indigo' }));
  s.bank.indigo = 3;
  assert.equal(isLegal(s, { type: 'take2', resource: 'indigo' }), false);
  assert.throws(() => applyMove(s, { type: 'take2', resource: 'indigo' }), /Illegal move/);
  s.bank.indigo = 4;
  const next = applyMove(s, { type: 'take2', resource: 'indigo' });
  assert.equal(next.bank.indigo, 2);
  assert.equal(next.players[0].tokens.indigo, 2);
  assert.equal(next.log.at(-1).text, 'Ada took 2 indigo');
});

test('take2: no take2 at all in a 3-token-per-pile bank', () => {
  const s = game(2);
  for (const g of RESOURCES) s.bank[g] = 3;
  assert.equal(legalMoves(s).filter((m) => m.type === 'take2').length, 0);
});

/* ------------------------------------------------------------------ */
/* Buying                                                              */
/* ------------------------------------------------------------------ */

/** A 2-player game whose tier-1 row starts with a known card. */
function buyFixture(cardCost, { bonuses = {}, tokens = {} } = {}) {
  const pool = [
    card('x-1', 1, 'pepper', 1, cardCost),
    card('x-2', 1, 'cinnamon', 0, { saffron: 1 }),
    card('x-3', 1, 'indigo', 0, { saffron: 1 }),
    card('x-4', 1, 'cardamom', 0, { saffron: 1 }),
    card('x-5', 1, 'saffron', 0, { saffron: 1 }),
    ...smallPool().filter((c) => c.tier !== 1),
  ];
  const s = createGame({ players: seats(2), seed: 1, cards: pool, companies: [] });
  // Pin the target card into a known slot regardless of the shuffle.
  const tier = s.board[1];
  const at = tier.indexOf('x-1');
  if (at === -1) {
    const spare = s.decks[1].indexOf('x-1');
    [tier[0], s.decks[1][spare]] = [s.decks[1][spare], tier[0]];
  } else {
    [tier[0], tier[at]] = [tier[at], tier[0]];
  }
  Object.assign(s.players[0].bonuses, bonuses);
  Object.assign(s.players[0].tokens, tokens);
  return s;
}

test('buy: exact resources, tokens go back to the bank', () => {
  const s = buyFixture({ indigo: 3 }, { tokens: { indigo: 3 } });
  const bankBefore = s.bank.indigo;
  const aff = affordability(s, 0, getCard('x-1'));
  assert.deepEqual(aff, { affordable: true, pay: { ...emptyPurse(), indigo: 3 }, shortfall: 0 });

  const next = applyMove(s, { type: 'buy', cardId: 'x-1', fromReserve: false });
  const p = next.players[0];
  assert.deepEqual(p.cards, ['x-1']);
  assert.equal(p.bonuses.pepper, 1);
  assert.equal(p.points, 1);
  assert.equal(p.tokens.indigo, 0);
  assert.equal(next.bank.indigo, bankBefore + 3);
  assert.equal(next.log.at(-1).text, 'Ada bought Pepper (1pts) for 3 indigo');
});

test('buy: gold covers the shortfall', () => {
  const s = buyFixture({ indigo: 3 }, { tokens: { indigo: 1, coin: 2 } });
  const aff = affordability(s, 0, getCard('x-1'));
  assert.equal(aff.affordable, true);
  assert.equal(aff.shortfall, 2);
  assert.deepEqual(aff.pay, { ...emptyPurse(), indigo: 1, coin: 2 });

  const next = applyMove(s, { type: 'buy', cardId: 'x-1', fromReserve: false });
  assert.equal(next.players[0].tokens.coin, 0);
  assert.equal(next.players[0].tokens.indigo, 0);
  assert.equal(next.bank.coin, COIN_COUNT + 2);
  assert.equal(next.log.at(-1).text, 'Ada bought Pepper (1pts) for 1 indigo, 2 coin');
});

test('buy: rejected when unaffordable', () => {
  const s = buyFixture({ indigo: 3 }, { tokens: { indigo: 1, coin: 1 } });
  const aff = affordability(s, 0, getCard('x-1'));
  assert.equal(aff.affordable, false);
  assert.equal(aff.shortfall, 2);
  assert.equal(isLegal(s, { type: 'buy', cardId: 'x-1', fromReserve: false }), false);
  assert.throws(() => applyMove(s, { type: 'buy', cardId: 'x-1', fromReserve: false }), /Illegal move/);
  assert.equal(legalMoves(s).some((m) => m.type === 'buy' && m.cardId === 'x-1'), false);
});

test('buy: bonuses discount the cost', () => {
  const s = buyFixture({ indigo: 3, saffron: 2 }, { bonuses: { indigo: 2 }, tokens: { indigo: 1, saffron: 2 } });
  const aff = affordability(s, 0, getCard('x-1'));
  assert.deepEqual(aff.pay, { ...emptyPurse(), indigo: 1, saffron: 2 });
  assert.equal(aff.shortfall, 0);
});

test('buy: a fully discounted card is free', () => {
  const s = buyFixture({ indigo: 3 }, { bonuses: { indigo: 3 } });
  const aff = affordability(s, 0, getCard('x-1'));
  assert.equal(aff.affordable, true);
  assert.equal(total(aff.pay), 0);
  const next = applyMove(s, { type: 'buy', cardId: 'x-1', fromReserve: false });
  assert.equal(total(next.players[0].tokens), 0);
  assert.equal(next.log.at(-1).text, 'Ada bought Pepper (1pts) for free');
});

test('buy: refills the emptied slot from the deck', () => {
  const s = buyFixture({ indigo: 3 }, { tokens: { indigo: 3 } });
  const slot = s.board[1].indexOf('x-1');
  const nextUp = s.decks[1][0];
  const deckLen = s.decks[1].length;
  const next = applyMove(s, { type: 'buy', cardId: 'x-1', fromReserve: false });
  assert.equal(next.board[1][slot], nextUp);
  assert.equal(next.decks[1].length, deckLen - 1);
  assert.equal(next.board[1].length, CARDS_PER_ROW);
});

test('board: slot becomes null and stays null once the deck is dry', () => {
  // Exactly CARDS_PER_ROW tier-1 cards: the deck starts empty.
  const pool = [
    card('e-1', 1, 'pepper', 0, { indigo: 1 }),
    card('e-2', 1, 'cinnamon', 0, { indigo: 1 }),
    card('e-3', 1, 'indigo', 0, { indigo: 1 }),
    card('e-4', 1, 'cardamom', 0, { indigo: 1 }),
    ...smallPool().filter((c) => c.tier !== 1),
  ];
  let s = createGame({ players: seats(2), seed: 3, cards: pool, companies: [] });
  assert.equal(s.decks[1].length, 0);

  const target = s.board[1][2];
  s.players[0].tokens.indigo = 1;
  s = applyMove(s, { type: 'buy', cardId: target, fromReserve: false });
  assert.equal(s.board[1][2], null);
  assert.equal(s.board[1].length, CARDS_PER_ROW);

  // Still null a turn later, and never offered as a move.
  s.players[1].tokens.indigo = 1;
  s = applyMove(s, { type: 'buy', cardId: s.board[1][0], fromReserve: false });
  assert.equal(s.board[1][2], null);
  assert.ok(legalMoves(s).every((m) => m.cardId !== null || m.type !== 'buy'));
});

/* ------------------------------------------------------------------ */
/* Reserving                                                           */
/* ------------------------------------------------------------------ */

test('reserve: face-up card, gold granted, slot refilled', () => {
  const s = game(2);
  const target = s.board[2][1];
  const nextUp = s.decks[2][0];
  const next = applyMove(s, { type: 'reserve', cardId: target, tier: null });
  assert.deepEqual(next.players[0].reserved, [target]);
  assert.equal(next.players[0].tokens.coin, 1);
  assert.equal(next.bank.coin, COIN_COUNT - 1);
  assert.equal(next.board[2][1], nextUp);
  assert.match(next.log.at(-1).text, /reserved .* and took a coin/);
});

test('reserve: still happens when the bank has no gold', () => {
  const s = game(2);
  s.bank.coin = 0;
  const target = s.board[1][0];
  const next = applyMove(s, { type: 'reserve', cardId: target, tier: null });
  assert.deepEqual(next.players[0].reserved, [target]);
  assert.equal(next.players[0].tokens.coin, 0);
  assert.equal(next.bank.coin, 0);
  assert.match(next.log.at(-1).text, /no coin left/);
});

test('reserve: blind draw from a deck top', () => {
  const s = game(2);
  const top = s.decks[3][0];
  const deckLen = s.decks[3].length;
  const next = applyMove(s, { type: 'reserve', cardId: null, tier: 3 });
  assert.deepEqual(next.players[0].reserved, [top]);
  assert.equal(next.decks[3].length, deckLen - 1);
  assert.deepEqual(next.board[3], s.board[3], 'blind reserve does not touch the row');
  assert.match(next.log.at(-1).text, /unseen/);
  assert.ok(!next.log.at(-1).text.includes(top), 'a blind reserve does not name the card');
});

test('reserve: blind draw is unavailable once the deck is empty', () => {
  const s = game(2);
  s.decks[2] = [];
  assert.equal(isLegal(s, { type: 'reserve', cardId: null, tier: 2 }), false);
  assert.ok(legalMoves(s).some((m) => m.type === 'reserve' && m.tier === 1));
});

test('reserve: capped at 3', () => {
  const s = game(2);
  s.players[0].reserved = [s.decks[1][0], s.decks[1][1], s.decks[2][0]];
  s.decks[1] = [];
  s.decks[2] = s.decks[2].slice(1);
  assert.equal(s.players[0].reserved.length, MAX_RESERVED);
  assert.equal(legalMoves(s).filter((m) => m.type === 'reserve').length, 0);
  assert.equal(isLegal(s, { type: 'reserve', cardId: s.board[1][0], tier: null }), false);
});

test('reserve: cardId and tier are mutually exclusive', () => {
  const s = game(2);
  assert.equal(isLegal(s, { type: 'reserve', cardId: s.board[1][0], tier: 1 }), false);
  assert.equal(isLegal(s, { type: 'reserve', cardId: null, tier: null }), false);
});

test('buy from reserve: card leaves the reserve, board untouched', () => {
  let s = game(2);
  const target = s.board[1][0];
  const c = getCard(target);
  s = applyMove(s, { type: 'reserve', cardId: target, tier: null });
  // Give player 0 the tokens for it and hand the turn back.
  s = applyMove(s, legalMoves(s).find((m) => m.type === 'take2'));
  for (const g of RESOURCES) s.players[0].tokens[g] = 9;
  s.players[0].tokens.coin = 0;

  const boardBefore = s.board[1].slice();
  const next = applyMove(s, { type: 'buy', cardId: target, fromReserve: true });
  assert.deepEqual(next.players[0].reserved, []);
  assert.deepEqual(next.players[0].cards, [target]);
  assert.deepEqual(next.board[1], boardBefore, 'buying from reserve does not touch the row');
  assert.equal(next.players[0].bonuses[c.resource], 1);
});

/* ------------------------------------------------------------------ */
/* Discard phase                                                       */
/* ------------------------------------------------------------------ */

test('discard: over the limit forces a discard back to exactly 10', () => {
  const s = game(2);
  s.players[0].tokens.cinnamon = 9;
  const after = applyMove(s, { type: 'take3', resources: ['indigo', 'cardamom', 'saffron'] });
  assert.equal(after.phase, 'discard');
  assert.equal(after.current, 0, 'the same player must discard');
  assert.equal(total(after.players[0].tokens), 12);

  const moves = legalMoves(after);
  assert.ok(moves.length > 1);
  assert.ok(moves.every((m) => m.type === 'discard' && total(m.tokens) === 2));
  const keys = new Set(moves.map((m) => TOKENS.map((t) => m.tokens[t] || 0).join(',')));
  assert.equal(keys.size, moves.length, 'discard options are distinct');
  // Cannot discard tokens you do not hold.
  assert.equal(isLegal(after, { type: 'discard', tokens: { ...emptyPurse(), coin: 2 } }), false);
  // Cannot stop short of the limit.
  assert.equal(isLegal(after, { type: 'discard', tokens: { ...emptyPurse(), cinnamon: 1 } }), false);

  const bankWhite = after.bank.cinnamon;
  const done = applyMove(after, { type: 'discard', tokens: { ...emptyPurse(), cinnamon: 2 } });
  assert.equal(total(done.players[0].tokens), TOKEN_LIMIT);
  assert.equal(done.bank.cinnamon, bankWhite + 2);
  assert.equal(done.phase, 'action');
  assert.equal(done.current, 1);
  assert.equal(done.log.at(-1).text, 'Ada discarded 2 cinnamon');
});

test('discard: exactly 10 tokens does not trigger the phase', () => {
  const s = game(2);
  s.players[0].tokens.cinnamon = 7;
  const after = applyMove(s, { type: 'take3', resources: ['indigo', 'cardamom', 'saffron'] });
  assert.equal(total(after.players[0].tokens), 10);
  assert.equal(after.phase, 'action');
  assert.equal(after.current, 1);
});

/* ------------------------------------------------------------------ */
/* Companies                                                              */
/* ------------------------------------------------------------------ */

/** Board with a cheap black card; companies chosen by the caller. */
function companyFixture(companies) {
  const pool = [
    card('n-card', 1, 'pepper', 0, { indigo: 1 }),
    card('n-2', 1, 'cinnamon', 0, { indigo: 9 }),
    card('n-3', 1, 'indigo', 0, { indigo: 9 }),
    card('n-4', 1, 'cardamom', 0, { indigo: 9 }),
    ...smallPool().filter((c) => c.tier !== 1),
  ];
  const s = createGame({ players: seats(2), seed: 11, cards: pool, companies });
  s.players[0].tokens.indigo = 1;
  return s;
}

test('company: a single qualifying company is awarded automatically', () => {
  const s = companyFixture([company('N1', 'Solo', { pepper: 1 })]);
  const next = applyMove(s, { type: 'buy', cardId: 'n-card', fromReserve: false });
  assert.deepEqual(next.players[0].companies, ['N1']);
  assert.equal(next.players[0].points, 3);
  assert.deepEqual(next.companies, []);
  assert.equal(next.phase, 'action');
  assert.equal(next.current, 1);
  assert.match(next.log.at(-1).text, /visited by Solo \(3pts\)/);
});

test('company: two qualifying companies open a choice phase, and only one is taken', () => {
  const s = companyFixture([
    company('N1', 'First', { pepper: 1 }),
    company('N2', 'Second', { pepper: 1 }),
    company('N3', 'Unreachable', { cinnamon: 4 }),
  ]);
  const mid = applyMove(s, { type: 'buy', cardId: 'n-card', fromReserve: false });
  assert.equal(mid.phase, 'company');
  assert.equal(mid.current, 0);
  assert.deepEqual(mid.companyChoices.slice().sort(), ['N1', 'N2']);
  assert.deepEqual(legalMoves(mid), [
    { type: 'chooseCompany', companyId: 'N1' },
    { type: 'chooseCompany', companyId: 'N2' },
  ]);
  assert.equal(isLegal(mid, { type: 'chooseCompany', companyId: 'N3' }), false);
  assert.equal(isLegal(mid, { type: 'take2', resource: 'indigo' }), false);

  const next = applyMove(mid, { type: 'chooseCompany', companyId: 'N2' });
  assert.deepEqual(next.players[0].companies, ['N2']);
  assert.equal(next.players[0].points, 3);
  assert.deepEqual(next.companies.slice().sort(), ['N1', 'N3'], 'at most one company per turn');
  assert.deepEqual(next.companyChoices, []);
  assert.equal(next.phase, 'action');
  assert.equal(next.current, 1);
});

test('company: the discard phase resolves before companies', () => {
  const s = companyFixture([company('N1', 'Solo', { pepper: 1 })]);
  s.players[0].tokens.indigo = 1;
  s.players[0].tokens.cinnamon = 11; // 11 tokens still in hand after the 1 blue is spent
  const mid = applyMove(s, { type: 'buy', cardId: 'n-card', fromReserve: false });
  assert.equal(mid.phase, 'discard');
  assert.deepEqual(mid.players[0].companies, [], 'company waits until the discard is done');
  const done = applyMove(mid, { type: 'discard', tokens: { ...emptyPurse(), cinnamon: 1 } });
  assert.deepEqual(done.players[0].companies, ['N1']);
  assert.equal(done.phase, 'action');
  assert.equal(done.current, 1);
});

/* ------------------------------------------------------------------ */
/* End of game                                                         */
/* ------------------------------------------------------------------ */

test('endgame: hitting 15 starts a final round in which everyone plays equally often', () => {
  for (const n of [2, 3, 4]) {
    let s = game(n, 4);
    s.players[0].points = 14;
    // Just enough tokens for one tier-2 card — staying under the token limit
    // so the turn is not interrupted by a discard.
    s.players[0].tokens.indigo = 2;
    s.players[0].tokens.saffron = 2;
    // Player 0 buys a 2-point tier-2 card and crosses 15.
    const target = s.board[2].find((id) => getCard(id).points > 0);
    s = applyMove(s, { type: 'buy', cardId: target, fromReserve: false });
    assert.ok(s.players[0].points >= 15);
    assert.equal(s.finalRound, true);
    assert.equal(s.lastPlayer, n - 1);
    assert.equal(s.phase, 'action');

    const turns = new Array(n).fill(0);
    turns[0] = 1;
    let guard = 0;
    while (!isTerminal(s) && guard++ < 50) {
      const actor = s.current;
      s = applyMove(s, legalMoves(s)[0]);
      if (s.current !== actor || isTerminal(s)) turns[actor] += 1;
    }
    assert.equal(s.phase, 'gameover');
    assert.deepEqual(turns, new Array(n).fill(1), `${n}p: equal turns in the final round`);
    assert.ok(s.winners.length >= 1);
    assert.match(s.log.at(-1).text, /Game over/);
  }
});

test('endgame: legalMoves never returns empty, even when terminal', () => {
  let s = game(2, 8);
  s.finalRound = true;
  s.lastPlayer = 1;
  s.current = 1;
  s = applyMove(s, legalMoves(s)[0]);
  assert.equal(s.phase, 'gameover');
  assert.deepEqual(legalMoves(s), [{ type: 'pass' }]);
  const after = applyMove(s, { type: 'pass' });
  assert.equal(after.phase, 'gameover');
  assert.deepEqual(after.players, s.players);
});

test('endgame: the winner is decided on points, then on fewest cards', () => {
  let s = game(2, 8);
  s.players[0].points = 16;
  s.players[0].cards = ['a', 'b', 'c', 'd'];
  s.players[1].points = 16;
  s.players[1].cards = ['e', 'f'];
  s.finalRound = true;
  s.lastPlayer = 1;
  s.current = 1;
  s = applyMove(s, legalMoves(s).find((m) => m.type === 'take2'));
  assert.equal(s.phase, 'gameover');
  assert.deepEqual(s.winners, [1], 'fewer cards wins the tie');

  const scores = finalScores(s);
  assert.deepEqual(scores.map((r) => r.index), [1, 0]);
  assert.deepEqual(scores.map((r) => r.rank), [1, 2]);
  assert.deepEqual(scores[0], { index: 1, points: 16, cardCount: 2, rank: 1 });
});

test('endgame: identical points and card counts share the win', () => {
  let s = game(3, 8);
  for (const p of s.players.slice(0, 2)) {
    p.points = 15;
    p.cards = ['a', 'b'];
  }
  s.players[2].points = 4;
  s.finalRound = true;
  s.lastPlayer = 2;
  s.current = 2;
  s = applyMove(s, legalMoves(s).find((m) => m.type === 'take2'));
  assert.equal(s.phase, 'gameover');
  assert.deepEqual(s.winners, [0, 1]);
  assert.deepEqual(finalScores(s).map((r) => r.rank), [1, 1, 3]);
  assert.match(s.log.at(-1).text, /share the win/);
});

test('pass is only legal when nothing else is', () => {
  const s = game(2);
  assert.equal(isLegal(s, { type: 'pass' }), false);

  const stuck = game(2);
  for (const g of RESOURCES) stuck.bank[g] = 0;
  stuck.bank.coin = 0;
  stuck.board = { 1: [null, null, null, null], 2: [null, null, null, null], 3: [null, null, null, null] };
  stuck.decks = { 1: [], 2: [], 3: [] };
  assert.deepEqual(legalMoves(stuck), [{ type: 'pass' }]);
  const next = applyMove(stuck, { type: 'pass' });
  assert.equal(next.current, 1);
  assert.equal(next.log.at(-1).text, 'Ada passed');

  // A whole round of passes is a dead game: end it rather than loop forever.
  const dead = applyMove(next, { type: 'pass' });
  assert.equal(dead.phase, 'gameover');
  assert.ok(isTerminal(dead));
  assert.match(dead.log.at(-1).text, /every player passed/);
});

/* ------------------------------------------------------------------ */
/* Hidden information                                                  */
/* ------------------------------------------------------------------ */

test('redactFor hides the decks and only the blind-drawn reserved cards', () => {
  let s = game(3, 21);
  s = applyMove(s, { type: 'reserve', cardId: s.board[1][0], tier: null }); // p0 face-up
  s = applyMove(s, { type: 'reserve', cardId: s.board[1][0], tier: null }); // p1 face-up
  s = applyMove(s, { type: 'reserve', cardId: null, tier: 2 }); // p2 blind

  const view = redactFor(s, 1);
  assert.equal(view.redacted, true);
  for (const tier of [1, 2, 3]) {
    assert.equal(view.decks[tier].length, s.decks[tier].length);
    assert.ok(view.decks[tier].every((x) => x === null));
    assert.deepEqual(view.board[tier], s.board[tier], 'the row stays public');
  }
  assert.deepEqual(view.players[1].reserved, s.players[1].reserved, 'own reserve is visible');
  assert.deepEqual(view.players[0].reserved, s.players[0].reserved, 'a face-up reserve is public');
  assert.deepEqual(view.players[2].reserved, [null], 'a blind reserve is secret');
  assert.deepEqual(view.players[2].reservedBlind, [null], 'the count survives, the id does not');
  assert.equal(view.bank.coin, s.bank.coin);
  // The original is untouched.
  assert.equal(s.redacted, false);
  assert.ok(s.decks[1].every((x) => typeof x === 'string'));
});

test('reserving face up leaves the card visible to every opponent', () => {
  let s = game(3, 21);
  const target = s.board[2][0];
  s = applyMove(s, { type: 'reserve', cardId: target, tier: null }); // p0

  assert.deepEqual(s.players[0].reserved, [target]);
  assert.deepEqual(s.players[0].reservedBlind, [], 'a face-up reserve is never blind');
  for (const observer of [0, 1, 2]) {
    const view = redactFor(s, observer);
    assert.deepEqual(view.players[0].reserved, [target], `visible to p${observer}`);
  }
  assert.match(s.log.at(-1).text, /from tier 2/);
});

test('reserving blind hides the card from opponents but not from its owner', () => {
  let s = game(3, 21);
  const top = s.decks[3][0];
  s = applyMove(s, { type: 'reserve', cardId: null, tier: 3 }); // p0

  assert.deepEqual(s.players[0].reserved, [top]);
  assert.deepEqual(s.players[0].reservedBlind, [top]);

  assert.deepEqual(redactFor(s, 0).players[0].reserved, [top], 'the owner still sees it');
  assert.deepEqual(redactFor(s, 0).players[0].reservedBlind, [top]);
  for (const observer of [1, 2]) {
    const view = redactFor(s, observer);
    assert.deepEqual(view.players[0].reserved, [null], `hidden from p${observer}`);
    assert.equal(view.players[0].reservedBlind.length, 1, 'the count is public');
    // The id must not survive anywhere it could be read back off the opponent:
    // not in their reserve, not in the blind list, not in the log entry.
    assert.ok(!view.players[0].reserved.includes(top));
    assert.ok(!view.players[0].reservedBlind.includes(top));
    assert.ok(view.log.every((e) => !e.text.includes(top) && (!e.move || e.move.cardId !== top)));
  }
});

test('one of each: an opponent sees exactly one card and one placeholder', () => {
  let s = game(2, 33);
  const faceUp = s.board[1][2];
  s = applyMove(s, { type: 'reserve', cardId: faceUp, tier: null }); // p0
  s = applyMove(s, legalMoves(s).find((m) => m.type === 'take2')); // p1
  const blind = s.decks[2][0];
  s = applyMove(s, { type: 'reserve', cardId: null, tier: 2 }); // p0

  assert.deepEqual(s.players[0].reserved, [faceUp, blind]);
  assert.deepEqual(s.players[0].reservedBlind, [blind]);

  const view = redactFor(s, 1);
  const seen = view.players[0].reserved;
  assert.equal(seen.length, 2);
  assert.equal(seen.filter((id) => id === faceUp).length, 1, 'exactly one visible card');
  assert.equal(seen.filter((id) => id === null).length, 1, 'exactly one placeholder');
  assert.equal(view.players[0].reservedBlind.length, 1, 'exactly one face-down card held');
});

test('determinize fills only the blind slots and leaves public reserves alone', () => {
  let s = game(3, 91);
  const faceUp = s.board[1][0];
  s = applyMove(s, { type: 'reserve', cardId: faceUp, tier: null }); // p0
  const blind = s.decks[3][0];
  s = applyMove(s, { type: 'reserve', cardId: null, tier: 3 }); // p1
  s = applyMove(s, legalMoves(s).find((m) => m.type === 'take2')); // p2

  const view = redactFor(s, 2);
  const world = determinize(view, 4242);

  assert.deepEqual(world.players[0].reserved, [faceUp], 'the public reserve is untouched');
  assert.deepEqual(world.players[0].reservedBlind, []);
  assert.equal(world.players[1].reserved.length, 1);
  assert.equal(typeof world.players[1].reserved[0], 'string', 'the blind slot is filled');
  assert.deepEqual(
    world.players[1].reservedBlind,
    world.players[1].reserved,
    'the sampled card is still marked blind',
  );
  assert.notEqual(world.players[1].reserved[0], faceUp, 'it cannot be a card already placed');

  const ids = cardIdsInState(world);
  assert.equal(new Set(ids).size, ids.length, 'no duplicated cards');
  assert.deepEqual(ids.slice().sort(), world.cardPool.slice().sort(), 'every card accounted for');

  // Sampling is over the genuinely unknown cards only: the true blind card is
  // one possibility among several, never a certainty.
  const sampled = new Set();
  for (let seed = 0; seed < 40; seed++) sampled.add(determinize(view, seed).players[1].reserved[0]);
  assert.ok(sampled.size > 1, 'the hidden card is genuinely uncertain');
  assert.ok(sampled.has(blind), 'the true card is reachable');

  // And it is playable.
  const moves = legalMoves(world);
  assert.ok(moves.length > 0);
  for (const m of moves) assert.doesNotThrow(() => applyMove(world, m));
});

test('buying a blind-reserved card makes it public and leaves no stale id behind', () => {
  let s = game(2, 8);
  const blind = s.decks[1][0];
  s = applyMove(s, { type: 'reserve', cardId: null, tier: 1 }); // p0
  assert.deepEqual(s.players[0].reservedBlind, [blind]);

  s = applyMove(s, legalMoves(s).find((m) => m.type === 'take2')); // p1
  for (const g of RESOURCES) s.players[0].tokens[g] = 9;
  s.players[0].tokens.coin = 0;

  const next = applyMove(s, { type: 'buy', cardId: blind, fromReserve: true });
  assert.deepEqual(next.players[0].reserved, []);
  assert.deepEqual(next.players[0].reservedBlind, [], 'no stale id left in the blind list');
  assert.deepEqual(next.players[0].cards, [blind]);
  // The purchase is public: an opponent's view shows the card as owned.
  const view = redactFor(next, 1);
  assert.deepEqual(view.players[0].cards, [blind]);
  assert.deepEqual(view.players[0].reservedBlind, []);
});

test('reservedBlind survives cloneState and is created empty', () => {
  const s = game(2);
  for (const p of s.players) assert.deepEqual(p.reservedBlind, []);
  let t = applyMove(s, { type: 'reserve', cardId: null, tier: 2 });
  const copy = cloneState(t);
  assert.deepEqual(copy.players[0].reservedBlind, t.players[0].reservedBlind);
  copy.players[0].reservedBlind.push('nope');
  assert.equal(t.players[0].reservedBlind.length, 1, 'the clone is independent');
  // And a state that never knew about the field still clones.
  const legacy = cloneState(s);
  delete legacy.players[0].reservedBlind;
  assert.deepEqual(cloneState(legacy).players[0].reservedBlind, []);
});

test('determinize turns a redacted view into a playable, consistent world', () => {
  let s = game(4, 77);
  s = applyMove(s, { type: 'reserve', cardId: s.board[1][0], tier: null });
  s = applyMove(s, { type: 'reserve', cardId: null, tier: 3 });

  const view = redactFor(s, 3);
  const world = determinize(view, 12345);

  assert.equal(world.redacted, false);
  for (const tier of [1, 2, 3]) {
    assert.equal(world.decks[tier].length, s.decks[tier].length);
    assert.ok(world.decks[tier].every((id) => typeof id === 'string'));
    assert.ok(world.decks[tier].every((id) => getCard(id).tier === tier), 'decks stay in tier');
  }
  for (const p of world.players) {
    assert.equal(p.reserved.length, s.players[p.index].reserved.length);
    assert.ok(p.reserved.every((id) => typeof id === 'string'));
  }

  const ids = cardIdsInState(world);
  assert.equal(new Set(ids).size, ids.length, 'no duplicated cards');
  assert.deepEqual(ids.slice().sort(), world.cardPool.slice().sort(), 'every card accounted for');

  // Visible facts survive untouched.
  assert.deepEqual(world.board, s.board);
  assert.deepEqual(world.bank, s.bank);
  assert.deepEqual(world.players[3].reserved, s.players[3].reserved);

  // And it is playable.
  const moves = legalMoves(world);
  assert.ok(moves.length > 0);
  for (const m of moves) assert.doesNotThrow(() => applyMove(world, m));
});

test('determinize with different rng states samples different worlds', () => {
  const view = redactFor(game(2, 5), 0);
  const a = determinize(view, 1);
  const b = determinize(view, 2);
  assert.notDeepEqual(a.decks, b.decks);
  assert.deepEqual(determinize(view, 1).decks, a.decks, 'same rng state, same world');
});

/* ------------------------------------------------------------------ */
/* Full playthrough                                                    */
/* ------------------------------------------------------------------ */

function checkInvariants(s, startTotals, label) {
  const t = tokenTotals(s);
  for (const k of TOKENS) {
    assert.equal(t[k], startTotals[k], `${label}: ${k} tokens conserved`);
  }
  for (const p of s.players) {
    if (!(s.phase === 'discard' && p.index === s.current)) {
      assert.ok(total(p.tokens) <= TOKEN_LIMIT, `${label}: p${p.index} within the token limit`);
    }
    assert.ok(p.reserved.length <= MAX_RESERVED, `${label}: p${p.index} reserve cap`);
    assert.ok(
      p.reservedBlind.length <= p.reserved.length,
      `${label}: p${p.index} blind list within the reserve`,
    );
    for (const id of p.reservedBlind) {
      assert.ok(p.reserved.includes(id), `${label}: p${p.index} stale blind id ${id}`);
      assert.ok(!p.cards.includes(id), `${label}: p${p.index} bought card still listed blind`);
    }
    const expected =
      p.cards.reduce((n, id) => n + getCard(id).points, 0) +
      p.companies.reduce((n, id) => n + getCompany(id).points, 0);
    assert.equal(p.points, expected, `${label}: p${p.index} points match cards + companies`);
  }
  const ids = cardIdsInState(s);
  assert.equal(new Set(ids).size, ids.length, `${label}: no duplicated cards`);
  assert.equal(ids.length, s.cardPool.length, `${label}: no lost cards`);
  for (const tier of [1, 2, 3]) {
    assert.equal(s.board[tier].length, CARDS_PER_ROW, `${label}: row ${tier} width`);
  }
}

for (const [n, seed] of [
  [2, 1],
  [3, 2],
  [4, 3],
]) {
  test(`playthrough: seeded random ${n}-player game reaches gameover intact`, () => {
    let s = createGame({ players: seats(n), seed, cards: bigPool(), companies: bigCompanies() });
    const startTotals = tokenTotals(s);
    const rng = makeRng(seed * 31 + 7);

    let steps = 0;
    while (!isTerminal(s)) {
      assert.ok(steps++ < 5000, 'game should finish in a sane number of moves');
      const moves = legalMoves(s);
      assert.ok(moves.length > 0);
      // Buy when possible, otherwise anything: random-but-greedy keeps the
      // game moving without ever picking an illegal move.
      const buys = moves.filter((m) => m.type === 'buy');
      const move = buys.length && rng() < 0.6 ? rng.pick(buys) : rng.pick(moves);
      assert.ok(isLegal(s, move));
      s = applyMove(s, move);
      checkInvariants(s, startTotals, `${n}p step ${steps}`);
    }

    assert.equal(s.phase, 'gameover');
    assert.ok(s.winners.length >= 1);
    assert.ok(Math.max(...s.players.map((p) => p.points)) >= 15);
    checkInvariants(s, startTotals, `${n}p final`);

    const scores = finalScores(s);
    assert.equal(scores.length, n);
    assert.equal(scores[0].rank, 1);
    assert.deepEqual(
      s.winners.slice().sort(),
      scores.filter((r) => r.rank === 1).map((r) => r.index).sort(),
    );
    assert.ok(s.log.length > 10);
    assert.ok(s.log.every((e) => typeof e.text === 'string' && e.text.length > 0));
  });
}

/* ------------------------------------------------------------------ */
/* Hidden information: the seed must not survive redaction             */
/* ------------------------------------------------------------------ */

test('redactFor strips the seed so the deck order cannot be reconstructed', () => {
  const cfg = {
    players: seats(2),
    seed: 987654,
    cards: bigPool(),
    companies: bigCompanies(),
  };
  const g = createGame(cfg);
  const view = redactFor(g, 0);

  // The hole this guards: re-running createGame with a leaked seed reproduces
  // the exact shuffle, handing a bot every hidden card for free.
  assert.equal(view.seed, null, 'seed must not survive redaction');
  assert.equal(view.rngState, null, 'rngState must not survive redaction');

  const rebuilt = createGame({ ...cfg, seed: 987654 });
  assert.deepEqual(
    rebuilt.decks,
    g.decks,
    'sanity: the same seed really does reproduce the same deck order',
  );

  // And nothing else in the view should expose deck order either.
  for (const t of [1, 2, 3]) {
    assert.ok(
      view.decks[t].every((x) => x === null),
      `tier ${t} deck must be fully nulled`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Saving a game in progress                                           */
/* ------------------------------------------------------------------ */

/*
 * The UI persists a game by writing state through JSON.stringify and reading
 * it back with JSON.parse (see saveGame/loadGame in src/ui/app.js). That makes
 * "the state is JSON-safe and lossless" a load-bearing property of the ENGINE,
 * not of the UI — and it is the kind of property that breaks silently. A Map,
 * a Set, a class instance or an `undefined` added to the state would keep
 * every existing test green and would drop out of a save without a word.
 *
 * These live here rather than in a UI test because there is no DOM in this
 * suite and none is needed: the risk is in the shape of the state, and the
 * shape belongs to the engine.
 */

test('a game in progress survives a JSON round-trip unchanged', () => {
  const seed = 4242;
  let s = createGame({ players: seats(3), seed, cards: bigPool(), companies: bigCompanies() });
  const rng = makeRng(seed * 17 + 3);

  // Deep enough to have exercised the interesting fields: cards bought, tokens
  // held, reserves taken, companies claimed, a log with entries in it.
  for (let i = 0; i < 60 && !isTerminal(s); i++) {
    const moves = legalMoves(s);
    const buys = moves.filter((m) => m.type === 'buy');
    s = applyMove(s, buys.length && rng() < 0.5 ? rng.pick(buys) : rng.pick(moves));
  }

  const restored = JSON.parse(JSON.stringify(s));
  assert.deepEqual(
    restored,
    s,
    'the state must survive JSON with every field intact — a Map, a Set or an ' +
      'undefined anywhere in it would vanish here and nowhere else',
  );

  // Serialising twice must also be stable: a field whose value depends on
  // iteration order would round-trip once and then drift.
  assert.equal(JSON.stringify(restored), JSON.stringify(s));
});

test('a restored game is playable and plays on identically', () => {
  const seed = 99001;
  let s = createGame({ players: seats(2), seed, cards: bigPool(), companies: bigCompanies() });
  const warm = makeRng(seed);
  for (let i = 0; i < 40 && !isTerminal(s); i++) {
    const moves = legalMoves(s);
    s = applyMove(s, moves[warm.int(moves.length)]);
  }
  assert.ok(!isTerminal(s), 'the fixture must still be mid-game to be worth restoring');
  assert.ok(s.log.length > 0, 'and must have a log, which is the largest saved field');

  const restored = JSON.parse(JSON.stringify(s));

  // The guard loadGame() actually relies on: it does not shape-check the save,
  // it asks the engine to make sense of it. legalMoves() is never empty on a
  // live game, so a non-empty list IS the validation passing.
  assert.ok(legalMoves(restored).length > 0);

  // Play both out with the same choices. The engine is deterministic and
  // rngState rides inside the state, so a lossless save must produce a
  // bit-identical game from here to the end — including the winner.
  const runOut = (start) => {
    let g = start;
    const rng = makeRng(7777);
    while (!isTerminal(g)) {
      const moves = legalMoves(g);
      g = applyMove(g, moves[rng.int(moves.length)]);
    }
    return g;
  };

  assert.deepEqual(
    runOut(restored),
    runOut(s),
    'a game continued from a save must reach exactly the same end as one that ' +
      'was never saved — divergence here means the save lost something',
  );
});

test('a save that is not a game is rejected rather than half-loaded', () => {
  const s = createGame({ players: seats(2), seed: 5, cards: bigPool(), companies: bigCompanies() });

  // A card id the registry has never seen — what a save written by an older
  // build with a different deck looks like. It must throw out of legalMoves
  // rather than resolve to undefined and be played on.
  const bogus = JSON.parse(JSON.stringify(s));
  bogus.board[1][0] = 'no-such-card';
  assert.throws(() => legalMoves(bogus), /Unknown card id/);

  // Truncated to the point of meaninglessness. Whatever it does, it must not
  // quietly present itself as a playable board.
  const wrecked = JSON.parse(JSON.stringify(s));
  wrecked.players = [];
  let ok = true;
  try {
    ok = legalMoves(wrecked).length > 0;
  } catch {
    ok = false;
  }
  assert.equal(ok, false, 'a state with no players must not yield legal moves');
});
