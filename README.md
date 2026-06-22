# Recipes

A recipe site for `recipes.cartergividen.com` — public to browse, allowlisted
Google login to edit. **No application server**: a static frontend (hosted on
GitHub Pages) talks to Supabase directly.

## Architecture

```
Browser (static HTML + Alpine.js + supabase-js)   ← GitHub Pages (docs/)
    │  reads / writes (RLS-enforced)        ┌──────────────────────────────┐
    ├───────────────────────────────────────► Supabase Postgres + Auth     │
    │  URL import (POST)                     │  - recipes (public read,     │
    ├───────────────────────────────────────►   editor-only write via RLS) │
    │                                        │  - is_editor() gate          │
    └─ PDF import runs in-browser (pdf.js)   │  Edge Functions:             │
                                             │  - import-url (editor-only)  │
                                             │  - keepalive (public ping)   │
                                             └──────────────────────────────┘
```

- **Reading** is public: the browser queries Supabase with the anon key; the
  `recipes_public_read` RLS policy allows it.
- **Editing** requires a Google login whose email is in `allowed_emails`. RLS
  write policies call `is_editor()`; the UI hides edit controls for non-editors.
- **URL import** → the `import-url` Edge Function fetches the page and parses its
  schema.org/Recipe JSON-LD (editor-only).
- **PDF import** → runs entirely in the browser with pdf.js; text only.

## Frontend (`docs/`)

Static files served by GitHub Pages from the `docs/` folder on `main`, at the
custom domain in `docs/CNAME`. No build step. The Supabase URL + anon key live in
`docs/js/supabase.js` (both are public by design).

## Backend (`supabase/`)

- `supabase/schema.sql` — full schema, RLS policies, `is_editor()`. Re-runnable.
- `supabase/functions/import-url/` — recipe URL extractor (verify_jwt = true).
- `supabase/functions/keepalive/` — DB-touch endpoint for an uptime monitor to
  hit so the free project doesn't pause (verify_jwt = false).

## Deploy / setup

1. **Supabase**: run `supabase/schema.sql`; enable Google OAuth (provider +
   redirect URLs); deploy the two Edge Functions.
2. **GitHub Pages**: repo Settings → Pages → deploy from `main` / `docs`. The
   repo must be public for free Pages. Set DNS CNAME `recipes` → `<user>.github.io`.
3. **Keepalive**: point UptimeRobot at the `keepalive` function URL.

## Local preview

It's static, so any static server works (port 8001 to avoid budget's 8000):

```bash
cd docs && python3 -m http.server 8001
```

Note: Google OAuth redirect URLs must include whatever origin you preview from.
