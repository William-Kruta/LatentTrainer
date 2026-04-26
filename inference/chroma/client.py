from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable

from app.db import BASE_DIR
from app.models.generation import GenerateImageRequest

logger = logging.getLogger(__name__)

WORKER_IDLE_TIMEOUT_SECONDS = 600
WORKER_IDLE_CHECK_INTERVAL_SECONDS = 30
VENV_FLUX_PYTHON = BASE_DIR / ".venv-flux" / "bin" / "python"


class PersistentChromaWorker:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        self._signature: tuple[str, str] | None = None  # (ckpt_path, pipeline_repo)
        self._last_used_at = 0.0
        self._monitor_thread = threading.Thread(target=self._monitor_idle_timeout, daemon=True)
        self._monitor_thread.start()

    def _signature_for(self, payload: GenerateImageRequest) -> tuple:
        ckpt_path = str(Path(payload.model_path).expanduser().resolve())
        loras_key = tuple(
            (str(Path(l.path).expanduser().resolve()), l.strength)
            for l in payload.loras
        )
        return ckpt_path, payload.chroma_pipeline_repo, loras_key

    def status(self) -> dict:
        with self._lock:
            process_alive = self._process is not None and self._process.poll() is None
            if not process_alive or self._signature is None:
                return {"chroma_state": "cold", "chroma_model_path": None, "chroma_idle_seconds_remaining": None}
            ckpt_path, _ = self._signature
            idle_remaining = None
            if self._last_used_at > 0:
                idle_for = max(0.0, time.monotonic() - self._last_used_at)
                idle_remaining = max(0, int(WORKER_IDLE_TIMEOUT_SECONDS - idle_for))
            return {
                "chroma_state": "warm",
                "chroma_model_path": ckpt_path,
                "chroma_idle_seconds_remaining": idle_remaining,
            }

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
            str(VENV_FLUX_PYTHON),
            str(BASE_DIR / "inference" / "chroma" / "chroma_worker.py"),
            "--ckpt_path",
            str(Path(payload.model_path).expanduser()),
        ]
        if payload.chroma_pipeline_repo:
            command += ["--pipeline_repo", payload.chroma_pipeline_repo]
        if payload.loras:
            loras_json = json.dumps([
                {"path": str(Path(l.path).expanduser()), "strength": l.strength}
                for l in payload.loras
            ])
            command += ["--loras", loras_json]

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
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
                raise RuntimeError("Chroma worker exited during startup.")
            stripped = line.strip()
            if not stripped:
                continue
            logger.info("chroma-worker startup: %s", stripped)
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
                raise RuntimeError(event.get("error", "Chroma worker failed during startup."))

    def _monitor_idle_timeout(self) -> None:
        while True:
            time.sleep(WORKER_IDLE_CHECK_INTERVAL_SECONDS)
            with self._lock:
                if self._process is None:
                    continue
                if self._process.poll() is not None:
                    logger.info("Chroma worker exited; clearing cached process state.")
                    self._stop_locked()
                    continue
                if self._last_used_at <= 0:
                    continue
                idle_for = time.monotonic() - self._last_used_at
                if idle_for < WORKER_IDLE_TIMEOUT_SECONDS:
                    continue
                logger.info("Stopping Chroma worker after %.1f seconds of inactivity.", idle_for)
                self._stop_locked()

    def run(
        self,
        payload: GenerateImageRequest,
        output_dir: Path,
        on_log: Callable[[str], None],
        on_progress: Callable[[int, int, float | None, str | None, int], None],
        on_stage: Callable[[str], None] | None = None,
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
            }
            self._process.stdin.write(json.dumps(request) + "\n")
            self._process.stdin.flush()

            while True:
                line = self._process.stdout.readline()
                if not line:
                    self._stop_locked()
                    raise RuntimeError("Chroma worker exited unexpectedly.")
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
                elif event_type == "stage":
                    if on_stage:
                        on_stage(str(event.get("stage", "")))
                elif event_type == "completed":
                    filenames = event.get("filenames") or []
                    if not filenames:
                        raise RuntimeError("Chroma worker completed without output filenames.")
                    self._last_used_at = time.monotonic()
                    return [str(f) for f in filenames]
                elif event_type == "error":
                    self._last_used_at = time.monotonic()
                    raise RuntimeError(event.get("error", "Chroma worker failed."))
