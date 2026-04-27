import { request, type GenerateQueueStatus, type GenerateWorkerStatus } from "./generate";
import type { GPU, MediaVideo } from "./media";
import type { Job } from "./training";
import type { ImageEditJobStatus, LtxJobStatus, SwapJobStatus } from "./media";

export interface DownloadJobStatus {
  job_id: string;
  kind: "download";
  label: string;
  url: string;
  status: "queued" | "running" | "cancelling" | "cancelled" | "completed" | "failed";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  downloaded_bytes: number | null;
  total_bytes: number | null;
  speed: number | null;
  eta: number | null;
  error: string | null;
  video: MediaVideo | null;
}

export interface SystemOverview {
  training_jobs: Job[];
  generate_queue: GenerateQueueStatus;
  generate_worker: GenerateWorkerStatus;
  swap_jobs: SwapJobStatus[];
  ltx_jobs: LtxJobStatus[];
  image_edit_jobs: ImageEditJobStatus[];
  download_jobs: DownloadJobStatus[];
  recent_outputs: MediaVideo[];
  gpus: GPU[];
}

export interface HealthCheckItem {
  name: string;
  path: string;
  ok: boolean;
}

export interface SystemHealth {
  checks: HealthCheckItem[];
  gpus: GPU[];
  executables: Record<string, string | null>;
  worker: GenerateWorkerStatus;
}

export const systemApi = {
  getSystemOverview: () => request<SystemOverview>("/api/system/overview"),
  getSystemHealth: () => request<SystemHealth>("/api/system/health"),
};
