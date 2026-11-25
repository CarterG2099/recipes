/**
 * Shared set-up for the browser tests that run against this checkout's docs/
 * rather than the live site. Pages are served from disk through request
 * routing and every Supabase call is faked, so no login or deployed function is
 * needed. Only the pinned supabase-js CDN script is fetched for real.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs');
export const SAMPLE_IMAGE = path.resolve(DOCS, '../sample-photo.jpeg');
export const ORIGIN = 'https://recipes.test';
export const SUPABASE = 'https://hyxttezhchkihuubyprb.supabase.co';
export const LINK = 'https://sugarspunrun.com/meringue-cookie-recipe/';
export const EMAIL = 'editor@example.com';
export const PDF = { name: 'recipe.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') };

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

export const DRAFT = {
  title: 'Meringue Cookies Recipe',
  ingredients: ['3 large egg whites', '3/4 cup granulated sugar'],
  instructions: ['Preheat oven to 225F.', 'Whip the whites.'],
  tags: [], source_url: LINK,
};

export const EMPTY_DRAFT = {
  title: '', ingredients: [], instructions: [], tags: [], source_url: LINK,
  warning: "Couldn't find a structured recipe on that page. You may need to enter the details manually.",
};

export const SAVED = {
  id: 31, title: 'Meringue Cookies', description: null, ingredients: [], instructions: [],
  prep_time_minutes: null, cook_time_minutes: null, servings: null, tags: [],
  source_url: LINK, created_by: EMAIL, image_urls: [], notes: null, is_favorite: false, needs_review: false,
  servings_count: null, calories: null, protein_g: null, carbs_g: null, fat_g: null,
  fiber_g: null, sodium_mg: null, nutrition_source: null, created_at: '2026-01-01T00:00:00Z',
};

function fakeJwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', email: EMAIL, role: 'authenticated', exp: 4102444800 })}.sig`;
}

// An option may be a value, or a function of the request body that returns one.
const pick = (v, arg) => (typeof v === 'function' ? v(arg) : v);

/**
 * Serve docs/, fake Supabase as a signed-in editor, and record what the page sent.
 *   draft      — what both readers return (or (body) => draft)
 *   urlError   — import-url fails with this message (or (body) => message|null)
 *   photoError — import-photo fails with this message (or (body) => message|null)
 *   recipes    — rows for the browse list and for ?id= lookups (SAVED is id 31)
 */
export async function setUp(page, { draft = DRAFT, urlError = null, photoError = null, recipes = [SAVED] } = {}) {
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
      const body = req.postDataJSON();
      calls.imports.push(body);
      const err = pick(urlError, body);
      if (err) return json(route, { error: err }, 502);
      return json(route, pick(draft, body));
    }
    if (pathname === '/functions/v1/import-photo') {
      const body = req.postDataJSON();
      calls.photoReads.push(body);
      const err = pick(photoError, body);
      if (err) return json(route, { error: err }, 502);
      return json(route, pick(draft, body));
    }
    if (pathname.startsWith('/storage/v1/object/recipe-images/')) {
      calls.uploads.push(pathname);
      return json(route, { Key: pathname.replace('/storage/v1/object/', '') });
    }
    if (pathname === '/rest/v1/recipes') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        calls.inserts.push(body);
        return json(route, { id: 99 + calls.inserts.length - 1, title: body.title }, 201);
      }
      if (req.method() === 'PATCH') {
        calls.updates.push({ id: searchParams.get('id'), body: req.postDataJSON() });
        return json(route, null, 204);
      }
      const id = searchParams.get('id');
      if (id) return json(route, recipes.find((r) => `eq.${r.id}` === id) ?? null);
      return json(route, recipes);
    }
    return json(route, {});
  });

  return calls;
}
