import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type Dataset, type GalleryExportResponse, type GalleryImage } from "../../lib/api";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

interface GalleryViewerProps {
  emptyMessage?: string;
  onSendToImageEdit?: (imageUrl: string) => void;
  viewportClassName?: string;
  refreshTrigger?: number;
}

export function GalleryViewer({
  emptyMessage = "No generated images found in `data/generations`.",
  onSendToImageEdit,
  viewportClassName,
  refreshTrigger,
}: GalleryViewerProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [showDatasetPicker, setShowDatasetPicker] = useState(false);
  const [targetDatasetId, setTargetDatasetId] = useState<number | null>(null);
  const [showExportPicker, setShowExportPicker] = useState(false);
  const [exportDir, setExportDir] = useState("");
  const [exportResult, setExportResult] = useState<GalleryExportResponse | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const allSelected = images.length > 0 && selectedIds.length === images.length;
  const selectedCount = selectedIds.length;
  const selectedHasVideo = selectedIds.some((id) => images.find((img) => img.id === id)?.media_type === "video");

  async function loadGallery() {
    setIsLoading(true);
    try {
      const [galleryImages, datasetList] = await Promise.all([api.getGalleryImages(), api.getDatasets()]);
      setImages(galleryImages);
      setDatasets(datasetList);
      setSelectedIds((current) => current.filter((id) => galleryImages.some((image) => image.id === id)));
      setTargetDatasetId((current) => current ?? datasetList[0]?.id ?? null);
      setError(null);
    } catch (loadError) {
      console.error(loadError);
      setError("Failed to load gallery.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadGallery();
  }, []);

  useEffect(() => {
    if (refreshTrigger == null || refreshTrigger === 0) return;
    void loadGallery();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const selectedImages = useMemo(
    () => images.filter((image) => selectedIds.includes(image.id)),
    [images, selectedIds],
  );

  function toggleImage(imageId: string) {
    setSelectedIds((current) =>
      current.includes(imageId) ? current.filter((id) => id !== imageId) : [...current, imageId],
    );
  }

  function toggleSelectAll() {
    setSelectedIds(allSelected ? [] : images.map((image) => image.id));
  }

  async function handleDelete(imageIds: string[]) {
    if (imageIds.length === 0) return;
    setIsWorking(true);
    try {
      await api.deleteGalleryImages(imageIds);
      await loadGallery();
    } catch (deleteError) {
      console.error(deleteError);
      setError("Failed to delete one or more images.");
    } finally {
      setIsWorking(false);
    }
  }

  async function handleExport() {
    if (selectedIds.length === 0 || !exportDir.trim()) return;
    setIsWorking(true);
    try {
      const result = await api.exportGalleryImages(selectedIds, exportDir.trim());
      setExportResult(result);
    } catch (exportError) {
      console.error(exportError);
      setError("Failed to export images.");
      setShowExportPicker(false);
    } finally {
      setIsWorking(false);
    }
  }

  async function handleMoveToDataset() {
    if (selectedIds.length === 0 || targetDatasetId === null) return;
    setIsWorking(true);
    try {
      await api.moveGalleryImages(selectedIds, targetDatasetId);
      setShowDatasetPicker(false);
      await loadGallery();
    } catch (moveError) {
      console.error(moveError);
      setError("Failed to move one or more images to the dataset.");
    } finally {
      setIsWorking(false);
    }
  }

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const lightboxPrev = useCallback(() => setLightboxIndex((i) => (i === null ? null : (i - 1 + images.length) % images.length)), [images.length]);
  const lightboxNext = useCallback(() => setLightboxIndex((i) => (i === null ? null : (i + 1) % images.length)), [images.length]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") lightboxPrev();
      else if (e.key === "ArrowRight") lightboxNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, closeLightbox, lightboxPrev, lightboxNext]);

  return (
    <>
      <div className="panel-toolbar gallery-toolbar">
        <div className="panel-muted">
          {selectedCount > 0 ? `${selectedCount} selected` : `${images.length} items`}
        </div>
        <div className="section-actions gallery-actions">
          <button className="secondary-button" type="button" onClick={toggleSelectAll} disabled={images.length === 0 || isWorking}>
            {allSelected ? "Clear Selection" : "Select All"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setShowDatasetPicker(true)}
            disabled={selectedCount === 0 || datasets.length === 0 || isWorking || selectedHasVideo}
          >
            Add To Dataset
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => { setExportResult(null); setShowExportPicker(true); }}
            disabled={selectedCount === 0 || isWorking}
          >
            Export
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={() => void handleDelete(selectedIds)}
            disabled={selectedCount === 0 || isWorking}
          >
            Delete
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className={viewportClassName}>
        {isLoading ? (
          <div className="empty-state">Loading gallery...</div>
        ) : images.length === 0 ? (
          <div className="empty-state">{emptyMessage}</div>
        ) : (
          <div className="gallery-grid">
            {images.map((image) => {
              const isSelected = selectedIds.includes(image.id);
              const isVideo = image.media_type === "video";
              const downloadHref = isVideo ? (image.video_url ?? "") : image.image_url;
              const tileIndex = images.indexOf(image);
              return (
                <article key={image.id} className={isSelected ? "gallery-tile selected" : "gallery-tile"}>
                  <div className="gallery-tile-image" onClick={() => setLightboxIndex(tileIndex)} style={{ cursor: "zoom-in" }}>
                    {isVideo ? (
                      <video
                        src={image.video_url ?? ""}
                        className="gallery-tile-video"
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        onMouseEnter={(e) => void (e.currentTarget as HTMLVideoElement).play()}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
                      />
                    ) : (
                      <img src={image.image_url} alt={image.filename} loading="lazy" />
                    )}
                    {isVideo ? <span className="gallery-tile-video-badge">VIDEO</span> : null}
                  </div>
                  <div className="gallery-tile-top">
                    <label className="gallery-checkbox">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleImage(image.id)}
                      />
                    </label>
                    <div className="gallery-tile-actions">
                      {onSendToImageEdit && !isVideo ? (
                        <button
                          className="gallery-action-btn"
                          type="button"
                          title="Send to Image Edit"
                          onClick={() => onSendToImageEdit(image.image_url)}
                        >✏</button>
                      ) : null}
                      <a
                        href={downloadHref}
                        download={image.filename}
                        className="gallery-action-btn"
                        title="Download"
                        onClick={(e) => e.stopPropagation()}
                      >↓</a>
                      <button
                        className="gallery-delete"
                        type="button"
                        aria-label={`Delete ${image.filename}`}
                        onClick={() => void handleDelete([image.id])}
                      >🗑</button>
                    </div>
                  </div>
                  <div className="gallery-tile-meta">
                    <strong title={image.filename}>{image.filename}</strong>
                    <span>
                      {!isVideo && image.width && image.height
                        ? `${image.width} × ${image.height} · `
                        : null}
                      {formatBytes(image.size_bytes)}
                    </span>
                    <span>{formatTimestamp(image.created_at)}</span>
                    <span className="gallery-source">Run {image.generation_id}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {showExportPicker ? (
        <div className="modal-backdrop" onClick={() => setShowExportPicker(false)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            {exportResult ? (
              <>
                <div className="modal-header">
                  <span className="eyebrow">Export Complete</span>
                  <h3>Exported {exportResult.exported} file{exportResult.exported === 1 ? "" : "s"}</h3>
                </div>
                <div className="modal-field">
                  <span className="modal-hint">
                    Files copied to:
                  </span>
                  <code className="gallery-export-path">{exportResult.destination_dir}</code>
                </div>
                <div className="modal-actions">
                  <button className="primary-button" type="button" onClick={() => setShowExportPicker(false)}>
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-header">
                  <span className="eyebrow">Export Images</span>
                  <h3>Choose Destination</h3>
                </div>
                <div className="modal-field">
                  <label className="modal-label">Destination Directory</label>
                  <input
                    type="text"
                    value={exportDir}
                    onChange={(e) => setExportDir(e.target.value)}
                    placeholder="/home/user/exports"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") void handleExport(); }}
                  />
                  <span className="modal-hint">
                    {selectedCount} file{selectedCount === 1 ? "" : "s"} will be copied to this directory. It will be created if it does not exist.
                  </span>
                </div>
                <div className="modal-actions">
                  <button className="secondary-button" type="button" onClick={() => setShowExportPicker(false)}>
                    Cancel
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void handleExport()}
                    disabled={!exportDir.trim() || isWorking}
                  >
                    {isWorking ? "Exporting…" : "Export"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {lightboxIndex !== null && images[lightboxIndex] ? (() => {
        const lb = images[lightboxIndex];
        const isVideo = lb.media_type === "video";
        return (
          <div className="lightbox-backdrop" onClick={closeLightbox}>
            <div className="lightbox-box" onClick={(e) => e.stopPropagation()}>
              <button className="lightbox-close" type="button" onClick={closeLightbox} aria-label="Close">✕</button>
              <button className="lightbox-nav lightbox-prev" type="button" onClick={lightboxPrev} aria-label="Previous">‹</button>
              <div className="lightbox-media">
                {isVideo ? (
                  <video
                    key={lb.id}
                    src={lb.video_url ?? ""}
                    className="lightbox-video"
                    controls
                    autoPlay
                    loop
                  />
                ) : (
                  <img key={lb.id} src={lb.image_url} alt={lb.filename} className="lightbox-img" />
                )}
              </div>
              <button className="lightbox-nav lightbox-next" type="button" onClick={lightboxNext} aria-label="Next">›</button>
              <div className="lightbox-caption">
                <span>{lb.filename}</span>
                {lb.width && lb.height ? <span>{lb.width} × {lb.height}</span> : null}
                <span>{lightboxIndex + 1} / {images.length}</span>
                <a href={isVideo ? (lb.video_url ?? "") : lb.image_url} download={lb.filename} className="lightbox-download">↓ Download</a>
              </div>
            </div>
          </div>
        );
      })() : null}

      {showDatasetPicker ? (
        <div className="modal-backdrop" onClick={() => setShowDatasetPicker(false)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="eyebrow">Dataset Move</span>
              <h3>Add To Dataset</h3>
            </div>
            <div className="modal-field">
              <label className="modal-label">Dataset</label>
              <select
                value={targetDatasetId ?? ""}
                onChange={(event) => setTargetDatasetId(Number(event.target.value))}
              >
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
              </select>
              <span className="modal-hint">
                {selectedImages.length} selected image{selectedImages.length === 1 ? "" : "s"} will be moved into the chosen dataset folder.
              </span>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setShowDatasetPicker(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleMoveToDataset()}
                disabled={targetDatasetId === null || isWorking}
              >
                Move Images
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
