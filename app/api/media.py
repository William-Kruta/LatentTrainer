from __future__ import annotations

import json
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.db import BASE_DIR, get_session
from app.models import (
    Dataset,
    MediaClipExportRequest,
    MediaClipExportToDatasetRequest,
    MediaDownloadRequest,
    MediaDownloadResponse,
    MediaDownloadUrlRequest,
    MediaDownloadUrlResponse,
    MediaFrameExportResponse,
    MediaVideo,
)

router = APIRouter(prefix="/api/media", tags=["media"])

UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS
_download_jobs: dict[str, dict[str, Any]] = {}
_download_jobs_lock = threading.Lock()


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
    media_type = "image" if video_path.suffix.lower() in IMAGE_EXTENSIONS else "video"
    return MediaVideo(
        filename=video_path.name,
        title=sidecar.get("title") or video_path.stem,
        video_url=f"/api/media/video/{quote(video_path.name)}",
        media_type=media_type,
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
    if not video_path.exists() or video_path.suffix.lower() not in MEDIA_EXTENSIONS:
        raise HTTPException(status_code=404, detail="Media not found.")
    return video_path


def _download_job_snapshot(job_id: str) -> dict[str, Any]:
    with _download_jobs_lock:
        job = _download_jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Download job not found.")
        return dict(job)


def _update_download_job(job_id: str, **updates: Any) -> None:
    with _download_jobs_lock:
        if job_id in _download_jobs:
            _download_jobs[job_id].update(updates)


def _resolve_download_path(info: dict[str, Any], downloader: Any) -> Path:
    requested_downloads = info.get("requested_downloads") or []
    file_path_str = requested_downloads[0].get("filepath") if requested_downloads else info.get("_filename")
    if not file_path_str:
        file_path_str = downloader.prepare_filename(info)
    media_path = Path(file_path_str)
    if not media_path.is_absolute():
        media_path = (BASE_DIR / media_path).resolve()
    if media_path.suffix.lower() not in MEDIA_EXTENSIONS:
        for extension in (".mp4", ".mkv", ".webm", ".mov", ".m4v", ".avi", ".jpg", ".jpeg", ".png", ".webp"):
            candidate = media_path.with_suffix(extension)
            if candidate.exists():
                media_path = candidate
                break
    return media_path


def _download_media(url: str, progress_hook: Any | None = None) -> MediaVideo:
    try:
        import yt_dlp
    except ImportError as exc:
        raise RuntimeError("yt_dlp is not installed in the backend environment.") from exc

    options: dict[str, Any] = {
        "outtmpl": str(UPLOADS_DIR / "%(title).160B [%(id)s].%(ext)s"),
        "noplaylist": True,
        "merge_output_format": "mp4",
        "format": "bv*+ba/b",
        "quiet": True,
        "no_warnings": True,
    }
    if progress_hook is not None:
        options["progress_hooks"] = [progress_hook]

    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=True)
        media_path = _resolve_download_path(info, downloader)

    if not media_path.exists():
        raise RuntimeError("Download completed but the saved media file could not be located.")

    metadata = {
        "title": info.get("title"),
        "duration": info.get("duration"),
        "fps": info.get("fps"),
        "webpage_url": info.get("webpage_url") or url,
        "original_url": url,
    }
    _metadata_path(media_path).write_text(json.dumps(metadata, indent=2))
    return _video_response(media_path)


def _run_download_job(job_id: str, url: str) -> None:
    def hook(event: dict[str, Any]) -> None:
        snapshot = _download_job_snapshot(job_id)
        if snapshot.get("cancel_requested"):
            raise RuntimeError("Download cancelled.")
        total = event.get("total_bytes") or event.get("total_bytes_estimate")
        downloaded = event.get("downloaded_bytes")
        _update_download_job(
            job_id,
            status="running" if event.get("status") == "downloading" else snapshot.get("status", "running"),
            downloaded_bytes=downloaded,
            total_bytes=total,
            speed=event.get("speed"),
            eta=event.get("eta"),
        )

    try:
        _update_download_job(job_id, status="running", started_at=datetime.now(timezone.utc).isoformat())
        video = _download_media(url, progress_hook=hook)
        _update_download_job(
            job_id,
            status="completed",
            finished_at=datetime.now(timezone.utc).isoformat(),
            video=video.model_dump(mode="json"),
        )
    except Exception as exc:
        status = "cancelled" if _download_job_snapshot(job_id).get("cancel_requested") else "failed"
        _update_download_job(
            job_id,
            status=status,
            error=str(exc),
            finished_at=datetime.now(timezone.utc).isoformat(),
        )


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


@router.get("/items", response_model=list[MediaVideo])
def list_media_items() -> list[MediaVideo]:
    media = [path for path in UPLOADS_DIR.iterdir() if path.is_file() and path.suffix.lower() in MEDIA_EXTENSIONS]
    media.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    return [_video_response(media_path) for media_path in media]


@router.get("/video/{filename}")
def get_video(filename: str) -> FileResponse:
    return FileResponse(_safe_upload_video_path(filename))


@router.delete("/video/{filename}")
def delete_video(filename: str) -> dict:
    video_path = _safe_upload_video_path(filename)
    metadata_path = _metadata_path(video_path)

    try:
        video_path.unlink(missing_ok=True)
        metadata_path.unlink(missing_ok=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete video: {exc}") from exc

    return {"status": "deleted", "filename": filename}


@router.post("/download", response_model=MediaDownloadResponse, status_code=201)
def download_video(payload: MediaDownloadRequest) -> MediaDownloadResponse:
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="A media URL is required.")

    try:
        video = _download_media(url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"yt_dlp download failed: {exc}") from exc

    return MediaDownloadResponse(video=video)


@router.get("/download-jobs")
def list_download_jobs() -> list[dict[str, Any]]:
    with _download_jobs_lock:
        return sorted(_download_jobs.values(), key=lambda job: job.get("created_at", ""), reverse=True)


@router.post("/download-jobs", status_code=202)
def create_download_job(payload: MediaDownloadRequest) -> dict[str, Any]:
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="A media URL is required.")
    with _download_jobs_lock:
        for job in _download_jobs.values():
            if job.get("url") == url and job.get("status") in {"queued", "running"}:
                return dict(job)
        job_id = uuid.uuid4().hex
        _download_jobs[job_id] = {
            "job_id": job_id,
            "kind": "download",
            "label": url,
            "url": url,
            "status": "queued",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "started_at": None,
            "finished_at": None,
            "downloaded_bytes": None,
            "total_bytes": None,
            "speed": None,
            "eta": None,
            "cancel_requested": False,
            "error": None,
            "video": None,
        }
    threading.Thread(target=_run_download_job, args=(job_id, url), daemon=True).start()
    return _download_job_snapshot(job_id)


@router.get("/download-jobs/{job_id}")
def get_download_job(job_id: str) -> dict[str, Any]:
    return _download_job_snapshot(job_id)


@router.post("/download-jobs/{job_id}/cancel")
def cancel_download_job(job_id: str) -> dict[str, Any]:
    _download_job_snapshot(job_id)
    _update_download_job(job_id, cancel_requested=True, status="cancelling")
    return _download_job_snapshot(job_id)


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


@router.post("/export-clip", response_model=MediaFrameExportResponse)
def export_clip(payload: MediaClipExportRequest) -> MediaFrameExportResponse:
    video_path = _safe_upload_video_path(payload.filename)
    output_dir = Path(payload.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    output_filename = Path(payload.output_filename or "clip.mp4").name
    if not output_filename.suffix:
        output_filename = f"{output_filename}.mp4"

    destination = output_dir / output_filename

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(payload.start_time),
        "-to", str(payload.end_time),
        "-i", str(video_path),
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-c:a", "aac",
        str(destination)
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=500, detail=f"ffmpeg failed: {exc.stderr}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to export clip: {exc}") from exc

    return MediaFrameExportResponse(path=str(destination))


@router.post("/export-clip-to-dataset", response_model=MediaFrameExportResponse)
def export_clip_to_dataset(
    payload: MediaClipExportToDatasetRequest,
    session: Session = Depends(get_session),
) -> MediaFrameExportResponse:
    dataset = session.get(Dataset, payload.dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")

    video_path = _safe_upload_video_path(payload.filename)
    dataset_path = Path(dataset.path)
    dataset_path.mkdir(parents=True, exist_ok=True)

    output_filename = Path(payload.output_filename or "clip.mp4").name
    if not output_filename.suffix:
        output_filename = f"{output_filename}.mp4"

    destination = (dataset_path / output_filename).resolve()
    if not destination.is_relative_to(dataset_path.resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(payload.start_time),
        "-to", str(payload.end_time),
        "-i", str(video_path),
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-c:a", "aac",
        str(destination)
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        raise HTTPException(status_code=500, detail=f"ffmpeg failed: {exc.stderr}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to export clip to dataset: {exc}") from exc

    _refresh_dataset_counts(dataset)
    session.add(dataset)
    session.commit()

    return MediaFrameExportResponse(path=str(destination))


@router.post("/download-url", response_model=MediaDownloadUrlResponse)
async def download_url(
    payload: MediaDownloadUrlRequest,
    session: Session = Depends(get_session),
) -> MediaDownloadUrlResponse:
    url = payload.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="A URL is required.")

    # Determine destination
    if payload.dataset_id is not None:
        dataset = session.get(Dataset, payload.dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found.")
        base_dir = Path(dataset.path)
    else:
        base_dir = UPLOADS_DIR

    base_dir.mkdir(parents=True, exist_ok=True)

    # Determine filename
    if payload.filename:
        filename = Path(payload.filename).name
    else:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        filename = Path(parsed.path).name or "downloaded_file"
        # Basic cleanup for Reddit-style URLs with queries
        if "?" in filename:
            filename = filename.split("?")[0]

    destination = (base_dir / filename).resolve()
    if not destination.is_relative_to(base_dir.resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    # Avoid overwrite
    if destination.exists():
        stem = destination.stem
        ext = destination.suffix
        counter = 1
        while destination.exists():
            destination = (base_dir / f"{stem}_{counter}{ext}").resolve()
            counter += 1

    try:
        import httpx
        async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
            # Add a user agent to avoid being blocked by some sites
            headers = {"User-Agent": "LatentTrainer/0.1.0"}
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            destination.write_bytes(response.content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to download from URL: {exc}") from exc

    if payload.dataset_id is not None:
        _refresh_dataset_counts(dataset)
        session.add(dataset)
        session.commit()

    return MediaDownloadUrlResponse(path=str(destination), filename=destination.name)
