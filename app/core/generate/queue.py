from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import HTTPException

from app.models import GenerateImageRequest, GenerateImageResponse, GenerateQueueStatus, GenerationStatus


@dataclass
class GenerationRecord:
    generation_id: str
    payload: GenerateImageRequest
    output_dir: Path
    status: GenerationStatus = GenerationStatus.pending
    image_urls: list[str] = field(default_factory=list)
    batch_index: int = 0
    current_step: int = 0
    total_steps: int = 0
    rate_value: float | None = None
    rate_unit: str | None = None
    stage: str | None = None
    error: str | None = None
    log_lines: list[str] = field(default_factory=list)


_generation_lock = threading.Lock()
_generations: dict[str, GenerationRecord] = {}
_generation_queue: list[str] = []
_active_generation_id: str | None = None
_generation_condition = threading.Condition(_generation_lock)


def get_generation(generation_id: str) -> GenerateImageResponse:
    with _generation_lock:
        record = _generations.get(generation_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Generation not found.")
    return _serialize(record)


def get_queue_status() -> GenerateQueueStatus:
    with _generation_lock:
        return GenerateQueueStatus(
            active_generation_id=_active_generation_id,
            queued_count=len(_generation_queue),
            queued_generation_ids=list(_generation_queue),
        )


def remove_latest_queued_generation() -> GenerateImageResponse:
    with _generation_condition:
        if not _generation_queue:
            raise HTTPException(status_code=404, detail="No queued generations to remove.")
        generation_id = _generation_queue.pop()
        record = _generations[generation_id]
        record.status = GenerationStatus.failed
        record.stage = "cancelled"
        record.error = "Removed from queue."
        return _serialize(record)


def _serialize(record: GenerationRecord) -> GenerateImageResponse:
    payload = record.payload
    return GenerateImageResponse(
        generation_id=record.generation_id,
        status=record.status,
        image_urls=record.image_urls,
        architecture=payload.architecture,
        model_path=payload.model_path,
        positive_prompt=payload.positive_prompt,
        negative_prompt=payload.negative_prompt,
        steps=payload.steps,
        cfg_scale=payload.cfg_scale,
        width=payload.width,
        height=payload.height,
        seed=payload.seed,
        batch_count=payload.batch_count,
        batch_index=record.batch_index,
        sampler=payload.sampler,
        current_step=record.current_step,
        total_steps=record.total_steps or payload.steps,
        rate_value=record.rate_value,
        rate_unit=record.rate_unit,
        stage=record.stage,
        error=record.error,
    )


def _update_record(generation_id: str, **updates: object) -> None:
    with _generation_lock:
        record = _generations[generation_id]
        for key, value in updates.items():
            setattr(record, key, value)


def _append_log(generation_id: str, line: str) -> None:
    with _generation_lock:
        record = _generations[generation_id]
        record.log_lines.append(line)
