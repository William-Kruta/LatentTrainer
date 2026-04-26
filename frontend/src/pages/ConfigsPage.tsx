import type { ReactNode } from "react";

import { PageSection } from "../components/PageSection";
import {
  type Config,
  type ConfigOptions,
  type GenerateConfig,
} from "../lib/api";
import { type ConfigMode, useConfigForm } from "../hooks/useConfigForm";
const GENERATE_SAMPLER_OPTIONS = [
  "euler",
  "euler_a",
  "dpm++_2m",
  "dpm++_2m_karras",
  "dpm++_sde",
  "dpm++_sde_karras",
  "ddim",
  "unipc",
  "heun",
  "lms",
];

export function ConfigsPage() {
  const {
    mode,
    setMode,
    configs,
    config,
    generateConfigs,
    generateConfig,
    configOptions,
    saveStatus,
    setSaveStatus,
    importInputRef,
    loadConfig,
    loadGenerateConfig,
    saveConfig,
    newConfig,
    duplicateConfig,
    deleteConfig,
    exportConfig,
    handleImportFile,
    setField,
    setGenerateField,
    activeSelectedId,
    activeTitle,
  } = useConfigForm();

  return (
    <div className="split-page tall">
      <PageSection
        eyebrow="Saved Presets"
        title="Configs"
        className="left-rail"
        bare
        actions={
          <div className="left-rail-controls">
            <select value={mode} onChange={(event) => { setMode(event.target.value as ConfigMode); setSaveStatus("idle"); }}>
              <option value="training">Training</option>
              <option value="generate">Generate</option>
            </select>
            <div className="left-rail-btn-row">
              <button className="secondary-button" type="button" onClick={exportConfig}>Export</button>
              <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()}>Import</button>
              <button className="secondary-button" type="button" onClick={newConfig}>New</button>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleImportFile(file);
                }
                event.target.value = "";
              }}
            />
          </div>
        }
      >
        <div className="list-stack">
          {mode === "training"
            ? configs.map((item) => (
                <button
                  key={item.id}
                  className={`list-item ${activeSelectedId === item.id ? "active" : ""}`}
                  onClick={() => void loadConfig(item.id)}
                  type="button"
                >
                  <strong>{item.name}</strong>
                  <span>{item.max_steps} steps · lr {item.learning_rate}</span>
                </button>
              ))
            : generateConfigs.map((item) => (
                <button
                  key={item.id}
                  className={`list-item ${activeSelectedId === item.id ? "active" : ""}`}
                  onClick={() => void loadGenerateConfig(item.id)}
                  type="button"
                >
                  <strong>{item.name}</strong>
                  <span>Updated {new Date(item.updated_at).toLocaleString()}</span>
                </button>
              ))}
        </div>
      </PageSection>

      <PageSection
        eyebrow="Editor"
        title={activeTitle}
        className="main-panel"
        bare
        actions={
          <>
            {saveStatus === "saved" ? <span className="save-feedback success">Saved</span> : null}
            {saveStatus === "error" ? <span className="save-feedback error">Save failed</span> : null}
            <button className="secondary-button" type="button" onClick={() => void duplicateConfig()}>Duplicate</button>
            <button className="danger-button" type="button" onClick={() => void deleteConfig()}>Delete</button>
            <button className="primary-button" onClick={() => void saveConfig()} type="button">Save</button>
          </>
        }
      >
        {mode === "training" ? (
          config ? (
            <TrainingConfigEditor config={config} configOptions={configOptions} setField={setField} />
          ) : (
            <div className="empty-state">No configuration selected.</div>
          )
        ) : generateConfig ? (
          <GenerateConfigEditor config={generateConfig} setField={setGenerateField} />
        ) : (
          <div className="empty-state">No generate configuration selected.</div>
        )}
      </PageSection>
    </div>
  );
}

function TrainingConfigEditor({
  config,
  configOptions,
  setField,
}: {
  config: Config;
  configOptions: ConfigOptions;
  setField: <K extends keyof Config>(field: K, value: Config[K]) => void;
}) {
  return (
    <div className="config-editor">
      <div className="config-card">
        <div className="eyebrow">Name</div>
        <input value={config.name} onChange={(event) => setField("name", event.target.value)} placeholder="config_name" />
      </div>

      <div className="config-card">
        <div className="eyebrow">Model</div>
        <div className="model-path-row">
          <input value={config.model_path} onChange={(event) => setField("model_path", event.target.value)} />
          <button className="secondary-button" type="button">Browse</button>
        </div>
      </div>

      <div className="config-grid">
        <ConfigCard title="Training">
          <FieldRow label="Max Steps"><input type="number" value={config.max_steps} onChange={(event) => setField("max_steps", Number(event.target.value))} /></FieldRow>
          <FieldRow label="Learning Rate"><input value={config.learning_rate} onChange={(event) => setField("learning_rate", Number(event.target.value))} /></FieldRow>
          <FieldRow label="Batch Size"><input type="number" value={config.batch_size} onChange={(event) => setField("batch_size", Number(event.target.value))} /></FieldRow>
          <FieldRow label="Resolution"><input type="number" value={config.resolution} onChange={(event) => setField("resolution", Number(event.target.value))} /></FieldRow>
        </ConfigCard>

        <div className="config-card full-width">
          <div className="eyebrow">Cache Latents</div>
          <div className="toggle-row">
            <ToggleCard label="Cache Latents" description="Pre-encode images through the VAE and cache in memory. Speeds up training." checked={config.cache_latents} onChange={(checked) => { setField("cache_latents", checked); if (checked) setField("cache_latents_to_disk", false); }} />
            <ToggleCard label="Cache to Disk" description="Save cached latents as .npz files on disk instead of memory. Saves VRAM." checked={config.cache_latents_to_disk} onChange={(checked) => { setField("cache_latents_to_disk", checked); if (checked) setField("cache_latents", false); }} />
          </div>
        </div>

        <div className="config-card full-width">
          <div className="eyebrow">Cache Text Encoder Outputs</div>
          <div className="toggle-row">
            <ToggleCard label="Cache Text Embeddings" description="Pre-encode prompts through both text encoders and cache in memory." checked={config.cache_text_encoder_outputs} onChange={(checked) => { setField("cache_text_encoder_outputs", checked); if (checked) setField("cache_text_encoder_outputs_to_disk", false); }} />
            <ToggleCard label="Cache to Disk" description="Save cached text embeddings as .npz files on disk instead of memory." checked={config.cache_text_encoder_outputs_to_disk} onChange={(checked) => { setField("cache_text_encoder_outputs_to_disk", checked); if (checked) setField("cache_text_encoder_outputs", false); }} />
          </div>
        </div>

        <ConfigCard title="Optimizer">
          <FieldRow label="Optimizer">
            <select value={config.optimizer} onChange={(event) => setField("optimizer", event.target.value)}>
              {configOptions.optimizers.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="LR Scheduler">
            <select value={config.lr_scheduler} onChange={(event) => setField("lr_scheduler", event.target.value)}>
              {configOptions.lr_schedulers.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="Warmup Steps"><input type="number" value={config.warmup_steps} onChange={(event) => setField("warmup_steps", Number(event.target.value))} /></FieldRow>
        </ConfigCard>

        <ConfigCard title="LoRA">
          <FieldRow label="Network Dim"><input type="number" value={config.network_dim} onChange={(event) => setField("network_dim", Number(event.target.value))} /></FieldRow>
          <FieldRow label="Network Alpha"><input type="number" value={config.network_alpha} onChange={(event) => setField("network_alpha", Number(event.target.value))} /></FieldRow>
        </ConfigCard>

        <ConfigCard title="Saving">
          <FieldRow label="Save Every N Steps"><input type="number" value={config.save_every_n_steps} onChange={(event) => setField("save_every_n_steps", Number(event.target.value))} /></FieldRow>
          <FieldRow label="Save Format">
            <select value={config.save_format} onChange={(event) => setField("save_format", event.target.value)}>
              {configOptions.save_formats.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </FieldRow>
          <FieldRow label="Mixed Precision">
            <select value={config.mixed_precision} onChange={(event) => setField("mixed_precision", event.target.value)}>
              {configOptions.mixed_precision_modes.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </FieldRow>
        </ConfigCard>

        <div className="config-card full-width">
          <div className="eyebrow">Sampling</div>
          <div className="sampling-grid">
            <FieldRow label="Sample Every N Steps"><input type="number" value={config.sample_every_n_steps} onChange={(event) => setField("sample_every_n_steps", Number(event.target.value))} /></FieldRow>
            <FieldRow label="Sample Steps"><input type="number" value={config.sample_steps} onChange={(event) => setField("sample_steps", Number(event.target.value))} /></FieldRow>
            <FieldRow label="CFG"><input value={config.sample_cfg} onChange={(event) => setField("sample_cfg", Number(event.target.value))} /></FieldRow>
          </div>
          <div className="toggle-row">
            <ToggleCard label="Skip First Sample" description="Skip sampling at step 0." checked={config.skip_first_sample} onChange={(checked) => setField("skip_first_sample", checked)} />
            <ToggleCard label="Disable Sampling" description="Turn off all sampling during training." checked={config.disable_sampling} onChange={(checked) => setField("disable_sampling", checked)} />
          </div>
        </div>
      </div>

      <div className="config-card">
        <div className="section-header">
          <div>
            <div className="eyebrow">Sample Prompts</div>
            <h3>Prompt Cards</h3>
          </div>
          <button className="secondary-button" type="button" onClick={() => setField("sample_prompts", [...config.sample_prompts, { prompt: "", width: 1024, height: 1024, seed: 42, lora_scale: 1.0 }])}>Add Prompt</button>
        </div>
        <div className="prompt-stack">
          {config.sample_prompts.map((prompt, index) => (
            <div key={index} className="prompt-card">
              <div className="prompt-header">
                <input value={prompt.prompt} placeholder="Enter sample prompt..." onChange={(event) => {
                  const nextPrompts = [...config.sample_prompts];
                  nextPrompts[index] = { ...prompt, prompt: event.target.value };
                  setField("sample_prompts", nextPrompts);
                }} />
                <button className="prompt-delete" type="button" onClick={() => setField("sample_prompts", config.sample_prompts.filter((_, i) => i !== index))}>✕</button>
              </div>
              <div className="prompt-grid">
                <FieldColumn label="Width" value={prompt.width} onChange={(val) => {
                  const nextPrompts = [...config.sample_prompts];
                  nextPrompts[index] = { ...prompt, width: val };
                  setField("sample_prompts", nextPrompts);
                }} />
                <FieldColumn label="Height" value={prompt.height} onChange={(val) => {
                  const nextPrompts = [...config.sample_prompts];
                  nextPrompts[index] = { ...prompt, height: val };
                  setField("sample_prompts", nextPrompts);
                }} />
                <FieldColumn label="Seed" value={prompt.seed} onChange={(val) => {
                  const nextPrompts = [...config.sample_prompts];
                  nextPrompts[index] = { ...prompt, seed: val };
                  setField("sample_prompts", nextPrompts);
                }} />
                <FieldColumn label="LoRA Scale" value={prompt.lora_scale} onChange={(val) => {
                  const nextPrompts = [...config.sample_prompts];
                  nextPrompts[index] = { ...prompt, lora_scale: val };
                  setField("sample_prompts", nextPrompts);
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GenerateConfigEditor({
  config,
  setField,
}: {
  config: GenerateConfig;
  setField: <K extends keyof GenerateConfig>(field: K, value: GenerateConfig[K]) => void;
}) {
  return (
    <div className="config-editor">
      <div className="config-card">
        <div className="eyebrow">Name</div>
        <input value={config.name} onChange={(event) => setField("name", event.target.value)} placeholder="generate_config_name" />
      </div>

      <div className="config-grid">
        <ConfigCard title="Setup">
          <FieldRow label="Architecture">
            <select value={config.architecture} onChange={(event) => setField("architecture", event.target.value)}>
              <option value="sdxl">SDXL</option>
              <option value="chroma">Chroma</option>
            </select>
          </FieldRow>
          <FieldRow label="Model Path"><input value={config.model_path} onChange={(event) => setField("model_path", event.target.value)} /></FieldRow>
          <FieldRow label="Chroma Repo"><input value={config.chroma_pipeline_repo} onChange={(event) => setField("chroma_pipeline_repo", event.target.value)} /></FieldRow>
          <FieldRow label="Prompt Enhance">
            <input type="checkbox" checked={config.prompt_enhance} onChange={(event) => setField("prompt_enhance", event.target.checked)} />
          </FieldRow>
        </ConfigCard>

        <ConfigCard title="Parameters">
          <FieldRow label="Steps"><input type="number" value={config.steps} onChange={(event) => setField("steps", Number(event.target.value))} /></FieldRow>
          <FieldRow label="CFG"><input type="number" step="0.5" value={config.cfg_scale} onChange={(event) => setField("cfg_scale", Number(event.target.value))} /></FieldRow>
          <FieldRow label="Batch Count"><input type="number" min={1} max={16} value={config.batch_count} onChange={(event) => setField("batch_count", Number(event.target.value))} /></FieldRow>
          <FieldRow label="Sampler">
            <select value={config.sampler} onChange={(event) => setField("sampler", event.target.value)}>
              {GENERATE_SAMPLER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </FieldRow>
        </ConfigCard>

        <ConfigCard title="Canvas">
          <FieldRow label="Width"><input type="number" value={config.width} onChange={(event) => setField("width", Number(event.target.value))} /></FieldRow>
          <FieldRow label="Height"><input type="number" value={config.height} onChange={(event) => setField("height", Number(event.target.value))} /></FieldRow>
          <FieldRow label="Seed"><input type="number" value={config.seed ?? ""} onChange={(event) => setField("seed", event.target.value === "" ? null : Number(event.target.value))} /></FieldRow>
        </ConfigCard>

        <div className="config-card full-width">
          <div className="eyebrow">Prompts</div>
          <div className="field-stack">
            <label>
              <span className="eyebrow">Positive Prompt</span>
              <textarea rows={5} value={config.positive_prompt} onChange={(event) => setField("positive_prompt", event.target.value)} />
            </label>
            <label>
              <span className="eyebrow">Negative Prompt</span>
              <textarea rows={4} value={config.negative_prompt} onChange={(event) => setField("negative_prompt", event.target.value)} />
            </label>
          </div>
        </div>

        <div className="config-card full-width">
          <div className="eyebrow">Prompt Enhance Settings</div>
          <div className="sampling-grid">
            <FieldRow label="Llama URL"><input value={config.prompt_enhance_settings.llama_url} onChange={(event) => setField("prompt_enhance_settings", { ...config.prompt_enhance_settings, llama_url: event.target.value })} /></FieldRow>
            <FieldRow label="Model"><input value={config.prompt_enhance_settings.model} onChange={(event) => setField("prompt_enhance_settings", { ...config.prompt_enhance_settings, model: event.target.value })} /></FieldRow>
            <FieldRow label="Max Tokens"><input type="number" value={config.prompt_enhance_settings.max_tokens} onChange={(event) => setField("prompt_enhance_settings", { ...config.prompt_enhance_settings, max_tokens: Number(event.target.value) })} /></FieldRow>
          </div>
          <label className="field-column" style={{ marginTop: 10 }}>
            <span>System Prompt</span>
            <textarea rows={4} value={config.prompt_enhance_settings.system_prompt} onChange={(event) => setField("prompt_enhance_settings", { ...config.prompt_enhance_settings, system_prompt: event.target.value })} />
          </label>
        </div>

        <div className="config-card full-width">
          <div className="section-header">
            <div>
              <div className="eyebrow">LoRAs</div>
              <h3>Adapters</h3>
            </div>
            <button className="secondary-button" type="button" onClick={() => setField("loras", [...config.loras, { path: "", strength: 1.0 }])}>Add LoRA</button>
          </div>
          <div className="prompt-stack">
            {config.loras.map((lora, index) => (
              <div key={index} className="prompt-card">
                <div className="prompt-header">
                  <input value={lora.path} placeholder="/path/to/lora.safetensors" onChange={(event) => {
                    const next = [...config.loras];
                    next[index] = { ...lora, path: event.target.value };
                    setField("loras", next);
                  }} />
                  <button className="prompt-delete" type="button" onClick={() => setField("loras", config.loras.filter((_, i) => i !== index))}>✕</button>
                </div>
                <FieldRow label="Strength">
                  <input type="number" min={0} max={1} step="0.05" value={lora.strength} onChange={(event) => {
                    const next = [...config.loras];
                    next[index] = { ...lora, strength: Number(event.target.value) };
                    setField("loras", next);
                  }} />
                </FieldRow>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfigCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="config-card">
      <div className="eyebrow">{title}</div>
      <div className="field-stack">{children}</div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

function FieldColumn({ label, value, onChange }: { label: string; value: number; onChange: (val: number) => void }) {
  return (
    <div className="field-column">
      <span>{label}</span>
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} />
    </div>
  );
}

function ToggleCard({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button className={`toggle-card ${checked ? "checked" : ""}`} onClick={() => onChange(!checked)} type="button">
      <span className="toggle-switch" />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </button>
  );
}
