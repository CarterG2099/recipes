import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEditRecipe } from '../docs/js/access.js';

const CARTER = 'cgividen20@gmail.com';
const AANA = 'aanabraithwaite@gmail.com';
const MOM = 'mgividen@gmail.com';
const HOUSEHOLD = [CARTER, AANA];

test('an editor can edit their own recipe', () => {
  assert.equal(canEditRecipe(AANA, { email: AANA }), true);
});

test('an editor can edit a household member\'s recipe, both ways', () => {
  assert.equal(canEditRecipe(CARTER, { email: AANA, household: HOUSEHOLD }), true);
  assert.equal(canEditRecipe(AANA, { email: CARTER, household: HOUSEHOLD }), true);
});

test('a household does not reach recipes outside it', () => {
  assert.equal(canEditRecipe(MOM, { email: AANA, household: HOUSEHOLD }), false);
});

test('without a household an editor cannot edit someone else\'s recipe', () => {
  assert.equal(canEditRecipe(CARTER, { email: AANA }), false);
  assert.equal(canEditRecipe(CARTER, { email: AANA, household: [] }), false);
});

test('admins can edit anything, including recipes with no owner', () => {
  assert.equal(canEditRecipe(MOM, { email: CARTER, isAdmin: true }), true);
  assert.equal(canEditRecipe(null, { email: CARTER, isAdmin: true }), true);
});

test('email comparison ignores case, as the RLS policies do', () => {
  assert.equal(canEditRecipe('AanaBraithwaite@Gmail.com', { email: AANA }), true);
  assert.equal(canEditRecipe(CARTER.toUpperCase(), { email: AANA, household: [AANA, CARTER] }), true);
});

test('signed out, or a recipe with no owner, is never editable by a non-admin', () => {
  assert.equal(canEditRecipe(CARTER, {}), false);
  assert.equal(canEditRecipe(CARTER), false);
  assert.equal(canEditRecipe(null, { email: AANA, household: HOUSEHOLD }), false);
  assert.equal(canEditRecipe('', { email: '', household: [''] }), false);
});
