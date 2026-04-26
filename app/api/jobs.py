from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlmodel import Session, select
from sse_starlette.sse import EventSourceResponse

from app.core.trainer import (
    TrainerConflictError,
    cancel_job,
    ensure_single_running_job,
    find_latest_state_dir,
    run_training,
    stream_log,
)
from app.db import BASE_DIR, get_session
from app.models import Config, Dataset, Job, JobCreate, JobRead, JobStatus

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("", response_model=list[JobRead])
def list_jobs(session: Session = Depends(get_session)) -> list[Job]:
    return session.exec(select(Job).order_by(Job.started_at.desc())).all()


@router.post("", response_model=JobRead, status_code=201)
async def create_job(
    payload: JobCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
) -> Job:
    try:
        ensure_single_running_job(session)
    except TrainerConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    config = session.get(Config, payload.config_id)
    if config is None:
        raise HTTPException(status_code=400, detail="Config not found.")
    dataset = session.get(Dataset, payload.dataset_id)
    if dataset is None:
        raise HTTPException(status_code=400, detail="Dataset not found.")

    existing_jobs = session.exec(select(Job)).all()
    next_job_id = max((job.id or 0 for job in existing_jobs), default=0) + 1
    log_path = BASE_DIR / "data" / "logs" / f"job-{next_job_id}.log"

    job = Job(
        **payload.model_dump(),
        status=JobStatus.running,
        log_path=str(log_path),
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    # Detach objects from the session so they can be used in the background task.
    from sqlmodel import Session as _Session
    job_snapshot = Job(**{k: getattr(job, k) for k in Job.model_fields if hasattr(job, k)})
    config_snapshot = Config(**{k: getattr(config, k) for k in Config.model_fields if hasattr(config, k)})
    dataset_snapshot = Dataset(**{k: getattr(dataset, k) for k in Dataset.model_fields if hasattr(dataset, k)})

    background_tasks.add_task(run_training, job_snapshot, config_snapshot, dataset_snapshot)
    return job


@router.get("/{job_id}", response_model=JobRead)
def get_job(job_id: int, session: Session = Depends(get_session)) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: int, session: Session = Depends(get_session)) -> None:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.log_path:
        log_file = Path(job.log_path)
        if log_file.exists():
            log_file.unlink()
    session.delete(job)
    session.commit()


@router.post("/{job_id}/cancel", status_code=204)
async def cancel_job_route(job_id: int, session: Session = Depends(get_session)) -> None:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status != JobStatus.running:
        raise HTTPException(status_code=409, detail="Job is not running.")
    await cancel_job(job_id)


@router.post("/{job_id}/resume", status_code=204)
async def resume_job_route(
    job_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
) -> None:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status != JobStatus.stopped:
        raise HTTPException(status_code=409, detail="Job is not stopped.")

    try:
        ensure_single_running_job(session)
    except TrainerConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    config = session.get(Config, job.config_id)
    if config is None:
        raise HTTPException(status_code=400, detail="Config not found.")
    dataset = session.get(Dataset, job.dataset_id)
    if dataset is None:
        raise HTTPException(status_code=400, detail="Dataset not found.")

    state_dir, step = find_latest_state_dir(Path(job.output_dir), job.name)
    resume_from = str(state_dir) if state_dir else None

    job.status = JobStatus.running
    job.finished_at = None
    session.add(job)
    session.commit()
    session.refresh(job)

    job_snapshot = Job(**{k: getattr(job, k) for k in Job.model_fields if hasattr(job, k)})
    config_snapshot = Config(**{k: getattr(config, k) for k in Config.model_fields if hasattr(config, k)})
    dataset_snapshot = Dataset(**{k: getattr(dataset, k) for k in Dataset.model_fields if hasattr(dataset, k)})

    background_tasks.add_task(run_training, job_snapshot, config_snapshot, dataset_snapshot, resume_from)


@router.get("/{job_id}/stream")
async def stream_job(job_id: int, session: Session = Depends(get_session)) -> EventSourceResponse:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return EventSourceResponse(stream_log(job.log_path))
