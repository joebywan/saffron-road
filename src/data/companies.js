/**
 * THE COMPANY TILES. Ten of them, 3 points each.
 *
 * THE REQUIREMENT ROWS ARE TRANSCRIBED AND MUST NOT MOVE. They are the
 * unanimous consensus of every independent source checked, across six
 * different encodings. Five tiles want two colours at 4, five want three
 * colours at 3, and the set is perfectly balanced: each colour is required by
 * exactly five tiles, twice among the 4/4 tiles and three times among the
 * 3/3/3 tiles. verify.js asserts that balance, so an edit here fails the
 * build rather than quietly skewing the game.
 *
 * One dataset — the same outlier rejected for the card costs, see cards.js —
 * is the only one that ships names alongside requirements, and its
 * requirements are wrong in two respects: a white+green+red tile where every
 * other source has white+red+black, leaving its colour demand unbalanced
 * (green 6, black 4, against 5 each). Not used.
 *
 * THE NAMES ARE THIS GAME'S OWN, are flavour only, and may be changed freely.
 */

/** @type {import('../contract.js').Company[]} */
export const COMPANIES = [
  // two colours at 4 each
  { id: 'n-01', name: 'Malabar Coast Company', points: 3, requires: { cinnamon: 4, indigo: 4, cardamom: 0, saffron: 0, pepper: 0 } }, // cinnamon+indigo
  { id: 'n-02', name: 'Coromandel Traders', points: 3, requires: { cinnamon: 0, indigo: 4, cardamom: 4, saffron: 0, pepper: 0 } }, // indigo+cardamom
  { id: 'n-03', name: 'Samarkand Consortium', points: 3, requires: { cinnamon: 0, indigo: 0, cardamom: 4, saffron: 4, pepper: 0 } }, // cardamom+saffron
  { id: 'n-04', name: 'House of Hormuz', points: 3, requires: { cinnamon: 0, indigo: 0, cardamom: 0, saffron: 4, pepper: 4 } }, // saffron+pepper
  { id: 'n-05', name: 'Zanzibar Company', points: 3, requires: { cinnamon: 4, indigo: 0, cardamom: 0, saffron: 0, pepper: 4 } }, // cinnamon+pepper

  // three colours at 3 each
  { id: 'n-06', name: 'Bukhara Guild', points: 3, requires: { cinnamon: 3, indigo: 3, cardamom: 3, saffron: 0, pepper: 0 } }, // cinnamon+indigo+cardamom
  { id: 'n-07', name: 'Kashgar Caravan Company', points: 3, requires: { cinnamon: 0, indigo: 3, cardamom: 3, saffron: 3, pepper: 0 } }, // indigo+cardamom+saffron
  { id: 'n-08', name: 'Aleppo Merchant House', points: 3, requires: { cinnamon: 0, indigo: 0, cardamom: 3, saffron: 3, pepper: 3 } }, // cardamom+saffron+pepper
  { id: 'n-09', name: 'Basra Trading House', points: 3, requires: { cinnamon: 3, indigo: 0, cardamom: 0, saffron: 3, pepper: 3 } }, // cinnamon+saffron+pepper
  { id: 'n-10', name: 'Herat Company', points: 3, requires: { cinnamon: 3, indigo: 3, cardamom: 0, saffron: 0, pepper: 3 } }, // cinnamon+indigo+pepper
];
