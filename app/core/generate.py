from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import httpx
from fastapi import HTTPException

from app.db import BASE_DIR
from app.models import GenerateImageRequest, GenerateImageResponse, GenerateWorkerStatus, GenerationStatus

logger = logging.getLogger(__name__)

GENERATIONS_DIR = BASE_DIR / "data" / "generations"
GENERATIONS_DIR.mkdir(parents=True, exist_ok=True)
WORKER_IDLE_TIMEOUT_SECONDS = 600
WORKER_IDLE_CHECK_INTERVAL_SECONDS = 30


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
    error: str | None = None
    log_lines: list[str] = field(default_factory=list)


class PersistentGenerateWorker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        self._signature: tuple[str, tuple[tuple[str, float], ...]] | None = None
        self._last_used_at = 0.0
        self._monitor_thread = threading.Thread(target=self._monitor_idle_timeout, daemon=True)
        self._monitor_thread.start()

    def _signature_for(self, payload: GenerateImageRequest) -> tuple[str, tuple[tuple[str, float], ...]]:
        model_path = str(Path(payload.model_path).expanduser().resolve())
        loras = tuple(
            sorted(
                (str(Path(lora.path).expanduser().resolve()), float(lora.strength))
                for lora in payload.loras
            )
        )
        return model_path, loras

    def status(self) -> GenerateWorkerStatus:
        with self._lock:
            process_alive = self._process is not None and self._process.poll() is None
            if not process_alive or self._signature is None:
                return GenerateWorkerStatus(
                    state="cold",
                    idle_timeout_seconds=WORKER_IDLE_TIMEOUT_SECONDS,
                    idle_seconds_remaining=None,
                )

            model_path, loras = self._signature
            idle_remaining = None
            if self._last_used_at > 0:
                idle_for = max(0.0, time.monotonic() - self._last_used_at)
                idle_remaining = max(0, int(WORKER_IDLE_TIMEOUT_SECONDS - idle_for))

            return GenerateWorkerStatus(
                state="warm",
                model_path=model_path,
                lora_count=len(loras),
                idle_timeout_seconds=WORKER_IDLE_TIMEOUT_SECONDS,
                idle_seconds_remaining=idle_remaining,
            )

    def _stop_locked(self) -> None:
        if self._process is None:
            return
        try:
            if self._process.stdin is not None:
                self._process.stdin.write(json.dumps({"type": "shutdown"}) + "\n")
                self._process.stdin.flush()
        except Exception:
            pass
        try:
            self._process.terminate()
            self._process.wait(timeout=5)
        except Exception:
            try:
                self._process.kill()
            except Exception:
                pass
        self._process = None
        self._signature = None
        self._last_used_at = 0.0

    def _start_locked(self, payload: GenerateImageRequest) -> None:
        command = [
            "uv",
            "run",
            "python",
            "sd_scripts/sdxl_persistent_worker.py",
            "--ckpt_path",
            str(Path(payload.model_path).expanduser()),
        ]
        if payload.loras:
            command.append("--lora_weights")
            command.extend(f"{Path(lora.path).expanduser()};{lora.strength}" for lora in payload.loras)

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["HF_HUB_OFFLINE"] = "1"
        env["TRANSFORMERS_OFFLINE"] = "1"
        process = subprocess.Popen(
            command,
            cwd=BASE_DIR,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )

        assert process.stdout is not None
        while True:
            line = process.stdout.readline()
            if not line:
                process.wait()
                raise RuntimeError("Persistent generate worker exited during startup.")
            stripped = line.strip()
            if not stripped:
                continue
            logger.info("generate-worker startup: %s", stripped)
            try:
                event = json.loads(stripped)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "ready":
                self._process = process
                self._signature = self._signature_for(payload)
                self._last_used_at = time.monotonic()
                return
            if event.get("type") == "startup_error":
                process.wait()
                raise RuntimeError(event.get("error", "Persistent generate worker failed during startup."))

    def _monitor_idle_timeout(self) -> None:
        while True:
            time.sleep(WORKER_IDLE_CHECK_INTERVAL_SECONDS)
            with self._lock:
                if self._process is None:
                    continue
                if self._process.poll() is not None:
                    logger.info("Persistent generate worker exited; clearing cached process state.")
                    self._stop_locked()
                    continue
                if self._last_used_at <= 0:
                    continue
                idle_for = time.monotonic() - self._last_used_at
                if idle_for < WORKER_IDLE_TIMEOUT_SECONDS:
                    continue
                logger.info(
                    "Stopping persistent generate worker after %.1f seconds of inactivity.",
                    idle_for,
                )
                self._stop_locked()

    def run(
        self,
        payload: GenerateImageRequest,
        output_dir: Path,
        on_log: Callable[[str], None],
        on_progress: Callable[[int, int, float | None, str | None, int], None],
    ) -> list[str]:
        with self._lock:
            signature = self._signature_for(payload)
            process_dead = self._process is None or self._process.poll() is not None
            if process_dead or self._signature != signature:
                self._stop_locked()
                self._start_locked(payload)

            assert self._process is not None
            assert self._process.stdin is not None
            assert self._process.stdout is not None
            self._last_used_at = time.monotonic()

            request = {
                "prompt": payload.positive_prompt,
                "negative_prompt": payload.negative_prompt,
                "output_dir": str(output_dir),
                "steps": payload.steps,
                "cfg_scale": payload.cfg_scale,
                "width": payload.width,
                "height": payload.height,
                "seed": payload.seed,
                "batch_count": payload.batch_count,
                "sampler": payload.sampler,
            }
            self._process.stdin.write(json.dumps(request) + "\n")
            self._process.stdin.flush()

            while True:
                line = self._process.stdout.readline()
                if not line:
                    self._stop_locked()
                    raise RuntimeError("Persistent generate worker exited unexpectedly.")
                stripped = line.strip()
                if not stripped:
                    continue

                on_log(stripped)
                try:
                    event = json.loads(stripped)
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type")
                if event_type == "progress":
                    on_progress(
                        int(event.get("step", 0)),
                        int(event.get("total", payload.steps)),
                        float(event["rate_value"]) if event.get("rate_value") is not None else None,
                        event.get("rate_unit"),
                        int(event.get("batch_index", 0)),
                    )
                elif event_type == "completed":
                    filenames = event.get("filenames") or []
                    if not filenames:
                        raise RuntimeError("Persistent generate worker completed without output filenames.")
                    self._last_used_at = time.monotonic()
                    return [str(f) for f in filenames]
                elif event_type == "error":
                    self._last_used_at = time.monotonic()
                    raise RuntimeError(event.get("error", "Persistent generate worker failed."))


_generation_lock = threading.Lock()
_generations: dict[str, GenerationRecord] = {}
_worker = PersistentGenerateWorker()


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
        if lora.strength < 0 or lora.strength > 1.0:
            raise HTTPException(status_code=422, detail="LoRA strength must be between 0.0 and 1.0.")


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
    with _generation_lock:
        _generations[generation_id] = record

    thread = threading.Thread(target=_run_generation, args=(generation_id,), daemon=True)
    thread.start()
    return _serialize(record)


def get_generation(generation_id: str) -> GenerateImageResponse:
    with _generation_lock:
        record = _generations.get(generation_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Generation not found.")
    return _serialize(record)


def get_worker_status() -> GenerateWorkerStatus:
    return _worker.status()


def stop_worker() -> None:
    with _worker._lock:
        _worker._stop_locked()


def _serialize(record: GenerationRecord) -> GenerateImageResponse:
    payload = record.payload
    return GenerateImageResponse(
        generation_id=record.generation_id,
        status=record.status,
        image_urls=record.image_urls,
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

    try:
        filenames = _worker.run(
            payload,
            output_dir,
            on_log=lambda line: _append_log(generation_id, line),
            on_progress=lambda step, total, rate_value, rate_unit, batch_index: _update_record(
                generation_id,
                current_step=step,
                total_steps=total,
                rate_value=rate_value,
                rate_unit=rate_unit,
                batch_index=batch_index,
            ),
        )
    except Exception as exc:
        logger.exception("Generation failed for %s", generation_id)
        _update_record(generation_id, status=GenerationStatus.failed, error=str(exc))
        return

    image_urls = []
    for filename in filenames:
        image_path = output_dir / filename
        if image_path.exists():
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
