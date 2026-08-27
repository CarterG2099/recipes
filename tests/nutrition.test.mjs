import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  servingsCountFrom, perServing, hasNutrition, nutritionChanged, nutritionLine, MACROS,
} from '../docs/js/nutrition.js';

// ---- servings ---------------------------------------------------------------
// The `servings` column is free text. These are the shapes actually in the table
// plus the ones nothing stops someone typing.

test('servingsCountFrom reads a plain number', () => {
  assert.equal(servingsCountFrom('4'), 4);
  assert.equal(servingsCountFrom('18'), 18);
  assert.equal(servingsCountFrom(' 6 '), 6);
  assert.equal(servingsCountFrom(6), 6);
});

test('servingsCountFrom takes the lower bound of a range', () => {
  // Fewer servings means bigger per-serving numbers — the safer error for a log.
  assert.equal(servingsCountFrom('4-6'), 4);
  assert.equal(servingsCountFrom('4 to 6 servings'), 4);
  assert.equal(servingsCountFrom('12 cookies'), 12);
});

test('servingsCountFrom is null when there is no leading number', () => {
  assert.equal(servingsCountFrom('a loaf'), null);
  assert.equal(servingsCountFrom('about 8'), null, 'a word first is left for the human');
  assert.equal(servingsCountFrom(''), null);
  assert.equal(servingsCountFrom(null), null);
  assert.equal(servingsCountFrom(undefined), null);
  assert.equal(servingsCountFrom('0'), null, 'zero servings is not a count you can divide by');
});

// ---- per serving --------------------------------------------------------------

test('perServing divides every macro and rounds to a tenth', () => {
  const totals = { calories: 1000, protein_g: 61, carbs_g: 100, fat_g: 33, fiber_g: 10, sodium_mg: 1234 };
  assert.deepEqual(perServing(totals, 3), {
    calories: 333.3, protein_g: 20.3, carbs_g: 33.3, fat_g: 11, fiber_g: 3.3, sodium_mg: 411.3,
  });
});

test('perServing keeps an unknown macro unknown', () => {
  const out = perServing({ calories: 400, protein_g: null, carbs_g: '', fat_g: 10 }, 2);
  assert.equal(out.calories, 200);
  assert.equal(out.protein_g, null, 'null in, null out — never zero');
  assert.equal(out.carbs_g, null, 'an empty field is also unknown');
  assert.equal(out.fat_g, 5);
  assert.equal(out.fiber_g, null, 'a macro absent from the totals is unknown');
});

test('perServing refuses a count it cannot divide by', () => {
  const totals = { calories: 400 };
  assert.equal(perServing(totals, 0), null);
  assert.equal(perServing(totals, -2), null);
  assert.equal(perServing(totals, null), null);
  assert.equal(perServing(totals, 'four'), null);
});

// ---- presence and change --------------------------------------------------------

test('hasNutrition is true with any one macro and false with none', () => {
  assert.equal(hasNutrition({ calories: 300 }), true);
  assert.equal(hasNutrition({ sodium_mg: 0 }), true, 'zero is a value');
  assert.equal(hasNutrition({ calories: null, protein_g: '' }), false);
  assert.equal(hasNutrition({}), false);
  assert.equal(hasNutrition(null), false);
});

test('nutritionChanged compares as numbers, so a round trip is unchanged', () => {
  const stored = { calories: 420, protein_g: 32, servings_count: 4 };
  const form = { calories: '420', protein_g: '32', servings_count: '4' };
  assert.equal(nutritionChanged(stored, form), false);
});

test('nutritionChanged notices one edited field, including servings', () => {
  const stored = { calories: 420, protein_g: 32, servings_count: 4 };
  assert.equal(nutritionChanged(stored, { ...stored, protein_g: 30 }), true);
  assert.equal(nutritionChanged(stored, { ...stored, servings_count: 6 }), true);
  assert.equal(nutritionChanged(stored, { ...stored, calories: null }), true, 'clearing a value is a change');
});

test('nutritionChanged treats a missing field and null as the same thing', () => {
  assert.equal(nutritionChanged({ calories: 100 }, { calories: 100, fiber_g: null }), false);
  assert.equal(nutritionChanged(undefined, {}), false);
});

// ---- display --------------------------------------------------------------------

test('nutritionLine reads the four headline macros and skips unknowns', () => {
  assert.equal(
    nutritionLine({ calories: 419.6, protein_g: 32.4, carbs_g: 40, fat_g: 11.5 }),
    '420 kcal · 32 g protein · 40 g carbs · 12 g fat',
  );
  assert.equal(nutritionLine({ calories: 200, fat_g: 3 }), '200 kcal · 3 g fat');
  assert.equal(nutritionLine({}), '');
  assert.equal(nutritionLine(null), '');
});

test('MACROS is the six columns the schema has, in the order the form shows them', () => {
  assert.deepEqual(MACROS, ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg']);
});
