from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass, field
from datetime import timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from app.core.generate import GENERATIONS_DIR, get_generation, get_worker_status, start_generation, stop_worker
from app.db import get_session
from fk9_scripts.flux2_client import Flux2WorkerClient
from app.models import (
    GenerateConfig,
    GenerateConfigCreate,
    GenerateConfigRead,
    GenerateConfigSummary,
    GenerateFunctionConfig,
    GenerateFunctionConfigCreate,
    GenerateFunctionConfigRead,
    GenerateFunctionConfigSummary,
    GenerateImageRequest,
    GenerateImageResponse,
    GenerateWorkerStatus,
    ImageEditStatus,
    ImageEditResponse,
    utcnow,
)

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


@router.post("", response_model=GenerateImageResponse, status_code=202)
def generate_image_route(payload: GenerateImageRequest) -> GenerateImageResponse:
    return start_generation(payload)


@router.get("/worker", response_model=GenerateWorkerStatus)
def get_generate_worker_status_route() -> GenerateWorkerStatus:
    return get_worker_status()


@router.get("/configs", response_model=list[GenerateConfigSummary])
def list_generate_configs(session: Session = Depends(get_session)) -> list[GenerateConfigSummary]:
    configs = session.exec(select(GenerateConfig).order_by(GenerateConfig.name)).all()
    return [
        GenerateConfigSummary(
            id=config.id,
            name=config.name,
            updated_at=config.updated_at.astimezone(timezone.utc),
        )
        for config in configs
    ]


@router.get("/function-configs", response_model=list[GenerateFunctionConfigSummary])
def list_generate_function_configs(session: Session = Depends(get_session)) -> list[GenerateFunctionConfigSummary]:
    configs = session.exec(select(GenerateFunctionConfig).order_by(GenerateFunctionConfig.name)).all()
    return [
        GenerateFunctionConfigSummary(
            id=config.id,
            name=config.name,
            function_type=config.function_type,
            updated_at=config.updated_at.astimezone(timezone.utc),
        )
        for config in configs
    ]


@router.post("/function-configs", response_model=GenerateFunctionConfigRead)
def save_generate_function_config(
    payload: GenerateFunctionConfigCreate,
    session: Session = Depends(get_session),
) -> GenerateFunctionConfigRead:
    config = session.exec(select(GenerateFunctionConfig).where(GenerateFunctionConfig.name == payload.name)).first()
    now = utcnow()
    if config is None:
        config = GenerateFunctionConfig(
            **payload.model_dump(mode="json"),
            created_at=now,
            updated_at=now,
        )
    else:
        for field, value in payload.model_dump(mode="json").items():
            setattr(config, field, value)
        config.updated_at = now

    session.add(config)
    session.commit()
    session.refresh(config)
    return GenerateFunctionConfigRead(
        **config.model_dump(exclude={"loras", "created_at", "updated_at"}),
        loras=config.loras,
        created_at=config.created_at.astimezone(timezone.utc),
        updated_at=config.updated_at.astimezone(timezone.utc),
    )


@router.get("/function-configs/{config_id}", response_model=GenerateFunctionConfigRead)
def get_generate_function_config(config_id: int, session: Session = Depends(get_session)) -> GenerateFunctionConfigRead:
    config = session.get(GenerateFunctionConfig, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Generate function config not found.")
    return GenerateFunctionConfigRead(
        **config.model_dump(exclude={"loras", "created_at", "updated_at"}),
        loras=config.loras,
        created_at=config.created_at.astimezone(timezone.utc),
        updated_at=config.updated_at.astimezone(timezone.utc),
    )


@router.post("/configs", response_model=GenerateConfigRead)
def save_generate_config(
    payload: GenerateConfigCreate,
    session: Session = Depends(get_session),
) -> GenerateConfigRead:
    config = session.exec(select(GenerateConfig).where(GenerateConfig.name == payload.name)).first()
    now = utcnow()
    if config is None:
        config = GenerateConfig(
            **payload.model_dump(mode="json"),
            created_at=now,
            updated_at=now,
        )
    else:
        for field, value in payload.model_dump(mode="json").items():
            setattr(config, field, value)
        config.updated_at = now

    session.add(config)
    session.commit()
    session.refresh(config)
    return GenerateConfigRead(
        **config.model_dump(exclude={"loras", "prompt_enhance_settings", "created_at", "updated_at"}),
        prompt_enhance_settings=config.prompt_enhance_settings,
        loras=config.loras,
        created_at=config.created_at.astimezone(timezone.utc),
        updated_at=config.updated_at.astimezone(timezone.utc),
    )


@router.get("/configs/{config_id}", response_model=GenerateConfigRead)
def get_generate_config(config_id: int, session: Session = Depends(get_session)) -> GenerateConfigRead:
    config = session.get(GenerateConfig, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Generate config not found.")
    return GenerateConfigRead(
        **config.model_dump(exclude={"loras", "prompt_enhance_settings", "created_at", "updated_at"}),
        prompt_enhance_settings=config.prompt_enhance_settings,
        loras=config.loras,
        created_at=config.created_at.astimezone(timezone.utc),
        updated_at=config.updated_at.astimezone(timezone.utc),
    )


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


@router.get("/{generation_id}", response_model=GenerateImageResponse)
def get_generation_route(generation_id: str) -> GenerateImageResponse:
    return get_generation(generation_id)


@router.get("/images/{generation_id}/{filename}")
def get_generated_image(generation_id: str, filename: str) -> FileResponse:
    image_path = GENERATIONS_DIR / generation_id / filename
    if not image_path.exists() or not image_path.is_file():
        raise HTTPException(status_code=404, detail="Generated image not found.")
    return FileResponse(Path(image_path))
