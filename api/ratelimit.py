"""
Lightweight in-memory rate limiting for sensitive endpoints.

Fixed-window per-key limiter. Keys are the authenticated user id when a session
exists, otherwise the client IP (honoring X-Forwarded-For since the app runs
behind Render's proxy). State is process-local — adequate for a single-instance
deployment; it resets on restart and is not shared across instances.
"""

import time
from collections import defaultdict
from fastapi import Request, HTTPException


# key -> list[timestamps] within the current window
_hits: dict[str, list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # First hop is the original client.
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(max_calls: int, window_seconds: int, scope: str):
    """Return a FastAPI dependency enforcing max_calls per window_seconds per
    caller (user id if logged in, else client IP), namespaced by `scope`."""

    async def _dependency(request: Request) -> None:
        user = request.session.get("user") if "session" in request.scope else None
        ident = (user or {}).get("id") if user else None
        key = f"{scope}:{ident or _client_ip(request)}"

        now = time.monotonic()
        cutoff = now - window_seconds
        hits = [t for t in _hits[key] if t > cutoff]
        if len(hits) >= max_calls:
            retry_after = int(window_seconds - (now - hits[0])) + 1
            raise HTTPException(
                status_code=429,
                detail="Too many requests; please slow down.",
                headers={"Retry-After": str(max(retry_after, 1))},
            )
        hits.append(now)
        _hits[key] = hits

    return _dependency


def _reset() -> None:
    """Clear all rate-limit state (used by tests)."""
    _hits.clear()
