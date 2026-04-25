import type { GenerateLoraSpec } from "../../lib/api";

interface LoraCardProps {
  lora: GenerateLoraSpec;
  index: number;
  onUpdate: (lora: GenerateLoraSpec) => void;
  onRemove: () => void;
}

export function LoraCard({ lora, index, onUpdate, onRemove }: LoraCardProps) {
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
        <input
          value={lora.path}
          onChange={(e) => onUpdate({ ...lora, path: e.target.value })}
          placeholder="/path/to/lora.safetensors"
        />
      </label>
      <label>
        <span>Strength</span>
        <input
          type="number"
          min={0}
          max={2}
          step="0.05"
          value={lora.strength}
          onChange={(e) =>
            onUpdate({ ...lora, strength: Math.max(0, Math.min(2, Number(e.target.value))) })
          }
        />
      </label>
    </div>
  );
}
