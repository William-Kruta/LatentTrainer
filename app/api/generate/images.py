from __future__ import annotations

import io
import json
from datetime import timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import desc
from sqlmodel import Session, select

from app.api.image_edit import IMAGE_EDIT_METADATA_KEY
from app.core.generate import (
    GENERATIONS_DIR,
    GENERATE_METADATA_KEY,
    get_generation,
    get_queue_status,
    get_worker_status,
    remove_latest_queued_generation,
    start_generation,
    stop_worker,
    warmup_worker,
)
from app.db import get_session
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
    GenerateQueueStatus,
    GenerateWorkerStatus,
    WarmupRequest,
    utcnow,
)

router = APIRouter(prefix="/api/generate", tags=["generate"])


@router.post("", response_model=GenerateImageResponse, status_code=202)
def generate_image_route(payload: GenerateImageRequest) -> GenerateImageResponse:
    return start_generation(payload)


@router.get("/worker", response_model=GenerateWorkerStatus)
def get_generate_worker_status_route() -> GenerateWorkerStatus:
    return get_worker_status()


@router.post("/worker/unload", status_code=204)
def unload_generate_workers_route() -> None:
    stop_worker()


@router.post("/worker/warmup", status_code=202)
def warmup_generate_worker_route(body: WarmupRequest) -> dict:
    warmup_worker(body)
    return {"status": "warming"}


@router.get("/queue", response_model=GenerateQueueStatus)
def get_generate_queue_status_route() -> GenerateQueueStatus:
    return get_queue_status()


@router.delete("/queue/latest", response_model=GenerateImageResponse)
def remove_latest_queued_generation_route() -> GenerateImageResponse:
    return remove_latest_queued_generation()


@router.post("/import-metadata")
async def import_generate_metadata_route(file: UploadFile = File(...)) -> dict:
    try:
        raw = await file.read()
        with Image.open(io.BytesIO(raw)) as image:
            t2i_value = image.info.get(GENERATE_METADATA_KEY)
            ie_value = image.info.get(IMAGE_EDIT_METADATA_KEY)
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=422, detail="Uploaded file is not a supported image.") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Failed to read image metadata: {exc}") from exc

    if ie_value:
        try:
            return {"mode": "image-edit", "image_edit": json.loads(ie_value), "text2image": None}
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid embedded metadata: {exc}") from exc

    if t2i_value:
        try:
            payload = json.loads(t2i_value)
            validated = GenerateImageRequest.model_validate(payload)
            return {"mode": "text2image", "text2image": validated.model_dump(mode="json"), "image_edit": None}
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid embedded metadata: {exc}") from exc

    raise HTTPException(status_code=404, detail="No metadata found.")


@router.get("/configs", response_model=list[GenerateConfigSummary])
def list_generate_configs(session: Session = Depends(get_session)) -> list[GenerateConfigSummary]:
    configs = session.exec(
        select(GenerateConfig).order_by(desc(GenerateConfig.pinned), GenerateConfig.name)
    ).all()
    return [
        GenerateConfigSummary(
            id=config.id,
            name=config.name,
            updated_at=config.updated_at.astimezone(timezone.utc),
            pinned=config.pinned,
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


@router.post("/configs/import", response_model=GenerateConfigRead, status_code=201)
def import_generate_config(
    payload: GenerateConfigCreate,
    session: Session = Depends(get_session),
) -> GenerateConfigRead:
    now = utcnow()
    config = GenerateConfig(
        **payload.model_dump(mode="json"),
        created_at=now,
        updated_at=now,
    )
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


@router.post("/configs/{config_id}/pin", status_code=204)
def pin_generate_config(
    config_id: int,
    body: dict,
    session: Session = Depends(get_session),
) -> None:
    config = session.get(GenerateConfig, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Generate config not found.")
    config.pinned = bool(body.get("pinned", not config.pinned))
    session.add(config)
    session.commit()


@router.delete("/configs/{config_id}", status_code=204)
def delete_generate_config(config_id: int, session: Session = Depends(get_session)) -> None:
    config = session.get(GenerateConfig, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Generate config not found.")
    session.delete(config)
    session.commit()


@router.post("/configs/{config_id}/duplicate", response_model=GenerateConfigRead, status_code=201)
def duplicate_generate_config(config_id: int, session: Session = Depends(get_session)) -> GenerateConfigRead:
    config = session.get(GenerateConfig, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Generate config not found.")

    now = utcnow()
    clone = GenerateConfig(
        **config.model_dump(exclude={"id", "created_at", "updated_at"}),
        name=f"{config.name} Copy",
        created_at=now,
        updated_at=now,
    )
    session.add(clone)
    session.commit()
    session.refresh(clone)
    return GenerateConfigRead(
        **clone.model_dump(exclude={"loras", "prompt_enhance_settings", "created_at", "updated_at"}),
        prompt_enhance_settings=clone.prompt_enhance_settings,
        loras=clone.loras,
        created_at=clone.created_at.astimezone(timezone.utc),
        updated_at=clone.updated_at.astimezone(timezone.utc),
    )


@router.get("/{generation_id}", response_model=GenerateImageResponse)
def get_generation_route(generation_id: str) -> GenerateImageResponse:
    return get_generation(generation_id)


@router.get("/images/{generation_id}/{filename}")
def get_generated_image(generation_id: str, filename: str) -> FileResponse:
    image_path = GENERATIONS_DIR / generation_id / filename
    if not image_path.exists() or not image_path.is_file():
        raise HTTPException(status_code=404, detail="Generated image not found.")
    return FileResponse(Path(image_path))
