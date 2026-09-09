/**
 * Rendering. Reads GameState + a small UI state object and rebuilds the
 * document regions. No game logic lives here: legality always comes from
 * legalMoves() and costs always come from affordability().
 *
 * Rebuilds are wholesale but focus-safe: every focusable node carries a
 * data-fk key which is restored after a repaint.
 */
import { RESOURCES, TOKEN_LABEL, TOKENS, TOKEN_LIMIT, MAX_RESERVED, WIN_POINTS, total, DECK_LABEL, DECK_LABEL_ONE } from '../contract.js';
import { legalMoves, getCard, getCompany, finalScores } from '../engine.js';
import * as pick from './select.js';
import { PACE_LABEL } from './report.js';
import { HUMAN_SEAT, MIN_BOTS, MAX_BOTS, humanPlayer, humanToAct } from './seat.js';
import {
  el,
  sr,
  fill,
  appendAll,
  tokenIcon,
  cardTile,
  deckTile,
  emptyTile,
  companyEl,
  oppChip,
  pileEl,
  updatePile,
  playerPanel,
  holdingChip,
  actionButton,
  costColumn,
  shortfallText,
  possessive,
} from './components.js';
import { installAvailable } from './pwa.js';
import { runTicks } from './tick.js';

const TIERS = [3, 2, 1];

const dom = {};
function q(id) {
  if (!dom[id]) dom[id] = document.getElementById(id);
  return dom[id];
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function renderAll(ui) {
  const fk = document.activeElement && document.activeElement.getAttribute
    ? document.activeElement.getAttribute('data-fk')
    : null;

  q('setup').hidden = ui.screen !== 'setup';
  q('game').hidden = ui.screen !== 'game';

  // Rendered on both screens, and outside TRANSIENT_LAYERS on purpose: unlike
  // a sheet or a modal this is not part of the board, and leaving the board
  // must not silently drop the one signal that new code is waiting.
  renderUpdateBar(ui);

  if (ui.screen === 'setup') {
    // Every floating layer is rendered from renderGame, so nothing would close
    // one when we leave the board. That stranded the standings panel over the
    // setup form once; when the menu sheet was added later it did it again, and
    // "New game" looked like it did nothing because the menu stayed over the
    // form it had just opened. Clear them here, by list, so a third layer
    // cannot reintroduce this a third time.
    //
    // ONE EXCEPTION: How to play. It is the sheet a player wants BEFORE their
    // first game, not after, and it is the only one that needs no game state
    // to render. Every other kind is dropped on the way in, so nothing that
    // reads `ctx.state` can survive onto a screen that has none.
    const howto = ui.sheet && ui.sheet.kind === 'howto';
    if (!howto) {
      ui.sheet = null;
      sheetKey = null;
    }
    beatWasOpen = false;
    for (const id of TRANSIENT_LAYERS) {
      if (id === 'sheet' && howto) continue;
      const layer = q(id);
      if (!layer) continue;
      layer.hidden = true;
      layer.replaceChildren();
    }
    renderSetup(ui);
    const sheetRoot = q('sheet');
    if (howto) {
      sheetRoot.hidden = false;
      fill(sheetRoot, howToSheet());
    } else if (sheetRoot) {
      sheetRoot.hidden = true;
      sheetRoot.replaceChildren();
    }
  } else {
    renderGame(ui);
  }

  // Numbers that changed since the last paint run to their new value instead
  // of jumping. Called after the DOM is settled, and a no-op under
  // prefers-reduced-motion.
  runTicks();

  if (fk) {
    const again = document.querySelector(`[data-fk="${cssEscape(fk)}"]`);
    if (again && again !== document.activeElement) {
      try {
        again.focus({ preventScroll: true });
      } catch {
        /* focus is best-effort */
      }
    }
  }
}

// Escape with a replacement FUNCTION, never a replacement string: this file's
// source is itself spliced in by tools/bundle.js via String.replace(), where
// dollar-ampersand and friends would expand into the surrounding HTML.
function cssEscape(s) {
  return String(s).replace(/["\\]/g, (c) => `\\${c}`);
}

/* ------------------------------------------------------------------ */
/* Setup screen                                                        */
/* ------------------------------------------------------------------ */

/**
 * THE SETUP SCREEN ASKS TWO QUESTIONS: how many bots, and how good are they.
 *
 * It used to ask for a name per seat, a type per seat and a level per seat —
 * a form that grew a row every time you added a player, needed a keyboard on
 * a phone, and collected something nobody cares about. Bot names are stock
 * names; the game assigns them.
 *
 * It also used to ask how many PEOPLE were at the device. It no longer does:
 * a game is one human — you — and one to three bots, so there is no count to
 * take and no seat to hand over. The replay seed is the only thing left behind
 * "More options".
 *
 * Everything is a segmented control: one tap, no keyboard, no dropdown, and
 * the whole screen fits a phone without scrolling.
 */
/**
 * THE CROCUS, as inline SVG. Same shape as the launcher icon in tools/icons.js
 * — one petal mass with the three stigmas cut OUT of it — drawn here rather
 * than loaded, so the title screen costs no request and no file.
 */
function brandMark(size) {
  const id = 'crocus-cut';
  const petal = 'M12 22 Q4.6 17.6 4.6 11.2 Q4.6 5.4 8.4 2.6 Q10 6 12 6 Q14 6 15.6 2.6 '
    + 'Q19.4 5.4 19.4 11.2 Q19.4 17.6 12 22 Z';
  const svg =
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">`
    + `<mask id="${id}"><rect width="24" height="24" fill="#fff"/>`
    + '<path d="M9.2 9.2 Q7.9 14 9.6 18.8" stroke="#000" stroke-width="1.7" fill="none" stroke-linecap="round"/>'
    + '<path d="M12 8.4 Q12 14 12 19.4" stroke="#000" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
    + '<path d="M14.8 9.2 Q16.1 14 14.4 18.8" stroke="#000" stroke-width="1.7" fill="none" stroke-linecap="round"/>'
    + '</mask>'
    + `<path d="${petal}" fill="var(--token-saffron-fill)" mask="url(#${id})"/>`
    + '</svg>';
  const span = el('span', { class: 'title-mark' });
  span.innerHTML = svg;
  return span;
}

function renderSetup(ui) {
  const s = ui.setup;
  const root = q('setup');

  const body = el(
    'div',
    { class: 'setup-body' },
    // THE TITLE SCREEN. The app used to open on a bare "New game" form with no
    // name and no mark anywhere in it — the header that carried the logo went
    // with the wide layout. The first thing anyone sees should say what they
    // opened.
    el(
      'div',
      { class: 'title' },
      brandMark(64),
      el('h1', { class: 'title-name', text: 'Saffron Road' }),
      el('p', { class: 'title-sub', text: 'A trading game on the spice road' }),
    ),
    el('h2', { class: 'setup-title', text: 'New game' }),
    el('p', {
      class: 'setup-sub',
      text: `First to ${WIN_POINTS} points triggers the final round.`,
    }),
    segGroup({
      label: 'Bots',
      act: 'set-bots',
      fk: 'setup-bots',
      value: String(s.bots),
      options: botCounts().map((n) => ({
        value: String(n),
        label: String(n),
        aria: `${n} bot${n === 1 ? '' : 's'} against you`,
        ok: true,
        reason: '',
      })),
    }),
    segGroup({
      label: 'Difficulty',
      act: 'set-level',
      fk: 'setup-level',
      value: s.level,
      options: ['easy', 'normal', 'hard'].map((lv) => ({
        value: lv,
        label: lv[0].toUpperCase() + lv.slice(1),
        aria: `${lv} bots`,
        ok: true,
        reason: '',
      })),
    }),
    el(
      'div',
      { class: 'setup-actions' },
      actionButton({
        label: 'Start game',
        act: 'start',
        ok: true,
        reason: '',
        data: {},
        fk: 'setup-start',
        aria: 'Start the game',
        cls: 'btn--primary btn--big btn--wide',
      }),
      // A peer of Start game, not a footnote next to "More options". Someone
      // who has never played is on this screen for exactly one reason and it
      // is not to configure a seed.
      el(
        'button',
        {
          type: 'button',
          class: 'btn btn--big btn--wide setup-howto',
          'data-act': 'open-sheet',
          'data-sheet': 'howto',
          'data-fk': 'setup-howto',
          'aria-haspopup': 'dialog',
        },
        'How to play',
      ),
    ),
    el(
      'div',
      { class: 'setup-more' },
      el(
        'button',
        {
          type: 'button',
          class: 'disclosure',
          'data-act': 'toggle-more',
          'data-fk': 'setup-more',
          'aria-expanded': s.more ? 'true' : 'false',
        },
        el('span', { class: 'disclosure-mark', 'aria-hidden': 'true', text: s.more ? '−' : '+' }),
        'More options',
      ),
      s.more
        ? el(
            'div',
            { class: 'setup-more-body' },
            el(
              'label',
              { class: 'field field--seed' },
              el('span', { class: 'field-label', text: 'Seed' }),
              el('input', {
                type: 'text',
                class: 'input',
                value: s.seed || '',
                inputmode: 'numeric',
                placeholder: 'random',
                maxlength: '12',
                'data-field': 'seed',
                'data-fk': 'setup-seed',
                'aria-label': 'Game seed, leave blank for random',
              }),
            ),
            el('p', { class: 'hint', text: 'The same seed and the same number of bots replay the same game.' }),
          )
        : null,
    ),
  );

  fill(root, body);
}

/** 1, 2, 3 — the table sizes a single human can sit down to. */
function botCounts() {
  const out = [];
  for (let n = MIN_BOTS; n <= MAX_BOTS; n++) out.push(n);
  return out;
}

/**
 * A labelled row of segmented buttons. Unavailable options stay in place,
 * focusable, carrying the reason — the count you cannot pick is information.
 */
function segGroup({ label, act, fk, value, options, hidden }) {
  if (hidden) return null;
  const group = el('div', { class: 'seg seg--wide', role: 'group', 'aria-label': label });
  for (const o of options) {
    const on = o.value === value;
    const b = el('button', {
      type: 'button',
      class: `seg-btn${on ? ' is-on' : ''}${o.ok ? '' : ' seg-btn--off'}`,
      'aria-pressed': on ? 'true' : 'false',
      'aria-disabled': o.ok ? null : 'true',
      'data-reason': o.ok ? null : o.reason,
      'aria-label': o.ok ? `${label}: ${o.aria}` : `${label}: ${o.aria} — unavailable: ${o.reason}`,
      'data-act': act,
      'data-value': o.value,
      'data-fk': `${fk}:${o.value}`,
    });
    b.append(o.label);
    group.append(b);
  }
  return el('div', { class: 'setup-field' }, el('span', { class: 'field-label', text: label }), group);
}


/* ------------------------------------------------------------------ */
/* Game context                                                        */
/* ------------------------------------------------------------------ */

/**
 * Everything the component builders need, derived once per render.
 *
 * THE VIEWPOINT IS NOT IN HERE, because it is not a variable: it is
 * HUMAN_SEAT, on every turn (see seat.js). What IS in here and does move is
 * `interactive` — whether the person at the device may act right now — and
 * those two used to be conflated.
 */
export function buildContext(ui) {
  const state = ui.state;
  const cur = state.players[state.current];
  const you = humanPlayer(state);
  const moves = legalMoves(state);
  const humanTurn = humanToAct(state) && state.phase !== 'gameover';
  const interactive = humanTurn && state.phase === 'action' && !ui.busy;

  const buyKeys = new Set();
  const reserveIds = new Set();
  const deckTiers = new Set();
  if (interactive) {
    for (const m of moves) {
      if (m.type === 'buy') {
        const fr = m.fromReserve === undefined ? you.reserved.includes(m.cardId) : !!m.fromReserve;
        buyKeys.add(`${m.cardId}|${fr}`);
      } else if (m.type === 'reserve') {
        if (m.cardId) reserveIds.add(m.cardId);
        else if (m.tier) deckTiers.add(m.tier);
      }
    }
  }

  // WHOSE TURN THE SCREEN IS CURRENTLY SHOWING. Normally the seat to act; but
  // while a finished turn's report is waiting to be taken in, it is the seat
  // that report belongs to. Highlighting the next bot before its turn has
  // started, over a report about the previous one, is exactly the mixed
  // attribution the report exists to fix.
  const pending = !!(ui.report && ui.report.pending);
  const spotlight = pending ? ui.report.actor : state.current;

  const takes = pick.takeMoves(moves);
  const blockedReason =
    state.phase === 'gameover'
      ? 'The game is over'
      : // A stalled seat outranks every reason under it. While the loop has
        // given up, "Bot 1 is taking their turn" is not true, and it is the
        // one sentence a stuck player would otherwise be read over and over.
        ui.stalled
        ? `${ui.stalled.seat === HUMAN_SEAT ? 'Your' : possessive(ui.stalled.name)} turn could not be taken — press Carry on`
        : pending
          ? `${spotlight === HUMAN_SEAT ? 'Your' : possessive(state.players[spotlight].name)} turn is on screen — press Next`
          : state.phase === 'discard'
            ? 'Return tokens down to 10 first'
            : state.phase === 'company'
              ? 'Choose a company first'
              : cur.isBot
                ? `${cur.name} is taking their turn`
                : ui.busy
                  ? 'Please wait'
                  : 'Not available';

  return {
    state,
    ui,
    picked: ui.picked,
    /** The player at this device. Never anyone else. */
    you,
    moves,
    takes,
    pending,
    spotlight,
    humanTurn,
    interactive,
    blockedReason,
    buyKeys,
    reserveIds,
    deckTiers,
    reservedFull: you.reserved.length >= MAX_RESERVED,
    thinking: ui.thinking,
    sel: ui.sel,
    canAdd: interactive ? pick.addable(ui.sel, takes) : new Set(),
    selReason: (resource) => pick.whyNot(ui.sel, takes, resource, state.bank),
    card: (id) => {
      try {
        return getCard(id);
      } catch {
        return null;
      }
    },
    company: (id) => {
      try {
        return getCompany(id);
      } catch {
        return null;
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Game screen                                                         */
/* ------------------------------------------------------------------ */

/**
 * ONE RENDER, ONE LAYOUT.
 *
 * There used to be two: a phone layout below 720px and a wide one above it,
 * chosen by a media query. The wide one is gone. It was a second arrangement
 * of the same state that nobody played on, and the cost of it was not the
 * code — it was that every change had to be reasoned about twice and the two
 * could disagree. They did: the turn report and the cost pips each spent a
 * release saying different things on the two layouts.
 *
 * What is left renders at any width. On a big screen it is the same board,
 * capped and centred, which is what a phone-first game should look like when
 * somebody opens it on a laptop.
 */
function renderGame(ui) {
  const ctx = buildContext(ui);
  const state = ui.state;

  const round = q('round');
  if (round) {
    round.textContent = `R${state.round}`;
    round.classList.toggle('is-hot', !!state.finalRound);
  }
  fill(q('status'), statusBar(ctx));
  renderBeat(ui, ctx);
  renderBank(ctx);
  fill(q('oppstrip'), opponentStrip(ctx));
  fill(q('companies'), companyStrip(ctx));
  fill(q('tiers'), tierGrid(ctx));
  fill(q('you'), youRail(ctx));
  fill(q('takebar'), actionBar(ctx));

  // Still built, never shown: #log is the aria-live region that narrates the
  // bots' turns, and CSS clips it to a screen-reader-only box. The Move log
  // sheet is the visible way in.
  renderLog(ui);
  renderSheet(ui, ctx);
  renderOverlay(ui, ctx);
}

/* ------------------------------------------------------------------ */
/* Phone layout                                                        */
/* ------------------------------------------------------------------ */

/** The bots, as a row of tap targets. Everyone at the table but you. */
function opponentStrip(ctx) {
  const row = el('div', { class: 'oppstrip-row', role: 'group', 'aria-label': 'Bots' });
  for (const p of ctx.state.players) {
    if (p.index === HUMAN_SEAT) continue;
    row.append(oppChip(p, ctx));
  }
  return row;
}

/**
 * Companies as a thin row of requirement pips. No names: the printed tiles carry
 * portraits, not names, and what you actually read off a company is which cards
 * it wants. The name is still the tile's accessible name.
 */
function companyStrip(ctx) {
  const p = ctx.you;
  const row = el('div', { class: 'company-strip' });
  if (!ctx.state.companies.length) {
    row.append(el('p', { class: 'empty', text: 'All companies claimed.' }));
    return row;
  }
  for (const id of ctx.state.companies) {
    const n = ctx.company(id);
    if (!n) continue;
    const pips = el('ul', { class: 'cost cost--company' });
    const words = [];
    let met = true;
    for (const g of RESOURCES) {
      const need = n.requires[g] || 0;
      if (!need) continue;
      const have = p ? p.bonuses[g] || 0 : 0;
      const ok = have >= need;
      if (!ok) met = false;
      words.push(`${need} ${TOKEN_LABEL[g]} (you have ${have})`);
      pips.append(el('li', { class: `pill pill--${g}${ok ? ' is-covered' : ''}` }, tokenIcon(g, 20, need)));
    }
    const chip = el(
      'div',
      {
        class: `companychip${met ? ' is-met' : ''}`,
        'aria-label': `Company ${n.name}, ${n.points} points, wants ${words.join(', ')}.` + (met ? ' You qualify.' : ''),
      },
      el('span', { class: 'companychip-pts', 'aria-hidden': 'true', text: String(n.points) }),
      pips,
    );
    row.append(chip);
  }
  return row;
}

/** The twelve face-up cards plus the three decks, as one fixed grid. */
function tierGrid(ctx) {
  return TIERS.map((t) => {
    const row = el('div', { class: `tier-row tier-row--t${t}`, role: 'group', 'aria-label': DECK_LABEL[t] });
    row.append(deckTile(t, ctx));
    for (const id of ctx.state.board[t]) {
      if (!id) {
        row.append(emptyTile());
        continue;
      }
      const c = ctx.card(id);
      row.append(c ? cardTile(c, ctx) : emptyTile());
    }
    return row;
  });
}

/**
 * Your own holdings, always on screen: points, what you hold, what your cards
 * discount, and your reserved cards as tiles you can select and buy.
 */
function youRail(ctx) {
  const p = ctx.you;
  const held = TOKENS.reduce((n, t) => n + (p.tokens[t] || 0), 0);
  const rail = el('div', { class: 'you-rail' });

  rail.append(
    el(
      'button',
      {
        type: 'button',
        class: 'you-me',
        'data-act': 'open-sheet',
        'data-sheet': 'player',
        'data-id': String(p.index),
        'data-fk': 'you-me',
        'aria-haspopup': 'dialog',
        'aria-label': `You: ${p.points} points, ${p.cards.length} cards, ${held} of ${TOKEN_LIMIT} tokens. Show everything you hold.`,
      },
      el('span', { class: `seat seat--${p.index}`, 'aria-hidden': 'true', text: String(p.index + 1) }),
      // No name any more. The rail is always yours — it does not follow the
      // seat in play — so the label it used to need to disown a bot's tokens
      // is one fewer thing on the narrowest row in the app.
      el('span', { class: 'you-pts', 'aria-hidden': 'true', text: String(p.points) }),
    ),
  );

  // One chip per colour carrying BOTH numbers — see holdingChip(). Six chips
  // where there used to be six tokens, six token numbers and up to five
  // discount badges.
  const chips = el('div', { class: 'you-chips', role: 'group', 'aria-label': 'What you hold: tokens and card discounts' });
  for (const t of TOKENS) chips.append(holdingChip(p, t, 28, `you:${t}`));
  rail.append(chips);

  if (p.reserved.length) {
    const held2 = el('div', { class: 'you-reserved', role: 'group', 'aria-label': `Your reserved cards, ${p.reserved.length} of ${MAX_RESERVED}` });
    for (const id of p.reserved) {
      const c = id ? ctx.card(id) : null;
      if (c) held2.append(cardTile(c, ctx, { fromReserve: true, mini: true }));
    }
    rail.append(held2);
  }
  return rail;
}

/**
 * THE ACTION BAR. One bar, docked in the thumb zone, that switches on what is
 * currently selected — resources from the bank, a card, or a deck. It is why the
 * card tiles have no buttons of their own: two taps either way, and the board
 * stays visible while you act instead of being covered by a sheet.
 */
function actionBar(ctx) {
  const { ui, state } = ctx;
  const picked = ui.picked;

  if (picked && picked.kind === 'card') {
    const card = ctx.card(picked.id);
    if (card) return cardActions(ctx, card, !!picked.fromReserve);
  }
  if (picked && picked.kind === 'deck') {
    const tier = picked.tier;
    const count = state.decks[tier].length;
    return [
      el(
        'div',
        { class: 'bar-text' },
        el('span', { class: 'bar-title', text: `${DECK_LABEL[tier]}` }),
        el('span', { class: 'bar-sub', text: `${count} card${count === 1 ? '' : 's'} left — nobody else sees it` }),
      ),
      el(
        'div',
        { class: 'bar-actions' },
        actionButton({
          label: 'Blind reserve',
          act: 'reserve-deck',
          ok: ctx.deckTiers.has(tier),
          reason: !ctx.interactive
            ? ctx.blockedReason
            : count === 0
              ? 'That deck is empty'
              : ctx.reservedFull
                ? `${MAX_RESERVED} reserved already`
                : 'Cannot reserve from that deck',
          data: { 'data-tier': String(tier) },
          fk: 'act-blind',
          aria: `Blind reserve the top ${DECK_LABEL_ONE[tier]}`,
          cls: 'btn--primary',
        }),
        clearButton('Deselect the deck'),
      ),
    ];
  }
  return takeActions(ctx);
}

/**
 * Buy / Reserve for the selected card, with what it costs you.
 *
 * NO SHORTFALL LINE. This bar used to carry a "SHORT" readout under the cost —
 * the gap between the card's price and your tokens, as a second row of pips.
 * It was the widest element on the narrowest bar in the app, it pushed the bar
 * to three lines whenever a four-colour card was selected, and it was doing
 * subtraction the player can already see: the cost pips are right here and
 * their own tokens are in the rail immediately above.
 *
 * Buy is still disabled for exactly the same reason it always was — the move
 * is not in legalMoves() — and the reason is still spelled out in words on the
 * button's aria-label, its title, and the toast a tap on it raises. What went
 * away is the picture, not the explanation.
 */
function cardActions(ctx, card, fromReserve) {
  const { state, you: p } = ctx;
  const short = shortfallText(card, state, HUMAN_SEAT);
  const canBuy = ctx.buyKeys.has(`${card.id}|${fromReserve}`);
  const canReserve = !fromReserve && ctx.reserveIds.has(card.id);

  return [
    el(
      'div',
      { class: 'bar-text bar-text--card' },
      el(
        'span',
        { class: 'bar-title' },
        tokenIcon(card.resource, 22),
        el('b', { text: card.points ? `${card.points} pt${card.points === 1 ? '' : 's'}` : 'no points' }),
      ),
      costColumn(card, state, HUMAN_SEAT),
      sr(short || 'You can pay for this card.'),
    ),
    el(
      'div',
      { class: 'bar-actions' },
      actionButton({
        label: 'Buy',
        act: 'buy',
        ok: canBuy,
        reason: !ctx.interactive ? ctx.blockedReason : short || 'You cannot buy that card',
        data: { 'data-card': card.id, 'data-reserve': fromReserve ? '1' : '0' },
        fk: 'act-buy',
        aria: `Buy this ${TOKEN_LABEL[card.resource]} card`,
        cls: 'btn--primary',
      }),
      fromReserve
        ? null
        : actionButton({
            label: 'Reserve',
            act: 'reserve-card',
            ok: canReserve,
            reason: !ctx.interactive
              ? ctx.blockedReason
              : ctx.reservedFull
                ? `${p.reserved.length} reserved already`
                : 'You cannot reserve that card',
            data: { 'data-card': card.id },
            fk: 'act-reserve',
            aria: `Reserve this ${TOKEN_LABEL[card.resource]} card`,
          }),
      clearButton('Deselect the card'),
    ),
  ];
}

/** Resource-taking: the default state of the bar. */
function takeActions(ctx) {
  const { ui } = ctx;
  const chosen = pick.complete(ui.sel, ctx.takes);
  const chips = el('div', { class: 'sel-chips' });
  for (const g of pick.chips(ui.sel)) {
    chips.append(el('span', { class: `sel-chip sel-chip--${g}` }, tokenIcon(g, 15), sr(`${TOKEN_LABEL[g]} selected. `)));
  }
  return [
    el(
      'div',
      { class: 'bar-text' },
      chips,
      el('span', {
        class: `bar-sub${chosen ? ' is-ok' : ''}`,
        text: ctx.interactive ? pick.describe(ui.sel, ctx.takes) : ctx.blockedReason,
      }),
    ),
    el(
      'div',
      { class: 'bar-actions' },
      actionButton({
        label: 'Take',
        act: 'confirm-take',
        ok: !!chosen && ctx.interactive,
        reason: !ctx.interactive
          ? ctx.blockedReason
          : ui.sel.length === 0
            ? 'Tap some resources first'
            : 'Not a complete take yet',
        data: {},
        fk: 'confirm-take',
        aria: 'Take the selected resources',
        cls: 'btn--primary',
      }),
      passButton(ctx),
      clearButton('Clear the resource selection'),
    ),
  ];
}

/** The one control that empties whatever is currently selected. */
function clearButton(aria) {
  return actionButton({
    label: '✕',
    act: 'clear-pick',
    ok: true,
    reason: '',
    data: {},
    fk: 'clear-pick',
    aria,
    cls: 'btn--ghost btn--icon',
  });
}

/* ------------------------------------------------------------------ */
/* The turn report                                                     */
/* ------------------------------------------------------------------ */

/**
 * WHAT JUST HAPPENED, AND WHERE IT LEFT THEM.
 *
 * Two lines. The first says who moved and what they did, in the same tokens
 * the board uses everywhere else. The second is that player's position after
 * the turn resolved completely — points, and one chip per colour carrying
 * their tokens and their card discounts, the same chip the rail uses for you.
 *
 * It stays until the next turn replaces it, INCLUDING through your own turn:
 * the last bot's move is what you are deciding against, so blanking it the
 * moment control comes back would throw away the reason you were waiting.
 *
 * In "press to continue" pacing it also carries the Next button that lets the
 * game go on. That button is the ONLY way to dismiss it — a tap anywhere else
 * would collide with the board, which is directly under the player's thumb.
 */
function turnReport(ctx) {
  // A SEAT NOBODY CAN MOVE ON TAKES THIS REGION. It is the more urgent news
  // and it is the same kind of news — what is happening with the turn — and
  // the alternative is the board simply stopping with nothing to explain it.
  if (ctx.ui.stalled) return stallNotice(ctx);
  const r = ctx.ui.report;
  if (!r) return null;
  const yours = r.actor === HUMAN_SEAT;
  const st = r.status;

  const did = el('span', { class: 'report-did' });
  for (const a of r.acts) appendAll(did, ...reportClause(a));
  for (const id of r.companies) {
    const n = ctx.company(id);
    did.append(el('span', { class: 'report-tag report-tag--company', text: n ? `company +${n.points}` : 'a company' }));
  }
  if (!r.acts.length && !r.companies.length) did.append(el('span', { class: 'report-verb', text: 'did nothing' }));

  const chips = el('div', { class: 'report-chips' });
  for (const t of TOKENS) chips.append(holdingChip(reportPlayer(r), t, 20));

  // The status line doubles as the way into the side-by-side comparison: the
  // rotation shows one seat at a time by design, and comparing two bots is a
  // different question. One tap target rather than another button in a row
  // that has no width to spare.
  const status = el(
    'button',
    {
      type: 'button',
      class: 'report-status',
      'data-act': 'open-sheet',
      'data-sheet': 'all',
      'data-fk': 'report-status',
      'aria-haspopup': 'dialog',
      'aria-label':
        `${yours ? 'You are' : `${r.name} is`} on ${st.points} point${st.points === 1 ? '' : 's'}, ` +
        `${st.cards} card${st.cards === 1 ? '' : 's'}, ${st.tokenTotal} token${st.tokenTotal === 1 ? '' : 's'}. ` +
        'Show every player side by side.',
    },
    el('span', { class: 'report-pts' }, String(st.points), el('span', { class: 'report-pts-unit', 'aria-hidden': 'true', text: 'pts' })),
    chips,
  );

  const body = el(
    'div',
    { class: 'report-body' },
    el(
      'p',
      { class: 'report-line' },
      el('span', { class: `seat seat--${r.actor}`, 'aria-hidden': 'true', text: String(r.actor + 1) }),
      el('span', { class: 'report-name', text: yours ? 'You' : r.name }),
      did,
    ),
    status,
  );

  const node = el('div', { class: `report-card${r.pending ? ' is-pending' : ''}` }, body);
  if (r.pending) {
    node.append(
      actionButton({
        label: 'Next',
        act: 'continue-turn',
        ok: true,
        reason: '',
        data: {},
        fk: 'report-next',
        aria: `Continue after ${yours ? 'your' : possessive(r.name)} turn`,
        cls: 'btn--primary report-next',
      }),
    );
  }
  return node;
}

/**
 * THE BOARD IS NOT ALLOWED TO JUST STOP.
 *
 * When the turn loop gives a seat up, the board is left with a player to act,
 * nobody acting, and nothing on screen that belongs to the human to press. It
 * is the worst state this game can be in and it used to be reported only to
 * the console, where a player on a phone will never see it.
 *
 * So it is reported HERE, in the region that carries the rest of the turn's
 * news, and it carries the recourse with it: one button that plays the stuck
 * seat's next legal move and lets the loop pick the game back up. The game is
 * not lost, and the player does not have to start a new one to find that out.
 */
function stallNotice(ctx) {
  const { seat, name } = ctx.ui.stalled;
  const yours = seat === HUMAN_SEAT;
  return el(
    'div',
    { class: 'report-card report-card--stalled', role: 'alert' },
    el(
      'div',
      { class: 'report-body' },
      el(
        'p',
        { class: 'report-line' },
        el('span', { class: `seat seat--${seat}`, 'aria-hidden': 'true', text: String(seat + 1) }),
        el('span', { class: 'report-name', text: yours ? 'You' : name }),
        el('span', { class: 'report-verb', text: 'could not take a turn' }),
      ),
      el('p', {
        class: 'report-note',
        text: 'The game is stopped here. Carry on plays this seat\u2019s next legal move.',
      }),
    ),
    actionButton({
      label: 'Carry on',
      act: 'skip-seat',
      ok: true,
      reason: '',
      data: {},
      fk: 'report-skip',
      aria: `Play ${yours ? 'your' : possessive(name)} next legal move and carry on`,
      cls: 'btn--primary report-next',
    }),
  );
}

/**
 * The report's own snapshot of the player, shaped like a Player so the shared
 * holdingChip() can draw it. It is a SNAPSHOT on purpose — the chips show
 * where the turn left them, not where they are three turns later.
 */
function reportPlayer(r) {
  return { tokens: r.status.tokens, bonuses: r.status.bonuses };
}

/** One thing that happened on the turn, as words plus tokens. */
function reportClause(a) {
  switch (a.kind) {
    case 'take':
      return [el('span', { class: 'report-verb', text: 'took' }), tokenRun(a.resources)];
    case 'buy':
      return [
        el('span', { class: 'report-verb', text: 'bought' }),
        cardTag(a.card),
        el('span', { class: 'report-verb', text: 'for' }),
        tokenRun(a.paid),
      ];
    case 'reserve':
      return a.blind
        ? [
            el('span', { class: 'report-verb', text: 'reserved' }),
            // NEVER the card. It was drawn without showing it, and holding an
            // unredacted state in the UI is not permission to look.
            el('span', { class: 'report-tag report-tag--blind', text: `tier ${a.tier}, unseen` }),
            ...(a.coin ? [tokenRun({ coin: 1 })] : []),
          ]
        : [
            el('span', { class: 'report-verb', text: 'reserved' }),
            cardTag(a.card),
            ...(a.coin ? [tokenRun({ coin: 1 })] : []),
          ];
    case 'discard':
      return [el('span', { class: 'report-verb', text: 'returned' }), tokenRun(a.resources)];
    case 'pass':
      return [el('span', { class: 'report-verb', text: 'passed' })];
    default:
      return [];
  }
}

/** A run of tokens with their counts on them, in registry order. */
function tokenRun(purse) {
  const run = el('span', { class: 'report-resources' });
  for (const t of TOKENS) {
    const n = purse[t] || 0;
    if (!n) continue;
    run.append(tokenIcon(t, 17, n), sr(`${n} ${TOKEN_LABEL[t]}. `));
  }
  return run;
}

/**
 * A bought or reserved card, as its bonus token and its point value. A card
 * worth nothing prints no number: "0pt" is a fact about most of the deck and
 * three characters of noise on the narrowest line in the app.
 */
function cardTag(card) {
  if (!card) return el('span', { class: 'report-tag', text: 'a card' });
  return el(
    'span',
    { class: 'report-tag' },
    tokenIcon(card.resource, 17),
    card.points ? el('b', { 'aria-hidden': 'true', text: `${card.points}pt` }) : null,
    sr(`${TOKEN_LABEL[card.resource]} card worth ${card.points} point${card.points === 1 ? '' : 's'}. `),
  );
}

function statusBar(ctx) {
  const { state } = ctx;
  const cur = state.players[state.current];
  // A report is waiting: the seat named here is the one that just moved, not
  // the one about to. Nothing is happening until the player says so.
  if (ctx.pending) {
    const who = ctx.state.players[ctx.spotlight];
    return [
      el('strong', { class: 'status-main' },
        el('span', { class: `seat seat--${who.index}`, 'aria-hidden': 'true', text: String(who.index + 1) }),
        who.index === HUMAN_SEAT ? 'You moved' : `${who.name} moved`),
      el('span', { class: 'status-hint', text: 'Take it in, then press Next.' }),
      el('span', { class: 'status-note', text: 'Costs shown with your card discounts' }),
    ];
  }
  if (state.phase === 'gameover') {
    // Through winnerLine, so a shared win reads "share it" rather than
    // "You & Ada & Boris wins", and so this line and the menu row agree.
    // THE WAY BACK TO THE STANDINGS, ON BOTH LAYOUTS. The phone has the menu
    // row as well, but the wide layout has no menu at all — so dismissing
    // there would put the result permanently out of reach. This line already
    // names the result and is present either way, so it carries it.
    const back = el(
      'button',
      {
        type: 'button',
        class: 'status-main status-main--btn',
        'data-act': 'show-standings',
        'data-fk': 'status-standings',
        'aria-haspopup': 'dialog',
        'aria-label': `Game over — ${winnerLine(state)}. Show the final standings.`,
      },
      `Game over — ${winnerLine(state)}`,
    );
    return ctx.ui.standingsDismissed
      ? [back]
      : [el('strong', { class: 'status-main', text: `Game over — ${winnerLine(state)}` })];
  }
  // "Your turn", or the bot's name. This line and the move log are how a bot's
  // turn is followed — the board itself is never reinterpreted around them.
  const who = !cur.isBot
    ? 'Your turn'
    : ctx.thinking === state.current
      ? `${cur.name} is thinking…`
      : `${possessive(cur.name)} turn`;
  const hint =
    state.phase === 'discard'
      ? `Over the ${TOKEN_LIMIT}-token limit — return the excess.`
      : state.phase === 'company'
        ? 'Two or more companies qualify — choose one.'
        : cur.isBot
          ? 'Watching the bot.'
          : 'Take resources, buy a card, or reserve one.';
  return [
    el('strong', { class: `status-main${cur.isBot ? ' is-bot' : ''}` },
      el('span', { class: `seat seat--${state.current}`, 'aria-hidden': 'true', text: String(state.current + 1) }),
      who),
    el('span', { class: 'status-hint', text: hint }),
    // Always yours, whoever is to act. That is the point of the fixed seat.
    el('span', { class: 'status-note', text: 'Costs shown with your card discounts' }),
  ];
}

/**
 * The bank keeps its DOM. Piles are the one control a player clicks several
 * times in a row, and swapping the node out from under a fast second click
 * loses it — so counts and states are patched in place instead.
 */
function renderBank(ctx) {
  const host = q('bank');
  let row = host.querySelector('.bank-row');
  if (!row || row.children.length !== TOKENS.length) {
    row = el('div', { class: 'bank-row', role: 'group', 'aria-label': 'The bank' });
    for (const t of TOKENS) row.append(pileEl(t, ctx));
    fill(host, row);
    return;
  }
  TOKENS.forEach((t, i) => updatePile(row.children[i], t, ctx));
}

function passButton(ctx) {
  const canPass = ctx.interactive && ctx.moves.some((m) => m.type === 'pass');
  if (!canPass) return null;
  return actionButton({
    label: 'Pass',
    act: 'pass',
    ok: true,
    reason: '',
    data: {},
    fk: 'pass',
    aria: 'Pass — no other move is possible',
    cls: 'btn--ghost',
  });
}

/* ------------------------------------------------------------------ */
/* Log                                                                 */
/* ------------------------------------------------------------------ */

/**
 * THE LOG SHOWS STONES, NOT NAMES.
 *
 * The engine logs raw token keys ("took <a>, <b>"). Those are code
 * identifiers, and no other surface in the game ever prints one — the board,
 * the rail and the turn report are all pips. A log that spoke in words was
 * the only place a player met a vocabulary the rest of the app never uses,
 * and swapping the keys for their display names only traded one unused
 * vocabulary for another.
 *
 * So a token in a log line becomes the same token the board draws, carrying
 * the same count: an explicit count rides on the token, a bare name is a
 * reading 1. The separator between two adjacent tokens goes with them,
 * because "◆, ●, ▪" is punctuation for words nobody is reading.
 *
 * THE NAMES STAY FOR A SCREEN READER. This list is the aria-live region that
 * narrates the bots' turns, so every pip carries its own sr-only "1 Indigo."
 * and the line is still a sentence when it is read aloud.
 *
 * Skipped entirely when a player has named themselves after a token, so no
 * name is ever mangled into a token.
 */
const TOKEN_WORD = new RegExp(`(?:(\\d+)\\s+)?\\b(${TOKENS.join('|')})\\b`, 'g');
const TOKEN_NAME_CLASH = new RegExp(`\\b(${TOKENS.join('|')})\\b`, 'i');

/** True when no player's name would be eaten by the substitution above. */
function tokensAreSafe(state) {
  return !state.players.some((p) => TOKEN_NAME_CLASH.test(p.name));
}

/** One log line, as a mix of text and tokens. */
function logLine(text, safe) {
  if (!safe) return [el('span', { class: 'log-text', text })];
  const out = [];
  let last = 0;
  let prevWasPip = false;
  for (const m of text.matchAll(TOKEN_WORD)) {
    let lead = text.slice(last, m.index);
    if (prevWasPip) lead = lead.replace(/^(,\s*|\s+and\s+)/, ' ');
    if (lead) out.push(el('span', { class: 'log-text', text: lead }));
    // Faithful to the sentence: an explicit count rides on the token, and a
    // bare name is a bare token. Printing a 1 the engine never said turns
    // "took ◆ ● ■" into "took ◆1 ●1 ■1", which is three numerals of noise.
    const count = m[1] ? Number(m[1]) : null;
    const token = m[2];
    out.push(tokenIcon(token, 15, count), sr(`${count ?? 1} ${TOKEN_LABEL[token]}. `));
    last = m.index + m[0].length;
    prevWasPip = true;
  }
  const tail = text.slice(last);
  if (tail) out.push(el('span', { class: 'log-text', text: tail }));
  return out.length ? out : [el('span', { class: 'log-text', text })];
}

function renderLog(ui) {
  const node = q('log');
  const log = ui.state.log;
  const safe = tokensAreSafe(ui.state);
  if (ui.logKey !== ui.gameKey || ui.logLen > log.length) {
    node.replaceChildren();
    ui.logLen = 0;
    ui.logKey = ui.gameKey;
  }
  for (let i = ui.logLen; i < log.length; i++) {
    const e = log[i];
    node.append(
      el(
        'li',
        { class: 'log-item' },
        el('span', { class: 'log-round', 'aria-hidden': 'true', text: `R${e.round}` }),
        el('span', { class: `dot seat--${e.player}`, 'aria-hidden': 'true' }),
        ...logLine(e.text, safe),
      ),
    );
  }
  ui.logLen = log.length;
  node.scrollTop = node.scrollHeight;
}

/* ------------------------------------------------------------------ */
/* Sheets — the phone's "behind a tap" drawer                          */
/* ------------------------------------------------------------------ */

/**
 * One bottom sheet, three contents: the game menu (the controls that are not
 * per-turn), the move log, and a player's full holdings. Everything the wide
 * layout keeps permanently on screen in the side column lives here on a phone,
 * which is what buys the card grid its space.
 *
 * The sheet is rebuilt on every render so it always shows live state, and
 * focus is moved into it only when it first opens — not on every repaint.
 */
let sheetKey = null;

/**
 * Floating layers that live above the board. They are rendered from
 * renderGame, so leaving the game screen has to close them explicitly —
 * see renderAll.
 */
const TRANSIENT_LAYERS = ['overlay', 'sheet', 'beat'];

/**
 * THE BEAT — the bots' turns, in front of the board instead of beside it.
 *
 * The report used to hold a permanent strip of the board's height on a phone
 * to say something that is only true BETWEEN turns. Here it costs nothing when
 * nobody is moving, and the blurred backdrop states the thing the disabled
 * controls previously had to explain in words: this is not yours to touch yet.
 *
 * IT OPENS ONCE AND CLOSES ONCE PER RUN OF BOTS — whatever the pacing, and
 * however many bots are at the table. Every bot's report rotates through this
 * SAME popup: the content changes, the backdrop does not. Three bots must not
 * mean three full-screen blurs blinking in and out a round. That is a
 * photosensitivity hazard before it is a taste question, and it is why nothing
 * in here moves once it is up.
 *
 * A stall holds it open too — `ui.loopActive` is already false by then, and a
 * seat nobody can move on is exactly when the player must not be left with a
 * blurred board and no way through it.
 */
let beatWasOpen = false;

function renderBeat(ui, ctx) {
  const root = q('beat');
  // The wide layout keeps its inline report: it has the room, and a modal over
  // a wide board would be a worse trade than the one this makes on a phone.
  const pendingFinal = !!(ui.report && ui.report.pending);
  const open =
    (ui.loopActive || !!ui.stalled) &&
    // The winning turn is read BEFORE the standings, so the popup holds while
    // that last report is still waiting on a press. renderOverlay is gated on
    // the same condition from the other side.
    (ctx.state.phase !== 'gameover' || pendingFinal);

  if (!open) {
    root.hidden = true;
    root.replaceChildren();
    beatWasOpen = false;
    return;
  }

  root.hidden = false;

  // THE BACKDROP IS BUILT ONCE AND LEFT ALONE. Re-filling the whole layer on
  // every render would re-insert it, and re-inserting it restarts its fade —
  // so the blur would pulse on every repaint of every bot's turn instead of
  // arriving once. Only the contents are replaced from here on.
  //
  // The missing-live-region half of the test is a self-heal, not a formality:
  // if anything ever empties this layer without clearing the flag, skipping
  // the rebuild would paint a blurred, blocking board with nothing in front of
  // it and nothing to press. Rebuilding costs one blink; not rebuilding costs
  // the game.
  const fresh = !beatWasOpen || !root.querySelector('.beat-live');
  if (fresh) {
    beatWasOpen = true;
    fill(root, beatBackdrop());
  }

  const live = root.querySelector('.beat-live');
  if (live) fill(live, beatBody(ui, ctx));

  // FILL FIRST, THEN FOCUS. A dialog focused while it is still empty is a
  // dialog a screen reader may announce as empty: contents are read from what
  // is there at the moment focus lands, and the live region below only covers
  // the turns AFTER this one, which are real mutations of a region that is by
  // then established. Focusing last is what makes the first turn of a round
  // audible.
  if (fresh) {
    const panel = root.querySelector('.beat-panel');
    if (panel) {
      try {
        panel.focus({ preventScroll: true });
      } catch {
        /* focus is best-effort */
      }
    }
  }
}

function beatBackdrop() {
  // A tap anywhere is the press, which is only safe because the backdrop is
  // covering the board — the reason the inline report needed its Next button
  // to be the one and only way through. Controls inside carry their own
  // data-act and win the closest() lookup, so Carry on still means Carry on.
  return el(
    'div',
    { class: 'beat-backdrop', 'data-act': 'continue-turn', 'data-fk': 'beat-backdrop' },
    el(
      'div',
      {
        class: 'beat-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'The turns being taken',
        tabindex: '-1',
      },
      // The live region moves in here with the card. #report is empty on a
      // phone, so only one of the two ever speaks.
      el('div', { class: 'beat-live', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }),
    ),
  );
}

/**
 * What the popup is showing right now: a seat mid-move, or the turn it just
 * finished. turnReport() already yields to the stall notice when there is one.
 */
function beatBody(ui, ctx) {
  if (!ui.stalled && ui.thinking !== null && ui.thinking !== undefined) {
    return thinkingCard(ctx, ui.thinking);
  }
  return turnReport(ctx);
}

/**
 * A seat that is mid-move. Deliberately the same card as a report, and
 * deliberately still: a pulsing indicator here would be the repeated change
 * this popup exists to avoid, several times a round.
 */
function thinkingCard(ctx, seat) {
  const p = ctx.state.players[seat];
  if (!p) return null;
  return el(
    'div',
    { class: 'report-card report-card--thinking' },
    el(
      'div',
      { class: 'report-body' },
      el(
        'p',
        { class: 'report-line' },
        el('span', { class: `seat seat--${seat}`, 'aria-hidden': 'true', text: String(seat + 1) }),
        el('span', { class: 'report-name', text: seat === HUMAN_SEAT ? 'You' : p.name }),
        el('span', { class: 'report-verb', text: 'is taking their turn' }),
      ),
    ),
  );
}

function renderSheet(ui, ctx) {
  const root = q('sheet');
  // A sheet never competes with a modal. If a tray or a company choice came up
  // while one was open — a bot's move can do that — the sheet gets out of the
  // way rather than covering the panel that needs an answer.
  //
  // 'gameover' used to be in that list, which meant the menu could not be
  // opened at all once somebody had won: no New game, no move log, no way to
  // look back at the game you just finished. It is only a modal phase while
  // the standings are actually up, and those can now be dismissed.
  const modal =
    ctx.state.phase === 'discard' ||
    ctx.state.phase === 'company' ||
    (ctx.state.phase === 'gameover' && !ui.standingsDismissed);
  const open = modal ? null : ui.sheet;
  if (!open) {
    root.hidden = true;
    root.replaceChildren();
    sheetKey = null;
    return;
  }
  const key = `${open.kind}:${open.id ?? ''}`;
  const body =
    open.kind === 'menu'
      ? menuSheet(ui, ctx)
      : open.kind === 'howto'
        ? howToSheet()
        : open.kind === 'confirm-new'
          ? confirmNewSheet(ctx)
        : open.kind === 'log'
          ? logSheet(ui)
          : open.kind === 'all'
            ? allPlayersSheet(ctx)
            : playerSheet(ui, ctx, Number(open.id));

  root.hidden = false;
  fill(root, body);
  if (sheetKey !== key) {
    sheetKey = key;
    const panel = root.querySelector('.sheet-panel');
    if (panel) {
      try {
        panel.focus({ preventScroll: true });
      } catch {
        /* focus is best-effort */
      }
    }
  }
}

/**
 * Enough of the game to RECOGNISE it, in one line.
 *
 * Split out because the interesting cases are all ties, and a nested ternary
 * got one of them wrong: reducing to a single "leader" picks the first seat on
 * a tie, so a board where nobody had scored told the human they held the lead.
 * Nought-all is the most likely state for a mis-tap to happen in — it is the
 * opening of every game — so it is the one case that had to be right.
 */
function whereYouAre(s, you, best, leaders) {
  const round = `Round ${s.round} · `;
  if (best === 0) return `${round}no points scored yet.`;
  const yours = `you have ${you.points} point${you.points === 1 ? '' : 's'}`;
  if (you.points === best) {
    return leaders.length === 1
      ? `${round}${yours} and the lead.`
      : `${round}${yours}, tied for the lead.`;
  }
  const who = leaders.length === 1 ? leaders[0].name : `${leaders.length} players`;
  return `${round}${yours}, ${who} ${leaders.length === 1 ? 'leads' : 'lead'} on ${best}.`;
}

/**
 * "THIS WILL THROW AWAY THE GAME YOU ARE PLAYING."
 *
 * New game used to be one tap from the menu with nothing in between, sitting
 * directly under the pacing controls people open that menu to change. One
 * mis-tap discarded a game with no undo and no warning — and now that games
 * survive being closed, that tap is the ONLY way left to lose one by accident.
 *
 * It names where the game actually is, because "are you sure" answers nothing:
 * someone who mis-tapped needs to recognise the game, and round and points are
 * what identify it. The destructive option is not the default and is not
 * placed where the finger already was.
 */
function confirmNewSheet(ctx) {
  const s = ctx.state;
  const you = ctx.you;
  const best = Math.max(...s.players.map((p) => p.points));
  const leaders = s.players.filter((p) => p.points === best);
  return sheetPanel(
    'Start a new game?',
    el('p', {
      class: 'rules-lede',
      text: 'The game you are playing will be discarded. There is no way back to it.',
    }),
    el('p', { class: 'confirm-where', text: whereYouAre(s, you, best, leaders) }),
    el(
      'div',
      { class: 'confirm-actions' },
      actionButton({
        label: 'Keep playing',
        act: 'close-sheet',
        ok: true,
        reason: '',
        data: {},
        fk: 'confirm-keep',
        aria: 'Close this and carry on with the current game',
        cls: 'btn--primary btn--big btn--wide',
      }),
      actionButton({
        label: 'Discard and start new',
        act: 'new-setup',
        ok: true,
        reason: '',
        data: {},
        fk: 'confirm-discard',
        aria: 'Discard the current game and go back to setup',
        cls: 'btn--big btn--wide btn--danger',
      }),
    ),
  );
}

function sheetPanel(title, ...kids) {
  return el(
    'div',
    { class: 'sheet-backdrop', 'data-act': 'close-sheet', 'data-fk': 'sheet-backdrop' },
    el(
      'div',
      { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      el(
        'div',
        { class: 'sheet-head' },
        el('h2', { class: 'sheet-title', text: title }),
        actionButton({
          label: 'Close',
          act: 'close-sheet',
          ok: true,
          reason: '',
          data: {},
          fk: 'sheet-close',
          aria: 'Close',
          cls: 'btn--ghost',
        }),
      ),
      el('div', { class: 'sheet-body' }, ...kids),
    ),
  );
}

function menuSheet(ui, ctx) {
  const { state } = ctx;
  return sheetPanel(
    'Game',
    el('p', { class: 'sheet-meta', text: `Round ${state.round} · seed ${state.seed}${state.finalRound ? ' · final round' : ''}` }),
    el(
      'div',
      { class: 'sheet-list' },
      el(
        'button',
        {
          type: 'button',
          class: 'sheet-item',
          'data-act': 'cycle-pace',
          'data-fk': 'menu-pace',
          'aria-label': `Turn pacing: ${PACE_LABEL[ui.pace]}. Tap to change.`,
        },
        el('span', { class: 'sheet-item-label', text: 'Turn pacing' }),
        el('span', { class: 'sheet-item-value', text: PACE_LABEL[ui.pace] }),
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'sheet-item',
          'data-act': 'open-sheet',
          'data-sheet': 'howto',
          'data-fk': 'menu-howto',
        },
        el('span', { class: 'sheet-item-label', text: 'How to play' }),
        el('span', { class: 'sheet-item-value', text: 'The whole game, one screen' }),
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'sheet-item',
          'data-act': 'open-sheet',
          'data-sheet': 'all',
          'data-fk': 'menu-all',
          'aria-haspopup': 'dialog',
        },
        el('span', { class: 'sheet-item-label', text: 'All players' }),
        el('span', { class: 'sheet-item-value', text: 'Compare everyone' }),
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'sheet-item',
          'data-act': 'open-sheet',
          'data-sheet': 'log',
          'data-fk': 'menu-log',
          'aria-haspopup': 'dialog',
        },
        el('span', { class: 'sheet-item-label', text: 'Move log' }),
        el('span', { class: 'sheet-item-value', text: `${state.log.length} move${state.log.length === 1 ? '' : 's'}` }),
      ),
      installAvailable()
        ? el(
            'button',
            { type: 'button', class: 'sheet-item', 'data-act': 'install', 'data-fk': 'menu-install' },
            el('span', { class: 'sheet-item-label', text: 'Install app' }),
            el('span', { class: 'sheet-item-value', text: 'Add to home screen' }),
          )
        : null,
      // Only once there is a result to go back to. Dismissing the standings
      // must not be the same as losing them.
      state.phase === 'gameover'
        ? el(
            'button',
            { type: 'button', class: 'sheet-item', 'data-act': 'show-standings', 'data-fk': 'menu-standings' },
            el('span', { class: 'sheet-item-label', text: 'Final standings' }),
            el('span', { class: 'sheet-item-value', text: winnerLine(state) }),
          )
        : null,
      el(
        'button',
        { type: 'button', class: 'sheet-item sheet-item--danger', 'data-act': 'confirm-new', 'data-fk': 'menu-new' },
        el('span', { class: 'sheet-item-label', text: 'New game' }),
        el('span', { class: 'sheet-item-value', text: 'Back to setup' }),
      ),
    ),
  );
}

/**
 * A read-only replay of the log. The live region that narrates moves as they
 * happen is the clipped #log in the side column — this is the visible copy,
 * newest first, built only while the sheet is open.
 */
/**
 * HOW TO PLAY — the whole game on one screen.
 *
 * There was nothing. The setup screen named the win condition and that was the
 * entire explanation, which is fine for the person who wrote it and useless to
 * anyone else. This is a rules SHEET rather than a walkthrough on purpose: the
 * game is four actions and one win condition, it fits on a screen, and a
 * scripted tutorial is a large thing to build and a larger thing to keep true
 * as the UI moves. If people still bounce, that is when a tutorial earns its
 * cost.
 *
 * Written in the game's own words — resources, caravans, warehouses, routes,
 * companies — so nothing here needs translating back to what is on screen.
 */
function ruleLine(title, body) {
  return el(
    'div',
    { class: 'rule' },
    el('h3', { class: 'rule-title', text: title }),
    el('p', { class: 'rule-body', text: body }),
  );
}

function howToSheet() {
  const list = el('div', { class: 'rules' });
  list.append(
    el('p', {
      class: 'rules-lede',
      text: `You are a merchant on the spice road. Take goods, spend them on holdings, `
        + `and let the holdings pay for the next ones. First to ${WIN_POINTS} points `
        + `triggers a final round, and everyone finishes on the same number of turns.`,
    }),
    el('h3', { class: 'rules-head', text: 'On your turn, do exactly one thing' }),
    ruleLine('Take 3 different goods', 'One each of three different piles. Tap them, then Take.'),
    ruleLine('Take 2 of one good', 'Only from a pile holding 4 or more. Tap the same pile twice.'),
    ruleLine(
      'Buy a holding',
      'Tap a card, then Buy. You pay the cost shown on it, minus what your own holdings '
        + 'already produce. Coins are wild and cover anything.',
    ),
    ruleLine(
      'Reserve a holding',
      'Tap a card or a deck, then Reserve. It goes to your hand for later and you take a '
        + 'coin. Three reserved at most, and nobody else can buy what you hold.',
    ),
    el('h3', { class: 'rules-head', text: 'What the holdings do' }),
    ruleLine(
      'Every card you buy produces one good, for ever',
      'That production is a permanent discount on everything you buy afterwards — which '
        + 'is why the cost printed on a card is not always what you pay. Buy enough and '
        + 'the expensive cards start costing nothing.',
    ),
    ruleLine(
      'Caravans, Warehouses, Routes',
      'The same idea at three prices. Caravans are cheap and rarely score; Routes are '
        + 'expensive and carry the points. You climb from one to the next.',
    ),
    ruleLine(
      'Companies sign with you on their own',
      'Each wants a number of holdings producing particular goods. The moment you have '
        + 'them it signs, and it is worth 3 points. You never spend anything on one.',
    ),
    el('h3', { class: 'rules-head', text: 'The two rules that catch people' }),
    ruleLine('Ten tokens is the limit', 'End your turn over ten and you hand the extras back.'),
    ruleLine(
      'The last round is a full round',
      `Reaching ${WIN_POINTS} does not end the game. Play continues to the end of the round `
        + 'so everyone has had the same number of turns, and the most points then wins — '
        + 'ties broken by who bought fewer cards.',
    ),
  );
  return sheetPanel('How to play', list);
}

function logSheet(ui) {
  const log = ui.state.log;
  const safe = tokensAreSafe(ui.state);
  const list = el('ol', { class: 'log log--sheet' });
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    list.append(
      el(
        'li',
        { class: 'log-item' },
        el('span', { class: 'log-round', 'aria-hidden': 'true', text: `R${e.round}` }),
        el('span', { class: `dot seat--${e.player}`, 'aria-hidden': 'true' }),
        ...logLine(e.text, safe),
      ),
    );
  }
  if (!log.length) list.append(el('li', { class: 'empty', text: 'Nothing has happened yet.' }));
  return sheetPanel('Move log', list);
}

/**
 * EVERY PLAYER, SIDE BY SIDE. The turn report rotates — it shows you one
 * seat at the moment that seat changed — which is the right thing for
 * following the game and the wrong thing for comparing two bots to each
 * other. This is where that comparison lives, on a tap, rather than being
 * three permanent strips the one-screen layout has no room for.
 */
function allPlayersSheet(ctx) {
  return sheetPanel(
    'All players',
    el('div', { class: 'sheet-players' }, ctx.state.players.map((p) => playerPanel(p, ctx))),
  );
}

function playerSheet(ui, ctx, index) {
  const player = ctx.state.players[index];
  if (!player) return sheetPanel('Player', el('p', { class: 'empty', text: 'No such player.' }));
  return sheetPanel(
    player.index === HUMAN_SEAT ? 'You' : player.name,
    playerPanel(player, ctx),
  );
}

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */

/**
 * The two panels that ask the player a question — return tokens, pick a company
 * — belong to the human seat and to nothing else. A bot resolves both inside
 * its own turn, so the guard is `it is your turn`, not `the seat to act is not
 * a bot`: with one human at the table those were the same sentence, and only
 * one of them stays true if that ever changes.
 */
function renderOverlay(ui, ctx) {
  const root = q('overlay');
  const state = ui.state;
  const yours = humanToAct(state);

  // The last turn's report comes FIRST, even when that turn ended the game:
  // seeing what caused the win before being shown the win is the right order,
  // and the standings are one press away.
  if (state.phase === 'gameover' && !(ui.report && ui.report.pending)) {
    // THE STANDINGS ARE THE ONE PANEL HERE YOU DO NOT OWE AN ANSWER TO, so
    // they are the one that can be put away. A finished board is worth
    // looking at — whose engine beat you, which company went where — and this
    // used to cover all of it with no way past but starting another game.
    // The discard tray and the company choice below stay undismissable: those
    // are questions, and the turn does not continue without them.
    if (ui.standingsDismissed) {
      root.hidden = true;
      root.removeAttribute('data-act');
      root.replaceChildren();
      return;
    }
    root.hidden = false;
    // The scrim IS this element, so it carries the dismissal. close-standings
    // ignores anything that merely bubbled out of the panel.
    root.setAttribute('data-act', 'close-standings');
    root.setAttribute('data-fk', 'standings-scrim');
    fill(root, gameOverPanel(ctx));
    return;
  }
  root.removeAttribute('data-act');
  root.removeAttribute('data-fk');
  if (state.phase === 'discard' && yours) {
    root.hidden = false;
    fill(root, discardPanel(ui, ctx));
    return;
  }
  if (state.phase === 'company' && yours) {
    root.hidden = false;
    fill(root, companyPanel(ctx));
    return;
  }
  root.hidden = true;
  root.replaceChildren();
}

function discardPanel(ui, ctx) {
  const p = ctx.you;
  const held = total(p.tokens);
  const excess = held - TOKEN_LIMIT;
  const returning = ui.discard;
  const chosen = total(returning);
  const left = excess - chosen;

  const keep = el('div', { class: 'chips chips--big' });
  for (const t of TOKENS) {
    const avail = (p.tokens[t] || 0) - (returning[t] || 0);
    if ((p.tokens[t] || 0) === 0) continue;
    keep.append(
      el(
        'button',
        {
          type: 'button',
          class: `chip chip--btn${avail === 0 ? ' is-zero' : ''}`,
          'data-act': 'discard-add',
          'data-token': t,
          'data-fk': `dis+:${t}`,
          'data-reason': avail === 0 ? `No ${TOKEN_LABEL[t]} left to return` : 'Nothing more to return',
          'aria-disabled': avail === 0 || left <= 0 ? 'true' : null,
          'aria-label': `Return one ${TOKEN_LABEL[t]}, ${avail} available`,
        },
        tokenIcon(t, 30, avail),
      ),
    );
  }

  const tray = el('div', { class: 'chips chips--big tray' });
  let anyBack = false;
  for (const t of TOKENS) {
    const n = returning[t] || 0;
    if (!n) continue;
    anyBack = true;
    tray.append(
      el(
        'button',
        {
          type: 'button',
          class: 'chip chip--btn chip--tray',
          'data-act': 'discard-undo',
          'data-token': t,
          'data-fk': `dis-:${t}`,
          'aria-label': `Keep one ${TOKEN_LABEL[t]} instead, ${n} queued to return`,
        },
        tokenIcon(t, 30, n),
      ),
    );
  }
  if (!anyBack) tray.append(el('span', { class: 'empty', text: 'nothing selected yet' }));

  return el(
    'div',
    { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Return tokens' },
    el('h2', { text: 'Over the token limit' }),
    el('p', {
      class: 'panel-sub',
      // The panel only ever opens for a human at this device, so it is always
      // "you" — "You is holding" was the same bug as "You's turn".
      text: `You are holding ${held} tokens. Return ${excess} to get back to ${TOKEN_LIMIT}.`,
    }),
    el('h3', { class: 'panel-h3', text: 'Your tokens — pick one to return' }),
    keep,
    el('h3', { class: 'panel-h3', text: 'Returning — pick one to take back' }),
    tray,
    el(
      'div',
      { class: 'panel-actions' },
      actionButton({
        label: left === 0 ? 'Return tokens' : `Return ${left} more`,
        act: 'confirm-discard',
        ok: left === 0,
        reason: left > 0 ? `Choose ${left} more token${left === 1 ? '' : 's'} to return` : 'Too many selected',
        data: {},
        fk: 'confirm-discard',
        aria: 'Confirm returning the selected tokens',
        cls: 'btn--primary btn--big',
      }),
      actionButton({
        label: 'Reset',
        act: 'discard-reset',
        ok: chosen > 0,
        reason: 'Nothing selected',
        data: {},
        fk: 'discard-reset',
        aria: 'Clear the return selection',
        cls: 'btn--ghost',
      }),
    ),
  );
}

function companyPanel(ctx) {
  const row = el('div', { class: 'company-row' });
  for (const id of ctx.state.companyChoices) {
    const n = ctx.company(id);
    if (n) row.append(companyEl(n, ctx, { choose: true }));
  }
  return el(
    'div',
    { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose a company' },
    el('h2', { text: 'Two companies want to visit' }),
    el('p', { class: 'panel-sub', text: 'You may take one this turn. Pick which.' }),
    el('div', { class: 'scroller' }, row),
  );
}

/** "Boris wins" / "Ada & Boris share it" — the one-line result. */
function winnerLine(state) {
  const names = state.winners.map((i) => (i === HUMAN_SEAT ? 'You' : state.players[i].name));
  if (!names.length) return 'Game over';
  if (names.length > 1) return `${names.join(' & ')} share it`;
  return names[0] === 'You' ? 'You win' : `${names[0]} wins`;
}

function gameOverPanel(ctx) {
  const { state } = ctx;
  const rows = finalScores(state);
  const table = el('table', { class: 'scores' });
  table.append(
    el(
      'thead',
      null,
      el('tr', null,
        el('th', { scope: 'col', text: '#' }),
        el('th', { scope: 'col', text: 'Player' }),
        el('th', { scope: 'col', text: 'Points' }),
        el('th', { scope: 'col', text: 'Cards' }),
        el('th', { scope: 'col', text: 'Companies' })),
    ),
  );
  const body = el('tbody');
  for (const r of rows) {
    const p = state.players[r.index];
    body.append(
      el('tr', { class: r.rank === 1 ? 'is-winner' : '' },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null,
          el('span', { class: `seat seat--${r.index}`, 'aria-hidden': 'true', text: String(r.index + 1) }),
          p.name,
          p.isBot ? el('span', { class: 'player-kind', text: ` bot · ${p.botLevel || 'normal'}` }) : null),
        el('td', { class: 'num', text: String(r.points) }),
        el('td', { class: 'num', text: String(r.cardCount) }),
        el('td', { class: 'num', text: String(p.companies.length) })),
    );
  }
  table.append(body);

  const names = state.winners.map((i) => state.players[i].name).join(' & ');
  return el(
    'div',
    { class: 'panel panel--wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Final standings' },
    el('h2', { text: state.winners.length > 1 ? `${names} share the win` : `${names} wins` }),
    el('p', { class: 'panel-sub', text: 'Most points. Ties are broken by the fewest holdings bought.' }),
    table,
    el(
      'div',
      { class: 'panel-actions' },
      actionButton({
        label: 'Play again',
        act: 'play-again',
        ok: true,
        reason: '',
        data: {},
        fk: 'play-again',
        aria: 'Play again with the same seats and a new seed',
        cls: 'btn--primary btn--big',
      }),
      actionButton({
        label: 'New setup',
        act: 'new-setup',
        ok: true,
        reason: '',
        data: {},
        fk: 'new-setup',
        aria: 'Go back to the setup screen',
        cls: 'btn--ghost btn--big',
      }),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Update bar                                                          */
/* ------------------------------------------------------------------ */

/**
 * "There is a newer build, and it is already downloaded."
 *
 * A bar rather than a toast because a toast is gone in three seconds and this
 * has to survive a turn — and a bar rather than a modal because the player is
 * mid-game and owes this nothing. Reload takes it; Later dismisses the bar and
 * leaves the new code to load itself the next time the app opens.
 */
function renderUpdateBar(ui) {
  const root = q('update');
  if (!root) return;
  if (!ui.updateReady) {
    root.hidden = true;
    root.replaceChildren();
    return;
  }
  root.hidden = false;
  fill(
    root,
    el(
      'div',
      { class: 'updatebar-inner', role: 'status' },
      el('span', { class: 'updatebar-text', text: 'A new version is ready.' }),
      el(
        'button',
        { type: 'button', class: 'btn btn--primary btn--small', 'data-act': 'apply-update', 'data-fk': 'update-reload' },
        'Reload',
      ),
      el(
        'button',
        { type: 'button', class: 'btn btn--ghost btn--small', 'data-act': 'dismiss-update', 'data-fk': 'update-later' },
        'Later',
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

let toastTimer = null;

export function showToast(message) {
  const node = q('toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  node.classList.add('is-on');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove('is-on');
    toastTimer = setTimeout(() => {
      node.hidden = true;
      node.textContent = '';
    }, 220);
  }, 2600);
}

/** Exported so app.js can keep its own copy of the resource order for shortcuts. */
export const RESOURCE_ORDER = RESOURCES.slice();
