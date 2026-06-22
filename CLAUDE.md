# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8001
```

No linter or test suite is configured yet.

## Dependencies

Pin every new third-party `import` in `requirements.txt` in the same commit —
Render installs ONLY this file, so a missing module crashes the deploy at boot.
"Imports fine locally" proves nothing if the local venv has stray packages.

## Architecture

Recipe site: public browse, allowlisted Google login to edit. **Stack**: FastAPI
+ Supabase (Postgres + Auth) + Alpine.js frontend (no build step), served
statically by FastAPI. Deployed on Render behind `recipes.cartergividen.com`.

```
Browser (HTML + Alpine.js)
    ↕ fetch (api.js: 401 → refresh → retry)
FastAPI (main.py — security headers/CSP middleware)
    ├── api/routers/  — auth (OAuth callback/refresh), recipes (CRUD), imports (url/pdf)
    ├── services/     — recipe_service (CRUD), import_service (recipe-scrapers, pdfplumber)
    ├── models/       — Pydantic schemas
    └── api/deps.py   — get_current_user, require_editor (allowlist gate)
        ↕
Supabase Postgres (service-role client for all recipe access)
```

## Access model (do not regress)

- All recipe DB access goes through the **service-role** client
  (`db.client.supabase_admin`). There is no per-user RLS scoping — recipes are a
  single shared collection.
- **GET endpoints are public** (no auth dependency). **POST/PUT/DELETE and the
  import endpoints depend on `require_editor`**, which checks the session email
  against admins ∪ `ALLOWED_EMAILS` env ∪ the `allowed_emails` table.
- `/auth/callback` admits only allowlisted editors — there's no point minting a
  session for someone who can't edit.
- RLS is enabled on `recipes` with a public-SELECT-only policy (no write
  policies) as defense-in-depth; writes work only via the service role.

## Imports

- URL: `recipe-scrapers` with `wild_mode=True` (schema.org/JSON-LD fallback for
  unknown sites). Each accessor is wrapped in `_safe()` because sites don't all
  implement every field.
- PDF: `pdfplumber` text extraction + heuristic Ingredients/Instructions header
  splitting. **Text-based PDFs only** — scanned/image PDFs return a warning, not
  a silent empty draft. OCR (Tesseract) was deliberately deferred to avoid a
  Docker deploy.
- Both endpoints return an unsaved `RecipeDraft`; the edit form pre-fills it for
  human review. Nothing is auto-saved.

## Security (do not regress)

- CSP is set in `main.py` middleware. Alpine.js REQUIRES `'unsafe-eval'` in
  `script-src` (it evaluates directives via the Function constructor).
- The supabase-js CDN `<script>` in `auth.html` is SRI-pinned; to upgrade, bump
  the version in the URL and recompute the `sha384` integrity hash.
- The service-role key is backend-only and never sent to the browser
  (`/api/config` returns only the URL + anon key).
- Rate limits (`api/ratelimit.py`) guard `/auth/callback`, `/auth/refresh`, and
  both import endpoints.

## Static serving / CSS

FastAPI serves `frontend/` directly — no bundler. CSS layers:
`tokens.css` → `base.css` → `components.css` → `pages.css`. `tokens.css`,
`base.css`, `components.css`, `js/api.js`, `js/auth.js`, and the Alpine vendor
file are shared verbatim with the budget app's design system.

## Deploy

Render (`render.yaml`), plain Python runtime, `healthCheckPath: /health`.
Supabase is a **separate project** from budget (isolation from financial data).
Run `db/schema.sql` once in that project's SQL editor.
