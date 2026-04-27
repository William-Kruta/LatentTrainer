import type { GenerateLoraSpec, ImageEditResponse } from "./api";

export interface PipelineStepMemory {
  cpu_offload: boolean;
  sequential_cpu_offload: boolean;
  vae_tiling: boolean;
  vae_slicing: boolean;
}

export interface PipelineStep {
  id: string;
  type: "image_edit";
  config: {
    prompt: string;
    steps: number;
    loras: GenerateLoraSpec[];
    extra_image: File | null;
    memory: PipelineStepMemory;
  };
  auto_run: boolean;
  save_output: boolean;
  result: ImageEditResponse | null;
  error: string | null;
  is_running: boolean;
}

const DEFAULT_MEMORY: PipelineStepMemory = {
  cpu_offload: false,
  sequential_cpu_offload: false,
  vae_tiling: false,
  vae_slicing: false,
};

export function makeStep(): PipelineStep {
  return {
    id: crypto.randomUUID(),
    type: "image_edit",
    config: { prompt: "", steps: 20, loras: [], extra_image: null, memory: { ...DEFAULT_MEMORY } },
    auto_run: false,
    save_output: true,
    result: null,
    error: null,
    is_running: false,
  };
}
