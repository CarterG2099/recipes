/**
 * Bulk add: links, photos and PDFs gathered, grouped, read one at a time and
 * saved as needing review. Against docs/ with Supabase faked (see fakes.mjs).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setUp, ORIGIN, LINK, SAMPLE_IMAGE, PDF, DRAFT, EMPTY_DRAFT } from './fakes.mjs';

const LINK2 = 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/';
// Playwright won't mix file paths and buffers in one pick, so the photo comes as a buffer too.
const IMG = { name: 'card.jpeg', mimeType: 'image/jpeg', buffer: readFileSync(SAMPLE_IMAGE) };

const linksBox = (page) => page.getByLabel('Recipe links');
const filePick = (page) => page.locator('input[x-ref="filePick"]');
const rows = (page) => page.locator('.bulk-item');
const addButton = (page) => page.getByRole('button', { name: /^Add \d+ recipes?$/ });

async function open(page) {
  await page.goto(`${ORIGIN}/bulk.html`);
  await expect(page.getByRole('heading', { name: 'Add several recipes' })).toBeVisible();
}

test('bulk: the new-recipe screen links to bulk add', async ({ page }) => {
  await setUp(page);
  await page.goto(`${ORIGIN}/edit.html`);
  await page.getByRole('link', { name: /Add several at once/ }).click();
  await expect(page).toHaveURL(`${ORIGIN}/bulk.html`);
  await expect(page.getByRole('heading', { name: 'Add several recipes' })).toBeVisible();
});

test('bulk: pasted links become one recipe each, then all are read and saved as needing review', async ({ page }) => {
  const calls = await setUp(page, { draft: (body) => ({ ...DRAFT, title: body.url === LINK ? 'Meringues' : 'Cookies' }) });
  await open(page);
  await expect(addButton(page)).toBeHidden();

  // A share-sheet paste: words around the links, and a repeat.
  await linksBox(page).fill(`Meringue Cookies — Sugar Spun Run ${LINK}\n${LINK2}\n${LINK}`);
  await linksBox(page).dispatchEvent('paste');
  await expect(rows(page)).toHaveCount(2);
  await expect(linksBox(page)).toHaveValue('');
  await expect(rows(page).first()).toContainText('sugarspunrun.com/meringue-cookie-recipe/');

  // Adding the same link again is skipped.
  await linksBox(page).fill(LINK);
  await page.getByRole('button', { name: 'Add links' }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByText('Links already in the list were skipped.')).toBeVisible();

  await addButton(page).click();
  await expect(page.locator('.bulk-status.saved:visible')).toHaveCount(2);
  expect(calls.imports).toEqual([{ url: LINK }, { url: LINK2 }]);
  expect(calls.inserts).toHaveLength(2);
  expect(calls.inserts[0]).toMatchObject({
    title: 'Meringues', source_url: LINK, needs_review: true, created_by: 'editor@example.com',
    ingredients: DRAFT.ingredients, instructions: DRAFT.instructions, image_urls: [],
  });
  expect(calls.inserts[1]).toMatchObject({ title: 'Cookies', source_url: LINK2, needs_review: true });

  await expect(rows(page).first()).toContainText('Meringues');
  await expect(rows(page).first().getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/edit.html?id=99');
  await expect(page.locator('.bulk-done')).toContainText('2 recipes saved.');
  await expect(page.getByRole('link', { name: /See them all/ })).toHaveAttribute('href', '/?review=1');
  await expect(addButton(page)).toBeHidden();
});

test('bulk: text with no links says so and adds nothing', async ({ page }) => {
  await setUp(page);
  await open(page);
  await linksBox(page).fill('grandma cookies');
  await page.getByRole('button', { name: 'Add links' }).click();
  await expect(page.getByText("couldn't find any web links")).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});

test('bulk: photos start as one recipe each and can be grouped and split', async ({ page }) => {
  const calls = await setUp(page);
  await open(page);
  await filePick(page).setInputFiles([SAMPLE_IMAGE, SAMPLE_IMAGE, SAMPLE_IMAGE]);
  await expect(rows(page)).toHaveCount(3);
  await expect(addButton(page)).toHaveText('Add 3 recipes');
  await expect.poll(() => rows(page).first().locator('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Group photos' }).click();
  const group = page.getByRole('button', { name: /Group \d into one recipe|Pick 2 or more/ });
  await expect(group).toBeDisabled();
  await rows(page).nth(0).click();
  await rows(page).nth(2).click();
  await expect(group).toHaveText('Group 2 into one recipe');
  await group.click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first().locator('img')).toHaveCount(2);
  await expect(rows(page).first()).toContainText('Read together as one recipe');

  // Pull one back out, then put it back.
  await rows(page).first().getByRole('button', { name: /Make photo 2 its own recipe/ }).click();
  await expect(rows(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Group photos' }).click();
  await rows(page).nth(0).click();
  await rows(page).nth(1).click();
  await page.getByRole('button', { name: 'Group 2 into one recipe' }).click();
  await expect(rows(page)).toHaveCount(2);

  await addButton(page).click();
  await expect(page.locator('.bulk-status.saved:visible')).toHaveCount(2);
  expect(calls.photoReads.map((r) => r.images.length)).toEqual([2, 1]);
  expect(calls.uploads).toHaveLength(3);
  expect(calls.inserts.map((r) => r.image_urls.length)).toEqual([2, 1]);
  expect(calls.inserts.every((r) => r.needs_review === true)).toBe(true);
});

test('bulk: a PDF is read as its own recipe without storing it as a photo', async ({ page }) => {
  const calls = await setUp(page);
  await open(page);
  await filePick(page).setInputFiles([PDF, IMG]);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('recipe.pdf');
  await addButton(page).click();
  await expect(page.locator('.bulk-status.saved:visible')).toHaveCount(2);
  expect(calls.photoReads[0].images).toEqual([{ imageBase64: PDF.buffer.toString('base64'), mimeType: 'application/pdf' }]);
  expect(calls.uploads).toHaveLength(1);
  expect(calls.inserts[0].image_urls).toEqual([]);
});

test('bulk: other kinds of file are skipped with a note', async ({ page }) => {
  await setUp(page);
  await open(page);
  await filePick(page).setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }, IMG]);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByText('1 file(s) skipped')).toBeVisible();
});

test('bulk: a failure is shown on its row, the rest still save, and Retry tries again', async ({ page }) => {
  let down = true;
  const calls = await setUp(page, { urlError: (body) => (down && body.url === LINK2 ? 'Could not fetch that URL' : null) });
  await open(page);
  await linksBox(page).fill(`${LINK}\n${LINK2}`);
  await page.getByRole('button', { name: 'Add links' }).click();
  await addButton(page).click();

  const bad = rows(page).nth(1);
  await expect(bad.locator('.bulk-status.failed')).toContainText("couldn't open that page");
  await expect(rows(page).nth(0).locator('.bulk-status.saved:visible')).toBeVisible();
  expect(calls.inserts).toHaveLength(1);
  await expect(page.locator('.bulk-done')).toContainText("1 couldn't be read");
  await expect(page.getByRole('button', { name: 'Try 1 again' })).toBeVisible();

  down = false;
  await bad.getByRole('button', { name: 'Retry' }).click();
  await expect(bad.locator('.bulk-status.saved:visible')).toBeVisible();
  expect(calls.inserts).toHaveLength(2);
  expect(calls.imports.map((b) => b.url)).toEqual([LINK, LINK2, LINK2]);
});

test('bulk: a page or picture with no recipe is a failure, not an empty save', async ({ page }) => {
  const calls = await setUp(page, { draft: EMPTY_DRAFT });
  await open(page);
  await linksBox(page).fill(LINK);
  await page.getByRole('button', { name: 'Add links' }).click();
  await filePick(page).setInputFiles(SAMPLE_IMAGE);
  await addButton(page).click();
  await expect(rows(page).nth(0).locator('.bulk-status.failed')).toContainText('No recipe found');
  await expect(rows(page).nth(1).locator('.bulk-status.failed')).toContainText("Couldn't make out a recipe");
  expect(calls.inserts).toEqual([]);
});

test('bulk: an item can be removed before reading', async ({ page }) => {
  const calls = await setUp(page);
  await open(page);
  await linksBox(page).fill(`${LINK}\n${LINK2}`);
  await page.getByRole('button', { name: 'Add links' }).click();
  await rows(page).first().getByRole('button', { name: 'Remove' }).click();
  await expect(rows(page)).toHaveCount(1);
  await addButton(page).click();
  await expect(page.locator('.bulk-status.saved:visible')).toHaveCount(1);
  expect(calls.imports).toEqual([{ url: LINK2 }]);
});
