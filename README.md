# Recipes

A small recipe site — public to browse, allowlisted Google login to edit.
Stack mirrors the budget app: FastAPI + Supabase + Alpine.js (no build step),
deployed on Render behind `recipes.cartergividen.com`.

## Setup

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # fill in Supabase creds + secret + ADMIN_EMAILS
```

Create the database: open the Supabase SQL editor for the recipes project and
run `db/schema.sql`.

## Run

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## How it works

- **Reading is public**: `GET /api/recipes`, `/api/recipes/{id}`, `/api/recipes/tags`
  need no auth. All pages are public except `/edit`.
- **Editing requires an allowlisted login**: `POST/PUT/DELETE /api/recipes/*` and
  the import endpoints require a Google session whose email is in `ADMIN_EMAILS`,
  `ALLOWED_EMAILS`, or the `allowed_emails` table. The login callback itself
  rejects non-allowlisted accounts.
- **Import**: `POST /api/import/url` uses `recipe-scrapers` (known-site parsers +
  schema.org/JSON-LD fallback). `POST /api/import/pdf` extracts text with
  `pdfplumber` and splits it heuristically. Both return an unsaved draft the edit
  form pre-fills for review — neither writes to the database. Scanned/image PDFs
  yield no text and return a warning.

## Deploy

Render web service (`render.yaml`), plain Python runtime. Set the env vars from
`.env.example` in the Render dashboard.
