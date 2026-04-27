from __future__ import annotations

import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app.core.swap.worker import SwapJob, preview_single_frame_subprocess, run_swap_job
from app.db import BASE_DIR
from app.models.swap import SwapJobStatus, SwapRunResponse

router = APIRouter(prefix="/api/swap", tags=["swap"])

UPLOADS_DIR = BASE_DIR / "uploads"
SWAPS_DIR = BASE_DIR / "media" / "swaps"
SWAPS_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v"}

_jobs: dict[str, SwapJob] = {}


def _safe_video_path(filename: str) -> Path:
    path = (UPLOADS_DIR / filename).resolve()
    if not path.is_relative_to(UPLOADS_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    if not path.exists() or path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=404, detail="Video not found.")
    return path


@router.post("/preview")
async def preview_swap(
    face_image: UploadFile = File(...),
    video_filename: str = Form(...),
    timestamp_seconds: float = Form(0.0),
    mask_strength: float = Form(0.85),
    mask_feather: float = Form(0.40),
    mask_vertical_ratio: float = Form(0.65),
    mask_anchor: str = Form("top"),
) -> Response:
    video_path = _safe_video_path(video_filename)

    face_tmp = SWAPS_DIR / f".face_preview_{uuid.uuid4().hex}.jpg"
    output_tmp = SWAPS_DIR / f".preview_result_{uuid.uuid4().hex}.jpg"
    metadata_tmp = SWAPS_DIR / f".preview_result_{uuid.uuid4().hex}.json"
    try:
        face_tmp.write_bytes(await face_image.read())
        preview_single_frame_subprocess(
            video_path=video_path,
            face_image_path=face_tmp,
            output_path=output_tmp,
            metadata_path=metadata_tmp,
            timestamp_seconds=timestamp_seconds,
            mask_strength=mask_strength,
            mask_feather=mask_feather,
            mask_vertical_ratio=mask_vertical_ratio,
            mask_anchor=mask_anchor,
        )
        content = output_tmp.read_bytes()
        metadata = metadata_tmp.read_text() if metadata_tmp.exists() else "{}"
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        face_tmp.unlink(missing_ok=True)
        output_tmp.unlink(missing_ok=True)
        metadata_tmp.unlink(missing_ok=True)

    return Response(content=content, media_type="image/jpeg", headers={"X-Swap-Mask-Metadata": metadata})


@router.post("/run", response_model=SwapRunResponse, status_code=202)
async def run_swap(
    face_image: UploadFile = File(...),
    video_filename: str = Form(...),
    output_filename: str = Form(""),
    mask_strength: float = Form(0.85),
    mask_feather: float = Form(0.40),
    mask_vertical_ratio: float = Form(0.65),
    mask_anchor: str = Form("top"),
) -> SwapRunResponse:
    video_path = _safe_video_path(video_filename)

    stem = Path(video_filename).stem
    safe_output = Path(output_filename.strip() or f"{stem}_swap.mp4").name
    if not safe_output.endswith(".mp4"):
        safe_output = f"{Path(safe_output).stem}.mp4"

    output_path = (SWAPS_DIR / safe_output).resolve()
    if not output_path.is_relative_to(SWAPS_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Invalid output filename.")

    job_id = uuid.uuid4().hex
    face_tmp = SWAPS_DIR / f".face_{job_id}.jpg"
    face_tmp.write_bytes(await face_image.read())
    preview_path = SWAPS_DIR / f".preview_{job_id}.jpg"

    job = SwapJob(job_id=job_id)
    _jobs[job_id] = job

    thread = threading.Thread(
        target=run_swap_job,
        args=(
            job,
            video_path,
            face_tmp,
            output_path,
            preview_path,
            mask_strength,
            mask_feather,
            mask_vertical_ratio,
            mask_anchor,
        ),
        daemon=True,
    )
    thread.start()
    return SwapRunResponse(job_id=job_id)


@router.get("/status/{job_id}", response_model=SwapJobStatus)
def get_status(job_id: str) -> SwapJobStatus:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return SwapJobStatus(**job.snapshot())


@router.get("/jobs", response_model=list[SwapJobStatus])
def list_swap_jobs() -> list[SwapJobStatus]:
    return [SwapJobStatus(**job.snapshot()) for job in _jobs.values()]


@router.post("/cancel/{job_id}", response_model=SwapJobStatus)
def cancel_swap(job_id: str) -> SwapJobStatus:
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    snapshot = job.snapshot()
    if snapshot["status"] in {"done", "cancelled", "error"}:
        return SwapJobStatus(**snapshot)
    job.request_cancel()
    return SwapJobStatus(**job.snapshot())


@router.get("/preview-frame/{job_id}")
def get_preview_frame(job_id: str) -> Response:
    preview_path = SWAPS_DIR / f".preview_{job_id}.jpg"
    if not preview_path.exists():
        raise HTTPException(status_code=404, detail="No preview frame yet.")
    return Response(content=preview_path.read_bytes(), media_type="image/jpeg")
