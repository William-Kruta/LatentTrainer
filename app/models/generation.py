from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel

from app.models.common import utcnow


class PromptEnhanceSettings(SQLModel):
    llama_url: str = "http://localhost:8080"
    model: str = ""
    system_prompt: str = ""
    max_tokens: int = 512


class GenerateLoraSpec(SQLModel):
    path: str
    strength: float = 1.0


class GenerateImageRequest(SQLModel):
    architecture: str = "sdxl"
    loras: list[GenerateLoraSpec] = []
    model_path: str
    chroma_pipeline_repo: str = ""
    positive_prompt: str
    negative_prompt: str = ""
    prompt_enhance: bool = False
    prompt_enhance_settings: PromptEnhanceSettings = Field(default_factory=PromptEnhanceSettings)
    steps: int = 30
    cfg_scale: float = 7.0
    width: int = 1024
    height: int = 1024
    seed: int | None = None
    batch_count: int = 1
    sampler: str = "euler"
    controlnet_mode: bool = False
    controlnet_conditioning_scale: float = 0.8
    controlnet_preprocess: str = "none"
    control_image_path: str = ""
    cpu_offload: bool = False
    sequential_cpu_offload: bool = False
    vae_tiling: bool = False
    vae_slicing: bool = False


class GenerationStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class GenerateImageResponse(SQLModel):
    generation_id: str
    status: GenerationStatus
    image_urls: list[str] = []
    architecture: str = "sdxl"
    model_path: str
    positive_prompt: str
    negative_prompt: str
    steps: int
    cfg_scale: float
    width: int
    height: int
    seed: int | None = None
    batch_count: int = 1
    batch_index: int = 0
    sampler: str = "euler"
    current_step: int = 0
    total_steps: int
    rate_value: float | None = None
    rate_unit: str | None = None
    stage: str | None = None
    error: str | None = None


class GenerateConfigBase(SQLModel):
    name: str
    architecture: str = "sdxl"
    loras: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    model_path: str
    positive_prompt: str
    negative_prompt: str = ""
    prompt_enhance: bool = False
    prompt_enhance_settings: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    steps: int = 30
    cfg_scale: float = 7.0
    width: int = 1024
    height: int = 1024
    seed: int | None = None
    cpu_offload: bool = False
    sequential_cpu_offload: bool = False
    vae_tiling: bool = False
    vae_slicing: bool = False


class GenerateConfig(GenerateConfigBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    pinned: bool = Field(default=False)


class GenerateConfigCreate(SQLModel):
    name: str
    architecture: str = "sdxl"
    loras: list[GenerateLoraSpec] = Field(default_factory=list)
    model_path: str
    positive_prompt: str
    negative_prompt: str = ""
    prompt_enhance: bool = False
    prompt_enhance_settings: PromptEnhanceSettings = Field(default_factory=PromptEnhanceSettings)
    steps: int = 30
    cfg_scale: float = 7.0
    width: int = 1024
    height: int = 1024
    seed: int | None = None
    cpu_offload: bool = False
    sequential_cpu_offload: bool = False
    vae_tiling: bool = False
    vae_slicing: bool = False


class GenerateConfigSummary(SQLModel):
    id: int
    name: str
    updated_at: datetime
    pinned: bool = False


class WarmupRequest(SQLModel):
    architecture: str = "sdxl"
    model_path: str
    chroma_pipeline_repo: str = ""
    loras: list[GenerateLoraSpec] = Field(default_factory=list)
    controlnet_mode: bool = False
    controlnet_path: str = ""
    cpu_offload: bool = False
    sequential_cpu_offload: bool = False
    vae_tiling: bool = False
    vae_slicing: bool = False


class ControlNetConfig(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    model_path: str = ""
    conditioning_scale: float = 0.8


class GenerateConfigRead(GenerateConfigCreate):
    id: int
    created_at: datetime
    updated_at: datetime


class GenerateFunctionConfigBase(SQLModel):
    name: str
    function_type: str = "image_edit"
    auto_run: bool = False
    prompt: str = ""
    steps: int = 4
    loras: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))


class GenerateFunctionConfig(GenerateFunctionConfigBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class GenerateFunctionConfigCreate(SQLModel):
    name: str
    function_type: str = "image_edit"
    auto_run: bool = False
    prompt: str = ""
    steps: int = 4
    loras: list[GenerateLoraSpec] = Field(default_factory=list)


class GenerateFunctionConfigSummary(SQLModel):
    id: int
    name: str
    function_type: str
    updated_at: datetime


class GenerateFunctionConfigRead(GenerateFunctionConfigCreate):
    id: int
    created_at: datetime
    updated_at: datetime


class GenerateWorkerStatus(SQLModel):
    state: str
    model_path: str | None = None
    lora_count: int = 0
    idle_timeout_seconds: int
    idle_seconds_remaining: int | None = None
    chroma_state: str = "cold"
    chroma_model_path: str | None = None
    chroma_idle_seconds_remaining: int | None = None
    controlnet_state: str = "cold"
    controlnet_model_path: str | None = None
    controlnet_idle_seconds_remaining: int | None = None


class GenerateQueueStatus(SQLModel):
    active_generation_id: str | None = None
    queued_count: int = 0
    queued_generation_ids: list[str] = []
