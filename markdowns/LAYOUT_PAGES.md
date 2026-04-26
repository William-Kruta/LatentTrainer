# Page Layouts

## Home (`HomePage.tsx`)
Dashboard overview. Shows live GPU stats (VRAM usage, utilization, temperature) polling every 3 seconds. Below that, a two-column layout: the currently running training job on the left, and the 6 most recent completed/failed jobs on the right.

## Configs (`ConfigsPage.tsx`)
Training config editor. Left rail lists all saved configs. Main panel is a full editor for the selected config covering: name, model path, training hyperparameters (steps, LR, batch size, resolution), optimizer and LR scheduler, LoRA network dims, saving options (format, mixed precision, save frequency), latent/text encoder caching toggles, sampling settings, and a list of sample prompt cards with per-prompt width/height/seed/LoRA scale. Supports create, duplicate, delete, and save.

## Datasets (`DatasetsPage.tsx`)
Dataset manager. Left rail lists datasets with image count and size; supports drag-and-drop upload of `.zip` files, folders, or raw image files (prompts for a dataset name). Main panel shows a thumbnail grid of the selected dataset's images with caption status indicators. Clicking a thumbnail shows an inline editable caption textarea that auto-saves on blur. Header actions: Auto Caption (streams progress from a llama.cpp server), caption settings modal (URL, model, system prompt, trigger word, overwrite toggle), and delete. Dragging images onto the main panel adds them to the current dataset.

## Training (`TrainingPage.tsx`)
Training job launcher and live log viewer. Left rail: form to pick a run name, config, and dataset, then submit to start a job. Main panel: live log stream via SSE with auto-scroll, a progress meter, and a stats row (loss, step, ETA, it/s parsed from tqdm output). Stop button cancels a running job; Resume button restarts a stopped job.

## Generate (`GeneratePage.tsx`)
Image generation page. Left rail is a form with: model architecture selector (SDXL / Chroma), config save/load row, worker warm/cold status card, collapsible sections for Model & LoRAs (or just transformer checkpoint for Chroma), Canvas (preset or manual width/height), Parameters (steps, CFG, batch, seed, sampler, Snapchat caption overlay with live preview), and Prompts (positive/negative with optional prompt enhance via llama.cpp). Right panel is a pipeline: an SDXL/Chroma result card showing progress (stage label, step counter, it/s, progress bar) and the final image(s), followed by zero or more image-edit pipeline steps that can be added, configured, auto-run, and chained. Generated images support a Snapchat-style caption overlay with adjustable vertical position.

## Gallery (`GalleryPage.tsx`)
Generated image browser. Displays all images from `data/generations` in a grid with filename, dimensions, size, and timestamp. Supports multi-select (individual or select all), bulk delete, and bulk move to a dataset via a picker modal.

## Media (`MediaPage.tsx`)
Video player and frame extractor. Left sidebar lists uploaded videos; supports URL download (via yt-dlp) and direct file upload. Player has a custom seekbar (click/drag), play/pause, and frame-step controls (configurable jump size in frames). Current frame can be exported to a directory or directly into a dataset. Stats row shows current time, jump size, duration, and source type.
