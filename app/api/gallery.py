from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.api.datasets import IMAGE_EXTENSIONS, _refresh_counts
from app.db import BASE_DIR, get_session
from app.models import Dataset, GalleryDeleteRequest, GalleryExportRequest, GalleryExportResponse, GalleryImage, GalleryMoveRequest

router = APIRouter(prefix="/api/gallery", tags=["gallery"])

GENERATIONS_DIR = BASE_DIR / "data" / "generations"
LTX_OUTPUT_DIR = BASE_DIR / "data" / "ltx_outputs"
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}
_LTX_PREFIX = "ltx-"


def _image_id(path: Path) -> str:
    return f"{path.parent.name}/{path.name}"


def _resolve_gallery_image(image_id: str) -> Path:
    parts = Path(image_id).parts
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid gallery image id.")

    generation_id, filename = parts
    image_path = (GENERATIONS_DIR / generation_id / filename).resolve()
    generation_root = GENERATIONS_DIR.resolve()
    if not image_path.is_relative_to(generation_root):
        raise HTTPException(status_code=400, detail="Invalid gallery image id.")
    if not image_path.exists() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=404, detail="Gallery image not found.")
    return image_path


def _resolve_gallery_video(image_id: str) -> Path:
    parts = Path(image_id).parts
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid gallery video id.")

    generation_id, filename = parts
    if not generation_id.startswith(_LTX_PREFIX):
        raise HTTPException(status_code=400, detail="Invalid gallery video id.")

    job_id = generation_id[len(_LTX_PREFIX):]
    video_path = (LTX_OUTPUT_DIR / job_id / filename).resolve()
    if not video_path.is_relative_to(LTX_OUTPUT_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Invalid gallery video id.")
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Gallery video not found.")
    return video_path


def _maybe_remove_empty_generation_dir(generation_dir: Path) -> None:
    if not generation_dir.exists():
        return
    remaining = [child for child in generation_dir.iterdir() if child.is_file()]
    if remaining:
        return
    shutil.rmtree(generation_dir, ignore_errors=True)


def _read_dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        from PIL import Image

        with Image.open(path) as img:
            return img.width, img.height
    except Exception:
        return None, None


def _list_gallery_images() -> list[GalleryImage]:
    items: list[GalleryImage] = []

    if GENERATIONS_DIR.exists():
        for generation_dir in GENERATIONS_DIR.iterdir():
            if not generation_dir.is_dir():
                continue
            for image_path in generation_dir.iterdir():
                if not image_path.is_file() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
                    continue
                width, height = _read_dimensions(image_path)
                stat = image_path.stat()
                items.append(
                    GalleryImage(
                        id=_image_id(image_path),
                        generation_id=generation_dir.name,
                        filename=image_path.name,
                        image_url=f"/api/gallery/image/{generation_dir.name}/{image_path.name}",
                        created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                        size_bytes=stat.st_size,
                        width=width,
                        height=height,
                        media_type="image",
                    )
                )

    if LTX_OUTPUT_DIR.exists():
        for job_dir in LTX_OUTPUT_DIR.iterdir():
            if not job_dir.is_dir():
                continue
            for video_path in job_dir.iterdir():
                if not video_path.is_file() or video_path.suffix.lower() not in VIDEO_EXTENSIONS:
                    continue
                stat = video_path.stat()
                generation_id = f"{_LTX_PREFIX}{job_dir.name}"
                items.append(
                    GalleryImage(
                        id=f"{generation_id}/{video_path.name}",
                        generation_id=generation_id,
                        filename=video_path.name,
                        image_url="",
                        video_url=f"/api/ltx/videos/{job_dir.name}/{video_path.name}",
                        created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                        size_bytes=stat.st_size,
                        media_type="video",
                    )
                )

    items.sort(key=lambda item: item.created_at, reverse=True)
    return items


@router.get("", response_model=list[GalleryImage])
def list_gallery_images() -> list[GalleryImage]:
    return _list_gallery_images()


@router.get("/image/{generation_id}/{filename}")
def get_gallery_image(generation_id: str, filename: str) -> FileResponse:
    image_path = _resolve_gallery_image(f"{generation_id}/{filename}")
    return FileResponse(image_path)


@router.post("/delete", status_code=204)
def delete_gallery_images(payload: GalleryDeleteRequest) -> None:
    for image_id in payload.image_ids:
        parts = Path(image_id).parts
        if len(parts) == 2 and parts[0].startswith(_LTX_PREFIX):
            video_path = _resolve_gallery_video(image_id)
            video_path.unlink(missing_ok=True)
            _maybe_remove_empty_generation_dir(video_path.parent)
        else:
            image_path = _resolve_gallery_image(image_id)
            generation_dir = image_path.parent
            image_path.unlink(missing_ok=True)
            caption_path = image_path.with_suffix(".txt")
            caption_path.unlink(missing_ok=True)
            _maybe_remove_empty_generation_dir(generation_dir)


@router.post("/export", response_model=GalleryExportResponse)
def export_gallery_images(payload: GalleryExportRequest) -> GalleryExportResponse:
    destination = Path(payload.destination_dir).expanduser().resolve()
    if not destination.exists():
        try:
            destination.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Cannot create destination directory: {exc}") from exc

    exported = 0
    for image_id in payload.image_ids:
        parts = Path(image_id).parts
        if len(parts) == 2 and parts[0].startswith(_LTX_PREFIX):
            source_path = _resolve_gallery_video(image_id)
        else:
            source_path = _resolve_gallery_image(image_id)

        dest_file = destination / source_path.name
        if dest_file.exists():
            stem = dest_file.stem
            suffix = dest_file.suffix
            counter = 1
            while dest_file.exists():
                dest_file = destination / f"{stem}_{counter}{suffix}"
                counter += 1

        shutil.copy2(str(source_path), str(dest_file))
        exported += 1

    return GalleryExportResponse(exported=exported, destination_dir=str(destination))


@router.post("/move", status_code=204)
def move_gallery_images(payload: GalleryMoveRequest, session: Session = Depends(get_session)) -> None:
    dataset = session.get(Dataset, payload.dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")

    dataset_path = Path(dataset.path)
    dataset_path.mkdir(parents=True, exist_ok=True)

    for image_id in payload.image_ids:
        image_path = _resolve_gallery_image(image_id)
        generation_dir = image_path.parent
        destination = dataset_path / image_path.name
        if destination.exists():
            stem = destination.stem
            suffix = destination.suffix
            counter = 1
            while destination.exists():
                destination = dataset_path / f"{stem}_{counter}{suffix}"
                counter += 1

        shutil.move(str(image_path), str(destination))

        source_caption = image_path.with_suffix(".txt")
        if source_caption.exists():
            destination_caption = destination.with_suffix(".txt")
            shutil.move(str(source_caption), str(destination_caption))

        _maybe_remove_empty_generation_dir(generation_dir)

    _refresh_counts(dataset)
    session.add(dataset)
    session.commit()
