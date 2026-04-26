from __future__ import annotations

import json
import logging
import threading
import uuid
from pathlib import Path

import httpx
from fastapi import HTTPException
from PIL import Image, PngImagePlugin

from app.core.generate import queue as generation_queue
from app.core.generate.queue import (
    GenerationRecord,
    _append_log,
    _generation_condition,
    _generation_lock,
    _generation_queue,
    _generations,
    _serialize,
    _update_record,
)
from app.core.generate.worker import PersistentGenerateWorker
from app.db import BASE_DIR
from app.models import GenerateImageRequest, GenerateImageResponse, GenerateWorkerStatus, GenerationStatus, WarmupRequest
from inference.chroma.client import PersistentChromaWorker

logger = logging.getLogger(__name__)
GENERATE_METADATA_KEY = "latenttrainer_generate_config"

GENERATIONS_DIR = BASE_DIR / "data" / "generations"
GENERATIONS_DIR.mkdir(parents=True, exist_ok=True)

_worker = PersistentGenerateWorker()
_chroma_worker = PersistentChromaWorker()


def _round_to_multiple(value: int, multiple: int = 64) -> int:
    return max(multiple, round(value / multiple) * multiple)


def _normalized_payload(payload: GenerateImageRequest) -> GenerateImageRequest:
    normalized = payload.model_copy(deep=True)
    normalized.width = _round_to_multiple(payload.width, 64)
    normalized.height = _round_to_multiple(payload.height, 64)
    return normalized


def _validate_generation_request(payload: GenerateImageRequest) -> None:
    model_path = Path(payload.model_path).expanduser()
    if not model_path.exists():
        raise HTTPException(status_code=422, detail="Model path does not exist.")
    if payload.steps <= 0:
        raise HTTPException(status_code=422, detail="Steps must be greater than 0.")
    for lora in payload.loras:
        lora_path = Path(lora.path).expanduser()
        if not lora_path.exists():
            raise HTTPException(status_code=422, detail=f"LoRA path does not exist: {lora.path}")
        if lora.strength < 0 or lora.strength > 2.0:
            raise HTTPException(status_code=422, detail="LoRA strength must be between 0.0 and 2.0.")


def _attach_generation_metadata(image_path: Path, payload: GenerateImageRequest) -> None:
    if image_path.suffix.lower() != ".png" or not image_path.exists():
        return

    metadata = PngImagePlugin.PngInfo()
    metadata.add_text(GENERATE_METADATA_KEY, json.dumps(payload.model_dump(mode="json")))

    with Image.open(image_path) as image:
        image.save(image_path, format="PNG", pnginfo=metadata)


def _enhance_prompt(payload: GenerateImageRequest) -> GenerateImageRequest:
    if not payload.prompt_enhance:
        return payload

    settings = payload.prompt_enhance_settings
    llama_url = settings.llama_url.rstrip("/")
    system_prompt = settings.system_prompt.strip() or (
        "Enhance the user's SDXL image prompt. Return only the improved prompt, with no explanation."
    )
    body: dict = {
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": payload.positive_prompt},
        ],
        "max_tokens": settings.max_tokens,
    }
    if settings.model:
        body["model"] = settings.model

    try:
        with httpx.Client(timeout=120.0) as client:
            response = client.post(f"{llama_url}/v1/chat/completions", json=body)
        if not response.is_success:
            detail = response.text[:300]
            raise HTTPException(status_code=502, detail=f"Prompt enhance failed: HTTP {response.status_code}: {detail}")
        enhanced_prompt = response.json()["choices"][0]["message"]["content"].strip()
        updated = payload.model_copy(deep=True)
        updated.positive_prompt = enhanced_prompt
        return updated
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Prompt enhance failed: {exc}") from exc


def warmup_worker(req: WarmupRequest) -> None:
    model_path = Path(req.model_path).expanduser()
    if not model_path.exists():
        raise HTTPException(status_code=422, detail="Model path does not exist.")
    for lora in req.loras:
        lora_path = Path(lora.path).expanduser()
        if not lora_path.exists():
            raise HTTPException(status_code=422, detail=f"LoRA path does not exist: {lora.path}")

    dummy = GenerateImageRequest(
        architecture=req.architecture,
        model_path=req.model_path,
        chroma_pipeline_repo=req.chroma_pipeline_repo,
        loras=req.loras,
        positive_prompt="warmup",
        steps=1,
    )

    def _warmup_thread() -> None:
        if dummy.architecture == "chroma":
            with _worker._lock:
                _worker._stop_locked()
            with _chroma_worker._lock:
                sig = _chroma_worker._signature_for(dummy)
                process_dead = _chroma_worker._process is None or _chroma_worker._process.poll() is not None
                if process_dead or _chroma_worker._signature != sig:
                    _chroma_worker._stop_locked()
                    try:
                        _chroma_worker._start_locked(dummy)
                    except Exception:
                        logger.exception("Warmup failed for chroma worker")
        else:
            with _chroma_worker._lock:
                _chroma_worker._stop_locked()
            with _worker._lock:
                sig = _worker._signature_for(dummy)
                process_dead = _worker._process is None or _worker._process.poll() is not None
                if process_dead or _worker._signature != sig:
                    _worker._stop_locked()
                    try:
                        _worker._start_locked(dummy)
                    except Exception:
                        logger.exception("Warmup failed for sdxl worker")

    threading.Thread(target=_warmup_thread, daemon=True).start()


def start_generation(payload: GenerateImageRequest) -> GenerateImageResponse:
    payload = _normalized_payload(payload)
    _validate_generation_request(payload)

    generation_id = uuid.uuid4().hex
    output_dir = GENERATIONS_DIR / generation_id
    output_dir.mkdir(parents=True, exist_ok=True)

    record = GenerationRecord(
        generation_id=generation_id,
        payload=payload,
        output_dir=output_dir,
        status=GenerationStatus.pending,
        total_steps=payload.steps,
    )
    with _generation_condition:
        _generations[generation_id] = record
        _generation_queue.append(generation_id)
        _generation_condition.notify()
    return _serialize(record)


def get_worker_status() -> GenerateWorkerStatus:
    sdxl = _worker.status()
    chroma = _chroma_worker.status()
    return GenerateWorkerStatus(
        state=sdxl.state,
        model_path=sdxl.model_path,
        lora_count=sdxl.lora_count,
        idle_timeout_seconds=sdxl.idle_timeout_seconds,
        idle_seconds_remaining=sdxl.idle_seconds_remaining,
        **chroma,
    )


def stop_worker() -> None:
    with _worker._lock:
        _worker._stop_locked()
    with _chroma_worker._lock:
        _chroma_worker._stop_locked()


def _run_generation(generation_id: str) -> None:
    with _generation_lock:
        record = _generations[generation_id]
        payload = record.payload
        output_dir = record.output_dir

    try:
        payload = _enhance_prompt(payload)
        with _generation_lock:
            _generations[generation_id].payload = payload
    except HTTPException as exc:
        _update_record(generation_id, status=GenerationStatus.failed, error=str(exc.detail))
        return

    _update_record(generation_id, status=GenerationStatus.running)

    on_progress = lambda step, total, rate_value, rate_unit, batch_index: _update_record(
        generation_id,
        current_step=step,
        total_steps=total,
        rate_value=rate_value,
        rate_unit=rate_unit,
        batch_index=batch_index,
    )
    on_log = lambda line: _append_log(generation_id, line)
    on_stage = lambda stage: _update_record(generation_id, stage=stage)

    try:
        if payload.architecture == "chroma":
            with _worker._lock:
                _worker._stop_locked()
            filenames = _chroma_worker.run(payload, output_dir, on_log=on_log, on_progress=on_progress, on_stage=on_stage)
        else:
            with _chroma_worker._lock:
                _chroma_worker._stop_locked()
            filenames = _worker.run(payload, output_dir, on_log=on_log, on_progress=on_progress, on_stage=on_stage)
    except Exception as exc:
        logger.exception("Generation failed for %s", generation_id)
        _update_record(generation_id, status=GenerationStatus.failed, error=str(exc))
        return

    image_urls = []
    for filename in filenames:
        image_path = output_dir / filename
        if image_path.exists():
            try:
                _attach_generation_metadata(image_path, payload)
            except Exception:
                logger.exception("Failed to attach metadata to %s", image_path)
            image_urls.append(f"/api/generate/images/{generation_id}/{filename}")

    if not image_urls:
        _update_record(
            generation_id,
            status=GenerationStatus.failed,
            error="Generation completed but no images were produced.",
        )
        return

    _update_record(
        generation_id,
        status=GenerationStatus.completed,
        image_urls=image_urls,
        current_step=payload.steps,
        total_steps=payload.steps,
    )


def _generation_queue_worker() -> None:
    while True:
        with _generation_condition:
            while not _generation_queue:
                _generation_condition.wait()
            generation_id = _generation_queue.pop(0)
            generation_queue._active_generation_id = generation_id

        try:
            _run_generation(generation_id)
        finally:
            with _generation_condition:
                if generation_queue._active_generation_id == generation_id:
                    generation_queue._active_generation_id = None
                _generation_condition.notify_all()


_generation_worker_thread = threading.Thread(target=_generation_queue_worker, daemon=True)
_generation_worker_thread.start()
