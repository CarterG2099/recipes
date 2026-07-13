# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Recipe site for `recipes.cartergividen.com`: public browse, allowlisted Google
login to edit. **No app server.** A static frontend (GitHub Pages, served from
`docs/`) talks to Supabase directly via `supabase-js`. Backend logic that can't
live in the browser is in Supabase Edge Functions.

This replaced an earlier FastAPI-on-Render design (see git history) to stay
completely free — the FastAPI backend was retired.

## Layout

```
docs/                     # the entire frontend = GitHub Pages site root
  index.html              # browse (search + tag filter)
  recipe.html             # detail (?id=)
  edit.html               # create/edit (?id=), editor-only
  CNAME                    # recipes.cartergividen.com
  js/supabase.js          # supabase client + anon key (public) + auth helpers
  js/store.js             # Alpine auth + ui stores
  js/pages/*.js           # per-page logic, keyed off <body data-page>
  css/*                   # tokens → base → components → pages (shared w/ budget)
supabase/
  schema.sql              # tables, RLS, is_editor() — re-runnable
  functions/import-url/   # URL → JSON-LD recipe draft (verify_jwt = true)
  functions/keepalive/    # DB-touch ping for uptime monitor (verify_jwt = false)
```

## Access model (do not regress)

- Browser uses the **anon key only**; there is no service-role key anywhere in
  this repo or the frontend.
- **Reads are public** via the `recipes_public_read` RLS policy.
- **Writes require an allowlisted editor**: RLS insert/update/delete policies
  call `is_editor()`, which checks the logged-in email against `allowed_emails`.
  `is_editor()` is SECURITY DEFINER (the table is otherwise unreadable).
- **Admins** are allowlist rows with `is_admin=true` (also editors). The `/admin.html`
  page lets them add/remove editors and grant/revoke admin, reading/writing
  `allowed_emails` directly under admin-only RLS policies (`is_admin()`).
- The edit/admin page redirect-if-not-allowed is **UX only**; RLS is the real boundary.
- **Serving scaler**: `recipe.js` scales ingredient quantities client-side in ½
  steps by parsing the leading number/fraction/range of each free-text line — no
  structured ingredient data. (Metric↔imperial conversion would need structured
  units; deliberately deferred.)
- `import-url` re-checks `is_editor()` with the caller's JWT so it can't be used
  as an open URL-fetch proxy.

## Imports

All three return an unsaved draft that pre-fills the edit form for human review;
nothing is auto-saved.

- URL: `import-url` Edge Function — fetch + schema.org/Recipe JSON-LD parsing
  (handles `@graph`, HowToStep, HowToSection, ISO-8601 durations).
- PDF: in-browser via pdf.js (loaded from jsdelivr). Heuristic Ingredients/
  Instructions header split; text PDFs only — image/scanned PDFs yield a warning.
- Photo (incl. handwritten cards): `import-photo` Edge Function calls the Google
  **Gemini** API (free tier, `gemini-3.5-flash`, set via the GEMINI_MODEL secret) with a JSON response schema. The
  `GEMINI_API_KEY` is a function secret (Supabase dashboard), never in the browser.
  `importPhoto()` accepts several photos at once (e.g. front and back of a
  card) and sends them as one Gemini request that returns one combined draft;
  it also uploads each photo to Storage and appends it to `image_urls`, so one
  action both reads the card and keeps it.

## Images

- `recipes.image_urls` is a `text[]` of public URLs in the `recipe-images`
  Storage bucket (public read; editor-only writes via `is_editor()`). Uploaded
  with supabase-js; the edit page accepts multiple photos per recipe.
- Shown on the recipe detail page; the browse list stays text-only.

## Design

Fresh & bright palette in `tokens.css` (sage `#5E9C76`, honey `#E8A33D`, soft white).
Display font is **Quicksand** via Google Fonts. Browse page is a numbered cookbook
index (list rows), not a grid. No dark mode. Logo/name: "Mom's Kitchen".

## Gotchas

- **Repo must stay public** for free GitHub Pages. Never commit secrets — `.env`,
  `client_secret*.json` are gitignored. The Supabase anon key is safe to expose.
- **CSP** is a `<meta http-equiv>` tag in each HTML file (GitHub Pages can't set
  headers). It must allow `cdn.jsdelivr.net` (supabase-js + pdf.js),
  `fonts.googleapis.com`/`fonts.gstatic.com` (Quicksand), `'unsafe-eval'` (Alpine),
  `blob:` workers (pdf.js), and `*.supabase.co` connections.
- The supabase-js CDN `<script>` is SRI-pinned; bump the hash if you change the
  version.
- Free Supabase projects pause after ~7 days idle — the `keepalive` function +
  an uptime monitor prevent that.
- Edit/recipe links use real `.html` paths (`/recipe.html?id=…`) because Pages
  has no server-side routing.

## Deploying Edge Functions

Via the Supabase MCP (`deploy_edge_function`) or the Supabase CLI. Keep
`keepalive` at `verify_jwt = false` and `import-url` at `verify_jwt = true`.
