from __future__ import annotations

from typing import Literal

import httpx
from pydantic import BaseModel


RedditTimeFilter = Literal["hour", "day", "week", "month", "year", "all"]
RedditSearchSort = Literal["relevance", "hot", "top", "new", "comments"]
UserPostSort = Literal["new", "hot", "top", "controversial"]


class SubredditPost(BaseModel):
    id: str
    title: str
    author: str
    score: int
    num_comments: int
    url: str
    permalink: str
    created_utc: float
    is_self: bool
    selftext: str | None = None
    thumbnail: str | None = None
    images: list[str] = []


def _parse_post_item(item: dict) -> SubredditPost:
    """Helper to parse a Reddit API post item into a SubredditPost model."""
    images = []

    # 1. Handle Galleries
    if item.get("is_gallery") and "media_metadata" in item:
        metadata = item["media_metadata"]
        gallery_items = item.get("gallery_data", {}).get("items", [])
        for gallery_item in gallery_items:
            media_id = gallery_item.get("media_id")
            if media_id in metadata:
                source = metadata[media_id].get("s", {})
                img_url = source.get("u") or source.get("gif")
                if img_url:
                    images.append(img_url.replace("&amp;", "&"))

    # 2. Handle Single Image
    elif item.get("post_hint") == "image" or item.get("url", "").lower().endswith((".jpg", ".jpeg", ".png", ".gif")):
        preview_images = item.get("preview", {}).get("images", [])
        if preview_images:
            source = preview_images[0].get("source", {})
            img_url = source.get("url")
            if img_url:
                images.append(img_url.replace("&amp;", "&"))
        else:
            images.append(item.get("url", ""))

    return SubredditPost(
        id=item.get("id", ""),
        title=item.get("title", ""),
        author=item.get("author", ""),
        score=item.get("score", 0),
        num_comments=item.get("num_comments", 0),
        url=item.get("url", ""),
        permalink=item.get("permalink", ""),
        created_utc=item.get("created_utc", 0.0),
        is_self=item.get("is_self", False),
        selftext=item.get("selftext"),
        thumbnail=item.get("thumbnail"),
        images=images,
    )


def get_subreddit_posts(
    subreddit: str,
    sort: Literal["new", "best", "hot", "top"] = "hot",
    limit: int = 25,
) -> list[SubredditPost]:
    """Query a subreddit and return the top posts based on the sorting method."""
    url = f"https://www.reddit.com/r/{subreddit}/{sort}.json"
    headers = {"User-Agent": "LatentTrainer/0.1.0"}

    try:
        with httpx.Client(follow_redirects=True, timeout=15.0) as client:
            response = client.get(url, headers=headers, params={"limit": limit})
            response.raise_for_status()

        data = response.json()
        return [_parse_post_item(entry["data"]) for entry in data.get("data", {}).get("children", [])]
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch posts from r/{subreddit}: {exc}") from exc


def get_user_posts(
    username: str,
    sort: UserPostSort = "new",
    limit: int = 25,
    time_filter: RedditTimeFilter = "all",
) -> list[SubredditPost]:
    """Fetch posts submitted by a Reddit user.

    Supported sort values mirror Reddit's user-submitted listing where available:
    new, hot, top, and controversial. The time filter applies to top and
    controversial sorts.
    """
    clean_username = username.strip().removeprefix("u/").removeprefix("/u/").strip("/")
    if not clean_username:
        raise ValueError("username is required.")

    url = f"https://www.reddit.com/user/{clean_username}/submitted/{sort}.json"
    headers = {"User-Agent": "LatentTrainer/0.1.0"}
    params: dict[str, int | str] = {"limit": limit}
    if sort in {"top", "controversial"}:
        params["t"] = time_filter

    try:
        with httpx.Client(follow_redirects=True, timeout=15.0) as client:
            response = client.get(url, headers=headers, params=params)
            response.raise_for_status()

        data = response.json()
        return [_parse_post_item(entry["data"]) for entry in data.get("data", {}).get("children", [])]
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch posts from u/{clean_username}: {exc}") from exc


def get_post_by_url(url: str) -> SubredditPost:
    """Fetch a single Reddit post by its URL."""
    # Normalise: strip query string, ensure it ends with .json
    clean = url.split("?")[0].rstrip("/")
    if not clean.endswith(".json"):
        clean += ".json"

    headers = {"User-Agent": "LatentTrainer/0.1.0"}

    try:
        with httpx.Client(follow_redirects=True, timeout=15.0) as client:
            response = client.get(clean, headers=headers)
            response.raise_for_status()

        data = response.json()
        # Reddit returns a two-element list: [post_listing, comments_listing]
        post_item = data[0]["data"]["children"][0]["data"]
        return _parse_post_item(post_item)
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch Reddit post at '{url}': {exc}") from exc


def search_subreddit(
    subreddit: str,
    query: str,
    sort: RedditSearchSort = "relevance",
    limit: int = 25,
    time_filter: RedditTimeFilter = "all",
) -> list[SubredditPost]:
    """Search for posts within a specific subreddit."""
    url = f"https://www.reddit.com/r/{subreddit}/search.json"
    headers = {"User-Agent": "LatentTrainer/0.1.0"}
    params = {
        "q": query,
        "restrict_sr": 1,
        "sort": sort,
        "limit": limit,
        "t": time_filter,
    }

    try:
        with httpx.Client(follow_redirects=True, timeout=15.0) as client:
            response = client.get(url, headers=headers, params=params)
            response.raise_for_status()

        data = response.json()
        return [_parse_post_item(entry["data"]) for entry in data.get("data", {}).get("children", [])]
    except Exception as exc:
        raise RuntimeError(f"Failed to search r/{subreddit} for '{query}': {exc}") from exc


def search_reddit(
    query: str,
    sort: RedditSearchSort = "relevance",
    limit: int = 25,
    time_filter: RedditTimeFilter = "all",
) -> list[SubredditPost]:
    """Search posts across all of Reddit, not restricted to a subreddit."""
    clean_query = query.strip()
    if not clean_query:
        raise ValueError("query is required.")

    url = "https://www.reddit.com/search.json"
    headers = {"User-Agent": "LatentTrainer/0.1.0"}
    params = {
        "q": clean_query,
        "restrict_sr": 0,
        "sort": sort,
        "limit": limit,
        "t": time_filter,
    }

    try:
        with httpx.Client(follow_redirects=True, timeout=15.0) as client:
            response = client.get(url, headers=headers, params=params)
            response.raise_for_status()

        data = response.json()
        return [_parse_post_item(entry["data"]) for entry in data.get("data", {}).get("children", [])]
    except Exception as exc:
        raise RuntimeError(f"Failed to search Reddit for '{clean_query}': {exc}") from exc
