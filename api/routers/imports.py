"""
Recipe import endpoints — editor-only. Neither saves anything; both return a
RecipeDraft for the frontend to pre-fill the edit form for human review.
"""

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from api.deps import require_editor
from api.ratelimit import rate_limit
from models.recipes import ImportUrlRequest, RecipeDraft
from services import import_service

router = APIRouter(tags=["import"])

_MAX_PDF_BYTES = 15 * 1024 * 1024  # 15 MB


@router.post(
    "/import/url",
    response_model=RecipeDraft,
    dependencies=[Depends(rate_limit(30, 300, "import_url")), Depends(require_editor)],
)
async def import_url(body: ImportUrlRequest):
    try:
        return await import_service.import_from_url(body.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not fetch that URL")


@router.post(
    "/import/pdf",
    response_model=RecipeDraft,
    dependencies=[Depends(rate_limit(30, 300, "import_pdf")), Depends(require_editor)],
)
async def import_pdf(file: UploadFile = File(...)):
    if (file.content_type or "") not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > _MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF is too large (max 15 MB)")
    try:
        return await import_service.import_from_pdf(content)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read that PDF")
