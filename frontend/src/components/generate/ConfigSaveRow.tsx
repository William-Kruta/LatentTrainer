interface ConfigOption {
  id: number;
  name: string;
  pinned?: boolean;
}

interface ConfigSaveRowProps {
  name: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  isSaving: boolean;
  configs: ConfigOption[];
  onLoad: (id: number) => void;
  onPin?: (id: number, pinned: boolean) => void;
  feedback: "idle" | "saved" | "error";
  namePlaceholder?: string;
}

export function ConfigSaveRow({
  name,
  onNameChange,
  onSave,
  isSaving,
  configs,
  onLoad,
  onPin,
  feedback,
  namePlaceholder = "Config name",
}: ConfigSaveRowProps) {
  const matchedConfig = configs.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());

  return (
    <div className="config-bar">
      <div className="config-bar-save">
        <input
          className="config-bar-input"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={namePlaceholder}
        />
        {matchedConfig && onPin ? (
          <button
            className={`config-pin-btn${matchedConfig.pinned ? " pinned" : ""}`}
            type="button"
            title={matchedConfig.pinned ? "Unpin config" : "Pin config to top"}
            onClick={() => onPin(matchedConfig.id, !matchedConfig.pinned)}
          >
            📌
          </button>
        ) : null}
        <button
          className={`config-save-btn${feedback === "saved" ? " saved" : feedback === "error" ? " error" : ""}`}
          type="button"
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving ? "…" : feedback === "saved" ? "✓" : "Save"}
        </button>
      </div>
      {configs.length > 0 ? (
        <select
          className="config-load-select"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onLoad(id);
          }}
        >
          <option value="">Load a config…</option>
          {configs.map((c) => (
            <option key={c.id} value={c.id}>{c.pinned ? "📌 " : ""}{c.name}</option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
