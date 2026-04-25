# Generate Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernise the Generate page into a two-column layout with collapsible form sections on the left and a vertical pipeline of step cards on the right, each with Auto-run and Save-output toggles.

**Architecture:** `GeneratePage.tsx` becomes a thin orchestrator (~250 lines) that owns all state and wires together extracted components. A `PipelineStep` array drives the right panel; each step renders as a `PipelineStepCard`. New components live under `src/components/generate/`.

**Tech Stack:** React 18, TypeScript, Vite, existing `app.css` (no new libraries).

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/lib/pipeline.ts` | `PipelineStep` type + helpers |
| Create | `src/components/generate/CollapsibleSection.tsx` | Chevron-toggle wrapper |
| Create | `src/components/generate/WorkerStatusCard.tsx` | Warm/cold status card |
| Create | `src/components/generate/LoraCard.tsx` | Single LoRA path+strength row |
| Create | `src/components/generate/LoraStack.tsx` | Managed list of LoRA cards |
| Create | `src/components/generate/ConfigSaveRow.tsx` | Name + save + load dropdown |
| Create | `src/components/generate/GenerationProgress.tsx` | Progress bar + step stat |
| Create | `src/components/generate/PromptEnhanceSettingsModal.tsx` | Extracted from GeneratePage |
| Create | `src/components/generate/SdxlResultCard.tsx` | SDXL step card (output + save toggle) |
| Create | `src/components/generate/PipelineStepCard.tsx` | Function step card (config + toggles + run) |
| Modify | `src/pages/GeneratePage.tsx` | Full rewrite as orchestrator |
| Modify | `src/styles/app.css` | Pipeline + collapsible + rail CSS |

---

## Task 1: Add pipeline and collapsible CSS

**Files:**
- Modify: `src/styles/app.css`

- [ ] **Step 1: Append the new CSS block to the end of `app.css` (before the Responsive section)**

Find the line `/* ── Responsive ── */` and insert the block immediately before it:

```css
/* ── Collapsible sections ── */

.collapsible-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  padding: 6px 0;
  user-select: none;
}

.collapsible-header:hover .collapsible-title {
  color: var(--text);
}

.collapsible-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.collapsible-chevron {
  font-size: 0.7rem;
  color: var(--subtle);
  transition: transform 200ms ease;
  line-height: 1;
}

.collapsible-chevron.open {
  transform: rotate(180deg);
}

.collapsible-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
}

/* ── Generate rail ── */

.generate-rail {
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.generate-rail-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

/* ── Pipeline ── */

.generate-pipeline {
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.pipeline-step-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.pipeline-step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.pipeline-step-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.pipeline-step-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text);
  flex: 1;
}

.pipeline-step-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.pipeline-step-image-wrap {
  width: 100%;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-deep);
  overflow: hidden;
}

.pipeline-step-image-wrap img {
  width: 100%;
  display: block;
}

.pipeline-step-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--panel-deep);
  flex-wrap: wrap;
}

.step-toggle-group {
  display: flex;
  align-items: center;
  gap: 5px;
}

.step-toggle-label {
  font-size: 0.74rem;
  color: var(--muted);
  white-space: nowrap;
}

.step-footer-spacer {
  flex: 1;
}

.pipeline-connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 0;
  gap: 0;
}

.pipeline-connector-line {
  width: 1px;
  height: 10px;
  background: var(--border);
}

.pipeline-connector-arrow {
  font-size: 0.7rem;
  color: var(--subtle);
  line-height: 1;
}

.pipeline-add-btn {
  width: 100%;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 10px;
  color: var(--subtle);
  font-size: 0.82rem;
  text-align: center;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
  margin-top: 6px;
}

.pipeline-add-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.step-remove-btn {
  background: transparent;
  border: 0;
  color: var(--danger);
  font-size: 1rem;
  padding: 0 4px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.worker-status-card {
  background: var(--panel-deep);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
```

- [ ] **Step 2: Verify build passes**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/styles/app.css
git commit -m "style: add pipeline and collapsible section CSS"
```

---

## Task 2: Create pipeline types

**Files:**
- Create: `src/lib/pipeline.ts`

- [ ] **Step 1: Create the file**

```ts
// src/lib/pipeline.ts
import type { GenerateLoraSpec, ImageEditResponse } from "./api";

export interface PipelineStep {
  id: string;
  type: "image_edit";
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

export function makeStep(): PipelineStep {
  return {
    id: crypto.randomUUID(),
    type: "image_edit",
    config: { prompt: "", steps: 4, loras: [], extra_image: null },
    auto_run: true,
    save_output: true,
    result: null,
    error: null,
    is_running: false,
  };
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/lib/pipeline.ts
git commit -m "feat: add PipelineStep type and makeStep helper"
```

---

## Task 3: Create CollapsibleSection

**Files:**
- Create: `src/components/generate/CollapsibleSection.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/generate/CollapsibleSection.tsx
import { useState, type PropsWithChildren } from "react";

interface CollapsibleSectionProps extends PropsWithChildren {
  title: string;
  defaultOpen?: boolean;
}

export function CollapsibleSection({ title, defaultOpen = true, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="section-card">
      <div className="collapsible-header" onClick={() => setOpen((o) => !o)}>
        <span className="collapsible-title">{title}</span>
        <span className={`collapsible-chevron${open ? " open" : ""}`}>▼</span>
      </div>
      {open ? <div className="collapsible-body">{children}</div> : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/components/generate/CollapsibleSection.tsx
git commit -m "feat: add CollapsibleSection component"
```

---

## Task 4: Create WorkerStatusCard

**Files:**
- Create: `src/components/generate/WorkerStatusCard.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/generate/WorkerStatusCard.tsx
import type { GenerateWorkerStatus } from "../../lib/api";

interface WorkerStatusCardProps {
  status: GenerateWorkerStatus;
}

export function WorkerStatusCard({ status }: WorkerStatusCardProps) {
  return (
    <div className="worker-status-card">
      <span className={status.state === "warm" ? "status-pill running" : "status-pill pending"}>
        {status.state === "warm" ? "Worker Warm" : "Worker Cold"}
      </span>
      <span className="panel-muted">
        {status.state === "warm"
          ? `Idle unload in ${status.idle_seconds_remaining ?? status.idle_timeout_seconds}s`
          : "Next run will cold-start the model"}
      </span>
      {status.state === "warm" && status.model_path ? (
        <span className="panel-muted">
          {status.lora_count > 0
            ? `${status.lora_count} LoRA${status.lora_count === 1 ? "" : "s"} loaded`
            : "Base model only"}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/components/generate/WorkerStatusCard.tsx
git commit -m "feat: add WorkerStatusCard component"
```

---

## Task 5: Create LoraCard

**Files:**
- Create: `src/components/generate/LoraCard.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/generate/LoraCard.tsx
import type { GenerateLoraSpec } from "../../lib/api";

interface LoraCardProps {
  lora: GenerateLoraSpec;
  index: number;
  onUpdate: (lora: GenerateLoraSpec) => void;
  onRemove: () => void;
}

export function LoraCard({ lora, index, onUpdate, onRemove }: LoraCardProps) {
  return (
    <div className="lora-card">
      <button
        className="lora-delete"
        type="button"
        aria-label={`Remove LoRA ${index + 1}`}
        onClick={onRemove}
      >
        ×
      </button>
      <label>
        <span>LoRA Path</span>
        <input
          value={lora.path}
          onChange={(e) => onUpdate({ ...lora, path: e.target.value })}
          placeholder="/path/to/lora.safetensors"
        />
      </label>
      <label>
        <span>Strength</span>
        <input
          type="number"
          min={0}
          max={2}
          step="0.05"
          value={lora.strength}
          onChange={(e) =>
            onUpdate({ ...lora, strength: Math.max(0, Math.min(2, Number(e.target.value))) })
          }
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/components/generate/LoraCard.tsx
git commit -m "feat: add LoraCard component"
```

---

## Task 6: Create LoraStack

**Files:**
- Create: `src/components/generate/LoraStack.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/generate/LoraStack.tsx
import type { GenerateLoraSpec } from "../../lib/api";
import { LoraCard } from "./LoraCard";

interface LoraStackProps {
  loras: GenerateLoraSpec[];
  onChange: (loras: GenerateLoraSpec[]) => void;
}

export function LoraStack({ loras, onChange }: LoraStackProps) {
  function add() {
    onChange([...loras, { path: "", strength: 1.0 }]);
  }

  function update(index: number, lora: GenerateLoraSpec) {
    onChange(loras.map((l, i) => (i === index ? lora : l)));
  }

  function remove(index: number) {
    onChange(loras.filter((_, i) => i !== index));
  }

  return (
    <div className="page-stack">
      <div className="section-inline-header">
        <span className="eyebrow no-margin">LoRAs</span>
        <button className="secondary-button" type="button" onClick={add}>
          Add LoRA
        </button>
      </div>
      {loras.length > 0 ? (
        <div className="lora-stack">
          {loras.map((lora, i) => (
            <LoraCard
              key={i}
              lora={lora}
              index={i}
              onUpdate={(next) => update(i, next)}
              onRemove={() => remove(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/components/generate/LoraStack.tsx
git commit -m "feat: add LoraStack component"
```

---

## Task 7: Create ConfigSaveRow

**Files:**
- Create: `src/components/generate/ConfigSaveRow.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/generate/ConfigSaveRow.tsx
interface ConfigOption {
  id: number;
  name: string;
}

interface ConfigSaveRowProps {
  name: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  isSaving: boolean;
  configs: ConfigOption[];
  onLoad: (id: number) => void;
  feedback: "idle" | "saved" | "error";
  namePlaceholder?: string;
}

export function ConfigSaveRow({
  name,
  onNameChange,
  onSave,
  isSaving,
  configs,
  onLoad,
  feedback,
  namePlaceholder = "Config name",
}: ConfigSaveRowProps) {
  return (
    <div className="page-stack">
      <div className="generate-config-row">
        <label className="generate-config-name">
          <span>Config Name</span>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={namePlaceholder}
          />
        </label>
        <button
          className="secondary-button"
          type="button"
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
      <label>
        <span>Load Config</span>
        <select
          defaultValue=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onLoad(id);
          }}
        >
          <option value="">Select saved config</option>
          {configs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {feedback === "saved" ? <div className="save-feedback success">Saved</div> : null}
      {feedback === "error" ? <div className="save-feedback error">Save failed</div> : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/components/generate/ConfigSaveRow.tsx
git commit -m "feat: add ConfigSaveRow component"
```

---

## Task 8: Create GenerationProgress

**Files:**
- Create: `src/components/generate/GenerationProgress.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/generate/GenerationProgress.tsx
interface GenerationProgressProps {
  status: "pending" | "running" | "completed" | "failed";
  currentStep: number;
  totalSteps: number;
  rateValue: number | null;
  rateUnit: string | null;
  stage?: string | null;
  width?: number | null;
  height?: number | null;
}

export function GenerationProgress({
  status,
  currentStep,
  totalSteps,
  rateValue,
  rateUnit,
  stage,
  width,
  height,
}: GenerationProgressProps) {
  const pct = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;

  return (
    <div className="generation-status">
      <div className="generation-status-header">
        <span className={`status-pill ${status === "running" ? "running" : "pending"}`}>
          {status}
        </span>
        <span className="panel-muted">
          Step {currentStep} / {totalSteps}
        </span>
      </div>
      <div className="meter">
        <div className="meter-fill accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="job-stats-inline">
        <span>
          {rateValue !== null && rateUnit
            ? `${rateValue.toFixed(2)} ${rateUnit}`
            : stage ?? "Starting..."}
        </span>
        {width && height ? <span>{width} × {height}</span> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/components/generate/GenerationProgress.tsx
git commit -m "feat: add GenerationProgress component"
```

---

## Task 9: Extract PromptEnhanceSettingsModal

**Files:**
- Create: `src/components/generate/PromptEnhanceSettingsModal.tsx`

- [ ] **Step 1: Create the file (copy from GeneratePage, no logic changes)**

```tsx
// src/components/generate/PromptEnhanceSettingsModal.tsx
import { useState } from "react";
import type { PromptEnhanceSettings } from "../../lib/api";

interface PromptEnhanceSettingsModalProps {
  initialSettings: PromptEnhanceSettings;
  onClose: () => void;
  onSave: (settings: PromptEnhanceSettings) => void;
}

export function PromptEnhanceSettingsModal({
  initialSettings,
  onClose,
  onSave,
}: PromptEnhanceSettingsModalProps) {
  const [form, setForm] = useState<PromptEnhanceSettings>(initialSettings);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="eyebrow">Prompt Enhance</span>
          <h3>Settings</h3>
        </div>
        <div className="modal-field">
          <label className="modal-label">Llama.cpp Server URL</label>
          <input
            value={form.llama_url}
            onChange={(e) => setForm({ ...form, llama_url: e.target.value })}
            placeholder="http://localhost:8080"
          />
        </div>
        <div className="modal-field">
          <label className="modal-label">Model Name</label>
          <input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="Leave blank to omit"
          />
          <span className="modal-hint">Only needed if your server requires a specific model name.</span>
        </div>
        <div className="modal-field">
          <label className="modal-label">System Prompt</label>
          <textarea
            className="modal-textarea"
            rows={5}
            value={form.system_prompt}
            onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
          />
        </div>
        <div className="modal-field">
          <label className="modal-label">Max Tokens</label>
          <input
            type="number"
            min={64}
            max={4096}
            value={form.max_tokens}
            onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })}
          />
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="button" onClick={() => onSave(form)}>Save</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors. (File not yet imported — that's fine.)

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/components/generate/PromptEnhanceSettingsModal.tsx
git commit -m "feat: extract PromptEnhanceSettingsModal to own file"
```

---

## Task 10: Create SdxlResultCard

**Files:**
- Create: `src/components/generate/SdxlResultCard.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/generate/SdxlResultCard.tsx
import type { GenerateImageResponse } from "../../lib/api";
import { GenerationProgress } from "./GenerationProgress";

interface SdxlResultCardProps {
  result: GenerateImageResponse | null;
  isGenerating: boolean;
  saveOutput: boolean;
  onToggleSave: (value: boolean) => void;
}

export function SdxlResultCard({ result, isGenerating, saveOutput, onToggleSave }: SdxlResultCardProps) {
  const isActive = result && (result.status === "pending" || result.status === "running");
  const isDone = result?.status === "completed";
  const isFailed = result?.status === "failed";

  return (
    <div className="pipeline-step-card">
      <div className="pipeline-step-header">
        <div className="pipeline-step-dot" style={{ background: "#a78bfa" }} />
        <span className="pipeline-step-name">SDXL Generate</span>
        {isGenerating ? (
          <span className="status-pill running">running</span>
        ) : isDone ? (
          <span className="status-pill completed">done</span>
        ) : isFailed ? (
          <span className="status-pill failed">failed</span>
        ) : (
          <span className="status-pill pending">idle</span>
        )}
      </div>

      <div className="pipeline-step-body">
        {isActive && result ? (
          <GenerationProgress
            status={result.status}
            currentStep={result.current_step}
            totalSteps={result.total_steps}
            rateValue={result.rate_value}
            rateUnit={result.rate_unit}
            width={result.width}
            height={result.height}
          />
        ) : null}

        {isDone && result?.image_url ? (
          <div className="pipeline-step-image-wrap">
            <img src={result.image_url} alt={result.positive_prompt} />
          </div>
        ) : isFailed ? (
          <div className="error-banner">{result?.error ?? "Generation failed."}</div>
        ) : !isGenerating ? (
          <div className="empty-state">No output yet — click Generate.</div>
        ) : null}

        {isDone && result ? (
          <div className="generate-meta">
            <div className="job-stats-inline">
              <span>{result.width} × {result.height}</span>
              <span>{result.steps} steps</span>
              <span>CFG {result.cfg_scale}</span>
              {result.seed !== null ? <span>Seed {result.seed}</span> : null}
            </div>
            <div className="caption-panel">
              <div className="caption-panel-header">
                <span className="eyebrow">Prompt Used</span>
              </div>
              <div>{result.positive_prompt}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="pipeline-step-footer">
        <div className="step-toggle-group">
          <span className="step-toggle-label">Save Output</span>
          <button
            type="button"
            className={`toggle-card${saveOutput ? " checked" : ""}`}
            style={{ padding: "0 4px", border: "none", background: "transparent", cursor: "pointer" }}
            onClick={() => onToggleSave(!saveOutput)}
            title={saveOutput ? "Output will be saved" : "Output will not be saved"}
          >
            <div className="toggle-switch" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/components/generate/SdxlResultCard.tsx
git commit -m "feat: add SdxlResultCard pipeline step component"
```

---

## Task 11: Create PipelineStepCard

**Files:**
- Create: `src/components/generate/PipelineStepCard.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/generate/PipelineStepCard.tsx
import { useState } from "react";
import type { PipelineStep } from "../../lib/pipeline";
import { GenerationProgress } from "./GenerationProgress";
import { LoraStack } from "./LoraStack";

interface PipelineStepCardProps {
  step: PipelineStep;
  index: number;
  canRun: boolean;
  onUpdate: (updates: Partial<PipelineStep>) => void;
  onRemove: () => void;
  onRun: () => void;
}

const STEP_COLORS: Record<PipelineStep["type"], string> = {
  image_edit: "#38bdf8",
};

const STEP_LABELS: Record<PipelineStep["type"], string> = {
  image_edit: "Image Edit",
};

export function PipelineStepCard({ step, index, canRun, onUpdate, onRemove, onRun }: PipelineStepCardProps) {
  const [configOpen, setConfigOpen] = useState(true);

  const isActive = step.result && (step.result.status === "pending" || step.result.status === "running");
  const isDone = step.result?.status === "completed";
  const isFailed = step.result?.status === "failed";

  function updateConfig(next: Partial<PipelineStep["config"]>) {
    onUpdate({ config: { ...step.config, ...next } });
  }

  return (
    <div className="pipeline-step-card">
      <div className="pipeline-step-header">
        <div className="pipeline-step-dot" style={{ background: STEP_COLORS[step.type] }} />
        <span className="pipeline-step-name">
          Step {index} · {STEP_LABELS[step.type]}
        </span>
        {step.is_running ? (
          <span className="status-pill running">running</span>
        ) : isDone ? (
          <span className="status-pill completed">done</span>
        ) : isFailed ? (
          <span className="status-pill failed">failed</span>
        ) : (
          <span className="status-pill pending">idle</span>
        )}
        <button className="step-remove-btn" type="button" aria-label="Remove step" onClick={onRemove}>
          ×
        </button>
      </div>

      <div className="pipeline-step-body">
        {isActive && step.result ? (
          <GenerationProgress
            status={step.result.status}
            currentStep={step.result.current_step}
            totalSteps={step.result.total_steps}
            rateValue={step.result.rate_value}
            rateUnit={step.result.rate_unit}
            stage={step.result.stage}
            width={step.result.width}
            height={step.result.height}
          />
        ) : null}

        {isDone && step.result?.image_url ? (
          <div className="pipeline-step-image-wrap">
            <img src={step.result.image_url} alt={step.config.prompt} />
          </div>
        ) : isFailed ? (
          <div className="error-banner">{step.error ?? "Step failed."}</div>
        ) : null}

        {/* Collapsible config */}
        <div className="section-card" style={{ margin: 0 }}>
          <div className="collapsible-header" onClick={() => setConfigOpen((o) => !o)}>
            <span className="collapsible-title">Config</span>
            <span className={`collapsible-chevron${configOpen ? " open" : ""}`}>▼</span>
          </div>
          {configOpen ? (
            <div className="collapsible-body">
              <label>
                <span>Prompt</span>
                <textarea
                  rows={4}
                  value={step.config.prompt}
                  onChange={(e) => updateConfig({ prompt: e.target.value })}
                  placeholder="Describe how to edit the image..."
                />
              </label>
              <label>
                <span>Steps</span>
                <input
                  type="number"
                  min={1}
                  value={step.config.steps}
                  onChange={(e) => updateConfig({ steps: Number(e.target.value) })}
                />
              </label>
              <label>
                <span>Additional Image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => updateConfig({ extra_image: e.target.files?.[0] ?? null })}
                />
              </label>
              <LoraStack
                loras={step.config.loras}
                onChange={(loras) => updateConfig({ loras })}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="pipeline-step-footer">
        <div className="step-toggle-group">
          <span className="step-toggle-label">Auto</span>
          <button
            type="button"
            className={`toggle-card${step.auto_run ? " checked" : ""}`}
            style={{ padding: "0 4px", border: "none", background: "transparent", cursor: "pointer" }}
            onClick={() => onUpdate({ auto_run: !step.auto_run })}
            title={step.auto_run ? "Will run automatically" : "Manual trigger only"}
          >
            <div className="toggle-switch" />
          </button>
        </div>
        <div className="step-toggle-group">
          <span className="step-toggle-label">Save</span>
          <button
            type="button"
            className={`toggle-card${step.save_output ? " checked" : ""}`}
            style={{ padding: "0 4px", border: "none", background: "transparent", cursor: "pointer" }}
            onClick={() => onUpdate({ save_output: !step.save_output })}
            title={step.save_output ? "Output will be saved" : "Output is ephemeral"}
          >
            <div className="toggle-switch" />
          </button>
        </div>
        <div className="step-footer-spacer" />
        <button
          className="primary-button"
          type="button"
          onClick={onRun}
          disabled={!canRun || step.is_running}
        >
          {step.is_running ? "Running..." : "Run Step"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/components/generate/PipelineStepCard.tsx
git commit -m "feat: add PipelineStepCard component"
```

---

## Task 12: Rewrite GeneratePage as orchestrator

**Files:**
- Modify: `src/pages/GeneratePage.tsx` (full rewrite)

- [ ] **Step 1: Replace the entire file**

```tsx
// src/pages/GeneratePage.tsx
import { useEffect, useState } from "react";

import {
  ApiError,
  api,
  type GenerateConfig,
  type GenerateConfigSummary,
  type GenerateImageRequest,
  type GenerateWorkerStatus,
  type PromptEnhanceSettings,
} from "../lib/api";
import { type PipelineStep, makeStep } from "../lib/pipeline";
import { CollapsibleSection } from "../components/generate/CollapsibleSection";
import { ConfigSaveRow } from "../components/generate/ConfigSaveRow";
import { GenerationProgress } from "../components/generate/GenerationProgress";
import { LoraStack } from "../components/generate/LoraStack";
import { PipelineStepCard } from "../components/generate/PipelineStepCard";
import { PromptEnhanceSettingsModal } from "../components/generate/PromptEnhanceSettingsModal";
import { SdxlResultCard } from "../components/generate/SdxlResultCard";
import { WorkerStatusCard } from "../components/generate/WorkerStatusCard";

const CANVAS_PRESETS = [
  { id: "manual", label: "Manual", width: null, height: null },
  { id: "720p-landscape", label: "720p Landscape · 16:9", width: 1280, height: 720 },
  { id: "720p-portrait", label: "720p Portrait · 9:16", width: 720, height: 1280 },
  { id: "1080p-landscape", label: "1080p Landscape · 16:9", width: 1920, height: 1080 },
  { id: "1080p-portrait", label: "1080p Portrait · 9:16", width: 1080, height: 1920 },
  { id: "1024-square", label: "1024 Square · 1:1", width: 1024, height: 1024 },
  { id: "1152-landscape", label: "1152 Wide · 3:2", width: 1152, height: 768 },
  { id: "1152-portrait", label: "1152 Portrait · 2:3", width: 768, height: 1152 },
  { id: "1536-landscape", label: "1536 Cinematic · 16:10", width: 1536, height: 960 },
  { id: "1536-portrait", label: "1536 Portrait · 10:16", width: 960, height: 1536 },
  { id: "1344-landscape", label: "1344 Wide · 21:9", width: 1344, height: 576 },
  { id: "1344-portrait", label: "1344 Tall · 9:21", width: 576, height: 1344 },
];

const PROMPT_ENHANCE_SETTINGS_KEY = "latenttrainer_prompt_enhance_settings";

const initialForm: GenerateImageRequest = {
  loras: [],
  model_path: "",
  positive_prompt: "",
  negative_prompt: "",
  prompt_enhance: false,
  prompt_enhance_settings: {
    llama_url: "http://localhost:8080",
    model: "",
    system_prompt:
      "Enhance the user's SDXL image prompt for better image generation quality. Return only the improved prompt with no explanation.",
    max_tokens: 512,
  },
  steps: 30,
  cfg_scale: 7,
  width: 1024,
  height: 1024,
  seed: null,
};

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function detectCanvasPreset(width: number, height: number) {
  return CANVAS_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? "manual";
}

export function GeneratePage() {
  // Generate form state
  const [form, setForm] = useState<GenerateImageRequest>(initialForm);
  const [configName, setConfigName] = useState("");
  const [savedConfigs, setSavedConfigs] = useState<GenerateConfigSummary[]>([]);
  const [canvasPreset, setCanvasPreset] = useState("manual");
  const [saveFeedback, setSaveFeedback] = useState<"idle" | "saved" | "error">("idle");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SDXL result state
  const [result, setResult] = useState<import("../lib/api").GenerateImageResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [sdxlSaveOutput, setSdxlSaveOutput] = useState(true);

  // Worker
  const [workerStatus, setWorkerStatus] = useState<GenerateWorkerStatus | null>(null);

  // Pipeline steps
  const [steps, setSteps] = useState<PipelineStep[]>([]);

  const adjustedWidth = roundToMultiple(form.width, 64);
  const adjustedHeight = roundToMultiple(form.height, 64);
  const isRounded = adjustedWidth !== form.width || adjustedHeight !== form.height;

  // ── Load saved prompt enhance settings ──────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PROMPT_ENHANCE_SETTINGS_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as Partial<PromptEnhanceSettings>;
      setForm((cur) => ({ ...cur, prompt_enhance_settings: { ...cur.prompt_enhance_settings, ...parsed } }));
    } catch {
      // ignore
    }
  }, []);

  // ── Load configs ─────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        setSavedConfigs(await api.getGenerateConfigs());
      } catch (e) {
        console.error(e);
      }
    }
    void load();
  }, []);

  // ── Worker status polling ─────────────────────────────────────────
  useEffect(() => {
    async function poll() {
      try { setWorkerStatus(await api.getGenerateWorkerStatus()); } catch { /* ignore */ }
    }
    void poll();
    const id = window.setInterval(() => void poll(), 5000);
    return () => window.clearInterval(id);
  }, []);

  // ── Save feedback auto-clear ──────────────────────────────────────
  useEffect(() => {
    if (saveFeedback !== "saved") return;
    const id = window.setTimeout(() => setSaveFeedback("idle"), 2500);
    return () => window.clearTimeout(id);
  }, [saveFeedback]);

  // ── Poll SDXL result ──────────────────────────────────────────────
  useEffect(() => {
    if (!result || (result.status !== "pending" && result.status !== "running")) return;
    const id = window.setInterval(async () => {
      try {
        const next = await api.getGeneration(result.generation_id);
        setResult(next);
        if (next.status === "completed") setIsGenerating(false);
        if (next.status === "failed") { setIsGenerating(false); setError(next.error ?? "Generation failed."); }
      } catch (e) { console.error(e); }
    }, 1000);
    return () => window.clearInterval(id);
  }, [result]);

  // ── Poll running pipeline steps ───────────────────────────────────
  const pollingStep = steps.find((s) => s.result && (s.result.status === "pending" || s.result.status === "running")) ?? null;
  useEffect(() => {
    if (!pollingStep?.result) return;
    const { function_run_id } = pollingStep.result;
    const stepId = pollingStep.id;
    const id = window.setInterval(async () => {
      try {
        const next = await api.getImageEditFunctionRun(function_run_id);
        setSteps((cur) =>
          cur.map((s) =>
            s.id === stepId
              ? { ...s, result: next, is_running: next.status === "pending" || next.status === "running", error: next.status === "failed" ? (next.error ?? "Failed") : s.error }
              : s,
          ),
        );
      } catch (e) { console.error(e); }
    }, 1000);
    return () => window.clearInterval(id);
  }, [pollingStep?.result?.function_run_id]);

  // ── Auto-run next step when a step completes ──────────────────────
  const stepStatusKey = steps.map((s) => `${s.id}:${s.result?.status ?? "idle"}:${s.is_running}`).join("|");
  useEffect(() => {
    steps.forEach((step, index) => {
      if (step.result?.status !== "completed") return;
      const next = steps[index + 1];
      if (!next || !next.auto_run || next.is_running || next.result != null) return;
      void runStep(next.id, index + 1);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepStatusKey, result?.status]);

  // ── Also auto-run first step after SDXL completes ────────────────
  useEffect(() => {
    if (result?.status !== "completed") return;
    const first = steps[0];
    if (!first || !first.auto_run || first.is_running || first.result != null) return;
    void runStep(first.id, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.status]);

  // ── Helpers ───────────────────────────────────────────────────────
  function updateForm(next: GenerateImageRequest | ((cur: GenerateImageRequest) => GenerateImageRequest)) {
    setSaveFeedback("idle");
    setForm(next);
  }

  function updateStep(id: string, updates: Partial<PipelineStep>) {
    setSteps((cur) => cur.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }

  function getSourceGenerationId(stepIndex: number): string | null {
    if (stepIndex === 0) return result?.generation_id ?? null;
    return steps[stepIndex - 1]?.result?.generation_id ?? null;
  }

  function getSourceDimensions(stepIndex: number): { width: number; height: number } {
    if (stepIndex === 0) return { width: result?.width ?? form.width, height: result?.height ?? form.height };
    const prev = steps[stepIndex - 1]?.result;
    return { width: prev?.width ?? form.width, height: prev?.height ?? form.height };
  }

  // ── Actions ───────────────────────────────────────────────────────
  async function handleGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsGenerating(true);
    setError(null);
    setResult(null);
    setSteps((cur) => cur.map((s) => ({ ...s, result: null, error: null, is_running: false })));
    try {
      const response = await api.generateImage(form);
      setResult(response);
      setWorkerStatus(await api.getGenerateWorkerStatus());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Generation failed. Check the model path and backend logs.");
      setIsGenerating(false);
    }
  }

  async function handleLoadConfig(id: number) {
    try {
      const config = await api.getGenerateConfig(id);
      applyConfig(config);
    } catch (e) {
      console.error(e);
      setError("Failed to load config.");
    }
  }

  function applyConfig(config: GenerateConfig) {
    setForm({
      loras: config.loras,
      model_path: config.model_path,
      positive_prompt: config.positive_prompt,
      negative_prompt: config.negative_prompt,
      prompt_enhance: config.prompt_enhance,
      prompt_enhance_settings: config.prompt_enhance_settings,
      steps: config.steps,
      cfg_scale: config.cfg_scale,
      width: config.width,
      height: config.height,
      seed: config.seed,
    });
    setConfigName(config.name);
    setCanvasPreset(detectCanvasPreset(config.width, config.height));
    setSaveFeedback("idle");
  }

  async function handleSaveConfig() {
    if (!configName.trim()) { setError("Config name is required."); setSaveFeedback("error"); return; }
    setIsSavingConfig(true);
    try {
      await api.saveGenerateConfig({ name: configName.trim(), ...form });
      setSavedConfigs(await api.getGenerateConfigs());
      setSaveFeedback("saved");
      setError(null);
    } catch (e) {
      console.error(e);
      setError("Failed to save config.");
      setSaveFeedback("error");
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function runStep(stepId: string, stepIndex: number) {
    const step = steps.find((s) => s.id === stepId);
    const sourceGenId = getSourceGenerationId(stepIndex);
    if (!step || !sourceGenId) return;

    const { width, height } = getSourceDimensions(stepIndex);
    updateStep(stepId, { is_running: true, error: null });

    try {
      const response = await api.runImageEditFunction({
        source_generation_id: sourceGenId,
        prompt: step.config.prompt,
        width,
        height,
        steps: step.config.steps,
        loras: step.config.loras,
        extra_image: step.config.extra_image,
      });
      updateStep(stepId, { result: response });
    } catch (e) {
      updateStep(stepId, {
        is_running: false,
        error: e instanceof ApiError ? e.message : "Step failed.",
      });
    }
  }

  function handleCanvasPresetChange(presetId: string) {
    setCanvasPreset(presetId);
    const preset = CANVAS_PRESETS.find((p) => p.id === presetId);
    if (!preset || preset.width === null || preset.height === null) return;
    updateForm((cur) => ({ ...cur, width: preset.width ?? cur.width, height: preset.height ?? cur.height }));
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="split-page generate-page">
      {/* Left rail */}
      <div className="generate-rail">
        <form className="generate-rail-form" onSubmit={handleGenerate}>
          <ConfigSaveRow
            name={configName}
            onNameChange={(n) => { setConfigName(n); setSaveFeedback("idle"); }}
            onSave={() => void handleSaveConfig()}
            isSaving={isSavingConfig}
            configs={savedConfigs}
            onLoad={(id) => void handleLoadConfig(id)}
            feedback={saveFeedback}
            namePlaceholder="My Portrait Setup"
          />

          {workerStatus ? <WorkerStatusCard status={workerStatus} /> : null}

          <CollapsibleSection title="Model & LoRAs">
            <label>
              <span>Model Path</span>
              <input
                value={form.model_path}
                onChange={(e) => updateForm({ ...form, model_path: e.target.value })}
                placeholder="/path/to/model.safetensors"
              />
            </label>
            <LoraStack
              loras={form.loras}
              onChange={(loras) => updateForm({ ...form, loras })}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Canvas">
            <label>
              <span>Preset</span>
              <select value={canvasPreset} onChange={(e) => handleCanvasPresetChange(e.target.value)}>
                {CANVAS_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <div className="generate-grid">
              <label>
                <span>Width</span>
                <input type="number" min={64} step={8} value={form.width} disabled={canvasPreset !== "manual"}
                  onChange={(e) => updateForm({ ...form, width: Number(e.target.value) })} />
              </label>
              <label>
                <span>Height</span>
                <input type="number" min={64} step={8} value={form.height} disabled={canvasPreset !== "manual"}
                  onChange={(e) => updateForm({ ...form, height: Number(e.target.value) })} />
              </label>
            </div>
            <p className="panel-muted">
              Output: {adjustedWidth} × {adjustedHeight}
              {isRounded ? " (rounded to ×64)" : ""}
            </p>
          </CollapsibleSection>

          <CollapsibleSection title="Parameters">
            <div className="generate-grid">
              <label>
                <span>Steps</span>
                <input type="number" min={1} value={form.steps}
                  onChange={(e) => updateForm({ ...form, steps: Number(e.target.value) })} />
              </label>
              <label>
                <span>CFG</span>
                <input type="number" min={1} step="0.5" value={form.cfg_scale}
                  onChange={(e) => updateForm({ ...form, cfg_scale: Number(e.target.value) })} />
              </label>
              <label className="generate-grid-span">
                <span>Seed</span>
                <input type="number" value={form.seed ?? ""} placeholder="random"
                  onChange={(e) => updateForm({ ...form, seed: e.target.value === "" ? null : Number(e.target.value) })} />
              </label>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Prompts">
            <label>
              <span>Positive Prompt</span>
              <textarea rows={6} value={form.positive_prompt} placeholder="Describe what you want to generate..."
                onChange={(e) => updateForm({ ...form, positive_prompt: e.target.value })} />
            </label>
            <div className="section-inline-header">
              <label className="modal-toggle-row">
                <span className="modal-label" style={{ marginBottom: 0 }}>Prompt Enhance</span>
                <input type="checkbox" checked={form.prompt_enhance}
                  onChange={(e) => updateForm((cur) => ({ ...cur, prompt_enhance: e.target.checked }))} />
              </label>
              <button className="secondary-button icon-button" type="button" title="Prompt enhance settings"
                onClick={() => setShowPromptSettings(true)}>⚙</button>
            </div>
            <label>
              <span>Negative Prompt</span>
              <textarea rows={4} value={form.negative_prompt} placeholder="Things to avoid..."
                onChange={(e) => updateForm({ ...form, negative_prompt: e.target.value })} />
            </label>
          </CollapsibleSection>

          {error ? <div className="error-banner">{error}</div> : null}

          <button className="primary-button" type="submit" disabled={isGenerating}>
            {isGenerating ? "Generating..." : "Generate"}
          </button>
        </form>
      </div>

      {/* Right panel — pipeline */}
      <div className="main-panel generate-pipeline">
        <SdxlResultCard
          result={result}
          isGenerating={isGenerating}
          saveOutput={sdxlSaveOutput}
          onToggleSave={setSdxlSaveOutput}
        />

        {steps.map((step, index) => (
          <div key={step.id}>
            <div className="pipeline-connector">
              <div className="pipeline-connector-line" />
              <span className="pipeline-connector-arrow">↓</span>
              <div className="pipeline-connector-line" />
            </div>
            <PipelineStepCard
              step={step}
              index={index + 1}
              canRun={getSourceGenerationId(index) !== null}
              onUpdate={(updates) => updateStep(step.id, updates)}
              onRemove={() => setSteps((cur) => cur.filter((s) => s.id !== step.id))}
              onRun={() => void runStep(step.id, index)}
            />
          </div>
        ))}

        <div className="pipeline-connector">
          <div className="pipeline-connector-line" />
        </div>
        <button
          className="pipeline-add-btn"
          type="button"
          onClick={() => setSteps((cur) => [...cur, makeStep()])}
        >
          ＋ Add Step
        </button>
      </div>

      {showPromptSettings ? (
        <PromptEnhanceSettingsModal
          initialSettings={form.prompt_enhance_settings}
          onClose={() => setShowPromptSettings(false)}
          onSave={(settings) => {
            localStorage.setItem(PROMPT_ENHANCE_SETTINGS_KEY, JSON.stringify(settings));
            updateForm((cur) => ({ ...cur, prompt_enhance_settings: settings }));
            setShowPromptSettings(false);
          }}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer/frontend && npm run build
```

Expected: `✓ built in` with no errors and no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
cd /mnt/machine_learning/Coding/python/WebInterface/LatentTrainer
git add frontend/src/pages/GeneratePage.tsx frontend/src/components/generate/
git commit -m "feat: rewrite GeneratePage with pipeline UI and modular components"
```

---

## Self-Review Notes

- **Spec coverage:** All spec requirements covered — collapsible sections ✓, eight extracted components ✓, pipeline step cards with auto-run/save toggles ✓, SDXL card ✓, PipelineStepCard with removable steps ✓, Add Step button ✓, polling ✓, auto-run chain ✓
- **Types consistent:** `PipelineStep` defined in `pipeline.ts`, referenced correctly in `PipelineStepCard`, `GeneratePage`. `makeStep()` used in GeneratePage's add handler. `getSourceGenerationId` uses `steps[index-1].result?.generation_id` which matches `ImageEditResponse.generation_id` from `api.ts`
- **Save Output:** Wired as UI state, no backend change (as specified — out of scope)
- **Old function config section:** Removed — superseded by the new pipeline card pattern. The saved function configs API still exists but is no longer used in this UI; it can be removed in a future cleanup pass
