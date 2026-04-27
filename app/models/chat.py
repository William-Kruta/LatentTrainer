from __future__ import annotations

from typing import Any
from typing import Literal

from sqlmodel import SQLModel


class ChatMessage(SQLModel):
    role: Literal["system", "user", "assistant"]
    content: str | list[dict[str, Any]]


class ChatRequest(SQLModel):
    messages: list[ChatMessage]
    model: str = ""
    max_tokens: int = 1024
    temperature: float = 0.7
    stream: bool = False


class ChatResponseChoice(SQLModel):
    message: ChatMessage
    finish_reason: str | None = None
    index: int = 0


class ToolUsageItem(SQLModel):
    name: str
    arguments: dict


class ChatResponse(SQLModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[ChatResponseChoice]
    usage: dict | None = None
    tool_usage: list[ToolUsageItem] = []
