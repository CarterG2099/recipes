import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQty, fmtFrac, transform, convertTemps, parseTimers, fmtClock, filterRecipes,
} from '../docs/js/cooking.js';

test('parseQty: integers, decimals, fractions, unicode, mixed', () => {
  assert.equal(parseQty('1'), 1);
  assert.equal(parseQty('0'), 0);
  assert.equal(parseQty('2.5'), 2.5);
  assert.equal(parseQty('.5'), 0.5);
  assert.equal(parseQty('  3  '), 3);
  assert.equal(parseQty('1/2'), 0.5);
  assert.equal(parseQty('3/4'), 0.75);
  assert.equal(parseQty('1 1/2'), 1.5);
  assert.equal(parseQty('½'), 0.5);
  assert.equal(parseQty('1½'), 1.5);
  assert.equal(parseQty('1 ½'), 1.5);
  assert.ok(Math.abs(parseQty('⅔') - 2 / 3) < 1e-9);
});

test('parseQty: invalid / hostile inputs return null (never throw)', () => {
  assert.equal(parseQty(''), null);
  assert.equal(parseQty('   '), null);
  assert.equal(parseQty(null), null);
  assert.equal(parseQty(undefined), null);
  assert.equal(parseQty('abc'), null);
  assert.equal(parseQty('cup'), null);
  assert.equal(parseQty('1/0'), null);   // no divide-by-zero
  assert.equal(parseQty('1/2/3'), null);
  assert.equal(parseQty('½½'), null);
  assert.equal(parseQty(5), 5);          // number coerced
});

test('fmtFrac: common fractions and whole numbers', () => {
  assert.equal(fmtFrac(0.5), '½');
  assert.equal(fmtFrac(0.25), '¼');
  assert.equal(fmtFrac(0.75), '¾');
  assert.equal(fmtFrac(1), '1');
  assert.equal(fmtFrac(2), '2');
  assert.equal(fmtFrac(1.5), '1 ½');
  assert.equal(fmtFrac(12.5), '12 ½');
  assert.ok(['⅓'].includes(fmtFrac(1 / 3)));
  assert.ok(['⅔'].includes(fmtFrac(2 / 3)));
});

test('fmtFrac: degenerate inputs are safe', () => {
  assert.equal(fmtFrac(0), '0');
  assert.equal(fmtFrac(-3), '0');
  assert.equal(fmtFrac(NaN), '0');
  assert.equal(fmtFrac(Infinity), '0');
});

test('transform: US→metric volume', () => {
  assert.equal(transform('1 cup flour', 1, 'metric'), '235 ml flour');
  assert.equal(transform('1/4 cup honey', 1, 'metric'), '60 ml honey');
  assert.equal(transform('2 tbsp olive oil', 1, 'metric'), '30 ml olive oil');
  assert.equal(transform('1 tsp salt', 1, 'metric'), '5 ml salt');
});

test('transform: US→metric weight', () => {
  assert.equal(transform('8 oz cream cheese', 1, 'metric'), '225 g cream cheese');
  assert.equal(transform('1 lb ground beef', 1, 'metric'), '455 g ground beef');
});

test('transform: scaling, with and without conversion', () => {
  assert.equal(transform('1 cup flour', 0.5, 'us'), '½ cup flour');
  assert.equal(transform('1 cup flour', 2, 'us'), '2 cup flour');
  assert.equal(transform('1 cup flour', 1, 'us'), '1 cup flour');
  assert.equal(transform('1 cup flour', 0.5, 'metric'), '120 ml flour');
});

test('transform: ranges scale both ends', () => {
  assert.equal(transform('2-3 cloves garlic', 2, 'us'), '4–6 cloves garlic');
});

test('transform: non-quantified / unknown units pass through (scaled count only)', () => {
  assert.equal(transform('Salt to taste', 2, 'metric'), 'Salt to taste');
  assert.equal(transform('2 eggs', 2, 'metric'), '4 eggs');
  assert.equal(transform('flour', 2, 'metric'), 'flour');
  assert.equal(transform('a pinch of nutmeg', 2, 'metric'), 'a pinch of nutmeg');
});

test('transform: preserves leading indentation; safe on empty/null', () => {
  assert.equal(transform('  1 cup flour', 1, 'us'), '  1 cup flour');
  assert.equal(transform('', 2, 'us'), '');
  assert.equal(transform(null, 2, 'us'), '');
});

test('transform: metric→US returns a US unit (approx ok)', () => {
  const out = transform('250 ml milk', 1, 'us');
  assert.match(out, /cup/);
  const w = transform('200 g flour', 1, 'us');
  assert.match(w, /oz/);
});

test('transform: scales EVERY quantity incl. parentheticals (the 450g bug)', () => {
  // dual-unit line: scale both, don't convert (recipe already gives both systems)
  assert.equal(transform('1 lb (450 g) spaghetti', 1.5, 'us'), '1 ½ lb (675 g) spaghetti');
  assert.equal(transform('1 lb (450 g) spaghetti', 1.5, 'metric'), '1 ½ lb (675 g) spaghetti');
  assert.equal(transform('1 lb (450 g) spaghetti', 1, 'us'), '1 lb (450 g) spaghetti');
  assert.equal(transform('1 lb (450g) spaghetti', 2, 'us'), '2 lb (900 g) spaghetti');
});

test('transform: metric weights scale and convert', () => {
  assert.equal(transform('450 g flour', 2, 'metric'), '900 g flour');
  assert.equal(transform('1 kg potatoes', 0.5, 'metric'), '0.5 kg potatoes');
  assert.match(transform('450 g flour', 1, 'us'), /oz|lb/);
});

test('transform: leading count + parenthetical unit (cans)', () => {
  assert.equal(transform('1 (15 oz) can tomatoes', 2, 'us'), '2 (30 oz) can tomatoes');
  assert.equal(transform('1 (15 oz) can tomatoes', 1, 'metric'), '1 (425 g) can tomatoes');
});

test('convertTemps: F→C only in metric', () => {
  assert.equal(convertTemps('Bake at 350°F', 'metric'), 'Bake at 175°C');
  assert.equal(convertTemps('Bake at 350 degrees', 'metric'), 'Bake at 175°C');
  assert.equal(convertTemps('Bake at 450 F', 'metric'), 'Bake at 230°C');
  assert.equal(convertTemps('Bake at 350°F', 'us'), 'Bake at 350°F');
  assert.equal(convertTemps('no temperature here', 'metric'), 'no temperature here');
  assert.equal(convertTemps(null, 'metric'), '');
});

test('convertTemps: multiple temps in one line', () => {
  assert.equal(convertTemps('Sear at 400°F then finish at 350°F', 'metric'), 'Sear at 205°C then finish at 175°C');
});

test('parseTimers: detects durations and units', () => {
  assert.deepEqual(parseTimers('Bake 20 minutes'), [{ text: 'Bake ' }, { timer: 1200, label: '20 minutes' }]);
  assert.deepEqual(parseTimers('rest 1 hour').at(-1), { timer: 3600, label: '1 hour' });
  assert.deepEqual(parseTimers('chill 90 seconds').at(-1), { timer: 90, label: '90 seconds' });
  assert.deepEqual(parseTimers('cook 1.5 hours').at(-1), { timer: 5400, label: '1.5 hours' });
});

test('parseTimers: ranges, multiples, and no-timer steps', () => {
  const r = parseTimers('simmer 5-10 minutes');
  assert.equal(r.at(-1).timer, 300);
  const two = parseTimers('boil 10 min, then simmer 20 min').filter((s) => s.timer);
  assert.equal(two.length, 2);
  assert.deepEqual(parseTimers('Mix well until combined'), [{ text: 'Mix well until combined' }]);
});

test('parseTimers: does NOT match unit letters inside words (no false timers)', () => {
  assert.deepEqual(parseTimers('add 5 minced garlic cloves'), [{ text: 'add 5 minced garlic cloves' }]);
  assert.deepEqual(parseTimers('use 2 small onions'), [{ text: 'use 2 small onions' }]);
  assert.deepEqual(parseTimers(''), [{ text: '' }]);
});

test('fmtClock: mm:ss formatting and bounds', () => {
  assert.equal(fmtClock(1200), '20:00');
  assert.equal(fmtClock(65), '1:05');
  assert.equal(fmtClock(5), '0:05');
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(-10), '0:00');
  assert.equal(fmtClock(null), '0:00');
});

const SAMPLE = [
  { title: 'Apple Pie', tags: ['dessert', 'baking'], ingredients: ['2 apples'], is_favorite: true },
  { title: 'Beef Stew', tags: ['dinner', 'comfort'], ingredients: ['1 lb beef'], is_favorite: false },
  { title: 'Carrot Cake', tags: ['dessert'], ingredients: ['carrots', 'flour'], is_favorite: false },
];

test('filterRecipes: favorites only', () => {
  const r = filterRecipes(SAMPLE, { favoritesOnly: true });
  assert.deepEqual(r.map((x) => x.title), ['Apple Pie']);
});

test('filterRecipes: multi-tag is AND (must match all)', () => {
  assert.deepEqual(filterRecipes(SAMPLE, { activeTags: ['dessert'] }).map((x) => x.title), ['Apple Pie', 'Carrot Cake']);
  assert.deepEqual(filterRecipes(SAMPLE, { activeTags: ['dessert', 'baking'] }).map((x) => x.title), ['Apple Pie']);
  assert.deepEqual(filterRecipes(SAMPLE, { activeTags: ['dinner', 'dessert'] }), []);
});

test('filterRecipes: search across title, ingredients, tags (case-insensitive)', () => {
  assert.deepEqual(filterRecipes(SAMPLE, { search: 'beef' }).map((x) => x.title), ['Beef Stew']);
  assert.deepEqual(filterRecipes(SAMPLE, { search: 'COMFORT' }).map((x) => x.title), ['Beef Stew']);
  assert.deepEqual(filterRecipes(SAMPLE, { search: 'flour' }).map((x) => x.title), ['Carrot Cake']);
  assert.equal(filterRecipes(SAMPLE, { search: 'zzz' }).length, 0);
});

test('filterRecipes: sorting', () => {
  assert.deepEqual(filterRecipes(SAMPLE, { sort: 'az' }).map((x) => x.title), ['Apple Pie', 'Beef Stew', 'Carrot Cake']);
  assert.deepEqual(filterRecipes(SAMPLE, { sort: 'newest' }).map((x) => x.title), ['Carrot Cake', 'Beef Stew', 'Apple Pie']);
  assert.deepEqual(filterRecipes(SAMPLE, { sort: 'oldest' }).map((x) => x.title), ['Apple Pie', 'Beef Stew', 'Carrot Cake']);
});

test('filterRecipes: handles empty input and missing fields', () => {
  assert.deepEqual(filterRecipes([], {}), []);
  assert.deepEqual(filterRecipes(undefined, {}), []);
  const sparse = [{ title: 'Plain' }];
  assert.deepEqual(filterRecipes(sparse, { search: 'plain' }).length, 1);
  assert.deepEqual(filterRecipes(sparse, { activeTags: ['x'] }).length, 0);
});
