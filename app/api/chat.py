import json
import uuid
from pathlib import Path
import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlmodel import Session, select

from app.db import BASE_DIR, get_session
from app.models import AppSettings, ChatRequest
from app.core.chat.tools import get_tool_definitions
from app.core.chat.executor import execute_tool_call


router = APIRouter(prefix="/api/chat", tags=["chat"])
CHAT_UPLOAD_DIR = BASE_DIR / "data" / "chat_uploads"
CHAT_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
CHAT_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}

SYSTEM_PROMPT = (
    "You are a helpful AI assistant. When you find images in tool results, "
    "including Reddit posts, Redgifs posts, or DuckDuckGo image search results, display relevant images "
    "using Markdown syntax: ![alt text](image_url). Prefer URLs from an `images` field "
    "when present, because the chat UI renders those markdown images as image tiles. "
    "For Redgifs videos, include a normal watch URL and, when useful, a direct video "
    "link using Markdown syntax like [video:title](hd_url_or_sd_url). "
    "If a user wants to search Reddit but does not specify which subreddit to use, "
    "first use duck_duck_go_search to determine which subreddit is the best fit, "
    "then use the Reddit tools with that subreddit. "
    "Keep your responses concise and focused on the user's request."
)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.get("/tools")
async def get_tools() -> list[dict]:
    return get_tool_definitions()


@router.post("/uploads", status_code=201)
async def upload_chat_media(file: UploadFile = File(...)) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided.")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in CHAT_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported chat upload type: {suffix}")
    filename = f"{uuid.uuid4().hex}{suffix}"
    destination = (CHAT_UPLOAD_DIR / filename).resolve()
    if not destination.is_relative_to(CHAT_UPLOAD_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    destination.write_bytes(await file.read())
    return {
        "filename": filename,
        "url": f"/api/chat/uploads/{filename}",
        "content_type": file.content_type or "image/*",
    }


@router.get("/uploads/{filename}")
def get_chat_upload(filename: str) -> FileResponse:
    path = (CHAT_UPLOAD_DIR / filename).resolve()
    if not path.is_relative_to(CHAT_UPLOAD_DIR.resolve()) or not path.exists():
        raise HTTPException(status_code=404, detail="Upload not found.")
    return FileResponse(path)


@router.post("/completions")
async def chat_completions(
    body: ChatRequest,
    session: Session = Depends(get_session),
) -> StreamingResponse:
    settings = session.exec(select(AppSettings)).first()
    llama_url = (
        settings.llama_url.rstrip("/")
        if settings and settings.llama_url
        else "http://localhost:8080"
    )

    payload: dict = body.model_dump(exclude_none=True)
    payload["tools"] = get_tool_definitions()
    payload.pop("stream", None)  # we control streaming ourselves

    if not any(m.get("role") == "system" for m in payload.get("messages", [])):
        payload["messages"].insert(0, {"role": "system", "content": SYSTEM_PROMPT})

    async def generate():
        tool_usage: list[dict] = []

        for _ in range(5):
            accumulated_tool_calls: dict[int, dict] = {}
            accumulated_content = ""

            try:
                async with httpx.AsyncClient(timeout=120.0) as client:
                    async with client.stream(
                        "POST",
                        f"{llama_url}/v1/chat/completions",
                        json={**payload, "stream": True},
                    ) as resp:
                        if not resp.is_success:
                            err = await resp.aread()
                            yield _sse({"type": "error", "message": f"Llama.cpp error: {err[:300]}"})
                            return

                        async for raw in resp.aiter_lines():
                            if not raw.startswith("data: "):
                                continue
                            data = raw[6:].strip()
                            if data == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                            except json.JSONDecodeError:
                                continue

                            delta = chunk["choices"][0].get("delta", {})

                            # Stream text tokens immediately
                            text = delta.get("content") or ""
                            if text:
                                accumulated_content += text
                                yield _sse({"type": "content", "text": text})

                            # Accumulate tool call fragments
                            for tc in delta.get("tool_calls", []):
                                idx = tc.get("index", 0)
                                if idx not in accumulated_tool_calls:
                                    accumulated_tool_calls[idx] = {
                                        "id": "", "name": "", "arguments": ""
                                    }
                                if tc.get("id"):
                                    accumulated_tool_calls[idx]["id"] += tc["id"]
                                fn = tc.get("function", {})
                                if fn.get("name"):
                                    accumulated_tool_calls[idx]["name"] += fn["name"]
                                if fn.get("arguments"):
                                    accumulated_tool_calls[idx]["arguments"] += fn["arguments"]

            except httpx.RequestError as exc:
                yield _sse({"type": "error", "message": f"Cannot reach Llama.cpp: {exc}"})
                return

            # No tool calls → content was streamed, we're done
            if not accumulated_tool_calls:
                break

            # Append assistant message that requested the tool calls
            payload["messages"].append({
                "role": "assistant",
                "content": accumulated_content or None,
                "tool_calls": [
                    {
                        "id": accumulated_tool_calls[i]["id"],
                        "type": "function",
                        "function": {
                            "name": accumulated_tool_calls[i]["name"],
                            "arguments": accumulated_tool_calls[i]["arguments"],
                        },
                    }
                    for i in sorted(accumulated_tool_calls)
                ],
            })

            # Execute each tool call
            for i in sorted(accumulated_tool_calls):
                tc = accumulated_tool_calls[i]
                name = tc["name"]
                try:
                    args = json.loads(tc["arguments"])
                except json.JSONDecodeError:
                    args = {}

                yield _sse({"type": "tool_start", "name": name, "arguments": args})
                result = await execute_tool_call(name, args)
                tool_usage.append({"name": name, "arguments": args})
                yield _sse({"type": "tool_end", "name": name})

                payload["messages"].append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "name": name,
                    "content": result,
                })

        yield _sse({"type": "done", "tool_usage": tool_usage})

    return StreamingResponse(generate(), media_type="text/event-stream")
