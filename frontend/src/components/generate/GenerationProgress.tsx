interface GenerationProgressProps {
  status: "pending" | "running" | "completed" | "failed";
  currentStep: number;
  totalSteps: number;
  rateValue: number | null;
  rateUnit: string | null;
  stage?: string | null;
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
  width,
  height,
}: GenerationProgressProps) {
  const pct = totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;

  return (
    <div className="generation-status">
      <div className="generation-status-header">
        <span className={`status-pill ${status === "running" ? "running" : "pending"}`}>
          {status}
        </span>
        <span className="panel-muted">
          Step {currentStep} / {totalSteps}
        </span>
      </div>
      <div className="meter">
        <div className="meter-fill accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="job-stats-inline">
        <span>
          {rateValue !== null && rateUnit
            ? `${rateValue.toFixed(2)} ${rateUnit}`
            : stage ?? "Starting..."}
        </span>
        {width && height ? <span>{width} × {height}</span> : null}
      </div>
    </div>
  );
}
