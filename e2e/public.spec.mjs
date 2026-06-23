/**
 * Public end-to-end flows — what your mom does most: browse and cook.
 * These need no login (reading is public). Editing/import/admin require Google
 * OAuth, which can't be scripted here; cover those with a manual phone pass
 * (or a saved storageState if you want to extend this later).
 *
 * Runs against BASE_URL (default: the live site). Needs ≥1 recipe to exist.
 */
import { test, expect } from '@playwright/test';

test('home lists recipes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-logo')).toContainText("Mom's Kitchen");
  await expect(page.locator('.recipe-row').first()).toBeVisible();
});

test('search narrows then restores the list', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.recipe-row').first()).toBeVisible();
  const before = await page.locator('.recipe-row').count();
  await page.fill('input[type=search]', 'zzz-not-a-real-recipe');
  await expect(page.locator('.recipe-row')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.fill('input[type=search]', '');
  await expect(page.locator('.recipe-row')).toHaveCount(before);
});

test('A–Z sort orders the titles', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.recipe-row').first()).toBeVisible();
  await page.selectOption('.browse-sort', 'az');
  const titles = (await page.locator('.recipe-row .row-title').allTextContents()).map((t) => t.trim());
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
});

test('recipe: scale, US/Metric convert, and cook mode', async ({ page }) => {
  await page.goto('/');
  await page.locator('.recipe-row').first().click();
  await expect(page.locator('.recipe-detail h1')).toBeVisible();
  await expect(page.locator('.ingredient-list li').first()).toBeVisible();

  // Scale up a batch → label reflects it.
  await page.locator('.scale-control .btn-icon', { hasText: '+' }).click();
  await expect(page.locator('.scale-value')).toHaveText('1 ½×');

  // Convert to metric → at least one ingredient shows a metric unit.
  await page.getByRole('button', { name: 'Metric', exact: true }).click();
  await expect(page.locator('.ingredient-list')).toContainText(/\b(ml|g|L|kg)\b/);

  // Cook mode: open, ingredients sheet, step navigation, close.
  await page.getByRole('button', { name: /Cook mode/ }).click();
  await expect(page.locator('.cook-overlay')).toBeVisible();
  await expect(page.locator('.cook-step')).toBeVisible();
  await page.getByRole('button', { name: /Ingredients/ }).click();
  await expect(page.locator('.cook-sheet.open')).toBeVisible();
  await page.getByRole('button', { name: /Done|✕ Done/ }).first().click();
  await expect(page.locator('.cook-overlay')).toBeHidden();
});

test('tap-to-check strikes an ingredient through', async ({ page }) => {
  await page.goto('/');
  await page.locator('.recipe-row').first().click();
  const first = page.locator('.ingredient-list.checkable li').first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(first).toHaveClass(/checked/);
});
