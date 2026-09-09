/**
 * SHARED CONTRACT — constants + type definitions for the whole app.
 * Every other module imports from here. Do not change shapes without
 * updating engine, bots and UI together.
 */

/**
 * THE RESOURCE REGISTRY — an ORDERED list, and the only place a resource is
 * named. Position in this array is the canonical order of everything: bank
 * rows, cost pips, rail chips, the order a purse is read in.
 *
 * ORDER IS IDENTITY, WHICH IS WHY NOTHING SORTS. A set of resources - the
 * three you took, say - is made comparable by putting it back into registry
 * order, not by sorting it alphabetically. Alphabetical order is a property of
 * the NAMES, so it changes the moment anything is renamed; registry order is a
 * property of the game and does not.
 *
 * Renaming the theme should touch this array and nothing else.
 */
export const RESOURCES = ['cinnamon', 'indigo', 'cardamom', 'saffron', 'pepper'];

/**
 * THE WILD, which is NOT a resource. It is a sixth token that pays for any of
 * the five and is never itself a cost, a bonus or a company requirement. Keeping
 * it out of RESOURCES is what makes "five slots or six?" a question the type
 * answers rather than one every loop has to remember.
 */
export const WILD = 'coin';

/** Every physical token: the five resources, then the wild. */
export const TOKENS = [...RESOURCES, WILD];

/** Rank in registry order, for putting an unordered set back into it. */
const RESOURCE_RANK = Object.fromEntries(TOKENS.map((t, i) => [t, i]));

/**
 * An unordered list of tokens, in registry order. This is the canonicaliser
 * that replaced three separate `.sort()` calls: the engine already GENERATES
 * moves in registry order, so the only lists that need it are the ones built
 * outside the engine - a tap sequence from the bank, or a bot's proposal.
 */
export function inResourceOrder(tokens) {
  return [...tokens].sort((a, b) => RESOURCE_RANK[a] - RESOURCE_RANK[b]);
}

/**
 * WHAT THE PLAYER IS TOLD A TOKEN IS — the one place a name is written down.
 *
 * Nothing else in the app prints a token's name: the board, the rail, the turn
 * report and the move log are all pips. This exists for the accessible name on
 * every control, the sr-only text beside every pip, and the sentence a screen
 * reader hears instead of a picture.
 */
export const TOKEN_LABEL = {
  cinnamon: 'Cinnamon',
  indigo: 'Indigo',
  cardamom: 'Cardamom',
  saffron: 'Saffron',
  pepper: 'Pepper',
  coin: 'Coin',
};

/** Starting bank per player count. Coins are always 5. */
export const BANK_BY_PLAYERS = { 2: 4, 3: 5, 4: 7 };

/** Companies in play = players + 1. */
export const COMPANIES_BY_PLAYERS = { 2: 3, 3: 4, 4: 5 };

export const COIN_COUNT = 5;
export const CARDS_PER_ROW = 4;
export const MAX_RESERVED = 3;
export const TOKEN_LIMIT = 10;
export const WIN_POINTS = 15;
export const TAKE2_MIN_PILE = 4;

/**
 * @typedef {'cinnamon'|'indigo'|'cardamom'|'saffron'|'pepper'} Resource
 * @typedef {Resource|'coin'} Token
 * @typedef {Record<Resource, number>} Cost      Sparse-safe: every resource key present, 0 allowed.
 * @typedef {Record<Token, number>} Purse   Every token key present.
 */

/**
 * A holding card.
 * @typedef {object} Card
 * @property {string} id      Stable unique id, e.g. "t1-07".
 * @property {1|2|3} tier
 * @property {Resource} resource        The permanent bonus this card grants.
 * @property {number} points  Points (0..5).
 * @property {Cost} cost      Token cost before bonuses.
 */

/**
 * A company tile.
 * @typedef {object} Company
 * @property {string} id       e.g. "n-03".
 * @property {string} name     Flavour name, e.g. "Catherine de Medici".
 * @property {number} points   Always 3.
 * @property {Cost} requires   Required card bonuses, e.g. {cinnamon:4, indigo:4, ...}.
 */

/**
 * @typedef {object} Player
 * @property {number} index
 * @property {string} name
 * @property {boolean} isBot
 * @property {'easy'|'normal'|'hard'|null} botLevel
 * @property {Purse} tokens        Tokens held in hand.
 * @property {Cost} bonuses        Permanent discounts from purchased cards.
 * @property {string[]} cards      Purchased card ids.
 * @property {(string|null)[]} reserved   Reserved card ids (max 3).
 *   Entries are null only in a redacted view: see redactFor. A null is a
 *   reserved card the observer is not allowed to see.
 * @property {(string|null)[]} reservedBlind
 *   The SUBSET of `reserved` that was drawn blind off a deck top. The rules
 *   split reserving in two:
 *     - reserving a FACE-UP card happens in the open, so that card is public
 *       for the rest of the game and every player may look at it;
 *     - reserving off a deck top is done "without showing it to the other
 *       players", so only its owner ever sees it.
 *   Only the ids listed here are hidden by redactFor. After redactFor, an
 *   opponent's entries are null placeholders — the length still gives the
 *   count of face-down cards they hold, which is public information.
 *   Invariant: every non-null entry also appears in `reserved`.
 * @property {string[]} companies     Claimed company ids.
 * @property {number} points       Points (cards + companies).
 */

/**
 * The full game state. Treat as IMMUTABLE: engine functions never mutate
 * their input, they return a new state.
 *
 * @typedef {object} GameState
 * @property {Player[]} players
 * @property {Purse} bank
 * @property {{1:string[],2:string[],3:string[]}} decks   Face-down draw piles, index 0 = top.
 * @property {{1:(string|null)[],2:(string|null)[],3:(string|null)[]}} board  4 slots per tier; null = empty (deck exhausted).
 * @property {string[]} companies          Company ids still available.
 * @property {number} current           Index of the player to act.
 * @property {number} round             1-based round counter.
 * @property {Phase} phase
 * @property {string[]} companyChoices    When phase === 'company': the ids the current player may pick from.
 * @property {boolean} finalRound       True once someone has hit WIN_POINTS.
 * @property {number|null} lastPlayer   Index that ends the final round.
 * @property {number[]} winners         Filled when phase === 'gameover' (ties possible).
 * @property {LogEntry[]} log
 * @property {number} seed              Seed the game was created with.
 * @property {number} rngState          Current PRNG state; advance via src/rng.js.
 * @property {boolean} redacted         True if hidden info has been stripped (see redactFor).
 */

/**
 * @typedef {'action'|'discard'|'company'|'gameover'} Phase
 *
 * - 'action'  : current player picks one of take3/take2/buy/reserve/pass.
 * - 'discard' : current player is over TOKEN_LIMIT and must return tokens.
 * - 'company'   : current player qualifies for 2+ companies and must choose one.
 * - 'gameover': terminal.
 */

/**
 * A move. The engine only ever accepts moves it also generates.
 *
 * @typedef {TakeThree|TakeTwo|Buy|Reserve|Discard|ChooseCompany|Pass} Move
 *
 * @typedef {{type:'take3', resources:Resource[]}} TakeThree
 *   1..3 DISTINCT resources, each from a non-empty pile. Fewer than 3 only
 *   allowed when fewer than 3 colours have any tokens left.
 *
 * @typedef {{type:'take2', resource:Resource}} TakeTwo
 *   Pile must hold >= TAKE2_MIN_PILE before the take.
 *
 * @typedef {{type:'buy', cardId:string, fromReserve:boolean}} Buy
 *
 * @typedef {{type:'reserve', cardId:string|null, tier:1|2|3|null}} Reserve
 *   Either cardId (a face-up card) or tier (blind draw from that deck top),
 *   never both. A coin is taken automatically when the bank has any.
 *
 * @typedef {{type:'discard', tokens:Purse}} Discard
 *   Tokens to return to the bank. Must bring the player to exactly TOKEN_LIMIT.
 *
 * @typedef {{type:'chooseCompany', companyId:string}} ChooseCompany
 *
 * @typedef {{type:'pass'}} Pass
 *   Only legal when no other move exists.
 */

/**
 * @typedef {object} LogEntry
 * @property {number} round
 * @property {number} player       Player index.
 * @property {string} text         Human-readable, already formatted.
 * @property {Move|null} move
 */

/** An all-zero purse. */
export function emptyPurse() {
  return { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 0, pepper: 0, coin: 0 };
}

/**
 * WHAT THE THREE DECKS ARE CALLED. The cards are one thing at three scales of
 * enterprise, ascending: a single venture, then infrastructure, then a standing
 * trade lane. `tier` stays a number everywhere in the engine and the data —
 * it is a level index and the rules talk about it as one — and this is the only
 * place it is given a name.
 */
export const DECK_LABEL = { 1: 'Caravans', 2: 'Warehouses', 3: 'Routes' };
/** The singular, for "reserve the top card of ..." and a card's own name. */
export const DECK_LABEL_ONE = { 1: 'Caravan', 2: 'Warehouse', 3: 'Route' };

/** An all-zero goods cost (no coin key). */
export function emptyCost() {
  return { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 0, pepper: 0 };
}

/** Sum of all values in a purse/cost. */
export function total(purse) {
  let n = 0;
  for (const k in purse) n += purse[k];
  return n;
}

/**
 * NOTE (added after the engine landed): GameState also carries
 * @property {string[]} cardPool — every card id dealt into this game.
 * `determinize` needs it: a redacted state otherwise has no way to work out
 * which cards are unaccounted for. It is public information (deck composition
 * is known to all players, only the ORDER is secret), and it survives
 * cloneState/redactFor. Anything hand-building a state must include it.
 */
