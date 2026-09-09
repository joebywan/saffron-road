/**
 * Entry point. Owns the UI state, the event plumbing and the turn loop.
 *
 * Rule of the house: every move dispatched to the engine is an object taken
 * from legalMoves(state). The UI never hand-rolls a move, so an illegal UI
 * state is not representable.
 */
import { TOKENS, TOKEN_LIMIT, emptyPurse, total, inResourceOrder } from '../contract.js';
import {
  createGame,
  legalMoves,
  applyMove,
  isLegal,
  isTerminal,
  redactFor,
} from '../engine.js';
import { randomSeed } from '../rng.js';
import { chooseMove } from '../bots.js';
import * as pick from './select.js';
import { MIN_BOTS, MAX_BOTS, humanPlayer, humanToAct } from './seat.js';
import { renderAll, showToast } from './render.js';
import { PACES, PACE_LABEL, buildTurnReport } from './report.js';
import { resetTicks } from './tick.js';
import { initPwa, promptInstall, reloadForUpdate } from './pwa.js';

/** Pause between bot moves so a human can follow what happened. */
export const BOT_DELAY_MS = 700;
/** Pause when the "fast" toggle is on. */
export const BOT_FAST_MS = 80;
/**
 * "Thinking" pause in press mode. Short on purpose: the beat that makes the
 * turn readable is the press at the end of it, so a long wait before the move
 * would only be dead time on top.
 */
const BOT_THINK_MS = 260;
/** Breather after a move lands, so the board repaints before the next one. */
const SETTLE_MS = 140;

// Renamed with the app. This key holds someone's bot count, difficulty and
// pacing, so moving it resets those to defaults once — accepted deliberately
// while the only installs in the world are the author's own.
const STORE_KEY = 'saffron.ui.v1';
/*
 * THE GAME IN PROGRESS, and deliberately NOT under STORE_KEY.
 *
 * A game is orders of magnitude bigger than the four preferences, and it is
 * the thing most likely to hit a storage quota or to be written by a build
 * whose state shape has since moved. Sharing one key would mean a game that
 * fails to write takes someone's bot count and pacing down with it. Two keys,
 * two failure domains: a save can be lost, corrupt, or from the future, and
 * the preferences do not notice.
 */
const GAME_KEY = 'saffron.game.v1';
const BOT_NAMES = ['Ada', 'Boris', 'Clara', 'Dmitri'];

/* ------------------------------------------------------------------ */
/* UI state                                                            */
/* ------------------------------------------------------------------ */

const ui = {
  screen: 'setup',
  /** @type {import('../contract.js').GameState|null} */
  state: null,
  setup: defaultSetup(),
  /** The bank selection: a COUNT PER RESOURCE, never a list of taps. */
  sel: {},
  discard: emptyPurse(),
  thinking: null,
  /** A bot is mid-move. NOT set while a finished turn's report is on screen. */
  busy: false,
  /** Only one turn loop at a time, however many things call runBots(). */
  loopActive: false,
  /** 'press' | 'normal' | 'fast' — see PACES. */
  pace: 'press',
  /**
   * The last COMPLETED turn: who moved, what they did, and where it left them.
   * Built by report.js once the engine has fully resolved the turn, and kept
   * on screen until the next turn replaces it — including through the human's
   * own turn, because the last bot's move is what they are deciding against.
   * `report.pending` means the game is waiting for them to press Next.
   */
  report: null,
  /** Resolver for that press, or null. */
  continueTurn: null,
  /**
   * A SEAT THE TURN LOOP GAVE UP ON: `{seat, name}`, or null when all is well.
   * Set only by runBots, and only once it has exhausted every move it can make
   * on that seat's behalf. It exists so the failure has somewhere to be SEEN —
   * the board stopping with nobody to act is the one state this game must
   * never present silently. Cleared by the recourse, and by a new game.
   */
  stalled: null,
  /** The state a turn began in, and the moves it has taken so far. */
  turnStart: null,
  turnMoves: [],
  /** Phone layout? Kept in UI state so render() never has to ask the DOM. */
  /**
   * What the player has tapped on the board, and therefore what the action bar
   * is offering. `{kind:'card', id, fromReserve}` or `{kind:'deck', tier}`, and
   * null when the bank selection (ui.sel) is the live one — the two are
   * mutually exclusive by construction.
   */
  picked: null,
  /** The open bottom sheet: {kind:'menu'|'log'|'all'|'player', id?}, or null. */
  sheet: null,
  /**
   * The final standings have been dismissed, and the finished board is on
   * show behind them. A game that has just ended is still a game worth
   * looking at — whose engine you lost to, which company went where — and the
   * standings used to sit over all of it with no way past but a new game.
   * Reset by a new game; the menu puts them back.
   */
  standingsDismissed: false,
  /**
   * A newer build is cached and one reload away. Set from the service worker;
   * see onUpdateReady. Surfaced as a bar the player can take or leave — never
   * as a reload in the middle of their turn.
   */
  updateReady: false,
  gameKey: 0,
  logKey: -1,
  logLen: 0,
};

/**
 * The setup screen collects a count and a difficulty, nothing else. Names are
 * not a decision anyone wants to make: the person at this device is "You" and
 * the bots take stock names in order.
 */
function defaultSetup() {
  return {
    bots: 2,
    level: 'normal',
    seed: '',
    /** "More options" — the replay seed — expanded? */
    more: false,
  };
}

const LEVELS = ['easy', 'normal', 'hard'];

/** The table is you plus MIN_BOTS..MAX_BOTS bots — the only free number. */
function clampBots(setup) {
  setup.bots = Math.min(MAX_BOTS, Math.max(MIN_BOTS, setup.bots | 0));
  return setup;
}

/**
 * The seats the setup screen describes. ONE HUMAN, AT SEAT 0 — see seat.js.
 * The engine happily takes any mix of humans and bots; this UI only ever asks
 * it for one of us and the rest bots.
 */
function seatsFor(setup) {
  const players = [{ name: 'You', isBot: false, botLevel: null }];
  for (let i = 0; i < setup.bots; i++) {
    players.push({ name: BOT_NAMES[i] || `Bot ${i + 1}`, isBot: true, botLevel: setup.level });
  }
  return players;
}

/* ------------------------------------------------------------------ */
/* Persistence — localStorage throws in some embedded contexts.        */
/* ------------------------------------------------------------------ */

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      if (Number.isInteger(data.bots)) ui.setup.bots = data.bots;
      clampBots(ui.setup);
      if (LEVELS.includes(data.level)) ui.setup.level = data.level;
      if (typeof data.seed === 'string') ui.setup.seed = data.seed.slice(0, 12);
      // `fast` is what the old two-state toggle stored. Someone who had it on
      // wanted the bots quick, so honour that; everyone else gets the default.
      if (PACES.includes(data.pace)) ui.pace = data.pace;
      else if (data.fast === true) ui.pace = 'fast';
    }
  } catch {
    /* no storage available — defaults are fine */
  }
}

function savePrefs() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        bots: ui.setup.bots,
        level: ui.setup.level,
        seed: ui.setup.seed,
        pace: ui.pace,
      }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * WRITE THE GAME IN PROGRESS.
 *
 * Called after every move rather than on a timer, because a move is the only
 * thing that changes the state and Android can kill a backgrounded process
 * without running anything. There is no "save point" to be caught between.
 *
 * A finished game REMOVES the save instead of writing one. Restoring someone
 * into a game-over screen they already read is not resuming, and it would mean
 * the only way back to a fresh board is through a menu.
 *
 * Selections, reports and the beat are all left out. They are transient by
 * construction, and a restored turn that thinks a report is still on screen
 * would wait for a press on a button that is not there.
 */
function saveGame() {
  try {
    if (!ui.state || ui.state.phase === 'gameover') {
      localStorage.removeItem(GAME_KEY);
      return;
    }
    localStorage.setItem(GAME_KEY, JSON.stringify({ v: 1, state: ui.state }));
  } catch {
    /* quota, private mode, no storage — the game is still playable */
  }
}

function clearGame() {
  try {
    localStorage.removeItem(GAME_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * READ A GAME BACK, or return null and leave no trace.
 *
 * The validation here is the whole point. A save is the one input this app
 * takes from outside itself: it can be truncated, hand-edited, or written by a
 * build whose state shape has since changed. A bad one must cost the setup
 * screen, never the app.
 *
 * So it is not shape-checked field by field — it is asked to BE a game.
 * legalMoves() walks the phase, the board, the bank and every player's hand
 * through the same code the turn loop uses, and resolves card ids against the
 * registry. Anything malformed enough to matter throws in there, and
 * legalMoves() is documented never to return empty on a live game, so an empty
 * list is itself the tell. That is a stronger check than any list of asserts I
 * would remember to keep current, and it cannot drift from the engine because
 * it IS the engine.
 */
function loadGame() {
  let raw = null;
  try {
    raw = localStorage.getItem(GAME_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return null;
    const state = data.state;
    if (!state || typeof state !== 'object') return null;
    if (!Array.isArray(state.players) || state.players.length < 2) return null;
    if (state.phase === 'gameover' || isTerminal(state)) return null;
    if (!legalMoves(state).length) return null;
    return state;
  } catch {
    // Unparseable, or from a shape the engine no longer understands. Drop it:
    // a save that cannot be read once will not read on the next launch either,
    // and leaving it there would fail the same way every time.
    clearGame();
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Move matching                                                       */
/* ------------------------------------------------------------------ */

/**
 * Canonical key for a move, in the same spirit as the engine's own. Used only
 * to look a move up in legalMoves() — never to decide legality.
 */
function moveKey(state, m) {
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return null;
  switch (m.type) {
    case 'take3':
      return `take3:${Array.isArray(m.resources) ? inResourceOrder(m.resources).join(',') : '?'}`;
    case 'take2':
      return `take2:${m.resource}`;
    case 'buy': {
      const p = state.players[state.current];
      const fr = m.fromReserve === undefined ? p.reserved.includes(m.cardId) : !!m.fromReserve;
      return `buy:${m.cardId}:${fr}`;
    }
    case 'reserve':
      return `reserve:${m.cardId ?? ''}:${m.tier ?? ''}`;
    case 'discard':
      return `discard:${TOKENS.map((t) => (m.tokens && m.tokens[t]) || 0).join(',')}`;
    case 'chooseCompany':
      return `company:${m.companyId}`;
    case 'pass':
      return 'pass';
    default:
      return null;
  }
}

/** The legal move object equivalent to `want`, or null. */
function matchLegal(state, want) {
  const key = moveKey(state, want);
  if (key === null) return null;
  for (const m of legalMoves(state)) {
    if (moveKey(state, m) === key) return m;
  }
  return null;
}

/** Deterministic stand-in if a bot errors or returns nonsense. */
function fallbackMove(moves) {
  const buy = moves.filter((m) => m.type === 'buy');
  if (buy.length) return buy[0];
  const take = moves.filter((m) => m.type === 'take3');
  if (take.length) return take[0];
  const two = moves.filter((m) => m.type === 'take2');
  if (two.length) return two[0];
  return moves[0];
}

/* ------------------------------------------------------------------ */
/* Turn loop                                                           */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const thinkDelay = () =>
  ui.pace === 'fast' ? BOT_FAST_MS : ui.pace === 'normal' ? BOT_DELAY_MS : BOT_THINK_MS;

/** Seed handed to a bot: deterministic for a given position, fresh each turn. */
function botSeed(state) {
  return (
    (state.seed ^ Math.imul(state.log.length + 1, 0x9e3779b1) ^ Math.imul(state.current + 1, 0x85ebca6b)) | 0
  );
}

/**
 * Apply one move and keep track of the turn it belongs to.
 *
 * A turn is not one move: the engine resolves an action, then the over-ten
 * discard, then the company step, then the hand-off, and a human answers two of
 * those itself. So the moves are accumulated from the state the turn began in
 * until the turn is over, and only then does a report exist for it.
 *
 * @returns {boolean} true once the turn is fully resolved.
 */
function play(move) {
  const actor = ui.state.current;
  if (!ui.turnStart || ui.turnStart.current !== actor) {
    ui.turnStart = ui.state;
    ui.turnMoves = [];
  }
  // applyMove first: it throws on an illegal move, and a move that was never
  // applied must not end up in the report as though it had been.
  const next = applyMove(ui.state, move);
  ui.turnMoves.push(move);
  ui.state = next;
  // Resolved when the seat has changed hands, or when the game ended on it —
  // advance() leaves `current` alone on a win, so both have to be asked.
  const done = ui.state.current !== actor || ui.state.phase === 'gameover';
  if (done) {
    // THE STATE IS TRUTH; THE REPORT IS DECORATION. The move is applied by the
    // time we get here, so a report that cannot be composed must cost only
    // itself. Thrown from here it would take the turn loop with it AND leave
    // the bookkeeping below pointing at a turn that is already over, so the
    // next turn would be reported as a continuation of this one.
    try {
      ui.report = buildTurnReport(ui.turnStart, ui.state, actor, ui.turnMoves);
    } catch (err) {
      ui.report = null;
      reportTurnError(err);
    }
    ui.turnStart = null;
    ui.turnMoves = [];
    // AT TURN BOUNDARIES, not after every move. A turn can be three moves
    // (take, discard, choose a company) and a bot in fast mode plays one every
    // 80ms; localStorage is synchronous, so saving per move would put a
    // stringify of the whole game on the main thread a dozen times a second.
    // Backgrounding the app saves the exact current state separately, so the
    // most this can cost is a partial turn nobody had finished anyway.
    saveGame();
  }
  return done;
}

/** Ask a bot for its move, and make sure what comes back is a legal one. */
async function botMove(state) {
  const player = state.players[state.current];
  let proposed = null;
  try {
    // redactFor, always. What the DISPLAY is pinned to (the human seat, see
    // seat.js) and what a bot is allowed to know are different things, and
    // neither is derived from the other.
    proposed = await chooseMove(redactFor(state, state.current), {
      level: player.botLevel || 'normal',
      seed: botSeed(state),
    });
  } catch (err) {
    showToast(`${player.name} stumbled — playing a fallback move`);
    proposed = null;
    reportTurnError(err);
  }
  const moves = legalMoves(state);
  let move = matchLegal(state, proposed);
  if (!move && proposed && isLegal(state, proposed)) move = proposed;
  if (!move) move = fallbackMove(moves);
  return move;
}

/**
 * ONE BOT TURN, RESOLVED TO A FIXED POINT, WITHOUT PAINTING THE MIDDLE OF IT.
 *
 * Borrowing the vocabulary that gets this right: the over-ten discard, company
 * qualification and the win check are STATE-BASED ACTIONS. They resolve by
 * themselves the moment the state would otherwise be looked at, and they
 * repeat until none applies. The turn report is SORCERY-SPEED: it exists only
 * once the state is completely settled.
 *
 * So this loops rather than doing one ordered pass. Today the engine's own
 * order (action -> discard -> company -> advance) means a single pass would in
 * fact suffice — a discard cannot qualify a company and a company cannot put you
 * over the token limit — but that is a property of the current rules, not a
 * thing worth depending on silently.
 *
 * There is no render inside this loop, deliberately. A bot's sub-phases are
 * not interactions and painting them showed a flash of the bot holding twelve
 * tokens, or its points before the company was added to them. The board goes
 * from before the turn to after the whole turn. (A HUMAN'S sub-phases are the
 * exception and are still painted, because they are questions being asked.)
 */
async function resolveBotTurn() {
  const actor = ui.state.current;
  // Bounded, not `for(;;)`. A turn is an action plus at most a discard and a
  // company; anything past that is a bug, and a bug must not become a spin.
  for (let guard = 0; guard < 8; guard++) {
    let move = null;
    try {
      move = await botMove(ui.state);
    } catch (err) {
      reportTurnError(err);
    }
    // NOTHING A BOT DOES MAY KILL THE TURN LOOP. If a seat throws on the way
    // out, the board sits there with a player to act and nobody acting, and
    // the only way out is a new game — the worst failure this loop has. So a
    // refused move falls back to one the engine itself just generated, and a
    // seat that still cannot move gives the turn up rather than holding it.
    //
    // The engine's own move is generated LAZILY, from the state as it is once
    // the proposal has already failed. play() advances ui.state before it can
    // throw on the way out, so a fallback captured up front would be a move
    // generated for a board that no longer exists — legal for the state that
    // produced it and arbitrary, or refused, on the one it would land on.
    for (const pick of [() => move, () => legalMoves(ui.state)[0]]) {
      const candidate = pick();
      if (!candidate) continue;
      try {
        if (play(candidate)) return true;
        break;
      } catch (err) {
        reportTurnError(err);
      }
    }
    if (ui.state.current !== actor) return true;
  }
  reportTurnError(new Error('bot turn did not resolve'));
  return false;
}

/**
 * The beat between one turn and the next. In press mode the game holds here
 * until the player takes the report in; otherwise it is the old timer.
 *
 * The state is ALREADY APPLIED before this is reached. Nothing is gated on
 * the wait: it decides when the eye is told, never what is true.
 */
function waitForBeat() {
  if (ui.pace !== 'press') return sleep(ui.pace === 'fast' ? 0 : SETTLE_MS);
  if (ui.report) ui.report.pending = true;
  render();
  return new Promise((resolve) => {
    ui.continueTurn = resolve;
  });
}

/** Let go of a pending beat, whoever asked — a press, a move, a new game. */
function releaseBeat() {
  if (ui.report) ui.report.pending = false;
  const resolve = ui.continueTurn;
  ui.continueTurn = null;
  if (resolve) resolve();
}

/**
 * ONE ITERATION OF THE TURN LOOP: think, resolve, settle, and hold the beat.
 *
 * Split out of runBots so that EVERYTHING a bot's turn does sits inside one
 * try — the renders included, not only the move. A render that threw used to
 * leave runBots as a rejected promise: nothing on screen said so, the loop's
 * own finally tidied up after it, and the board was left with a seat to act
 * and nobody acting.
 *
 * @param {() => boolean} mine  is this still the game this loop was started for?
 * @returns {Promise<boolean>} false only when the seat could not be moved on.
 */
async function botTurn(mine) {
  ui.busy = true;
  ui.thinking = ui.state.current;
  render();
  await sleep(thinkDelay());
  if (!mine()) return true;

  if (!(await resolveBotTurn())) return false;
  if (!mine()) return true;

  ui.thinking = null;
  ui.busy = false;
  clearSelection();
  ui.discard = emptyPurse();
  render();

  await waitForBeat();
  return true;
}

async function runBots() {
  if (ui.loopActive) return;
  ui.loopActive = true;
  const key = ui.gameKey;
  const mine = () => ui.gameKey === key && ui.screen === 'game';
  try {
    while (mine() && ui.state && !isTerminal(ui.state) && ui.state.players[ui.state.current].isBot) {
      const seat = ui.state.current;
      let moved = false;
      try {
        moved = await botTurn(mine);
      } catch (err) {
        reportTurnError(err);
      }
      if (!mine()) return;
      // A throw on the way out of a turn that nevertheless changed hands is a
      // cosmetic failure, not a stuck seat: the state moved, so the game can.
      // Only a seat that is still sitting there is a stall.
      if (!moved && (ui.state.current !== seat || isTerminal(ui.state))) moved = true;
      if (!moved) {
        // The seat could not be moved on. SAY SO ON SCREEN, with a recourse —
        // a dead board plus a console message the player will never read is
        // precisely the failure this whole loop exists to prevent.
        ui.stalled = { seat, name: ui.state.players[seat].name };
        ui.turnStart = null;
        ui.turnMoves = [];
        break;
      }
    }
  } finally {
    ui.thinking = null;
    ui.busy = false;
    ui.loopActive = false;
    ui.continueTurn = null;
    if (ui.gameKey === key) render();
  }
}

/**
 * Kept in one place so it is easy to see in the console during development.
 *
 * Deliberately NOT named for the bot loop. play() is the human's move path
 * too, and the whole point of these lines is that the next occurrence says
 * what it was — a wrong actor in the one log line defeats that.
 */
function reportTurnError(err) {
  // eslint-disable-next-line no-console
  console.warn('[saffron] turn problem, falling back:', err);
}

/* ------------------------------------------------------------------ */
/* Committing moves                                                    */
/* ------------------------------------------------------------------ */

function clearSelection() {
  ui.sel = pick.empty();
  ui.picked = null;
}

/**
 * Play the human's move.
 *
 * Their own turn never waits for a press — they just made it, and confirming
 * your own move is a click that buys nothing. Any beat still on screen from
 * the last bot is released here: acting on the board is a stronger "I have
 * read that" than pressing Next would be.
 */
function commit(move) {
  if (!move) return;
  play(move);
  clearSelection();
  ui.discard = emptyPurse();
  ui.sheet = null;
  render();
  releaseBeat();
  runBots();
}

/** Look a move up and play it; toast the reason when it is not available. */
function tryMove(want, whenMissing) {
  const move = matchLegal(ui.state, want);
  if (!move) {
    showToast(whenMissing || 'That move is not legal right now');
    return;
  }
  commit(move);
}

function humanCanAct() {
  const state = ui.state;
  if (!state || ui.busy) return false;
  return humanToAct(state);
}

/* ------------------------------------------------------------------ */
/* Game lifecycle                                                      */
/* ------------------------------------------------------------------ */

function parseSeed(text) {
  const t = String(text || '').trim();
  if (!t) return randomSeed();
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n | 0 : randomSeed();
}

/* ------------------------------------------------------------------ */
/* Updates                                                             */
/* ------------------------------------------------------------------ */

/**
 * A newer build has been cached and activated. The page is still running the
 * old code until it reloads, so this decides WHEN.
 *
 * A reload throws away the game in memory — there is no save file — so it
 * happens automatically only where there is nothing to throw away: the setup
 * screen, with no bots mid-think. Anywhere else the player is told and left
 * alone. Losing a half-played game to an update is a worse bug than the stale
 * build this whole change exists to fix.
 */
function onUpdateReady(version) {
  ui.updateReady = true;
  if (version) console.info(`[saffron] update ready: ${version}`);

  const safe = ui.screen === 'setup' && !ui.busy && !ui.state;
  if (safe && reloadForUpdate({ auto: true })) return;

  render();
  showToast('Update ready — reload when you are done');
}

function startGame(seedText) {
  const players = seatsFor(clampBots(ui.setup));
  // Bump the key FIRST: any turn loop still waiting on a beat from the old
  // game checks it the moment it is released and bows out instead of playing
  // a bot's turn onto a board that no longer exists.
  ui.gameKey += 1;
  releaseBeat();
  resetTicks();
  ui.state = createGame({ players, seed: parseSeed(seedText) });
  ui.screen = 'game';
  clearSelection();
  ui.sheet = null;
  ui.discard = emptyPurse();
  ui.thinking = null;
  ui.report = null;
  ui.stalled = null;
  ui.standingsDismissed = false;
  ui.turnStart = null;
  ui.turnMoves = [];
  savePrefs();
  // Before the first move, so a game abandoned on turn one still comes back.
  saveGame();
  render();
  runBots();
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

const ACTIONS = {
  /* --- setup --- */
  'set-bots'(btn) {
    ui.setup.bots = Number(btn.getAttribute('data-value'));
    clampBots(ui.setup);
    savePrefs();
    render();
  },
  'set-level'(btn) {
    const lv = btn.getAttribute('data-value');
    if (!LEVELS.includes(lv)) return;
    ui.setup.level = lv;
    savePrefs();
    render();
  },
  'toggle-more'() {
    ui.setup.more = !ui.setup.more;
    render();
  },
  start() {
    startGame(ui.setup.seed);
  },

  /* --- header --- */
  /**
   * One control, three modes. Cycling rather than a segmented row because it
   * lives in the overflow menu and in the desktop header, where a row of three
   * would cost more width than the setting is worth.
   */
  'cycle-pace'() {
    ui.pace = PACES[(PACES.indexOf(ui.pace) + 1) % PACES.length];
    savePrefs();
    // Leaving press mode has to let go of a beat that is already waiting, or
    // the game would sit there with nothing left on screen to press.
    if (ui.pace !== 'press') releaseBeat();
    render();
  },
  /** "Next" on the turn report. The only thing the beat is waiting for. */
  'continue-turn'() {
    releaseBeat();
    render();
  },
  /**
   * THE WAY OUT OF A SEAT THE LOOP GAVE UP ON.
   *
   * Not a reset and not a skip: it plays the ENGINE'S OWN first legal move for
   * whatever phase the seat is stuck in. legalMoves() is never empty and is
   * always phase-appropriate — an action, a discard, a company, or the `pass`
   * the engine keeps for a board where nothing else is possible — so this is a
   * real move on a real board, and one press moves the game on by one step.
   * If the seat is somehow still stuck afterwards the loop stalls again and
   * says so again, which is no worse than where it started.
   */
  'skip-seat'() {
    // Gated on the stall itself, not on the button being on screen. Without
    // this the handler would force a move onto whatever seat happened to be
    // current — the human's own turn included, and silently.
    if (!ui.stalled) return;
    ui.stalled = null;
    if (ui.state && !isTerminal(ui.state)) {
      try {
        const move = legalMoves(ui.state)[0];
        if (move) play(move);
      } catch (err) {
        reportTurnError(err);
      }
    }
    // NO render() HERE. runBots() paints either way — as its first act if
    // another bot is up, or from its finally if the seat it handed to is
    // yours — and a render in between would paint the beat CLOSED for one
    // frame and then reopen it. That is a backdrop blink, which is the one
    // thing this popup is built not to do.
    runBots();
  },
  /**
   * THE GUARD ON THE ONLY REMAINING WAY TO LOSE A GAME BY ACCIDENT.
   *
   * Gated on the state rather than on which button was pressed, so a finished
   * game goes straight through: there is nothing left to discard, and asking
   * someone to confirm the abandonment of a game that already ended is a
   * dialog that only ever gets one answer.
   */
  'confirm-new'() {
    if (!ui.state || isTerminal(ui.state)) {
      ACTIONS['new-setup']();
      return;
    }
    ui.sheet = { kind: 'confirm-new' };
    render();
  },
  'new-setup'() {
    ui.gameKey += 1;
    releaseBeat();
    resetTicks();
    ui.screen = 'setup';
    ui.state = null;
    // Deliberately abandoned, so it must not come back on the next launch.
    clearGame();
    ui.busy = false;
    ui.thinking = null;
    ui.report = null;
    ui.stalled = null;
    ui.standingsDismissed = false;
    ui.turnStart = null;
    ui.turnMoves = [];
    // Back at the setup screen with an update waiting: there is no longer a
    // game to lose, so take it now rather than making the player think about
    // it. Declined (already auto-reloaded once this session) leaves the bar up.
    if (ui.updateReady && reloadForUpdate({ auto: true })) return;
    render();
  },
  'play-again'() {
    startGame('');
  },

  /* --- the board --- */
  'take-resource'(btn) {
    if (!humanCanAct()) return;
    // Resources and a card are two different turns: picking one drops the other.
    ui.picked = null;
    const resource = btn.getAttribute('data-resource');
    const takes = pick.takeMoves(legalMoves(ui.state));
    if (pick.viable(pick.plus(ui.sel, resource), takes)) {
      ui.sel = pick.plus(ui.sel, resource);
      render();
      return;
    }
    // Adding is impossible — a second click on a chosen pile takes one back.
    if ((ui.sel[resource] || 0) > 0) {
      ui.sel = pick.minus(ui.sel, resource);
      render();
      return;
    }
    showToast(pick.whyNot(ui.sel, takes, resource, ui.state.bank));
  },
  'confirm-take'() {
    if (!humanCanAct()) return;
    const takes = pick.takeMoves(legalMoves(ui.state));
    const move = pick.complete(ui.sel, takes);
    if (!move) {
      showToast(
        pick.size(ui.sel) === 0 ? 'Pick some resources first' : 'That is not a complete take yet',
      );
      return;
    }
    commit(move);
  },
  'clear-take'() {
    ui.sel = pick.empty();
    render();
  },
  'clear-pick'() {
    clearSelection();
    render();
  },
  'pick-card'(btn) {
    const id = btn.getAttribute('data-card');
    const fromReserve = btn.getAttribute('data-reserve') === '1';
    const same =
      ui.picked && ui.picked.kind === 'card' && ui.picked.id === id && !!ui.picked.fromReserve === fromReserve;
    ui.sel = pick.empty();
    ui.picked = same ? null : { kind: 'card', id, fromReserve };
    render();
  },
  'pick-deck'(btn) {
    const tier = Number(btn.getAttribute('data-tier'));
    const same = ui.picked && ui.picked.kind === 'deck' && ui.picked.tier === tier;
    ui.sel = pick.empty();
    ui.picked = same ? null : { kind: 'deck', tier };
    render();
  },
  'open-sheet'(btn) {
    ui.sheet = { kind: btn.getAttribute('data-sheet'), id: btn.getAttribute('data-id') };
    render();
  },
  /**
   * A tap on the scrim puts the standings away. Only the scrim: a tap that
   * landed on the panel and bubbled out to it must not, or every press inside
   * would dismiss the thing it was aimed at. Same rule as close-sheet.
   */
  'close-standings'(btn, event) {
    if (event && event.target !== btn) return;
    ui.standingsDismissed = true;
    render();
  },
  /** The way back to them, from the menu. */
  'show-standings'() {
    ui.standingsDismissed = false;
    ui.sheet = null;
    render();
  },
  'close-sheet'(btn, event) {
    // Only the backdrop itself closes; a tap that landed inside the panel and
    // bubbled out to it must not.
    if (event && event.target !== btn && btn.classList.contains('sheet-backdrop')) return;
    ui.sheet = null;
    render();
  },
  install() {
    ui.sheet = null;
    render();
    promptInstall();
  },

  /* --- the update bar --- */
  'apply-update'() {
    // Asked for by hand, so no loop guard: this is the escape hatch if the
    // automatic path ever declines.
    reloadForUpdate();
  },
  'dismiss-update'() {
    // Only the bar goes away. The new code is cached either way and the next
    // launch of the app is on it.
    ui.updateReady = false;
    render();
  },
  buy(btn) {
    if (!humanCanAct()) return;
    tryMove(
      {
        type: 'buy',
        cardId: btn.getAttribute('data-card'),
        fromReserve: btn.getAttribute('data-reserve') === '1',
      },
      btn.getAttribute('data-reason') || 'You cannot buy that card yet',
    );
  },
  'reserve-card'(btn) {
    if (!humanCanAct()) return;
    tryMove(
      { type: 'reserve', cardId: btn.getAttribute('data-card'), tier: null },
      btn.getAttribute('data-reason') || 'You cannot reserve that card',
    );
  },
  'reserve-deck'(btn) {
    if (!humanCanAct()) return;
    const tier = Number(btn.getAttribute('data-tier'));
    tryMove(
      { type: 'reserve', cardId: null, tier },
      btn.getAttribute('data-reason') || 'You cannot reserve from that deck',
    );
  },
  pass() {
    if (!humanCanAct()) return;
    tryMove({ type: 'pass' }, 'Passing is only legal when nothing else is');
  },

  /* --- discard --- */
  'discard-add'(btn) {
    if (!humanCanAct()) return;
    const t = btn.getAttribute('data-token');
    const p = humanPlayer(ui.state);
    const excess = total(p.tokens) - TOKEN_LIMIT;
    if (total(ui.discard) >= excess) {
      showToast(`You only need to return ${excess}`);
      return;
    }
    if ((ui.discard[t] || 0) >= (p.tokens[t] || 0)) {
      showToast(`No more ${t} tokens to return`);
      return;
    }
    ui.discard[t] = (ui.discard[t] || 0) + 1;
    render();
  },
  'discard-undo'(btn) {
    if (!humanCanAct()) return;
    const t = btn.getAttribute('data-token');
    if ((ui.discard[t] || 0) > 0) ui.discard[t] -= 1;
    render();
  },
  'discard-reset'() {
    ui.discard = emptyPurse();
    render();
  },
  'confirm-discard'() {
    if (!humanCanAct()) return;
    tryMove({ type: 'discard', tokens: { ...ui.discard } }, 'Return the exact number of tokens');
  },

  /* --- companies --- */
  'choose-company'(btn) {
    if (!humanCanAct()) return;
    tryMove({ type: 'chooseCompany', companyId: btn.getAttribute('data-company') }, 'That company is not available');
  },
};

function onClick(event) {
  const btn = event.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.getAttribute('data-act');
  if (btn.getAttribute('aria-disabled') === 'true') {
    event.preventDefault();
    showToast(btn.getAttribute('data-reason') || 'Not available right now');
    return;
  }
  const fn = ACTIONS[act];
  if (!fn) return;
  event.preventDefault();
  fn(btn, event);
}

function onInput(event) {
  const field = event.target.getAttribute && event.target.getAttribute('data-field');
  if (field !== 'seed') return;
  ui.setup.seed = event.target.value.replace(/[^0-9-]/g, '').slice(0, 12);
  if (event.target.value !== ui.setup.seed) event.target.value = ui.setup.seed;
  savePrefs();
  // No re-render: that would fight the caret.
}

function onKeyDown(event) {
  if (event.key !== 'Escape') return;
  if (ui.screen !== 'game') return;
  if (ui.sheet) {
    ui.sheet = null;
    render();
    return;
  }
  // Escape closes the standings for the same reason a tap on the scrim does:
  // it is a panel you are finished with, not a question you owe an answer to.
  // Below the sheet, because a sheet opened over them is the nearer layer.
  if (ui.state && ui.state.phase === 'gameover' && !ui.standingsDismissed) {
    ui.standingsDismissed = true;
    render();
    return;
  }
  if (ui.picked) {
    ui.picked = null;
    render();
    showToast('Card deselected');
    return;
  }
  if (ui.state && ui.state.phase === 'discard' && total(ui.discard) > 0) {
    ui.discard = emptyPurse();
    render();
    showToast('Return selection cleared');
    return;
  }
  if (pick.size(ui.sel)) {
    ui.sel = pick.empty();
    render();
    showToast('Resource selection cleared');
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function render() {
  renderAll(ui);
}

function boot() {
  loadPrefs();
  /*
   * RESUME, IF THERE IS SOMETHING TO RESUME.
   *
   * Straight onto the board rather than onto the title screen offering a
   * "Resume" button: closing a game on a phone is not a decision, it is a
   * phone call, and the app should come back where it was left. The title
   * screen is still one tap away through the menu, and now that New game
   * confirms before discarding, that route is safe to take by accident.
   *
   * Everything transient stays at its default. In particular ui.report is
   * null, so the turn loop does not sit waiting for a press on a report that
   * belonged to a session that has ended.
   */
  const resumed = loadGame();
  if (resumed) {
    ui.state = resumed;
    ui.screen = 'game';
  }

  // Offline support, the Install button, and being told when a new build has
  // been cached. A no-op off a file:// URL or any other non-secure context,
  // which is exactly where it must not throw.
  initPwa({ onUpdateReady });
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKeyDown);

  /*
   * THE SAVE THAT CATCHES A MID-TURN EXIT.
   *
   * play() saves at turn boundaries; this saves the exact current state the
   * moment the app is backgrounded, which on a phone is the way a game is
   * almost always left. visibilitychange is the one that actually fires when
   * someone presses home or takes a call — pagehide is the belt to its braces,
   * for a tab being closed outright.
   */
  const persist = () => {
    if (document.visibilityState === 'hidden') saveGame();
  };
  document.addEventListener('visibilitychange', persist);
  window.addEventListener('pagehide', saveGame);

  render();
  // A restored game whose seat belongs to a bot has nobody to move it on
  // otherwise: the loop only ever starts from here or from a human's move.
  if (resumed) runBots();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
