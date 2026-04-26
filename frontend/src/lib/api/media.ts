import { formPost, request, type GenerateLoraSpec } from "./generate";

export interface GalleryExportResponse {
  exported: number;
  destination_dir: string;
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

export interface GPU {
  id: number;
  name: string;
  vram_used_gb: number;
  vram_total_gb: number;
  utilization_pct: number;
  temperature_c: number;
}

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

export const mediaApi = {
  getGpus: () => request<GPU[]>("/api/gpus"),
  getGalleryImages: () => request<GalleryImage[]>("/api/gallery"),
  deleteGalleryImages: (imageIds: string[]) =>
    request<void>("/api/gallery/delete", { method: "POST", body: JSON.stringify({ image_ids: imageIds }) }),
  moveGalleryImages: (imageIds: string[], datasetId: number) =>
    request<void>("/api/gallery/move", {
      method: "POST",
      body: JSON.stringify({ image_ids: imageIds, dataset_id: datasetId }),
    }),
  exportGalleryImages: (imageIds: string[], destinationDir: string) =>
    request<GalleryExportResponse>("/api/gallery/export", {
      method: "POST",
      body: JSON.stringify({ image_ids: imageIds, destination_dir: destinationDir }),
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
    return formPost<MediaFrameExportResponse>("/api/media/export-frame", formData);
  },
  startLtxGenerate: (body: LtxGenerateRequest, inputImage?: File | null) => {
    const form = new FormData();
    form.set("prompt", body.prompt);
    form.set("negative_prompt", body.negative_prompt);
    form.set("width", String(body.width));
    form.set("height", String(body.height));
    form.set("num_frames", String(body.num_frames));
    form.set("frame_rate", String(body.frame_rate));
    form.set("num_inference_steps", String(body.num_inference_steps));
    form.set("cfg_scale", String(body.cfg_scale));
    form.set("stg_scale", String(body.stg_scale));
    form.set("seed", String(body.seed));
    form.set("offload_mode", body.offload_mode);
    form.set("loras_json", JSON.stringify(body.loras));
    if (inputImage) form.set("input_image", inputImage, inputImage.name);
    return formPost<LtxJobStatus>("/api/ltx/generate", form);
  },
  getLtxJob: (jobId: string) => request<LtxJobStatus>(`/api/ltx/jobs/${jobId}`),
  getSettings: () => request<AppSettings>("/api/settings"),
  updateSettings: (body: AppSettings) =>
    request<AppSettings>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  getLtxConfig: () => request<LtxModelConfig>("/api/settings/ltx"),
  updateLtxConfig: (body: LtxModelConfig) =>
    request<LtxModelConfig>("/api/settings/ltx", { method: "PUT", body: JSON.stringify(body) }),
  getLoraFiles: () => request<LoraFilesResponse>("/api/settings/loras"),
  getModelFiles: () => request<ModelFilesResponse>("/api/settings/models"),
  getAllSettings: () => request<Record<string, any>>("/api/settings/all"),
  updateAllSettings: (body: Record<string, any>) =>
    request<Record<string, any>>("/api/settings/all", { method: "POST", body: JSON.stringify(body) }),
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
    return formPost<ImageEditJobStatus>("/api/image-edit", form);
  },
  getImageEditJob: (jobId: string) =>
    request<ImageEditJobStatus>(`/api/image-edit/${jobId}`),
  uploadMediaVideo: async (file: File): Promise<MediaDownloadResponse> => {
    const formData = new FormData();
    formData.set("file", file, file.name);
    return formPost<MediaDownloadResponse>("/api/media/upload", formData);
  },
  exportMediaFrameToDataset: async (body: { frame: Blob; datasetId: number; filename: string }) => {
    const formData = new FormData();
    formData.set("frame", body.frame, body.filename);
    formData.set("dataset_id", String(body.datasetId));
    formData.set("filename", body.filename);
    return formPost<MediaFrameExportResponse>("/api/media/export-frame-to-dataset", formData);
  },
};
