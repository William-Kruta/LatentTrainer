from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db import get_session
from app.models import Config, ConfigCreate, ConfigOptions, ConfigRead, ConfigSummary

router = APIRouter(prefix="/api/configs", tags=["configs"])

OPTIMIZER_OPTIONS = [
    "AdamW",
    "AdamW8bit",
    "Adafactor",
    "Lion",
    "Lion8bit",
    "Prodigy",
    "SGDNesterov",
]

LR_SCHEDULER_OPTIONS = [
    "constant",
    "constant_with_warmup",
    "cosine",
    "cosine_with_restarts",
    "linear",
    "polynomial",
]

SAVE_FORMAT_OPTIONS = ["safetensors", "ckpt", "pt"]

MIXED_PRECISION_OPTIONS = ["no", "fp16", "bf16"]


@router.get("/options", response_model=ConfigOptions)
def get_config_options() -> ConfigOptions:
    return ConfigOptions(
        optimizers=OPTIMIZER_OPTIONS,
        lr_schedulers=LR_SCHEDULER_OPTIONS,
        save_formats=SAVE_FORMAT_OPTIONS,
        mixed_precision_modes=MIXED_PRECISION_OPTIONS,
    )


@router.get("", response_model=list[ConfigSummary])
def list_configs(session: Session = Depends(get_session)) -> list[ConfigSummary]:
    configs = session.exec(select(Config).order_by(Config.name)).all()
    return [
        ConfigSummary(
            id=config.id,
            name=config.name,
            max_steps=config.max_steps,
            learning_rate=config.learning_rate,
        )
        for config in configs
    ]


@router.post("", response_model=ConfigRead, status_code=201)
def create_config(payload: ConfigCreate, session: Session = Depends(get_session)) -> Config:
    config = Config(**payload.model_dump(mode="json"))
    session.add(config)
    session.commit()
    session.refresh(config)
    return config


@router.get("/{config_id}", response_model=ConfigRead)
def get_config(config_id: int, session: Session = Depends(get_session)) -> Config:
    config = session.get(Config, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Config not found.")
    return config


@router.put("/{config_id}", response_model=ConfigRead)
def update_config(
    config_id: int,
    payload: ConfigCreate,
    session: Session = Depends(get_session),
) -> Config:
    config = session.get(Config, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Config not found.")

    for field, value in payload.model_dump(mode="json").items():
        setattr(config, field, value)

    session.add(config)
    session.commit()
    session.refresh(config)
    return config


@router.delete("/{config_id}", status_code=204)
def delete_config(config_id: int, session: Session = Depends(get_session)) -> None:
    config = session.get(Config, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Config not found.")
    session.delete(config)
    session.commit()


@router.post("/{config_id}/duplicate", response_model=ConfigRead, status_code=201)
def duplicate_config(config_id: int, session: Session = Depends(get_session)) -> Config:
    config = session.get(Config, config_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Config not found.")

    clone = Config(**config.model_dump(exclude={"id"}))
    clone.name = f"{config.name} Copy"
    session.add(clone)
    session.commit()
    session.refresh(clone)
    return clone
