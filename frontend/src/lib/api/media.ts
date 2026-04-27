import { formPost, request, type GenerateLoraSpec } from "./generate";
import type { DownloadJobStatus } from "./system";

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
  media_type: "image" | "video";
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

export interface SwapJobStatus {
  job_id: string;
  status: "queued" | "running" | "cancelling" | "cancelled" | "done" | "error";
  current_frame: number;
  total_frames: number;
  output_path: string | null;
  error: string | null;
}

export interface SwapRunResponse {
  job_id: string;
}

export type SwapMaskAnchor = "top" | "center" | "bottom";

export interface SwapMaskMetadata {
  image_width: number;
  image_height: number;
  bbox: [number, number, number, number] | null;
}

export interface SwapPreviewResponse {
  url: string;
  mask: SwapMaskMetadata | null;
}

export interface AppSettings {
  model_root: string;
  lora_root: string;
  output_root: string;
  dataset_root: string;
  llama_url: string;
  controlnet_root: string;
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

export interface ControlNetFilesResponse {
  controlnet_root: string;
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
  getMediaItems: () => request<MediaVideo[]>("/api/media/items"),
  downloadMediaVideo: (url: string) =>
    request<MediaDownloadResponse>("/api/media/download", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  createMediaDownloadJob: (url: string) =>
    request<DownloadJobStatus>("/api/media/download-jobs", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  getMediaDownloadJobs: () => request<DownloadJobStatus[]>("/api/media/download-jobs"),
  cancelMediaDownloadJob: (jobId: string) =>
    request<DownloadJobStatus>(`/api/media/download-jobs/${jobId}/cancel`, { method: "POST" }),
  deleteMediaVideo: (filename: string) =>
    request<{ status: string; filename: string }>(`/api/media/video/${encodeURIComponent(filename)}`, {
      method: "DELETE",
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
  getControlNetFiles: () => request<ControlNetFilesResponse>("/api/settings/controlnets"),
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
  exportMediaClip: async (body: {
    filename: string;
    startTime: number;
    endTime: number;
    outputDir: string;
    outputFilename: string;
  }) =>
    request<MediaFrameExportResponse>("/api/media/export-clip", {
      method: "POST",
      body: JSON.stringify({
        filename: body.filename,
        start_time: body.startTime,
        end_time: body.endTime,
        output_dir: body.outputDir,
        output_filename: body.outputFilename,
      }),
    }),
  exportMediaClipToDataset: async (body: {
    filename: string;
    startTime: number;
    endTime: number;
    datasetId: number;
    outputFilename: string;
  }) =>
    request<MediaFrameExportResponse>("/api/media/export-clip-to-dataset", {
      method: "POST",
      body: JSON.stringify({
        filename: body.filename,
        start_time: body.startTime,
        end_time: body.endTime,
        dataset_id: body.datasetId,
        output_filename: body.outputFilename,
      }),
    }),
  downloadUrl: (url: string, datasetId?: number, filename?: string) =>
    request<{ path: string; filename: string }>("/api/media/download-url", {
      method: "POST",
      body: JSON.stringify({ url, dataset_id: datasetId, filename }),
    }),
  swapPreview: async (body: {
    faceImage: File;
    videoFilename: string;
    timestampSeconds: number;
    maskStrength: number;
    maskFeather: number;
    maskVerticalRatio: number;
    maskAnchor: SwapMaskAnchor;
  }): Promise<SwapPreviewResponse> => {
    const form = new FormData();
    form.set("face_image", body.faceImage, body.faceImage.name);
    form.set("video_filename", body.videoFilename);
    form.set("timestamp_seconds", String(body.timestampSeconds));
    form.set("mask_strength", String(body.maskStrength));
    form.set("mask_feather", String(body.maskFeather));
    form.set("mask_vertical_ratio", String(body.maskVerticalRatio));
    form.set("mask_anchor", body.maskAnchor);
    const res = await fetch("/api/swap/preview", { method: "POST", body: form });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "Preview swap failed.");
    }
    const blob = await res.blob();
    const rawMetadata = res.headers.get("X-Swap-Mask-Metadata");
    let mask: SwapMaskMetadata | null = null;
    if (rawMetadata) {
      try {
        mask = JSON.parse(rawMetadata) as SwapMaskMetadata;
      } catch {
        mask = null;
      }
    }
    return { url: URL.createObjectURL(blob), mask };
  },
  swapRun: async (body: {
    faceImage: File;
    videoFilename: string;
    outputFilename: string;
    maskStrength: number;
    maskFeather: number;
    maskVerticalRatio: number;
    maskAnchor: SwapMaskAnchor;
  }): Promise<SwapRunResponse> => {
    const form = new FormData();
    form.set("face_image", body.faceImage, body.faceImage.name);
    form.set("video_filename", body.videoFilename);
    form.set("output_filename", body.outputFilename);
    form.set("mask_strength", String(body.maskStrength));
    form.set("mask_feather", String(body.maskFeather));
    form.set("mask_vertical_ratio", String(body.maskVerticalRatio));
    form.set("mask_anchor", body.maskAnchor);
    return formPost<SwapRunResponse>("/api/swap/run", form);
  },
  swapStatus: (jobId: string) =>
    request<SwapJobStatus>(`/api/swap/status/${jobId}`),
  swapCancel: (jobId: string) =>
    request<SwapJobStatus>(`/api/swap/cancel/${jobId}`, { method: "POST" }),
  swapPreviewFrame: (jobId: string): string =>
    `/api/swap/preview-frame/${jobId}?t=${Date.now()}`,
};
