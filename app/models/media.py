from datetime import datetime
from sqlmodel import SQLModel


class GPUStat(SQLModel):
    id: int
    name: str
    vram_used_gb: float
    vram_total_gb: float
    utilization_pct: int
    temperature_c: int


class AutoCaptionRequest(SQLModel):
    llama_url: str = "http://localhost:8080"
    model: str = ""
    system_prompt: str = ""
    trigger_word: str = ""
    max_tokens: int = 2048
    overwrite: bool = False


class MediaVideo(SQLModel):
    filename: str
    title: str
    video_url: str
    media_type: str = "video"
    size_bytes: int
    created_at: datetime
    duration_seconds: float | None = None
    fps: float | None = None
    source_url: str | None = None


class MediaDownloadRequest(SQLModel):
    url: str


class MediaDownloadResponse(SQLModel):
    video: MediaVideo


class MediaFrameExportResponse(SQLModel):
    path: str


class MediaClipExportRequest(SQLModel):
    filename: str
    start_time: float
    end_time: float
    output_dir: str
    output_filename: str


class MediaClipExportToDatasetRequest(SQLModel):
    filename: str
    start_time: float
    end_time: float
    dataset_id: int
    output_filename: str


class MediaDownloadUrlRequest(SQLModel):
    url: str
    dataset_id: int | None = None
    filename: str | None = None


class MediaDownloadUrlResponse(SQLModel):
    path: str
    filename: str
