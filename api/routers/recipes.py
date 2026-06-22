"""
Recipe endpoints.

GET (list/detail/tags) are public. POST/PUT/DELETE require an allowlisted editor
via the `require_editor` dependency.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import require_editor
from models.recipes import (
    RecipeCreateRequest,
    RecipeListResponse,
    RecipeResponse,
    RecipeUpdateRequest,
    TagsResponse,
)
from services import recipe_service

router = APIRouter(tags=["recipes"])


@router.get("/recipes", response_model=RecipeListResponse)
async def list_recipes(
    search: Optional[str] = Query(default=None),
    tag: Optional[str] = Query(default=None),
):
    rows = await recipe_service.list_recipes(search=search, tag=tag)
    return {"recipes": rows}


@router.get("/recipes/tags", response_model=TagsResponse)
async def list_tags():
    return {"tags": await recipe_service.list_tags()}


@router.get("/recipes/{recipe_id}", response_model=RecipeResponse)
async def get_recipe(recipe_id: int):
    row = await recipe_service.get_recipe(recipe_id)
    if not row:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return row


@router.post("/recipes", status_code=201)
async def create_recipe(
    body: RecipeCreateRequest,
    user: dict = Depends(require_editor),
):
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    created = await recipe_service.create_recipe(
        body.model_dump(), created_by=user.get("email")
    )
    if not created:
        raise HTTPException(status_code=400, detail="Failed to create recipe")
    return {"id": created["id"], "status": "success"}


@router.put("/recipes/{recipe_id}")
async def update_recipe(
    recipe_id: int,
    body: RecipeUpdateRequest,
    user: dict = Depends(require_editor),
):
    existing = await recipe_service.get_recipe(recipe_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Recipe not found")
    await recipe_service.update_recipe(recipe_id, body.model_dump(exclude_unset=True))
    return {"status": "success"}


@router.delete("/recipes/{recipe_id}")
async def delete_recipe(
    recipe_id: int,
    user: dict = Depends(require_editor),
):
    existing = await recipe_service.get_recipe(recipe_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Recipe not found")
    await recipe_service.delete_recipe(recipe_id)
    return {"status": "success"}
