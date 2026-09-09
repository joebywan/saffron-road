/**
 * THE BOTS — easy / normal / hard.
 *
 * Public API (the UI is written against exactly this):
 *
 *   chooseMove(state, { level, seed }) -> Move
 *   describeMove(state, move)          -> string
 *
 * `state` is a REDACTED state (engine.redactFor): face-down decks are arrays of
 * null and other players' reserved cards are null placeholders. The bots NEVER
 * reach into src/data for deck order and never inspect an opponent's hidden
 * card. When a bot wants a concrete world to search, it asks the engine for one
 * via `determinize`, which samples uniformly from the cards it legitimately
 * cannot see, and it samples several worlds and averages.
 *
 * Everything is deterministic: all randomness comes from src/rng.js seeded with
 * the caller's `seed` mixed with a hash of the position. Math.random is never
 * used.
 *
 * @typedef {import('./contract.js').Resource} Resource
 * @typedef {import('./contract.js').Cost} Cost
 * @typedef {import('./contract.js').Purse} Purse
 * @typedef {import('./contract.js').Card} Card
 * @typedef {import('./contract.js').Player} Player
 * @typedef {import('./contract.js').GameState} GameState
 * @typedef {import('./contract.js').Move} Move
 */

import { RESOURCES, TOKEN_LABEL, TOKEN_LIMIT, WIN_POINTS, emptyPurse, emptyCost, total, inResourceOrder } from './contract.js';
import {
  legalMoves,
  isLegal,
  applyMove,
  getCard,
  getCompany,
  isTerminal,
  determinize,
} from './engine.js';
import { makeRng } from './rng.js';

const TIERS = [1, 2, 3];

/* ------------------------------------------------------------------ */
/* TUNABLE EVALUATION WEIGHTS                                          */
/* ------------------------------------------------------------------ */

/**
 * All numbers a human might want to tune live here. The scale is "one
 * point == W.POINT == 100", so every other term can be read as a fraction of a
 * point.
 *
 * HOW TO TUNE: tools/selfplay.js is the scoreboard. The weights below were
 * arrived at by A/B-ing candidate weight sets against the incumbent over a few
 * hundred seat-rotated games each. What actually moved the needle, in order:
 *
 *   RESERVE_CLUTTER / RESERVE_ACCESS — by far the biggest. With reserves priced
 *     too cheaply the bot spends its first three turns reserving cards for the
 *     gold and never builds a tableau. Fixing this alone took 'normal' from
 *     62% to 93% against 'easy'.
 *   OPP — raising it to 1.0 (a true zero-sum differential: my position minus
 *     the best opponent's) was worth about 25 percentage points head to head.
 *   PROSPECT — sensitive in both directions. 1.0 is catastrophic (the bot waits
 *     forever for a big card); 0.4 is measurably worse than 0.62.
 *   TOKEN — lower is better up to a point; tokens are a means, not an end.
 *   COMPANY* — measured as insensitive over +/- 2x. Leave alone unless the company
 *     tiles in src/data change shape again.
 */
export const W = {
  /* --- points --------------------------------------------------- */
  /** Value of one point. The dominant term, by design. */
  POINT: 100,
  /** Point weight is scaled by (POINT_EARLY .. POINT_EARLY+POINT_RAMP) as the
   *  leader's score climbs from 0 to WIN_POINTS: points matter late, engine
   *  building matters early. */
  POINT_EARLY: 0.75,
  POINT_RAMP: 0.55,

  /* --- permanent bonuses (purchased cards) ------------------------- */
  /** Flat value of one "unit" of permanent bonus. */
  BONUS_BASE: 26,
  /** Extra value scaled by how much the visible board demands that colour
   *  (demand is normalised to mean 1, so this adds BONUS_DEMAND on average). */
  BONUS_DEMAND: 20,
  /** Diminishing returns on stacking the same colour: the k-th bonus of a
   *  colour is worth 1/(1 + BONUS_DIMIN*(k-1)) units. */
  BONUS_DIMIN: 0.42,
  /** Bonus/economy terms are scaled by (BONUS_LATE_FLOOR .. 1+BONUS_EARLY_LIFT)
   *  as the game progresses — a 5th bonus on turn 30 is nearly worthless. */
  BONUS_EARLY_LIFT: 0.3,
  BONUS_LATE_FLOOR: 0.45,

  /* --- companies ------------------------------------------------------ */
  /** Value of being 100% of the way to the best still-available company.
   *  A company is worth 3 points = 300, so being "almost there" is worth a lot. */
  COMPANY: 210,
  /** Progress is raised to this power, so 90% done counts far more than 45%. */
  COMPANY_EXP: 2.6,
  /** Credit for the second-best company you are chasing (companies are not
   *  exclusive, but you can only realistically land one or two). */
  COMPANY_SECOND: 0.4,

  /* --- tokens ------------------------------------------------------ */
  /** Value of one "unit" of token holding. */
  TOKEN: 8,
  /** Gold is a wild, worth more than a coloured token. */
  GOLD_MULT: 1.45,
  /** After this many of one colour, extra copies are mostly dead weight. */
  TOKEN_SOFT_CAP: 3,
  TOKEN_OVER_CAP: 0.35,
  /** Quadratic penalty for creeping toward the 10-token limit. */
  OVERLOAD_FROM: 8,
  OVERLOAD: 16,

  /* --- prospects: how close am I to the cards I want ---------------- */
  /** Overall weight of the "cards I can nearly afford" term. This is what
   *  makes taking the RIGHT resources better than taking any resources. */
  PROSPECT: 0.62,
  /** A card that needs `t` more turns is discounted by 1/(1 + DEFICIT*t). */
  DEFICIT: 0.9,
  /** How many of the best prospects to count, and their geometric decay. */
  PROSPECT_N: 4,
  PROSPECT_DECAY: 0.55,
  /** Reserved cards are safe from opponents, so they score slightly higher.
   *  Keep this near 1: any higher and the bot reserves everything it likes
   *  instead of buying, which measurably cost it ~30 percentage points. */
  RESERVE_ACCESS: 1.05,
  /** Flat credit for holding any reserved card at all (optionality + a wild). */
  RESERVE_BASE: 10,
  /** Flat penalty PER reserved card. Reserving burns a whole turn for one
   *  gold, so this has to be big enough to stop the bot hoarding reserves. */
  RESERVE_CLUTTER: 40,

  /* --- opponents ---------------------------------------------------- */
  /** How much the strongest opponent's position is subtracted from ours.
   *  This is also where "denial" comes from for free: buying a card an
   *  opponent was close to buying lowers their prospect term. */
  OPP: 1.0,

  /* --- the 'easy' bot ------------------------------------------------ */
  /** How often the beginner bot deliberately plays a worse (but still sane)
   *  move. 0 = plays its naive best every time. Tuned so that 'normal' wins
   *  clearly without 'easy' feeling broken. */
  EASY_BLUNDER: 0.35,

  /* --- terminal ----------------------------------------------------- */
  /** Magnitude of a decided game. Must dwarf every positional term. */
  WIN: 100000,
  /** A shared win is worth this fraction of a clean win. */
  DRAW: 0.35,
};

/* ------------------------------------------------------------------ */
/* SEARCH BUDGETS ('hard')                                             */
/* ------------------------------------------------------------------ */

/**
 * Wall-clock ceiling for one 'hard' decision, in milliseconds. ENFORCED: the
 * search checks it between simulated positions and returns the best move found
 * so far. Sized so a 4-player decision stays far under the UI's 2s allowance.
 */
export const HARD_TIME_BUDGET_MS = 900;

/** Ceiling on simulated positions per 'hard' decision. Also enforced. */
export const HARD_NODE_BUDGET = 45000;

/** Shape of the 'hard' search. Tunable; the budgets above are the hard stops. */
export const SEARCH = {
  /** Determinized worlds sampled and averaged over. More = less variance. */
  WORLDS: 3,
  /** Root moves kept for deep rollout after the one-ply ordering pass. */
  BEAM: 8,
  /** How many of MY OWN turns the rollout looks ahead, root move included. */
  MY_TURNS: 3,
  /** Rollout interior nodes with more than CAP legal moves are pruned to every
   *  purchase and take2 plus the best TAKE3 resource-takes and RESERVES reserves.
   *  Pruning harder than this measurably weakens the search. */
  MOVE_CAP: 22,
  TAKE3: 8,
  RESERVES: 4,
  /** How many next-best ideas the 'easy' bot settles for when it blunders. */
  EASY_ALTERNATIVES: 3,
};

/** How strongly the easy bot chases the one card it has its eye on. */
const EASY_TARGET_WEIGHT = 14;

/** Safety valve so a rollout can never spin. */
const ROLLOUT_MAX_STEPS = 40;

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

/** Stable identity string for a move; used for deterministic tie-breaking. */
export function moveId(move) {
  switch (move.type) {
    case 'take3':
      return `take3:${inResourceOrder(move.resources).join(',')}`;
    case 'take2':
      return `take2:${move.resource}`;
    case 'buy':
      return `buy:${move.cardId}:${move.fromReserve ? 'r' : 'b'}`;
    case 'reserve':
      return `reserve:${move.cardId ?? ''}:${move.tier ?? ''}`;
    case 'discard':
      return `discard:${[...RESOURCES, 'coin'].map((k) => move.tokens[k] || 0).join(',')}`;
    case 'chooseCompany':
      return `company:${move.companyId}`;
    default:
      return 'pass';
  }
}

/** FNV-ish hash of the visible position, so equal states seed equal randomness. */
function stateHash(state) {
  let h = 2166136261 >>> 0;
  const mix = (n) => {
    h ^= n | 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(state.round);
  mix(state.current);
  mix(state.log.length);
  mix(state.phase.charCodeAt(0));
  mix(state.finalRound ? 1 : 0);
  for (const p of state.players) {
    mix(p.points * 7 + p.cards.length * 13 + p.reserved.length * 29);
    for (const g of RESOURCES) mix(p.tokens[g] * 3 + p.bonuses[g] * 11);
    mix(p.tokens.coin);
  }
  for (const g of RESOURCES) mix(state.bank[g]);
  mix(state.bank.coin);
  for (const t of TIERS) {
    mix(state.decks[t].length);
    for (const id of state.board[t]) mix(id ? hashId(id) : 977);
  }
  for (const id of state.companies) mix(hashId(id));
  return h >>> 0;
}

function hashId(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 33) + id.charCodeAt(i)) | 0;
  return h;
}

/**
 * A working copy that shares the caller's (possibly frozen) arrays but drops
 * the log. Search clones states thousands of times and the log is the single
 * biggest thing to copy; nothing in the search ever reads it. The returned
 * object is never mutated, and everything derived from it goes through
 * engine.cloneState, so sharing is safe.
 * @param {GameState} state
 */
function stripLog(state) {
  // Keep the last few entries: the engine's stalemate detector reads the tail
  // of the log, and we want search states to behave like real ones.
  return state.log.length > 6 ? { ...state, log: state.log.slice(-6) } : state;
}

/** Sample a concrete world; falls back to the state itself if it is concrete. */
function sampleWorld(state, rngState) {
  try {
    return determinize(state, rngState);
  } catch {
    return state;
  }
}

/* ------------------------------------------------------------------ */
/* EVALUATION                                                          */
/* ------------------------------------------------------------------ */

/**
 * Per-decision context: things that are expensive and roughly constant over the
 * shallow horizon we search (board colour demand, game phase). Computed ONCE
 * per decision from the root state and reused for every node, which is why the
 * evaluation must not depend on it for anything that changes fast.
 * @param {GameState} state
 */
function makeContext(state) {
  const demand = emptyCost();
  let sum = 0;
  for (const t of TIERS) {
    for (const id of state.board[t]) {
      if (!id) continue;
      const c = getCard(id);
      for (const g of RESOURCES) demand[g] += c.cost[g] || 0;
    }
  }
  for (const g of RESOURCES) sum += demand[g];
  if (sum <= 0) {
    for (const g of RESOURCES) demand[g] = 1;
  } else {
    for (const g of RESOURCES) demand[g] = (demand[g] * RESOURCES.length) / sum; // mean 1
  }

  let maxPoints = 0;
  for (const p of state.players) if (p.points > maxPoints) maxPoints = p.points;
  const progress = Math.min(1, maxPoints / WIN_POINTS);

  return {
    demand,
    progress,
    /** Effective value of a point right now. */
    pointWeight: W.POINT * (W.POINT_EARLY + W.POINT_RAMP * progress),
    /** Multiplier on every "engine building" term (bonuses, tokens, prospects). */
    econWeight:
      (1 + W.BONUS_EARLY_LIFT) -
      (1 + W.BONUS_EARLY_LIFT - W.BONUS_LATE_FLOOR) * progress,
  };
}

/** Value of holding `n` permanent bonuses of one colour (diminishing). */
function bonusStack(n) {
  let v = 0;
  for (let k = 0; k < n; k++) v += 1 / (1 + W.BONUS_DIMIN * k);
  return v;
}

/**
 * How many turns until `p` can afford `card`, roughly. You gain ~2.5 useful
 * tokens a turn overall but at most 2 of any single colour, so both constraints
 * are applied.
 * @param {Player} p @param {Card} card
 */
function turnsToAfford(p, card) {
  let missing = 0;
  let worst = 0;
  for (const g of RESOURCES) {
    const need = Math.max(0, (card.cost[g] || 0) - (p.bonuses[g] || 0) - (p.tokens[g] || 0));
    missing += need;
    if (need > worst) worst = need;
  }
  const rem = Math.max(0, missing - (p.tokens.coin || 0));
  if (rem === 0) return 0;
  return Math.max(rem / 2.5, worst / 2);
}

/**
 * Progress toward the still-available companies, optionally pretending `bump` has
 * one extra bonus. Superlinear so "one card away" reads much better than half.
 * @param {GameState} s @param {Cost} bonuses @param {Resource|null} bump
 */
function companyScore(s, bonuses, bump) {
  let best = 0;
  let second = 0;
  for (const id of s.companies) {
    const nb = getCompany(id);
    let req = 0;
    let need = 0;
    for (const g of RESOURCES) {
      const r = nb.requires[g] || 0;
      if (r === 0) continue;
      req += r;
      const have = (bonuses[g] || 0) + (g === bump ? 1 : 0);
      need += Math.max(0, r - have);
    }
    if (req === 0) continue;
    const v = Math.pow((req - need) / req, W.COMPANY_EXP);
    if (v > best) {
      second = best;
      best = v;
    } else if (v > second) {
      second = v;
    }
  }
  return W.COMPANY * (best + W.COMPANY_SECOND * second);
}

/**
 * What buying `card` would be worth to `p` right now: its points, the
 * marginal value of the permanent bonus (weighted by board demand), and the
 * company progress it unlocks.
 */
function cardWorth(s, card, p, ctx) {
  let v = card.points * ctx.pointWeight;
  const b = p.bonuses[card.resource] || 0;
  const marginal = bonusStack(b + 1) - bonusStack(b);
  v += marginal * (W.BONUS_BASE + W.BONUS_DEMAND * ctx.demand[card.resource]) * ctx.econWeight;
  v += (companyScore(s, p.bonuses, card.resource) - companyScore(s, p.bonuses, null)) * ctx.econWeight;
  return v;
}

/**
 * The "tempo" term: the discounted value of the cards this player is actually
 * closing in on. Taking the resources a good card needs raises this; taking random
 * resources does not.
 */
function prospectScore(s, p, ctx) {
  /** @type {number[]} */
  const vals = [];
  for (const t of TIERS) {
    for (const id of s.board[t]) {
      if (!id) continue;
      const c = getCard(id);
      vals.push(cardWorth(s, c, p, ctx) / (1 + W.DEFICIT * turnsToAfford(p, c)));
    }
  }
  for (const id of p.reserved) {
    if (!id) continue; // redacted opponent reserve: unknown, contributes nothing
    const c = getCard(id);
    vals.push(
      (W.RESERVE_ACCESS * cardWorth(s, c, p, ctx)) / (1 + W.DEFICIT * turnsToAfford(p, c)),
    );
  }
  vals.sort((a, b) => b - a);
  let out = 0;
  const n = Math.min(vals.length, W.PROSPECT_N);
  for (let k = 0; k < n; k++) out += vals[k] * Math.pow(W.PROSPECT_DECAY, k);
  return out * W.PROSPECT;
}

/**
 * Turns player `i` still gets. Encodes the final-round-equal-turns rule: once
 * someone hits 15 the engine plays on to the last seat, so a player who has
 * already acted this round gets nothing more.
 * @param {GameState} s @param {number} i
 */
export function turnsLeftFor(s, i) {
  if (s.phase === 'gameover') return 0;
  if (!s.finalRound) return 4; // nominal "plenty"
  const last = s.lastPlayer ?? s.players.length - 1;
  return i >= s.current && i <= last ? 1 : 0;
}

/**
 * Static value of one player's position, in point-hundredths.
 * @param {GameState} s @param {number} i
 */
function playerScore(s, i, ctx) {
  const p = s.players[i];
  let score = p.points * ctx.pointWeight;

  // A player with no turns left can no longer convert anything: their position
  // is exactly their score. This is the endgame-race reasoning.
  const soft = Math.min(1, turnsLeftFor(s, i) / 2);
  if (soft <= 0) return score;

  const econ = ctx.econWeight * soft;

  // Permanent bonuses, weighted by what the board demands.
  for (const g of RESOURCES) {
    const b = p.bonuses[g] || 0;
    if (b === 0) continue;
    score += bonusStack(b) * (W.BONUS_BASE + W.BONUS_DEMAND * ctx.demand[g]) * econ;
  }

  // Company progress.
  score += companyScore(s, p.bonuses, null) * econ;

  // Tokens: useful, with diminishing returns per colour and a squeeze near 10.
  let tok = 0;
  for (const g of RESOURCES) {
    const k = p.tokens[g] || 0;
    tok += k <= W.TOKEN_SOFT_CAP ? k : W.TOKEN_SOFT_CAP + W.TOKEN_OVER_CAP * (k - W.TOKEN_SOFT_CAP);
  }
  tok += (p.tokens.coin || 0) * W.GOLD_MULT;
  score += tok * W.TOKEN * soft;
  const held = total(p.tokens);
  if (held > W.OVERLOAD_FROM) score -= W.OVERLOAD * (held - W.OVERLOAD_FROM) ** 2;

  // Cards within reach.
  score += prospectScore(s, p, ctx) * econ;

  // Reserves: a little optionality, but hoarding clogs the hand.
  if (p.reserved.length > 0) {
    score += (W.RESERVE_BASE - W.RESERVE_CLUTTER * p.reserved.length) * soft;
  }

  return score;
}

/**
 * Position value from `me`'s point of view. Terminal states dominate.
 * @param {GameState} s @param {number} me
 * @returns {number}
 */
export function evaluatePosition(s, me, ctx) {
  if (isTerminal(s)) {
    const won = s.winners.includes(me);
    const shared = s.winners.length > 1;
    const base = won ? (shared ? W.WIN * W.DRAW : W.WIN) : -W.WIN;
    return base + s.players[me].points * W.POINT;
  }
  let best = -Infinity;
  for (const p of s.players) {
    if (p.index === me) continue;
    const v = playerScore(s, p.index, ctx);
    if (v > best) best = v;
  }
  if (best === -Infinity) best = 0;
  return playerScore(s, me, ctx) - W.OPP * best;
}

/* ------------------------------------------------------------------ */
/* Fast policies used inside search                                    */
/* ------------------------------------------------------------------ */

/** A cheap, always-legal discard: shed the colours the board least demands. */
function quickDiscardMove(s) {
  const p = s.players[s.current];
  let excess = total(p.tokens) - TOKEN_LIMIT;
  if (excess <= 0) return null;
  const held = { ...p.tokens };
  const tokens = emptyPurse();

  // How much of each colour the visible cards still want from this player.
  const need = emptyCost();
  for (const t of TIERS) {
    for (const id of s.board[t]) {
      if (!id) continue;
      const c = getCard(id);
      for (const g of RESOURCES) {
        const n = Math.max(0, (c.cost[g] || 0) - (p.bonuses[g] || 0));
        if (n > need[g]) need[g] = n;
      }
    }
  }
  for (const id of p.reserved) {
    if (!id) continue;
    const c = getCard(id);
    for (const g of RESOURCES) {
      const n = Math.max(0, (c.cost[g] || 0) - (p.bonuses[g] || 0));
      if (n > need[g]) need[g] = n;
    }
  }

  while (excess > 0) {
    let pick = null;
    let bestSurplus = -Infinity;
    for (const g of RESOURCES) {
      if (held[g] <= 0) continue;
      const surplus = held[g] - need[g];
      if (surplus > bestSurplus) {
        bestSurplus = surplus;
        pick = g;
      }
    }
    if (pick === null) pick = 'coin'; // only if the hand is all coin
    if ((held[pick] || 0) <= 0) break; // defensive; cannot happen
    held[pick] -= 1;
    tokens[pick] += 1;
    excess -= 1;
  }
  return { type: 'discard', tokens };
}

/**
 * Resolve any forced discard/company sub-phases with cheap policies so the search
 * always lands back on an 'action' (or terminal) state.
 */
function settle(s, budget) {
  let guard = 0;
  while (!isTerminal(s) && (s.phase === 'discard' || s.phase === 'company') && guard++ < 8) {
    if (s.phase === 'discard') {
      // The greedy construction is always legal, but fall back to the engine's
      // own list rather than risk throwing deep inside a search.
      const m = quickDiscardMove(s);
      s = applyMove(s, m && isLegal(s, m) ? m : legalMoves(s)[0]);
    } else {
      // All companies are worth 3; take the one the field is closest to stealing.
      const choices = s.companyChoices;
      let pickId = choices[0];
      let bestThreat = -Infinity;
      for (const id of choices) {
        const nb = getCompany(id);
        let threat = 0;
        for (const opp of s.players) {
          if (opp.index === s.current) continue;
          let need = 0;
          for (const g of RESOURCES) need += Math.max(0, (nb.requires[g] || 0) - (opp.bonuses[g] || 0));
          threat = Math.max(threat, -need);
        }
        if (threat > bestThreat || (threat === bestThreat && id < pickId)) {
          bestThreat = threat;
          pickId = id;
        }
      }
      s = applyMove(s, { type: 'chooseCompany', companyId: pickId });
    }
    if (budget) budget.nodes += 1;
  }
  return s;
}

/** Apply a move for the player to act and settle the follow-up phases. */
function step(s, move, budget) {
  const next = applyMove(s, move);
  if (budget) budget.nodes += 1;
  return settle(next, budget);
}

function outOfBudget(budget) {
  if (budget.nodes >= budget.maxNodes) return true;
  if ((budget.nodes & 63) === 0 && Date.now() >= budget.deadline) return true;
  return false;
}

/** How much this player still wants each colour, weighted by how close the
 *  card wanting it is. Pruning only; never used in the evaluation itself. */
function resourceNeed(s, p) {
  const need = emptyCost();
  const add = (c) => {
    const w = 1 / (1 + turnsToAfford(p, c));
    for (const g of RESOURCES) {
      if (Math.max(0, (c.cost[g] || 0) - (p.bonuses[g] || 0) - (p.tokens[g] || 0)) > 0) {
        need[g] += w;
      }
    }
  };
  for (const t of TIERS) for (const id of s.board[t]) if (id) add(getCard(id));
  for (const id of p.reserved) if (id) add(getCard(id));
  return need;
}

/** Pruned move list for rollout interior nodes. Deterministic. */
function rolloutCandidates(s) {
  const moves = legalMoves(s);
  if (moves.length <= SEARCH.MOVE_CAP) return moves;
  const p = s.players[s.current];
  const need = resourceNeed(s, p);
  /** @type {Move[]} */
  const keep = [];
  const takes = [];
  const reserves = [];
  for (const m of moves) {
    if (m.type === 'take3') takes.push(m);
    else if (m.type === 'reserve') reserves.push(m);
    else keep.push(m);
  }
  const byId = (a, b) => (moveId(a) < moveId(b) ? -1 : 1);
  takes.sort((a, b) => {
    const sa = a.resources.reduce((n, g) => n + need[g], 0);
    const sb = b.resources.reduce((n, g) => n + need[g], 0);
    return sb - sa || byId(a, b);
  });
  reserves.sort((a, b) => {
    const pa = a.cardId ? getCard(a.cardId).points : -1;
    const pb = b.cardId ? getCard(b.cardId).points : -1;
    return pb - pa || byId(a, b);
  });
  keep.push(...takes.slice(0, SEARCH.TAKE3), ...reserves.slice(0, SEARCH.RESERVES));
  return keep;
}

/**
 * The 'normal' policy: one-ply greedy for whoever is to move, judged from that
 * player's own point of view. Used to model every player inside a rollout, so
 * it works from the pruned candidate list.
 * @returns {{move: Move, score: number, next: GameState}}
 */
function greedyBest(s, ctx, budget) {
  const me = s.current;
  const moves = rolloutCandidates(s);
  let bestMove = moves[0];
  let bestScore = -Infinity;
  let bestNext = null;
  for (const m of moves) {
    if (bestNext && outOfBudget(budget)) break;
    const next = step(s, m, budget);
    const score = evaluatePosition(next, me, ctx);
    if (
      score > bestScore ||
      (score === bestScore && moveId(m) < moveId(bestMove))
    ) {
      bestScore = score;
      bestMove = m;
      bestNext = next;
    }
  }
  if (!bestNext) bestNext = step(s, bestMove, budget);
  return { move: bestMove, score: bestScore, next: bestNext };
}

/* ------------------------------------------------------------------ */
/* Level: easy                                                         */
/* ------------------------------------------------------------------ */

/**
 * A plausible beginner. Buys what it can afford (points first, then cheap),
 * otherwise grabs resources — but never resources it would immediately have to throw
 * away, and it does not blind-reserve. It plays the second- or third-best idea
 * a fair fraction of the time, which is what makes it beatable.
 */
function easyMove(state, moves, rng) {
  const me = state.current;
  const p = state.players[me];
  const held = total(p.tokens);

  // Never take tokens that would immediately overflow the 10-token limit:
  // beginners are naive, not self-harming.
  const sane = moves.filter((m) => {
    if (m.type === 'take3') return held + m.resources.length <= TOKEN_LIMIT;
    if (m.type === 'take2') return held + 2 <= TOKEN_LIMIT;
    if (m.type === 'reserve') return m.cardId !== null; // no blind draws
    return true;
  });
  const pool = sane.length ? sane : moves;

  const need = easyTarget(state, p);
  const rank = (m) => {
    if (m.type === 'buy') {
      const c = getCard(m.cardId);
      // points first, then the cheapest card (beginners like a full tableau)
      let cost = 0;
      for (const g of RESOURCES) cost += c.cost[g] || 0;
      return 10000 + c.points * 100 - cost;
    }
    if (m.type === 'take3') return 500 + m.resources.length * 10 + naiveResourceFit(state, p, m.resources, need);
    if (m.type === 'take2') return 500 + 15 + naiveResourceFit(state, p, [m.resource, m.resource], need);
    if (m.type === 'reserve') {
      const c = m.cardId ? getCard(m.cardId) : null;
      return 100 + (c ? c.points * 10 : 0);
    }
    return 0;
  };

  const ordered = pool
    .map((m) => ({ m, r: rank(m), id: moveId(m) }))
    .sort((a, b) => b.r - a.r || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Deliberate imperfection: most of the time it plays its naive best.
  if (rng() >= W.EASY_BLUNDER) return ordered[0].m;

  // Blunder: take one of the next-best ideas rather than a uniformly random
  // one. Picking uniformly over every legal move makes a bot that reserves
  // constantly (there are simply more reserve moves than anything else), which
  // reads as broken rather than naive.
  const alt = ordered.slice(1, 1 + SEARCH.EASY_ALTERNATIVES);
  if (!alt.length) return ordered[0].m;
  return alt[rng.int(alt.length)].m;
}

/**
 * The one genuinely thoughtful thing the easy bot does: it picks a card it
 * likes the look of and takes the resources that card still needs. This is how a
 * beginner actually plays ("I want that one, I'll collect those"). Without it
 * the bot takes resources at random and is unplayably weak; with it, it is naive
 * but recognisably trying.
 *
 * @returns {Cost|null} how many more of each resource the target card needs
 */
function easyTarget(state, p) {
  let best = null;
  let bestKey = Infinity;
  for (const t of TIERS) {
    for (const id of state.board[t]) {
      if (!id) continue;
      const c = getCard(id);
      let missing = 0;
      for (const g of RESOURCES) {
        missing += Math.max(0, (c.cost[g] || 0) - (p.bonuses[g] || 0) - (p.tokens[g] || 0));
      }
      // Fewest tokens still needed wins; ties go to the card worth more.
      const key = missing * 10 - c.points;
      if (key < bestKey || (key === bestKey && best && id < best.id)) {
        bestKey = key;
        best = c;
      }
    }
  }
  for (const id of p.reserved) {
    if (!id) continue;
    const c = getCard(id);
    let missing = 0;
    for (const g of RESOURCES) {
      missing += Math.max(0, (c.cost[g] || 0) - (p.bonuses[g] || 0) - (p.tokens[g] || 0));
    }
    const key = missing * 10 - c.points - 5; // slight preference for its own reserve
    if (key < bestKey) {
      bestKey = key;
      best = c;
    }
  }
  if (!best) return null;
  const need = emptyCost();
  for (const g of RESOURCES) {
    need[g] = Math.max(0, (best.cost[g] || 0) - (p.bonuses[g] || 0) - (p.tokens[g] || 0));
  }
  return need;
}

/**
 * "Do these resources help?" — mostly the target card's shortfall, plus a nudge for
 * resources the rest of the board wants.
 */
function naiveResourceFit(state, p, resources, need) {
  let fit = 0;
  // Only the first copy of a colour counts toward a shortfall of 1, etc.
  const taken = emptyCost();
  for (const g of resources) {
    taken[g] += 1;
    if (need && taken[g] <= need[g]) fit += EASY_TARGET_WEIGHT;
  }
  for (const t of TIERS) {
    for (const id of state.board[t]) {
      if (!id) continue;
      const c = getCard(id);
      for (const g of resources) {
        const short = Math.max(0, (c.cost[g] || 0) - (p.bonuses[g] || 0) - (p.tokens[g] || 0));
        if (short > 0) fit += 1;
      }
    }
  }
  return fit;
}

/* ------------------------------------------------------------------ */
/* Level: normal                                                       */
/* ------------------------------------------------------------------ */

/**
 * Solid one-ply heuristic: score every legal move by applying it (in a single
 * sampled world, so blind reserves and board refills are plausible rather than
 * blank) and evaluating the resulting position.
 */
function normalMove(state, moves, ctx, rng, budget) {
  const world = sampleWorld(stripLog(state), rng.state());
  const me = state.current;
  let bestMove = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const next = step(world, m, budget);
    const score = evaluatePosition(next, me, ctx);
    if (score > bestScore || (score === bestScore && moveId(m) < moveId(bestMove))) {
      bestScore = score;
      bestMove = m;
    }
  }
  return bestMove;
}

/* ------------------------------------------------------------------ */
/* Level: hard                                                         */
/* ------------------------------------------------------------------ */

/**
 * Determinized beam search.
 *
 *   1. Sample SEARCH.WORLDS concrete worlds consistent with what we may see.
 *   2. Order the root moves by their average one-ply value across the worlds.
 *   3. Roll the top SEARCH.BEAM out over the next SEARCH.MY_TURNS of our turns,
 *      with every opponent played by the 'normal' one-ply policy, and average
 *      the leaf values across worlds.
 *
 * Both a wall-clock deadline and a node ceiling are enforced; if either is hit
 * the best move found so far (falling back to the one-ply ordering) is returned.
 */
function hardMove(state, moves, ctx, rng, budget) {
  const me = state.current;
  const base = stripLog(state);

  const worlds = [];
  const nWorlds = Math.max(1, SEARCH.WORLDS);
  for (let i = 0; i < nWorlds; i++) {
    worlds.push(sampleWorld(base, (rng.state() ^ Math.imul(i + 1, 0x9e3779b1)) | 0));
  }

  // --- 1-ply ordering, averaged over worlds --------------------------
  const rootStates = new Map(); // moveId -> GameState[] (one per world)
  const ordered = moves.map((m) => {
    const id = moveId(m);
    const nexts = [];
    let sum = 0;
    let n = 0;
    for (const w of worlds) {
      // Always evaluate at least the first world so every root move has a score.
      if (n > 0 && outOfBudget(budget)) break;
      const next = step(w, m, budget);
      nexts.push(next);
      sum += evaluatePosition(next, me, ctx);
      n += 1;
    }
    rootStates.set(id, nexts);
    return { m, id, shallow: sum / n, deep: 0, n: 0 };
  });
  ordered.sort((a, b) => b.shallow - a.shallow || (a.id < b.id ? -1 : 1));

  const beam = ordered.slice(0, SEARCH.BEAM);

  // --- deep rollouts --------------------------------------------------
  outer: for (let wi = 0; wi < worlds.length; wi++) {
    for (const entry of beam) {
      if (outOfBudget(budget)) break outer;
      let s = rootStates.get(entry.id)[wi];
      if (!s) continue; // root ordering was cut short by the budget
      let myTurns = SEARCH.MY_TURNS - 1;
      let steps = 0;
      while (
        !isTerminal(s) &&
        myTurns > 0 &&
        steps++ < ROLLOUT_MAX_STEPS &&
        !outOfBudget(budget)
      ) {
        const actor = s.current;
        const { next } = greedyBest(s, ctx, budget);
        s = next;
        if (actor === me) myTurns -= 1;
      }
      entry.deep += evaluatePosition(s, me, ctx);
      entry.n += 1;
    }
  }

  let best = beam[0];
  for (const e of beam) {
    const a = e.n ? e.deep / e.n : e.shallow;
    const b = best.n ? best.deep / best.n : best.shallow;
    if (a > b || (a === b && e.id < best.id)) best = e;
  }
  return best.m;
}

/* ------------------------------------------------------------------ */
/* Forced sub-phases (discard / company)                                 */
/* ------------------------------------------------------------------ */

/** Best discard by full evaluation; the option count is small (<= ~56). */
function chooseDiscard(state, moves, ctx, budget) {
  const me = state.current;
  let bestMove = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const next = step(state, m, budget);
    const score = evaluatePosition(next, me, ctx);
    if (score > bestScore || (score === bestScore && moveId(m) < moveId(bestMove))) {
      bestScore = score;
      bestMove = m;
    }
  }
  return bestMove;
}

/* ------------------------------------------------------------------ */
/* PUBLIC API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Pick a move. Always returns a member of engine.legalMoves(state).
 * Deterministic in (state, level, seed). Never mutates `state`.
 *
 * @param {GameState} state  redacted state (engine.redactFor)
 * @param {{level:'easy'|'normal'|'hard', seed:number}} opts
 * @returns {Move}
 */
export function chooseMove(state, { level = 'normal', seed = 0 } = {}) {
  const moves = legalMoves(state);
  if (moves.length === 1) return moves[0];
  if (state.phase === 'gameover') return moves[0];

  const rng = makeRng((seed ^ stateHash(state)) | 0);
  const ctx = makeContext(state);
  const budget = {
    nodes: 0,
    maxNodes: level === 'hard' ? HARD_NODE_BUDGET : Infinity,
    deadline: level === 'hard' ? Date.now() + HARD_TIME_BUDGET_MS : Infinity,
  };

  if (state.phase === 'discard') return chooseDiscard(stripLog(state), moves, ctx, budget);
  if (state.phase === 'company') {
    // All companies are worth 3 points, so the choice is pure denial: the full
    // evaluation already docks us for how good the opponents' position is,
    // and removing a company from the pool hurts whoever was chasing it.
    let bestMove = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const next = step(stripLog(state), m, budget);
      const score = evaluatePosition(next, state.current, ctx);
      if (score > bestScore || (score === bestScore && moveId(m) < moveId(bestMove))) {
        bestScore = score;
        bestMove = m;
      }
    }
    return bestMove;
  }

  // An outright win is never passed up, at any level.
  const win = findImmediateWin(state, moves, budget);
  if (win) return win;

  if (level === 'easy') return easyMove(state, moves, rng);
  if (level === 'hard') return hardMove(state, moves, ctx, rng, budget);
  return normalMove(state, moves, ctx, rng, budget);
}

/**
 * A purchase that ends the game with us as the (sole) winner right now.
 * Only 'buy' moves can do this and they need no hidden information.
 */
function findImmediateWin(state, moves, budget) {
  const me = state.current;
  let best = null;
  let bestPts = -1;
  for (const m of moves) {
    if (m.type !== 'buy') continue;
    const next = step(stripLog(state), m, budget);
    if (!isTerminal(next)) continue;
    if (next.winners.length !== 1 || next.winners[0] !== me) continue;
    const pts = next.players[me].points;
    if (pts > bestPts || (pts === bestPts && best && moveId(m) < moveId(best))) {
      bestPts = pts;
      best = m;
    }
  }
  return best;
}

/**
 * Short human phrasing of a move, for bot commentary.
 * e.g. "reserves the 5-point Pepper", "takes Indigo, Cardamom and Saffron".
 *
 * @param {GameState} state
 * @param {Move} move
 * @returns {string}
 */
export function describeMove(state, move) {
  if (!move || typeof move !== 'object') return 'does nothing';
  switch (move.type) {
    case 'take3': {
      const names = move.resources.map((g) => TOKEN_LABEL[g] || g);
      return `takes ${listOf(names)}`;
    }
    case 'take2':
      return `takes 2 ${TOKEN_LABEL[move.resource] || move.resource}`;
    case 'buy': {
      const c = safeCard(move.cardId);
      const where = move.fromReserve ? ' from its reserve' : '';
      if (!c) return `buys a card${where}`;
      return `buys ${describeCard(c)}${where}`;
    }
    case 'reserve': {
      if (move.cardId === null || move.cardId === undefined) {
        return `reserves a card blind from tier ${move.tier}`;
      }
      const c = safeCard(move.cardId);
      return c ? `reserves ${describeCard(c)}` : 'reserves a card';
    }
    case 'discard': {
      const parts = [];
      for (const t of [...RESOURCES, 'coin']) {
        const n = move.tokens?.[t] || 0;
        if (n > 0) parts.push(`${n} ${TOKEN_LABEL[t] || t}`);
      }
      return parts.length ? `returns ${listOf(parts)}` : 'returns nothing';
    }
    case 'chooseCompany': {
      let name = 'a company';
      try {
        name = getCompany(move.companyId).name;
      } catch {
        /* unknown id — keep the generic phrasing */
      }
      return `is visited by ${name}`;
    }
    case 'pass':
      return 'passes';
    default:
      return 'does something unexpected';
  }
}

function describeCard(c) {
  const label = TOKEN_LABEL[c.resource] || c.resource;
  if (c.points > 0) return `the ${c.points}-point ${label}`;
  return `a tier-${c.tier} ${label}`;
}

function safeCard(id) {
  if (typeof id !== 'string') return null;
  try {
    return getCard(id);
  } catch {
    return null;
  }
}

function listOf(parts) {
  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
