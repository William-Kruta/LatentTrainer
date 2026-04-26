from __future__ import annotations

import io
import json
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image as PILImage, PngImagePlugin, UnidentifiedImageError

from app.db import BASE_DIR

IMAGE_EDIT_METADATA_KEY = "latenttrainer_image_edit_config"

router = APIRouter(prefix="/api/image-edit", tags=["image-edit"])

FK9_OUTPUT_DIR = BASE_DIR / "data" / "image_edit_outputs"
FK9_UPLOAD_DIR = BASE_DIR / "data" / "image_edit_uploads"
FK9_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
FK9_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _embed_metadata(image_path: Path, payload: dict[str, Any]) -> None:
    if image_path.suffix.lower() != ".png" or not image_path.exists():
        return
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text(IMAGE_EDIT_METADATA_KEY, json.dumps(payload))
    with PILImage.open(image_path) as img:
        img.save(image_path, format="PNG", pnginfo=metadata)


def _update_job(job_id: str, **kwargs: Any) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(kwargs)


def _run_job(
    job_id: str,
    hf_repo: str,
    prompt: str,
    input_files: list[str],
    output_path: Path,
    width: int,
    height: int,
    steps: int,
    limit: int | None,
    loras: list[dict[str, Any]],
) -> None:
    def on_event(event: dict[str, Any]) -> None:
        if event.get("type") == "stage":
            _update_job(job_id, status="running", stage=event.get("stage"))
        elif event.get("type") == "progress":
            _update_job(
                job_id,
                status="running",
                current_step=event.get("step", 0),
                total_steps=event.get("total", 0),
                rate_value=event.get("rate_value"),
                rate_unit=event.get("rate_unit"),
            )

    try:
        _update_job(job_id, status="running", stage="starting")
        from fk9_scripts.flux2_client import Flux2WorkerClient  # noqa: PLC0415

        client = Flux2WorkerClient(hf_repo=hf_repo)
        client.image_edit(
            prompt=prompt,
            input_files=input_files,
            output_path=output_path,
            width=width,
            height=height,
            steps=steps,
            limit=limit,
            loras=loras,
            on_event=on_event,
        )
        _embed_metadata(output_path, {
            "hf_repo": hf_repo,
            "prompt": prompt,
            "loras": loras,
            "width": width,
            "height": height,
            "steps": steps,
            "limit": limit,
        })
        _update_job(
            job_id,
            status="completed",
            image_url=f"/api/image-edit/images/{job_id}/{output_path.name}",
        )
    except Exception as exc:
        _update_job(job_id, status="failed", error=str(exc))


@router.post("")
async def start_image_edit(
    prompt: str = Form(...),
    hf_repo: str = Form(default="black-forest-labs/FLUX.2-klein-9B"),
    width: int = Form(default=1024),
    height: int = Form(default=1024),
    steps: int = Form(default=4),
    limit: int | None = Form(default=None),
    loras_json: str = Form(default="[]"),
    reference_images: list[UploadFile] = File(default=[]),
) -> dict:
    if len(reference_images) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 reference images allowed.")

    job_id = str(uuid.uuid4())[:8]
    job_upload_dir = FK9_UPLOAD_DIR / job_id
    job_upload_dir.mkdir(parents=True, exist_ok=True)
    job_output_dir = FK9_OUTPUT_DIR / job_id
    job_output_dir.mkdir(parents=True, exist_ok=True)

    input_files: list[str] = []
    for i, upload in enumerate(reference_images):
        suffix = Path(upload.filename or "image.png").suffix or ".png"
        dest = job_upload_dir / f"ref_{i}{suffix}"
        dest.write_bytes(await upload.read())
        input_files.append(str(dest))

    loras = json.loads(loras_json)
    output_path = job_output_dir / "output.png"

    with _jobs_lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "status": "pending",
            "stage": None,
            "current_step": 0,
            "total_steps": 0,
            "rate_value": None,
            "rate_unit": None,
            "image_url": None,
            "error": None,
        }

    threading.Thread(
        target=_run_job,
        args=(job_id, hf_repo, prompt, input_files, output_path, width, height, steps, limit, loras),
        daemon=True,
    ).start()

    return {"job_id": job_id, "status": "pending"}


@router.get("/images/{job_id}/{filename}")
def get_image_edit_image(job_id: str, filename: str) -> FileResponse:
    image_path = (FK9_OUTPUT_DIR / job_id / filename).resolve()
    if not image_path.is_relative_to(FK9_OUTPUT_DIR.resolve()) or not image_path.exists():
        raise HTTPException(status_code=404, detail="Image not found.")
    return FileResponse(image_path)


@router.get("/{job_id}")
def get_image_edit_job(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return dict(job)
