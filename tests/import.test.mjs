import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities } from '../supabase/functions/import-url/entities.js';

test('decodeEntities: &nbsp; becomes a plain space and doubled spaces collapse', () => {
  assert.equal(
    decodeEntities('Stir in vanilla extract.&nbsp; If using food coloring, add it now.'),
    'Stir in vanilla extract. If using food coloring, add it now.',
  );
  assert.equal(decodeEntities('1&#160;cup sugar'), '1 cup sugar');
  assert.equal(decodeEntities('1 cup'), '1 cup');
});

test('decodeEntities: common named entities', () => {
  assert.equal(decodeEntities('Salt &amp; pepper'), 'Salt & pepper');
  assert.equal(decodeEntities('&quot;soft peaks&quot;'), '"soft peaks"');
  assert.equal(decodeEntities('Bake at 350&deg;F'), 'Bake at 350°F');
  assert.equal(decodeEntities('&frac12; cup'), '½ cup');
  assert.equal(decodeEntities('Mom&rsquo;s'), 'Mom’s');
});

test('decodeEntities: decimal and hex numeric entities', () => {
  assert.equal(decodeEntities('Mom&#39;s'), "Mom's");
  assert.equal(decodeEntities('Mom&#x27;s'), "Mom's");
  assert.equal(decodeEntities('Mom&#X27;s'), "Mom's");
});

test('decodeEntities: double-encoded entities are fully decoded', () => {
  assert.equal(decodeEntities('vanilla.&amp;nbsp; Then'), 'vanilla. Then');
  assert.equal(decodeEntities('Salt &amp;amp; pepper'), 'Salt & pepper');
});

test('decodeEntities: leaves unknown entities and plain ampersands alone', () => {
  assert.equal(decodeEntities('&bogus; stays'), '&bogus; stays');
  assert.equal(decodeEntities('&constructor; stays'), '&constructor; stays');
  assert.equal(decodeEntities('Salt & pepper'), 'Salt & pepper');
  assert.equal(decodeEntities('&#xZZ; stays'), '&#xZZ; stays');
});

test('decodeEntities: trims', () => {
  assert.equal(decodeEntities('  Whisk  '), 'Whisk');
  assert.equal(decodeEntities('&nbsp;Whisk&nbsp;'), 'Whisk');
});
