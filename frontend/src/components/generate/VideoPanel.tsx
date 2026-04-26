import { useEffect, useRef, useState } from "react";
import { ApiError, api, type GenerateLoraSpec, type LtxJobStatus } from "../../lib/api";
import { LoraStack } from "./LoraStack";
import { GenerationProgress } from "./GenerationProgress";

// ── Types ─────────────────────────────────────────────────────────

type VideoArch = "ltx" | "wan";

const VIDEO_TABS = [
  { id: "model", label: "Model" },
  { id: "canvas", label: "Canvas" },
  { id: "parameters", label: "Parameters" },
  { id: "prompt", label: "Prompt" },
] as const;

type VideoTabId = (typeof VIDEO_TABS)[number]["id"];

const CANVAS_PRESETS = [
  { id: "manual", label: "Manual", width: null, height: null },
  { id: "512-square", label: "512 Square · 1:1", width: 512, height: 512 },
  { id: "704x480", label: "704 × 480 · 16:9", width: 704, height: 480 },
  { id: "480x704", label: "480 × 704 · 9:16", width: 480, height: 704 },
  { id: "768x512", label: "768 × 512 · 3:2", width: 768, height: 512 },
  { id: "512x768", label: "512 × 768 · 2:3", width: 512, height: 768 },
  { id: "1280x720", label: "1280 × 720 · 16:9", width: 1280, height: 720 },
  { id: "720x1280", label: "720 × 1280 · 9:16", width: 720, height: 1280 },
] as const;

const OFFLOAD_OPTIONS = [
  { value: "model", label: "Model offload" },
  { value: "sequential", label: "Sequential offload" },
  { value: "none", label: "No offload" },
];

interface LtxForm {
  ltx_install_path: string;
  model_path: string;
  spatial_upscaler_path: string;
  temporal_upscaler_path: string;
  text_encoder_repo_id: string;
  loras: GenerateLoraSpec[];
}

const initialLtxForm: LtxForm = {
  ltx_install_path: "",
  model_path: "",
  spatial_upscaler_path: "",
  temporal_upscaler_path: "",
  text_encoder_repo_id: "",
  loras: [],
};

interface WanForm {
  model_path: string;
  loras: GenerateLoraSpec[];
}

const initialWanForm: WanForm = {
  model_path: "",
  loras: [],
};

// ── Component ─────────────────────────────────────────────────────

export function VideoPanel() {
  const [arch, setArch] = useState<VideoArch>("ltx");
  const [activeTab, setActiveTab] = useState<VideoTabId>("model");

  // Shared generation params
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [canvasPreset, setCanvasPreset] = useState("704x480");
  const [width, setWidth] = useState(704);
  const [height, setHeight] = useState(480);
  const [numFrames, setNumFrames] = useState(121);
  const [frameRate, setFrameRate] = useState(25);
  const [steps, setSteps] = useState(50);
  const [seed, setSeed] = useState<number | null>(null);

  // LTX-specific params
  const [ltxForm, setLtxForm] = useState<LtxForm>(initialLtxForm);
  const [cfgScale, setCfgScale] = useState(3.0);
  const [stgScale, setStgScale] = useState(1.0);
  const [offloadMode, setOffloadMode] = useState("model");

  // Wan-specific params
  const [wanForm, setWanForm] = useState<WanForm>(initialWanForm);

  // I2V image
  const [inputImage, setInputImage] = useState<{ file: File; objectUrl: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Job state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<LtxJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    return () => { if (inputImage) URL.revokeObjectURL(inputImage.objectUrl); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load LTX config from settings on mount
  useEffect(() => {
    api.getLtxConfig().then((cfg) => {
      setLtxForm({
        ltx_install_path: cfg.ltx_install_path,
        model_path: cfg.model_path,
        spatial_upscaler_path: cfg.spatial_upscaler_path,
        temporal_upscaler_path: cfg.temporal_upscaler_path,
        text_encoder_repo_id: cfg.text_encoder_repo_id,
        loras: cfg.loras as GenerateLoraSpec[],
      });
    }).catch(() => {/* ignore */});
  }, []);

  // Poll job until terminal
  useEffect(() => {
    if (!jobId) return;
    const id = jobId;
    let cancelled = false;

    const intervalId = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const next = await api.getLtxJob(id);
        if (cancelled) return;
        setResult(next);
        if (next.status === "completed" || next.status === "failed") {
          window.clearInterval(intervalId);
          if (next.status === "failed") setError(next.error ?? "Generation failed.");
        }
      } catch (e) {
        console.error(e);
      }
    }, 750);

    return () => { cancelled = true; window.clearInterval(intervalId); };
  }, [jobId]);

  function handleCanvasPreset(presetId: string) {
    setCanvasPreset(presetId);
    const preset = CANVAS_PRESETS.find((p) => p.id === presetId);
    if (preset && preset.width != null && preset.height != null) {
      setWidth(preset.width);
      setHeight(preset.height);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (arch === "wan") {
      setError("Wan 2.2 generation is not yet available.");
      return;
    }
    if (!prompt.trim()) { setError("Prompt is required."); return; }
    setError(null);
    setIsSubmitting(true);
    setResult(null);
    try {
      const job = await api.startLtxGenerate({
        prompt,
        negative_prompt: negativePrompt,
        width,
        height,
        num_frames: numFrames,
        frame_rate: frameRate,
        num_inference_steps: steps,
        cfg_scale: cfgScale,
        stg_scale: stgScale,
        seed: seed ?? -1,
        offload_mode: offloadMode,
        loras: ltxForm.loras,
      }, inputImage?.file);
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

  let statusPill: React.ReactNode;
  if (result?.status === "running") {
    statusPill = <span className="status-pill running">running</span>;
  } else if (result?.status === "pending") {
    statusPill = <span className="status-pill pending">pending</span>;
  } else if (isDone) {
    statusPill = <span className="status-pill completed">done</span>;
  } else if (isFailed) {
    statusPill = <span className="status-pill failed">failed</span>;
  } else {
    statusPill = <span className="status-pill pending">idle</span>;
  }

  const currentLoras = arch === "ltx" ? ltxForm.loras : wanForm.loras;
  const setCurrentLoras = (loras: GenerateLoraSpec[]) => {
    if (arch === "ltx") setLtxForm((f) => ({ ...f, loras }));
    else setWanForm((f) => ({ ...f, loras }));
  };

  return (
    <div className="split-page generate-page">
      {/* Left rail */}
      <div className="generate-rail">
        <form className="generate-rail-form" onSubmit={handleSubmit}>
          <section className="section-card generate-settings-card">
            <div className="generate-settings-header-row">
              <span className="generate-settings-title">Video</span>
              <div className="arch-toggle">
                <button
                  type="button"
                  className={`arch-btn${arch === "ltx" ? " active" : ""}`}
                  onClick={() => setArch("ltx")}
                >
                  LTX-2.3
                </button>
                <button
                  type="button"
                  className={`arch-btn${arch === "wan" ? " active" : ""}`}
                  onClick={() => setArch("wan")}
                >
                  Wan 2.2
                </button>
              </div>
            </div>

            <div className="generate-settings-shell">
              <div className="generate-settings-tabs" role="tablist" aria-label="Video settings sections">
                {VIDEO_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={`generate-settings-tab${activeTab === tab.id ? " active" : ""}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="generate-settings-body">
                {/* ── Model tab ── */}
                {activeTab === "model" && arch === "ltx" ? (
                  <>
                    <label>
                      <span>Install Path</span>
                      <input
                        value={ltxForm.ltx_install_path}
                        onChange={(e) => setLtxForm((f) => ({ ...f, ltx_install_path: e.target.value }))}
                        placeholder="/path/to/LTX-Video"
                      />
                    </label>
                    <label>
                      <span>Model Path</span>
                      <input
                        value={ltxForm.model_path}
                        onChange={(e) => setLtxForm((f) => ({ ...f, model_path: e.target.value }))}
                        placeholder="/path/to/ltx_video.safetensors"
                      />
                    </label>
                    <label>
                      <span>Spatial Upscaler</span>
                      <input
                        value={ltxForm.spatial_upscaler_path}
                        onChange={(e) => setLtxForm((f) => ({ ...f, spatial_upscaler_path: e.target.value }))}
                        placeholder="/path/to/spatial_upscaler.safetensors"
                      />
                    </label>
                    <label>
                      <span>Temporal Upscaler</span>
                      <input
                        value={ltxForm.temporal_upscaler_path}
                        onChange={(e) => setLtxForm((f) => ({ ...f, temporal_upscaler_path: e.target.value }))}
                        placeholder="/path/to/temporal_upscaler.safetensors"
                      />
                    </label>
                    <label>
                      <span>Text Encoder Repo</span>
                      <input
                        value={ltxForm.text_encoder_repo_id}
                        onChange={(e) => setLtxForm((f) => ({ ...f, text_encoder_repo_id: e.target.value }))}
                        placeholder="google/t5-v1_1-xxl"
                      />
                    </label>
                    <LoraStack loras={ltxForm.loras} onChange={(loras) => setLtxForm((f) => ({ ...f, loras }))} />
                  </>
                ) : null}

                {activeTab === "model" && arch === "wan" ? (
                  <>
                    <label>
                      <span>Model Path</span>
                      <input
                        value={wanForm.model_path}
                        onChange={(e) => setWanForm((f) => ({ ...f, model_path: e.target.value }))}
                        placeholder="/path/to/wan_model"
                      />
                    </label>
                    <LoraStack loras={wanForm.loras} onChange={(loras) => setWanForm((f) => ({ ...f, loras }))} />
                    <p className="panel-muted">Wan 2.2 generation support is coming soon.</p>
                  </>
                ) : null}

                {/* ── Canvas tab ── */}
                {activeTab === "canvas" ? (
                  <>
                    <label>
                      <span>Preset</span>
                      <select value={canvasPreset} onChange={(e) => handleCanvasPreset(e.target.value)}>
                        {CANVAS_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </label>
                    <div className="canvas-dimension-row">
                      <label className="canvas-dimension-label">
                        <span>Width</span>
                        <input
                          type="number" min={64} step={8}
                          value={width}
                          disabled={canvasPreset !== "manual"}
                          onChange={(e) => setWidth(Number(e.target.value))}
                        />
                      </label>
                      <button
                        type="button"
                        className="dimension-swap-btn"
                        title="Swap width and height"
                        onClick={() => {
                          setCanvasPreset("manual");
                          setWidth(height);
                          setHeight(width);
                        }}
                      >⇄</button>
                      <label className="canvas-dimension-label">
                        <span>Height</span>
                        <input
                          type="number" min={64} step={8}
                          value={height}
                          disabled={canvasPreset !== "manual"}
                          onChange={(e) => setHeight(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    <div className="generate-grid">
                      <label>
                        <span>Frames</span>
                        <input
                          type="number" min={1} step={1}
                          value={numFrames}
                          onChange={(e) => setNumFrames(Number(e.target.value))}
                        />
                      </label>
                      <label>
                        <span>Frame Rate</span>
                        <input
                          type="number" min={1} max={60} step={1}
                          value={frameRate}
                          onChange={(e) => setFrameRate(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    <p className="panel-muted">
                      {width} × {height} · {numFrames} frames · {frameRate} fps
                      {" "}({(numFrames / frameRate).toFixed(1)}s)
                    </p>
                  </>
                ) : null}

                {/* ── Parameters tab ── */}
                {activeTab === "parameters" ? (
                  <>
                    <div className="generate-grid">
                      <label>
                        <span>Steps</span>
                        <input type="number" min={1} value={steps}
                          onChange={(e) => setSteps(Number(e.target.value))} />
                      </label>
                      <label>
                        <span>Seed</span>
                        <input type="number" value={seed ?? ""} placeholder="random"
                          onChange={(e) => setSeed(e.target.value === "" ? null : Number(e.target.value))} />
                      </label>
                    </div>
                    {arch === "ltx" ? (
                      <>
                        <div className="generate-grid">
                          <label>
                            <span>CFG Scale</span>
                            <input type="number" min={0} step={0.1} value={cfgScale}
                              onChange={(e) => setCfgScale(Number(e.target.value))} />
                          </label>
                          <label>
                            <span>STG Scale</span>
                            <input type="number" min={0} step={0.1} value={stgScale}
                              onChange={(e) => setStgScale(Number(e.target.value))} />
                          </label>
                        </div>
                        <label>
                          <span>Offload Mode</span>
                          <select value={offloadMode} onChange={(e) => setOffloadMode(e.target.value)}>
                            {OFFLOAD_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </label>
                      </>
                    ) : null}
                  </>
                ) : null}

                {/* ── Prompt tab ── */}
                {activeTab === "prompt" ? (
                  <>
                    {/* Image-to-Video input */}
                    <div>
                      <div className="section-inline-header" style={{ marginBottom: 6 }}>
                        <span className="eyebrow no-margin">Input Image</span>
                        <span className="panel-muted" style={{ fontSize: "0.72rem" }}>optional · I2V</span>
                      </div>
                      {inputImage ? (
                        <div className="i2v-preview-wrap">
                          <img src={inputImage.objectUrl} className="i2v-preview" alt="Input frame" />
                          <button
                            type="button"
                            className="i2v-remove-btn"
                            aria-label="Remove input image"
                            onClick={() => {
                              URL.revokeObjectURL(inputImage.objectUrl);
                              setInputImage(null);
                            }}
                          >×</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="i2v-upload-btn"
                          onClick={() => imageInputRef.current?.click()}
                        >
                          <span>＋</span>
                          <span>Add starting frame</span>
                        </button>
                      )}
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (inputImage) URL.revokeObjectURL(inputImage.objectUrl);
                          setInputImage({ file, objectUrl: URL.createObjectURL(file) });
                          e.target.value = "";
                        }}
                      />
                    </div>

                    <label>
                      <span>Positive Prompt</span>
                      <textarea
                        rows={5}
                        value={prompt}
                        placeholder="Describe the video to generate…"
                        onChange={(e) => setPrompt(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>Negative Prompt</span>
                      <textarea
                        rows={3}
                        value={negativePrompt}
                        placeholder="Things to avoid…"
                        onChange={(e) => setNegativePrompt(e.target.value)}
                      />
                    </label>
                  </>
                ) : null}
              </div>
            </div>
          </section>

          {error ? <div className="error-banner">{error}</div> : null}

          <button
            className="primary-button"
            type="submit"
            disabled={isSubmitting || isRunning}
          >
            {isSubmitting ? "Starting…" : isRunning ? "Generating…" : arch === "wan" ? "Generate (coming soon)" : "Generate"}
          </button>
        </form>
      </div>

      {/* Right panel */}
      <div className="main-panel generate-pipeline">
        <div className="pipeline-step-card">
          <div className="pipeline-step-header">
            <div className="pipeline-step-dot" style={{ background: arch === "ltx" ? "#a78bfa" : "#34d399" }} />
            <span className="pipeline-step-name">
              {arch === "ltx" ? "LTX-2.3 · Video" : "Wan 2.2 · Video"}
            </span>
            {statusPill}
          </div>

          <div className="pipeline-step-body">
            {isRunning && result ? (
              <GenerationProgress
                status={result.status === "pending" ? "running" : result.status}
                currentStep={result.current_step}
                totalSteps={result.total_steps}
                rateValue={result.rate_value}
                rateUnit={result.rate_unit}
                stage={result.stage}
                width={width}
                height={height}
              />
            ) : null}

            {isDone && result?.video_url ? (
              <div className="video-result-wrap">
                <video
                  ref={videoRef}
                  src={result.video_url}
                  className="video-result"
                  controls
                  loop
                  playsInline
                  style={{ aspectRatio: `${width} / ${height}` }}
                />
                <div className="video-result-actions">
                  <a
                    href={result.video_url}
                    download
                    className="secondary-button"
                  >
                    Download
                  </a>
                </div>
              </div>
            ) : isFailed ? (
              <div className="error-banner">{result?.error ?? "Generation failed."}</div>
            ) : !result ? (
              <div className="empty-state">
                Configure settings and click Generate to create a video.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
