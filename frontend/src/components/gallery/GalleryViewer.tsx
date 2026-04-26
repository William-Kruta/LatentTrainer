import { useEffect, useMemo, useState } from "react";

import { api, type Dataset, type GalleryImage } from "../../lib/api";

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
}

export function GalleryViewer({
  emptyMessage = "No generated images found in `data/generations`.",
  onSendToImageEdit,
}: GalleryViewerProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [showDatasetPicker, setShowDatasetPicker] = useState(false);
  const [targetDatasetId, setTargetDatasetId] = useState<number | null>(null);

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
            return (
              <article key={image.id} className={isSelected ? "gallery-tile selected" : "gallery-tile"}>
                <div className="gallery-tile-image">
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
