import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  api,
  type GenerateConfig,
  type GenerateConfigSummary,
  type GenerateImageRequest,
  type ImageEditImport,
  type Job,
  type PromptEnhanceSettings,
} from "../lib/api";
import { type PipelineStep, makeStep } from "../lib/pipeline";
import { useToast } from "../components/Toast";
import { ConfigSaveRow } from "../components/generate/ConfigSaveRow";
import { ImageEditPanel } from "../components/generate/ImageEditPanel";
import { LoraStack } from "../components/generate/LoraStack";
import { PathCombobox } from "../components/generate/PathCombobox";
import { PipelineStepCard } from "../components/generate/PipelineStepCard";
import { PromptEnhanceSettingsModal } from "../components/generate/PromptEnhanceSettingsModal";
import { SdxlResultCard } from "../components/generate/SdxlResultCard";
import { WorkerStatusCard } from "../components/generate/WorkerStatusCard";
import { GalleryViewer } from "../components/gallery/GalleryViewer";
import { VideoPanel } from "../components/generate/VideoPanel";
import { useGenerationState } from "../hooks/useGenerationState";
import { useWorkerStatus } from "../hooks/useWorkerStatus";

const PROMPT_HISTORY_KEY = "latenttrainer_prompt_history";
const MAX_PROMPT_HISTORY = 20;
const GENERATE_DRAFT_KEY = "latenttrainer_generate_draft_v1";
const MAX_RECENT_RUNS = 8;
const LORA_PRESETS_KEY = "latenttrainer_lora_presets";

interface LoraPreset {
  id: string;
  name: string;
  loras: Array<{ path: string; strength: number }>;
}

function loadPromptHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PROMPT_HISTORY_KEY) ?? "[]") as string[];
  } catch { return []; }
}

function pushPromptHistory(prompt: string) {
  if (!prompt.trim()) return;
  const existing = loadPromptHistory().filter((p) => p !== prompt);
  const next = [prompt, ...existing].slice(0, MAX_PROMPT_HISTORY);
  localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(next));
}

function deletePromptHistoryItem(prompt: string) {
  const next = loadPromptHistory().filter((p) => p !== prompt);
  localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(next));
}

function loadLoraPresets(): LoraPreset[] {
  try { return JSON.parse(localStorage.getItem(LORA_PRESETS_KEY) ?? "[]") as LoraPreset[]; }
  catch { return []; }
}

function saveLoraPreset(name: string, loras: Array<{ path: string; strength: number }>) {
  if (!name.trim()) return;
  const existing = loadLoraPresets().filter((p) => p.name !== name);
  const next: LoraPreset[] = [{ id: Date.now().toString(), name, loras }, ...existing];
  localStorage.setItem(LORA_PRESETS_KEY, JSON.stringify(next));
}

function deleteLoraPreset(id: string) {
  const next = loadLoraPresets().filter((p) => p.id !== id);
  localStorage.setItem(LORA_PRESETS_KEY, JSON.stringify(next));
}

type GenerateMode = "text2image" | "image-edit" | "video";

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

const SAMPLER_OPTIONS: { value: string; label: string }[] = [
  { value: "euler", label: "Euler" },
  { value: "euler_a", label: "Euler a" },
  { value: "dpm++_2m", label: "DPM++ 2M" },
  { value: "dpm++_2m_karras", label: "DPM++ 2M Karras" },
  { value: "dpm++_sde", label: "DPM++ SDE" },
  { value: "dpm++_sde_karras", label: "DPM++ SDE Karras" },
  { value: "ddim", label: "DDIM" },
  { value: "unipc", label: "UniPC" },
  { value: "heun", label: "Heun" },
  { value: "lms", label: "LMS" },
];

const SETTINGS_TABS = [
  { id: "model", label: "Model" },
  { id: "canvas", label: "Canvas" },
  { id: "parameters", label: "Parameters" },
  { id: "prompts", label: "Prompts" },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];
type ValidationTarget = SettingsTabId | "general";

type RecentRunRecord = {
  generation_id: string;
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  request: GenerateImageRequest;
  image_urls: string[];
  error: string | null;
  stage: string | null;
};

const initialForm: GenerateImageRequest = {
  architecture: "sdxl",
  loras: [],
  model_path: "",
  chroma_pipeline_repo: "",
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
  sampler: "euler",
  cpu_offload: false,
  sequential_cpu_offload: false,
  vae_tiling: false,
  vae_slicing: false,
};

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function detectCanvasPreset(width: number, height: number) {
  return CANVAS_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? "manual";
}

function upsertRecentRun(current: RecentRunRecord[], next: RecentRunRecord): RecentRunRecord[] {
  return [next, ...current.filter((run) => run.generation_id !== next.generation_id)].slice(0, MAX_RECENT_RUNS);
}

function formatRunTime(value: string) {
  return new Date(value).toLocaleString();
}

export function GeneratePage() {
  const toast = useToast();
  const t2iFormRef = useRef<HTMLFormElement>(null);
  const previousResultStatusRef = useRef<string | null>(null);
  const recentRunsRef = useRef<RecentRunRecord[]>([]);
  const submittedPayloadsRef = useRef<Record<string, GenerateImageRequest>>({});

  const [mode, setMode] = useState<GenerateMode>("text2image");
  const [imageEditImport, setImageEditImport] = useState<ImageEditImport | null>(null);
  const [imageEditInitialRefs, setImageEditInitialRefs] = useState<string[] | null>(null);

  // Generate form state
  const [form, setForm] = useState<GenerateImageRequest>(initialForm);
  const [configName, setConfigName] = useState("");
  const [savedConfigs, setSavedConfigs] = useState<GenerateConfigSummary[]>([]);
  const [canvasPreset, setCanvasPreset] = useState("manual");
  const [saveFeedback, setSaveFeedback] = useState<"idle" | "saved" | "error">("idle");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [showPromptSettings, setShowPromptSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isImportDragOver, setIsImportDragOver] = useState(false);

  const [sdxlSaveOutput, setSdxlSaveOutput] = useState(true);

  // Caption overlay
  const [captionStyle, setCaptionStyle] = useState<"none" | "snapchat">("none");
  const [captionText, setCaptionText] = useState("");
  const [captionTop, setCaptionTop] = useState(22);

  const [trainingJobToConfirm, setTrainingJobToConfirm] = useState<Job | null>(null);

  // Model combobox
  const [modelRoot, setModelRoot] = useState("");
  const [modelFiles, setModelFiles] = useState<string[]>([]);

  // Prompt history
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTabId>("model");
  const [recentRuns, setRecentRuns] = useState<RecentRunRecord[]>([]);
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);

  // LoRA presets
  const [loraPresets, setLoraPresets] = useState<LoraPreset[]>([]);
  const [loraPresetName, setLoraPresetName] = useState("");
  const [validationMessages, setValidationMessages] = useState<Array<{ target: ValidationTarget; message: string }>>([]);

  // Pipeline steps
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const { workerStatus, queueStatus, isUnloading, handleUnloadWorker, refreshWorkerStatus } = useWorkerStatus({ setError });
  const {
    result,
    isGenerating,
    isSubmittingGeneration,
    submitGeneration,
    cancelLatest,
    clearResult,
  } = useGenerationState({
    setError,
    onError: (message) => toast.error(message),
    refreshWorkerStatus,
  });

  const adjustedWidth = roundToMultiple(form.width, 64);
  const adjustedHeight = roundToMultiple(form.height, 64);
  const isRounded = adjustedWidth !== form.width || adjustedHeight !== form.height;

  // ── Load saved prompt enhance settings ──────────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GENERATE_DRAFT_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as {
        form?: GenerateImageRequest;
        configName?: string;
        canvasPreset?: string;
        captionStyle?: "none" | "snapchat";
        captionText?: string;
        captionTop?: number;
        activeSettingsTab?: SettingsTabId;
      };
      if (parsed.form) {
        setForm(parsed.form);
        setCanvasPreset(parsed.canvasPreset ?? detectCanvasPreset(parsed.form.width, parsed.form.height));
      }
      if (parsed.configName) setConfigName(parsed.configName);
      if (parsed.captionStyle) setCaptionStyle(parsed.captionStyle);
      if (parsed.captionText) setCaptionText(parsed.captionText);
      if (typeof parsed.captionTop === "number") setCaptionTop(parsed.captionTop);
      if (parsed.activeSettingsTab) setActiveSettingsTab(parsed.activeSettingsTab);
    } catch {
      // ignore invalid draft state
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      GENERATE_DRAFT_KEY,
      JSON.stringify({
        form,
        configName,
        canvasPreset,
        captionStyle,
        captionText,
        captionTop,
        activeSettingsTab,
      }),
    );
  }, [form, configName, canvasPreset, captionStyle, captionText, captionTop, activeSettingsTab]);

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

  // ── Load model files for combobox ────────────────────────────────
  useEffect(() => {
    api.getModelFiles().then((res) => {
      setModelRoot(res.model_root);
      setModelFiles(res.files);
    }).catch(() => {/* ignore */});
  }, []);

  // ── Load prompt history ───────────────────────────────────────────
  useEffect(() => {
    setPromptHistory(loadPromptHistory());
  }, []);

  // ── Load LoRA presets ─────────────────────────────────────────────
  useEffect(() => {
    setLoraPresets(loadLoraPresets());
  }, []);

  // ── Ctrl+Enter to generate ────────────────────────────────────────
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (mode !== "text2image") return;

      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        t2iFormRef.current?.requestSubmit();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveConfig();
        return;
      }

      if (e.altKey && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        setActiveSettingsTab(SETTINGS_TABS[Number(e.key) - 1].id);
        return;
      }

      if (e.altKey && e.key.toLowerCase() === "r") {
        e.preventDefault();
        const rerunnable = recentRunsRef.current.find((run) => run.status === "completed" || run.status === "failed");
        if (rerunnable) {
          void rerunRecentRun(rerunnable);
        }
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mode, recentRuns]);

  // ── Save feedback auto-clear ──────────────────────────────────────
  useEffect(() => {
    if (saveFeedback !== "saved") return;
    const id = window.setTimeout(() => setSaveFeedback("idle"), 2500);
    return () => window.clearTimeout(id);
  }, [saveFeedback]);

  useEffect(() => {
    if (!result) return;
    const nextRecord: RecentRunRecord = {
      generation_id: result.generation_id,
      status: result.status,
      created_at: recentRunsRef.current.find((run) => run.generation_id === result.generation_id)?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      request: submittedPayloadsRef.current[result.generation_id] ?? {
        architecture: result.architecture,
        loras: [],
        model_path: result.model_path,
        chroma_pipeline_repo: "",
        positive_prompt: result.positive_prompt,
        negative_prompt: result.negative_prompt,
        prompt_enhance: false,
        prompt_enhance_settings: form.prompt_enhance_settings,
        steps: result.steps,
        cfg_scale: result.cfg_scale,
        width: result.width,
        height: result.height,
        seed: result.seed,
        batch_count: result.batch_count,
        sampler: result.sampler,
      },
      image_urls: result.image_urls,
      error: result.error,
      stage: result.stage,
    };
    setRecentRuns((current) => {
      const next = upsertRecentRun(current, nextRecord);
      recentRunsRef.current = next;
      return next;
    });
  }, [result]);

  useEffect(() => {
    recentRunsRef.current = recentRuns;
  }, [recentRuns]);

  useEffect(() => {
    const previous = previousResultStatusRef.current;
    const next = result?.status ?? null;
    if (previous === next) return;

    if (previous && next === "completed") {
      toast.success("Generation completed.");
      setGalleryRefreshKey((k) => k + 1);
    } else if (previous && next === "failed") {
      toast.error(result?.error ?? "Generation failed.");
    } else if (!previous && next === "pending") {
      toast.info("Generation queued.");
    }

    previousResultStatusRef.current = next;
  }, [result, toast]);

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
    setValidationMessages([]);
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
  function validateGenerationForm(payload: GenerateImageRequest): Array<{ target: ValidationTarget; message: string }> {
    const issues: Array<{ target: ValidationTarget; message: string }> = [];
    if (!payload.model_path.trim()) issues.push({ target: "model", message: "Model path is required." });
    if (payload.architecture === "chroma" && !payload.chroma_pipeline_repo.trim()) {
      issues.push({ target: "model", message: "Chroma pipeline repo is required for Chroma runs." });
    }
    if (payload.loras.some((lora) => !lora.path.trim())) {
      issues.push({ target: "model", message: "Every LoRA entry needs a path or should be removed." });
    }
    if (!payload.positive_prompt.trim()) issues.push({ target: "prompts", message: "Positive prompt is required." });
    if (payload.steps < 1) issues.push({ target: "parameters", message: "Steps must be at least 1." });
    if (payload.cfg_scale < 1) issues.push({ target: "parameters", message: "CFG must be at least 1." });
    if (payload.batch_count < 1 || payload.batch_count > 16) issues.push({ target: "parameters", message: "Batch must be between 1 and 16." });
    if (payload.width < 64 || payload.height < 64) issues.push({ target: "canvas", message: "Width and height must be at least 64." });
    return issues;
  }

  function buildRequestFromRun(run: RecentRunRecord): GenerateImageRequest {
    return run.request;
  }

  function useRunSettings(run: RecentRunRecord) {
    updateForm(run.request);
    setCanvasPreset(detectCanvasPreset(run.request.width, run.request.height));
    toast.info(`Loaded settings from run ${run.generation_id.slice(0, 8)}.`);
  }

  async function rerunRecentRun(run: RecentRunRecord) {
    useRunSettings(run);
    clearResult();
    setSteps((cur) => cur.map((step) => ({ ...step, result: null, error: null, is_running: false })));
    const response = await submitGeneration(buildRequestFromRun(run));
    if (response) {
      pushPromptHistory(run.request.positive_prompt);
      setPromptHistory(loadPromptHistory());
    }
  }

  async function handleGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const issues = validateGenerationForm(form);
    setValidationMessages(issues);
    if (issues.length > 0) {
      const firstIssue = issues[0];
      if (firstIssue.target !== "general") setActiveSettingsTab(firstIssue.target);
      setError(firstIssue.message);
      toast.error(firstIssue.message);
      return;
    }
    const hasActiveGeneration = result != null && (result.status === "pending" || result.status === "running");
    if (!hasActiveGeneration) {
      clearResult();
      setSteps((cur) => cur.map((s) => ({ ...s, result: null, error: null, is_running: false })));
    }
    pushPromptHistory(form.positive_prompt);
    setPromptHistory(loadPromptHistory());
    const response = await submitGeneration(form);
    if (!response) {
      return;
    }
    submittedPayloadsRef.current[response.generation_id] = structuredClone(form);
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
      sampler: config.sampler ?? cur.sampler,
      architecture: config.architecture ?? "sdxl",
      chroma_pipeline_repo: config.chroma_pipeline_repo ?? cur.chroma_pipeline_repo,
      cpu_offload: config.cpu_offload ?? false,
      sequential_cpu_offload: config.sequential_cpu_offload ?? false,
      vae_tiling: config.vae_tiling ?? false,
      vae_slicing: config.vae_slicing ?? false,
    }));
    setConfigName(config.name);
    setCanvasPreset(detectCanvasPreset(config.width, config.height));
    setSaveFeedback("idle");
  }

  function applyImportedRequest(payload: GenerateImageRequest) {
    setForm(payload);
    setCanvasPreset(detectCanvasPreset(payload.width, payload.height));
    setSaveFeedback("idle");
    setError(null);
    setValidationMessages([]);
  }

  async function handleSaveConfig() {
    if (!configName.trim()) { setError("Config name is required."); setSaveFeedback("error"); return; }
    setIsSavingConfig(true);
    try {
      await api.saveGenerateConfig({ name: configName.trim(), ...form });
      setSavedConfigs(await api.getGenerateConfigs());
      setSaveFeedback("saved");
      setError(null);
      toast.success(`Config "${configName.trim()}" saved`);
    } catch (e) {
      console.error(e);
      setError("Failed to save config.");
      setSaveFeedback("error");
      toast.error("Failed to save config.");
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

  async function performUnload(trainingJob?: Job | null) {
    await handleUnloadWorker(trainingJob);
    setTrainingJobToConfirm(null);
  }

  async function handleUnloadClick() {
    try {
      const jobs = await api.getJobs();
      const runningJob = jobs.find((job) => job.status === "running") ?? null;
      if (runningJob) {
        setTrainingJobToConfirm(runningJob);
        return;
      }
      await performUnload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to check training status.");
    }
  }

  async function handleRemoveLatestQueuedGeneration() {
    await cancelLatest();
  }

  async function handleWarmup() {
    if (!form.model_path.trim()) { toast.error("Set a model path before warming up."); return; }
    try {
      await api.warmupGenerateWorker({
        architecture: form.architecture,
        model_path: form.model_path,
        chroma_pipeline_repo: form.chroma_pipeline_repo,
        loras: form.loras,
        cpu_offload: form.cpu_offload,
        sequential_cpu_offload: form.sequential_cpu_offload,
        vae_tiling: form.vae_tiling,
        vae_slicing: form.vae_slicing,
      });
      toast.info("Warming up — model loading in background.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Warmup failed.");
    }
  }

  async function handlePinConfig(configId: number, pinned: boolean) {
    try {
      await api.pinGenerateConfig(configId, pinned);
      setSavedConfigs(await api.getGenerateConfigs());
    } catch (e) {
      console.error(e);
    }
  }

  async function handleImportDrop(file: File) {
    try {
      const result = await api.importGenerateMetadata(file);
      if (result.mode === "image-edit") {
        setMode("image-edit");
        setImageEditImport(result.image_edit);
      } else {
        setMode("text2image");
        applyImportedRequest(result.text2image);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No metadata found.");
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      className={`generate-outer${isImportDragOver ? " drag-over" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setIsImportDragOver(true); }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setIsImportDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsImportDragOver(false);
        const file = event.dataTransfer.files?.[0];
        if (file) void handleImportDrop(file);
      }}
    >
      {isImportDragOver ? (
        <div className="generate-import-overlay">
          <div className="generate-import-label">Drop image to import generate metadata</div>
        </div>
      ) : null}
      {/* Mode tabs */}
      <div className="generate-mode-tabs">
        <button
          type="button"
          className={`generate-tab-pill${mode === "text2image" ? " active" : ""}`}
          onClick={() => setMode("text2image")}
        >
          Text2Image
        </button>
        <button
          type="button"
          className={`generate-tab-pill${mode === "image-edit" ? " active" : ""}`}
          onClick={() => setMode("image-edit")}
        >
          Image Edit
        </button>
        <button
          type="button"
          className={`generate-tab-pill${mode === "video" ? " active" : ""}`}
          onClick={() => setMode("video")}
        >
          Video
        </button>
      </div>

      {mode === "image-edit" ? (
        <ImageEditPanel
          initialImport={imageEditImport}
          onImportConsumed={() => setImageEditImport(null)}
          initialRefUrls={imageEditInitialRefs}
          onRefUrlsConsumed={() => setImageEditInitialRefs(null)}
        />
      ) : mode === "video" ? (
        <VideoPanel />
      ) : (
    <div className="split-page generate-page">
      {/* Left rail */}
      <div className="generate-rail">
        <form ref={t2iFormRef} className="generate-rail-form" onSubmit={handleGenerate}>
          <section className="section-card generate-settings-card">
            <div className="generate-settings-header-row">
              <span className="generate-settings-title">Text2Image</span>
              <div className="arch-toggle">
                <button
                  type="button"
                  className={`arch-btn${form.architecture === "sdxl" ? " active" : ""}`}
                  onClick={() => updateForm((cur) => ({ ...cur, architecture: "sdxl", cfg_scale: cur.cfg_scale === 3.0 ? 7.0 : cur.cfg_scale }))}
                >SDXL</button>
                <button
                  type="button"
                  className={`arch-btn${form.architecture === "chroma" ? " active" : ""}`}
                  onClick={() => updateForm((cur) => ({ ...cur, architecture: "chroma", cfg_scale: 3.0 }))}
                >Chroma</button>
              </div>
            </div>

            <div className="generate-settings-shell">
              {workerStatus ? (
                <WorkerStatusCard
                  status={workerStatus}
                  architecture={form.architecture}
                  queueStatus={queueStatus}
                  isUnloading={isUnloading}
                  onUnload={() => void handleUnloadClick()}
                  onRemoveQueued={() => void handleRemoveLatestQueuedGeneration()}
                  onWarmup={
                    (form.architecture === "chroma" ? workerStatus.chroma_state : workerStatus.state) === "cold"
                      ? () => void handleWarmup()
                      : undefined
                  }
                />
              ) : null}

              <ConfigSaveRow
                name={configName}
                onNameChange={(n) => { setConfigName(n); setSaveFeedback("idle"); }}
                onSave={() => void handleSaveConfig()}
                isSaving={isSavingConfig}
                configs={savedConfigs}
                onLoad={(id) => void handleLoadConfig(id)}
                onPin={(id, pinned) => void handlePinConfig(id, pinned)}
                feedback={saveFeedback}
                namePlaceholder="My Portrait Setup"
              />

              <div className="generate-settings-tabs" role="tablist" aria-label="Text2Image settings sections">
                {SETTINGS_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeSettingsTab === tab.id}
                    className={`generate-settings-tab${activeSettingsTab === tab.id ? " active" : ""}`}
                    onClick={() => setActiveSettingsTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {validationMessages.length > 0 ? (
                <div className="generate-preflight-card">
                  <div className="eyebrow">Preflight</div>
                  {validationMessages.map((issue, index) => (
                    <button
                      key={`${issue.target}-${index}`}
                      type="button"
                      className="generate-preflight-item"
                      onClick={() => issue.target !== "general" ? setActiveSettingsTab(issue.target) : undefined}
                    >
                      <span>{issue.message}</span>
                      {issue.target !== "general" ? <strong>{issue.target}</strong> : null}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="generate-settings-body">
                {activeSettingsTab === "model" ? (
                  <>
                    <label>
                      <span>{form.architecture === "chroma" ? "Transformer Checkpoint" : "Model Path"}</span>
                      <PathCombobox
                        value={form.model_path}
                        root={modelRoot}
                        files={modelFiles}
                        onChange={(p) => updateForm({ ...form, model_path: p })}
                        placeholder={form.architecture === "chroma" ? "/path/to/chroma.safetensors" : "/path/to/model.safetensors"}
                        noFilesPlaceholder="No model root configured"
                      />
                    </label>
                    {form.model_path ? (() => {
                      const filename = form.model_path.split("/").pop() ?? "";
                      const dot = filename.lastIndexOf(".");
                      const stem = dot > 0 ? filename.slice(0, dot) : filename;
                      return stem ? (
                        <div className="path-stem-row">
                          <span className="path-stem-label">{stem}</span>
                          <button
                            type="button"
                            className="path-copy-btn"
                            title="Copy full path"
                            onClick={() => void navigator.clipboard.writeText(form.model_path)}
                          >⧉</button>
                        </div>
                      ) : null;
                    })() : null}
                    <LoraStack
                      loras={form.loras}
                      onChange={(loras) => updateForm({ ...form, loras })}
                    />
                    {/* LoRA Presets */}
                    <div className="lora-presets-section">
                      <div className="section-inline-header">
                        <span className="eyebrow no-margin">LoRA Presets</span>
                      </div>
                      <div className="lora-presets-save-row">
                        <input
                          className="lora-preset-name-input"
                          placeholder="Preset name…"
                          value={loraPresetName}
                          onChange={(e) => setLoraPresetName(e.target.value)}
                        />
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!loraPresetName.trim() || form.loras.length === 0}
                          onClick={() => {
                            saveLoraPreset(loraPresetName, form.loras);
                            setLoraPresets(loadLoraPresets());
                            setLoraPresetName("");
                          }}
                        >Save</button>
                      </div>
                      {loraPresets.length > 0 ? (
                        <div className="lora-presets-list">
                          {loraPresets.map((preset) => (
                            <div key={preset.id} className="lora-preset-row">
                              <button
                                type="button"
                                className="lora-preset-load-btn"
                                title={`${preset.loras.length} LoRA${preset.loras.length === 1 ? "" : "s"}`}
                                onClick={() => updateForm({ ...form, loras: preset.loras })}
                              >{preset.name}</button>
                              <button
                                type="button"
                                className="lora-preset-delete-btn"
                                title="Delete preset"
                                onClick={() => { deleteLoraPreset(preset.id); setLoraPresets(loadLoraPresets()); }}
                              >✕</button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {/* Memory */}
                    <div className="lora-presets-section">
                      <div className="section-inline-header">
                        <span className="eyebrow no-margin">Memory</span>
                      </div>
                      <div className="memory-options-list">
                        <label className="modal-toggle-row">
                          <span>
                            CPU Offload
                            <span className="panel-muted" style={{ display: "block", fontSize: "0.8em" }}>
                              {form.architecture === "chroma"
                                ? "Already enabled by default"
                                : "Keeps text encoders on CPU — saves ~2 GB VRAM"}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={form.cpu_offload}
                            onChange={(e) => updateForm({ ...form, cpu_offload: e.target.checked })}
                          />
                        </label>
                        <label className="modal-toggle-row">
                          <span>
                            Sequential CPU Offload
                            <span className="panel-muted" style={{ display: "block", fontSize: "0.8em" }}>
                              {form.architecture === "chroma"
                                ? "Layer-by-layer offload — more savings, slower"
                                : "Offloads all components per step — max savings, much slower"}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={form.sequential_cpu_offload}
                            onChange={(e) => updateForm({ ...form, sequential_cpu_offload: e.target.checked })}
                          />
                        </label>
                        <label className="modal-toggle-row">
                          <span>
                            VAE Tiling
                            <span className="panel-muted" style={{ display: "block", fontSize: "0.8em" }}>
                              {form.architecture === "chroma"
                                ? "Already enabled by default"
                                : "Tiles VAE decode to lower peak VRAM"}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={form.vae_tiling}
                            onChange={(e) => updateForm({ ...form, vae_tiling: e.target.checked })}
                          />
                        </label>
                        <label className="modal-toggle-row">
                          <span>
                            VAE Slicing
                            <span className="panel-muted" style={{ display: "block", fontSize: "0.8em" }}>
                              {form.architecture === "chroma"
                                ? "Already enabled by default"
                                : "Slices batch VAE decode — useful for batch count > 1"}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={form.vae_slicing}
                            onChange={(e) => updateForm({ ...form, vae_slicing: e.target.checked })}
                          />
                        </label>
                      </div>
                    </div>
                  </>
                ) : null}

                {activeSettingsTab === "canvas" ? (
                  <>
                    <label>
                      <span>Preset</span>
                      <select value={canvasPreset} onChange={(e) => handleCanvasPresetChange(e.target.value)}>
                        {CANVAS_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </label>
                    <div className="canvas-dimension-row">
                      <label className="canvas-dimension-label">
                        <span>Width</span>
                        <input type="number" min={64} step={8} value={form.width} disabled={canvasPreset !== "manual"}
                          onChange={(e) => updateForm({ ...form, width: Number(e.target.value) })} />
                      </label>
                      <button
                        type="button"
                        className="dimension-swap-btn"
                        title="Swap width and height"
                        onClick={() => {
                          setCanvasPreset("manual");
                          updateForm((cur) => ({ ...cur, width: cur.height, height: cur.width }));
                        }}
                      >⇄</button>
                      <label className="canvas-dimension-label">
                        <span>Height</span>
                        <input type="number" min={64} step={8} value={form.height} disabled={canvasPreset !== "manual"}
                          onChange={(e) => updateForm({ ...form, height: Number(e.target.value) })} />
                      </label>
                    </div>
                    <p className="panel-muted">
                      Output: {adjustedWidth} × {adjustedHeight}
                      {isRounded ? " (rounded to ×64)" : ""}
                    </p>
                  </>
                ) : null}

                {activeSettingsTab === "parameters" ? (
                  <>
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
                    {form.architecture !== "chroma" ? (
                      <label>
                        <span>Sampler</span>
                        <select value={form.sampler} onChange={(e) => updateForm({ ...form, sampler: e.target.value })}>
                          {SAMPLER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
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
                  </>
                ) : null}

                {activeSettingsTab === "prompts" ? (
                  <>
                    <div>
                      <div className="prompt-history-header">
                        <span>Positive Prompt</span>
                        {promptHistory.length > 0 ? (
                          <div className="prompt-history-wrap">
                            <button
                              type="button"
                              className="prompt-history-btn"
                              title="Prompt history"
                              onClick={() => setShowPromptHistory((v) => !v)}
                            >⏱</button>
                            {showPromptHistory ? (
                              <div className="prompt-history-dropdown">
                                {promptHistory.map((p, i) => (
                                  <div key={i} className="prompt-history-row">
                                    <button
                                      type="button"
                                      className="prompt-history-option"
                                      onClick={() => {
                                        updateForm({ ...form, positive_prompt: p });
                                        setShowPromptHistory(false);
                                      }}
                                    >{p}</button>
                                    <button
                                      type="button"
                                      className="prompt-history-delete"
                                      title="Remove from history"
                                      onClick={() => {
                                        deletePromptHistoryItem(p);
                                        setPromptHistory(loadPromptHistory());
                                      }}
                                    >✕</button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <textarea rows={6} value={form.positive_prompt} placeholder="Describe what you want to generate..."
                        onChange={(e) => updateForm({ ...form, positive_prompt: e.target.value })} />
                    </div>
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
                  </>
                ) : null}
              </div>
            </div>
          </section>

          {error ? <div className="error-banner">{error}</div> : null}

          <div className="generate-shortcuts">
            <span><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>Enter</kbd> generate</span>
            <span><kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd> save config</span>
            <span><kbd>Alt</kbd> + <kbd>1-4</kbd> switch tabs</span>
            <span><kbd>Alt</kbd> + <kbd>R</kbd> rerun latest</span>
          </div>

          <button className="primary-button" type="submit">
            {isSubmittingGeneration ? "Queueing..." : isGenerating ? "Generate Again" : "Generate"}
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
          architecture={form.architecture}
          onUseSeed={(seed) => updateForm((cur) => ({ ...cur, seed }))}
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

        <section className="section-card generate-gallery-panel">
          <div className="section-header">
            <div>
              <div className="eyebrow">Library</div>
              <h2>Gallery</h2>
            </div>
          </div>
          <GalleryViewer
            viewportClassName="generate-gallery-viewport"
            refreshTrigger={galleryRefreshKey}
            onSendToImageEdit={(url) => {
              setMode("image-edit");
              setImageEditInitialRefs([url]);
            }}
          />
        </section>
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

      {trainingJobToConfirm ? (
        <div className="modal-backdrop" onClick={() => setTrainingJobToConfirm(null)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="eyebrow">Unload Models</span>
              <h3>Confirm Unload</h3>
            </div>
            <div className="modal-field">
              <span className="modal-hint generate-unload-warning">
                Training job: {trainingJobToConfirm.name} is running. Unloading models will end training. Are you sure you want to proceed?
              </span>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setTrainingJobToConfirm(null)}>
                No
              </button>
              <button className="danger-button" type="button" disabled={isUnloading} onClick={() => void performUnload(trainingJobToConfirm)}>
                Yes
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
      )}
    </div>
  );
}
