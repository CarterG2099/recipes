"""
Recipe import: extract a best-effort draft from a URL or a text-based PDF.

Neither path saves anything — both return a RecipeDraft the frontend uses to
pre-fill the edit form for human review. URL extraction uses recipe-scrapers
(known-site parsers + a schema.org/JSON-LD fallback via wild_mode). PDF
extraction pulls text with pdfplumber and splits it heuristically; scanned/image
PDFs yield no text and produce an explicit warning rather than a silent empty
draft.
"""

import asyncio
import re
from urllib.parse import urlparse

import httpx

# Both import endpoints are editor-only, so the URL is operator-supplied rather
# than attacker-controlled; we still restrict to http(s) and use a short timeout.
_FETCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

# Section headers we recognize when splitting plain PDF text.
_ING_HEADER = re.compile(r"^\s*ingredients\s*:?\s*$", re.IGNORECASE)
_STEP_HEADER = re.compile(
    r"^\s*(instructions|directions|method|steps|preparation)\s*:?\s*$",
    re.IGNORECASE,
)
_TIME_RE = re.compile(r"(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m)\b", re.IGNORECASE)


def _safe(fn):
    """Call a recipe-scrapers accessor, swallowing the NotImplementedError /
    parse errors it raises for fields a given site doesn't expose."""
    try:
        return fn()
    except Exception:
        return None


def _minutes(value) -> int | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value) or None
    return None


async def import_from_url(url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL must be an http(s) link")

    from recipe_scrapers import scrape_html

    async with httpx.AsyncClient(
        timeout=15.0, follow_redirects=True, headers=_FETCH_HEADERS
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        html = resp.text

    # wild_mode lets unknown sites fall back to schema.org / JSON-LD parsing.
    scraper = await asyncio.to_thread(
        lambda: scrape_html(html, org_url=url, wild_mode=True)
    )

    ingredients = _safe(scraper.ingredients) or []
    instructions = _safe(scraper.instructions_list)
    if not instructions:
        raw = _safe(scraper.instructions) or ""
        instructions = [s.strip() for s in raw.split("\n") if s.strip()]

    draft = {
        "title": (_safe(scraper.title) or "").strip(),
        "ingredients": [i.strip() for i in ingredients if i and i.strip()],
        "instructions": instructions,
        "prep_time_minutes": _minutes(_safe(scraper.prep_time)),
        "cook_time_minutes": _minutes(_safe(scraper.cook_time)),
        "servings": (str(_safe(scraper.yields)).strip() if _safe(scraper.yields) else None),
        "source_url": url,
        "tags": [],
    }
    if not draft["ingredients"] and not draft["instructions"]:
        draft["warning"] = (
            "Couldn't find a structured recipe on that page. You may need to "
            "enter the details manually."
        )
    return draft


def _extract_pdf_text(content: bytes) -> str:
    import io
    import pdfplumber

    parts: list[str] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if text:
                parts.append(text)
    return "\n".join(parts)


def _parse_pdf_text(text: str) -> dict:
    lines = [ln.rstrip() for ln in text.splitlines()]
    title = next((ln.strip() for ln in lines if ln.strip()), "")

    ingredients: list[str] = []
    instructions: list[str] = []
    section: str | None = None
    for ln in lines:
        if _ING_HEADER.match(ln):
            section = "ing"
            continue
        if _STEP_HEADER.match(ln):
            section = "step"
            continue
        stripped = ln.strip()
        if not stripped:
            continue
        if section == "ing":
            ingredients.append(stripped)
        elif section == "step":
            instructions.append(stripped)

    draft = {
        "title": title,
        "ingredients": ingredients,
        "instructions": instructions,
        "tags": [],
    }
    if not ingredients and not instructions:
        draft["warning"] = (
            "Couldn't detect Ingredients/Instructions headers in this PDF. The "
            "full extracted text was put in the description — please split it "
            "into ingredients and steps manually."
        )
        draft["description"] = text.strip()[:4000]
    return draft


async def import_from_pdf(content: bytes) -> dict:
    text = await asyncio.to_thread(_extract_pdf_text, content)
    if not text.strip():
        return {
            "title": "",
            "ingredients": [],
            "instructions": [],
            "tags": [],
            "warning": (
                "No text could be extracted — this looks like a scanned or "
                "image-only PDF. Text-based PDFs only are supported right now."
            ),
        }
    return _parse_pdf_text(text)
