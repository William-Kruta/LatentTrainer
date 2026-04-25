interface ConfigOption {
  id: number;
  name: string;
}

interface ConfigSaveRowProps {
  name: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  isSaving: boolean;
  configs: ConfigOption[];
  onLoad: (id: number) => void;
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
  feedback,
  namePlaceholder = "Config name",
}: ConfigSaveRowProps) {
  return (
    <div className="page-stack">
      <div className="generate-config-row">
        <label className="generate-config-name">
          <span>Config Name</span>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={namePlaceholder}
          />
        </label>
        <button
          className="secondary-button"
          type="button"
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
      <label>
        <span>Load Config</span>
        <select
          defaultValue=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onLoad(id);
          }}
        >
          <option value="">Select saved config</option>
          {configs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {feedback === "saved" ? <div className="save-feedback success">Saved</div> : null}
      {feedback === "error" ? <div className="save-feedback error">Save failed</div> : null}
    </div>
  );
}
