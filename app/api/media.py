from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.db import BASE_DIR, get_session
from app.models import (
    Dataset,
    MediaDownloadRequest,
    MediaDownloadResponse,
    MediaFrameExportResponse,
    MediaVideo,
)

router = APIRouter(prefix="/api/media", tags=["media"])

UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v"}


def _metadata_path(video_path: Path) -> Path:
    return video_path.with_suffix(f"{video_path.suffix}.json")


def _load_sidecar(video_path: Path) -> dict:
    metadata_path = _metadata_path(video_path)
    if not metadata_path.exists():
        return {}
    try:
        return json.loads(metadata_path.read_text())
    except json.JSONDecodeError:
        return {}


def _video_response(video_path: Path) -> MediaVideo:
    sidecar = _load_sidecar(video_path)
    stat = video_path.stat()
    created_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
    return MediaVideo(
        filename=video_path.name,
        title=sidecar.get("title") or video_path.stem,
        video_url=f"/api/media/video/{quote(video_path.name)}",
        size_bytes=stat.st_size,
        created_at=created_at,
        duration_seconds=sidecar.get("duration"),
        fps=sidecar.get("fps"),
        source_url=sidecar.get("webpage_url") or sidecar.get("original_url"),
    )


def _safe_upload_video_path(filename: str) -> Path:
    video_path = (UPLOADS_DIR / filename).resolve()
    if not video_path.is_relative_to(UPLOADS_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    if not video_path.exists() or video_path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=404, detail="Video not found.")
    return video_path


def _refresh_dataset_counts(dataset: Dataset) -> None:
    dataset_path = Path(dataset.path)
    if not dataset_path.exists():
        dataset.image_count = 0
        dataset.size_bytes = 0
        return
    files = list(dataset_path.iterdir())
    dataset.image_count = sum(1 for file_path in files if file_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"})
    dataset.size_bytes = sum(file_path.stat().st_size for file_path in files)


@router.get("/videos", response_model=list[MediaVideo])
def list_videos() -> list[MediaVideo]:
    videos = [path for path in UPLOADS_DIR.iterdir() if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS]
    videos.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return [_video_response(video_path) for video_path in videos]


@router.get("/video/{filename}")
def get_video(filename: str) -> FileResponse:
    return FileResponse(_safe_upload_video_path(filename))


@router.post("/download", response_model=MediaDownloadResponse, status_code=201)
def download_video(payload: MediaDownloadRequest) -> MediaDownloadResponse:
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="A media URL is required.")

    try:
        import yt_dlp
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="yt_dlp is not installed in the backend environment.") from exc

    options = {
        "outtmpl": str(UPLOADS_DIR / "%(title).160B [%(id)s].%(ext)s"),
        "noplaylist": True,
        "merge_output_format": "mp4",
        "format": "bv*+ba/b",
        "quiet": True,
        "no_warnings": True,
    }

    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
            requested_downloads = info.get("requested_downloads") or []
            file_path_str = requested_downloads[0].get("filepath") if requested_downloads else info.get("_filename")
            if not file_path_str:
                file_path_str = downloader.prepare_filename(info)
            video_path = Path(file_path_str)
            if not video_path.is_absolute():
                video_path = (BASE_DIR / video_path).resolve()
            if video_path.suffix.lower() not in VIDEO_EXTENSIONS:
                for extension in (".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi"):
                    candidate = video_path.with_suffix(extension)
                    if candidate.exists():
                        video_path = candidate
                        break
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"yt_dlp download failed: {exc}") from exc

    if not video_path.exists():
        raise HTTPException(status_code=500, detail="Download completed but the saved video file could not be located.")

    metadata = {
        "title": info.get("title"),
        "duration": info.get("duration"),
        "fps": info.get("fps"),
        "webpage_url": info.get("webpage_url") or url,
        "original_url": url,
    }
    _metadata_path(video_path).write_text(json.dumps(metadata, indent=2))

    return MediaDownloadResponse(video=_video_response(video_path))


@router.post("/upload", response_model=MediaDownloadResponse, status_code=201)
async def upload_video(file: UploadFile = File(...)) -> MediaDownloadResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided.")

    original_name = Path(file.filename).name
    ext = Path(original_name).suffix.lower()
    if ext not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported video format: {ext}")

    destination = (UPLOADS_DIR / original_name).resolve()
    if not destination.is_relative_to(UPLOADS_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    if destination.exists():
        stem = Path(original_name).stem
        counter = 1
        while destination.exists():
            destination = (UPLOADS_DIR / f"{stem}_{counter}{ext}").resolve()
            counter += 1

    try:
        content = await file.read()
        destination.write_bytes(content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {exc}") from exc

    return MediaDownloadResponse(video=_video_response(destination))


@router.post("/export-frame", response_model=MediaFrameExportResponse)
async def export_frame(
    frame: UploadFile = File(...),
    output_dir: str = Form(...),
    filename: str = Form(...),
) -> MediaFrameExportResponse:
    raw_output_dir = output_dir.strip()
    raw_filename = Path(filename.strip() or "frame.png").name
    if not raw_output_dir:
        raise HTTPException(status_code=400, detail="An output directory is required.")
    if not raw_filename.lower().endswith(".png"):
        raw_filename = f"{Path(raw_filename).stem}.png"

    destination_dir = Path(raw_output_dir).expanduser().resolve()
    destination = destination_dir / raw_filename
    try:
        content = await frame.read()
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to export frame: {exc}") from exc
    return MediaFrameExportResponse(path=str(destination))


@router.post("/export-frame-to-dataset", response_model=MediaFrameExportResponse)
async def export_frame_to_dataset(
    dataset_id: int = Form(...),
    filename: str = Form(...),
    frame: UploadFile = File(...),
    session: Session = Depends(get_session),
) -> MediaFrameExportResponse:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")

    dataset_path = Path(dataset.path)
    dataset_path.mkdir(parents=True, exist_ok=True)

    safe_filename = Path(filename.strip() or "frame.png").name
    if not safe_filename.lower().endswith(".png"):
        safe_filename = f"{Path(safe_filename).stem}.png"

    destination = (dataset_path / safe_filename).resolve()
    if not destination.is_relative_to(dataset_path.resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    try:
        content = await frame.read()
        destination.write_bytes(content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to export frame to dataset: {exc}") from exc

    _refresh_dataset_counts(dataset)
    session.add(dataset)
    session.commit()

    return MediaFrameExportResponse(path=str(destination))
