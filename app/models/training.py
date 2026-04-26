from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, JSON
from sqlmodel import Field, Relationship, SQLModel

from app.models.common import JobStatus, utcnow


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
    caption_count: int = 0
    size_bytes: int = 0
    created_at: datetime = Field(default_factory=utcnow)
    jobs: list["Job"] = Relationship(back_populates="dataset")


class DatasetCreate(DatasetBase):
    image_count: int = 0
    caption_count: int = 0
    size_bytes: int = 0


class DatasetRead(DatasetBase):
    id: int
    image_count: int
    caption_count: int = 0
    size_bytes: int
    created_at: datetime


class DatasetFile(SQLModel):
    filename: str
    has_caption: bool
    caption: str | None = None


class DatasetDetail(DatasetRead):
    files: list[DatasetFile]


class RenameFilesRequest(SQLModel):
    prefix: str


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
