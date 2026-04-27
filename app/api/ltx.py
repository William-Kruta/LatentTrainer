from __future__ import annotations

import sys
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, SQLModel, select

from app.db import BASE_DIR, get_session
from app.models import LtxModelConfig

router = APIRouter(prefix="/api/ltx", tags=["ltx"])

LTX_OUTPUT_DIR = BASE_DIR / "data" / "ltx_outputs"
LTX_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


class LtxGenerateRequest(SQLModel):
    prompt: str
    negative_prompt: str = ""
    width: int = 768
    height: int = 512
    num_frames: int = 121
    frame_rate: int = 24
    num_inference_steps: int = 30
    cfg_scale: float = 3.0
    stg_scale: float = 1.0
    seed: int = 42
    offload_mode: str = "cpu"
    loras: list[dict[str, Any]] = []


def _get_ltx_config(session: Session) -> LtxModelConfig:
    config = session.exec(select(LtxModelConfig)).first()
    if config is None:
        config = LtxModelConfig()
        session.add(config)
        session.commit()
        session.refresh(config)
    return config


def _update_job(job_id: str, **kwargs: Any) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(kwargs)


def _run_job(
    job_id: str,
    config: LtxModelConfig,
    request: LtxGenerateRequest,
    output_path: Path,
    input_image_path: Path | None = None,
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
        elif event.get("type") == "error":
            _update_job(job_id, status="failed", error=event.get("message"))

    try:
        _update_job(job_id, status="running", stage="starting")

        sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
        from inference.ltx.client import LtxWorkerClient  # noqa: PLC0415

        client = LtxWorkerClient(ltx_install_path=config.ltx_install_path)
        client.generate_video(
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            checkpoint_path=config.model_path,
            gemma_repo_id=config.text_encoder_repo_id,
            spatial_upsampler_path=config.spatial_upscaler_path,
            distilled_lora_path=config.temporal_upscaler_path,
            offload_mode=request.offload_mode,
            output_path=output_path,
            width=request.width,
            height=request.height,
            num_frames=request.num_frames,
            frame_rate=request.frame_rate,
            num_inference_steps=request.num_inference_steps,
            cfg_scale=request.cfg_scale,
            stg_scale=request.stg_scale,
            seed=request.seed,
            input_image_path=input_image_path,
            loras=request.loras or config.loras,
            on_event=on_event,
        )
        _update_job(
            job_id,
            status="completed",
            video_url=f"/api/ltx/videos/{job_id}/{output_path.name}",
        )
    except Exception as exc:
        _update_job(job_id, status="failed", error=str(exc))


@router.post("/generate")
async def generate_video(
    prompt: str = Form(...),
    negative_prompt: str = Form(""),
    width: int = Form(768),
    height: int = Form(512),
    num_frames: int = Form(121),
    frame_rate: int = Form(24),
    num_inference_steps: int = Form(30),
    cfg_scale: float = Form(3.0),
    stg_scale: float = Form(1.0),
    seed: int = Form(42),
    offload_mode: str = Form("cpu"),
    loras_json: str = Form("[]"),
    input_image: UploadFile | None = File(None),
    session: Session = Depends(get_session),
) -> dict:
    import json as _json
    config = _get_ltx_config(session)

    if not config.ltx_install_path:
        raise HTTPException(status_code=400, detail="LTX-2 repo path not configured in Settings > Model > LTX-2.3.")
    if not config.model_path:
        raise HTTPException(status_code=400, detail="LTX-2 model checkpoint not configured.")
    if not config.text_encoder_repo_id:
        raise HTTPException(status_code=400, detail="Text encoder repo ID not configured.")

    try:
        loras = _json.loads(loras_json)
    except Exception:
        loras = []

    body = LtxGenerateRequest(
        prompt=prompt,
        negative_prompt=negative_prompt,
        width=width,
        height=height,
        num_frames=num_frames,
        frame_rate=frame_rate,
        num_inference_steps=num_inference_steps,
        cfg_scale=cfg_scale,
        stg_scale=stg_scale,
        seed=seed,
        offload_mode=offload_mode,
        loras=loras,
    )

    job_id = str(uuid.uuid4())[:8]
    job_dir = LTX_OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    output_path = job_dir / "output.mp4"

    input_image_path: Path | None = None
    if input_image is not None and input_image.filename:
        suffix = Path(input_image.filename).suffix or ".png"
        input_image_path = job_dir / f"input{suffix}"
        content = await input_image.read()
        input_image_path.write_bytes(content)

    with _jobs_lock:
        _jobs[job_id] = {
            "job_id": job_id,
            "status": "pending",
            "stage": None,
            "current_step": 0,
            "total_steps": 0,
            "rate_value": None,
            "rate_unit": None,
            "video_url": None,
            "error": None,
        }

    threading.Thread(
        target=_run_job,
        args=(job_id, config, body, output_path, input_image_path),
        daemon=True,
    ).start()

    return {"job_id": job_id, "status": "pending"}


@router.get("/jobs/{job_id}")
def get_ltx_job(job_id: str) -> dict:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return dict(job)


@router.get("/jobs")
def list_ltx_jobs() -> list[dict]:
    with _jobs_lock:
        jobs = [dict(job) for job in _jobs.values()]
    return sorted(jobs, key=lambda job: job.get("job_id", ""), reverse=True)


@router.get("/videos/{job_id}/{filename}")
def get_ltx_video(job_id: str, filename: str) -> FileResponse:
    video_path = (LTX_OUTPUT_DIR / job_id / filename).resolve()
    if not video_path.is_relative_to(LTX_OUTPUT_DIR.resolve()) or not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found.")
    return FileResponse(video_path, media_type="video/mp4")
