/**
 * The in-app camera on the edit and bulk pages, with Chromium's fake camera
 * (a moving test pattern) standing in for a real one. Supabase is faked (see
 * fakes.mjs).
 */
import { test, expect } from '@playwright/test';
import { setUp, ORIGIN } from './fakes.mjs';

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['camera'],
});

const camera = (page) => page.getByRole('dialog', { name: 'Camera' });
const shutter = (page) => page.getByRole('button', { name: 'Take photo', exact: true });

/** Take `n` shots, waiting for each to land in the strip. */
async function snap(page, n) {
  await expect(shutter(page)).toBeEnabled();
  for (let i = 1; i <= n; i++) {
    await shutter(page).click();
    await expect(page.locator('.cam-shot')).toHaveCount(i);
  }
}

test('camera: new recipe photo step takes several shots in a row and adds them all', async ({ page }) => {
  const calls = await setUp(page);
  await page.goto(`${ORIGIN}/edit.html`);
  await page.getByRole('button', { name: /A photo/ }).click();
  await page.getByRole('button', { name: /Take photos/ }).click();
  await expect(camera(page)).toBeVisible();
  await snap(page, 2);
  await page.getByRole('button', { name: 'Done (2)' }).click();
  await expect(camera(page)).toHaveCount(0);
  await expect(page.locator('.file-thumb')).toHaveCount(2);
  await expect.poll(() => page.locator('.file-thumb img').first().evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByPlaceholder('1 cup flour').first()).toHaveValue('3 large egg whites');
  expect(calls.photoReads[0].images).toHaveLength(2);
  expect(calls.photoReads[0].images.every((i) => i.mimeType === 'image/jpeg')).toBe(true);
});

test('camera: tapping a shot removes it, and closing keeps nothing', async ({ page }) => {
  await setUp(page);
  await page.goto(`${ORIGIN}/edit.html`);
  await page.getByRole('button', { name: /A photo/ }).click();
  await page.getByRole('button', { name: /Take photos/ }).click();
  await snap(page, 2);
  await page.getByRole('button', { name: 'Remove photo 1' }).click();
  await expect(page.locator('.cam-shot')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Done (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Close camera' }).click();
  await expect(camera(page)).toHaveCount(0);
  await expect(page.locator('.file-thumb')).toHaveCount(0);
});

test('camera: the form\'s Photos card stores the shots with the recipe', async ({ page }) => {
  const calls = await setUp(page);
  await page.goto(`${ORIGIN}/edit.html?id=31`);
  await expect(page.getByPlaceholder("e.g. Grandma's Banana Bread")).toHaveValue('Meringue Cookies');
  await page.getByRole('button', { name: /Take photos/ }).click();
  await snap(page, 1);
  await page.getByRole('button', { name: 'Done (1)' }).click();
  await expect(page.locator('.image-thumb')).toHaveCount(1);
  expect(calls.uploads).toHaveLength(1);
  expect(calls.photoReads).toEqual([]);
});

test('camera: bulk add takes a stack of cards, one recipe per shot', async ({ page }) => {
  await setUp(page);
  await page.goto(`${ORIGIN}/bulk.html`);
  await page.getByRole('button', { name: /Take photos/ }).click();
  await snap(page, 3);
  await page.getByRole('button', { name: 'Done (3)' }).click();
  await expect(page.locator('.bulk-item')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Add 3 recipes' })).toBeVisible();
});

test('camera: when access is blocked it says so and offers the phone camera', async ({ page }) => {
  await setUp(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await page.goto(`${ORIGIN}/bulk.html`);
  await page.getByRole('button', { name: /Take photos/ }).click();
  await expect(camera(page)).toContainText("We can't use the camera here");
  await expect(shutter(page)).toBeDisabled();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: "Use the phone's camera" }).click();
  await (await chooser).setFiles({ name: 'card.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await expect(camera(page)).toHaveCount(0);
  await expect(page.locator('.bulk-item')).toHaveCount(1);
});
