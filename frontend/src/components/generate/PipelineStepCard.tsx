import { useState } from "react";
import type { PipelineStep } from "../../lib/pipeline";
import { GenerationProgress } from "./GenerationProgress";
import { LoraStack } from "./LoraStack";

interface PipelineStepCardProps {
  step: PipelineStep;
  index: number;
  canRun: boolean;
  onUpdate: (updates: Partial<PipelineStep>) => void;
  onRemove: () => void;
  onRun: () => void;
}

const STEP_COLORS: Record<PipelineStep["type"], string> = {
  image_edit: "#38bdf8",
};

const STEP_LABELS: Record<PipelineStep["type"], string> = {
  image_edit: "Image Edit",
};

export function PipelineStepCard({ step, index, canRun, onUpdate, onRemove, onRun }: PipelineStepCardProps) {
  const [configOpen, setConfigOpen] = useState(true);

  const isActive = step.result && (step.result.status === "pending" || step.result.status === "running");
  const isDone = step.result?.status === "completed";
  const isFailed = step.result?.status === "failed";

  function updateConfig(next: Partial<PipelineStep["config"]>) {
    onUpdate({ config: { ...step.config, ...next } });
  }

  return (
    <div className="pipeline-step-card">
      <div className="pipeline-step-header">
        <div className="pipeline-step-dot" style={{ background: STEP_COLORS[step.type] }} />
        <span className="pipeline-step-name">
          Step {index} · {STEP_LABELS[step.type]}
        </span>
        {step.is_running ? (
          <span className="status-pill running">running</span>
        ) : isDone ? (
          <span className="status-pill completed">done</span>
        ) : isFailed ? (
          <span className="status-pill failed">failed</span>
        ) : (
          <span className="status-pill pending">idle</span>
        )}
        <button className="step-remove-btn" type="button" aria-label="Remove step" onClick={onRemove}>
          ×
        </button>
      </div>

      <div className="pipeline-step-body">
        {isActive && step.result ? (
          <GenerationProgress
            status={step.result.status}
            currentStep={step.result.current_step}
            totalSteps={step.result.total_steps}
            rateValue={step.result.rate_value}
            rateUnit={step.result.rate_unit}
            stage={step.result.stage}
            width={step.result.width}
            height={step.result.height}
          />
        ) : null}

        {isDone && step.result?.image_url ? (
          <div className="pipeline-step-image-wrap">
            <img src={step.result.image_url} alt={step.config.prompt} />
          </div>
        ) : isFailed ? (
          <div className="error-banner">{step.error ?? "Step failed."}</div>
        ) : null}

        <div className="section-card" style={{ margin: 0 }}>
          <div className="collapsible-header" onClick={() => setConfigOpen((o) => !o)}>
            <span className="collapsible-title">Config</span>
            <span className={`collapsible-chevron${configOpen ? " open" : ""}`}>▼</span>
          </div>
          {configOpen ? (
            <div className="collapsible-body">
              <label>
                <span>Prompt</span>
                <textarea
                  rows={4}
                  value={step.config.prompt}
                  onChange={(e) => updateConfig({ prompt: e.target.value })}
                  placeholder="Describe how to edit the image..."
                />
              </label>
              <label>
                <span>Steps</span>
                <input
                  type="number"
                  min={1}
                  value={step.config.steps}
                  onChange={(e) => updateConfig({ steps: Number(e.target.value) })}
                />
              </label>
              <label>
                <span>Additional Image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => updateConfig({ extra_image: e.target.files?.[0] ?? null })}
                />
              </label>
              <LoraStack
                loras={step.config.loras}
                onChange={(loras) => updateConfig({ loras })}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="pipeline-step-footer">
        <div className="step-toggle-group">
          <span className="step-toggle-label">Auto</span>
          <button
            type="button"
            className={`toggle-card${step.auto_run ? " checked" : ""}`}
            style={{ padding: "0 4px", border: "none", background: "transparent", cursor: "pointer" }}
            onClick={() => onUpdate({ auto_run: !step.auto_run })}
            title={step.auto_run ? "Will run automatically" : "Manual trigger only"}
          >
            <div className="toggle-switch" />
          </button>
        </div>
        <div className="step-toggle-group">
          <span className="step-toggle-label">Save</span>
          <button
            type="button"
            className={`toggle-card${step.save_output ? " checked" : ""}`}
            style={{ padding: "0 4px", border: "none", background: "transparent", cursor: "pointer" }}
            onClick={() => onUpdate({ save_output: !step.save_output })}
            title={step.save_output ? "Output will be saved" : "Output is ephemeral"}
          >
            <div className="toggle-switch" />
          </button>
        </div>
        <div className="step-footer-spacer" />
        <button
          className="primary-button"
          type="button"
          onClick={onRun}
          disabled={!canRun || step.is_running}
        >
          {step.is_running ? "Running..." : "Run Step"}
        </button>
      </div>
    </div>
  );
}
