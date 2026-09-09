/**
 * Presentational builders. Everything here returns detached DOM nodes and
 * never touches game state — it only reads it.
 *
 * Colour-blind policy: a resource's colour is NEVER the only cue. Every resource is a
 * different SHAPE with a deliberately different outline — including one that
 * is line art rather than a solid — plus an accessible name from TOKEN_LABEL
 * on every control. The shapes themselves live in src/ui/tokens.js; nothing
 * outside that file and the registry should need to know what they are.
 */
import { RESOURCES, TOKEN_LABEL, TOKENS, DECK_LABEL, DECK_LABEL_ONE } from '../contract.js';
import { affordability } from '../engine.js';
import { tokenSilhouetteMarkup, tokenSvgMarkup } from './tokens.js';
import { HUMAN_SEAT } from './seat.js';

/* ------------------------------------------------------------------ */
/* Tiny DOM helper                                                     */
/* ------------------------------------------------------------------ */

/**
 * Build an element. `props.text` sets textContent, `props.html` sets
 * innerHTML (only ever used with literal strings defined in this file).
 * Falsy-but-meaningful values (0, '') are kept; null/undefined/false skipped.
 */
export function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const v = props[key];
      if (v === null || v === undefined || v === false) continue;
      if (key === 'class') node.className = v;
      else if (key === 'text') node.textContent = String(v);
      else if (key === 'html') node.innerHTML = v;
      else node.setAttribute(key, v === true ? '' : String(v));
    }
  }
  add(node, kids);
  return node;
}

function add(node, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(node, k);
    else if (typeof k === 'string' || typeof k === 'number') node.append(String(k));
    else node.append(k);
  }
}

/**
 * Append children to an existing node, skipping null/undefined/false the way
 * el() does. Native append()/replaceChildren() stringify null into the text
 * "null", so every dynamic list has to go through one of these.
 */
export function appendAll(node, ...kids) {
  add(node, kids);
  return node;
}

/** Replace a node's children, skipping null/undefined/false. */
export function fill(node, ...kids) {
  node.replaceChildren();
  add(node, kids);
  return node;
}

/**
 * "Ada" -> "Ada's", "Boris" -> "Boris'". A player may be called anything, and
 * a blunt name + "'s" produced "You's turn" for the default seat, so the local
 * human gets "your"/"Your" from the caller and everyone else gets a
 * grammatical possessive from here.
 */
export function possessive(name) {
  const n = String(name || '');
  return /[sS]$/.test(n) ? `${n}'` : `${n}'s`;
}

/** Visually hidden text for screen readers. */
export function sr(text) {
  return el('span', { class: 'sr-only', text });
}

/* ------------------------------------------------------------------ */
/* Resources                                                                */
/* ------------------------------------------------------------------ */

/**
 * An inline resource icon. Decorative by default — label the parent instead.
 *
 * `count` prints that number ON the token. That is the whole pip: a cost, a
 * pile, a holding and a discount are all "this many of this token", and one
 * element says it. Pass null (the default) where the token is an identity
 * rather than a quantity — a card's bonus resource, a selected-resource chip.
 */
export function tokenIcon(token, size = 20, count = null) {
  const span = el('span', {
    class: `token token--${token}`,
    style: `--s:${size}px`,
  });
  span.innerHTML = tokenSvgMarkup(token, size, count);
  return span;
}

/** Big washed-out resource used as card art — silhouette only. */
export function tokenGhost(token) {
  const span = el('span', { class: `token-ghost token--${token}`, 'aria-hidden': 'true' });
  span.innerHTML = tokenSilhouetteMarkup(token);
  return span;
}

/* ------------------------------------------------------------------ */
/* Costs                                                               */
/* ------------------------------------------------------------------ */

/**
 * The card's PRINTED cost, with the colours `viewIndex`'s cards already cover
 * dimmed rather than removed or rewritten. Uses affordability() for whether a
 * colour can actually be paid — no re-derived rules here.
 *
 * The app deliberately does not do the subtraction for you. It is one step of
 * mental arithmetic against the rail directly below, and paying for it buys
 * two things: a cost that means the same thing every time you look at it, and
 * no invisible step between what the card says and what you owe.
 *
 * `viewIndex` is HUMAN_SEAT everywhere on the board, on every turn. It is a
 * parameter only because an opponent's publicly reserved card is deliberately
 * priced through ITS OWNER's discounts — how close *they* are is the whole
 * point of being able to see it.
 */
export function costPills(card, state, viewIndex) {
  const p = state.players[viewIndex];
  const { pay } = affordability(state, viewIndex, card);
  const list = el('ul', { class: 'cost' });
  let any = false;
  for (const g of RESOURCES) {
    const raw = card.cost[g] || 0;
    if (!raw) continue;
    any = true;
    const bonus = Math.min(p.bonuses[g] || 0, raw);
    const need = raw - bonus;
    const missing = need - (pay[g] || 0);
    const li = el('li', {
      class:
        `pill pill--${g}` +
        (need === 0 ? ' is-covered' : '') +
        (missing > 0 ? ' is-short' : ''),
      title:
        `${raw} ${TOKEN_LABEL[g]}` +
        (bonus ? ` — ${bonus} covered by your cards, ${need} to pay` : ''),
    });
    // THE PRINTED COST, here as on the phone. This used to be the discounted
    // number with the printed one struck through beside it, which disclosed the
    // arithmetic but still let the figure move under the player: buy a white
    // card and every white-costing card on the board silently re-labelled. A
    // card's cost is a property of the card. What YOUR cards take off it is a
    // property of you, and it is the dimming.
    li.append(tokenIcon(g, 24, raw));
    li.append(
      sr(
        bonus > 0
          ? `${raw} ${TOKEN_LABEL[g]}, ${bonus} covered by your cards, ${need} to pay. `
          : `${raw} ${TOKEN_LABEL[g]}. `,
      ),
    );
    list.append(li);
  }
  if (!any) list.append(el('li', { class: 'pill pill--free', text: 'free' }));
  return list;
}

/** "Needs 2 Saffron, 1 Pepper" — why this card is out of reach right now. */
export function shortfallText(card, state, viewIndex) {
  const p = state.players[viewIndex];
  const { affordable, pay, shortfall } = affordability(state, viewIndex, card);
  if (affordable) return null;
  const parts = [];
  for (const g of RESOURCES) {
    const need = Math.max(0, (card.cost[g] || 0) - (p.bonuses[g] || 0));
    const gap = need - (pay[g] || 0);
    if (gap > 0) parts.push(`${gap} ${TOKEN_LABEL[g]}`);
  }
  const coin = p.tokens.coin || 0;
  const tail = coin > 0 ? ` (coin covers ${Math.min(coin, shortfall)} of ${shortfall})` : '';
  return `Needs ${parts.join(', ')}${tail}`;
}

/* ------------------------------------------------------------------ */
/* Holding cards                                                       */
/* ------------------------------------------------------------------ */

/**
 * A holding card.
 *
 * `readonly` renders a card nobody at this seat can act on — an opponent's
 * publicly reserved card. Its cost is then read through `costFor` (the
 * OWNER's discounts), because what matters about an opponent's reserve is how
 * close *they* are to affording it.
 *
 * @param {object} ctx  see render.js buildContext()
 * @param {{fromReserve?:boolean, mini?:boolean, readonly?:boolean,
 *          costFor?:number, ownerName?:string}} opts
 */
export function cardEl(card, ctx, opts = {}) {
  const { state } = ctx;
  const readonly = !!opts.readonly;
  const costView = opts.costFor === undefined ? HUMAN_SEAT : opts.costFor;
  const own = costView === HUMAN_SEAT;
  const p = ctx.you;
  const fromReserve = !!opts.fromReserve;
  const { affordable } = affordability(state, costView, card);
  const canBuy = !readonly && ctx.buyKeys.has(`${card.id}|${fromReserve}`);
  const canReserve = !readonly && !fromReserve && ctx.reserveIds.has(card.id);
  const short = shortfallText(card, state, costView);
  const holder = opts.ownerName || (own ? 'You' : state.players[costView].name);
  // "Can I pay for this?" is asked of YOUR purse whoever is to act; whether the
  // move is legal *right now* is a separate question and is `canBuy`.

  const node = el('article', {
    class:
      `card card--t${card.tier}` +
      (opts.mini ? ' card--mini' : '') +
      (fromReserve || readonly ? ' card--reserved' : '') +
      (readonly ? ' card--readonly' : '') +
      (canBuy ? ' is-buyable' : '') +
      (!canBuy && !readonly && affordable && ctx.interactive ? ' is-affordable' : ''),
    'data-card': card.id,
    'aria-label': readonly
      ? `${holder} has reserved: ${TOKEN_LABEL[card.resource]} card worth ${card.points} ` +
        `point${card.points === 1 ? '' : 's'}, ${DECK_LABEL_ONE[card.tier].toLowerCase()}. ` +
        (short ? `${holder} still ${short.replace(/^Needs/, 'needs')}.` : `${holder} can afford it.`)
      : `${DECK_LABEL_ONE[card.tier]}, ${TOKEN_LABEL[card.resource]}, ` +
        `${card.points} point${card.points === 1 ? '' : 's'}. ` +
        (fromReserve ? 'Reserved by you. ' : '') +
        (short || 'You can afford this.'),
  });

  if (fromReserve || readonly) {
    node.append(el('span', { class: 'card-flag', 'aria-hidden': 'true', text: 'Reserved' }));
  }

  node.append(
    el('div', { class: 'card-art' }, tokenGhost(card.resource)),
    el(
      'div',
      { class: 'card-head' },
      el('span', { class: 'card-points', 'aria-hidden': 'true' }, card.points ? String(card.points) : ''),
      el('span', { class: 'card-tier', 'aria-hidden': 'true', text: DECK_LABEL_ONE[card.tier] }),
      el(
        'span',
        { class: 'card-bonus', title: `Gives a permanent ${TOKEN_LABEL[card.resource]} discount` },
        tokenIcon(card.resource, opts.mini ? 20 : 28),
      ),
    ),
    costPills(card, state, costView),
  );

  if (readonly) {
    node.append(
      short
        ? el('p', { class: 'card-need', text: short })
        : el('p', { class: 'card-need card-need--ok', text: 'Can afford it' }),
    );
    return node;
  }

  const actions = el('div', { class: 'card-actions' });
  actions.append(
    actionButton({
      label: 'Buy',
      act: 'buy',
      ok: canBuy,
      reason: canBuy
        ? ''
        : !ctx.interactive
          ? ctx.blockedReason
          : short || 'Cannot buy this card',
      data: { 'data-card': card.id, 'data-reserve': fromReserve ? '1' : '0' },
      fk: `buy:${card.id}:${fromReserve ? 1 : 0}`,
      aria: `Buy ${TOKEN_LABEL[card.resource]} card worth ${card.points} points`,
    }),
  );
  if (!fromReserve) {
    actions.append(
      actionButton({
        label: 'Reserve',
        act: 'reserve-card',
        ok: canReserve,
        reason: canReserve
          ? ''
          : !ctx.interactive
            ? ctx.blockedReason
            : ctx.reservedFull
              ? `${p.reserved.length} reserved already`
              : 'Cannot reserve this card',
        data: { 'data-card': card.id },
        fk: `res:${card.id}`,
        aria: `Reserve this ${DECK_LABEL_ONE[card.tier]}, ${TOKEN_LABEL[card.resource]}`,
      }),
    );
  }
  node.append(actions);

  if (short) node.append(el('p', { class: 'card-need', text: short }));
  return node;
}

/* ------------------------------------------------------------------ */
/* Compact cards — the phone board                                     */
/* ------------------------------------------------------------------ */

/**
 * The cost of `card` as a column of pips, the way the printed card carries it.
 * Only what is still OWED after this player's discounts appears: a covered
 * colour is not a cost any more, and on a 71px-wide tile a struck-through zero
 * is three characters of noise. `.is-short` marks a colour the player cannot
 * currently cover, so what is missing is visible without reading a word.
 */
export function costColumn(card, state, viewIndex) {
  const p = state.players[viewIndex];
  const { pay } = affordability(state, viewIndex, card);
  const list = el('ul', { class: 'cost cost--col' });
  for (const g of RESOURCES) {
    const raw = card.cost[g] || 0;
    if (!raw) continue;
    const bonus = Math.min(p.bonuses[g] || 0, raw);
    const need = raw - bonus;
    const missing = need - (pay[g] || 0);
    list.append(
      el(
        'li',
        {
          class:
            `pill pill--${g}` +
            (need === 0 ? ' is-covered' : '') +
            (missing > 0 ? ' is-short' : ''),
          title:
            `${raw} ${TOKEN_LABEL[g]}` +
            (bonus ? ` — ${bonus} covered by your cards, ${need} to pay` : ''),
        },
        // THE PRINTED COST. Not what you owe after discounts.
        tokenIcon(g, 22, raw),
      ),
    );
  }
  // No card in the base game is free, so this is defensive rather than a state
  // anyone reaches. A card your cards fully cover reads as every pip dimmed,
  // which is the same news without a number that appears from nowhere.
  if (!list.children.length) list.append(el('li', { class: 'pill pill--free', text: 'free' }));
  return list;
}

/**
 * THERE IS NO VISIBLE SHORTFALL READOUT ANY MORE.
 *
 * The action bar used to print "SHORT" plus a row of pips for the gap between
 * a card's cost and your tokens. It was the widest thing on the narrowest bar
 * in the layout, and it was arithmetic the player is already doing by eye: the
 * card shows its cost after discounts, and their own tokens are in the rail
 * directly below it. It was also wrong-looking — it listed the coins you HOLD
 * inside a list headed "short", so it read as "short 1 coin" when a coin is the
 * wild that covers a shortfall.
 *
 * It is gone from the screen only. shortfallText() below still produces the
 * sentence, and it is still on every card's aria-label and on the reason a
 * disabled Buy button gives — a screen-reader user cannot glance between the
 * card and the rail, so the explanation has to survive for them.
 */

/** "Costs 2 Saffron, 1 Pepper" — the same numbers, for a screen reader. */
function costSentence(card, state, viewIndex) {
  const p = state.players[viewIndex];
  const costs = [];
  const covered = [];
  for (const g of RESOURCES) {
    const raw = card.cost[g] || 0;
    if (!raw) continue;
    costs.push(`${raw} ${TOKEN_LABEL[g]}`);
    const bonus = Math.min(p.bonuses[g] || 0, raw);
    if (bonus > 0) covered.push(`${bonus} ${TOKEN_LABEL[g]}`);
  }
  if (!costs.length) return 'Free.';
  // The PRINTED cost, then what your cards take off it — the same two facts
  // the pips carry, in the same order, so the sentence and the picture agree.
  // Dimming is invisible to a screen reader; this is where that news lives.
  return (
    `Costs ${costs.join(', ')}.` +
    (covered.length ? ` Your cards cover ${covered.join(', ')}.` : '')
  );
}

/**
 * A face-up card as ONE TAP TARGET. The whole tile is the button: tapping it
 * selects the card, and the action bar at the bottom of the screen then offers
 * Buy and Reserve for it. That is what lets the tile be small — there are no
 * per-card buttons competing for its width — while the cost pips, the point
 * value and the bonus resource all stay on the face where a glance can read them.
 */
export function cardTile(card, ctx, opts = {}) {
  const { state } = ctx;
  const fromReserve = !!opts.fromReserve;
  const picked =
    !!ctx.picked && ctx.picked.kind === 'card' && ctx.picked.id === card.id && !!ctx.picked.fromReserve === fromReserve;
  const canBuy = ctx.buyKeys.has(`${card.id}|${fromReserve}`);
  // AFFORDABLE IS NOT THE SAME QUESTION AS BUYABLE, and only one of them moves
  // with the turn. `affordable` is "your tokens cover this", asked of your
  // purse on every turn including a bot's, so the ring on a card you can pay
  // for does not blink out and back every time the seat changes hands.
  const { affordable } = affordability(state, HUMAN_SEAT, card);
  const short = shortfallText(card, state, HUMAN_SEAT);

  const btn = el('button', {
    type: 'button',
    class:
      `tile tile--t${card.tier}` +
      (opts.mini ? ' tile--mini' : '') +
      (fromReserve ? ' tile--reserved' : '') +
      (affordable ? ' is-affordable' : '') +
      (canBuy ? ' is-buyable' : ''),
    'data-act': 'pick-card',
    'data-card': card.id,
    'data-reserve': fromReserve ? '1' : '0',
    'data-fk': `tile:${card.id}:${fromReserve ? 1 : 0}`,
    'aria-pressed': picked ? 'true' : 'false',
    'aria-label':
      `${DECK_LABEL_ONE[card.tier]}, ${TOKEN_LABEL[card.resource]}, ${card.points} point${card.points === 1 ? '' : 's'}. ` +
      (fromReserve ? 'Reserved by you. ' : '') +
      costSentence(card, state, HUMAN_SEAT) +
      ' ' +
      (short || 'You can afford it.'),
  });


  appendAll(
    btn,
    el('span', { class: 'tile-art' }, tokenGhost(card.resource)),
    el(
      'span',
      { class: 'tile-head' },
      el('span', { class: 'tile-points', 'aria-hidden': 'true', text: card.points ? String(card.points) : '' }),
      el('span', { class: 'tile-bonus' }, tokenIcon(card.resource, opts.mini ? 16 : 24)),
    ),
    costColumn(card, state, HUMAN_SEAT),
  );
  return btn;
}

/** The empty slot left by a tier whose deck has run out. */
export function emptyTile() {
  return el('div', { class: 'tile tile--empty' }, el('span', { class: 'empty', text: '—' }));
}

/**
 * A tier's face-down deck, as a tap target of its own. Selecting it puts
 * "Blind reserve" in the action bar; the count is the public information.
 */
export function deckTile(tier, ctx) {
  const count = ctx.state.decks[tier].length;
  const picked = !!ctx.picked && ctx.picked.kind === 'deck' && ctx.picked.tier === tier;
  return el(
    'button',
    {
      type: 'button',
      class: `decktile decktile--t${tier}`,
      'data-act': 'pick-deck',
      'data-tier': String(tier),
      'data-fk': `deck:${tier}`,
      'aria-pressed': picked ? 'true' : 'false',
      'aria-label': `${DECK_LABEL[tier]} deck, ${count} card${count === 1 ? '' : 's'} left. Select to reserve the top card blind.`,
    },
    el('span', { class: 'decktile-tier', 'aria-hidden': 'true', text: DECK_LABEL[tier] }),
    el('span', { class: 'decktile-count', 'aria-hidden': 'true', text: String(count) }),
  );
}

/**
 * One bot, as a strip button. Points and card count are what you actually
 * track turn to turn; everything else is a tap away in the player sheet.
 */
export function oppChip(player, ctx) {
  // ctx.spotlight, not state.current: while a turn report is waiting, the seat
  // the screen is about is the one that just moved.
  const active = ctx.spotlight === player.index && ctx.state.phase !== 'gameover';
  const thinking = ctx.thinking === player.index;
  return el(
    'button',
    {
      type: 'button',
      class: `opp${active ? ' is-active' : ''}${thinking ? ' is-thinking' : ''}`,
      'data-act': 'open-sheet',
      'data-sheet': 'player',
      'data-id': String(player.index),
      'data-fk': `opp:${player.index}`,
      'aria-haspopup': 'dialog',
      'aria-label':
        `${player.name}, bot: ${player.points} point${player.points === 1 ? '' : 's'}, ` +
        `${player.cards.length} card${player.cards.length === 1 ? '' : 's'}` +
        (active ? (thinking ? ', taking their turn' : ', the seat on screen') : '') +
        '. Show their full holdings.',
    },
    el('span', { class: `seat seat--${player.index}`, 'aria-hidden': 'true', text: String(player.index + 1) }),
    el('span', { class: 'opp-name', 'aria-hidden': 'true', text: player.name }),
    el('span', { class: 'opp-cards', 'aria-hidden': 'true', title: 'Cards bought', text: String(player.cards.length) }),
    el('span', {
      class: 'opp-pts',
      'aria-hidden': 'true',
      'data-tick': `opp:${player.index}:pts`,
      'data-tick-to': String(player.points),
      text: String(player.points),
    }),
    thinking ? el('span', { class: 'dots', 'aria-hidden': 'true', text: '···' }) : null,
  );
}

/**
 * Face-down card back — a blind-drawn reserve nobody but its owner may see.
 * `count` > 1 stacks them into one back carrying the number.
 * @param {1|2|3|null} tier  null when even the tier is unknown.
 * @param {string} label     the accessible description.
 * @param {number} [count]
 */
export function cardBackEl(tier, label, count = 1) {
  const text = label || 'A face-down reserved card';
  return el(
    'div',
    {
      class: `cardback${tier ? ` cardback--t${tier}` : ''}${count > 1 ? ' cardback--stack' : ''}`,
      title: text,
    },
    el('span', { class: 'cardback-mark', 'aria-hidden': 'true', text: '?' }),
    count > 1 ? el('span', { class: 'cardback-count', 'aria-hidden': 'true', text: `×${count}` }) : null,
    sr(text),
  );
}

/* ------------------------------------------------------------------ */
/* Companies                                                              */
/* ------------------------------------------------------------------ */

export function companyEl(company, ctx, opts = {}) {
  const p = ctx.you;
  const reqs = el('ul', { class: 'cost cost--company' });
  let met = true;
  // The visible "3/4" came off the pip when the count moved onto the token, so
  // the progress it carried is spelled out here instead of being lost.
  const words = [];
  for (const g of RESOURCES) {
    const need = company.requires[g] || 0;
    if (!need) continue;
    const have = p ? p.bonuses[g] || 0 : 0;
    const ok = have >= need;
    if (!ok) met = false;
    const claimed = !!opts.claimed;
    words.push(claimed ? `${need} ${TOKEN_LABEL[g]}` : `${need} ${TOKEN_LABEL[g]} (you have ${have})`);
    const li = el('li', {
      class: `pill pill--${g}${ok || claimed ? ' is-covered' : ''}`,
      title: claimed ? `${need} ${TOKEN_LABEL[g]} cards` : `${TOKEN_LABEL[g]} cards: ${have} of ${need}`,
    });
    // The token carries what the company WANTS, exactly as a card's cost pip
    // carries what the card wants. Progress is the covered/not state plus the
    // title and the accessible name, which spell out "3 of 4" in words.
    li.append(tokenIcon(g, 22, need));
    reqs.append(li);
  }
  const node = el(
    'article',
    {
      class: `company${met && !opts.claimed ? ' is-met' : ''}${opts.mini ? ' company--mini' : ''}`,
      'data-company': company.id,
      'aria-label':
        `Company ${company.name}, ${company.points} points. ` +
        `${opts.claimed ? 'Claimed for' : 'Wants'} ${words.join(', ')}. ` +
        (opts.claimed ? '' : met ? 'Requirements met.' : 'Requirements not met.'),
    },
    el('div', { class: 'company-head' },
      el('span', { class: 'company-pts', 'aria-hidden': 'true', text: String(company.points) })),
    reqs,
  );
  if (opts.choose) {
    node.append(
      actionButton({
        label: 'Take this company',
        act: 'choose-company',
        ok: true,
        reason: '',
        data: { 'data-company': company.id },
        fk: `company:${company.id}`,
        aria: `Take the company ${company.name}`,
      }),
    );
  }
  return node;
}

/* ------------------------------------------------------------------ */
/* Bank                                                                */
/* ------------------------------------------------------------------ */

/** Shared read of a pile's live state, used by both build and update. */
function pileState(token, ctx) {
  const count = ctx.state.bank[token] || 0;
  const picked = token === 'coin' ? 0 : ctx.sel[token] || 0;
  // A picked pile always stays live so it can be clicked again to deselect.
  const usable = token !== 'coin' && ctx.interactive && (ctx.canAdd.has(token) || picked > 0);
  const reason =
    token === 'coin'
      ? 'Coins are only gained by reserving a card'
      : !ctx.interactive
        ? ctx.blockedReason
        : count === 0
          ? 'That pile is empty'
          : ctx.selReason(token);
  const label =
    `${TOKEN_LABEL[token]}: ${count} in bank` +
    (picked ? `, ${picked} selected — click to deselect` : '') +
    (usable ? '' : `. Unavailable: ${reason}`);
  return { count, picked, usable, reason, label };
}

/**
 * One bank pile. The coin pile is display-only (you get one by reserving).
 */
export function pileEl(token, ctx) {
  const st = pileState(token, ctx);
  const btn = el('button', {
    type: 'button',
    class: `pile pile--${token}`,
    'data-act': 'take-resource',
    'data-resource': token,
    'data-fk': `pile:${token}`,
    // The count runs to its new value rather than jumping — see tick.js. The
    // number written into the markup is always the true one; the tick only
    // decides which frame the eye is told on.
    'data-tick': `bank:${token}`,
  });
  appendAll(btn, tokenIcon(token, 40, st.count));
  updatePile(btn, token, ctx);
  return btn;
}

/**
 * Refresh a pile in place. Bank piles are the most-clicked control on the
 * board, so their nodes are kept alive across renders — replacing them would
 * drop a fast second click and lose focus mid-selection.
 */
export function updatePile(btn, token, ctx) {
  const st = pileState(token, ctx);
  btn.classList.toggle('is-picked', st.picked > 0);
  btn.classList.toggle('is-off', !st.usable);
  if (st.usable) btn.removeAttribute('aria-disabled');
  else btn.setAttribute('aria-disabled', 'true');
  btn.setAttribute('data-reason', st.reason);
  btn.setAttribute('aria-label', st.label);
  // The count lives on the token now, so patching it in place means patching
  // the <text> inside the pile's SVG rather than a sibling span.
  const countNode = btn.querySelector('.token-num');
  if (countNode) countNode.textContent = String(st.count);
  btn.setAttribute('data-tick-to', String(st.count));
  let badge = btn.querySelector('.pile-badge');
  if (st.picked > 0) {
    if (!badge) {
      badge = el('span', { class: 'pile-badge', 'aria-hidden': 'true' });
      btn.append(badge);
    }
    badge.textContent = `+${st.picked}`;
  } else if (badge) {
    badge.remove();
  }
}

/* ------------------------------------------------------------------ */
/* Holdings — one chip per colour, tokens AND cards                    */
/* ------------------------------------------------------------------ */

/**
 * ONE CHIP PER COLOUR, CARRYING BOTH NUMBERS: tokens / cards.
 *
 * These used to be two separate things — a row of token chips, and either a
 * second row of discount chips (the panel) or a little `+1` badge hung off the
 * token chip (the phone rail). Six colours times two elements is twelve things
 * to read for one question, and the question is always asked once: what can I
 * pay with?
 *
 * They mean very different things, so the chip never lets them look alike:
 *
 *   - SPENDABLE TOKENS ride on the token, big, exactly as every other count in
 *     this UI rides on a token. A number on a resource is always "this many of this
 *     resource", whether it is a cost, a bank pile or a holding.
 *   - PERMANENT CARD DISCOUNTS sit in a little card — a bordered box with a
 *     coloured spine, the same shape the opponent strip already uses for a
 *     card count — in smaller, quieter type. It is a card because it is cards.
 *
 * Shape, size and weight all separate them, and the accessible name says which
 * is which in words rather than leaning on any of that.
 *
 * @param {import('../contract.js').Player} player
 * @param {string} token
 * @param {number} [size]  the token's pixel size
 */
export function holdingChip(player, token, size = 22, tickKey = null) {
  const n = player.tokens[token] || 0;
  // A coin is a wild; no card ever grants a coin discount, so that half of the
  // chip does not exist rather than showing a permanent zero.
  const cards = token === 'coin' ? null : player.bonuses[token] || 0;
  return el(
    'span',
    {
      class: `hold${n || cards ? '' : ' is-zero'}`,
      'data-tick': tickKey,
      'data-tick-to': tickKey ? String(n) : null,
      title:
        `${n} ${TOKEN_LABEL[token]} token${n === 1 ? '' : 's'}` +
        (cards === null ? '' : ` · ${cards} ${TOKEN_LABEL[token]} card${cards === 1 ? '' : 's'}, a permanent discount`),
    },
    tokenIcon(token, size, n),
    cards === null
      ? null
      : el('span', { class: 'hold-cards', 'aria-hidden': 'true', text: String(cards) }),
    sr(
      `${n} ${TOKEN_LABEL[token]} token${n === 1 ? '' : 's'}` +
        (cards === null ? '. ' : `, ${cards} ${TOKEN_LABEL[token]} card discount${cards === 1 ? '' : 's'}. `),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Player panels                                                       */
/* ------------------------------------------------------------------ */

export function playerPanel(player, ctx) {
  const { state } = ctx;
  const active = ctx.spotlight === player.index && state.phase !== 'gameover';
  const isYou = player.index === HUMAN_SEAT;

  const holdings = el('div', { class: 'chips chips--holdings' });
  for (const t of TOKENS) holdings.append(holdingChip(player, t));

  const panel = el('section', {
    class: `player${active ? ' is-active' : ''}${player.isBot ? ' is-bot' : ''}`,
    'data-seat': String(player.index),
    'aria-current': active ? 'true' : null,
    'aria-label': `${player.name}, ${player.points} points, ${player.cards.length} cards`,
  });

  panel.append(
    el(
      'header',
      { class: 'player-head' },
      el('span', { class: `seat seat--${player.index}`, 'aria-hidden': 'true', text: String(player.index + 1) }),
      el('h3', { class: 'player-name' },
        player.name,
        player.isBot
          ? el('span', { class: 'player-kind', text: ` bot · ${player.botLevel || 'normal'}` })
          : null),
      ctx.thinking === player.index
        ? el('span', { class: 'thinking' }, el('span', { class: 'dots', 'aria-hidden': 'true', text: '···' }), 'thinking')
        : active
          ? el('span', { class: 'turn-badge', text: 'to act' })
          : null,
      el('span', { class: 'player-points', title: 'Points' }, String(player.points), sr(' points')),
    ),
    el('div', { class: 'player-stats' },
      el('span', { class: 'stat' }, el('b', { text: String(player.cards.length) }), ' cards'),
      el('span', { class: 'stat' }, el('b', { text: String(player.companies.length) }), ' companies'),
      el('span', { class: 'stat' }, el('b', { text: String(totalTokens(player)) }), '/10 tokens')),
    el('div', { class: 'player-line' },
      el('span', { class: 'line-label', text: 'Tokens / cards' }), holdings),
  );

  if (player.companies.length) {
    const row = el('div', { class: 'mini-row' });
    for (const id of player.companies) {
      const n = ctx.company(id);
      if (n) row.append(companyEl(n, ctx, { mini: true, claimed: true }));
    }
    panel.append(el('div', { class: 'player-line player-line--col' },
      el('span', { class: 'line-label', text: 'Companies' }), row));
  }

  if (player.reserved.length) {
    // Reserving a face-up card happens in the open — it stays public. Only a
    // card drawn blind off a deck top is secret, and only from its owner's
    // opponents. A null id means the state itself was redacted.
    const blind = new Set((player.reservedBlind || []).filter((id) => id !== null));
    const row = el('div', { class: 'mini-row' });
    let hidden = 0;
    for (const id of player.reserved) {
      if (id === null || (!isYou && blind.has(id))) {
        hidden += 1;
        continue;
      }
      const c = ctx.card(id);
      if (!c) {
        hidden += 1;
        continue;
      }
      row.append(
        isYou
          ? cardEl(c, ctx, { fromReserve: true, mini: true })
          : cardEl(c, ctx, {
              mini: true,
              readonly: true,
              costFor: player.index,
              ownerName: player.name,
            }),
      );
    }
    if (hidden > 0) {
      row.append(
        cardBackEl(
          null,
          `${player.name} holds ${hidden} face-down reserved card${hidden === 1 ? '' : 's'}`,
          hidden,
        ),
      );
    }
    const label =
      `Reserved (${player.reserved.length}/3)` +
      (hidden > 0 ? ` · ${hidden} face-down` : '');
    panel.append(el('div', { class: 'player-line player-line--col' },
      el('span', { class: 'line-label', text: label }), row));
  }

  return panel;
}

function totalTokens(player) {
  let n = 0;
  for (const t of TOKENS) n += player.tokens[t] || 0;
  return n;
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

/**
 * A real <button> that stays focusable even when unavailable: it carries
 * aria-disabled plus a data-reason the app surfaces on click, so nothing ever
 * silently does nothing.
 */
export function actionButton({ label, act, ok, reason, data, fk, aria, cls }) {
  const btn = el('button', {
    type: 'button',
    class: `btn${cls ? ` ${cls}` : ''}${ok ? '' : ' btn--off'}`,
    'data-act': act,
    'data-fk': fk,
    'data-reason': ok ? null : reason || 'Unavailable',
    'aria-disabled': ok ? null : 'true',
    'aria-label': ok ? aria || label : `${aria || label} — unavailable: ${reason}`,
    title: ok ? aria || label : reason,
  });
  if (data) for (const k of Object.keys(data)) btn.setAttribute(k, data[k]);
  btn.append(label);
  return btn;
}
