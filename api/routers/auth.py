"""
Authentication router — Google OAuth callback, logout, and token refresh.

Reading recipes is public and needs no session. Logging in exists only to edit,
so the callback admits only allowlisted editors (admins ∪ ALLOWED_EMAILS env ∪
allowed_emails table) — there's no value in minting a session for someone who
can't edit. Routes are intentionally NOT under /api so they can be public entry
points.
"""

import asyncio
from fastapi import APIRouter, Request, HTTPException, Depends
from pydantic import BaseModel

from config import settings
from api.deps import is_editor
from api.ratelimit import rate_limit

router = APIRouter(tags=["auth"])


class AuthCallbackBody(BaseModel):
    access_token: str
    refresh_token: str
    user: dict


@router.post("/auth/callback", dependencies=[Depends(rate_limit(20, 300, "auth_callback"))])
async def auth_callback(body: AuthCallbackBody, request: Request):
    """
    Called by the frontend after the Supabase Google OAuth redirect.
    Verifies the token server-side and, if the verified email is an allowlisted
    editor, stores the verified identity in the session cookie.
    """
    if not body.access_token:
        raise HTTPException(status_code=400, detail="Missing authentication data")

    from db.client import get_service_client
    try:
        result = await asyncio.to_thread(
            lambda: get_service_client().auth.get_user(body.access_token)
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid access token")

    verified = getattr(result, "user", None)
    if not verified or not getattr(verified, "id", None):
        raise HTTPException(status_code=401, detail="Invalid access token")

    email = (getattr(verified, "email", None) or "").lower()
    if not await is_editor(email):
        raise HTTPException(
            status_code=403, detail="This account is not authorized to edit recipes"
        )

    metadata = getattr(verified, "user_metadata", None) or {}
    request.session["user"] = {
        "id": verified.id,
        "email": getattr(verified, "email", None),
        "name": metadata.get("full_name") or metadata.get("name"),
        "avatar_url": metadata.get("avatar_url"),
        "access_token": body.access_token,
        "refresh_token": body.refresh_token,
    }
    return {"status": "success", "redirect": "/"}


@router.get("/auth/me")
async def get_me(request: Request):
    """Return the current session user (with live editor status) or 401."""
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "name": user.get("name"),
        "avatar_url": user.get("avatar_url"),
        "is_editor": await is_editor(user.get("email")),
    }


@router.post("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return {"status": "success", "redirect": "/"}


@router.post("/auth/refresh", dependencies=[Depends(rate_limit(30, 300, "auth_refresh"))])
async def refresh_token(request: Request):
    """Proactively refresh the Supabase access token before its 1-hour expiry."""
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    refresh_tok = user.get("refresh_token")
    if not refresh_tok:
        raise HTTPException(status_code=400, detail="No refresh token in session")

    try:
        from db.client import get_service_client
        result = await asyncio.to_thread(
            lambda: get_service_client().auth.refresh_session(refresh_tok)
        )
        if not result or not result.session:
            request.session.clear()
            raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

        session_data = result.session
        request.session["user"] = {
            **user,
            "access_token": session_data.access_token,
            "refresh_token": session_data.refresh_token,
        }
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception:
        request.session.clear()
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
