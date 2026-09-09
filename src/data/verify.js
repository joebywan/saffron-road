/**
 * Data verification for the card and company sets.
 *
 *   node src/data/verify.js
 *
 * Asserts the structural invariants the engine relies on, plus the structural
 * facts of the transcribed card set, then prints a summary and
 * "ALL CHECKS PASSED". Exits non-zero on the first failure.
 *
 * NOTE ON WHAT IS *NOT* ASSERTED HERE:
 * Earlier revisions of this file asserted an invented economy — that cost rises
 * monotonically with points within a tier, and that costs are "concentrated" in
 * one colour. Those were properties of a GENERATED card set, not of the real
 * one. The transcribed deck is non-monotonic on purpose (a 3-point route costs
 * 14 tokens while a 4-point route costs 7), so those assertions have been
 * removed rather than bent to fit. What remains is either a hard requirement of
 * the engine (shapes, ids, key completeness) or a structural fact of the card
 * set. See cards.js for where the data came from and how it was checked.
 */

import assert from 'node:assert/strict';
import { RESOURCES } from '../contract.js';
import { CARDS } from './cards.js';
import { COMPANIES } from './companies.js';

const RESOURCE_SET = new Set(RESOURCES);
const totalOf = (cost) => RESOURCES.reduce((n, g) => n + cost[g], 0);
const bag = (xs) => xs.slice().sort((a, b) => a - b).join(',');

/** Assert an object is a complete Cost: exactly the 5 resource keys, ints >= 0. */
function assertCostShape(cost, where) {
  assert.equal(typeof cost, 'object', `${where}: cost must be an object`);
  assert.notEqual(cost, null, `${where}: cost must not be null`);
  assert.deepEqual(
    Object.keys(cost).sort(),
    [...RESOURCES].sort(),
    `${where}: cost must have exactly the 5 resource keys, zeros included`
  );
  for (const g of RESOURCES) {
    assert.ok(Number.isInteger(cost[g]), `${where}: ${g} must be an integer`);
    assert.ok(cost[g] >= 0, `${where}: ${g} must be >= 0`);
    assert.ok(cost[g] <= 7, `${where}: no single resource cost exceeds 7 in the real deck (${g}=${cost[g]})`);
  }
}

/* ------------------------------------------------------------------ */
/* 1. Deck composition                                                 */
/* ------------------------------------------------------------------ */

const TIER_SPEC = {
  1: { count: 40, perColour: 8, points: bag([0, 0, 0, 0, 0, 0, 0, 1]) },
  2: { count: 30, perColour: 6, points: bag([1, 1, 2, 2, 2, 3]) },
  3: { count: 20, perColour: 4, points: bag([3, 4, 4, 5]) },
};

assert.equal(CARDS.length, 90, 'there are exactly 90 holding cards');

const byTier = { 1: [], 2: [], 3: [] };
for (const c of CARDS) {
  assert.ok(c && typeof c === 'object', 'every card must be an object');
  assert.ok([1, 2, 3].includes(c.tier), `card ${c && c.id}: tier must be 1, 2 or 3`);
  byTier[c.tier].push(c);
}

for (const tier of [1, 2, 3]) {
  const spec = TIER_SPEC[tier];
  assert.equal(byTier[tier].length, spec.count, `tier ${tier} must hold ${spec.count} cards`);
  for (const g of RESOURCES) {
    const n = byTier[tier].filter((c) => c.resource === g).length;
    assert.equal(n, spec.perColour, `tier ${tier} must hold ${spec.perColour} ${g} cards (got ${n})`);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Per-card shape                                                   */
/* ------------------------------------------------------------------ */

const seen = new Set();
const idNums = { 1: [], 2: [], 3: [] };

for (const c of CARDS) {
  assert.equal(typeof c.id, 'string', 'card id must be a string');
  assert.ok(!seen.has(c.id), `duplicate card id: ${c.id}`);
  seen.add(c.id);

  const m = /^t([123])-(\d{2})$/.exec(c.id);
  assert.ok(m, `card id "${c.id}" must match t<tier>-<two digits>`);
  assert.equal(Number(m[1]), c.tier, `card ${c.id}: the id's tier must match .tier`);
  idNums[c.tier].push(Number(m[2]));

  assert.ok(RESOURCE_SET.has(c.resource), `card ${c.id}: "${c.resource}" is not a resource colour`);
  assert.ok(Number.isInteger(c.points) && c.points >= 0 && c.points <= 5,
    `card ${c.id}: points must be an integer 0..5`);

  assertCostShape(c.cost, `card ${c.id}`);
  assert.ok(totalOf(c.cost) >= 3, `card ${c.id}: every printed card costs at least 3 tokens`);
}

for (const tier of [1, 2, 3]) {
  assert.deepEqual(
    idNums[tier].slice().sort((a, b) => a - b),
    Array.from({ length: TIER_SPEC[tier].count }, (_, i) => i + 1),
    `tier ${tier} ids must run 01..${TIER_SPEC[tier].count} with no gaps or repeats`
  );
}

/* ------------------------------------------------------------------ */
/* 3. Point distribution across the deck                               */
/* ------------------------------------------------------------------ */

for (const tier of [1, 2, 3]) {
  for (const g of RESOURCES) {
    const pts = byTier[tier].filter((c) => c.resource === g).map((c) => c.points);
    assert.equal(
      bag(pts),
      TIER_SPEC[tier].points,
      `tier ${tier} ${g}: point spread must be ${TIER_SPEC[tier].points} (got ${bag(pts)})`
    );
  }
}

const cardPoints = CARDS.reduce((n, c) => n + c.points, 0);
assert.equal(cardPoints, 140, 'the 90 holding cards carry 140 points in total');

// Tier 3: the 4-point cards are the ones costing 7 of a single colour.
const t3four = byTier[3].filter((c) => c.points === 4);
const singles = t3four.filter(
  (c) => RESOURCES.filter((g) => c.cost[g] > 0).length === 1 && Math.max(...RESOURCES.map((g) => c.cost[g])) === 7
);
assert.equal(singles.length, 5, 'each colour has one tier-3 4-point card costing 7 of a single resource');

// The tier-3 5-point cards cost 7 of one colour PLUS 3 of another (not 7 alone).
for (const c of byTier[3].filter((x) => x.points === 5)) {
  const amounts = RESOURCES.map((g) => c.cost[g]).filter((n) => n > 0).sort((a, b) => a - b);
  assert.deepEqual(amounts, [3, 7], `card ${c.id}: a tier-3 5-point card costs 7 of one resource plus 3 of another`);
}

// Tier-1 cards MAY cost their own colour: exactly 6 of the 40 do. This is a
// genuine property of the printed deck, unanimous across every independent
// source checked (see the provenance note in cards.js). Pinned so that a future
// edit cannot quietly introduce or lose one.
const t1self = byTier[1].filter((c) => c.cost[c.resource] > 0);
assert.equal(t1self.length, 6, 'exactly 6 tier-1 cards cost their own bonus colour in the printed deck');

/* ------------------------------------------------------------------ */
/* 4. Reachability: every company must be attainable                     */
/* ------------------------------------------------------------------ */

const supply12 = Object.fromEntries(RESOURCES.map((g) => [g, 0]));
for (const c of CARDS) if (c.tier !== 3) supply12[c.resource] += 1;
for (const g of RESOURCES) {
  assert.ok(supply12[g] >= 4, `reachability: need >= 4 ${g} cards in tiers 1-2 (got ${supply12[g]})`);
}

const biggestNeed = Math.max(...COMPANIES.flatMap((n) => RESOURCES.map((g) => n.requires[g])));
for (const g of RESOURCES) {
  const supply = CARDS.filter((c) => c.resource === g).length;
  assert.ok(supply >= biggestNeed,
    `reachability: total ${g} supply (${supply}) is below the largest company requirement (${biggestNeed})`);
}

/* ------------------------------------------------------------------ */
/* 5. Companies                                                           */
/* ------------------------------------------------------------------ */

assert.equal(COMPANIES.length, 10, 'the base game has exactly 10 company tiles');

const nIds = new Set();
const nNames = new Set();
const sigs = new Set();
const companyUse = Object.fromEntries(RESOURCES.map((g) => [g, 0]));
let pairs = 0;
let triples = 0;

for (const n of COMPANIES) {
  assert.ok(/^n-\d{2}$/.test(n.id), `company id "${n.id}" must match n-<two digits>`);
  assert.ok(!nIds.has(n.id), `duplicate company id: ${n.id}`);
  nIds.add(n.id);

  assert.ok(typeof n.name === 'string' && n.name.length > 0, `company ${n.id}: needs a name`);
  assert.ok(!nNames.has(n.name), `duplicate company name: ${n.name}`);
  nNames.add(n.name);

  assert.equal(n.points, 3, `company ${n.id}: every company is worth 3 points`);
  assertCostShape(n.requires, `company ${n.id}`);

  const need = RESOURCES.filter((g) => n.requires[g] > 0);
  for (const g of need) companyUse[g] += 1;

  const sig = need.join('+');
  assert.ok(!sigs.has(sig), `two companies require the same colour combination: ${sig}`);
  sigs.add(sig);

  if (need.length === 2) {
    pairs += 1;
    for (const g of need) assert.equal(n.requires[g], 4, `company ${n.id}: two-colour tiles require 4 of each`);
  } else if (need.length === 3) {
    triples += 1;
    for (const g of need) assert.equal(n.requires[g], 3, `company ${n.id}: three-colour tiles require 3 of each`);
  } else {
    assert.fail(`company ${n.id}: must require 2 or 3 colours (got ${need.length})`);
  }
}

assert.equal(pairs, 5, 'five companies require two colours at 4 each');
assert.equal(triples, 5, 'five companies require three colours at 3 each');
assert.equal(
  RESOURCES.reduce((n, g) => n + companyUse[g], 0),
  25,
  'the ten tiles carry 25 colour requirements in total (5 pairs + 5 triples)'
);
// The real tile set is perfectly balanced: every colour is wanted by exactly
// five tiles, twice among the 4/4 tiles and three times among the 3/3/3 tiles.
for (const g of RESOURCES) {
  assert.equal(companyUse[g], 5, `every colour must be required by exactly 5 companies (${g} is ${companyUse[g]})`);
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
/* Column width follows the longest token name rather than a magic 7. The goods
   names are longer than the resource names were, and a hardcoded width turned the
   header into "indigocardamomsaffron". */
const RESW = Math.max(8, ...RESOURCES.map((g) => g.length + 2));

console.log('\nCARDS — count by tier and bonus colour');
console.log('  ' + pad('tier', 6) + RESOURCES.map((g) => padL(g, RESW)).join('') + padL('total', 8));
for (const tier of [1, 2, 3]) {
  console.log(
    '  ' + pad(tier, 6) +
      RESOURCES.map((g) => padL(byTier[tier].filter((c) => c.resource === g).length, RESW)).join('') +
      padL(byTier[tier].length, 8)
  );
}
console.log(
  '  ' + pad('all', 6) +
    RESOURCES.map((g) => padL(CARDS.filter((c) => c.resource === g).length, RESW)).join('') +
    padL(CARDS.length, 8)
);

console.log('\nCARDS — token cost by tier and point value');
console.log('  ' + pad('tier', 6) + pad('points', 8) + padL('cards', 7) + padL('min', 6) + padL('avg', 7) + padL('max', 6));
for (const tier of [1, 2, 3]) {
  const pts = [...new Set(byTier[tier].map((c) => c.points))].sort((a, b) => a - b);
  for (const p of pts) {
    const ts = byTier[tier].filter((c) => c.points === p).map((c) => totalOf(c.cost));
    console.log(
      '  ' + pad(tier, 6) + pad(p, 8) + padL(ts.length, 7) + padL(Math.min(...ts), 6) +
        padL((ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(2), 7) + padL(Math.max(...ts), 6)
    );
  }
}

console.log('\nCOMPANIES');
console.log('  ' + pad('2 colours @ 4', 18) + padL(pairs, 5) + '     ' + pad('3 colours @ 3', 18) + padL(triples, 5));
console.log('  colour demand:  ' + RESOURCES.map((g) => `${g}:${companyUse[g]}`).join('  '));

console.log(
  '\nPOINTS — cards ' + cardPoints + ', companies ' + COMPANIES.reduce((n, x) => n + x.points, 0) +
    ', total ' + (cardPoints + COMPANIES.reduce((n, x) => n + x.points, 0))
);
console.log('BONUS SUPPLY (tiers 1-2): ' + RESOURCES.map((g) => `${g}:${supply12[g]}`).join('  '));

console.log('\nALL CHECKS PASSED\n');
