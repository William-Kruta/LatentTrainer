from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


class LtxModelConfig(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    ltx_install_path: str = ""
    model_path: str = ""
    spatial_upscaler_path: str = ""
    temporal_upscaler_path: str = ""
    text_encoder_repo_id: str = ""
    loras: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )


class LtxModelConfigRead(SQLModel):
    ltx_install_path: str
    model_path: str
    spatial_upscaler_path: str
    temporal_upscaler_path: str
    text_encoder_repo_id: str
    loras: list[dict[str, Any]]


class LtxModelConfigUpdate(SQLModel):
    ltx_install_path: str = ""
    model_path: str = ""
    spatial_upscaler_path: str = ""
    temporal_upscaler_path: str = ""
    text_encoder_repo_id: str = ""
    loras: list[dict[str, Any]] = Field(default_factory=list)
