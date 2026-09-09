/**
 * THE VIEWPOINT. There is exactly one, and it never moves.
 *
 * A game is one human plus one to three bots, and the human is always seat 0
 * (see seatsFor() in app.js). Everything the board shows is shown through that
 * seat: card costs carry the human's discounts, the rail carries the human's
 * tokens, and affordability highlighting is asked of the human's purse — on
 * every turn, including while a bot is moving.
 *
 * This used to follow `state.current`, so a bot's turn silently reinterpreted
 * the whole board through that bot's discounts: the same card changed price,
 * and the rail relabelled itself with the bot's name. Whose turn it is is told
 * in words by the turn indicator and narrated by the move log; it is not told
 * by rewriting the board around the player.
 *
 * NOT TO BE CONFUSED WITH WHAT A BOT KNOWS. A bot is still handed
 * redactFor(state, itsOwnIndex) — the display viewpoint and a bot's
 * information are different things and neither one is derived from the other.
 */

/** The seat the person at this device plays. Always the first one. */
export const HUMAN_SEAT = 0;

/**
 * The rest of the table is bots, and a game is 2..4 players — so
 * the bot count is the only number the setup screen has left to ask for.
 */
export const MIN_BOTS = 1;
export const MAX_BOTS = 3;

/** The player this device belongs to. @param {import('../contract.js').GameState} state */
export function humanPlayer(state) {
  return state.players[HUMAN_SEAT];
}

/** Is the human the one to act? @param {import('../contract.js').GameState} state */
export function humanToAct(state) {
  return state.current === HUMAN_SEAT;
}
