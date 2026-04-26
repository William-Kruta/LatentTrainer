from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.db import get_session
from app.models import AppSettings, AppSettingsRead, AppSettingsUpdate, LtxModelConfig, LtxModelConfigRead, LtxModelConfigUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _get_or_create(session: Session) -> AppSettings:
    settings = session.exec(select(AppSettings)).first()
    if settings is None:
        settings = AppSettings()
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


@router.get("", response_model=AppSettingsRead)
def get_settings(session: Session = Depends(get_session)) -> AppSettings:
    return _get_or_create(session)


@router.put("", response_model=AppSettingsRead)
def update_settings(
    body: AppSettingsUpdate,
    session: Session = Depends(get_session),
) -> AppSettings:
    settings = _get_or_create(session)
    settings.model_root = body.model_root
    settings.lora_root = body.lora_root
    settings.output_root = body.output_root
    settings.dataset_root = body.dataset_root
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings


_WEIGHT_EXTENSIONS = {".safetensors", ".pt", ".ckpt", ".bin"}
_MODEL_SUBDIRS = ("checkpoints", "diffusion_models")


def _walk_files(root_str: str) -> tuple[str, list[str]]:
    root = Path(root_str)
    if not root_str or not root.is_dir():
        return root_str, []
    files = sorted(
        str(p.relative_to(root))
        for p in root.rglob("*")
        if p.is_file() and p.suffix.lower() in _WEIGHT_EXTENSIONS
    )
    return root_str, files


def _walk_model_files(root_str: str) -> tuple[str, list[str]]:
    root = Path(root_str)
    if not root_str or not root.is_dir():
        return root_str, []

    files: list[str] = []
    for subdir_name in _MODEL_SUBDIRS:
        subdir = root / subdir_name
        if not subdir.is_dir():
            continue
        files.extend(
            str(path.relative_to(root))
            for path in subdir.rglob("*")
            if path.is_file() and path.suffix.lower() in _WEIGHT_EXTENSIONS
        )
    return root_str, sorted(files)


@router.get("/loras")
def list_loras(session: Session = Depends(get_session)) -> dict:
    settings = _get_or_create(session)
    root, files = _walk_files(settings.lora_root)
    return {"lora_root": root, "files": files}


@router.get("/models")
def list_models(session: Session = Depends(get_session)) -> dict:
    settings = _get_or_create(session)
    root, files = _walk_model_files(settings.model_root)
    return {"model_root": root, "files": files}


def _get_or_create_ltx(session: Session) -> LtxModelConfig:
    config = session.exec(select(LtxModelConfig)).first()
    if config is None:
        config = LtxModelConfig()
        session.add(config)
        session.commit()
        session.refresh(config)
    return config


@router.get("/ltx", response_model=LtxModelConfigRead)
def get_ltx_config(session: Session = Depends(get_session)) -> LtxModelConfig:
    return _get_or_create_ltx(session)


@router.put("/ltx", response_model=LtxModelConfigRead)
def update_ltx_config(
    body: LtxModelConfigUpdate,
    session: Session = Depends(get_session),
) -> LtxModelConfig:
    config = _get_or_create_ltx(session)
    config.ltx_install_path = body.ltx_install_path
    config.model_path = body.model_path
    config.spatial_upscaler_path = body.spatial_upscaler_path
    config.temporal_upscaler_path = body.temporal_upscaler_path
    config.text_encoder_repo_id = body.text_encoder_repo_id
    config.loras = body.loras
    session.add(config)
    session.commit()
    session.refresh(config)
    return config
