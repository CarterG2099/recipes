"""
Recipe CRUD against Supabase using the service-role client.

Reads are public (no per-user RLS scoping); recipes are a single shared
collection. Search and tag filtering are done in Python after a single ordered
fetch — at personal-cookbook scale (hundreds of rows) this is instant and keeps
the query logic simple and correct across title/description/ingredients/tags.
"""

import asyncio

from db.client import supabase_admin

_COLUMNS = (
    "id, title, description, ingredients, instructions, prep_time_minutes, "
    "cook_time_minutes, servings, tags, source_url, created_by, created_at, updated_at"
)


def _matches(row: dict, q: str) -> bool:
    q = q.lower()
    haystack = [
        row.get("title") or "",
        row.get("description") or "",
        *(row.get("ingredients") or []),
        *(row.get("tags") or []),
    ]
    return any(q in str(part).lower() for part in haystack)


async def list_recipes(search: str | None = None, tag: str | None = None) -> list[dict]:
    result = await asyncio.to_thread(
        lambda: supabase_admin.table("recipes")
        .select(_COLUMNS)
        .order("updated_at", desc=True)
        .execute()
    )
    rows = result.data or []
    if tag:
        rows = [r for r in rows if tag in (r.get("tags") or [])]
    if search and search.strip():
        rows = [r for r in rows if _matches(r, search.strip())]
    return rows


async def get_recipe(recipe_id: int) -> dict | None:
    result = await asyncio.to_thread(
        lambda: supabase_admin.table("recipes")
        .select(_COLUMNS)
        .eq("id", recipe_id)
        .maybe_single()
        .execute()
    )
    return result.data if result else None


async def create_recipe(data: dict, created_by: str | None) -> dict:
    row = {**data, "created_by": created_by}
    result = await asyncio.to_thread(
        lambda: supabase_admin.table("recipes").insert(row).execute()
    )
    if not result.data:
        return {}
    return result.data[0]


async def update_recipe(recipe_id: int, data: dict) -> bool:
    if not data:
        return True
    result = await asyncio.to_thread(
        lambda: supabase_admin.table("recipes")
        .update(data)
        .eq("id", recipe_id)
        .execute()
    )
    return bool(result.data)


async def delete_recipe(recipe_id: int) -> bool:
    result = await asyncio.to_thread(
        lambda: supabase_admin.table("recipes")
        .delete()
        .eq("id", recipe_id)
        .execute()
    )
    return bool(result.data)


async def list_tags() -> list[str]:
    result = await asyncio.to_thread(
        lambda: supabase_admin.table("recipes").select("tags").execute()
    )
    seen: set[str] = set()
    for row in result.data or []:
        for tag in row.get("tags") or []:
            if tag:
                seen.add(tag)
    return sorted(seen, key=str.lower)
