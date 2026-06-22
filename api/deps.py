"""
Dependency injection for auth and database access.

Recipe reads are public, so route handlers that only read use the service-role
client directly (db.client.supabase_admin). Write routes depend on
`require_editor`, which enforces a logged-in session whose email is allowlisted.
"""

import asyncio

from fastapi import Request, HTTPException

from config import settings


def get_current_user(request: Request) -> dict:
    """Extract the current user from the server-side session cookie, or 401."""
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


async def is_editor(email: str | None) -> bool:
    """True if the email may edit recipes: admin, env allowlist, or DB table."""
    email = (email or "").lower()
    if not email:
        return False
    if email in settings.admin_emails:
        return True
    if email in settings.allowed_emails:
        return True
    from db.client import supabase_admin
    result = await asyncio.to_thread(
        lambda: supabase_admin.table("allowed_emails").select("email").execute()
    )
    db_allowed = {(r.get("email") or "").lower() for r in (result.data or [])}
    return email in db_allowed


async def require_editor(request: Request) -> dict:
    """Dependency guarding write routes: session present AND allowlisted."""
    user = get_current_user(request)
    if not await is_editor(user.get("email")):
        raise HTTPException(status_code=403, detail="Not authorized to edit recipes")
    return user
