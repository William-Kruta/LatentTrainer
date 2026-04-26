import type { GenerateLoraSpec } from "../../lib/api";
import { LoraPathCombobox } from "./LoraPathCombobox";

interface LoraCardProps {
  lora: GenerateLoraSpec;
  index: number;
  loraRoot: string;
  loraFiles: string[];
  onUpdate: (lora: GenerateLoraSpec) => void;
  onRemove: () => void;
}

function pathStem(path: string): string {
  const filename = path.split("/").pop() ?? "";
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function LoraCard({ lora, index, loraRoot, loraFiles, onUpdate, onRemove }: LoraCardProps) {
  const clamp = (v: number) => Math.max(0, Math.min(2, v));
  const stem = lora.path ? pathStem(lora.path) : null;

  return (
    <div className="lora-card">
      <button
        className="lora-delete"
        type="button"
        aria-label={`Remove LoRA ${index + 1}`}
        onClick={onRemove}
      >
        ×
      </button>
      <label>
        <span>LoRA Path</span>
        <LoraPathCombobox
          value={lora.path}
          loraRoot={loraRoot}
          loraFiles={loraFiles}
          onChange={(path) => onUpdate({ ...lora, path })}
        />
      </label>
      {stem ? (
        <div className="path-stem-row">
          <span className="path-stem-label">{stem}</span>
          <button
            type="button"
            className="path-copy-btn"
            title="Copy full path"
            onClick={() => void navigator.clipboard.writeText(lora.path)}
          >⧉</button>
        </div>
      ) : null}
      <div className="lora-strength-row">
        <span className="lora-strength-label">Strength</span>
        <input
          type="range"
          className="lora-strength-slider"
          min={0}
          max={2}
          step={0.05}
          value={lora.strength}
          onChange={(e) => onUpdate({ ...lora, strength: clamp(Number(e.target.value)) })}
        />
        <input
          type="number"
          className="lora-strength-number"
          min={0}
          max={2}
          step={0.05}
          value={lora.strength}
          onChange={(e) => onUpdate({ ...lora, strength: clamp(Number(e.target.value)) })}
        />
      </div>
    </div>
  );
}
