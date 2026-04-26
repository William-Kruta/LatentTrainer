import { request } from "./generate";

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

export const trainingApi = {
  getJobs: () => request<Job[]>("/api/jobs"),
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
};
