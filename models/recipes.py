from typing import Optional
from pydantic import BaseModel, Field


class RecipeResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    ingredients: list[str] = Field(default_factory=list)
    instructions: list[str] = Field(default_factory=list)
    prep_time_minutes: Optional[int] = None
    cook_time_minutes: Optional[int] = None
    servings: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    source_url: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class RecipeCreateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    ingredients: list[str] = Field(default_factory=list)
    instructions: list[str] = Field(default_factory=list)
    prep_time_minutes: Optional[int] = None
    cook_time_minutes: Optional[int] = None
    servings: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    source_url: Optional[str] = None


class RecipeUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    ingredients: Optional[list[str]] = None
    instructions: Optional[list[str]] = None
    prep_time_minutes: Optional[int] = None
    cook_time_minutes: Optional[int] = None
    servings: Optional[str] = None
    tags: Optional[list[str]] = None
    source_url: Optional[str] = None


class RecipeListResponse(BaseModel):
    recipes: list[RecipeResponse]


class TagsResponse(BaseModel):
    tags: list[str]


class ImportUrlRequest(BaseModel):
    url: str


class RecipeDraft(BaseModel):
    """An extracted-but-unsaved recipe returned by the import endpoints.

    Mirrors RecipeCreateRequest fields; the frontend pre-fills the edit form
    with this so the user reviews and saves explicitly.
    """
    title: str = ""
    description: Optional[str] = None
    ingredients: list[str] = Field(default_factory=list)
    instructions: list[str] = Field(default_factory=list)
    prep_time_minutes: Optional[int] = None
    cook_time_minutes: Optional[int] = None
    servings: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    source_url: Optional[str] = None
    # Set when extraction was partial/low-confidence so the UI can warn the user.
    warning: Optional[str] = None
