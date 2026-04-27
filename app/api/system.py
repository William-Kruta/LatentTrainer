from __future__ import annotations

import shutil
import sys
from pathlib import Path

from fastapi import APIRouter
from sqlmodel import Session, select

from app.api.image_edit import list_image_edit_jobs
from app.api.ltx import list_ltx_jobs
from app.api.media import list_download_jobs, list_media_items
from app.api.swap import list_swap_jobs
from app.core.gpu import get_gpu_stats
from app.core.generate.dispatcher import get_worker_status
from app.core.generate.queue import get_queue_status
from app.db import BASE_DIR, engine
from app.models import AppSettings, GPUStat, Job

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/gpus", response_model=list[GPUStat])
def list_gpus() -> list[GPUStat]:
    return get_gpu_stats()


@router.get("/system/overview")
def system_overview() -> dict:
    with Session(engine) as session:
        training_jobs = session.exec(select(Job).order_by(Job.started_at.desc()).limit(20)).all()
    media_items = list_media_items()[:12]
    return {
        "training_jobs": [job.model_dump(mode="json") for job in training_jobs],
        "generate_queue": get_queue_status().model_dump(mode="json"),
        "generate_worker": get_worker_status().model_dump(mode="json"),
        "swap_jobs": [job.model_dump(mode="json") for job in list_swap_jobs()],
        "ltx_jobs": list_ltx_jobs(),
        "image_edit_jobs": list_image_edit_jobs(),
        "download_jobs": list_download_jobs(),
        "recent_outputs": [item.model_dump(mode="json") for item in media_items],
        "gpus": [gpu.model_dump(mode="json") for gpu in get_gpu_stats()],
    }


@router.get("/system/health")
def system_health() -> dict:
    with Session(engine) as session:
        settings = session.exec(select(AppSettings)).first()
    paths = {
        "project_root": str(BASE_DIR),
        "python": sys.executable,
        "venv": sys.prefix,
        "swap_venv": str(BASE_DIR / ".venv-swap"),
        "uploads": str(BASE_DIR / "uploads"),
        "models": settings.model_root if settings else "",
        "loras": settings.lora_root if settings else "",
        "outputs": settings.output_root if settings else "",
        "datasets": settings.dataset_root if settings else "",
    }
    checks = []
    for name, value in paths.items():
        if name in {"python", "venv"}:
            exists = True
        else:
            exists = bool(value) and Path(value).expanduser().exists()
        checks.append({"name": name, "path": value, "ok": exists})
    return {
        "checks": checks,
        "gpus": [gpu.model_dump(mode="json") for gpu in get_gpu_stats()],
        "executables": {
            "ffmpeg": shutil.which("ffmpeg"),
            "nvidia_smi": shutil.which("nvidia-smi"),
        },
        "worker": get_worker_status().model_dump(mode="json"),
    }
