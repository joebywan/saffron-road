/**
 * Resource-selection logic for the bank. Every question is answered by asking the
 * engine's own legal move list — nothing here re-implements a rule.
 *
 * A SELECTION IS A COUNT PER RESOURCE — two of one, or one each of three.
 * Not a list of taps.
 *
 * It used to be a list, and every function here began by tallying it back up.
 * That tally was the real state: nothing ever read the order, because there is
 * no order to read. Taking three different resources is one move however
 * you tap it. Storing the taps invented an ordering the game does not have,
 * and then the ordering had to be normalised away again at the boundary.
 *
 * Tapping a pile increments it; tapping it again decrements. Two of one
 * resource is a count of 2, which is exactly what a take-2 is.
 *
 * Reading a selection back out goes through RESOURCES, so the chips come out
 * in registry order for free — no sort, and no dependence on what anything is
 * called.
 */
import { RESOURCES, TOKEN_LABEL, TAKE2_MIN_PILE } from '../contract.js';

/** Just the resource-taking moves out of a legalMoves() list. */
export function takeMoves(moves) {
  return moves.filter((m) => m.type === 'take3' || m.type === 'take2');
}

/** A selection with nothing in it. */
export function empty() {
  return {};
}

/** How many tokens the selection holds in total. */
export function size(selection) {
  let n = 0;
  for (const g of RESOURCES) n += selection[g] || 0;
  return n;
}

/** The distinct resources chosen, in registry order. */
export function keys(selection) {
  return RESOURCES.filter((g) => (selection[g] || 0) > 0);
}

/** One entry per token chosen, in registry order — a take-2 yields two. */
export function chips(selection) {
  const out = [];
  for (const g of RESOURCES) for (let i = 0; i < (selection[g] || 0); i++) out.push(g);
  return out;
}

/** `selection` plus one of `resource`. */
export function plus(selection, resource) {
  return { ...selection, [resource]: (selection[resource] || 0) + 1 };
}

/** `selection` minus one of `resource`, or unchanged if it holds none. */
export function minus(selection, resource) {
  const n = (selection[resource] || 0) - 1;
  const out = { ...selection };
  if (n > 0) out[resource] = n;
  else delete out[resource];
  return out;
}

/** Could `selection` still grow into `move`? */
export function fits(selection, move) {
  const ks = keys(selection);
  if (move.type === 'take2') {
    return ks.length === 0 || (ks.length === 1 && ks[0] === move.resource && selection[move.resource] <= 2);
  }
  return ks.every((g) => move.resources.includes(g) && selection[g] === 1);
}

/** Is `selection` a prefix of at least one legal take? */
export function viable(selection, moves) {
  return moves.some((m) => fits(selection, m));
}

/** The exact legal move `selection` spells out, or null. */
export function complete(selection, moves) {
  const ks = keys(selection);
  for (const m of moves) {
    if (m.type === 'take2') {
      if (ks.length === 1 && ks[0] === m.resource && selection[m.resource] === 2) return m;
    } else if (
      ks.length === m.resources.length &&
      ks.every((g) => m.resources.includes(g) && selection[g] === 1)
    ) {
      return m;
    }
  }
  return null;
}

/** Resources that may still be clicked given the current selection. */
export function addable(selection, moves) {
  const out = new Set();
  for (const g of RESOURCES) if (viable(plus(selection, g), moves)) out.add(g);
  return out;
}

/** Why clicking `resource` right now would be illegal. */
export function whyNot(selection, moves, resource, bank) {
  if ((bank[resource] || 0) === 0) return `No ${TOKEN_LABEL[resource]} left in the bank`;
  if (size(selection) >= 3) return 'You already have three resources selected';
  const dup = keys(selection).some((g) => selection[g] > 1);
  if (dup) return 'Taking two of one resource uses your whole turn';
  if ((selection[resource] || 0) > 0) {
    if (size(selection) > 1) {
      return `Taking 2 ${TOKEN_LABEL[resource]} has to be on its own — clear the selection first`;
    }
    if ((bank[resource] || 0) < TAKE2_MIN_PILE) {
      return `A pile needs ${TAKE2_MIN_PILE} or more before you can take two — ` +
        `${TOKEN_LABEL[resource]} has ${bank[resource]}`;
    }
    return `Taking 2 ${TOKEN_LABEL[resource]} is not available right now`;
  }
  if (!moves.length) return 'No resources can be taken this turn';
  return `${TOKEN_LABEL[resource]} cannot be combined with your current selection`;
}

/**
 * Plain-English reading of what the selection currently means. Deliberately
 * says NO good names: the chips beside this text are the resources themselves,
 * drawn with their own shape, and repeating "Cinnamon + Indigo" in words only
 * made the line long enough to wrap on a phone. Screen-reader users get the
 * names from the chips, which carry them.
 */
export function describe(selection, moves) {
  const n = size(selection);
  if (!n) {
    const anyTwo = moves.some((m) => m.type === 'take2');
    return anyTwo ? 'Tap 3 different resources, or one pile of 4+ twice.' : 'Tap up to 3 different resources.';
  }
  const ks = keys(selection);
  if (ks.some((g) => selection[g] > 1)) return 'Take 2 of the same';
  if (complete(selection, moves)) return `Take ${n} different`;
  const canDouble = n === 1 && moves.some((m) => m.type === 'take2' && m.resource === ks[0]);
  const more = 3 - n;
  return (
    `Pick ${more} more different resource${more === 1 ? '' : 's'}` +
    (canDouble ? ', or tap that pile again for 2' : '')
  );
}
