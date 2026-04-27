import { useEffect, useState } from "react";

import { api, type GalleryImage, type MediaVideo } from "../lib/api";

export type PickedMedia =
  | { source: "uploads"; title: string; url: string; mediaType: "image" | "video"; filename: string }
  | { source: "gallery"; title: string; url: string; mediaType: "image" | "video"; filename: string };

export function MediaPicker({ open, onClose, onPick, accept = "all" }: {
  open: boolean;
  onClose: () => void;
  onPick: (item: PickedMedia) => void;
  accept?: "all" | "image" | "video";
}) {
  const [uploads, setUploads] = useState<MediaVideo[]>([]);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [tab, setTab] = useState<"uploads" | "gallery">("uploads");

  useEffect(() => {
    if (!open) return;
    void Promise.all([api.getMediaItems(), api.getGalleryImages()])
      .then(([mediaItems, galleryItems]) => {
        setUploads(mediaItems);
        setGallery(galleryItems);
      })
      .catch(console.error);
  }, [open]);

  if (!open) return null;

  const uploadItems = uploads.filter(item => accept === "all" || item.media_type === accept);
  const galleryItems = gallery.filter(item => accept === "all" || item.media_type === accept);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box media-picker-modal" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <span className="eyebrow">Library</span>
          <h3>Pick Media</h3>
        </div>
        <div className="media-picker-tabs">
          <button className={tab === "uploads" ? "primary-button" : "secondary-button"} onClick={() => setTab("uploads")} type="button">Uploads</button>
          <button className={tab === "gallery" ? "primary-button" : "secondary-button"} onClick={() => setTab("gallery")} type="button">Gallery</button>
        </div>
        <div className="media-picker-grid">
          {tab === "uploads" ? uploadItems.map(item => (
            <button
              key={item.filename}
              type="button"
              className="media-picker-item"
              onClick={() => onPick({ source: "uploads", title: item.title, url: item.video_url, mediaType: item.media_type, filename: item.filename })}
            >
              {item.media_type === "image" ? <img src={item.video_url} alt={item.title} /> : <video src={item.video_url} muted preload="metadata" />}
              <span>{item.title}</span>
            </button>
          )) : galleryItems.map(item => {
            const url = item.media_type === "video" ? item.video_url ?? item.image_url : item.image_url;
            return (
              <button
                key={item.id}
                type="button"
                className="media-picker-item"
                onClick={() => onPick({ source: "gallery", title: item.filename, url, mediaType: item.media_type, filename: item.filename })}
              >
                {item.media_type === "image" ? <img src={item.image_url} alt={item.filename} /> : <video src={url} muted preload="metadata" />}
                <span>{item.filename}</span>
              </button>
            );
          })}
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">Close</button>
        </div>
      </div>
    </div>
  );
}
