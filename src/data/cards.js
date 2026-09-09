/**
 * THE HOLDING CARDS. 90 of them: 40 caravans, 30 warehouses, 20 routes; 8/6/4
 * per resource colour per deck.
 *
 * THESE NUMBERS ARE TRANSCRIBED, NOT INVENTED, AND THEY ARE NOT FREE TO EDIT.
 * They were cross-verified across four mutually independent encodings that
 * agree on all 90 cards exactly — deck, bonus colour, point value and cost —
 * out of roughly thirteen independent origins in the same agreement set. Two
 * of the four predate LLMs and use completely different formats, so it is real
 * corroboration rather than one file propagating. A fifth dataset was rejected
 * as an outlier: it disagreed on 46 of the 90 cards, is not a colour
 * permutation of the others (all 120 were tried; best distance 46), and its
 * own claim to have been cross-verified is demonstrably false.
 *
 * If a cost here looks wrong, it is far likelier to be right. verify.js
 * asserts the structure below and will fail on a casual edit.
 *
 * TWO EXPECTATIONS THIS DATA CONTRADICTS. Both were checked carefully; the
 * data won:
 *   1. Total card points are 140, not 145. The warehouse deck carries 55,
 *      because its per-colour point spread is 1,1,2,2,2,3 — not 1,1,2,2,3,3.
 *   2. Caravan cards CAN cost their own bonus colour. Exactly 6 of the 40 do.
 *      Every source in the agreement set contains the same 6, so they are
 *      almost certainly genuine rather than a shared transcription error.
 *      verify.js pins the count at 6.
 *
 * Structural facts, all verified and asserted by verify.js:
 *   - Caravan points per colour: seven 0-point, one 1-point.
 *   - Warehouse points per colour: 1,1,2,2,2,3.   Routes: 3,4,4,5.
 *   - The 4-POINT route cards are the ones costing 7 of a single colour. The
 *     5-point ones cost 7 of a colour plus 3 of another. (Not the other way
 *     round.)
 *   - No single resource cost exceeds 7. Cheapest card 3 tokens, dearest 14.
 *
 * The cost curve is deliberately non-monotonic: a 3-point route costs 14
 * tokens while a 4-point route costs 7.
 */

/** @type {import('../contract.js').Card[]} */
export const CARDS = [
  // ---- Tier 1 ----
  { id: 't1-01', tier: 1, resource: 'cinnamon', points: 0, cost: { cinnamon: 0, indigo: 1, cardamom: 1, saffron: 1, pepper: 1 } }, // 4 tokens
  { id: 't1-02', tier: 1, resource: 'cinnamon', points: 0, cost: { cinnamon: 0, indigo: 1, cardamom: 2, saffron: 1, pepper: 1 } }, // 5 tokens
  { id: 't1-03', tier: 1, resource: 'cinnamon', points: 0, cost: { cinnamon: 0, indigo: 2, cardamom: 2, saffron: 0, pepper: 1 } }, // 5 tokens
  { id: 't1-04', tier: 1, resource: 'cinnamon', points: 0, cost: { cinnamon: 3, indigo: 1, cardamom: 0, saffron: 0, pepper: 1 } }, // 5 tokens
  { id: 't1-05', tier: 1, resource: 'cinnamon', points: 0, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 2, pepper: 1 } }, // 3 tokens
  { id: 't1-06', tier: 1, resource: 'cinnamon', points: 0, cost: { cinnamon: 0, indigo: 2, cardamom: 0, saffron: 0, pepper: 2 } }, // 4 tokens
  { id: 't1-07', tier: 1, resource: 'cinnamon', points: 0, cost: { cinnamon: 0, indigo: 3, cardamom: 0, saffron: 0, pepper: 0 } }, // 3 tokens
  { id: 't1-08', tier: 1, resource: 'cinnamon', points: 1, cost: { cinnamon: 0, indigo: 0, cardamom: 4, saffron: 0, pepper: 0 } }, // 4 tokens
  { id: 't1-09', tier: 1, resource: 'indigo', points: 0, cost: { cinnamon: 1, indigo: 0, cardamom: 1, saffron: 1, pepper: 1 } }, // 4 tokens
  { id: 't1-10', tier: 1, resource: 'indigo', points: 0, cost: { cinnamon: 1, indigo: 0, cardamom: 1, saffron: 2, pepper: 1 } }, // 5 tokens
  { id: 't1-11', tier: 1, resource: 'indigo', points: 0, cost: { cinnamon: 1, indigo: 0, cardamom: 2, saffron: 2, pepper: 0 } }, // 5 tokens
  { id: 't1-12', tier: 1, resource: 'indigo', points: 0, cost: { cinnamon: 0, indigo: 1, cardamom: 3, saffron: 1, pepper: 0 } }, // 5 tokens
  { id: 't1-13', tier: 1, resource: 'indigo', points: 0, cost: { cinnamon: 1, indigo: 0, cardamom: 0, saffron: 0, pepper: 2 } }, // 3 tokens
  { id: 't1-14', tier: 1, resource: 'indigo', points: 0, cost: { cinnamon: 0, indigo: 0, cardamom: 2, saffron: 0, pepper: 2 } }, // 4 tokens
  { id: 't1-15', tier: 1, resource: 'indigo', points: 0, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 0, pepper: 3 } }, // 3 tokens
  { id: 't1-16', tier: 1, resource: 'indigo', points: 1, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 4, pepper: 0 } }, // 4 tokens
  { id: 't1-17', tier: 1, resource: 'cardamom', points: 0, cost: { cinnamon: 1, indigo: 1, cardamom: 0, saffron: 1, pepper: 1 } }, // 4 tokens
  { id: 't1-18', tier: 1, resource: 'cardamom', points: 0, cost: { cinnamon: 1, indigo: 1, cardamom: 0, saffron: 1, pepper: 2 } }, // 5 tokens
  { id: 't1-19', tier: 1, resource: 'cardamom', points: 0, cost: { cinnamon: 0, indigo: 1, cardamom: 0, saffron: 2, pepper: 2 } }, // 5 tokens
  { id: 't1-20', tier: 1, resource: 'cardamom', points: 0, cost: { cinnamon: 1, indigo: 3, cardamom: 1, saffron: 0, pepper: 0 } }, // 5 tokens
  { id: 't1-21', tier: 1, resource: 'cardamom', points: 0, cost: { cinnamon: 2, indigo: 1, cardamom: 0, saffron: 0, pepper: 0 } }, // 3 tokens
  { id: 't1-22', tier: 1, resource: 'cardamom', points: 0, cost: { cinnamon: 0, indigo: 2, cardamom: 0, saffron: 2, pepper: 0 } }, // 4 tokens
  { id: 't1-23', tier: 1, resource: 'cardamom', points: 0, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 3, pepper: 0 } }, // 3 tokens
  { id: 't1-24', tier: 1, resource: 'cardamom', points: 1, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 0, pepper: 4 } }, // 4 tokens
  { id: 't1-25', tier: 1, resource: 'saffron', points: 0, cost: { cinnamon: 1, indigo: 1, cardamom: 1, saffron: 0, pepper: 1 } }, // 4 tokens
  { id: 't1-26', tier: 1, resource: 'saffron', points: 0, cost: { cinnamon: 2, indigo: 1, cardamom: 1, saffron: 0, pepper: 1 } }, // 5 tokens
  { id: 't1-27', tier: 1, resource: 'saffron', points: 0, cost: { cinnamon: 2, indigo: 0, cardamom: 1, saffron: 0, pepper: 2 } }, // 5 tokens
  { id: 't1-28', tier: 1, resource: 'saffron', points: 0, cost: { cinnamon: 1, indigo: 0, cardamom: 0, saffron: 1, pepper: 3 } }, // 5 tokens
  { id: 't1-29', tier: 1, resource: 'saffron', points: 0, cost: { cinnamon: 0, indigo: 2, cardamom: 1, saffron: 0, pepper: 0 } }, // 3 tokens
  { id: 't1-30', tier: 1, resource: 'saffron', points: 0, cost: { cinnamon: 2, indigo: 0, cardamom: 0, saffron: 2, pepper: 0 } }, // 4 tokens
  { id: 't1-31', tier: 1, resource: 'saffron', points: 0, cost: { cinnamon: 3, indigo: 0, cardamom: 0, saffron: 0, pepper: 0 } }, // 3 tokens
  { id: 't1-32', tier: 1, resource: 'saffron', points: 1, cost: { cinnamon: 4, indigo: 0, cardamom: 0, saffron: 0, pepper: 0 } }, // 4 tokens
  { id: 't1-33', tier: 1, resource: 'pepper', points: 0, cost: { cinnamon: 1, indigo: 1, cardamom: 1, saffron: 1, pepper: 0 } }, // 4 tokens
  { id: 't1-34', tier: 1, resource: 'pepper', points: 0, cost: { cinnamon: 1, indigo: 2, cardamom: 1, saffron: 1, pepper: 0 } }, // 5 tokens
  { id: 't1-35', tier: 1, resource: 'pepper', points: 0, cost: { cinnamon: 2, indigo: 2, cardamom: 0, saffron: 1, pepper: 0 } }, // 5 tokens
  { id: 't1-36', tier: 1, resource: 'pepper', points: 0, cost: { cinnamon: 0, indigo: 0, cardamom: 1, saffron: 3, pepper: 1 } }, // 5 tokens
  { id: 't1-37', tier: 1, resource: 'pepper', points: 0, cost: { cinnamon: 0, indigo: 0, cardamom: 2, saffron: 1, pepper: 0 } }, // 3 tokens
  { id: 't1-38', tier: 1, resource: 'pepper', points: 0, cost: { cinnamon: 2, indigo: 0, cardamom: 2, saffron: 0, pepper: 0 } }, // 4 tokens
  { id: 't1-39', tier: 1, resource: 'pepper', points: 0, cost: { cinnamon: 0, indigo: 0, cardamom: 3, saffron: 0, pepper: 0 } }, // 3 tokens
  { id: 't1-40', tier: 1, resource: 'pepper', points: 1, cost: { cinnamon: 0, indigo: 4, cardamom: 0, saffron: 0, pepper: 0 } }, // 4 tokens

  // ---- Tier 2 ----
  { id: 't2-01', tier: 2, resource: 'cinnamon', points: 1, cost: { cinnamon: 0, indigo: 0, cardamom: 3, saffron: 2, pepper: 2 } }, // 7 tokens
  { id: 't2-02', tier: 2, resource: 'cinnamon', points: 1, cost: { cinnamon: 2, indigo: 3, cardamom: 0, saffron: 3, pepper: 0 } }, // 8 tokens
  { id: 't2-03', tier: 2, resource: 'cinnamon', points: 2, cost: { cinnamon: 0, indigo: 0, cardamom: 1, saffron: 4, pepper: 2 } }, // 7 tokens
  { id: 't2-04', tier: 2, resource: 'cinnamon', points: 2, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 5, pepper: 3 } }, // 8 tokens
  { id: 't2-05', tier: 2, resource: 'cinnamon', points: 2, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 5, pepper: 0 } }, // 5 tokens
  { id: 't2-06', tier: 2, resource: 'cinnamon', points: 3, cost: { cinnamon: 6, indigo: 0, cardamom: 0, saffron: 0, pepper: 0 } }, // 6 tokens
  { id: 't2-07', tier: 2, resource: 'indigo', points: 1, cost: { cinnamon: 0, indigo: 2, cardamom: 2, saffron: 3, pepper: 0 } }, // 7 tokens
  { id: 't2-08', tier: 2, resource: 'indigo', points: 1, cost: { cinnamon: 0, indigo: 2, cardamom: 3, saffron: 0, pepper: 3 } }, // 8 tokens
  { id: 't2-09', tier: 2, resource: 'indigo', points: 2, cost: { cinnamon: 5, indigo: 3, cardamom: 0, saffron: 0, pepper: 0 } }, // 8 tokens
  { id: 't2-10', tier: 2, resource: 'indigo', points: 2, cost: { cinnamon: 2, indigo: 0, cardamom: 0, saffron: 1, pepper: 4 } }, // 7 tokens
  { id: 't2-11', tier: 2, resource: 'indigo', points: 2, cost: { cinnamon: 0, indigo: 5, cardamom: 0, saffron: 0, pepper: 0 } }, // 5 tokens
  { id: 't2-12', tier: 2, resource: 'indigo', points: 3, cost: { cinnamon: 0, indigo: 6, cardamom: 0, saffron: 0, pepper: 0 } }, // 6 tokens
  { id: 't2-13', tier: 2, resource: 'cardamom', points: 1, cost: { cinnamon: 3, indigo: 0, cardamom: 2, saffron: 3, pepper: 0 } }, // 8 tokens
  { id: 't2-14', tier: 2, resource: 'cardamom', points: 1, cost: { cinnamon: 2, indigo: 3, cardamom: 0, saffron: 0, pepper: 2 } }, // 7 tokens
  { id: 't2-15', tier: 2, resource: 'cardamom', points: 2, cost: { cinnamon: 4, indigo: 2, cardamom: 0, saffron: 0, pepper: 1 } }, // 7 tokens
  { id: 't2-16', tier: 2, resource: 'cardamom', points: 2, cost: { cinnamon: 0, indigo: 5, cardamom: 3, saffron: 0, pepper: 0 } }, // 8 tokens
  { id: 't2-17', tier: 2, resource: 'cardamom', points: 2, cost: { cinnamon: 0, indigo: 0, cardamom: 5, saffron: 0, pepper: 0 } }, // 5 tokens
  { id: 't2-18', tier: 2, resource: 'cardamom', points: 3, cost: { cinnamon: 0, indigo: 0, cardamom: 6, saffron: 0, pepper: 0 } }, // 6 tokens
  { id: 't2-19', tier: 2, resource: 'saffron', points: 1, cost: { cinnamon: 2, indigo: 0, cardamom: 0, saffron: 2, pepper: 3 } }, // 7 tokens
  { id: 't2-20', tier: 2, resource: 'saffron', points: 1, cost: { cinnamon: 0, indigo: 3, cardamom: 0, saffron: 2, pepper: 3 } }, // 8 tokens
  { id: 't2-21', tier: 2, resource: 'saffron', points: 2, cost: { cinnamon: 1, indigo: 4, cardamom: 2, saffron: 0, pepper: 0 } }, // 7 tokens
  { id: 't2-22', tier: 2, resource: 'saffron', points: 2, cost: { cinnamon: 3, indigo: 0, cardamom: 0, saffron: 0, pepper: 5 } }, // 8 tokens
  { id: 't2-23', tier: 2, resource: 'saffron', points: 2, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 0, pepper: 5 } }, // 5 tokens
  { id: 't2-24', tier: 2, resource: 'saffron', points: 3, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 6, pepper: 0 } }, // 6 tokens
  { id: 't2-25', tier: 2, resource: 'pepper', points: 1, cost: { cinnamon: 3, indigo: 2, cardamom: 2, saffron: 0, pepper: 0 } }, // 7 tokens
  { id: 't2-26', tier: 2, resource: 'pepper', points: 1, cost: { cinnamon: 3, indigo: 0, cardamom: 3, saffron: 0, pepper: 2 } }, // 8 tokens
  { id: 't2-27', tier: 2, resource: 'pepper', points: 2, cost: { cinnamon: 0, indigo: 1, cardamom: 4, saffron: 2, pepper: 0 } }, // 7 tokens
  { id: 't2-28', tier: 2, resource: 'pepper', points: 2, cost: { cinnamon: 0, indigo: 0, cardamom: 5, saffron: 3, pepper: 0 } }, // 8 tokens
  { id: 't2-29', tier: 2, resource: 'pepper', points: 2, cost: { cinnamon: 5, indigo: 0, cardamom: 0, saffron: 0, pepper: 0 } }, // 5 tokens
  { id: 't2-30', tier: 2, resource: 'pepper', points: 3, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 0, pepper: 6 } }, // 6 tokens

  // ---- Tier 3 ----
  { id: 't3-01', tier: 3, resource: 'cinnamon', points: 3, cost: { cinnamon: 0, indigo: 3, cardamom: 3, saffron: 5, pepper: 3 } }, // 14 tokens
  { id: 't3-02', tier: 3, resource: 'cinnamon', points: 4, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 0, pepper: 7 } }, // 7 tokens
  { id: 't3-03', tier: 3, resource: 'cinnamon', points: 4, cost: { cinnamon: 3, indigo: 0, cardamom: 0, saffron: 3, pepper: 6 } }, // 12 tokens
  { id: 't3-04', tier: 3, resource: 'cinnamon', points: 5, cost: { cinnamon: 3, indigo: 0, cardamom: 0, saffron: 0, pepper: 7 } }, // 10 tokens
  { id: 't3-05', tier: 3, resource: 'indigo', points: 3, cost: { cinnamon: 3, indigo: 0, cardamom: 3, saffron: 3, pepper: 5 } }, // 14 tokens
  { id: 't3-06', tier: 3, resource: 'indigo', points: 4, cost: { cinnamon: 7, indigo: 0, cardamom: 0, saffron: 0, pepper: 0 } }, // 7 tokens
  { id: 't3-07', tier: 3, resource: 'indigo', points: 4, cost: { cinnamon: 6, indigo: 3, cardamom: 0, saffron: 0, pepper: 3 } }, // 12 tokens
  { id: 't3-08', tier: 3, resource: 'indigo', points: 5, cost: { cinnamon: 7, indigo: 3, cardamom: 0, saffron: 0, pepper: 0 } }, // 10 tokens
  { id: 't3-09', tier: 3, resource: 'cardamom', points: 3, cost: { cinnamon: 5, indigo: 3, cardamom: 0, saffron: 3, pepper: 3 } }, // 14 tokens
  { id: 't3-10', tier: 3, resource: 'cardamom', points: 4, cost: { cinnamon: 0, indigo: 7, cardamom: 0, saffron: 0, pepper: 0 } }, // 7 tokens
  { id: 't3-11', tier: 3, resource: 'cardamom', points: 4, cost: { cinnamon: 3, indigo: 6, cardamom: 3, saffron: 0, pepper: 0 } }, // 12 tokens
  { id: 't3-12', tier: 3, resource: 'cardamom', points: 5, cost: { cinnamon: 0, indigo: 7, cardamom: 3, saffron: 0, pepper: 0 } }, // 10 tokens
  { id: 't3-13', tier: 3, resource: 'saffron', points: 3, cost: { cinnamon: 3, indigo: 5, cardamom: 3, saffron: 0, pepper: 3 } }, // 14 tokens
  { id: 't3-14', tier: 3, resource: 'saffron', points: 4, cost: { cinnamon: 0, indigo: 0, cardamom: 7, saffron: 0, pepper: 0 } }, // 7 tokens
  { id: 't3-15', tier: 3, resource: 'saffron', points: 4, cost: { cinnamon: 0, indigo: 3, cardamom: 6, saffron: 3, pepper: 0 } }, // 12 tokens
  { id: 't3-16', tier: 3, resource: 'saffron', points: 5, cost: { cinnamon: 0, indigo: 0, cardamom: 7, saffron: 3, pepper: 0 } }, // 10 tokens
  { id: 't3-17', tier: 3, resource: 'pepper', points: 3, cost: { cinnamon: 3, indigo: 3, cardamom: 5, saffron: 3, pepper: 0 } }, // 14 tokens
  { id: 't3-18', tier: 3, resource: 'pepper', points: 4, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 7, pepper: 0 } }, // 7 tokens
  { id: 't3-19', tier: 3, resource: 'pepper', points: 4, cost: { cinnamon: 0, indigo: 0, cardamom: 3, saffron: 6, pepper: 3 } }, // 12 tokens
  { id: 't3-20', tier: 3, resource: 'pepper', points: 5, cost: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 7, pepper: 3 } }, // 10 tokens
];
