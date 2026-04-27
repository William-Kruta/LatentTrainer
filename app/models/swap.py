from __future__ import annotations

from typing import Literal

from sqlmodel import SQLModel


class SwapJobStatus(SQLModel):
    job_id: str
    status: Literal["queued", "running", "cancelling", "cancelled", "done", "error"]
    current_frame: int = 0
    total_frames: int = 0
    output_path: str | None = None
    error: str | None = None


class SwapRunResponse(SQLModel):
    job_id: str
