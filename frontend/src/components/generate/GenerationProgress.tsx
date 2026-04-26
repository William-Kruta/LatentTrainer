const STAGE_LABELS: Record<string, string> = {
  loading_transformer: "Loading transformer...",
  loading_pipeline: "Loading pipeline...",
  loading_t5: "Loading text encoder...",
  encoding_prompt: "Encoding prompt...",
  denoising: "Running inference...",
  saving: "Saving image...",
  freeing_vram: "Freeing VRAM...",
};

interface GenerationProgressProps {
  status: "pending" | "running" | "completed" | "failed";
  currentStep: number;
  totalSteps: number;
  rateValue: number | null;
  rateUnit: string | null;
  stage?: string | null;
  batchIndex?: number;
  batchTotal?: number;
  width?: number | null;
  height?: number | null;
}

export function GenerationProgress({
  status,
  currentStep,
  totalSteps,
  rateValue,
  rateUnit,
  stage,
  batchIndex,
  batchTotal,
  width,
  height,
}: GenerationProgressProps) {
  const pct = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;
  const showBatch = batchTotal !== undefined && batchTotal > 1;
  const stageLabel = stage ? (STAGE_LABELS[stage] ?? stage) : null;

  return (
    <div className="generation-status">
      <div className="generation-status-header">
        <span className={`status-pill ${status === "running" ? "running" : "pending"}`}>
          {status}
        </span>
        <span className="panel-muted">
          {showBatch ? `Image ${(batchIndex ?? 0) + 1}/${batchTotal} · ` : ""}Step {currentStep} / {totalSteps}
        </span>
      </div>
      <div className="meter">
        <div className="meter-fill accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="job-stats-inline">
        <span>
          {rateValue !== null && rateUnit
            ? `${rateValue.toFixed(2)} ${rateUnit}`
            : stageLabel ?? "Starting..."}
        </span>
        {width && height ? <span>{width} × {height}</span> : null}
      </div>
    </div>
  );
}
