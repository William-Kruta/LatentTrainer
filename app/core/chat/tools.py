from __future__ import annotations

from typing import Any


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "duck_duck_go_search",
            "description": "Search the internet using DuckDuckGo to get up-to-date information, news, or general knowledge.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query."},
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default 10).",
                        "default": 10,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "duck_duck_go_image_search",
            "description": "Search DuckDuckGo Images and return normalized image results. Use the `images` field to display image tiles with Markdown like ![title](images[0]).",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The image search query."},
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of image results to return (default 10).",
                        "default": 10,
                    },
                    "safesearch": {
                        "type": "string",
                        "enum": ["on", "moderate", "off"],
                        "description": "DuckDuckGo safe search level (default 'moderate').",
                        "default": "moderate",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_user_posts",
            "description": "Retrieve posts submitted by a specific Reddit user. Remove 'u/' if the user provides it.",
            "parameters": {
                "type": "object",
                "properties": {
                    "username": {
                        "type": "string",
                        "description": "The Reddit username (e.g., 'spez' or 'u/spez').",
                    },
                    "sort": {
                        "type": "string",
                        "enum": ["new", "hot", "top", "controversial"],
                        "description": "Sorting method for the user's submitted posts (default 'new').",
                        "default": "new",
                    },
                    "time_filter": {
                        "type": "string",
                        "enum": ["hour", "day", "week", "month", "year", "all"],
                        "description": "Time filter for top or controversial sorting (default 'all').",
                        "default": "all",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of posts to retrieve (default 25).",
                        "default": 25,
                    },
                },
                "required": ["username"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_redgifs_user_posts",
            "description": "Retrieve public Redgifs posts from a specific user/creator. Use the poster/images fields for image tiles and hd_url or sd_url for direct video links.",
            "parameters": {
                "type": "object",
                "properties": {
                    "username": {
                        "type": "string",
                        "description": "The Redgifs username, @handle, or redgifs.com/users/{username} URL.",
                    },
                    "order": {
                        "type": "string",
                        "enum": ["recent", "best", "top", "trending"],
                        "description": "Sorting method for the user's Redgifs posts (default 'recent').",
                        "default": "recent",
                    },
                    "media_type": {
                        "type": "string",
                        "enum": ["g", "i"],
                        "description": "Media type: 'g' for gifs/videos, 'i' for images (default 'g').",
                        "default": "g",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of posts to retrieve, 1-80 (default 25).",
                        "default": 25,
                    },
                    "page": {
                        "type": "integer",
                        "description": "Result page to retrieve (default 1).",
                        "default": 1,
                    },
                },
                "required": ["username"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_subreddit_posts",
            "description": "Retrieve a list of posts from a specific subreddit. remove 'r/' if the user provides it for the subreddit parameter.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subreddit": {
                        "type": "string",
                        "description": "The name of the subreddit (e.g., 'python', 'technews').",
                    },
                    "sort": {
                        "type": "string",
                        "enum": ["new", "best", "hot", "top"],
                        "description": "Sorting method for the posts (default 'hot').",
                        "default": "hot",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of posts to retrieve (default 25).",
                        "default": 25,
                    },
                },
                "required": ["subreddit"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_post_by_url",
            "description": "Fetch a single Reddit post by its URL. Use this when the user provides a specific Reddit post link and wants details about that exact post.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The full URL of the Reddit post (e.g., 'https://www.reddit.com/r/python/comments/abc123/my_post/').",
                    }
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_subreddit",
            "description": "Search for specific terms within a specific subreddit.",
            "parameters": {
                "type": "object",
                "properties": {
                    "subreddit": {
                        "type": "string",
                        "description": "The name of the subreddit to search within.",
                    },
                    "query": {
                        "type": "string",
                        "description": "The search term or query.",
                    },
                    "sort": {
                        "type": "string",
                        "enum": ["relevance", "hot", "top", "new", "comments"],
                        "description": "Sorting method for search results (default 'relevance').",
                        "default": "relevance",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default 25).",
                        "default": 25,
                    },
                    "time_filter": {
                        "type": "string",
                        "enum": ["hour", "day", "week", "month", "year", "all"],
                        "description": "Time filter for Reddit search results (default 'all').",
                        "default": "all",
                    },
                },
                "required": ["subreddit", "query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_reddit",
            "description": "Search posts across all of Reddit, not restricted to a subreddit. Use this when the user asks for a generic Reddit search or does not name a subreddit.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The Reddit-wide search term or query.",
                    },
                    "sort": {
                        "type": "string",
                        "enum": ["relevance", "hot", "top", "new", "comments"],
                        "description": "Sorting method for search results (default 'relevance').",
                        "default": "relevance",
                    },
                    "time_filter": {
                        "type": "string",
                        "enum": ["hour", "day", "week", "month", "year", "all"],
                        "description": "Time filter for Reddit search results (default 'all').",
                        "default": "all",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of results to return (default 25).",
                        "default": 25,
                    },
                },
                "required": ["query"],
            },
        },
    },
]


def get_tool_definitions() -> list[dict[str, Any]]:
    """Return the list of tool definitions for the LLM."""
    return TOOLS
