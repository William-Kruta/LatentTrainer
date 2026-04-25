import { useState } from "react";
import type { PromptEnhanceSettings } from "../../lib/api";

interface PromptEnhanceSettingsModalProps {
  initialSettings: PromptEnhanceSettings;
  onClose: () => void;
  onSave: (settings: PromptEnhanceSettings) => void;
}

export function PromptEnhanceSettingsModal({
  initialSettings,
  onClose,
  onSave,
}: PromptEnhanceSettingsModalProps) {
  const [form, setForm] = useState<PromptEnhanceSettings>(initialSettings);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="eyebrow">Prompt Enhance</span>
          <h3>Settings</h3>
        </div>
        <div className="modal-field">
          <label className="modal-label">Llama.cpp Server URL</label>
          <input
            value={form.llama_url}
            onChange={(e) => setForm({ ...form, llama_url: e.target.value })}
            placeholder="http://localhost:8080"
          />
        </div>
        <div className="modal-field">
          <label className="modal-label">Model Name</label>
          <input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="Leave blank to omit"
          />
          <span className="modal-hint">Only needed if your server requires a specific model name.</span>
        </div>
        <div className="modal-field">
          <label className="modal-label">System Prompt</label>
          <textarea
            className="modal-textarea"
            rows={5}
            value={form.system_prompt}
            onChange={(e) => setForm({ ...form, system_prompt: e.target.value })}
          />
        </div>
        <div className="modal-field">
          <label className="modal-label">Max Tokens</label>
          <input
            type="number"
            min={64}
            max={4096}
            value={form.max_tokens}
            onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })}
          />
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="button" onClick={() => onSave(form)}>Save</button>
        </div>
      </div>
    </div>
  );
}
