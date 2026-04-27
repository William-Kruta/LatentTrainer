from __future__ import annotations

from typing import Literal

from ddgs import DDGS
from pydantic import BaseModel


class ImageSearchResult(BaseModel):
    title: str
    image: str
    thumbnail: str | None = None
    source_url: str | None = None
    source: str | None = None
    width: int | None = None
    height: int | None = None
    images: list[str]


def _parse_image_result(result: dict) -> ImageSearchResult:
    image_url = str(result.get("image") or result.get("url") or "")
    source_url = result.get("url") or result.get("source_url")
    return ImageSearchResult(
        title=str(result.get("title") or ""),
        image=image_url,
        thumbnail=result.get("thumbnail"),
        source_url=str(source_url) if source_url else None,
        source=result.get("source"),
        width=result.get("width"),
        height=result.get("height"),
        images=[image_url] if image_url else [],
    )


def duck_duck_go_search(query: str, max_results: int = 10) -> list[dict]:
    """
    Search the internet using DuckDuckGo.
    
    Returns a list of dictionaries, each typically containing:
    - 'title': The title of the search result.
    - 'href': The URL of the result.
    - 'body': A snippet of text from the page.
    """
    results = []
    try:
        with DDGS() as ddgs:
            # Query the text search endpoint
            for r in ddgs.text(query, max_results=max_results):
                results.append(r)
    except Exception as exc:
        raise RuntimeError(f"DuckDuckGo search failed for query '{query}': {exc}") from exc
    
    return results


def duck_duck_go_image_search(
    query: str,
    max_results: int = 10,
    safesearch: Literal["on", "moderate", "off"] = "moderate",
) -> list[ImageSearchResult]:
    """
    Search DuckDuckGo Images.

    Returns normalized image results. Each result includes:
    - 'title': Image/result title.
    - 'image': Direct image URL.
    - 'thumbnail': Thumbnail URL.
    - 'source_url': Source page URL.
    - 'source': Source domain/name when provided.
    - 'images': A list containing the direct image URL, matching Reddit tool output.
    """
    results = []
    try:
        with DDGS() as ddgs:
            for result in ddgs.images(
                query,
                safesearch=safesearch,
                max_results=max_results,
            ):
                parsed = _parse_image_result(result)
                if parsed.image:
                    results.append(parsed)
    except Exception as exc:
        raise RuntimeError(f"DuckDuckGo image search failed for query '{query}': {exc}") from exc

    return results
