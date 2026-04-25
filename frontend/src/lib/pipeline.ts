import type { GenerateLoraSpec, ImageEditResponse } from "./api";

export interface PipelineStep {
  id: string;
  type: "image_edit";
  config: {
    prompt: string;
    steps: number;
    loras: GenerateLoraSpec[];
    extra_image: File | null;
  };
  auto_run: boolean;
  save_output: boolean;
  result: ImageEditResponse | null;
  error: string | null;
  is_running: boolean;
}

export function makeStep(): PipelineStep {
  return {
    id: crypto.randomUUID(),
    type: "image_edit",
    config: { prompt: "", steps: 20, loras: [], extra_image: null },
    auto_run: false,
    save_output: true,
    result: null,
    error: null,
    is_running: false,
  };
}
