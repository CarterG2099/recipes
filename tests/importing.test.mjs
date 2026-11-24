import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldImportOnSave } from '../docs/js/importing.js';

const URL = 'https://sugarspunrun.com/meringue-cookie-recipe/';
const empty = (over = {}) => ({ source_url: URL, ingredients: [], instructions: [], ...over });

test('shouldImportOnSave: a link and nothing else imports', () => {
  assert.equal(shouldImportOnSave(empty(), null), true);
});

test('shouldImportOnSave: any ingredient or instruction means save as-is', () => {
  assert.equal(shouldImportOnSave(empty({ ingredients: ['3 egg whites'] }), null), false);
  assert.equal(shouldImportOnSave(empty({ instructions: ['Whip.'] }), null), false);
});

test('shouldImportOnSave: no link, or not an http(s) link, never imports', () => {
  assert.equal(shouldImportOnSave(empty({ source_url: null }), null), false);
  assert.equal(shouldImportOnSave(empty({ source_url: '' }), null), false);
  assert.equal(shouldImportOnSave(empty({ source_url: 'Grandma' }), null), false);
  assert.equal(shouldImportOnSave(empty({ source_url: 'javascript:alert(1)' }), null), false);
  assert.equal(shouldImportOnSave(empty({ source_url: 'HTTP://example.com/r' }), null), true);
});

test('shouldImportOnSave: only once per link, so an unreadable page still saves', () => {
  assert.equal(shouldImportOnSave(empty(), URL), false);
  assert.equal(shouldImportOnSave(empty(), 'https://other.example/r'), true);
});
