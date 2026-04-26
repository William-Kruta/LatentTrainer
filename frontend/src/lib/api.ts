export interface SamplePrompt {
  prompt: string;
  width: number;
  height: number;
  seed: number;
  lora_scale: number;
}

export interface ConfigSummary {
  id: number;
  name: string;
  max_steps: number;
  learning_rate: number;
}

export interface Config extends ConfigSummary {
  model_path: string;
  batch_size: number;
  resolution: number;
  optimizer: string;
  lr_scheduler: string;
  warmup_steps: number;
  network_dim: number;
  network_alpha: number;
  save_every_n_steps: number;
  save_format: string;
  mixed_precision: string;
  sample_every_n_steps: number;
  sample_steps: number;
  sample_cfg: number;
  skip_first_sample: boolean;
  disable_sampling: boolean;
  cache_latents: boolean;
  cache_latents_to_disk: boolean;
  cache_text_encoder_outputs: boolean;
  cache_text_encoder_outputs_to_disk: boolean;
  sample_prompts: SamplePrompt[];
}

export interface ConfigOptions {
  optimizers: string[];
  lr_schedulers: string[];
  save_formats: string[];
  mixed_precision_modes: string[];
}

export interface Dataset {
  id: number;
  name: string;
  path: string;
  image_count: number;
  size_bytes: number;
  created_at: string;
}

export interface DatasetFile {
  filename: string;
  has_caption: boolean;
  caption: string | null;
}

export interface DatasetDetail extends Dataset {
  files: DatasetFile[];
}

export interface GalleryImage {
  id: string;
  generation_id: string;
  filename: string;
  image_url: string;
  created_at: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  media_type: "image" | "video";
  video_url: string | null;
}

export interface MediaVideo {
  filename: string;
  title: string;
  video_url: string;
  size_bytes: number;
  created_at: string;
  duration_seconds: number | null;
  fps: number | null;
  source_url: string | null;
}

export interface MediaDownloadResponse {
  video: MediaVideo;
}

export interface MediaFrameExportResponse {
  path: string;
}

export interface Job {
  id: number;
  name: string;
  config_id: number;
  dataset_id: number;
  output_dir: string;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  started_at: string;
  finished_at: string | null;
  log_path: string;
}

export interface GPU {
  id: number;
  name: string;
  vram_used_gb: number;
  vram_total_gb: number;
  utilization_pct: number;
  temperature_c: number;
}

export interface GenerateLoraSpec {
  path: string;
  strength: number;
}

export interface PromptEnhanceSettings {
  llama_url: string;
  model: string;
  system_prompt: string;
  max_tokens: number;
}

export interface GenerateImageRequest {
  architecture: string;
  loras: GenerateLoraSpec[];
  model_path: string;
  chroma_pipeline_repo: string;
  positive_prompt: string;
  negative_prompt: string;
  prompt_enhance: boolean;
  prompt_enhance_settings: PromptEnhanceSettings;
  steps: number;
  cfg_scale: number;
  width: number;
  height: number;
  seed: number | null;
  batch_count: number;
  sampler: string;
}

export interface GenerateImageResponse {
  generation_id: string;
  status: "pending" | "running" | "completed" | "failed";
  image_urls: string[];
  architecture: string;
  model_path: string;
  positive_prompt: string;
  negative_prompt: string;
  steps: number;
  cfg_scale: number;
  width: number;
  height: number;
  seed: number | null;
  batch_count: number;
  batch_index: number;
  sampler: string;
  stage: string | null;
  current_step: number;
  total_steps: number;
  rate_value: number | null;
  rate_unit: string | null;
  error: string | null;
}

export interface GenerateConfigSummary {
  id: number;
  name: string;
  updated_at: string;
}

export interface GenerateConfig extends GenerateImageRequest {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface GenerateWorkerStatus {
  state: "warm" | "cold";
  model_path: string | null;
  lora_count: number;
  idle_timeout_seconds: number;
  idle_seconds_remaining: number | null;
  chroma_state: "warm" | "cold";
  chroma_model_path: string | null;
  chroma_idle_seconds_remaining: number | null;
}

export interface GenerateQueueStatus {
  active_generation_id: string | null;
  queued_count: number;
  queued_generation_ids: string[];
}

export interface GenerateFunctionConfigSummary {
  id: number;
  name: string;
  function_type: string;
  updated_at: string;
}

export interface GenerateFunctionConfig {
  id: number;
  name: string;
  function_type: string;
  auto_run: boolean;
  prompt: string;
  steps: number;
  loras: GenerateLoraSpec[];
  created_at: string;
  updated_at: string;
}

export interface ImageEditResponse {
  function_run_id: string;
  generation_id: string;
  status: "pending" | "running" | "completed" | "failed";
  image_url: string;
  width: number;
  height: number;
  prompt: string;
  stage: string | null;
  current_step: number;
  total_steps: number;
  rate_value: number | null;
  rate_unit: string | null;
  error: string | null;
}

export interface ImageEditImport {
  hf_repo: string;
  prompt: string;
  loras: GenerateLoraSpec[];
  width: number;
  height: number;
  steps: number;
  limit: number | null;
}

export type MetadataImportResult =
  | { mode: "text2image"; text2image: GenerateImageRequest; image_edit: null }
  | { mode: "image-edit"; image_edit: ImageEditImport; text2image: null };

export interface ImageEditJobStatus {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  stage: string | null;
  current_step: number;
  total_steps: number;
  rate_value: number | null;
  rate_unit: string | null;
  image_url: string | null;
  error: string | null;
}

export interface LtxGenerateRequest {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  num_frames: number;
  frame_rate: number;
  num_inference_steps: number;
  cfg_scale: number;
  stg_scale: number;
  seed: number;
  offload_mode: string;
  loras: GenerateLoraSpec[];
}

export interface LtxJobStatus {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  stage: string | null;
  current_step: number;
  total_steps: number;
  rate_value: number | null;
  rate_unit: string | null;
  video_url: string | null;
  error: string | null;
}

export interface AppSettings {
  model_root: string;
  lora_root: string;
  output_root: string;
  dataset_root: string;
}

export interface LtxModelConfig {
  ltx_install_path: string;
  model_path: string;
  spatial_upscaler_path: string;
  temporal_upscaler_path: string;
  text_encoder_repo_id: string;
  loras: GenerateLoraSpec[];
}

export interface LoraFilesResponse {
  lora_root: string;
  files: string[];
}

export interface ModelFilesResponse {
  model_root: string;
  files: string[];
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        message = payload.detail;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  getGpus: () => request<GPU[]>("/api/gpus"),
  getJobs: () => request<Job[]>("/api/jobs"),
  generateImage: (body: GenerateImageRequest) =>
    request<GenerateImageResponse>("/api/generate", { method: "POST", body: JSON.stringify(body) }),
  getGeneration: (generationId: string) => request<GenerateImageResponse>(`/api/generate/${generationId}`),
  getGenerateConfigs: () => request<GenerateConfigSummary[]>("/api/generate/configs"),
  getGenerateConfig: (configId: number) => request<GenerateConfig>(`/api/generate/configs/${configId}`),
  saveGenerateConfig: (body: Omit<GenerateConfig, "id" | "created_at" | "updated_at">) =>
    request<GenerateConfig>("/api/generate/configs", { method: "POST", body: JSON.stringify(body) }),
  importGenerateConfig: (body: Omit<GenerateConfig, "id" | "created_at" | "updated_at">) =>
    request<GenerateConfig>("/api/generate/configs/import", { method: "POST", body: JSON.stringify(body) }),
  deleteGenerateConfig: (configId: number) =>
    request<void>(`/api/generate/configs/${configId}`, { method: "DELETE" }),
  duplicateGenerateConfig: (configId: number) =>
    request<GenerateConfig>(`/api/generate/configs/${configId}/duplicate`, { method: "POST" }),
  getGenerateFunctionConfigs: () => request<GenerateFunctionConfigSummary[]>("/api/generate/function-configs"),
  getGenerateFunctionConfig: (configId: number) =>
    request<GenerateFunctionConfig>(`/api/generate/function-configs/${configId}`),
  saveGenerateFunctionConfig: (
    body: Omit<GenerateFunctionConfig, "id" | "created_at" | "updated_at">,
  ) => request<GenerateFunctionConfig>("/api/generate/function-configs", { method: "POST", body: JSON.stringify(body) }),
  getGenerateWorkerStatus: () => request<GenerateWorkerStatus>("/api/generate/worker"),
  unloadGenerateWorkers: () => request<void>("/api/generate/worker/unload", { method: "POST" }),
  getGenerateQueueStatus: () => request<GenerateQueueStatus>("/api/generate/queue"),
  removeLatestQueuedGeneration: () =>
    request<GenerateImageResponse>("/api/generate/queue/latest", { method: "DELETE" }),
  importGenerateMetadata: async (file: File) => {
    const formData = new FormData();
    formData.set("file", file, file.name);
    const response = await fetch("/api/generate/import-metadata", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      let message = `Request failed: ${response.status}`;
      try {
        const payload = (await response.json()) as { detail?: string };
        if (payload.detail) message = payload.detail;
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as MetadataImportResult;
  },
  runImageEditFunction: async (body: {
    source_generation_id: string;
    prompt: string;
    width: number;
    height: number;
    steps: number;
    loras: GenerateLoraSpec[];
    extra_image: File | null;
  }) => {
    const formData = new FormData();
    formData.set("source_generation_id", body.source_generation_id);
    formData.set("prompt", body.prompt);
    formData.set("width", String(body.width));
    formData.set("height", String(body.height));
    formData.set("steps", String(body.steps));
    formData.set("loras_json", JSON.stringify(body.loras));
    if (body.extra_image) {
      formData.set("extra_image", body.extra_image);
    }

    const response = await fetch("/api/generate/functions/image-edit", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      let message = `Request failed: ${response.status}`;
      try {
        const payload = (await response.json()) as { detail?: string };
        if (payload.detail) {
          message = payload.detail;
        }
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as ImageEditResponse;
  },
  getImageEditFunctionRun: (functionRunId: string) =>
    request<ImageEditResponse>(`/api/generate/functions/image-edit/${functionRunId}`),
  createJob: (body: Omit<Job, "id" | "status" | "started_at" | "finished_at" | "log_path">) =>
    request<Job>("/api/jobs", { method: "POST", body: JSON.stringify(body) }),
  cancelJob: (jobId: number) => request<void>(`/api/jobs/${jobId}/cancel`, { method: "POST" }),
  resumeJob: (jobId: number) => request<void>(`/api/jobs/${jobId}/resume`, { method: "POST" }),
  getConfigs: () => request<ConfigSummary[]>("/api/configs"),
  getConfigOptions: () => request<ConfigOptions>("/api/configs/options"),
  getConfig: (configId: number) => request<Config>(`/api/configs/${configId}`),
  createConfig: (body: Omit<Config, "id">) =>
    request<Config>("/api/configs", { method: "POST", body: JSON.stringify(body) }),
  updateConfig: (configId: number, body: Omit<Config, "id">) =>
    request<Config>(`/api/configs/${configId}`, { method: "PUT", body: JSON.stringify(body) }),
  duplicateConfig: (configId: number) =>
    request<Config>(`/api/configs/${configId}/duplicate`, { method: "POST" }),
  deleteConfig: (configId: number) =>
    request<void>(`/api/configs/${configId}`, { method: "DELETE" }),
  getDatasets: () => request<Dataset[]>("/api/datasets"),
  getDataset: (datasetId: number) => request<DatasetDetail>(`/api/datasets/${datasetId}`),
  deleteDataset: (datasetId: number) => request<void>(`/api/datasets/${datasetId}`, { method: "DELETE" }),
  datasetImageUrl: (datasetId: number, filename: string) => `/api/datasets/${datasetId}/image/${encodeURIComponent(filename)}`,
  getGalleryImages: () => request<GalleryImage[]>("/api/gallery"),
  deleteGalleryImages: (imageIds: string[]) =>
    request<void>("/api/gallery/delete", { method: "POST", body: JSON.stringify({ image_ids: imageIds }) }),
  moveGalleryImages: (imageIds: string[], datasetId: number) =>
    request<void>("/api/gallery/move", {
      method: "POST",
      body: JSON.stringify({ image_ids: imageIds, dataset_id: datasetId }),
    }),
  getMediaVideos: () => request<MediaVideo[]>("/api/media/videos"),
  downloadMediaVideo: (url: string) =>
    request<MediaDownloadResponse>("/api/media/download", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  exportMediaFrame: async (body: { frame: Blob; outputDir: string; filename: string }) => {
    const formData = new FormData();
    formData.set("frame", body.frame, body.filename);
    formData.set("output_dir", body.outputDir);
    formData.set("filename", body.filename);
    const response = await fetch("/api/media/export-frame", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      let message = `Request failed: ${response.status}`;
      try {
        const payload = (await response.json()) as { detail?: string };
        if (payload.detail) message = payload.detail;
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as MediaFrameExportResponse;
  },
  startLtxGenerate: (body: LtxGenerateRequest) =>
    request<LtxJobStatus>("/api/ltx/generate", { method: "POST", body: JSON.stringify(body) }),
  getLtxJob: (jobId: string) => request<LtxJobStatus>(`/api/ltx/jobs/${jobId}`),
  getSettings: () => request<AppSettings>("/api/settings"),
  updateSettings: (body: AppSettings) =>
    request<AppSettings>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  getLtxConfig: () => request<LtxModelConfig>("/api/settings/ltx"),
  updateLtxConfig: (body: LtxModelConfig) =>
    request<LtxModelConfig>("/api/settings/ltx", { method: "PUT", body: JSON.stringify(body) }),
  getLoraFiles: () => request<LoraFilesResponse>("/api/settings/loras"),
  getModelFiles: () => request<ModelFilesResponse>("/api/settings/models"),
  startImageEdit: async (body: {
    prompt: string;
    hf_repo: string;
    width: number;
    height: number;
    steps: number;
    limit: number | null;
    loras: GenerateLoraSpec[];
    reference_images: File[];
  }): Promise<ImageEditJobStatus> => {
    const form = new FormData();
    form.set("prompt", body.prompt);
    form.set("hf_repo", body.hf_repo);
    form.set("width", String(body.width));
    form.set("height", String(body.height));
    form.set("steps", String(body.steps));
    if (body.limit !== null) form.set("limit", String(body.limit));
    form.set("loras_json", JSON.stringify(body.loras));
    for (const file of body.reference_images) {
      form.append("reference_images", file, file.name);
    }
    const response = await fetch("/api/image-edit", { method: "POST", body: form });
    if (!response.ok) {
      let message = `Request failed: ${response.status}`;
      try {
        const payload = (await response.json()) as { detail?: string };
        if (payload.detail) message = payload.detail;
      } catch { /* ignore */ }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as ImageEditJobStatus;
  },
  getImageEditJob: (jobId: string) =>
    request<ImageEditJobStatus>(`/api/image-edit/${jobId}`),
  uploadMediaVideo: async (file: File): Promise<MediaDownloadResponse> => {
    const formData = new FormData();
    formData.set("file", file, file.name);
    const response = await fetch("/api/media/upload", { method: "POST", body: formData });
    if (!response.ok) {
      let message = `Request failed: ${response.status}`;
      try {
        const payload = (await response.json()) as { detail?: string };
        if (payload.detail) message = payload.detail;
      } catch {
        // ignore
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as MediaDownloadResponse;
  },
  exportMediaFrameToDataset: async (body: { frame: Blob; datasetId: number; filename: string }) => {
    const formData = new FormData();
    formData.set("frame", body.frame, body.filename);
    formData.set("dataset_id", String(body.datasetId));
    formData.set("filename", body.filename);
    const response = await fetch("/api/media/export-frame-to-dataset", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      let message = `Request failed: ${response.status}`;
      try {
        const payload = (await response.json()) as { detail?: string };
        if (payload.detail) message = payload.detail;
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as MediaFrameExportResponse;
  },
};
