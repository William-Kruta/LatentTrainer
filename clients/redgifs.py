from __future__ import annotations

from typing import Literal

import httpx
from pydantic import BaseModel


RedgifsOrder = Literal["recent", "best", "top", "trending"]
RedgifsMediaType = Literal["g", "i"]

REDGIFS_API_BASE = "https://api.redgifs.com"
USER_AGENT = "LatentTrainer/0.1.0"


class RedgifsPost(BaseModel):
    id: str
    title: str
    username: str
    url: str
    sd_url: str | None = None
    hd_url: str | None = None
    poster: str | None = None
    thumbnail: str | None = None
    type: str | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    views: int | None = None
    likes: int | None = None
    tags: list[str] = []
    images: list[str] = []


def _clean_username(username: str) -> str:
    clean = username.strip().removeprefix("@").removeprefix("u/").strip("/")
    if "redgifs.com/users/" in clean:
        clean = clean.rstrip("/").split("/users/", 1)[1].split("/", 1)[0]
    if not clean:
        raise ValueError("username is required.")
    return clean


def _get_temporary_token(client: httpx.Client) -> str:
    response = client.get(f"{REDGIFS_API_BASE}/v2/auth/temporary")
    response.raise_for_status()
    token = response.json().get("token")
    if not token:
        raise RuntimeError("Redgifs temporary token response did not include a token.")
    return str(token)


def _parse_post(item: dict, fallback_username: str) -> RedgifsPost:
    urls = item.get("urls") or {}
    post_id = str(item.get("id") or "")
    username = str(item.get("userName") or item.get("username") or fallback_username)
    poster = urls.get("poster")
    thumbnail = urls.get("thumbnail") or urls.get("vthumbnail") or poster
    hd_url = urls.get("hd")
    sd_url = urls.get("sd")
    media_url = hd_url or sd_url or poster or thumbnail
    images = [str(poster)] if poster else []

    return RedgifsPost(
        id=post_id,
        title=str(item.get("title") or post_id),
        username=username,
        url=f"https://www.redgifs.com/watch/{post_id}" if post_id else "",
        sd_url=str(sd_url) if sd_url else None,
        hd_url=str(hd_url) if hd_url else None,
        poster=str(poster) if poster else None,
        thumbnail=str(thumbnail) if thumbnail else None,
        type=item.get("type"),
        width=item.get("width"),
        height=item.get("height"),
        duration=item.get("duration"),
        views=item.get("views"),
        likes=item.get("likes"),
        tags=list(item.get("tags") or []),
        images=images or ([str(media_url)] if media_url else []),
    )


def get_redgifs_user_posts(
    username: str,
    order: RedgifsOrder = "recent",
    media_type: RedgifsMediaType = "g",
    limit: int = 25,
    page: int = 1,
) -> list[RedgifsPost]:
    """Fetch public Redgifs posts for a user using an anonymous temporary token."""
    clean_username = _clean_username(username)
    clamped_limit = max(1, min(int(limit), 80))
    clamped_page = max(1, int(page))

    headers = {"User-Agent": USER_AGENT}
    try:
        with httpx.Client(follow_redirects=True, timeout=30.0, headers=headers) as client:
            token = _get_temporary_token(client)
            response = client.get(
                f"{REDGIFS_API_BASE}/v2/users/{clean_username}/search",
                headers={**headers, "Authorization": f"Bearer {token}"},
                params={
                    "page": clamped_page,
                    "count": clamped_limit,
                    "order": order,
                    "type": media_type,
                },
            )
            response.raise_for_status()

        data = response.json()
        return [_parse_post(item, clean_username) for item in data.get("gifs", [])]
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch Redgifs posts for user '{clean_username}': {exc}") from exc
