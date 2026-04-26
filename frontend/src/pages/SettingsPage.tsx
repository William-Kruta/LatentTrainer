import { useEffect, useState } from "react";
import { ApiError, api, type AppSettings, type GenerateLoraSpec, type LtxModelConfig } from "../lib/api";
import { useToast } from "../components/Toast";
import { PathCombobox } from "../components/generate/PathCombobox";
import { LoraStack } from "../components/generate/LoraStack";

// ── Root section ─────────────────────────────────────────────────────────────

const defaultSettings: AppSettings = {
  model_root: "",
  lora_root: "",
  output_root: "",
  dataset_root: "",
};

function RootSection() {
  const toast = useToast();
  const [form, setForm] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then(setForm).catch(() => toast.error("Failed to load settings.")).finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const saved = await api.updateSettings(form);
      setForm(saved);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <span className="panel-muted">Loading…</span>;

  return (
    <form className="section-card settings-form" onSubmit={handleSubmit}>
      <div className="settings-group">
        <div className="eyebrow settings-group-label">Root Directories</div>
        <p className="panel-muted settings-group-hint">
          Base paths used to browse for models, LoRAs, outputs, and datasets throughout the app.
        </p>
        <label>
          <span>Model Root</span>
          <input value={form.model_root} onChange={(e) => setForm({ ...form, model_root: e.target.value })} placeholder="/path/to/models" />
        </label>
        <label>
          <span>LoRA Root</span>
          <input value={form.lora_root} onChange={(e) => setForm({ ...form, lora_root: e.target.value })} placeholder="/path/to/loras" />
        </label>
        <label>
          <span>Output Root</span>
          <input value={form.output_root} onChange={(e) => setForm({ ...form, output_root: e.target.value })} placeholder="/path/to/outputs" />
        </label>
        <label>
          <span>Dataset Root</span>
          <input value={form.dataset_root} onChange={(e) => setForm({ ...form, dataset_root: e.target.value })} placeholder="/path/to/datasets" />
        </label>
      </div>
      <div className="settings-footer">
        <button className="primary-button" type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </form>
  );
}

// ── LTX-2.3 section ──────────────────────────────────────────────────────────

const defaultLtx: LtxModelConfig = {
  ltx_install_path: "",
  model_path: "",
  spatial_upscaler_path: "",
  temporal_upscaler_path: "",
  text_encoder_repo_id: "",
  loras: [],
};

function LtxSection() {
  const toast = useToast();
  const [form, setForm] = useState<LtxModelConfig>(defaultLtx);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [modelRoot, setModelRoot] = useState("");
  const [modelFiles, setModelFiles] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([api.getLtxConfig(), api.getModelFiles()])
      .then(([config, mf]) => {
        setForm(config);
        setModelRoot(mf.model_root);
        setModelFiles(mf.files);
      })
      .catch(() => toast.error("Failed to load LTX config."))
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const saved = await api.updateLtxConfig(form);
      setForm(saved);
      toast.success("LTX-2.3 config saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save LTX config.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) return <span className="panel-muted">Loading…</span>;

  return (
    <form className="section-card settings-form" onSubmit={handleSubmit}>
      <div className="settings-group">
        <div className="eyebrow settings-group-label">Installation</div>
        <p className="panel-muted settings-group-hint">
          Path to the cloned LTX-2 repository (e.g. /mnt/ml/LTX-2). The worker uses the .venv inside it.
        </p>
        <label>
          <span>LTX-2 Repo Path</span>
          <input
            value={form.ltx_install_path}
            onChange={(e) => setForm({ ...form, ltx_install_path: e.target.value })}
            placeholder="/path/to/LTX-2"
          />
        </label>
      </div>

      <div className="settings-group">
        <div className="eyebrow settings-group-label">Model</div>

        <label>
          <span>Model Checkpoint (.safetensors)</span>
          <PathCombobox
            value={form.model_path}
            root={modelRoot}
            files={modelFiles}
            onChange={(p) => setForm({ ...form, model_path: p })}
            placeholder="/path/to/ltx-2.3.safetensors"
            noFilesPlaceholder="No model root configured in Root settings"
          />
        </label>

        <label>
          <span>Text Encoder (HuggingFace Repo ID)</span>
          <input
            value={form.text_encoder_repo_id}
            onChange={(e) => setForm({ ...form, text_encoder_repo_id: e.target.value })}
            placeholder="google/gemma-3-27b-pt"
          />
        </label>
      </div>

      <div className="settings-group">
        <div className="eyebrow settings-group-label">Upscalers</div>

        <label>
          <span>Spatial Upscaler</span>
          <PathCombobox
            value={form.spatial_upscaler_path}
            root={modelRoot}
            files={modelFiles}
            onChange={(p) => setForm({ ...form, spatial_upscaler_path: p })}
            placeholder="/path/to/spatial_upscaler.safetensors"
            noFilesPlaceholder="No model root configured"
          />
        </label>

        <label>
          <span>Temporal Upscaler</span>
          <PathCombobox
            value={form.temporal_upscaler_path}
            root={modelRoot}
            files={modelFiles}
            onChange={(p) => setForm({ ...form, temporal_upscaler_path: p })}
            placeholder="/path/to/temporal_upscaler.safetensors"
            noFilesPlaceholder="No model root configured"
          />
        </label>
      </div>

      <div className="settings-group">
        <div className="eyebrow settings-group-label">LoRAs</div>
        <LoraStack
          loras={form.loras}
          onChange={(loras) => setForm({ ...form, loras: loras as GenerateLoraSpec[] })}
        />
      </div>

      <div className="settings-footer">
        <button className="primary-button" type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save LTX Config"}
        </button>
      </div>
    </form>
  );
}

// ── Model section (sub-tabs) ──────────────────────────────────────────────────

type ModelTab = "ltx";

function ModelSection() {
  const [tab, setTab] = useState<ModelTab>("ltx");

  return (
    <div className="settings-model-section">
      <div className="settings-subtabs">
        <button
          type="button"
          className={`settings-subtab${tab === "ltx" ? " active" : ""}`}
          onClick={() => setTab("ltx")}
        >
          LTX-2.3
        </button>
      </div>
      {tab === "ltx" ? <LtxSection /> : null}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type SettingsSection = "root" | "model";

export function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>("root");

  return (
    <div className="page-stack">
      <div className="settings-page-header">
        <div>
          <div className="eyebrow">Configuration</div>
          <h2>Settings</h2>
        </div>
        <select
          className="settings-section-select"
          value={section}
          onChange={(e) => setSection(e.target.value as SettingsSection)}
        >
          <option value="root">Root</option>
          <option value="model">Model</option>
        </select>
      </div>

      {section === "root" ? <RootSection /> : <ModelSection />}
    </div>
  );
}
