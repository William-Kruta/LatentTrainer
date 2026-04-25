from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, Relationship, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    stopped = "stopped"


class SamplePrompt(SQLModel):
    prompt: str
    width: int = 1024
    height: int = 1024
    seed: int = 42
    lora_scale: float = 1.0


class ConfigBase(SQLModel):
    name: str
    model_path: str
    max_steps: int = 2000
    learning_rate: float = 1e-4
    batch_size: int = 4
    resolution: int = 1024
    optimizer: str = "AdamW"
    lr_scheduler: str = "cosine"
    warmup_steps: int = 100
    network_dim: int = 32
    network_alpha: int = 16
    save_every_n_steps: int = 500
    save_format: str = "safetensors"
    mixed_precision: str = "bf16"
    sample_every_n_steps: int = 200
    sample_steps: int = 20
    sample_cfg: float = 7.0
    skip_first_sample: bool = True
    disable_sampling: bool = False
    cache_latents: bool = False
    cache_latents_to_disk: bool = False
    cache_text_encoder_outputs: bool = False
    cache_text_encoder_outputs_to_disk: bool = False


class Config(ConfigBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    sample_prompts: list[dict[str, Any]] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )

    jobs: list["Job"] = Relationship(back_populates="config")


class ConfigCreate(ConfigBase):
    sample_prompts: list[SamplePrompt] = Field(default_factory=list)


class ConfigRead(ConfigBase):
    id: int
    sample_prompts: list[SamplePrompt]


class ConfigSummary(SQLModel):
    id: int
    name: str
    max_steps: int
    learning_rate: float


class ConfigOptions(SQLModel):
    optimizers: list[str]
    lr_schedulers: list[str]
    save_formats: list[str]
    mixed_precision_modes: list[str]


class DatasetBase(SQLModel):
    name: str
    path: str


class Dataset(DatasetBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    image_count: int = 0
    size_bytes: int = 0
    created_at: datetime = Field(default_factory=utcnow)

    jobs: list["Job"] = Relationship(back_populates="dataset")


class DatasetCreate(DatasetBase):
    image_count: int = 0
    size_bytes: int = 0


class DatasetRead(DatasetBase):
    id: int
    image_count: int
    size_bytes: int
    created_at: datetime


class DatasetFile(SQLModel):
    filename: str
    has_caption: bool
    caption: str | None = None


class DatasetDetail(DatasetRead):
    files: list[DatasetFile]


class JobBase(SQLModel):
    name: str
    config_id: int = Field(foreign_key="config.id")
    dataset_id: int = Field(foreign_key="dataset.id")
    output_dir: str


class Job(JobBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    status: JobStatus = Field(default=JobStatus.pending)
    started_at: datetime = Field(default_factory=utcnow)
    finished_at: datetime | None = None
    log_path: str = ""

    config: Optional["Config"] = Relationship(back_populates="jobs")
    dataset: Optional["Dataset"] = Relationship(back_populates="jobs")


class JobCreate(JobBase):
    pass


class JobRead(JobBase):
    id: int
    status: JobStatus
    started_at: datetime
    finished_at: datetime | None
    log_path: str


class GPUStat(SQLModel):
    id: int
    name: str
    vram_used_gb: float
    vram_total_gb: float
    utilization_pct: int
    temperature_c: int


class AutoCaptionRequest(SQLModel):
    llama_url: str = "http://localhost:8080"
    model: str = ""
    system_prompt: str = ""
    trigger_word: str = ""
    max_tokens: int = 2048
    overwrite: bool = False


class PromptEnhanceSettings(SQLModel):
    llama_url: str = "http://localhost:8080"
    model: str = ""
    system_prompt: str = ""
    max_tokens: int = 512


class GenerateImageRequest(SQLModel):
    architecture: str = "sdxl"
    loras: list["GenerateLoraSpec"] = []
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


class GenerateLoraSpec(SQLModel):
    path: str
    strength: float = 1.0


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
    error: str | None = None


class GenerateConfigBase(SQLModel):
    name: str
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


class GenerateConfig(GenerateConfigBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class GenerateConfigCreate(SQLModel):
    name: str
    loras: list["GenerateLoraSpec"] = Field(default_factory=list)
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


class GenerateConfigSummary(SQLModel):
    id: int
    name: str
    updated_at: datetime


class GenerateConfigRead(GenerateConfigCreate):
    id: int
    created_at: datetime
    updated_at: datetime


class GenerateWorkerStatus(SQLModel):
    state: str
    model_path: str | None = None
    lora_count: int = 0
    idle_timeout_seconds: int
    idle_seconds_remaining: int | None = None


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
    loras: list["GenerateLoraSpec"] = Field(default_factory=list)


class GenerateFunctionConfigSummary(SQLModel):
    id: int
    name: str
    function_type: str
    updated_at: datetime


class GenerateFunctionConfigRead(GenerateFunctionConfigCreate):
    id: int
    created_at: datetime
    updated_at: datetime


class ImageEditStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class ImageEditResponse(SQLModel):
    function_run_id: str
    generation_id: str
    status: ImageEditStatus
    image_url: str
    width: int
    height: int
    prompt: str
    stage: str | None = None
    current_step: int = 0
    total_steps: int = 0
    rate_value: float | None = None
    rate_unit: str | None = None
    error: str | None = None


class GalleryImage(SQLModel):
    id: str
    generation_id: str
    filename: str
    image_url: str
    created_at: datetime
    size_bytes: int
    width: int | None = None
    height: int | None = None


class GalleryDeleteRequest(SQLModel):
    image_ids: list[str]


class GalleryMoveRequest(SQLModel):
    image_ids: list[str]
    dataset_id: int


class MediaVideo(SQLModel):
    filename: str
    title: str
    video_url: str
    size_bytes: int
    created_at: datetime
    duration_seconds: float | None = None
    fps: float | None = None
    source_url: str | None = None


class MediaDownloadRequest(SQLModel):
    url: str


class MediaDownloadResponse(SQLModel):
    video: MediaVideo


class MediaFrameExportResponse(SQLModel):
    path: str
