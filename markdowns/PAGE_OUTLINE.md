# LatentTrainer — Project Overview

A self-hosted web application for local AI image/video model fine-tuning and inference. Integrates SDXL LoRA training, text-to-image generation, image editing, video generation, and dataset/media management into a single React + FastAPI tool, designed for GPU workstations.

---

## Tech Stack

### Backend
| Component | Technology |
|---|---|
| Web framework | FastAPI 0.115+ |
| ASGI server | Uvicorn 0.32+ |
| Database ORM | SQLModel + SQLAlchemy + SQLite |
| Data validation | Pydantic 2.9+ |
| HTTP client | httpx 0.28+ |
| Image processing | Pillow 11.0+ |
| GPU monitoring | nvidia-ml-py 12.560+ |
| SSE streaming | sse-starlette 2.1+ |
| Video download | yt-dlp 2025.1+ |
| Package manager | uv |
| Python | 3.12 |

### Frontend
| Component | Technology |
|---|---|
| Framework | React 18 |
| Router | react-router-dom 6 |
| Build tool | Vite 5 |
| Language | TypeScript 5.6 |
| CSS | Plain CSS |

### ML / Inference Dependencies
| Component | Technology |
|---|---|
| Training | kohya-ss/sd-scripts (git submodule) — PyTorch, Diffusers, Accelerate, Transformers, bitsandbytes |
| SDXL inference | sd_scripts/sdxl_persistent_worker.py (long-lived subprocess) |
| Chroma inference | Chroma pipeline (runs in `.venv-flux`) |
| FLUX.2 image editing | black-forest-labs/FLUX.2-klein-9B (runs in `.venv-flux`) |
| LTX-2 video generation | LTX-2 (separate venv), Gemma text encoder |
| Z-Image-Turbo | Diffusers ZImagePipeline (stub/example) |
| Prompt enhance / captioning | llama.cpp server (OpenAI-compatible API) |

---

## Project Structure

```
LatentTrainer/
├── main.py                  # Entry point: creates FastAPI app
├── pyproject.toml           # Python project metadata & dependencies
├── uv.lock                  # Lockfile for uv package manager
├── run.sh                   # Launch script (backend + frontend concurrently)
├── .python-version          # Python 3.12
├── .gitmodules              # Submodule: sd_scripts (kohya-ss/sd-scripts)
│
├── app/                     # Python backend (FastAPI)
│   ├── main.py              # App creation, CORS, routers, static files, SPA fallback
│   ├── db.py                # SQLite database setup (SQLModel + SQLAlchemy)
│   ├── api/                 # REST API route handlers
│   │   ├── configs.py       # Training config CRUD
│   │   ├── datasets.py      # Dataset upload, captioning, management
│   │   ├── jobs.py          # Training job submission, cancel, resume, SSE log streaming
│   │   ├── gallery.py       # Generated image/video browser, delete, move to dataset
│   │   ├── media.py         # Video upload/download (yt-dlp), frame export
│   │   ├── settings.py      # App settings (model/lora roots, LTX config)
│   │   ├── system.py        # GPU stats
│   │   ├── image_edit.py    # Image editing via FLUX.2-klein-9B
│   │   ├── ltx.py           # Video generation via LTX-2
│   │   └── generate/        # Image generation sub-package
│   │       ├── images.py    # Text-to-image endpoints + generate config CRUD
│   │       └── functions.py # Image-edit functions pipeline (FLUX.2 based)
│   ├── core/                # Core business logic
│   │   ├── trainer.py       # SDXL LoRA training subprocess manager (kohya-ss)
│   │   ├── seed.py          # Database seed data (demo configs)
│   │   ├── gpu.py           # NVIDIA GPU stats via pynvml
│   │   └── generate/        # Image generation sub-package
│   │       ├── dispatcher.py  # Generation orchestration, prompt enhance, queue worker thread
│   │       ├── queue.py       # In-memory generation queue & record management
│   │       └── worker.py      # Persistent SDXL worker (long-lived subprocess)
│   ├── models/              # SQLModel ORM models & Pydantic schemas
│   │   ├── training.py      # Config, Dataset, Job (LoRA training)
│   │   ├── generation.py    # GenerateImageRequest, GenerateConfig, queue/worker status
│   │   ├── settings.py      # AppSettings, LtxModelConfig
│   │   ├── gallery.py       # GalleryImage, delete/move request models
│   │   ├── media.py         # GPUStat, MediaVideo, AutoCaptionRequest
│   │   ├── image_edit.py    # ImageEditResponse/Status
│   │   ├── ltx.py           # LtxModelConfig (DB table)
│   │   └── common.py        # JobStatus enum, utcnow helper
│   └── static/              # Built frontend assets (populated by Vite build)
│
├── inference/               # Inference workers (separate subprocesses)
│   ├── base.py              # PersistentWorkerClient Protocol
│   ├── chroma/              # Chroma (diffusion model) inference
│   ├── flux/                # FLUX.2-klein-9B inference
│   ├── ltx/                 # LTX-2 video generation
│   └── zimage/              # Z-Image-Turbo example script
│
├── frontend/                # React (TypeScript) SPA
│   ├── index.html
│   ├── package.json         # React 18, react-router-dom, Vite
│   ├── vite.config.ts       # Vite proxy /api -> backend, build -> app/static
│   └── src/
│       ├── main.tsx         # ReactDOM entry
│       ├── App.tsx          # Routes
│       ├── components/      # Shared UI (AppShell, Toast, PageSection, generate/*)
│       ├── pages/           # Page components (Home, Training, Generate, Media, Gallery, Datasets, Configs, Settings)
│       ├── hooks/           # Custom React hooks
│       ├── lib/             # API client layer, pipeline state management
│       └── styles/
│
├── sd_scripts/              # Git submodule: kohya-ss/sd-scripts
│
├── data/                    # Runtime DB, logs, generations (gitignored)
├── datasets/                # Uploaded datasets (gitignored)
├── generations/             # Generated images (gitignored)
├── outputs/                 # Training outputs (gitignored)
├── uploads/                 # Uploaded media (gitignored)
├── .venv/                   # Main backend Python venv
└── .venv-flux/              # Separate Flux/Chroma venv
```

---

## Features

### LoRA Training (`/training`)
- Create/edit training configs (model path, hyperparameters: steps, LR, batch size, resolution, optimizer, scheduler, LoRA dim/alpha, caching, mixed precision, sampling)
- Upload/manage datasets (zip, drag-and-drop images, inline caption editing)
- Launch training jobs running `kohya-ss/sdxl_train_network.py` as subprocess (one at a time)
- Live SSE log streaming with TQDM progress parsing (loss, step, ETA, it/s)
- Resume from checkpoint states, cancel running jobs
- Sample prompt image generation during training

### Image Generation (`/generate`)
- Text-to-image via SDXL or Chroma pipelines
- Persistent worker pattern: subprocess stays warm between generations (10-min idle timeout)
- LoRA stacking support during generation
- Prompt enhancement via llama.cpp (optional)
- In-memory generation queue with cancel support
- Generated images embedded with metadata (PNG info chunks)

### Image Editing (`/generate` functions, `/api/image-edit`)
- FLUX.2-klein-9B based image editing (reference image + prompt -> edited image)
- LoRA weights support
- Pipeline chaining: multiple image-edit steps after generation

### Video Generation (`/api/ltx`)
- LTX-2 text-to-video
- Configurable resolution, frame count, frame rate, inference steps, CFG/STG scale, offload mode
- LoRA stacking for video generation

### Dataset Management (`/datasets`)
- Upload via zip, folder, or individual files
- Thumbnail grid with inline caption editing
- Auto-captioning via llama.cpp vision model (streaming SSE)

### Media Player (`/media`)
- Video upload and URL download (yt-dlp)
- HTML5 video player with custom seekbar
- Frame extraction to directory or directly into a dataset

### Gallery (`/gallery`)
- Browse all generated images and videos
- Multi-select, bulk delete, bulk move to dataset

### Dashboard (`/`)
- Live GPU stats (VRAM usage, utilization, temperature)
- Currently running training job status
- Recent job history

### Settings (`/settings`)
- Configure model root, LoRA root, output root, dataset root paths
- LTX-2 model path configuration
- Browse available models and LoRA weights

---

## Database Schema (SQLite, 7 tables)

| Table | Purpose |
|---|---|
| `config` | Training configurations (model path, hyperparameters, sample prompts JSON) |
| `dataset` | Uploaded datasets (path, image count, size) |
| `job` | Training jobs (config_id, dataset_id, status, log path, timestamps) |
| `appsettings` | Root directory paths (model, lora, output, dataset) |
| `generateconfig` | Saved image generation presets (architecture, model, prompts, LoRAs, settings JSON) |
| `generatefunctionconfig` | Saved image-edit function presets |
| `ltxmodelconfig` | LTX-2 model paths and LoRA config JSON |

---

## Architecture Patterns

- **Single-process web server** with background subprocesses for ML workloads (training/inference run as separate child processes for GPU memory isolation)
- **Persistent worker pattern**: SDXL and Chroma inference workers are long-lived subprocesses communicating over stdin/stdout JSON lines, with idle timeout auto-shutdown
- **GPU VRAM management**: SDXL and FLUX workers are mutually exclusive — starting one kills the other to free VRAM (documented in `COMFY.md`)
- **Generation queue**: In-memory FIFO queue processed by a single background thread; one generation at a time
- **SSE streaming**: Training logs and auto-captioning stream progress to the browser in real-time
- **SPA architecture**: Vite builds React frontend into `app/static/`; FastAPI serves it as static files with SPA fallback routing
- **Dual Python venvs**: `.venv` (main backend) and `.venv-flux` (FLUX/Chroma workers) for isolated PyTorch/Diffusers versions

---

## API Routes (11 routers)

| Prefix | Tag | Key Endpoints |
|---|---|---|
| `/api/configs` | configs | CRUD for training configs, options listing |
| `/api/datasets` | datasets | Upload/delete datasets, upload images, auto-captioning, serve images |
| `/api/jobs` | jobs | Create/cancel/resume training jobs, SSE log streaming |
| `/api/generate` | generate | Text-to-image, worker status/unload, queue management, config CRUD |
| `/api/gallery` | gallery | List/delete/move gallery images and videos |
| `/api/media` | media | Video upload/download, frame export |
| `/api/image-edit` | image-edit | Image editing via FLUX.2-klein-9B |
| `/api/ltx` | ltx | Video generation via LTX-2 |
| `/api/settings` | settings | App settings, LoRA/model browsing, LTX config |
| `/api` | system | GPU stats |
| `/api/health` | (none) | Health check |
