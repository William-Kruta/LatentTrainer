from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.core.generate import GENERATIONS_DIR, stop_worker
from app.models import GenerateFunctionConfigCreate, ImageEditResponse, ImageEditStatus
from inference.flux.client import Flux2WorkerClient

router = APIRouter(prefix="/api/generate", tags=["generate"])
FUNCTION_OUTPUTS_DIR = GENERATIONS_DIR / "functions"
FUNCTION_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
flux_client = Flux2WorkerClient()
_function_runs_lock = threading.Lock()


@dataclass
class FunctionRunRecord:
    function_run_id: str
    generation_id: str
    width: int
    height: int
    prompt: str
    status: ImageEditStatus = ImageEditStatus.pending
    image_url: str = ""
    stage: str | None = None
    current_step: int = 0
    total_steps: int = 0
    rate_value: float | None = None
    rate_unit: str | None = None
    error: str | None = None
    log_lines: list[str] = field(default_factory=list)


_function_runs: dict[str, FunctionRunRecord] = {}


def _resolve_generation_image_path(generation_id: str) -> Path:
    generation_dir = GENERATIONS_DIR / generation_id
    if not generation_dir.exists():
        raise HTTPException(status_code=404, detail="Source generation not found.")
    images = sorted(generation_dir.glob("*.png"))
    if not images:
        raise HTTPException(status_code=404, detail="No generated image found for source generation.")
    return images[-1]


def _serialize_function_run(record: FunctionRunRecord) -> ImageEditResponse:
    return ImageEditResponse(
        function_run_id=record.function_run_id,
        generation_id=record.generation_id,
        status=record.status,
        image_url=record.image_url,
        width=record.width,
        height=record.height,
        prompt=record.prompt,
        stage=record.stage,
        current_step=record.current_step,
        total_steps=record.total_steps,
        rate_value=record.rate_value,
        rate_unit=record.rate_unit,
        error=record.error,
    )


def _update_function_run(function_run_id: str, **updates: object) -> None:
    with _function_runs_lock:
        record = _function_runs[function_run_id]
        for key, value in updates.items():
            setattr(record, key, value)


def _append_function_log(function_run_id: str, line: str) -> None:
    with _function_runs_lock:
        _function_runs[function_run_id].log_lines.append(line)


def _run_image_edit_job(
    *,
    function_run_id: str,
    source_generation_id: str,
    prompt: str,
    width: int,
    height: int,
    steps: int,
    loras_json: str,
    extra_image_bytes: bytes | None,
    extra_image_filename: str | None,
    cpu_offload: bool = False,
    sequential_cpu_offload: bool = False,
    vae_tiling: bool = False,
    vae_slicing: bool = False,
) -> None:
    source_image_path = _resolve_generation_image_path(source_generation_id)
    output_dir = FUNCTION_OUTPUTS_DIR / source_generation_id / function_run_id
    output_dir.mkdir(parents=True, exist_ok=True)

    input_files = [str(source_image_path)]
    temp_extra_path: Path | None = None
    try:
        if extra_image_bytes is not None:
            temp_extra_path = output_dir / f"extra_{Path(extra_image_filename or 'image').name}"
            temp_extra_path.write_bytes(extra_image_bytes)
            input_files.append(str(temp_extra_path))

        try:
            loras = GenerateFunctionConfigCreate.model_validate(
                {"name": "temp", "prompt": prompt, "steps": steps, "loras": json.loads(loras_json)}
            ).loras
        except Exception as exc:
            raise RuntimeError(f"Invalid function LoRA payload: {exc}") from exc

        output_path = output_dir / "image_edit.png"
        _update_function_run(function_run_id, status=ImageEditStatus.running, stage="freeing_vram")
        stop_worker()
        _update_function_run(function_run_id, status=ImageEditStatus.running, stage="starting")

        def on_event(event: dict) -> None:
            _append_function_log(function_run_id, json.dumps(event))
            event_type = event.get("type")
            if event_type == "stage":
                _update_function_run(function_run_id, stage=event.get("stage"))
            elif event_type == "progress":
                _update_function_run(
                    function_run_id,
                    status=ImageEditStatus.running,
                    stage=event.get("stage"),
                    current_step=int(event.get("step", 0)),
                    total_steps=int(event.get("total", 0)),
                    rate_value=float(event["rate_value"]) if event.get("rate_value") is not None else None,
                    rate_unit=event.get("rate_unit"),
                )

        flux_client.image_edit(
            prompt=prompt,
            input_files=input_files,
            output_path=output_path,
            width=width,
            height=height,
            steps=steps,
            loras=[lora.model_dump() for lora in loras],
            on_event=on_event,
            cpu_offload=cpu_offload,
            sequential_cpu_offload=sequential_cpu_offload,
            vae_tiling=vae_tiling,
            vae_slicing=vae_slicing,
        )
        _update_function_run(
            function_run_id,
            status=ImageEditStatus.completed,
            stage="completed",
            image_url=f"/api/generate/function-images/{source_generation_id}/{function_run_id}/{output_path.name}",
            current_step=steps,
            total_steps=steps,
        )
    except Exception as exc:
        _update_function_run(
            function_run_id,
            status=ImageEditStatus.failed,
            stage="failed",
            error=str(exc),
        )
    finally:
        if temp_extra_path is not None and temp_extra_path.exists():
            temp_extra_path.unlink(missing_ok=True)


@router.post("/functions/image-edit", response_model=ImageEditResponse, status_code=202)
async def run_image_edit_function(
    source_generation_id: str = Form(...),
    prompt: str = Form(...),
    width: int = Form(...),
    height: int = Form(...),
    steps: int = Form(4),
    loras_json: str = Form("[]"),
    cpu_offload: bool = Form(False),
    sequential_cpu_offload: bool = Form(False),
    vae_tiling: bool = Form(False),
    vae_slicing: bool = Form(False),
    extra_image: UploadFile | None = File(default=None),
) -> ImageEditResponse:
    function_run_id = uuid.uuid4().hex
    _resolve_generation_image_path(source_generation_id)

    extra_image_bytes = await extra_image.read() if extra_image is not None else None
    extra_image_filename = extra_image.filename if extra_image is not None else None

    record = FunctionRunRecord(
        function_run_id=function_run_id,
        generation_id=source_generation_id,
        width=width,
        height=height,
        prompt=prompt,
        status=ImageEditStatus.pending,
        stage="queued",
        total_steps=steps,
    )
    with _function_runs_lock:
        _function_runs[function_run_id] = record

    thread = threading.Thread(
        target=_run_image_edit_job,
        kwargs={
            "function_run_id": function_run_id,
            "source_generation_id": source_generation_id,
            "prompt": prompt,
            "width": width,
            "height": height,
            "steps": steps,
            "loras_json": loras_json,
            "extra_image_bytes": extra_image_bytes,
            "extra_image_filename": extra_image_filename,
            "cpu_offload": cpu_offload,
            "sequential_cpu_offload": sequential_cpu_offload,
            "vae_tiling": vae_tiling,
            "vae_slicing": vae_slicing,
        },
        daemon=True,
    )
    thread.start()

    return _serialize_function_run(record)


@router.get("/functions/image-edit/{function_run_id}", response_model=ImageEditResponse)
def get_image_edit_function_run(function_run_id: str) -> ImageEditResponse:
    with _function_runs_lock:
        record = _function_runs.get(function_run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Function run not found.")
    return _serialize_function_run(record)


@router.get("/function-images/{generation_id}/{function_run_id}/{filename}")
def get_function_image(generation_id: str, function_run_id: str, filename: str) -> FileResponse:
    image_path = (FUNCTION_OUTPUTS_DIR / generation_id / function_run_id / filename).resolve()
    function_root = FUNCTION_OUTPUTS_DIR.resolve()
    if not image_path.is_relative_to(function_root):
        raise HTTPException(status_code=400, detail="Invalid function image path.")
    if not image_path.exists() or not image_path.is_file():
        raise HTTPException(status_code=404, detail="Function image not found.")
    return FileResponse(image_path)
