/**
 * THE RULES ENGINE
 *
 * The single source of truth for game rules. Bots and UI are written against
 * the exported API below and must never reach past it.
 *
 * Everything here is PURE: `applyMove` never mutates its input, it deep-clones
 * and returns a new state. All randomness goes through src/rng.js so that a
 * seed fully determines a game.
 *
 * Types (Card, Company, Player, GameState, Move, Phase, Purse, Cost) live in
 * ./contract.js and are referenced by JSDoc throughout.
 *
 * @typedef {import('./contract.js').Resource} Resource
 * @typedef {import('./contract.js').Token} Token
 * @typedef {import('./contract.js').Cost} Cost
 * @typedef {import('./contract.js').Purse} Purse
 * @typedef {import('./contract.js').Card} Card
 * @typedef {import('./contract.js').Company} Company
 * @typedef {import('./contract.js').Player} Player
 * @typedef {import('./contract.js').GameState} GameState
 * @typedef {import('./contract.js').Move} Move
 * @typedef {import('./contract.js').LogEntry} LogEntry
 */

import { RESOURCES, TOKENS, TOKEN_LABEL, DECK_LABEL, DECK_LABEL_ONE, BANK_BY_PLAYERS, COMPANIES_BY_PLAYERS, COIN_COUNT, CARDS_PER_ROW, MAX_RESERVED, TOKEN_LIMIT, WIN_POINTS, TAKE2_MIN_PILE, emptyPurse, emptyCost, total, inResourceOrder } from './contract.js';
import { shuffle } from './rng.js';
import { CARDS } from './data/cards.js';
import { COMPANIES } from './data/companies.js';

const TIERS = [1, 2, 3];

/* ------------------------------------------------------------------ */
/* Card / company registry                                              */
/* ------------------------------------------------------------------ */

/** @type {Map<string, Card>} */
const CARD_INDEX = new Map();
/** @type {Map<string, Company>} */
const COMPANY_INDEX = new Map();

/**
 * Make cards/companies resolvable by id. Called automatically for the shipped
 * data set and for any custom pool handed to createGame (tests use this).
 * @param {Card[]} [cards]
 * @param {Company[]} [companies]
 */
export function registerCards(cards = [], companies = []) {
  for (const c of cards) CARD_INDEX.set(c.id, c);
  for (const n of companies) COMPANY_INDEX.set(n.id, n);
}

registerCards(CARDS, COMPANIES);

/** @param {string} id @returns {Card} */
export function getCard(id) {
  const c = CARD_INDEX.get(id);
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}

/** @param {string} id @returns {Company} */
export function getCompany(id) {
  const n = COMPANY_INDEX.get(id);
  if (!n) throw new Error(`Unknown company id: ${id}`);
  return n;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

/** @param {Purse|Cost} p */
function copyPurse(p) {
  return { ...p };
}

/**
 * Human text for a purse: "3 <resource>, 1 <wild>". Empty purses read "free".
 *
 * RAW KEYS, deliberately. The engine does not know what a token is called on
 * screen; src/ui/render.js turns these into pips, and into the player-facing
 * names for a screen reader. Keeping presentation out of here is what lets
 * the tokens be renamed without touching a line of engine logic.
 * @param {Purse} purse
 */
function describePurse(purse) {
  const parts = [];
  for (const t of TOKENS) {
    const n = purse[t] || 0;
    if (n > 0) parts.push(`${n} ${t}`);
  }
  return parts.length ? parts.join(', ') : 'free';
}

/** @param {Card} card */
function cardLabel(card) {
  return `${TOKEN_LABEL[card.resource]} (${card.points}pts)`;
}

/**
 * @param {GameState} s
 * @param {number} playerIndex
 * @param {string} text
 * @param {Move|null} move
 */
function log(s, playerIndex, text, move) {
  s.log.push({
    round: s.round,
    player: playerIndex,
    text,
    move: move ? { ...move } : null,
  });
}

/* ------------------------------------------------------------------ */
/* State construction / cloning                                        */
/* ------------------------------------------------------------------ */

/**
 * Deep clone. Hand-rolled rather than structuredClone/JSON because bots clone
 * millions of states; log entries are treated as immutable and shared.
 * @param {GameState} state
 * @returns {GameState}
 */
export function cloneState(state) {
  const players = new Array(state.players.length);
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    players[i] = {
      index: p.index,
      name: p.name,
      isBot: p.isBot,
      botLevel: p.botLevel,
      tokens: { ...p.tokens },
      bonuses: { ...p.bonuses },
      cards: p.cards.slice(),
      reserved: p.reserved.slice(),
      // Tolerated as missing so hand-built fixtures stay valid; a player with
      // no blind draws simply has an empty list.
      reservedBlind: (p.reservedBlind || []).slice(),
      companies: p.companies.slice(),
      points: p.points,
    };
  }
  return {
    players,
    bank: { ...state.bank },
    decks: {
      1: state.decks[1].slice(),
      2: state.decks[2].slice(),
      3: state.decks[3].slice(),
    },
    board: {
      1: state.board[1].slice(),
      2: state.board[2].slice(),
      3: state.board[3].slice(),
    },
    companies: state.companies.slice(),
    current: state.current,
    round: state.round,
    phase: state.phase,
    companyChoices: state.companyChoices.slice(),
    finalRound: state.finalRound,
    lastPlayer: state.lastPlayer,
    winners: state.winners.slice(),
    log: state.log.slice(),
    seed: state.seed,
    rngState: state.rngState,
    redacted: state.redacted,
    cardPool: (state.cardPool || []).slice(),
  };
}

/**
 * Start a new game.
 *
 * `cards` / `companies` are optional overrides for the global data set; the app
 * never passes them, tests use them to run against small fixtures.
 *
 * @param {object} opts
 * @param {{name:string,isBot?:boolean,botLevel?:('easy'|'normal'|'hard'|null)}[]} opts.players 2..4
 * @param {number} opts.seed
 * @param {Card[]} [opts.cards]
 * @param {Company[]} [opts.companies]
 * @returns {GameState}
 */
export function createGame({ players, seed, cards = CARDS, companies = COMPANIES }) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 4) {
    throw new Error('createGame needs 2..4 players');
  }
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error('createGame needs a non-empty card pool');
  }
  registerCards(cards, companies);

  const n = players.length;
  let rngState = seed | 0;

  /** @type {{1:string[],2:string[],3:string[]}} */
  const decks = { 1: [], 2: [], 3: [] };
  /** @type {{1:(string|null)[],2:(string|null)[],3:(string|null)[]}} */
  const board = { 1: [], 2: [], 3: [] };

  for (const t of TIERS) {
    const ids = cards.filter((c) => c.tier === t).map((c) => c.id);
    let shuffled;
    [shuffled, rngState] = shuffle(ids, rngState);
    // The top CARDS_PER_ROW cards of each deck go face up.
    board[t] = shuffled.slice(0, CARDS_PER_ROW);
    while (board[t].length < CARDS_PER_ROW) board[t].push(null);
    decks[t] = shuffled.slice(CARDS_PER_ROW);
  }

  let companyIds;
  [companyIds, rngState] = shuffle(companies.map((x) => x.id), rngState);
  companyIds = companyIds.slice(0, Math.min(COMPANIES_BY_PLAYERS[n], companyIds.length));

  const bank = emptyPurse();
  for (const g of RESOURCES) bank[g] = BANK_BY_PLAYERS[n];
  bank.coin = COIN_COUNT;

  /** @type {GameState} */
  const state = {
    players: players.map((p, i) => ({
      index: i,
      name: p.name,
      isBot: !!p.isBot,
      botLevel: p.botLevel ?? null,
      tokens: emptyPurse(),
      bonuses: emptyCost(),
      cards: [],
      reserved: [],
      reservedBlind: [],
      companies: [],
      points: 0,
    })),
    bank,
    decks,
    board,
    companies: companyIds,
    current: 0,
    round: 1,
    phase: 'action',
    companyChoices: [],
    finalRound: false,
    lastPlayer: null,
    winners: [],
    log: [],
    seed,
    rngState,
    redacted: false,
    // Every card id that exists in this game. Public knowledge (it is the deck
    // composition, printed on the box) and required by determinize() to know
    // which cards are still unaccounted for. Not part of the original
    // contract typedef; additive only.
    cardPool: cards.map((c) => c.id),
  };
  return state;
}

/* ------------------------------------------------------------------ */
/* Affordability                                                       */
/* ------------------------------------------------------------------ */

/**
 * What `playerIndex` would actually pay for `card`: resources first, coins only for
 * the shortfall. `pay` is what leaves their hand (it is capped by what they
 * hold, so it is meaningful even when unaffordable); `shortfall` is how much
 * coin the purchase needs.
 *
 * @param {GameState} state
 * @param {number} playerIndex
 * @param {Card|string} card  Card or card id.
 * @returns {{affordable:boolean, pay:Purse, shortfall:number}}
 */
export function affordability(state, playerIndex, card) {
  const c = typeof card === 'string' ? getCard(card) : card;
  const p = state.players[playerIndex];
  const pay = emptyPurse();
  let shortfall = 0;
  for (const g of RESOURCES) {
    const need = Math.max(0, (c.cost[g] || 0) - (p.bonuses[g] || 0));
    const use = Math.min(need, p.tokens[g] || 0);
    pay[g] = use;
    shortfall += need - use;
  }
  pay.coin = Math.min(shortfall, p.tokens.coin || 0);
  return { affordable: (p.tokens.coin || 0) >= shortfall, pay, shortfall };
}

/* ------------------------------------------------------------------ */
/* Move generation                                                     */
/* ------------------------------------------------------------------ */

/** Colours with at least one token left in the bank. @param {GameState} s */
function availableResources(s) {
  return RESOURCES.filter((g) => s.bank[g] > 0);
}

/** All k-subsets of `arr`, order-preserving. */
function combinations(arr, k) {
  const out = [];
  const cur = [];
  (function rec(start) {
    if (cur.length === k) {
      out.push(cur.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      rec(i + 1);
      cur.pop();
    }
  })(0);
  return out;
}

/**
 * Every distinct way to hand back `count` tokens from `tokens`.
 * @param {Purse} tokens @param {number} count @returns {Purse[]}
 */
function discardOptions(tokens, count) {
  /** @type {Purse[]} */
  const out = [];
  const cur = emptyPurse();
  (function rec(i, left) {
    if (left === 0) {
      out.push({ ...cur });
      return;
    }
    if (i >= TOKENS.length) return;
    const t = TOKENS[i];
    const max = Math.min(tokens[t] || 0, left);
    for (let k = 0; k <= max; k++) {
      cur[t] = k;
      rec(i + 1, left - k);
    }
    cur[t] = 0;
  })(0, count);
  return out;
}

/** Companies currently visiting-eligible for `p`. @param {GameState} s @param {Player} p */
function eligibleCompanies(s, p) {
  return s.companies.filter((id) => {
    const company = getCompany(id);
    return RESOURCES.every((g) => (p.bonuses[g] || 0) >= (company.requires[g] || 0));
  });
}

/**
 * ALL legal moves for state.current in the current phase.
 * Never empty: falls back to [{type:'pass'}].
 * @param {GameState} state
 * @returns {Move[]}
 */
export function legalMoves(state) {
  const p = state.players[state.current];

  if (state.phase === 'discard') {
    const excess = total(p.tokens) - TOKEN_LIMIT;
    if (excess <= 0) return [{ type: 'pass' }];
    return discardOptions(p.tokens, excess).map((tokens) => ({ type: 'discard', tokens }));
  }

  if (state.phase === 'company') {
    const choices = state.companyChoices.map((id) => ({ type: 'chooseCompany', companyId: id }));
    return choices.length ? choices : [{ type: 'pass' }];
  }

  if (state.phase === 'gameover') {
    // Terminal; nothing to do. Contract says never return [].
    return [{ type: 'pass' }];
  }

  /** @type {Move[]} */
  const moves = [];

  // take3 — three distinct colours. Shorter takes only when the bank cannot
  // offer three colours at all.
  const avail = availableResources(state);
  const takeSize = Math.min(3, avail.length);
  if (takeSize > 0) {
    for (const combo of combinations(avail, takeSize)) {
      moves.push({ type: 'take3', resources: combo });
    }
  }

  // take2 — pile must hold >= TAKE2_MIN_PILE before the take.
  for (const g of RESOURCES) {
    if (state.bank[g] >= TAKE2_MIN_PILE) moves.push({ type: 'take2', resource: g });
  }

  // buy — face up or from own reserve.
  for (const t of TIERS) {
    for (const id of state.board[t]) {
      if (id && affordability(state, state.current, getCard(id)).affordable) {
        moves.push({ type: 'buy', cardId: id, fromReserve: false });
      }
    }
  }
  for (const id of p.reserved) {
    if (id && affordability(state, state.current, getCard(id)).affordable) {
      moves.push({ type: 'buy', cardId: id, fromReserve: true });
    }
  }

  // reserve — face up, or blind from a deck top.
  if (p.reserved.length < MAX_RESERVED) {
    for (const t of TIERS) {
      for (const id of state.board[t]) {
        if (id) moves.push({ type: 'reserve', cardId: id, tier: null });
      }
      if (state.decks[t].length > 0) {
        moves.push({ type: 'reserve', cardId: null, tier: t });
      }
    }
  }

  return moves.length ? moves : [{ type: 'pass' }];
}

/* ------------------------------------------------------------------ */
/* Legality                                                            */
/* ------------------------------------------------------------------ */

/**
 * Canonical string for a move so generated and submitted moves compare equal
 * regardless of key order, resource order, or omitted optional fields.
 * @param {Move} move
 * @param {GameState} state
 * @returns {string|null} null when the move is malformed.
 */
function moveKey(move, state) {
  if (!move || typeof move !== 'object' || typeof move.type !== 'string') return null;
  const p = state.players[state.current];
  switch (move.type) {
    case 'take3': {
      if (!Array.isArray(move.resources) || move.resources.length === 0) return null;
      if (move.resources.some((g) => !RESOURCES.includes(g))) return null;
      if (new Set(move.resources).size !== move.resources.length) return null;
      return `take3:${inResourceOrder(move.resources).join(',')}`;
    }
    case 'take2':
      if (!RESOURCES.includes(move.resource)) return null;
      return `take2:${move.resource}`;
    case 'buy': {
      if (typeof move.cardId !== 'string') return null;
      const fromReserve =
        move.fromReserve === undefined ? p.reserved.includes(move.cardId) : !!move.fromReserve;
      return `buy:${move.cardId}:${fromReserve}`;
    }
    case 'reserve': {
      const cardId = move.cardId ?? null;
      const tier = move.tier ?? null;
      if (cardId === null && tier === null) return null;
      if (cardId !== null && tier !== null) return null;
      if (cardId !== null && typeof cardId !== 'string') return null;
      if (tier !== null && !TIERS.includes(tier)) return null;
      return `reserve:${cardId ?? ''}:${tier ?? ''}`;
    }
    case 'discard': {
      const t = move.tokens;
      if (!t || typeof t !== 'object') return null;
      for (const k of Object.keys(t)) if (!TOKENS.includes(k)) return null;
      return `discard:${TOKENS.map((k) => t[k] || 0).join(',')}`;
    }
    case 'chooseCompany':
      if (typeof move.companyId !== 'string') return null;
      return `company:${move.companyId}`;
    case 'pass':
      return 'pass';
    default:
      return null;
  }
}

/**
 * @param {GameState} state
 * @param {Move} move
 * @returns {boolean}
 */
export function isLegal(state, move) {
  const key = moveKey(move, state);
  if (key === null) return false;
  for (const m of legalMoves(state)) {
    if (moveKey(m, state) === key) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Applying moves                                                      */
/* ------------------------------------------------------------------ */

/** Draw the top card of a deck into a board slot (null when the deck is dry). */
function refill(s, tier, slot) {
  s.board[tier][slot] = s.decks[tier].length ? s.decks[tier].shift() : null;
}

/** Give a company to a player. */
function awardCompany(s, p, companyId) {
  const company = getCompany(companyId);
  p.companies.push(companyId);
  p.points += company.points;
  s.companies = s.companies.filter((id) => id !== companyId);
  log(s, p.index, `${p.name} was visited by ${company.name} (${company.points}pts)`, null);
}

/** Winners: most points, tie-broken by fewest purchased cards; ties shared. */
function computeWinners(s) {
  let best = null;
  for (const p of s.players) {
    if (
      best === null ||
      p.points > best.points ||
      (p.points === best.points && p.cards.length < best.cards)
    ) {
      best = { points: p.points, cards: p.cards.length };
    }
  }
  return s.players
    .filter((p) => p.points === best.points && p.cards.length === best.cards)
    .map((p) => p.index);
}

/**
 * Hand the turn on. Also owns the end-of-game trigger.
 * @param {GameState} s
 * @param {number} actingIndex the player who just finished acting
 */
function advance(s, actingIndex) {
  const n = s.players.length;
  s.phase = 'action';
  s.companyChoices = [];

  if (!s.finalRound && s.players.some((p) => p.points >= WIN_POINTS)) {
    s.finalRound = true;
    // Play continues to the player immediately before the wrap back to 0, so
    // every player ends with the same number of turns.
    s.lastPlayer = n - 1;
  }

  if (s.finalRound && actingIndex === s.lastPlayer) {
    s.phase = 'gameover';
    s.winners = computeWinners(s);
    const names = s.winners.map((i) => s.players[i].name).join(' & ');
    const pts = s.players[s.winners[0]].points;
    log(
      s,
      actingIndex,
      s.winners.length > 1
        ? `Game over — ${names} share the win on ${pts} points`
        : `Game over — ${names} wins with ${pts} points`,
      null,
    );
    return;
  }

  s.current = (actingIndex + 1) % n;
  if (s.current === 0) s.round += 1;
}

/**
 * Company step then hand-off. Reached after the acting player is at or under the
 * token limit.
 */
function companyStepThenAdvance(s, actingIndex) {
  const p = s.players[actingIndex];
  const eligible = eligibleCompanies(s, p);
  if (eligible.length === 1) {
    awardCompany(s, p, eligible[0]);
  } else if (eligible.length > 1) {
    s.phase = 'company';
    s.companyChoices = eligible;
    return;
  }
  advance(s, actingIndex);
}

/**
 * Safety valve: if every player passes in succession nothing can ever change
 * again (empty bank, empty rows, full reserves), so end the game rather than
 * loop forever. Not a printed rule; it cannot fire while any real move exists.
 * @param {GameState} s
 */
function maybeStalemate(s) {
  if (s.phase !== 'action') return;
  const n = s.players.length;
  const tail = s.log.slice(-n);
  if (tail.length < n || !tail.every((e) => e.move && e.move.type === 'pass')) return;
  s.phase = 'gameover';
  s.winners = computeWinners(s);
  log(s, s.current, 'Game over — every player passed; no moves remain', null);
}

/** End-of-turn sequence: discard check, then companies, then hand off. */
function endTurn(s, actingIndex) {
  const p = s.players[actingIndex];
  if (total(p.tokens) > TOKEN_LIMIT) {
    s.phase = 'discard';
    return;
  }
  companyStepThenAdvance(s, actingIndex);
}

/**
 * Apply a move. PURE — `state` and everything reachable from it is untouched.
 * Throws on an illegal move.
 * @param {GameState} state
 * @param {Move} move
 * @returns {GameState}
 */
export function applyMove(state, move) {
  if (!isLegal(state, move)) {
    throw new Error(`Illegal move: ${JSON.stringify(move)} (phase ${state.phase})`);
  }
  const s = cloneState(state);
  const idx = s.current;
  const p = s.players[idx];

  switch (move.type) {
    case 'take3': {
      for (const g of move.resources) {
        s.bank[g] -= 1;
        p.tokens[g] += 1;
      }
      log(s, idx, `${p.name} took ${move.resources.join(', ')}`, move);
      endTurn(s, idx);
      break;
    }

    case 'take2': {
      s.bank[move.resource] -= 2;
      p.tokens[move.resource] += 2;
      log(s, idx, `${p.name} took 2 ${move.resource}`, move);
      endTurn(s, idx);
      break;
    }

    case 'buy': {
      const card = getCard(move.cardId);
      const fromReserve =
        move.fromReserve === undefined ? p.reserved.includes(move.cardId) : !!move.fromReserve;
      const { pay } = affordability(s, idx, card);
      for (const t of TOKENS) {
        p.tokens[t] -= pay[t];
        s.bank[t] += pay[t];
      }
      if (fromReserve) {
        p.reserved = p.reserved.filter((id) => id !== move.cardId);
        // A blind-reserved card becomes public the moment it is played, so it
        // must not linger in the secret list.
        p.reservedBlind = p.reservedBlind.filter((id) => id !== move.cardId);
      } else {
        const tier = card.tier;
        const slot = s.board[tier].indexOf(move.cardId);
        refill(s, tier, slot);
      }
      p.cards.push(card.id);
      p.bonuses[card.resource] += 1;
      p.points += card.points;
      log(s, idx, `${p.name} bought ${cardLabel(card)} for ${describePurse(pay)}`, move);
      endTurn(s, idx);
      break;
    }

    case 'reserve': {
      let cardId = move.cardId ?? null;
      let tier;
      let blind = false;
      if (cardId !== null) {
        tier = getCard(cardId).tier;
        const slot = s.board[tier].indexOf(cardId);
        refill(s, tier, slot);
      } else {
        tier = move.tier;
        cardId = s.decks[tier].shift();
        blind = true;
      }
      p.reserved.push(cardId);
      // Face-up reserves happen in the open and stay public; deck-top draws
      // are taken without showing them, so only their owner may look.
      if (blind) p.reservedBlind.push(cardId);
      let gotCoin = false;
      if (s.bank.coin > 0) {
        s.bank.coin -= 1;
        p.tokens.coin += 1;
        gotCoin = true;
      }
      // Through DECK_LABEL, because this string IS SHOWN TO THE PLAYER: the
      // Move log renders entry.text more or less verbatim. It said "tier 3"
      // while the board said "Routes" — the same deck named two ways to the
      // same person, which is the exact failure the deck labels exist to stop.
      const what = blind
        ? `the top ${DECK_LABEL_ONE[tier]}, unseen`
        : `${cardLabel(getCard(cardId))} from the ${DECK_LABEL[tier]}`;
      log(
        s,
        idx,
        `${p.name} reserved ${what}${gotCoin ? ' and took a coin' : ' (no coin left)'}`,
        move,
      );
      endTurn(s, idx);
      break;
    }

    case 'discard': {
      const given = emptyPurse();
      for (const t of TOKENS) {
        const n = move.tokens[t] || 0;
        given[t] = n;
        p.tokens[t] -= n;
        s.bank[t] += n;
      }
      log(s, idx, `${p.name} discarded ${describePurse(given)}`, move);
      companyStepThenAdvance(s, idx);
      break;
    }

    case 'chooseCompany': {
      awardCompany(s, p, move.companyId);
      advance(s, idx);
      break;
    }

    case 'pass': {
      if (s.phase === 'gameover') break; // no-op on a terminal state
      log(s, idx, `${p.name} passed`, move);
      endTurn(s, idx);
      maybeStalemate(s);
      break;
    }

    default:
      throw new Error(`Unhandled move type: ${move.type}`);
  }

  return s;
}

/* ------------------------------------------------------------------ */
/* Terminal / scoring                                                  */
/* ------------------------------------------------------------------ */

/** @param {GameState} state @returns {boolean} */
export function isTerminal(state) {
  return state.phase === 'gameover';
}

/**
 * Standings, best first. Ranks are competition style (1,1,3) — tied players
 * share a rank. Ordering: points desc, then fewest purchased cards.
 * @param {GameState} state
 * @returns {{index:number, points:number, cardCount:number, rank:number}[]}
 */
export function finalScores(state) {
  const rows = state.players
    .map((p) => ({ index: p.index, points: p.points, cardCount: p.cards.length, rank: 0 }))
    .sort((a, b) => b.points - a.points || a.cardCount - b.cardCount || a.index - b.index);
  let rank = 0;
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    if (i === 0 || prev.points !== row.points || prev.cardCount !== row.cardCount) rank = i + 1;
    row.rank = rank;
  });
  return rows;
}

/* ------------------------------------------------------------------ */
/* Hidden information                                                  */
/* ------------------------------------------------------------------ */

/**
 * The game as `playerIndex` is allowed to see it.
 *
 * Hidden: deck contents (counts kept) and the opponents' BLIND-reserved cards
 * (counts kept). Reserving a face-up card is done in full view of the table,
 * so those cards stay visible in the opponent's reserve for the rest of the
 * game; only a card drawn off a deck top — taken "without showing it to the
 * other players" — is secret.
 *
 * The observer's own reserve is never touched.
 *
 * @param {GameState} state
 * @param {number} playerIndex
 * @returns {GameState}
 */
export function redactFor(state, playerIndex) {
  const s = cloneState(state);
  for (const t of TIERS) {
    s.decks[t] = new Array(s.decks[t].length).fill(null);
  }
  for (const p of s.players) {
    if (p.index === playerIndex) continue;
    const blind = new Set(p.reservedBlind.filter((id) => id !== null));
    p.reserved = p.reserved.map((id) => (id !== null && blind.has(id) ? null : id));
    // The ids themselves are secret; how many face-down cards are held is not.
    p.reservedBlind = new Array(p.reservedBlind.length).fill(null);
  }
  // The seed and rngState are as good as the deck itself: re-running
  // createGame with the same seed reproduces the exact shuffle. Leaving them in
  // a redacted state would let a bot reconstruct every hidden card without ever
  // touching `decks`. Strip them. `determinize` takes its randomness as an
  // argument, so nothing downstream needs them.
  s.seed = null;
  s.rngState = null;
  s.redacted = true;
  return s;
}

/**
 * Sample one concrete world consistent with a redacted state: every card the
 * observer cannot see is shuffled back into the decks and the opponents'
 * hidden reserve slots. The result is a normal, playable state.
 *
 * Deck slots must be filled with cards of the matching tier; hidden reserve
 * slots can hold any tier, so they take whatever is left over.
 *
 * Only the still-hidden (blind) reserve slots — the nulls — are filled.
 * A face-up reserve is public knowledge and is never re-randomised.
 *
 * @param {GameState} state  redacted (or already concrete) state
 * @param {number} rngState  PRNG state to draw from
 * @returns {GameState}
 */
export function determinize(state, rngState) {
  const s = cloneState(state);
  let rs = rngState | 0;

  // Everything the observer can already place.
  const known = new Set();
  for (const t of TIERS) {
    for (const id of s.board[t]) if (id) known.add(id);
    for (const id of s.decks[t]) if (id) known.add(id);
  }
  for (const p of s.players) {
    for (const id of p.cards) known.add(id);
    for (const id of p.reserved) if (id) known.add(id);
  }

  // Unknown cards, grouped by tier.
  /** @type {Record<number,string[]>} */
  const unknownByTier = { 1: [], 2: [], 3: [] };
  for (const id of s.cardPool) {
    if (known.has(id)) continue;
    unknownByTier[getCard(id).tier].push(id);
  }
  for (const t of TIERS) {
    [unknownByTier[t], rs] = shuffle(unknownByTier[t], rs);
  }

  // Fill face-down decks first; they constrain tiers.
  const leftovers = [];
  for (const t of TIERS) {
    const need = s.decks[t].filter((id) => id === null).length;
    const pool = unknownByTier[t];
    if (pool.length < need) {
      throw new Error(`determinize: not enough tier ${t} cards to fill the deck`);
    }
    const chosen = pool.slice(0, need);
    leftovers.push(...pool.slice(need));
    let k = 0;
    s.decks[t] = s.decks[t].map((id) => (id === null ? chosen[k++] : id));
  }

  // Whatever is left goes to the opponents' hidden reserve slots. Public
  // (face-up) reserves are already concrete and are left exactly as they are.
  let pool;
  [pool, rs] = shuffle(leftovers, rs);
  let k = 0;
  for (const p of s.players) {
    const filled = [];
    p.reserved = p.reserved.map((id) => {
      if (id !== null) return id;
      if (k >= pool.length) throw new Error('determinize: ran out of cards for reserved slots');
      const drawn = pool[k++];
      filled.push(drawn);
      return drawn;
    });
    // Slots that were null were blind by definition, so the sampled ids join
    // the blind list; any blind ids the observer already knew stay put.
    p.reservedBlind = p.reservedBlind.filter((id) => id !== null).concat(filled);
  }

  s.redacted = false;
  s.rngState = rs;
  return s;
}
