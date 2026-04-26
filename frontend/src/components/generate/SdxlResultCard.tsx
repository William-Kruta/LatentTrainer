import type React from "react";
import { useState } from "react";
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
  architecture?: string;
  onUseSeed?: (seed: number) => void;
}

function CaptionedImage({ url, alt, captionStyle, captionText, captionTop, onClick }: {
  url: string;
  alt: string;
  captionStyle: "none" | "snapchat";
  captionText: string;
  captionTop: number;
  onClick?: () => void;
}) {
  return (
    <div className="captioned-image-wrap" onClick={onClick} style={onClick ? { cursor: "zoom-in" } : undefined}>
      <img src={url} alt={alt} />
      {captionStyle === "snapchat" && captionText ? (
        <div className="caption-snapchat" style={{ top: `${captionTop}%` }}>{captionText}</div>
      ) : null}
      <a
        href={url}
        download
        className="image-download-btn"
        onClick={(e) => e.stopPropagation()}
        title="Download image"
      >
        ↓
      </a>
    </div>
  );
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <button className="lightbox-close" type="button" onClick={onClose} aria-label="Close">✕</button>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <img src={url} alt="Full size preview" className="lightbox-img" />
      </div>
    </div>
  );
}

export function SdxlResultCard({ result, isGenerating, saveOutput, onToggleSave, captionStyle, captionText, captionTop, architecture, onUseSeed }: SdxlResultCardProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const isRunning = result?.status === "running";
  const isPending = result?.status === "pending";
  const isDone = result?.status === "completed";
  const isFailed = result?.status === "failed";
  const isBatch = (result?.batch_count ?? 1) > 1;
  const aspectRatio = result ? `${result.width} / ${result.height}` : undefined;

  let statusPill: React.ReactNode;
  if (isRunning) {
    statusPill = <span className="status-pill running">running</span>;
  } else if (isPending || (isGenerating && !isDone && !isFailed)) {
    statusPill = <span className="status-pill queued">queued</span>;
  } else if (isDone) {
    statusPill = <span className="status-pill completed">done</span>;
  } else if (isFailed) {
    statusPill = <span className="status-pill failed">failed</span>;
  } else {
    statusPill = <span className="status-pill pending">idle</span>;
  }

  return (
    <>
      {lightboxUrl ? <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} /> : null}

      <div className="pipeline-step-card">
        <div className="pipeline-step-header">
          <div className="pipeline-step-dot" style={{ background: "#a78bfa" }} />
          <span className="pipeline-step-name">{architecture === "chroma" ? "Chroma Generate" : "SDXL Generate"}</span>
          {statusPill}
        </div>

        <div className="pipeline-step-body">
          {isRunning && result ? (
            <GenerationProgress
              status={result.status}
              currentStep={result.current_step}
              totalSteps={result.total_steps}
              rateValue={result.rate_value}
              rateUnit={result.rate_unit}
              stage={result.stage}
              batchIndex={result.batch_index}
              batchTotal={result.batch_count}
              width={result.width}
              height={result.height}
            />
          ) : isPending ? (
            <div className="generation-queued-state">
              <span className="panel-muted">Waiting for active generation to finish…</span>
            </div>
          ) : null}

          {isDone && result?.image_urls.length ? (
            <div className="image-gallery-scroll">
              {isBatch ? (
                <div className="image-batch-grid">
                  {result.image_urls.map((url, i) => (
                    <div key={i} className="image-batch-cell" style={{ aspectRatio }}>
                      <CaptionedImage
                        url={url}
                        alt={`Image ${i + 1}`}
                        captionStyle={captionStyle}
                        captionText={captionText}
                        captionTop={captionTop}
                        onClick={() => setLightboxUrl(url)}
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
                    onClick={() => setLightboxUrl(result.image_urls[0])}
                  />
                </div>
              )}
            </div>
          ) : isFailed ? (
            <div className="error-banner">{result?.error ?? "Generation failed."}</div>
          ) : !result ? (
            <div className="empty-state">No output yet — click Generate.</div>
          ) : null}

          {isDone && result ? (
            <div className="generate-meta">
              <div className="job-stats-inline">
                <span>{result.width} × {result.height}</span>
                <span>{result.steps} steps</span>
                <span>CFG {result.cfg_scale}</span>
                {isBatch ? <span>{result.batch_count} images</span> : null}
                {result.seed !== null ? (
                  <span className="result-seed-group">
                    Seed {result.seed}
                    {onUseSeed ? (
                      <button
                        type="button"
                        className="seed-reuse-btn"
                        onClick={() => onUseSeed(result.seed!)}
                        title="Copy seed to form"
                      >↺ Use</button>
                    ) : null}
                  </span>
                ) : null}
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
    </>
  );
}
