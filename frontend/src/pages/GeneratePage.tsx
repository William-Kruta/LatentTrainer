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
  batch_count: 1,
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

  // Caption overlay
  const [captionStyle, setCaptionStyle] = useState<"none" | "snapchat">("none");
  const [captionText, setCaptionText] = useState("");
  const [captionTop, setCaptionTop] = useState(22);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setForm((cur) => ({
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
      batch_count: cur.batch_count,
    }));
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
              <label>
                <span>Batch</span>
                <input type="number" min={1} max={16} value={form.batch_count}
                  onChange={(e) => updateForm({ ...form, batch_count: Math.max(1, Math.min(16, Number(e.target.value))) })} />
              </label>
              <label className="generate-grid-span">
                <span>Seed</span>
                <input type="number" value={form.seed ?? ""} placeholder="random"
                  onChange={(e) => updateForm({ ...form, seed: e.target.value === "" ? null : Number(e.target.value) })} />
              </label>
            </div>
            <label>
              <span>Caption Style</span>
              <select value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value as "none" | "snapchat")}>
                <option value="none">None</option>
                <option value="snapchat">Snapchat</option>
              </select>
            </label>
            {captionStyle === "snapchat" ? (
              <>
                <label>
                  <span>Caption Text</span>
                  <input
                    value={captionText}
                    onChange={(e) => setCaptionText(e.target.value)}
                    placeholder="Enter caption..."
                  />
                </label>
                <div className="caption-position-row">
                  <span className="caption-position-label">Position</span>
                  <input
                    type="range"
                    className="caption-position-slider"
                    min={0}
                    max={90}
                    value={captionTop}
                    onChange={(e) => setCaptionTop(Number(e.target.value))}
                  />
                  <span className="caption-position-value">{captionTop}%</span>
                </div>
                <div
                  className="caption-preview"
                  style={{ aspectRatio: `${adjustedWidth} / ${adjustedHeight}` }}
                >
                  <div
                    className="caption-snapchat"
                    style={{ top: `${captionTop}%` }}
                  >
                    {captionText || "Caption preview"}
                  </div>
                </div>
              </>
            ) : null}
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
          captionStyle={captionStyle}
          captionText={captionText}
          captionTop={captionTop}
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
