import { useEffect, useState } from "react";
import { api, type GenerateLoraSpec } from "../../lib/api";
import { LoraCard } from "./LoraCard";

interface LoraStackProps {
  loras: GenerateLoraSpec[];
  onChange: (loras: GenerateLoraSpec[]) => void;
}

export function LoraStack({ loras, onChange }: LoraStackProps) {
  const [loraRoot, setLoraRoot] = useState("");
  const [loraFiles, setLoraFiles] = useState<string[]>([]);

  useEffect(() => {
    api.getLoraFiles().then((res) => {
      setLoraRoot(res.lora_root);
      setLoraFiles(res.files);
    }).catch(() => {/* ignore */});
  }, []);

  function add() {
    onChange([...loras, { path: "", strength: 1.0 }]);
  }

  function update(index: number, lora: GenerateLoraSpec) {
    onChange(loras.map((l, i) => (i === index ? lora : l)));
  }

  function remove(index: number) {
    onChange(loras.filter((_, i) => i !== index));
  }

  return (
    <div className="page-stack">
      <div className="section-inline-header">
        <span className="eyebrow no-margin">LoRAs</span>
        <button className="secondary-button" type="button" onClick={add}>
          Add LoRA
        </button>
      </div>
      {loras.length > 0 ? (
        <div className="lora-stack">
          {loras.map((lora, i) => (
            <LoraCard
              key={i}
              lora={lora}
              index={i}
              loraRoot={loraRoot}
              loraFiles={loraFiles}
              onUpdate={(next) => update(i, next)}
              onRemove={() => remove(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
