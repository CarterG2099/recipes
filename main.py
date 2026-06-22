"""
Recipes Application — FastAPI entry point.
Serves both the REST API and the static frontend files.

Reading recipes is fully public; only editing requires an allowlisted login.
"""

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from config import settings
from api.routers import auth, recipes, imports

if settings.SENTRY_DSN:
    import sentry_sdk
    sentry_sdk.init(dsn=settings.SENTRY_DSN, traces_sample_rate=1.0)

app = FastAPI(
    title="Recipes",
    docs_url="/docs" if not settings.IS_PRODUCTION else None,
    redoc_url="/redoc" if not settings.IS_PRODUCTION else None,
)

from postgrest.exceptions import APIError


@app.exception_handler(APIError)
async def supabase_api_error_handler(request: Request, exc: APIError):
    msg = exc.message.get("message", "").lower() if isinstance(exc.message, dict) else str(exc).lower()
    code = exc.message.get("code", "") if isinstance(exc.message, dict) else ""
    if "jwt expired" in msg or code == "PGRST303":
        return JSONResponse(status_code=401, content={"detail": "Session expired"})
    import logging
    logging.getLogger(__name__).error(f"Supabase API Error: {exc.message}")
    return JSONResponse(status_code=500, content={"detail": "Internal Database Error"})


# ─── Middleware ────────────────────────────────────────────────────────────────
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.FASTAPI_SECRET_KEY,
    https_only=settings.IS_PRODUCTION,
    same_site="lax",
)

if not settings.IS_PRODUCTION:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:8001", "http://127.0.0.1:8001"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# ─── Security headers (incl. CSP) ──────────────────────────────────────────────
# Scripts: own origin + jsdelivr (supabase-js UMD). 'unsafe-eval' is required by
# Alpine.js (it evaluates directives via the Function constructor); 'unsafe-inline'
# because the static pages carry inline <script>/style blocks (no build step).
# Connections: Supabase (auth + REST).
_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https:; "
    "font-src 'self' data:; "
    "connect-src 'self' https://*.supabase.co; "
    "worker-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


@app.middleware("http")
async def security_and_cache_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("Content-Security-Policy", _CSP)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if settings.IS_PRODUCTION:
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    if request.url.path.startswith("/api/") or request.url.path.startswith("/auth/"):
        response.headers["Cache-Control"] = "no-store"
    return response


# ─── Health check ──────────────────────────────────────────────────────────────
@app.api_route("/health", methods=["GET", "HEAD"], include_in_schema=False)
async def health():
    return {"status": "ok"}


# ─── Public config endpoint ────────────────────────────────────────────────────
@app.get("/api/config", include_in_schema=False)
async def get_config():
    """Expose safe public configuration to the frontend. Never returns the service role key."""
    return JSONResponse(
        {
            "supabaseUrl": settings.SUPABASE_URL,
            "supabaseAnonKey": settings.SUPABASE_ANON_KEY,
            "isProduction": settings.IS_PRODUCTION,
        }
    )


# ─── API Routers ───────────────────────────────────────────────────────────────
app.include_router(auth.router)                       # /auth/* (public entry points)
app.include_router(recipes.router, prefix="/api")     # /api/recipes/* (GET public, writes gated)
app.include_router(imports.router, prefix="/api")     # /api/import/* (editor-only)


# ─── Page Routes ──────────────────────────────────────────────────────────────
# All pages are public except the edit page, which requires a session (the
# write APIs it calls are independently gated by require_editor).
PUBLIC_PAGES: dict[str, str] = {
    "/":              "frontend/index.html",
    "/recipe":        "frontend/recipe.html",
    "/auth":          "frontend/auth.html",
    "/auth/callback": "frontend/auth.html",
}


def _make_public_handler(fp: str):
    async def handler(request: Request):
        return FileResponse(fp)
    return handler


for _route, _fp in PUBLIC_PAGES.items():
    app.add_api_route(_route, _make_public_handler(_fp), include_in_schema=False)


async def _edit_page(request: Request):
    """Edit/create page: requires a session; redirects to /auth otherwise."""
    if not request.session.get("user"):
        return HTMLResponse("", status_code=302, headers={"Location": "/auth"})
    return FileResponse("frontend/edit.html")


app.add_api_route("/edit", _edit_page, include_in_schema=False)


# ─── Static assets ────────────────────────────────────────────────────────────
# Must be mounted LAST so it does not shadow API routes or page routes.
app.mount("/", StaticFiles(directory="frontend"), name="static")
