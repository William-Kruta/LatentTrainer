from __future__ import annotations

import json
import logging
from typing import Any

from clients.duck_duck_go import duck_duck_go_image_search, duck_duck_go_search
from clients.redgifs import get_redgifs_user_posts
from clients.reddit import get_post_by_url, get_subreddit_posts, get_user_posts, search_reddit, search_subreddit


logger = logging.getLogger(__name__)


async def execute_tool_call(name: str, arguments: dict[str, Any]) -> str:
    """
    Execute a tool call by name with given arguments.
    Returns a JSON string of the result.
    """
    logger.info("Executing tool call: %s with args: %s", name, arguments)
    
    try:
        if name == "duck_duck_go_search":
            result = duck_duck_go_search(**arguments)
        elif name == "duck_duck_go_image_search":
            result = duck_duck_go_image_search(**arguments)
        elif name == "get_subreddit_posts":
            result = get_subreddit_posts(**arguments)
        elif name == "get_user_posts":
            result = get_user_posts(**arguments)
        elif name == "get_redgifs_user_posts":
            result = get_redgifs_user_posts(**arguments)
        elif name == "search_subreddit":
            result = search_subreddit(**arguments)
        elif name == "search_reddit":
            result = search_reddit(**arguments)
        elif name == "get_post_by_url":
            result = get_post_by_url(**arguments)
        else:
            return json.dumps({"error": f"Tool '{name}' not found."})

        # Return result as JSON string. 
        # Models expect tool output to be a string (often JSON).
        # We model_dump the Pydantic objects if they are list of models.
        if isinstance(result, list) and len(result) > 0 and hasattr(result[0], "model_dump"):
            return json.dumps([item.model_dump() for item in result], default=str)

        if hasattr(result, "model_dump"):
            return json.dumps(result.model_dump(), default=str)

        return json.dumps(result, default=str)
        
    except Exception as exc:
        logger.exception("Error executing tool %s", name)
        return json.dumps({"error": str(exc)})
