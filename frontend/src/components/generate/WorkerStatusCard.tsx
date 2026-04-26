import type { GenerateWorkerStatus, GenerateQueueStatus } from "../../lib/api";

interface WorkerStatusCardProps {
  status: GenerateWorkerStatus;
  architecture: string;
  queueStatus: GenerateQueueStatus | null;
  isUnloading: boolean;
  onUnload: () => void;
  onRemoveQueued: () => void;
  onWarmup?: () => void;
}

function WorkerRow({ label, state, modelPath, loraCount, idleRemaining, idleTimeout }: {
  label: string;
  state: "warm" | "cold";
  modelPath: string | null;
  loraCount?: number;
  idleRemaining: number | null;
  idleTimeout: number;
}) {
  return (
    <div className="worker-status-row">
      <span className="worker-status-label">{label}</span>
      <span className={state === "warm" ? "status-pill running" : "status-pill pending"}>
        {state === "warm" ? "warm" : "cold"}
      </span>
      <span className="panel-muted">
        {state === "warm"
          ? `unloads in ${idleRemaining ?? idleTimeout}s`
          : "cold-start on next run"}
      </span>
      {state === "warm" && modelPath ? (
        <span className="panel-muted">
          {loraCount != null && loraCount > 0
            ? `${loraCount} LoRA${loraCount === 1 ? "" : "s"}`
            : "base model"}
        </span>
      ) : null}
    </div>
  );
}

export function WorkerStatusCard({ status, architecture, queueStatus, isUnloading, onUnload, onRemoveQueued, onWarmup }: WorkerStatusCardProps) {
  const queued = queueStatus?.queued_count ?? 0;
  const active = queueStatus?.active_generation_id != null;

  return (
    <div className="worker-status-card">
      <div className="worker-status-main">
        {architecture === "chroma" ? (
          <WorkerRow
            label="Chroma"
            state={status.chroma_state}
            modelPath={status.chroma_model_path}
            idleRemaining={status.chroma_idle_seconds_remaining}
            idleTimeout={status.idle_timeout_seconds}
          />
        ) : (
          <WorkerRow
            label="SDXL"
            state={status.state}
            modelPath={status.model_path}
            loraCount={status.lora_count}
            idleRemaining={status.idle_seconds_remaining}
            idleTimeout={status.idle_timeout_seconds}
          />
        )}
        {onWarmup ? (
          <button
            className="worker-warmup-btn"
            type="button"
            onClick={onWarmup}
            title="Load model into VRAM without generating"
          >
            Warm up
          </button>
        ) : null}
        <button
          className="worker-unload-btn"
          type="button"
          disabled={isUnloading}
          onClick={onUnload}
        >
          {isUnloading ? "…" : "Unload"}
        </button>
      </div>

      {(active || queued > 0) ? (
        <div className="worker-queue-row">
          <span className={`status-pill${active ? " running" : " pending"}`}>
            {active ? "generating" : "queued"}
          </span>
          {queued > 0 ? (
            <span className="panel-muted">{queued} waiting</span>
          ) : null}
          {queued > 0 ? (
            <button
              className="worker-queue-remove"
              type="button"
              onClick={onRemoveQueued}
              title="Remove last queued generation"
            >
              Remove last
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
