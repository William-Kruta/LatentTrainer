# Session Handoff — Modularization Refactor

## What Was Done (Tasks 1–4 complete, no commits yet)

### Task 1 ✅ — app/models.py → app/models/ package
- `app/models.py` deleted
- `app/models/common.py`, `training.py`, `generation.py`, `image_edit.py`, `gallery.py`, `media.py`, `settings.py`, `ltx.py` created
- `app/models/__init__.py` barrel re-exports all symbols — existing imports unchanged

### Task 2 ✅ — inference/base.py Protocol
- `inference/base.py` created with `PersistentWorkerClient` Protocol (defines `run()` signature)

### Task 3 ✅ — PersistentChromaWorker moved
- `inference/chroma/client.py` created — contains `PersistentChromaWorker` (moved from `app/core/generate.py`)
- `inference/chroma/__init__.py` updated to export it
- `inference/chroma/chroma.py` (scratch file) deleted
- `app/core/generate.py` — `PersistentChromaWorker` class removed, `VENV_FLUX_PYTHON` removed, import added

### Task 4 ✅ — fk9_scripts/ → inference/flux/
- `inference/flux/client.py` created (from fk9_scripts/flux2_client.py); `root_dir` depth fixed to `.parent.parent.parent`; `worker_script` path updated
- `inference/flux/worker.py` created (verbatim copy)
- `inference/flux/__init__.py` created
- `fk9_scripts/` directory deleted
- `app/api/generate.py` import updated to `from inference.flux.client import Flux2WorkerClient`

---

## What Needs To Be Done (Tasks 5–9)

### Task 5 — Split app/core/generate.py into package
Current `app/core/generate.py` still has: `PersistentGenerateWorker`, queue globals/helpers, `_run_generation` dispatcher, queue worker thread.

Create `app/core/generate/` package:
- `worker.py` — `PersistentGenerateWorker` class only (+ its constants)
- `queue.py` — `GenerationRecord` dataclass, `_generation_lock`, `_generations`, `_generation_queue`, `_active_generation_id`, `_generation_condition`, and helpers: `get_generation`, `get_queue_status`, `remove_latest_queued_generation`, `_serialize`, `_update_record`, `_append_log`
- `dispatcher.py` — `_worker = PersistentGenerateWorker()`, `_chroma_worker = PersistentChromaWorker()`, `GENERATIONS_DIR`, `_round_to_multiple`, `_normalized_payload`, `_validate_generation_request`, `_attach_generation_metadata`, `_enhance_prompt`, `start_generation`, `get_worker_status`, `stop_worker`, `_run_generation`, `_generation_queue_worker`, thread creation + `.start()`
- `__init__.py` — re-exports: `GENERATE_METADATA_KEY`, `GENERATIONS_DIR`, `get_generation`, `get_queue_status`, `get_worker_status`, `remove_latest_queued_generation`, `start_generation`, `stop_worker`

Delete `app/core/generate.py` after.

Verify:
```bash
uv run python -c "from app.core.generate import start_generation, get_queue_status, stop_worker; print('OK')"
uv run python -c "from app.main import app; print('OK')"
```

### Task 6 — Split app/api/generate.py into package
Create `app/api/generate/` package:
- `images.py` — router with all image generation endpoints + config endpoints (no function-run logic)
- `functions.py` — `FunctionRunRecord`, `_function_runs`, `_function_runs_lock`, `FUNCTION_OUTPUTS_DIR`, `flux_client`, and the image-edit function endpoints
- `__init__.py` — imports both routers

Update `app/main.py`:
```python
from app.api.generate import images_router as generate_images_router
from app.api.generate import functions_router as generate_functions_router
app.include_router(generate_images_router)
app.include_router(generate_functions_router)
```

Delete `app/api/generate.py` after.

Verify:
```bash
uv run python -c "from app.main import app; print(len(app.routes), 'routes OK')"
```

### Task 7 — Split frontend/src/lib/api.ts into domain package
Create `frontend/src/lib/api/`:
- `generate.ts` — `ApiError`, `request` helper, `formPost` helper, all Generate* interfaces, `generateApi` object
- `training.ts` — Config/Job/Settings/LTX interfaces, `trainingApi` object (imports `request` from `./generate`)
- `datasets.ts` — Dataset interfaces, `datasetsApi` object
- `media.ts` — Gallery/GPU/Media interfaces, `mediaApi` object
- `index.ts` — re-exports everything + combines into `api = { ...generateApi, ...trainingApi, ...datasetsApi, ...mediaApi }`

Delete `frontend/src/lib/api.ts` after.

Verify: `cd frontend && npm run build` — must compile with no errors.

### Task 8 — Extract hooks from GeneratePage.tsx (892 lines)
Create `frontend/src/hooks/`:
- `useWorkerStatus.ts` — polls worker/queue status, exposes `workerStatus`, `queueStatus`, `isUnloading`, `handleUnloadWorker`, `refreshWorkerStatus`
- `useGenerationState.ts` — manages generation submission and polling, exposes `result`, `isGenerating`, `isSubmittingGeneration`, `submitGeneration`, `cancelLatest`, `clearResult`

Update `GeneratePage.tsx` to use both hooks — remove the extracted state/effects, import the hooks.

Verify: `cd frontend && npm run build`

### Task 9 — Extract useConfigForm hook from ConfigsPage.tsx (804 lines)
Create `frontend/src/hooks/useConfigForm.ts` — extracts config list, form state, save/delete/duplicate handlers.

Update `ConfigsPage.tsx` to use the hook.

Verify: `cd frontend && npm run build`

---

## Key Files for Context
- Plan: `docs/superpowers/plans/2026-04-25-modularization.md` (full task details with code)
- Spec: `docs/superpowers/specs/2026-04-25-modularization-design.md`
- Git is on `master` branch. No commits have been made — all changes are unstaged.

## Verification After All Tasks
```bash
uv run python -c "from app.main import app; print('OK')"
cd frontend && npm run build
```
