/**
 * THE TURN REPORT — what just happened, and where it left the player who did
 * it.
 *
 * Three bots moving in quick succession is a stream of numbers changing with
 * no visible cause: by the time you have read one seat's tokens the next seat
 * has already spent theirs. The move log narrates it, but a log line is
 * something you have to go and read, and it says "took white, blue, green"
 * rather than showing you the tokens.
 *
 * So one region rotates through whoever moved last, carrying both halves of
 * the answer: WHAT they did, in the same pips the rest of the board uses, and
 * WHERE that leaves them — points, cards per colour, tokens. Over a round you
 * see every bot's position, each shown at the moment it changed, which is the
 * moment it means something.
 *
 * A REPORT DESCRIBES A WHOLE TURN, NEVER PART OF ONE. It is composed once the
 * engine has fully resolved the turn — the action, the over-ten discard, the
 * company step and the win check are all done — so the status it carries is
 * final and no report can ever be on screen while something still has to be
 * decided.
 *
 * Nothing here reads a hidden thing. A blind-drawn reserve is reported as
 * "the top card of tier N, unseen" exactly as the engine logs it: the UI
 * happens to hold an unredacted state, and that is not a licence to show what
 * the rules keep secret.
 */
import { RESOURCES, TOKENS } from '../contract.js';
import { affordability, getCard } from '../engine.js';

/**
 * HOW LONG A TURN IS ON SCREEN — one setting, three modes, because two
 * settings that both govern the pacing of a bot's turn is one too many. It
 * lives here rather than in the turn loop because what it really sets is how
 * long a REPORT is up for.
 *
 *   press   the report waits for a press. The default: a turn is a beat you
 *           finish reading, not a number that changed while you blinked.
 *   normal  auto-advances on the old timer.
 *   fast    auto-advances almost at once — the escape hatch for someone who
 *           would rather watch the bots race.
 */
export const PACES = ['press', 'normal', 'fast'];
export const PACE_LABEL = { press: 'Press to continue', normal: 'Normal', fast: 'Fast' };

/** A count per resource, from a list of resource keys. */
function tally(resources) {
  const out = {};
  for (const g of resources) out[g] = (out[g] || 0) + 1;
  return out;
}

/** Only the non-zero entries of a purse, in canonical order. */
function nonZero(purse) {
  const out = {};
  for (const t of TOKENS) if ((purse[t] || 0) > 0) out[t] = purse[t];
  return out;
}

/**
 * Compose the report for one completed turn.
 *
 * @param {import('../contract.js').GameState} before  state as the turn began
 * @param {import('../contract.js').GameState} after   state once it resolved
 * @param {number} actor            the seat that took the turn
 * @param {import('../contract.js').Move[]} moves      every move it took to resolve
 */
export function buildTurnReport(before, after, actor, moves) {
  const was = before.players[actor];
  const now = after.players[actor];
  const acts = [];

  for (const m of moves) {
    if (!m) continue;
    switch (m.type) {
      case 'take3':
        acts.push({ kind: 'take', resources: tally(m.resources) });
        break;
      case 'take2':
        acts.push({ kind: 'take', resources: { [m.resource]: 2 } });
        break;
      case 'buy': {
        const card = getCard(m.cardId);
        // What actually left the hand, from the engine's own rule rather than
        // a second implementation of it. The buy is always the turn's first
        // move, so `before` is the state it was paid out of.
        const { pay } = affordability(before, actor, card);
        acts.push({ kind: 'buy', card, paid: nonZero(pay) });
        break;
      }
      case 'reserve': {
        const blind = m.cardId === null || m.cardId === undefined;
        acts.push({
          kind: 'reserve',
          blind,
          tier: blind ? m.tier : getCard(m.cardId).tier,
          // Face-up reserves happened in the open, so the card is public. A
          // blind draw is not, and is not looked up here at all.
          card: blind ? null : getCard(m.cardId),
          // The engine takes a gold whenever the bank has one.
          coin: before.bank.coin > 0,
        });
        break;
      }
      case 'discard':
        acts.push({ kind: 'discard', resources: nonZero(m.tokens) });
        break;
      case 'pass':
        acts.push({ kind: 'pass' });
        break;
      default:
        break; // chooseCompany shows up as a claimed company below
    }
  }

  // Companies arrive at the end of a turn, chosen or automatic — either way what
  // matters is that this player has one they did not have before.
  const companies = now.companies.filter((id) => !was.companies.includes(id));

  const bonuses = {};
  for (const g of RESOURCES) if (now.bonuses[g]) bonuses[g] = now.bonuses[g];

  let tokenTotal = 0;
  for (const t of TOKENS) tokenTotal += now.tokens[t] || 0;

  return {
    actor,
    name: now.name,
    isBot: now.isBot,
    round: before.round,
    acts,
    companies,
    /** Where the turn left them. Final: the engine has finished with it. */
    status: {
      points: now.points,
      gained: now.points - was.points,
      cards: now.cards.length,
      bonuses,
      tokens: { ...now.tokens },
      tokenTotal,
      reserved: now.reserved.length,
    },
    /** True while the game waits for the player to take it in. */
    pending: false,
  };
}
