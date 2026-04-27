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
  controlnet_mode?: boolean;
  controlnet_conditioning_scale?: number;
  controlnet_preprocess?: "none" | "canny";
  cpu_offload: boolean;
  sequential_cpu_offload: boolean;
  vae_tiling: boolean;
  vae_slicing: boolean;
}

export interface ControlNetConfig {
  model_path: string;
  conditioning_scale: number;
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
  pinned: boolean;
}

export interface WarmupRequest {
  architecture: string;
  model_path: string;
  chroma_pipeline_repo: string;
  loras: GenerateLoraSpec[];
  controlnet_mode?: boolean;
  controlnet_path?: string;
  cpu_offload?: boolean;
  sequential_cpu_offload?: boolean;
  vae_tiling?: boolean;
  vae_slicing?: boolean;
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
  controlnet_state: "warm" | "cold";
  controlnet_model_path: string | null;
  controlnet_idle_seconds_remaining: number | null;
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

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function parseError(response: Response): Promise<never> {
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

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    return parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function formPost<T>(path: string, formData: FormData, init?: Omit<RequestInit, "body" | "method">): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    body: formData,
    ...init,
  });
  if (!response.ok) {
    return parseError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const generateApi = {
  generateImage: (body: GenerateImageRequest) =>
    request<GenerateImageResponse>("/api/generate", { method: "POST", body: JSON.stringify(body) }),
  generateControlNet: (body: GenerateImageRequest, controlImage?: File | null) => {
    const form = new FormData();
    form.set("payload_json", JSON.stringify(body));
    if (controlImage) form.set("control_image", controlImage, controlImage.name);
    return formPost<GenerateImageResponse>("/api/generate/controlnet", form);
  },
  getControlNetConfig: () => request<ControlNetConfig>("/api/settings/controlnet"),
  updateControlNetConfig: (body: ControlNetConfig) =>
    request<ControlNetConfig>("/api/settings/controlnet", { method: "PUT", body: JSON.stringify(body) }),
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
  warmupGenerateWorker: (body: WarmupRequest) =>
    request<{ status: string }>("/api/generate/worker/warmup", { method: "POST", body: JSON.stringify(body) }),
  pinGenerateConfig: (configId: number, pinned: boolean) =>
    request<void>(`/api/generate/configs/${configId}/pin`, { method: "POST", body: JSON.stringify({ pinned }) }),
  getGenerateQueueStatus: () => request<GenerateQueueStatus>("/api/generate/queue"),
  removeLatestQueuedGeneration: () =>
    request<GenerateImageResponse>("/api/generate/queue/latest", { method: "DELETE" }),
  importGenerateMetadata: async (file: File) => {
    const formData = new FormData();
    formData.set("file", file, file.name);
    return formPost<MetadataImportResult>("/api/generate/import-metadata", formData);
  },
  runImageEditFunction: async (body: {
    source_generation_id: string;
    prompt: string;
    width: number;
    height: number;
    steps: number;
    loras: GenerateLoraSpec[];
    extra_image: File | null;
    cpu_offload: boolean;
    sequential_cpu_offload: boolean;
    vae_tiling: boolean;
    vae_slicing: boolean;
  }) => {
    const formData = new FormData();
    formData.set("source_generation_id", body.source_generation_id);
    formData.set("prompt", body.prompt);
    formData.set("width", String(body.width));
    formData.set("height", String(body.height));
    formData.set("steps", String(body.steps));
    formData.set("loras_json", JSON.stringify(body.loras));
    formData.set("cpu_offload", String(body.cpu_offload));
    formData.set("sequential_cpu_offload", String(body.sequential_cpu_offload));
    formData.set("vae_tiling", String(body.vae_tiling));
    formData.set("vae_slicing", String(body.vae_slicing));
    if (body.extra_image) {
      formData.set("extra_image", body.extra_image);
    }
    return formPost<ImageEditResponse>("/api/generate/functions/image-edit", formData);
  },
  getImageEditFunctionRun: (functionRunId: string) =>
    request<ImageEditResponse>(`/api/generate/functions/image-edit/${functionRunId}`),
};
