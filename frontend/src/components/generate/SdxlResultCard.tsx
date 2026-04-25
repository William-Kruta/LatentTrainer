import type { GenerateImageResponse } from "../../lib/api";
import { GenerationProgress } from "./GenerationProgress";

interface SdxlResultCardProps {
  result: GenerateImageResponse | null;
  isGenerating: boolean;
  saveOutput: boolean;
  onToggleSave: (value: boolean) => void;
  captionStyle: "none" | "snapchat";
  captionText: string;
  captionTop: number;
}

function CaptionedImage({ url, alt, captionStyle, captionText, captionTop }: {
  url: string;
  alt: string;
  captionStyle: "none" | "snapchat";
  captionText: string;
  captionTop: number;
}) {
  return (
    <div className="captioned-image-wrap">
      <img src={url} alt={alt} />
      {captionStyle === "snapchat" && captionText ? (
        <div className="caption-snapchat" style={{ top: `${captionTop}%` }}>{captionText}</div>
      ) : null}
    </div>
  );
}

export function SdxlResultCard({ result, isGenerating, saveOutput, onToggleSave, captionStyle, captionText, captionTop }: SdxlResultCardProps) {
  const isActive = result && (result.status === "pending" || result.status === "running");
  const isDone = result?.status === "completed";
  const isFailed = result?.status === "failed";
  const isBatch = (result?.batch_count ?? 1) > 1;

  return (
    <div className="pipeline-step-card">
      <div className="pipeline-step-header">
        <div className="pipeline-step-dot" style={{ background: "#a78bfa" }} />
        <span className="pipeline-step-name">SDXL Generate</span>
        {isGenerating ? (
          <span className="status-pill running">running</span>
        ) : isDone ? (
          <span className="status-pill completed">done</span>
        ) : isFailed ? (
          <span className="status-pill failed">failed</span>
        ) : (
          <span className="status-pill pending">idle</span>
        )}
      </div>

      <div className="pipeline-step-body">
        {isActive && result ? (
          <GenerationProgress
            status={result.status}
            currentStep={result.current_step}
            totalSteps={result.total_steps}
            rateValue={result.rate_value}
            rateUnit={result.rate_unit}
            batchIndex={result.batch_index}
            batchTotal={result.batch_count}
            width={result.width}
            height={result.height}
          />
        ) : null}

        {isDone && result?.image_urls.length ? (
          isBatch ? (
            <div className="image-batch-grid">
              {result.image_urls.map((url, i) => (
                <div key={i} className="image-batch-cell">
                  <CaptionedImage
                    url={url}
                    alt={`Image ${i + 1}`}
                    captionStyle={captionStyle}
                    captionText={captionText}
                    captionTop={captionTop}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="pipeline-step-image-wrap">
              <CaptionedImage
                url={result.image_urls[0]}
                alt={result.positive_prompt}
                captionStyle={captionStyle}
                captionText={captionText}
                captionTop={captionTop}
              />
            </div>
          )
        ) : isFailed ? (
          <div className="error-banner">{result?.error ?? "Generation failed."}</div>
        ) : !isGenerating ? (
          <div className="empty-state">No output yet — click Generate.</div>
        ) : null}

        {isDone && result ? (
          <div className="generate-meta">
            <div className="job-stats-inline">
              <span>{result.width} × {result.height}</span>
              <span>{result.steps} steps</span>
              <span>CFG {result.cfg_scale}</span>
              {isBatch ? <span>{result.batch_count} images</span> : null}
              {result.seed !== null ? <span>Seed {result.seed}</span> : null}
            </div>
            <div className="caption-panel">
              <div className="caption-panel-header">
                <span className="eyebrow">Prompt Used</span>
              </div>
              <div>{result.positive_prompt}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="pipeline-step-footer">
        <div className="step-toggle-group">
          <span className="step-toggle-label">Save Output</span>
          <button
            type="button"
            className={`toggle-card${saveOutput ? " checked" : ""}`}
            style={{ padding: "0 4px", border: "none", background: "transparent", cursor: "pointer" }}
            onClick={() => onToggleSave(!saveOutput)}
            title={saveOutput ? "Output will be saved" : "Output will not be saved"}
          >
            <div className="toggle-switch" />
          </button>
        </div>
      </div>
    </div>
  );
}
