from __future__ import annotations

import asyncio
import re
import sys
from collections.abc import AsyncIterator
from pathlib import Path

from sqlmodel import Session

from app.models import Config, Dataset, Job, JobStatus

LOG_SENTINEL_DONE = "[TRAINING:DONE]"
LOG_SENTINEL_FAIL = "[TRAINING:FAILED]"
_SENTINELS = {LOG_SENTINEL_DONE, LOG_SENTINEL_FAIL}

# Live subprocess registry so the cancel endpoint can signal it.
_running_procs: dict[int, asyncio.subprocess.Process] = {}
# Job IDs that were explicitly stopped by the user (vs crashed).
_cancelled_jobs: set[int] = set()


class TrainerConflictError(RuntimeError):
    pass


def ensure_single_running_job(session: Session) -> None:
    from sqlmodel import select
    running = session.exec(select(Job).where(Job.status == JobStatus.running)).first()
    if running is not None:
        raise TrainerConflictError("A training job is already running.")


# ── Checkpoint discovery ──────────────────────────────────────────────────────

def find_latest_state_dir(output_dir: Path, job_name: str) -> tuple[Path | None, int]:
    """Return (state_dir, step) for the most recent kohya-ss saved state.

    kohya-ss names step states: {name}-step{step:08d}-state
    """
    if not output_dir.exists():
        return None, 0

    pattern = re.compile(rf"^{re.escape(job_name)}-step(\d+)-state$")
    max_step = 0
    latest: Path | None = None

    for entry in output_dir.iterdir():
        if entry.is_dir():
            m = pattern.match(entry.name)
            if m:
                step = int(m.group(1))
                if step > max_step:
                    max_step = step
                    latest = entry

    if latest is not None:
        return latest, max_step

    # Fall back to the end-of-training state dir.
    fallback = output_dir / f"{job_name}-state"
    if fallback.exists():
        return fallback, 0

    return None, 0


# ── Dataset / prompt helpers ──────────────────────────────────────────────────

def _write_dataset_toml(path: Path, dataset_path: str, resolution: int, batch_size: int) -> None:
    path.write_text(
        f"""[general]
shuffle_caption = true
caption_extension = ".txt"

[[datasets]]
resolution = {resolution}
batch_size = {batch_size}
enable_bucket = true

  [[datasets.subsets]]
  image_dir = "{dataset_path}"
  num_repeats = 1
""",
        encoding="utf-8",
    )


def _write_sample_prompts(path: Path, prompts: list[dict]) -> None:
    lines = []
    for p in prompts:
        text = p.get("prompt", "").replace("\n", " ").strip()
        if text:
            w, h = p.get("width", 1024), p.get("height", 1024)
            seed, cfg = p.get("seed", 42), p.get("lora_scale", 1.0)
            lines.append(f"{text} --w {w} --h {h} --d {seed} --l {cfg} --s 20")
    if lines:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ── Subprocess launcher ───────────────────────────────────────────────────────

async def run_training(
    job: Job,
    config: Config,
    dataset: Dataset,
    resume_from: str | None = None,
) -> None:
    from app.db import BASE_DIR, engine

    log_path = Path(job.log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    sd_scripts = BASE_DIR / "sd_scripts"
    train_script = sd_scripts / "sdxl_train_network.py"

    if not train_script.exists():
        _append(log_path, f"ERROR: training script not found at {train_script}")
        _finish(log_path, engine, job.id, JobStatus.failed)
        return

    if not config.model_path:
        _append(log_path, "ERROR: model_path is not set in the config.")
        _finish(log_path, engine, job.id, JobStatus.failed)
        return

    output_dir = Path(job.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    data_dir = log_path.parent
    dataset_toml = data_dir / f"job-{job.id}-dataset.toml"
    _write_dataset_toml(dataset_toml, dataset.path, config.resolution, config.batch_size)

    cmd = [
        sys.executable,
        str(train_script),
        "--pretrained_model_name_or_path", config.model_path,
        "--dataset_config", str(dataset_toml),
        "--output_dir", str(output_dir),
        "--output_name", job.name,
        "--network_module", "networks.lora",
        "--network_dim", str(config.network_dim),
        "--network_alpha", str(config.network_alpha),
        "--max_train_steps", str(config.max_steps),
        "--learning_rate", str(config.learning_rate),
        "--optimizer_type", config.optimizer,
        "--lr_scheduler", config.lr_scheduler,
        "--lr_warmup_steps", str(config.warmup_steps),
        "--mixed_precision", config.mixed_precision,
        "--save_every_n_steps", str(config.save_every_n_steps),
        "--save_model_as", config.save_format,
        "--save_state",
        "--sdpa",
        "--gradient_checkpointing",
    ]

    if config.cache_latents_to_disk:
        cmd.append("--cache_latents_to_disk")
    elif config.cache_latents:
        cmd.append("--cache_latents")

    if config.cache_text_encoder_outputs_to_disk:
        cmd.append("--cache_text_encoder_outputs_to_disk")
    elif config.cache_text_encoder_outputs:
        cmd.append("--cache_text_encoder_outputs")

    if resume_from:
        cmd += ["--resume", resume_from]
        _append(log_path, f"Resuming from: {resume_from}")

    if config.sample_prompts and not config.disable_sampling:
        sample_file = data_dir / f"job-{job.id}-prompts.txt"
        _write_sample_prompts(sample_file, config.sample_prompts)
        cmd += [
            "--sample_prompts", str(sample_file),
            "--sample_every_n_steps", str(config.sample_every_n_steps),
            "--sample_sampler", "euler_a",
        ]

    _append(log_path, f"Starting: {' '.join(cmd[:3])} ...")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(sd_scripts),
        )

        _running_procs[job.id] = proc
        assert proc.stdout is not None

        async for raw in proc.stdout:
            decoded = raw.decode("utf-8", errors="replace")
            for segment in decoded.replace("\r", "\n").splitlines():
                segment = segment.strip()
                if segment:
                    _append(log_path, segment)

        await proc.wait()
        _running_procs.pop(job.id, None)

        if job.id in _cancelled_jobs:
            _cancelled_jobs.discard(job.id)
            _finish(log_path, engine, job.id, JobStatus.stopped)
        elif proc.returncode == 0:
            _finish(log_path, engine, job.id, JobStatus.completed)
        else:
            _finish(log_path, engine, job.id, JobStatus.failed)

    except Exception as exc:
        _running_procs.pop(job.id, None)
        _cancelled_jobs.discard(job.id)
        _append(log_path, f"ERROR: {exc}")
        _finish(log_path, engine, job.id, JobStatus.failed)


# ── Cancel ────────────────────────────────────────────────────────────────────

async def cancel_job(job_id: int) -> bool:
    proc = _running_procs.get(job_id)
    if proc is None:
        return False
    _cancelled_jobs.add(job_id)
    try:
        proc.terminate()
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        proc.kill()
    return True


# ── Helpers ───────────────────────────────────────────────────────────────────

def _append(path: Path, line: str) -> None:
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def _finish(path: Path, engine, job_id: int | None, status: JobStatus) -> None:
    sentinel = LOG_SENTINEL_DONE if status == JobStatus.completed else LOG_SENTINEL_FAIL
    _append(path, sentinel)
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if job:
            job.status = status
            session.add(job)
            session.commit()


# ── Log streaming ─────────────────────────────────────────────────────────────

async def stream_log(log_path: str) -> AsyncIterator[dict[str, str]]:
    path = Path(log_path)

    for _ in range(20):
        if path.exists():
            break
        await asyncio.sleep(0.5)

    offset = 0
    idle_ticks = 0
    MAX_IDLE = 60  # 30 s

    while True:
        if path.exists():
            text = path.read_text(encoding="utf-8", errors="replace")
            if len(text) > offset:
                new = text[offset:]
                offset = len(text)
                idle_ticks = 0
                for line in new.splitlines():
                    if line in _SENTINELS:
                        return
                    if line:
                        yield {"event": "message", "data": line}
            else:
                idle_ticks += 1
                if idle_ticks >= MAX_IDLE:
                    return
        await asyncio.sleep(0.5)
