/**
 * "Needs review" on the browse list and the recipe page, for recipes bulk add
 * saved before anyone checked them. Supabase is faked (see fakes.mjs).
 */
import { test, expect } from '@playwright/test';
import { setUp, ORIGIN, SAVED, EMAIL } from './fakes.mjs';

const recipe = (id, title, needs_review) => ({ ...SAVED, id, title, needs_review, created_by: EMAIL });
const RECIPES = [recipe(31, 'Meringue Cookies', false), recipe(32, 'Gnocchi Soup', true), recipe(33, 'Banana Bread', true)];

const titles = (page) => page.locator('.recipe-row .row-title > span:nth-child(2)');
const reviewChip = (page) => page.getByRole('button', { name: /Needs review/ });

test('browse: a Needs review filter with a count, and a badge on each one', async ({ page }) => {
  await setUp(page, { recipes: RECIPES });
  await page.goto(`${ORIGIN}/`);
  await expect(titles(page)).toHaveText(['Meringue Cookies', 'Gnocchi Soup', 'Banana Bread']);
  await expect(reviewChip(page)).toContainText('2');
  await expect(page.locator('.review-badge:visible')).toHaveCount(2);

  await reviewChip(page).click();
  await expect(titles(page)).toHaveText(['Gnocchi Soup', 'Banana Bread']);
  await reviewChip(page).click();
  await expect(titles(page)).toHaveCount(3);
});

test('browse: ?review=1 (where bulk add sends you) opens with the filter on', async ({ page }) => {
  await setUp(page, { recipes: RECIPES });
  await page.goto(`${ORIGIN}/?review=1`);
  await expect(titles(page)).toHaveText(['Gnocchi Soup', 'Banana Bread']);
  await expect(reviewChip(page)).toHaveClass(/active/);
});

test('browse: no filter when nothing needs review', async ({ page }) => {
  await setUp(page, { recipes: [recipe(31, 'Meringue Cookies', false)] });
  await page.goto(`${ORIGIN}/`);
  await expect(titles(page)).toHaveText(['Meringue Cookies']);
  await expect(reviewChip(page)).toBeHidden();
});

test('recipe: a banner offers Edit or Looks good, and Looks good clears it', async ({ page }) => {
  const calls = await setUp(page, { recipes: RECIPES });
  await page.goto(`${ORIGIN}/recipe.html?id=32`);
  const banner = page.locator('.review-banner');
  await expect(banner).toContainText('Needs review');
  await expect(banner.getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/edit.html?id=32');

  await banner.getByRole('button', { name: /Looks good/ }).click();
  await expect(banner).toBeHidden();
  expect(calls.updates).toEqual([{ id: 'eq.32', body: { needs_review: false } }]);
});

test('recipe: no banner on a recipe that is already reviewed', async ({ page }) => {
  await setUp(page, { recipes: RECIPES });
  await page.goto(`${ORIGIN}/recipe.html?id=31`);
  await expect(page.locator('.recipe-detail h1')).toHaveText('Meringue Cookies');
  await expect(page.locator('.review-banner')).toBeHidden();
});
