# ControlNet Support for SDXL

## Overview

ControlNet enables spatially-guided image generation by conditioning the SDXL model on a control image (e.g., edges, depth maps, poses). This document outlines the implementation plan using a **toggle-mode approach**, where ControlNet mode is an explicit switch that reloads the pipeline with the ControlNet baked in, rather than attempting to hot-swap it mid-session.

---

## Design Decision: Toggle Mode

When ControlNet is **off**, the worker uses `StableDiffusionXLPipeline` as it does today.
When ControlNet is **on**, the worker is restarted with `StableDiffusionXLControlNetPipeline`, which requires the `ControlNetModel` to be loaded at initialization time.

**Rationale:**
- `StableDiffusionXLControlNetPipeline` cannot be constructed without the ControlNet model — it cannot be injected into an already-running base pipeline
- Keeping both pipelines warm simultaneously would double VRAM usage
- A deliberate mode switch with a visible "warm up" step is honest UX: the user knows a reload is happening
- Matches the existing warmup button pattern already in place

**Consequence:** switching between ControlNet-on and ControlNet-off triggers a worker restart (same as changing the base model). The UI should surface this clearly.

---

## Architecture

### Pipeline Selection (Worker)

```
GenerateMode = "sdxl" | "sdxl_controlnet"
```

The dispatcher checks `config.controlnet_mode` (or the incoming request flag) and spawns the correct persistent worker class:

- `PersistentGenerateWorker` → `StableDiffusionXLPipeline` (unchanged)
- `PersistentControlNetWorker` → `StableDiffusionXLControlNetPipeline` + `ControlNetModel`

Both workers share the same job queue interface so the API layer stays the same.

### Control Image Flow

```
User uploads control image (raw photo or pre-processed)
        ↓
Optional: server-side Canny preprocessor (if "Auto Canny" is checked)
        ↓
PIL Image passed to pipeline as `image=` argument
        ↓
controlnet_conditioning_scale applied
```

---

## Implementation Steps

### 1. Settings — New ControlNet Config Table

**Model:** `app/models/generation.py`

Add a new `ControlNetConfig` SQLModel table:

```python
class ControlNetConfig(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    model_path: str = ""          # local path or HF repo (e.g. diffusers/controlnet-canny-sdxl-1.0)
    conditioning_scale: float = 0.8
```

**Migration:** `app/db.py`

Add `_run_schema_migrations()` block for the new table (SQLModel `create_all` handles new tables; no ALTER needed).

**API:** `app/api/settings.py`

- `GET /api/settings/controlnet` → returns current config
- `PUT /api/settings/controlnet` → saves config

### 2. Backend — ControlNet Worker

**New file:** `app/core/generate/controlnet_worker.py`

```python
class PersistentControlNetWorker:
    """
    Mirrors PersistentGenerateWorker but initialises
    StableDiffusionXLControlNetPipeline.
    """
    def load(self, model_path, controlnet_path, loras, ...): ...
    def generate(self, request, control_image: PIL.Image | None, on_event): ...
```

Key differences from the base worker:
- Loads `ControlNetModel.from_pretrained(controlnet_path)` first
- Passes it to `StableDiffusionXLControlNetPipeline.from_pretrained(..., controlnet=controlnet)`
- `generate()` accepts an extra `control_image` PIL Image argument
- Passes `image=control_image` and `controlnetconditioning_scale=request.conditioning_scale` to the pipeline call

### 3. Backend — Preprocessor (Canny)

**New file:** `app/core/generate/preprocessors.py`

```python
def apply_canny(image: PIL.Image, low_threshold=100, high_threshold=200) -> PIL.Image:
    """Runs OpenCV Canny edge detection and returns a 3-channel PIL Image."""
    ...
```

Dependencies: `opencv-python` (likely already installed). No new model weights required.

The generate endpoint checks `request.preprocess == "canny"` and runs `apply_canny()` before passing to the worker.

### 4. Backend — Generate Endpoint Changes

**File:** `app/api/generate/images.py`

Extend the generate endpoint to accept:

```python
control_image: UploadFile | None = File(None)
controlnet_mode: bool = Form(False)
preprocess: str = Form("none")   # "none" | "canny"
conditioning_scale: float = Form(0.8)
```

The dispatcher:
1. If `controlnet_mode` is `True` and the running worker is `PersistentGenerateWorker` → restart with `PersistentControlNetWorker`
2. If `controlnet_mode` is `False` and the running worker is `PersistentControlNetWorker` → restart with `PersistentGenerateWorker`
3. If `control_image` is provided and `preprocess == "canny"` → run `apply_canny()` before dispatch

### 5. Frontend — Settings Tab

**File:** `frontend/src/pages/SettingsPage.tsx` (or wherever the Model settings live)

Add a "ControlNet" section under SDXL settings:

- **ControlNet Model Path** — text input (HF repo ID or local path)
- **Default Conditioning Scale** — slider (0.0 – 2.0, step 0.05)

Backed by `GET/PUT /api/settings/controlnet`.

### 6. Frontend — Generate Page UI

**File:** `frontend/src/pages/GeneratePage.tsx` + generate sub-components

#### Mode Toggle

In the SDXL model sub-tab (or a dedicated "Control" tab), add:

```
[ ] ControlNet Mode
```

Toggling this:
- Shows/hides the control image upload section
- Warns "Switching modes will restart the worker" if the worker is currently warm
- Calls warmup with the new mode after toggle

#### Control Image Upload

When ControlNet mode is on, show in the **Prompt** sub-tab (below the prompt field):

```
Control Image         [Auto Canny ☐]
[ Drop image or click to upload ]
[ image preview with ✕ remove ]

Conditioning Scale    [●————] 0.80
```

- Upload slot identical to the I2V upload in VideoPanel
- "Auto Canny" checkbox: if checked, server runs the Canny preprocessor; if unchecked, the uploaded image is used as-is (user pre-processed)
- Conditioning scale overrides the default from settings for this generation only

#### API Call Changes

Extend `generateApi.startGenerate()` in `frontend/src/lib/api/generate.ts`:

```typescript
interface GenerateImageRequest {
  // ... existing fields ...
  controlnet_mode: boolean;
  control_image?: File | null;
  preprocess: "none" | "canny";
  conditioning_scale: number;
}
```

Switch the generate call from JSON body to `FormData` (matching the LTX pattern) to support the file upload.

---

## File Change Summary

| File | Change |
|---|---|
| `app/models/generation.py` | Add `ControlNetConfig` table |
| `app/db.py` | No migration needed (new table, `create_all` handles it) |
| `app/api/settings.py` | Add `GET/PUT /api/settings/controlnet` |
| `app/core/generate/controlnet_worker.py` | **New** — persistent ControlNet worker |
| `app/core/generate/preprocessors.py` | **New** — Canny preprocessor |
| `app/core/generate/dispatcher.py` | Worker selection logic, preprocessor call |
| `app/core/generate/__init__.py` | Export new symbols |
| `app/api/generate/images.py` | Accept `control_image`, `controlnet_mode`, `preprocess` form fields |
| `frontend/src/lib/api/generate.ts` | Extend request type, switch to FormData |
| `frontend/src/lib/api/media.ts` | Add `ControlNetConfig` type + settings API calls |
| `frontend/src/pages/SettingsPage.tsx` | ControlNet config section |
| `frontend/src/pages/GeneratePage.tsx` | ControlNet mode toggle + state |
| `frontend/src/components/generate/ModelTab.tsx` | ControlNet toggle pill/checkbox |
| `frontend/src/components/generate/PromptTab.tsx` | Control image upload + conditioning scale |
| `frontend/src/styles/app.css` | Styles for control image upload section |

---

## Out of Scope (First Pass)

- **Multi-ControlNet stacking** — API supports a single ControlNet; list support can be added later
- **Additional preprocessors** — depth (MiDaS), pose (OpenPose), lineart, etc. The `preprocess` enum is designed to extend
- **ControlNet for non-SDXL architectures** — Chroma/FLUX ControlNet has a different pipeline class and is tracked separately
- **ControlNet LoRA** — separate from base LoRAs; deferred

---

## Dependencies

| Package | Already present? | Notes |
|---|---|---|
| `diffusers` | Yes | `StableDiffusionXLControlNetPipeline` available since 0.21 |
| `opencv-python` | Likely | Required for Canny preprocessor |
| `Pillow` | Yes | Image I/O |
| ControlNet weights | No — user provides | Recommended: `diffusers/controlnet-canny-sdxl-1.0` |
