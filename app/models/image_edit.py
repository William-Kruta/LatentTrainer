from enum import Enum
from sqlmodel import SQLModel


class ImageEditStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class ImageEditResponse(SQLModel):
    function_run_id: str
    generation_id: str
    status: ImageEditStatus
    image_url: str
    width: int
    height: int
    prompt: str
    stage: str | None = None
    current_step: int = 0
    total_steps: int = 0
    rate_value: float | None = None
    rate_unit: str | None = None
    error: str | None = None
