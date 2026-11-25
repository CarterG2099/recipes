import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linksFromText, groupItems, splitPhoto, pendingItems, rowFromDraft } from '../docs/js/bulk.js';

const A = 'https://sugarspunrun.com/meringue-cookie-recipe/';
const B = 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/';

const photo = (id, names, status = 'ready') =>
  ({ id, kind: 'photos', files: names.map((n) => ({ file: n })), status, error: '' });
const names = (item) => item.files.map((f) => f.file);

test('linksFromText: one per line, in order', () => {
  assert.deepEqual(linksFromText(`${A}\n${B}\n`), [A, B]);
});

test('linksFromText: finds links inside other text and drops repeats', () => {
  const pasted = `Meringue Cookies — Sugar Spun Run ${A}\n\nCookies!\n${B}\n${A}`;
  assert.deepEqual(linksFromText(pasted), [A, B]);
});

test('linksFromText: bare addresses get https, plain words are ignored', () => {
  assert.deepEqual(linksFromText('sugarspunrun.com/meringue-cookie-recipe/ and 1.5 cups'), [A]);
  assert.deepEqual(linksFromText('no links here'), []);
  assert.deepEqual(linksFromText(''), []);
});

test('groupItems: chosen photos become one recipe in list order, in the first one\'s place', () => {
  const items = [photo(1, ['a']), { id: 2, kind: 'link', url: A, status: 'ready' }, photo(3, ['b']), photo(4, ['c'])];
  const out = groupItems(items, [4, 1]);
  assert.deepEqual(out.map((it) => it.id), [1, 2, 3]);
  assert.deepEqual(names(out[0]), ['a', 'c']);
  assert.deepEqual(names(out[2]), ['b']);
});

test('groupItems: links, PDFs, saved items and a single pick are left alone', () => {
  const items = [photo(1, ['a']), { id: 2, kind: 'pdf', files: [{ file: 'p' }], status: 'ready' }, photo(3, ['b'], 'saved')];
  assert.equal(groupItems(items, [1, 2]), items);
  assert.equal(groupItems(items, [1, 3]), items);
  assert.equal(groupItems(items, [1]), items);
});

test('groupItems: a failed group goes back to ready with its error cleared', () => {
  const items = [{ ...photo(1, ['a'], 'failed'), error: 'nope' }, photo(2, ['b'])];
  const [merged] = groupItems(items, [1, 2]);
  assert.equal(merged.status, 'ready');
  assert.equal(merged.error, '');
});

test('splitPhoto: moves one photo into its own recipe right after the group', () => {
  const items = [photo(1, ['a', 'b', 'c']), photo(2, ['d'])];
  const out = splitPhoto(items, 1, 1, 9);
  assert.deepEqual(out.map((it) => it.id), [1, 9, 2]);
  assert.deepEqual(names(out[0]), ['a', 'c']);
  assert.deepEqual(names(out[1]), ['b']);
  assert.equal(out[1].status, 'ready');
});

test('splitPhoto: a single photo or an unknown item is left alone', () => {
  const items = [photo(1, ['a'])];
  assert.equal(splitPhoto(items, 1, 0, 9), items);
  assert.equal(splitPhoto(items, 5, 0, 9), items);
});

test('pendingItems: ready and failed are still to do; reading and saved are not', () => {
  const items = ['ready', 'reading', 'saved', 'failed'].map((status, id) => ({ id, status }));
  assert.deepEqual(pendingItems(items).map((it) => it.id), [0, 3]);
});

test('rowFromDraft: saved as needing review, with its link, photos and owner', () => {
  const row = rowFromDraft(
    { title: '  Meringues ', ingredients: ['3 egg whites', ' ', '1 cup sugar'], instructions: ['Whip.'], tags: ['dessert'],
      prep_time_minutes: 20, cook_time_minutes: null, servings: '24' },
    { sourceUrl: A, imageUrls: ['https://x/1.jpg'], createdBy: 'me@example.com' },
  );
  assert.deepEqual(row, {
    title: 'Meringues', description: null, prep_time_minutes: 20, cook_time_minutes: null, servings: '24',
    tags: ['dessert'], ingredients: ['3 egg whites', '1 cup sugar'], instructions: ['Whip.'],
    source_url: A, image_urls: ['https://x/1.jpg'], created_by: 'me@example.com', needs_review: true,
  });
});

test('rowFromDraft: a missing title still saves, as "Untitled recipe"', () => {
  const row = rowFromDraft({ title: '', ingredients: ['1 egg'] });
  assert.equal(row.title, 'Untitled recipe');
  assert.equal(row.source_url, null);
  assert.deepEqual(row.image_urls, []);
  assert.equal(row.needs_review, true);
});
