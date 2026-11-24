/**
 * Edit page URL import, against this checkout's docs/ rather than the live
 * site. Pages are served from disk through request routing and every Supabase
 * call is faked, so no login or deployed function is needed. Only the pinned
 * supabase-js CDN script is fetched for real.
 */
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
const SAMPLE_IMAGE = path.resolve(DOCS, '../sample-photo.jpeg');
const ORIGIN = 'https://recipes.test';
const SUPABASE = 'https://hyxttezhchkihuubyprb.supabase.co';
const LINK = 'https://sugarspunrun.com/meringue-cookie-recipe/';
const EMAIL = 'editor@example.com';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const DRAFT = {
  title: 'Meringue Cookies Recipe',
  ingredients: ['3 large egg whites', '3/4 cup granulated sugar'],
  instructions: ['Preheat oven to 225F.', 'Whip the whites.'],
  tags: [], source_url: LINK,
};

const EMPTY_DRAFT = {
  title: '', ingredients: [], instructions: [], tags: [], source_url: LINK,
  warning: "Couldn't find a structured recipe on that page. You may need to enter the details manually.",
};

const SAVED = {
  id: 31, title: 'Meringue Cookies', description: null, ingredients: [], instructions: [],
  prep_time_minutes: null, cook_time_minutes: null, servings: null, tags: [],
  source_url: LINK, created_by: EMAIL, image_urls: [], notes: null,
  servings_count: null, calories: null, protein_g: null, carbs_g: null, fat_g: null,
  fiber_g: null, sodium_mg: null, nutrition_source: null,
};

function fakeJwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', email: EMAIL, role: 'authenticated', exp: 4102444800 })}.sig`;
}

/** Serve docs/, fake Supabase, and record what the page sent. */
async function setUp(page, { draft = DRAFT, urlError = null } = {}) {
  const calls = { imports: [], photoReads: [], uploads: [], inserts: [], updates: [] };
  const user = { id: 'u1', email: EMAIL, aud: 'authenticated', role: 'authenticated' };
  const session = {
    access_token: fakeJwt(), refresh_token: 'r', token_type: 'bearer',
    expires_in: 3600, expires_at: 4102444800, user,
  };
  await page.addInitScript(([s]) => {
    localStorage.setItem('sb-hyxttezhchkihuubyprb-auth-token', s);
  }, [JSON.stringify(session)]);

  await page.route(`${ORIGIN}/**`, async (route) => {
    let p = new URL(route.request().url()).pathname;
    if (p === '/') p = '/index.html';
    try {
      const body = await readFile(path.join(DOCS, p));
      await route.fulfill({ body, contentType: TYPES[path.extname(p)] || 'application/octet-stream' });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });

  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
  };
  const json = (route, body, status = 200) =>
    route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  await page.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: cors, body: '' });
    const { pathname, searchParams } = new URL(req.url());

    if (pathname === '/rest/v1/rpc/is_editor' || pathname === '/rest/v1/rpc/is_admin') return json(route, true);
    if (pathname === '/rest/v1/rpc/my_household') return json(route, []);
    if (pathname === '/auth/v1/user') return json(route, user);
    if (pathname === '/functions/v1/import-url') {
      calls.imports.push(req.postDataJSON());
      if (urlError) return json(route, { error: urlError }, 502);
      return json(route, draft);
    }
    if (pathname === '/functions/v1/import-photo') {
      calls.photoReads.push(req.postDataJSON());
      return json(route, draft);
    }
    if (pathname.startsWith('/storage/v1/object/recipe-images/')) {
      calls.uploads.push(pathname);
      return json(route, { Key: pathname.replace('/storage/v1/object/', '') });
    }
    if (pathname === '/rest/v1/recipes') {
      if (req.method() === 'POST') { calls.inserts.push(req.postDataJSON()); return json(route, { id: 99 }, 201); }
      if (req.method() === 'PATCH') { calls.updates.push(req.postDataJSON()); return json(route, null, 204); }
      if (searchParams.get('id') === 'eq.31') return json(route, SAVED);
      return json(route, []);
    }
    return json(route, {});
  });

  return calls;
}

const sourceUrl = (page) => page.locator('.form-group', { hasText: 'Source URL' }).locator('input');
const titleInput = (page) => page.getByPlaceholder("e.g. Grandma's Banana Bread");
const ingredientInputs = (page) => page.getByPlaceholder('1 cup flour');
const saveButton = (page) => page.getByRole('button', { name: 'Save recipe' });
// The link box is in the page twice (new-recipe choice and edit refill); only one shows.
const linkInput = (page) => page.getByPlaceholder('Paste a recipe URL').filter({ visible: true });
const importButton = (page) => page.getByRole('button', { name: 'Import', exact: true }).filter({ visible: true });
const choice = (page, name) => page.getByRole('button', { name: new RegExp(name) });

/** Open a new recipe and pick "Type it in", which shows the blank form. */
async function startTyping(page) {
  await page.goto(`${ORIGIN}/edit.html`);
  await choice(page, 'Type it in').click();
  await expect(titleInput(page)).toBeVisible();
}

test('new recipe: asks where it is from before showing the form', async ({ page }) => {
  await setUp(page);
  await page.goto(`${ORIGIN}/edit.html`);
  await expect(page.getByRole('heading', { name: "Where's this recipe from?" })).toBeVisible();
  for (const name of ['A link', 'A screenshot', 'A photo', 'A PDF', 'Type it in']) {
    await expect(choice(page, name)).toBeVisible();
  }
  await expect(titleInput(page)).toBeHidden();
  await expect(saveButton(page)).toBeHidden();
});

test('new recipe: "Type it in" shows the blank form straight away', async ({ page }) => {
  await setUp(page);
  await startTyping(page);
  await expect(page.getByText('✍️ Typing it in')).toBeVisible();
  await expect(saveButton(page)).toBeVisible();
  await expect(choice(page, 'A screenshot')).toBeHidden();
});

test('new recipe: link choice imports, then shows the filled form', async ({ page }) => {
  const calls = await setUp(page);
  await page.goto(`${ORIGIN}/edit.html`);
  await choice(page, 'A link').click();
  await expect(titleInput(page)).toBeHidden();

  await linkInput(page).fill(LINK);
  await importButton(page).click();
  await expect(ingredientInputs(page).first()).toBeVisible();
  await expect(ingredientInputs(page).first()).toHaveValue('3 large egg whites');
  await expect(titleInput(page)).toHaveValue(DRAFT.title);
  await expect(sourceUrl(page)).toHaveValue(LINK);
  expect(calls.imports).toEqual([{ url: LINK }]);
});

test('new recipe: a failed link import keeps the form hidden and says why', async ({ page }) => {
  await setUp(page, { urlError: 'Could not fetch that URL' });
  await page.goto(`${ORIGIN}/edit.html`);
  await choice(page, 'A link').click();
  await linkInput(page).fill(LINK);
  await importButton(page).click();
  await expect(page.locator('.auth-notice--error')).toContainText('Import failed');
  await expect(titleInput(page)).toBeHidden();
});

test('new recipe: screenshot choice reads it with Gemini, keeps it, and shows the form', async ({ page }) => {
  const calls = await setUp(page);
  await page.goto(`${ORIGIN}/edit.html`);
  await choice(page, 'A screenshot').click();
  await expect(page.getByText('📱 From a screenshot')).toBeVisible();
  // Screenshots come from the library, not the camera.
  await expect(page.locator('.import-tile').getByRole('button', { name: /Take a photo/ })).toBeHidden();

  await page.locator('input[x-ref="screenshot"]').setInputFiles(SAMPLE_IMAGE);
  await expect(ingredientInputs(page).first()).toBeVisible();
  await expect(ingredientInputs(page).first()).toHaveValue('3 large egg whites');
  expect(calls.photoReads).toHaveLength(1);
  expect(calls.photoReads[0].images).toHaveLength(1);
  expect(calls.uploads).toHaveLength(1);
  await expect(page.locator('.image-thumb')).toHaveCount(1);
});

test('new recipe: photo choice offers the camera too', async ({ page }) => {
  await setUp(page);
  await page.goto(`${ORIGIN}/edit.html`);
  await choice(page, 'A photo').click();
  await expect(page.locator('.import-tile').getByRole('button', { name: /Take a photo/ })).toBeVisible();
  await expect(page.locator('input[x-ref="photo"]')).toBeVisible();
});

test('new recipe: Change goes back to the choices', async ({ page }) => {
  await setUp(page);
  await page.goto(`${ORIGIN}/edit.html`);
  await choice(page, 'A PDF').click();
  await expect(page.locator('input[x-ref="pdf"]')).toBeVisible();
  await page.getByRole('button', { name: 'Change' }).click();
  await expect(choice(page, 'A link')).toBeVisible();
  await expect(page.locator('input[x-ref="pdf"]')).toBeHidden();
});

test('new recipe: saving with only a Source URL imports it for review first', async ({ page }) => {
  const calls = await setUp(page);
  await startTyping(page);
  await titleInput(page).fill('Meringue Cookies');
  await sourceUrl(page).fill(LINK);

  await saveButton(page).click();
  await expect(ingredientInputs(page).first()).toHaveValue('3 large egg whites');
  expect(calls.imports).toEqual([{ url: LINK }]);
  expect(calls.inserts).toEqual([]);
  // The title the person typed is kept over the page's.
  await expect(titleInput(page)).toHaveValue('Meringue Cookies');

  await saveButton(page).click();
  await expect.poll(() => calls.inserts.length).toBe(1);
  expect(calls.inserts[0]).toMatchObject({
    title: 'Meringue Cookies', source_url: LINK,
    ingredients: DRAFT.ingredients, instructions: DRAFT.instructions,
  });
  expect(calls.imports).toHaveLength(1);
});

test('new recipe: a page with no readable recipe still saves on the second tap', async ({ page }) => {
  const calls = await setUp(page, { draft: EMPTY_DRAFT });
  await startTyping(page);
  await titleInput(page).fill('Meringue Cookies');
  await sourceUrl(page).fill(LINK);

  await saveButton(page).click();
  await expect(page.locator('.import-warning')).toContainText("Couldn't find a structured recipe");
  expect(calls.inserts).toEqual([]);

  await saveButton(page).click();
  await expect.poll(() => calls.inserts.length).toBe(1);
  expect(calls.inserts[0]).toMatchObject({ title: 'Meringue Cookies', ingredients: [], instructions: [] });
  expect(calls.imports).toHaveLength(1);
});

test('new recipe: ingredients already typed means save goes straight through', async ({ page }) => {
  const calls = await setUp(page);
  await startTyping(page);
  await titleInput(page).fill('Meringue Cookies');
  await ingredientInputs(page).first().fill('3 egg whites');
  await sourceUrl(page).fill(LINK);

  await saveButton(page).click();
  await expect.poll(() => calls.inserts.length).toBe(1);
  expect(calls.imports).toEqual([]);
});

test('editing: the link import shows, pre-filled from Source URL, and fills the recipe', async ({ page }) => {
  const calls = await setUp(page);
  await page.goto(`${ORIGIN}/edit.html?id=31`);

  await expect(page.getByRole('heading', { name: 'Fill from a link' })).toBeVisible();
  const linkBox = linkInput(page);
  await expect(linkBox).toBeVisible();
  await expect(linkBox).toHaveValue(LINK);
  // No source picker when editing — straight to the form.
  await expect(page.getByRole('heading', { name: "Where's this recipe from?" })).toBeHidden();
  await expect(titleInput(page)).toHaveValue('Meringue Cookies');

  await importButton(page).click();
  await expect(ingredientInputs(page).first()).toHaveValue('3 large egg whites');
  expect(calls.imports).toEqual([{ url: LINK }]);
  expect(calls.updates).toEqual([]);
});