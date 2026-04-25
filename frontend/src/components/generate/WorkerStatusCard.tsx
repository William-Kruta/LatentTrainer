import type { GenerateWorkerStatus } from "../../lib/api";

interface WorkerStatusCardProps {
  status: GenerateWorkerStatus;
}

export function WorkerStatusCard({ status }: WorkerStatusCardProps) {
  return (
    <div className="worker-status-card">
      <span className={status.state === "warm" ? "status-pill running" : "status-pill pending"}>
        {status.state === "warm" ? "Worker Warm" : "Worker Cold"}
      </span>
      <span className="panel-muted">
        {status.state === "warm"
          ? `Idle unload in ${status.idle_seconds_remaining ?? status.idle_timeout_seconds}s`
          : "Next run will cold-start the model"}
      </span>
      {status.state === "warm" && status.model_path ? (
        <span className="panel-muted">
          {status.lora_count > 0
            ? `${status.lora_count} LoRA${status.lora_count === 1 ? "" : "s"} loaded`
            : "Base model only"}
        </span>
      ) : null}
    </div>
  );
}
