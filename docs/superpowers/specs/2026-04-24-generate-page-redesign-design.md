# Generate Page Redesign

**Date:** 2026-04-24  
**Status:** Approved

---

## Goal

Modernize the Generate page with collapsible form sections, extract reusable components, and introduce a vertically-stacked pipeline UI where function steps can be added, removed, and configured independently — each with Auto-run and Save Output toggles.

---

## Layout

Two-column split page (existing `split-page` grid):

**Left rail (~340px, scrollable)**
- Config Save/Load row (name input + Save button + Load dropdown)
- Worker status card (warm/cold pill + idle countdown)
- Collapsible section cards: Model & LoRAs · Canvas · Parameters · Prompts
- Generate button pinned at the bottom of the rail

**Right panel (flex, scrollable)**
- Pipeline step cards stacked vertically, connected by arrow dividers
- Card 1 is always the SDXL Generate step (not removable)
- Subsequent cards are function steps (removable, reorderable in a future pass)
- "＋ Add Step" button at the bottom of the chain

---

## Pipeline Step Card

Every step (SDXL and functions) renders as a `PipelineStepCard` with this structure:

```
┌──────────────────────────────────────┐
│  ● Step name              [status]   │  ← header
├──────────────────────────────────────┤
│  [output image / empty state]        │  ← output
│  [progress bar + speed stat]         │  ← visible while running
├──────────────────────────────────────┤
│  ▾ Config  (collapsible)             │  ← step-specific fields
│    prompt / steps / image / LoRAs    │
├──────────────────────────────────────┤
│  Auto-run [toggle]  Save [toggle]  [Run] │  ← footer
└──────────────────────────────────────┘
```

**SDXL card differences:**
- No config section (all generate config lives in the left rail form)
- No Auto-run toggle (triggered by the Generate button)
- Has Save Output toggle
- Shows SDXL progress bar and output image

**Function card:**
- Full config section with prompt, steps, extra image upload, LoRA stack
- Auto-run toggle: when on, the step fires automatically once the previous step completes
- Save Output toggle: when off, the result is passed in-memory only (not persisted to gallery/disk)
- Run button: manual trigger, disabled unless the previous step has a completed result

---

## Pipeline State Model

```ts
interface PipelineStep {
  id: string;                  // uuid, stable across re-renders
  type: "image_edit";          // extensible: add new string literals for future step types
  config: {
    prompt: string;
    steps: number;
    loras: GenerateLoraSpec[];
    extra_image: File | null;
  };
  auto_run: boolean;
  save_output: boolean;
  result: ImageEditResponse | null;
  error: string | null;
  is_running: boolean;
}
```

The SDXL step is not in this array — it uses the existing `form: GenerateImageRequest` state and `result: GenerateImageResponse | null`.

Auto-run chain logic: when any step completes, scan forward — if the next step has `auto_run: true` and is not already running, trigger it automatically.

---

## Component Breakdown

All new components live under `src/components/generate/`.

| Component | Responsibility |
|---|---|
| `CollapsibleSection.tsx` | Wraps any content with a chevron-toggle header. Controlled open/closed state passed as prop. |
| `ConfigSaveRow.tsx` | Name input + Save button + Load dropdown + save feedback pill. Props: `name`, `onNameChange`, `onSave`, `configs`, `onLoad`, `feedback`. |
| `WorkerStatusCard.tsx` | Renders warm/cold status pill and idle countdown from a `GenerateWorkerStatus` prop. |
| `LoraCard.tsx` | Single LoRA entry: path input + strength input + remove button. |
| `LoraStack.tsx` | List of `LoraCard` + Add LoRA button. Props: `loras`, `onChange`. |
| `GenerationProgress.tsx` | Progress bar + step counter + speed stat. Used in both SDXL and function cards. |
| `PipelineStepCard.tsx` | Full step card. Props: `step`, `index`, `previousResult`, `onUpdate`, `onRemove`, `onRun`. Renders config fields via `type` switch — adding a new function type means adding a new case. |
| `PromptEnhanceSettingsModal.tsx` | Moved from inline in `GeneratePage.tsx` — no logic changes. |

`GeneratePage.tsx` becomes the orchestrator: owns all state, renders the two-column layout, maps `steps` array to `PipelineStepCard` components.

---

## CSS Changes

New classes in `app.css`:

- `.pipeline-step-card` — card container with border, rounded corners, background
- `.pipeline-step-header` — flex row: dot + name + status pill
- `.pipeline-step-dot` — colored circle (color set inline per step type)
- `.pipeline-connector` — vertical arrow divider between cards
- `.pipeline-add-btn` — dashed "＋ Add Step" button
- `.step-footer` — flex row: toggles on left, run button on right
- `.step-toggle-group` — label + toggle switch pair
- `.collapsible-header` — clickable header row with chevron

Existing classes reused: `.section-card`, `.meter`, `.meter-fill`, `.status-pill`, `.generated-image`, `.lora-card`, `.lora-stack`, `.toggle-switch`.

---

## Scope Boundaries

**In scope:**
- Left-rail form split into collapsible sections
- Component extraction as listed above
- Pipeline step cards (SDXL + Image Edit)
- Auto-run chain logic
- Save Output toggle (UI only — backend already discards or saves based on existing behavior; Save=off means don't call the persist endpoint, or pass a flag)
- "＋ Add Step" button (only Image Edit available initially)
- Remove step button on function cards

**Out of scope (future):**
- Drag-to-reorder steps
- New function types beyond Image Edit
- Persisting the pipeline configuration across page reloads
- Backend changes for save_output (current behavior: all results are saved; toggle wires up when backend supports it)
