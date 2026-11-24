import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldImportOnSave, findRecipeUrl, isEmptyDraft, linkErrorMessage } from '../docs/js/importing.js';

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

test('findRecipeUrl: a plain link comes back as-is', () => {
  assert.equal(findRecipeUrl(URL), URL);
  assert.equal(findRecipeUrl(`  ${URL}  `), URL);
});

test('findRecipeUrl: pulls the link out of share-sheet text', () => {
  assert.equal(findRecipeUrl(`Meringue Cookies — Sugar Spun Run\n${URL}`), URL);
  assert.equal(findRecipeUrl(`Try this (${URL}).`), URL);
});

test('findRecipeUrl: adds https:// to a bare address', () => {
  assert.equal(findRecipeUrl('sugarspunrun.com/meringue-cookie-recipe/'), URL);
  assert.equal(findRecipeUrl('www.allrecipes.com'), 'https://www.allrecipes.com/');
});

test('findRecipeUrl: anything that is not a web link is null', () => {
  for (const s of ['', '   ', null, 'Grandma', 'chocolate chip cookies', 'javascript:alert(1)',
    'http://localhost', 'ftp://example.com/r']) {
    assert.equal(findRecipeUrl(s), null, String(s));
  }
});

test('isEmptyDraft: no ingredients and no steps means nothing was found', () => {
  assert.equal(isEmptyDraft({ title: 'x', ingredients: [], instructions: [] }), true);
  assert.equal(isEmptyDraft({}), true);
  assert.equal(isEmptyDraft({ ingredients: ['1 egg'], instructions: [] }), false);
  assert.equal(isEmptyDraft({ ingredients: [], instructions: ['Bake.'] }), false);
});

test('linkErrorMessage: an unreachable page reads differently from our own failure', () => {
  assert.match(linkErrorMessage('Could not fetch that URL'), /couldn't open that page/);
  assert.match(linkErrorMessage('Edge Function returned a non-2xx status code'), /try again/);
  assert.match(linkErrorMessage(undefined), /try again/);
});
