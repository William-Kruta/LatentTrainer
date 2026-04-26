import { useEffect, useRef, useState } from "react";

import {
  api,
  type Config,
  type ConfigOptions,
  type ConfigSummary,
  type GenerateConfig,
  type GenerateConfigSummary,
} from "../lib/api";

const FALLBACK_OPTIMIZER_OPTIONS = [
  "AdamW",
  "AdamW8bit",
  "Adafactor",
  "Lion",
  "Lion8bit",
  "Prodigy",
  "SGDNesterov",
];

const FALLBACK_LR_SCHEDULER_OPTIONS = [
  "constant",
  "constant_with_warmup",
  "cosine",
  "cosine_with_restarts",
  "linear",
  "polynomial",
];

const FALLBACK_SAVE_FORMAT_OPTIONS = ["safetensors", "ckpt", "pt"];
const FALLBACK_MIXED_PRECISION_OPTIONS = ["no", "fp16", "bf16"];

export type ConfigMode = "training" | "generate";

type ExportedConfigFile = {
  config_type?: ConfigMode;
  exported_at?: string;
  data?: unknown;
};

const initialGenerateConfig = (): GenerateConfig => ({
  id: 0,
  name: "new_generate_config",
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
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

export function useConfigForm() {
  const [mode, setMode] = useState<ConfigMode>("training");

  const [configs, setConfigs] = useState<ConfigSummary[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [config, setConfig] = useState<Config | null>(null);

  const [generateConfigs, setGenerateConfigs] = useState<GenerateConfigSummary[]>([]);
  const [selectedGenerateConfigId, setSelectedGenerateConfigId] = useState<number | null>(null);
  const [generateConfig, setGenerateConfig] = useState<GenerateConfig | null>(null);

  const [configOptions, setConfigOptions] = useState<ConfigOptions>({
    optimizers: FALLBACK_OPTIMIZER_OPTIONS,
    lr_schedulers: FALLBACK_LR_SCHEDULER_OPTIONS,
    save_formats: FALLBACK_SAVE_FORMAT_OPTIONS,
    mixed_precision_modes: FALLBACK_MIXED_PRECISION_OPTIONS,
  });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const saveResetTimerRef = useRef<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api.getConfigOptions().then(setConfigOptions).catch(console.error);
    void loadTrainingConfigs();
    void loadGenerateConfigs();
  }, []);

  async function loadTrainingConfigs() {
    const items = await api.getConfigs();
    setConfigs(items);
    if (items[0]) {
      setSelectedConfigId((current) => current ?? items[0].id);
      const detail = await api.getConfig(items[0].id);
      setConfig(detail);
    } else {
      setSelectedConfigId(null);
      setConfig(null);
    }
  }

  async function loadGenerateConfigs() {
    const items = await api.getGenerateConfigs();
    setGenerateConfigs(items);
    if (items[0]) {
      setSelectedGenerateConfigId((current) => current ?? items[0].id);
      const detail = await api.getGenerateConfig(items[0].id);
      setGenerateConfig(detail);
    } else {
      setSelectedGenerateConfigId(null);
      setGenerateConfig(null);
    }
  }

  async function loadConfig(configId: number) {
    setSelectedConfigId(configId);
    const detail = await api.getConfig(configId);
    setConfig(detail);
    setSaveStatus("idle");
  }

  async function loadGenerateConfig(configId: number) {
    setSelectedGenerateConfigId(configId);
    const detail = await api.getGenerateConfig(configId);
    setGenerateConfig(detail);
    setSaveStatus("idle");
  }

  async function saveConfig() {
    if (mode === "training") {
      if (!config) return;
      try {
        const { id: configId, ...payload } = config;
        const updated = await api.updateConfig(configId, payload);
        setConfig(updated);
        setConfigs(await api.getConfigs());
        setSaveStatus("saved");
      } catch (error) {
        console.error(error);
        setSaveStatus("error");
      }
    } else {
      if (!generateConfig) return;
      try {
        const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...payload } = generateConfig;
        const updated = await api.saveGenerateConfig(payload);
        setGenerateConfig(updated);
        setSelectedGenerateConfigId(updated.id);
        setGenerateConfigs(await api.getGenerateConfigs());
        setSaveStatus("saved");
      } catch (error) {
        console.error(error);
        setSaveStatus("error");
      }
    }

    if (saveResetTimerRef.current) {
      window.clearTimeout(saveResetTimerRef.current);
    }
    saveResetTimerRef.current = window.setTimeout(() => {
      setSaveStatus("idle");
      saveResetTimerRef.current = null;
    }, 2500);
  }

  async function newConfig() {
    if (mode === "training") {
      const created = await api.createConfig({
        name: "new_config",
        model_path: "",
        max_steps: 2000,
        learning_rate: 1e-4,
        batch_size: 4,
        resolution: 1024,
        optimizer: "AdamW",
        lr_scheduler: "cosine",
        warmup_steps: 100,
        network_dim: 32,
        network_alpha: 16,
        save_every_n_steps: 500,
        save_format: "safetensors",
        mixed_precision: "bf16",
        sample_every_n_steps: 200,
        sample_steps: 20,
        sample_cfg: 7.0,
        skip_first_sample: true,
        disable_sampling: false,
        cache_latents: false,
        cache_latents_to_disk: false,
        cache_text_encoder_outputs: false,
        cache_text_encoder_outputs_to_disk: false,
        sample_prompts: [],
      });
      setConfigs(await api.getConfigs());
      setSelectedConfigId(created.id);
      setConfig(created);
    } else {
      const created = await api.saveGenerateConfig(initialGenerateConfig());
      setGenerateConfigs(await api.getGenerateConfigs());
      setSelectedGenerateConfigId(created.id);
      setGenerateConfig(created);
    }
    setSaveStatus("idle");
  }

  async function duplicateConfig() {
    if (mode === "training") {
      if (!selectedConfigId) return;
      const created = await api.duplicateConfig(selectedConfigId);
      setConfigs(await api.getConfigs());
      setSelectedConfigId(created.id);
      setConfig(created);
    } else {
      if (!selectedGenerateConfigId) return;
      const created = await api.duplicateGenerateConfig(selectedGenerateConfigId);
      setGenerateConfigs(await api.getGenerateConfigs());
      setSelectedGenerateConfigId(created.id);
      setGenerateConfig(created);
    }
    setSaveStatus("idle");
  }

  async function deleteConfig() {
    if (mode === "training") {
      if (!selectedConfigId || !config) return;
      if (!window.confirm(`Delete config "${config.name}"?`)) return;
      await api.deleteConfig(selectedConfigId);
      const refreshed = await api.getConfigs();
      setConfigs(refreshed);
      if (refreshed.length > 0) {
        const detail = await api.getConfig(refreshed[0].id);
        setSelectedConfigId(refreshed[0].id);
        setConfig(detail);
      } else {
        setSelectedConfigId(null);
        setConfig(null);
      }
    } else {
      if (!selectedGenerateConfigId || !generateConfig) return;
      if (!window.confirm(`Delete config "${generateConfig.name}"?`)) return;
      await api.deleteGenerateConfig(selectedGenerateConfigId);
      const refreshed = await api.getGenerateConfigs();
      setGenerateConfigs(refreshed);
      if (refreshed.length > 0) {
        const detail = await api.getGenerateConfig(refreshed[0].id);
        setSelectedGenerateConfigId(refreshed[0].id);
        setGenerateConfig(detail);
      } else {
        setSelectedGenerateConfigId(null);
        setGenerateConfig(null);
      }
    }
    setSaveStatus("idle");
  }

  function exportConfig() {
    if (mode === "training") {
      if (!config) return;
      const payload = {
        name: config.name,
        model_path: config.model_path,
        max_steps: config.max_steps,
        learning_rate: config.learning_rate,
        batch_size: config.batch_size,
        resolution: config.resolution,
        optimizer: config.optimizer,
        lr_scheduler: config.lr_scheduler,
        warmup_steps: config.warmup_steps,
        network_dim: config.network_dim,
        network_alpha: config.network_alpha,
        save_every_n_steps: config.save_every_n_steps,
        save_format: config.save_format,
        mixed_precision: config.mixed_precision,
        sample_every_n_steps: config.sample_every_n_steps,
        sample_steps: config.sample_steps,
        sample_cfg: config.sample_cfg,
        skip_first_sample: config.skip_first_sample,
        disable_sampling: config.disable_sampling,
        cache_latents: config.cache_latents,
        cache_latents_to_disk: config.cache_latents_to_disk,
        cache_text_encoder_outputs: config.cache_text_encoder_outputs,
        cache_text_encoder_outputs_to_disk: config.cache_text_encoder_outputs_to_disk,
        sample_prompts: config.sample_prompts,
      };
      const blob = new Blob(
        [JSON.stringify({ config_type: "training", exported_at: new Date().toISOString(), data: payload }, null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${config.name}.json`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    if (!generateConfig) return;
    const payload = {
      name: generateConfig.name,
      architecture: generateConfig.architecture,
      loras: generateConfig.loras,
      model_path: generateConfig.model_path,
      chroma_pipeline_repo: generateConfig.chroma_pipeline_repo,
      positive_prompt: generateConfig.positive_prompt,
      negative_prompt: generateConfig.negative_prompt,
      prompt_enhance: generateConfig.prompt_enhance,
      prompt_enhance_settings: generateConfig.prompt_enhance_settings,
      steps: generateConfig.steps,
      cfg_scale: generateConfig.cfg_scale,
      width: generateConfig.width,
      height: generateConfig.height,
      seed: generateConfig.seed,
      batch_count: generateConfig.batch_count,
      sampler: generateConfig.sampler,
    };

    const blob = new Blob(
      [
        JSON.stringify(
          {
            config_type: "generate",
            exported_at: new Date().toISOString(),
            data: payload,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${generateConfig.name}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    try {
      const raw = JSON.parse(await file.text()) as ExportedConfigFile | Record<string, unknown>;
      const wrapper = raw as ExportedConfigFile;
      const detectedMode = wrapper.config_type === "generate" || wrapper.config_type === "training"
        ? wrapper.config_type
        : mode;
      const data = (wrapper.data ?? raw) as Record<string, unknown>;

      if (detectedMode === "training") {
        const created = await api.createConfig(data as Omit<Config, "id">);
        setMode("training");
        setConfigs(await api.getConfigs());
        setSelectedConfigId(created.id);
        setConfig(created);
      } else {
        const created = await api.importGenerateConfig(
          data as Omit<GenerateConfig, "id" | "created_at" | "updated_at">,
        );
        setMode("generate");
        setGenerateConfigs(await api.getGenerateConfigs());
        setSelectedGenerateConfigId(created.id);
        setGenerateConfig(created);
      }
      setSaveStatus("idle");
    } catch (error) {
      console.error(error);
      setSaveStatus("error");
    }
  }

  function setField<K extends keyof Config>(field: K, value: Config[K]) {
    if (!config) return;
    if (saveStatus === "saved") setSaveStatus("idle");
    setConfig((prev) => (prev ? { ...prev, [field]: value } : null));
  }

  function setGenerateField<K extends keyof GenerateConfig>(field: K, value: GenerateConfig[K]) {
    if (!generateConfig) return;
    if (saveStatus === "saved") setSaveStatus("idle");
    setGenerateConfig((prev) => (prev ? { ...prev, [field]: value } : null));
  }

  useEffect(() => {
    return () => {
      if (saveResetTimerRef.current) {
        window.clearTimeout(saveResetTimerRef.current);
      }
    };
  }, []);

  const activeSelectedId = mode === "training" ? selectedConfigId : selectedGenerateConfigId;
  const activeTitle = mode === "training" ? (config?.name ?? "Configuration") : (generateConfig?.name ?? "Generate Configuration");

  return {
    mode,
    setMode,
    configs,
    selectedConfigId,
    config,
    generateConfigs,
    selectedGenerateConfigId,
    generateConfig,
    configOptions,
    saveStatus,
    setSaveStatus,
    importInputRef,
    loadConfig,
    loadGenerateConfig,
    saveConfig,
    newConfig,
    duplicateConfig,
    deleteConfig,
    exportConfig,
    handleImportFile,
    setField,
    setGenerateField,
    activeSelectedId,
    activeTitle,
  };
}
