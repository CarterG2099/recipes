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
- The edit page's redirect-if-not-editor is **UX only**; RLS is the real boundary.
- `import-url` re-checks `is_editor()` with the caller's JWT so it can't be used
  as an open URL-fetch proxy.

## Imports

- URL: `import-url` Edge Function — fetch + schema.org/Recipe JSON-LD parsing
  (handles `@graph`, HowToStep, HowToSection, ISO-8601 durations). Returns a
  draft; never writes.
- PDF: in-browser via pdf.js (loaded from jsdelivr). Heuristic Ingredients/
  Instructions header split; text PDFs only — image/scanned PDFs yield a warning.

## Gotchas

- **Repo must stay public** for free GitHub Pages. Never commit secrets — `.env`,
  `client_secret*.json` are gitignored. The Supabase anon key is safe to expose.
- **CSP** is a `<meta http-equiv>` tag in each HTML file (GitHub Pages can't set
  headers). It must allow `cdn.jsdelivr.net` (supabase-js + pdf.js), `'unsafe-eval'`
  (Alpine), `blob:` workers (pdf.js), and `*.supabase.co` connections.
- The supabase-js CDN `<script>` is SRI-pinned; bump the hash if you change the
  version.
- Free Supabase projects pause after ~7 days idle — the `keepalive` function +
  an uptime monitor prevent that.
- Edit/recipe links use real `.html` paths (`/recipe.html?id=…`) because Pages
  has no server-side routing.

## Deploying Edge Functions

Via the Supabase MCP (`deploy_edge_function`) or the Supabase CLI. Keep
`keepalive` at `verify_jwt = false` and `import-url` at `verify_jwt = true`.
