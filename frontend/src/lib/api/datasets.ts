import { request } from "./generate";

export interface Dataset {
  id: number;
  name: string;
  path: string;
  image_count: number;
  caption_count: number;
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

export const datasetsApi = {
  getDatasets: () => request<Dataset[]>("/api/datasets"),
  getDataset: (datasetId: number) => request<DatasetDetail>(`/api/datasets/${datasetId}`),
  deleteDataset: (datasetId: number) => request<void>(`/api/datasets/${datasetId}`, { method: "DELETE" }),
  renameDatasetFiles: (datasetId: number, prefix: string) =>
    request<DatasetDetail>(`/api/datasets/${datasetId}/rename-files`, {
      method: "POST",
      body: JSON.stringify({ prefix }),
    }),
  datasetImageUrl: (datasetId: number, filename: string) => `/api/datasets/${datasetId}/image/${encodeURIComponent(filename)}`,
};
