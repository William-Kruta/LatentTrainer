import { useEffect, useRef, useState } from "react";

import { PageSection } from "../components/PageSection";
import { api, type Dataset, type DatasetDetail, type DatasetFile } from "../lib/api";
import { formatBytes } from "../lib/format";

// ── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_KEY = "latenttrainer_autocaption_settings";

interface CaptionSettings {
  llamaUrl: string;
  model: string;
  systemPrompt: string;
  triggerWord: string;
  maxTokens: number;
  overwrite: boolean;
}

const DEFAULT_SETTINGS: CaptionSettings = {
  llamaUrl: "http://localhost:8080",
  model: "",
  systemPrompt: "",
  triggerWord: "",
  maxTokens: 2048,
  overwrite: false,
};

function loadSettings(): CaptionSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: CaptionSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ── FileSystem API helpers ────────────────────────────────────────────────────

interface FSFileEntry {
  isFile: true;
  isDirectory: false;
  name: string;
  file(cb: (f: File) => void): void;
}
interface FSDirEntry {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader(): { readEntries(cb: (entries: (FSFileEntry | FSDirEntry)[]) => void): void };
}
type FSEntry = FSFileEntry | FSDirEntry;

async function readDirectoryFlat(dirEntry: FSDirEntry): Promise<File[]> {
  return new Promise((resolve) => {
    const reader = dirEntry.createReader();
    const allFiles: File[] = [];

    function readBatch() {
      reader.readEntries(async (entries) => {
        if (entries.length === 0) { resolve(allFiles); return; }
        for (const entry of entries) {
          if (entry.isFile) {
            await new Promise<void>((res) => (entry as FSFileEntry).file((f) => { allFiles.push(f); res(); }));
          }
          // skip subdirectories — flat only
        }
        readBatch();
      });
    }
    readBatch();
  });
}

// ── Settings modal ────────────────────────────────────────────────────────────

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<CaptionSettings>(loadSettings);

  function handleSave() {
    saveSettings(form);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="eyebrow">Auto Caption</span>
          <h3>Settings</h3>
        </div>
        <div className="modal-field">
          <label className="modal-label">Llama.cpp Server URL</label>
          <input value={form.llamaUrl} onChange={(e) => setForm({ ...form, llamaUrl: e.target.value })} placeholder="http://localhost:8080" />
        </div>
        <div className="modal-field">
          <label className="modal-label">Model Name</label>
          <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="Leave blank to omit (llama.cpp uses loaded model)" />
          <span className="modal-hint">Only needed if your server requires a specific model name.</span>
        </div>
        <div className="modal-field">
          <label className="modal-label">System Prompt</label>
          <textarea className="modal-textarea" value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} placeholder="Describe this image concisely and accurately." rows={3} />
        </div>
        <div className="modal-field">
          <label className="modal-label">Trigger Word</label>
          <input value={form.triggerWord} onChange={(e) => setForm({ ...form, triggerWord: e.target.value })} placeholder="Leave blank to skip" />
          <span className="modal-hint">Prepended to every generated caption.</span>
        </div>
        <div className="modal-field">
          <label className="modal-label">Max Tokens</label>
          <input type="number" value={form.maxTokens} min={256} max={32768} onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })} />
          <span className="modal-hint">Increase for reasoning models (QwQ, DeepSeek-R1, etc.).</span>
        </div>
        <div className="modal-field">
          <label className="modal-toggle-row">
            <span className="modal-label" style={{ marginBottom: 0 }}>Overwrite existing captions</span>
            <input type="checkbox" checked={form.overwrite} onChange={(e) => setForm({ ...form, overwrite: e.target.checked })} />
          </label>
          <span className="modal-hint">When off, images that already have a caption are skipped.</span>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="button" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── Name prompt modal ─────────────────────────────────────────────────────────

function NamePromptModal({ defaultName, onConfirm, onCancel }: {
  defaultName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(defaultName);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="eyebrow">New Dataset</span>
          <h3>Name this dataset</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <label className="modal-label">Dataset Name</label>
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my_dataset"
            />
          </div>
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
            <button className="primary-button" type="submit" disabled={!name.trim()}>Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Rename modal ──────────────────────────────────────────────────────────────

function RenameModal({
  imageCount,
  onConfirm,
  onCancel,
}: {
  imageCount: number;
  onConfirm: (prefix: string) => void;
  onCancel: () => void;
}) {
  const [prefix, setPrefix] = useState("img_");
  const invalid = !prefix.trim() || /[/\\:*?"<>|]/.test(prefix.trim());

  const preview = prefix.trim()
    ? [`${prefix.trim()}1.png`, `${prefix.trim()}2.png`, imageCount > 2 ? `…` : null, imageCount > 1 ? `${prefix.trim()}${imageCount}.png` : null]
        .filter(Boolean)
    : [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invalid) onConfirm(prefix.trim());
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="eyebrow">Rename Files</span>
          <h3>Choose a prefix</h3>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-field">
            <label className="modal-label">Prefix</label>
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="img_"
            />
            <span className="modal-hint">
              Images and their caption files will be renamed together.
              Numbers start at 1 and increment.
            </span>
          </div>
          {preview.length > 0 && (
            <div className="rename-preview">
              {preview.map((name, i) => (
                <code key={i} className="rename-preview-name">{name}</code>
              ))}
            </div>
          )}
          {invalid && prefix.trim() && (
            <div className="rename-error">Prefix contains invalid characters.</div>
          )}
          <div className="modal-actions">
            <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
            <button className="primary-button" type="submit" disabled={invalid}>
              Rename {imageCount} file{imageCount === 1 ? "" : "s"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Caption cell ──────────────────────────────────────────────────────────────

function CaptionCell({ datasetId, file, overrideCaption }: { datasetId: number; file: DatasetFile; overrideCaption: string | undefined }) {
  const caption = overrideCaption ?? file.caption ?? "";
  const [draft, setDraft] = useState(caption);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setDraft(overrideCaption ?? file.caption ?? ""); }, [overrideCaption, file.caption]);

  async function handleBlur() {
    setSaveStatus("idle");
    const stem = file.filename.replace(/\.[^.]+$/, "");
    try {
      const res = await fetch(`/api/datasets/${datasetId}/caption/${stem}`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: draft,
      });
      setSaveStatus(res.ok ? "saved" : "error");
    } catch {
      setSaveStatus("error");
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
  }

  return (
    <div className="caption-panel">
      <div className="caption-panel-header">
        <span className="eyebrow">Caption — {file.filename}</span>
        {saveStatus === "saved" && <span className="caption-save-ok">Saved ✓</span>}
        {saveStatus === "error" && <span className="caption-save-err">Save failed</span>}
      </div>
      <textarea className="caption-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={handleBlur} placeholder="No caption yet…" rows={3} />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/bmp", "image/gif", "image/tiff"]);

function isImageOrText(f: File) {
  return IMAGE_MIME.has(f.type) || f.name.endsWith(".txt");
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DatasetsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<DatasetDetail | null>(null);
  const [selectedFile, setSelectedFile] = useState<DatasetFile | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [captionOverrides, setCaptionOverrides] = useState<Record<string, string>>({});
  const [captioning, setCaptioning] = useState(false);
  const [captionProgress, setCaptionProgress] = useState("");
  const [captionError, setCaptionError] = useState<string | null>(null);

  const [showRename, setShowRename] = useState(false);

  // Upload state
  const [uploadStatus, setUploadStatus] = useState<{ msg: string; type: "idle" | "busy" | "ok" | "error" }>({ msg: "", type: "idle" });
  const [imageDragOver, setImageDragOver] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const imageDragCounterRef = useRef(0);

  // Name prompt state
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingDefaultName, setPendingDefaultName] = useState("");

  useEffect(() => {
    loadDatasets();
  }, []);

  async function loadDatasets(selectId?: number) {
    const items = await api.getDatasets().catch(() => [] as Dataset[]);
    setDatasets(items);
    const target = selectId ? items.find((d) => d.id === selectId) : items[0];
    if (target) {
      const detail = await api.getDataset(target.id).catch(() => null);
      if (detail) { setSelectedDataset(detail); setSelectedFile(detail.files[0] ?? null); }
    }
  }

  async function selectDataset(datasetId: number) {
    setCaptionOverrides({});
    const detail = await api.getDataset(datasetId);
    setSelectedDataset(detail);
    setSelectedFile(detail.files[0] ?? null);
  }

  // ── Upload: zip ───────────────────────────────────────────────────────────

  async function handleZipUpload(file: File) {
    if (!file.name.endsWith(".zip")) {
      setUploadStatus({ msg: "Please drop a .zip file.", type: "error" });
      return;
    }
    setUploadStatus({ msg: `Uploading ${file.name}…`, type: "busy" });
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/datasets/upload-zip", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const created: Dataset = await res.json();
      setUploadStatus({ msg: `"${created.name}" created.`, type: "ok" });
      await loadDatasets(created.id);
      setTimeout(() => setUploadStatus({ msg: "", type: "idle" }), 3000);
    } catch (err) {
      setUploadStatus({ msg: `Upload failed: ${err instanceof Error ? err.message : "unknown error"}`, type: "error" });
    }
  }

  // ── Upload: new dataset from raw files ────────────────────────────────────

  async function uploadNewDataset(name: string, files: File[]) {
    setUploadStatus({ msg: `Uploading ${files.length} file${files.length !== 1 ? "s" : ""}…`, type: "busy" });
    const form = new FormData();
    form.append("name", name);
    files.forEach((f) => form.append("files", f));
    try {
      const res = await fetch("/api/datasets/upload-files", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const created: Dataset = await res.json();
      setUploadStatus({ msg: `"${created.name}" created.`, type: "ok" });
      await loadDatasets(created.id);
      setTimeout(() => setUploadStatus({ msg: "", type: "idle" }), 3000);
    } catch (err) {
      setUploadStatus({ msg: `Upload failed: ${err instanceof Error ? err.message : "unknown error"}`, type: "error" });
    }
  }

  function promptForName(files: File[], defaultName: string) {
    setPendingFiles(files);
    setPendingDefaultName(defaultName);
    setShowNamePrompt(true);
  }

  async function handleNameConfirm(name: string) {
    setShowNamePrompt(false);
    const files = pendingFiles;
    setPendingFiles([]);
    await uploadNewDataset(name, files);
  }

  function handleNameCancel() {
    setShowNamePrompt(false);
    setPendingFiles([]);
  }

  // ── Left-rail dropzone ────────────────────────────────────────────────────

  async function onDropzoneDrop(e: React.DragEvent) {
    e.preventDefault();
    const items = Array.from(e.dataTransfer.items);
    if (items.length === 0) return;

    // Check if first item is a directory via FileSystem API
    const firstEntry = items[0].webkitGetAsEntry?.() as FSEntry | null;

    if (firstEntry?.isDirectory) {
      // Case 2: folder drop
      const raw = await readDirectoryFlat(firstEntry as FSDirEntry);
      const filtered = raw.filter(isImageOrText);
      if (filtered.length === 0) {
        setUploadStatus({ msg: "No supported files found in folder.", type: "error" });
        return;
      }
      promptForName(filtered, firstEntry.name);
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    if (files.length === 1 && files[0].name.endsWith(".zip")) {
      // Case 1: zip file
      handleZipUpload(files[0]);
    } else {
      // Case 3: raw image / text files
      const filtered = files.filter(isImageOrText);
      if (filtered.length === 0) {
        setUploadStatus({ msg: "Drop a .zip, a folder, or image/.txt files.", type: "error" });
        return;
      }
      promptForName(filtered, "");
    }
  }

  function onDropzoneDragOver(e: React.DragEvent) { e.preventDefault(); }

  // ── Folder picker ─────────────────────────────────────────────────────────

  async function handleFolderInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const filtered = files.filter(isImageOrText);
    if (filtered.length === 0) {
      setUploadStatus({ msg: "No supported files found.", type: "error" });
      return;
    }
    const folderName = files[0].webkitRelativePath.split("/")[0] || "dataset";
    promptForName(filtered, folderName);
  }

  // ── Image upload (drag onto main panel) ──────────────────────────────────

  function onPanelDragEnter(e: React.DragEvent) {
    e.preventDefault();
    imageDragCounterRef.current++;
    if (selectedDataset) setImageDragOver(true);
  }

  function onPanelDragLeave() {
    imageDragCounterRef.current--;
    if (imageDragCounterRef.current === 0) setImageDragOver(false);
  }

  function onPanelDragOver(e: React.DragEvent) { e.preventDefault(); }

  async function onPanelDrop(e: React.DragEvent) {
    e.preventDefault();
    imageDragCounterRef.current = 0;
    setImageDragOver(false);
    if (!selectedDataset) return;

    const files = Array.from(e.dataTransfer.files).filter(isImageOrText);
    if (files.length === 0) {
      setUploadStatus({ msg: "No supported image or .txt files found.", type: "error" });
      return;
    }
    await uploadImagesToDataset(selectedDataset.id, files);
  }

  async function uploadImagesToDataset(datasetId: number, files: File[]) {
    setUploadStatus({ msg: `Uploading ${files.length} file${files.length !== 1 ? "s" : ""}…`, type: "busy" });
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    try {
      const res = await fetch(`/api/datasets/${datasetId}/upload-images`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      setUploadStatus({ msg: `Uploaded ${files.length} file${files.length !== 1 ? "s" : ""}.`, type: "ok" });
      const detail = await api.getDataset(datasetId);
      setSelectedDataset(detail);
      setTimeout(() => setUploadStatus({ msg: "", type: "idle" }), 3000);
    } catch (err) {
      setUploadStatus({ msg: `Upload failed: ${err instanceof Error ? err.message : "unknown error"}`, type: "error" });
    }
  }

  // ── Auto-caption ──────────────────────────────────────────────────────────

  async function runAutoCaption() {
    if (!selectedDataset) return;
    const s = loadSettings();
    const total = selectedDataset.files.length;
    if (total === 0) {
      setCaptionError("No images found in this dataset.");
      return;
    }

    setCaptioning(true);
    setCaptionError(null);
    setCaptionProgress(`Captioning 0 / ${total}…`);
    let done = 0;
    let errors = 0;
    let lastError = "";

    try {
      const res = await fetch(`/api/datasets/${selectedDataset.id}/autocaption`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llama_url: s.llamaUrl, model: s.model, system_prompt: s.systemPrompt, trigger_word: s.triggerWord, max_tokens: s.maxTokens, overwrite: s.overwrite }),
      });
      if (!res.ok || !res.body) { setCaptionError("Auto-caption request failed."); setCaptioning(false); return; }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: Record<string, string>;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          if (evt.status === "done" || evt.status === "skipped" || evt.status === "error") {
            done++;
            if (evt.status === "error") { errors++; lastError = evt.error ?? ""; }
            setCaptionProgress(`Captioning ${done} / ${total}…`);
            if (evt.status === "done" && evt.filename && evt.caption)
              setCaptionOverrides((prev) => ({ ...prev, [evt.filename]: evt.caption }));
          } else if (evt.status === "complete") {
            setCaptionProgress(`Done — ${done} / ${total} processed.`);
            setCaptioning(false);
            if (errors > 0)
              setCaptionError(`${errors} of ${total} images failed. Last error: ${lastError}`);
          }
        }
      }
    } catch {
      setCaptionError("Could not reach the autocaption server.");
      setCaptioning(false);
    }
  }

  // ── Rename dataset files ──────────────────────────────────────────────────

  async function handleRename(prefix: string) {
    if (!selectedDataset) return;
    setShowRename(false);
    setUploadStatus({ msg: `Renaming ${selectedDataset.image_count} files…`, type: "busy" });
    try {
      const detail = await api.renameDatasetFiles(selectedDataset.id, prefix);
      setSelectedDataset(detail);
      setSelectedFile(detail.files[0] ?? null);
      setCaptionOverrides({});
      setUploadStatus({ msg: `Renamed to ${prefix}1…${prefix}${detail.image_count}.`, type: "ok" });
      setTimeout(() => setUploadStatus({ msg: "", type: "idle" }), 3000);
      await loadDatasets(selectedDataset.id);
    } catch (err) {
      setUploadStatus({ msg: `Rename failed: ${err instanceof Error ? err.message : "unknown error"}`, type: "error" });
    }
  }

  // ── Delete dataset ────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!selectedDataset) return;
    if (!window.confirm(`Delete dataset "${selectedDataset.name}" and all its files? This cannot be undone.`)) return;
    const deletedId = selectedDataset.id;
    setSelectedDataset(null);
    setSelectedFile(null);
    await api.deleteDataset(deletedId);
    const items = await api.getDatasets().catch(() => [] as Dataset[]);
    setDatasets(items);
    if (items.length > 0) {
      const detail = await api.getDataset(items[0].id).catch(() => null);
      if (detail) { setSelectedDataset(detail); setSelectedFile(detail.files[0] ?? null); }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const mainPanelActions = selectedDataset ? (
    <>
      <button className="primary-button" type="button" disabled={captioning} onClick={runAutoCaption}>
        {captioning ? captionProgress : "Auto Caption"}
      </button>
      <button className="secondary-button icon-button" type="button" title="Caption settings" onClick={() => setShowSettings(true)}>⚙</button>
      <button className="secondary-button" type="button" onClick={() => setShowRename(true)} disabled={selectedDataset.image_count === 0}>Rename</button>
      <button className="danger-button" type="button" onClick={handleDelete}>Delete</button>
    </>
  ) : undefined;

  return (
    <>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showRename && selectedDataset && (
        <RenameModal
          imageCount={selectedDataset.image_count}
          onConfirm={handleRename}
          onCancel={() => setShowRename(false)}
        />
      )}
      {showNamePrompt && (
        <NamePromptModal
          defaultName={pendingDefaultName}
          onConfirm={handleNameConfirm}
          onCancel={handleNameCancel}
        />
      )}

      {/* hidden file inputs */}
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleZipUpload(f); e.target.value = ""; }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        {...({ webkitdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
        onChange={handleFolderInput}
      />

      <div className="split-page">
        {/* Left rail */}
        <PageSection
          eyebrow="Library"
          title="Datasets"
          className="left-rail"
          bare
          actions={
            <>
              <button className="secondary-button" type="button" onClick={() => zipInputRef.current?.click()}>Upload</button>
              <button className="secondary-button" type="button" onClick={() => folderInputRef.current?.click()}>Folder</button>
            </>
          }
        >
          <div className="list-stack">
            {datasets.map((dataset) => (
              <button key={dataset.id} className={`list-item ${selectedDataset?.id === dataset.id ? "active" : ""}`} onClick={() => selectDataset(dataset.id)} type="button">
                <strong>{dataset.name}</strong>
                <span>{dataset.image_count} images · {formatBytes(dataset.size_bytes)}</span>
                <span className={`dataset-caption-badge ${dataset.caption_count === dataset.image_count && dataset.image_count > 0 ? "complete" : dataset.caption_count > 0 ? "partial" : "none"}`}>
                  {dataset.caption_count}/{dataset.image_count} captioned
                </span>
              </button>
            ))}
          </div>

          {uploadStatus.msg && (
            <div className={uploadStatus.type === "error" ? "error-banner" : "empty-state"} style={uploadStatus.type === "ok" ? { color: "var(--success)", borderColor: "var(--success)" } : {}}>
              {uploadStatus.msg}
            </div>
          )}

          <div
            className="dropzone"
            onDrop={onDropzoneDrop}
            onDragOver={onDropzoneDragOver}
          >
            Drop a .zip, folder, or images here
          </div>
        </PageSection>

        {/* Main panel */}
        <PageSection eyebrow="Browser" title={selectedDataset?.name ?? "Dataset Preview"} className="main-panel" bare actions={mainPanelActions}>
          {captionError && <div className="error-banner">{captionError}</div>}

          {selectedDataset ? (
            <div
              className={`dataset-main-area${imageDragOver ? " drag-over" : ""}`}
              onDragEnter={onPanelDragEnter}
              onDragLeave={onPanelDragLeave}
              onDragOver={onPanelDragOver}
              onDrop={onPanelDrop}
            >
              {imageDragOver && (
                <div className="image-drop-overlay">
                  <div className="image-drop-label">↓ Drop images to add to this dataset</div>
                </div>
              )}

              <div className="panel-muted">
                {selectedDataset.image_count} images · {formatBytes(selectedDataset.size_bytes)}
              </div>

              <div className="thumbnail-grid">
                {selectedDataset.files.map((file) => {
                  const hasCaption = captionOverrides[file.filename] !== undefined ? true : file.has_caption;
                  return (
                    <button key={file.filename} type="button" className={`thumb-card ${selectedFile?.filename === file.filename ? "active" : ""}`} onClick={() => setSelectedFile(file)}>
                      <div className="thumb-image">
                        <img src={api.datasetImageUrl(selectedDataset.id, file.filename)} alt={file.filename} loading="lazy" />
                      </div>
                      <div className="thumb-meta">
                        <div>{file.filename}</div>
                        <span className={hasCaption ? "caption-ok" : "caption-missing"}>
                          {hasCaption ? "✓ caption" : "✗ no caption"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedFile && (
                <CaptionCell datasetId={selectedDataset.id} file={selectedFile} overrideCaption={captionOverrides[selectedFile.filename]} />
              )}
            </div>
          ) : (
            <div className="empty-state">No datasets registered yet. Upload a .zip or drop a folder to get started.</div>
          )}
        </PageSection>
      </div>
    </>
  );
}
