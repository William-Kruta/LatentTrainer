import { useEffect, useRef, useState } from "react";
import { ApiError, api, type GenerateLoraSpec, type ImageEditImport, type ImageEditJobStatus } from "../../lib/api";
import { CollapsibleSection } from "./CollapsibleSection";
import { LoraStack } from "./LoraStack";
import { GenerationProgress } from "./GenerationProgress";

const CANVAS_PRESETS = [
  { id: "manual", label: "Manual", width: null, height: null },
  { id: "1024-square", label: "1024 Square · 1:1", width: 1024, height: 1024 },
  { id: "720p-landscape", label: "720p Landscape · 16:9", width: 1280, height: 720 },
  { id: "720p-portrait", label: "720p Portrait · 9:16", width: 720, height: 1280 },
  { id: "1080p-landscape", label: "1080p Landscape · 16:9", width: 1920, height: 1080 },
  { id: "1080p-portrait", label: "1080p Portrait · 9:16", width: 1080, height: 1920 },
];

const STAGE_LABELS: Record<string, string> = {
  starting: "Starting…",
  bootstrapping: "Bootstrapping…",
  importing_torch: "Importing PyTorch…",
  importing_pil: "Importing PIL…",
  importing_diffusers: "Importing Diffusers…",
  importing_flux2: "Importing FLUX.2…",
  creating_flux_wrapper: "Creating FLUX wrapper…",
  loading_model: "Loading model…",
  preparing_images: "Preparing images…",
  applying_loras: "Applying LoRAs…",
  running_inference: "Running inference…",
  inference_complete: "Inference complete",
  saving: "Saving image…",
};

const MAX_REFS = 5;

interface RefImage {
  file: File;
  objectUrl: string;
}

interface ImageEditPanelProps {
  initialImport?: ImageEditImport | null;
  onImportConsumed?: () => void;
  initialRefUrls?: string[] | null;
  onRefUrlsConsumed?: () => void;
}

export function ImageEditPanel({ initialImport, onImportConsumed, initialRefUrls, onRefUrlsConsumed }: ImageEditPanelProps) {
  const [hfRepo, setHfRepo] = useState("black-forest-labs/FLUX.2-klein-9B");
  const [loras, setLoras] = useState<GenerateLoraSpec[]>([]);
  const [canvasPreset, setCanvasPreset] = useState("1024-square");
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [steps, setSteps] = useState(4);
  const [limit, setLimit] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [refImages, setRefImages] = useState<RefImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<ImageEditJobStatus | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch gallery images sent from the gallery viewer
  useEffect(() => {
    if (!initialRefUrls || initialRefUrls.length === 0) return;
    async function fetchRefs() {
      const newRefs: RefImage[] = [];
      for (const url of initialRefUrls!) {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          const filename = url.split("/").pop() ?? "image.png";
          const file = new File([blob], filename, { type: blob.type || "image/png" });
          newRefs.push({ file, objectUrl: URL.createObjectURL(file) });
        } catch { /* skip */ }
      }
      setRefImages((cur) => {
        const available = MAX_REFS - cur.length;
        return [...cur, ...newRefs.slice(0, available)];
      });
    }
    void fetchRefs();
    onRefUrlsConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRefUrls]);

  // Apply imported metadata when provided by parent (drag-and-drop)
  useEffect(() => {
    if (!initialImport) return;
    setHfRepo(initialImport.hf_repo);
    setPrompt(initialImport.prompt);
    setLoras(initialImport.loras);
    setWidth(initialImport.width);
    setHeight(initialImport.height);
    setSteps(initialImport.steps);
    setLimit(initialImport.limit);
    const matchedPreset = CANVAS_PRESETS.find(
      (p) => p.width === initialImport.width && p.height === initialImport.height,
    );
    setCanvasPreset(matchedPreset?.id ?? "manual");
    onImportConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImport]);

  // Poll job until terminal
  useEffect(() => {
    if (!jobId) return;
    const id = jobId;
    let cancelled = false;

    const intervalId = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const next = await api.getImageEditJob(id);
        if (cancelled) return;
        setResult(next);
        if (next.status === "completed" || next.status === "failed") {
          window.clearInterval(intervalId);
          if (next.status === "failed") setError(next.error ?? "Generation failed.");
        }
      } catch (e) {
        console.error(e);
      }
    }, 500);

    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [jobId]);

  // Revoke object URLs on unmount
  useEffect(() => {
    return () => { refImages.forEach((r) => URL.revokeObjectURL(r.objectUrl)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCanvasPreset(presetId: string) {
    setCanvasPreset(presetId);
    const preset = CANVAS_PRESETS.find((p) => p.id === presetId);
    if (preset?.width) setWidth(preset.width);
    if (preset?.height) setHeight(preset.height);
  }

  function handleFileInput(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files).slice(0, MAX_REFS - refImages.length);
    const newRefs: RefImage[] = incoming.map((f) => ({ file: f, objectUrl: URL.createObjectURL(f) }));
    setRefImages((cur) => [...cur, ...newRefs]);
  }

  function removeRef(index: number) {
    setRefImages((cur) => {
      URL.revokeObjectURL(cur[index].objectUrl);
      return cur.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (refImages.length === 0) { setError("Add at least one reference image."); return; }
    setError(null);
    setIsSubmitting(true);
    setResult(null);
    try {
      const job = await api.startImageEdit({
        prompt,
        hf_repo: hfRepo,
        width,
        height,
        steps,
        limit,
        loras,
        reference_images: refImages.map((r) => r.file),
      });
      setResult(job);
      setJobId(job.job_id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to start generation.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isRunning = result?.status === "pending" || result?.status === "running";
  const isDone = result?.status === "completed";
  const isFailed = result?.status === "failed";
  const aspectRatio = `${width} / ${height}`;

  let statusPill: React.ReactNode;
  if (result?.status === "running") {
    statusPill = <span className="status-pill running">running</span>;
  } else if (result?.status === "pending") {
    statusPill = <span className="status-pill queued">pending</span>;
  } else if (isDone) {
    statusPill = <span className="status-pill completed">done</span>;
  } else if (isFailed) {
    statusPill = <span className="status-pill failed">failed</span>;
  } else {
    statusPill = <span className="status-pill pending">idle</span>;
  }

  return (
    <div className="split-page generate-page">
      {/* Left rail */}
      <div className="generate-rail">
        <form className="generate-rail-form" onSubmit={handleSubmit}>
          <CollapsibleSection title="Model & LoRAs">
            <label>
              <span>HF Repo</span>
              <input
                value={hfRepo}
                onChange={(e) => setHfRepo(e.target.value)}
                placeholder="black-forest-labs/FLUX.2-klein-9B"
              />
            </label>
            <LoraStack loras={loras} onChange={setLoras} />
          </CollapsibleSection>

          <CollapsibleSection title="Canvas">
            <label>
              <span>Preset</span>
              <select value={canvasPreset} onChange={(e) => handleCanvasPreset(e.target.value)}>
                {CANVAS_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <div className="generate-grid">
              <label>
                <span>Width</span>
                <input type="number" min={64} step={8} value={width} disabled={canvasPreset !== "manual"}
                  onChange={(e) => setWidth(Number(e.target.value))} />
              </label>
              <label>
                <span>Height</span>
                <input type="number" min={64} step={8} value={height} disabled={canvasPreset !== "manual"}
                  onChange={(e) => setHeight(Number(e.target.value))} />
              </label>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Parameters">
            <div className="generate-grid">
              <label>
                <span>Steps</span>
                <input type="number" min={1} max={50} value={steps}
                  onChange={(e) => setSteps(Number(e.target.value))} />
              </label>
              <label>
                <span>Limit</span>
                <input type="number" min={1} max={2} value={limit ?? ""}
                  placeholder="auto"
                  onChange={(e) => setLimit(e.target.value === "" ? null : Number(e.target.value))} />
              </label>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Reference Images">
            <div className="ref-image-grid">
              {refImages.map((ref, i) => (
                <div key={i} className="ref-image-cell">
                  <img src={ref.objectUrl} alt={`Reference ${i + 1}`} />
                  <button
                    type="button"
                    className="ref-image-remove"
                    onClick={() => removeRef(i)}
                    aria-label="Remove image"
                  >×</button>
                </div>
              ))}
              {refImages.length < MAX_REFS ? (
                <button
                  type="button"
                  className="ref-image-add"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Add reference image"
                >
                  <span>＋</span>
                  <span className="ref-image-add-label">Add Image</span>
                </button>
              ) : null}
            </div>
            <p className="panel-muted">{refImages.length}/{MAX_REFS} images — max 2 used for inference</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => handleFileInput(e.target.files)}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Prompt">
            <textarea
              rows={6}
              value={prompt}
              placeholder="Describe the edit to apply…"
              onChange={(e) => setPrompt(e.target.value)}
            />
          </CollapsibleSection>

          {error ? <div className="error-banner">{error}</div> : null}

          <button className="primary-button" type="submit" disabled={isSubmitting || isRunning}>
            {isSubmitting ? "Starting…" : isRunning ? "Generating…" : "Generate"}
          </button>
        </form>
      </div>

      {/* Right panel */}
      <div className="main-panel generate-pipeline">
        <div className="pipeline-step-card">
          <div className="pipeline-step-header">
            <div className="pipeline-step-dot" style={{ background: "#60a5fa" }} />
            <span className="pipeline-step-name">FLUX.2 Klein · Image Edit</span>
            {statusPill}
          </div>

          <div className="pipeline-step-body">
            {(result?.status === "running" || result?.status === "pending") && result ? (
              <GenerationProgress
                status={result.status === "pending" ? "running" : result.status}
                currentStep={result.current_step}
                totalSteps={result.total_steps}
                rateValue={result.rate_value}
                rateUnit={result.rate_unit}
                stage={result.stage}
                batchIndex={0}
                batchTotal={1}
                width={width}
                height={height}
              />
            ) : null}

            {isDone && result?.image_url ? (
              <div className="image-gallery-scroll">
                <div className="pipeline-step-image-wrap" style={{ aspectRatio }}>
                  <img src={result.image_url} alt="Result" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
              </div>
            ) : isFailed ? (
              <div className="error-banner">{result?.error ?? "Generation failed."}</div>
            ) : !result ? (
              <div className="empty-state">No output yet — add reference images and click Generate.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
