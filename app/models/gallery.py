from datetime import datetime
from sqlmodel import SQLModel


class GalleryImage(SQLModel):
    id: str
    generation_id: str
    filename: str
    image_url: str
    created_at: datetime
    size_bytes: int
    width: int | None = None
    height: int | None = None
    media_type: str = "image"
    video_url: str | None = None


class GalleryDeleteRequest(SQLModel):
    image_ids: list[str]


class GalleryMoveRequest(SQLModel):
    image_ids: list[str]
    dataset_id: int


class GalleryExportRequest(SQLModel):
    image_ids: list[str]
    destination_dir: str


class GalleryExportResponse(SQLModel):
    exported: int
    destination_dir: str
