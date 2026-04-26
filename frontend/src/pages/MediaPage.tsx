import { useEffect, useRef, useState } from "react";

import { PageSection } from "../components/PageSection";
import { api, type Dataset, type MediaVideo } from "../lib/api";

type MediaMode = "player" | "download";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "Unknown duration";
  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return hrs > 0
    ? `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatClock(seconds: number) {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = Math.floor(clamped % 60);
  const fraction = Math.floor((clamped % 1) * 100);
  return `${mins}:${String(secs).padStart(2, "0")}.${String(fraction).padStart(2, "0")}`;
}

function buildFrameName(video: MediaVideo | null, currentTime: number) {
  const stem = (video?.filename ?? "frame").replace(/\.[^.]+$/, "");
  const millis = Math.round(currentTime * 1000);
  return `${stem}_frame_${String(millis).padStart(8, "0")}.png`;
}

async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is not available.");
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Failed to capture the current frame.");
  }
  return blob;
}

export function MediaPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekbarRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<MediaMode>("player");
  const [videos, setVideos] = useState<MediaVideo[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [jumpFrames, setJumpFrames] = useState(12);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showDatasetModal, setShowDatasetModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [exportDirectory, setExportDirectory] = useState("exports/frames");
  const [exportFilename, setExportFilename] = useState("frame.png");
  const [targetDatasetId, setTargetDatasetId] = useState<number | null>(null);

  const selectedVideo = videos.find((video) => video.filename === selectedFilename) ?? null;
  const jumpFps = selectedVideo?.fps && selectedVideo.fps > 0 ? selectedVideo.fps : 24;
  const seekPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  async function loadMedia() {
    setIsLoading(true);
    try {
      const [videoList, datasetList] = await Promise.all([api.getMediaVideos(), api.getDatasets()]);
      setVideos(videoList);
      setDatasets(datasetList);
      setSelectedFilename((current) =>
        current && videoList.some((video) => video.filename === current) ? current : videoList[0]?.filename ?? null,
      );
      setTargetDatasetId((current) => current ?? datasetList[0]?.id ?? null);
      setError(null);
    } catch (loadError) {
      console.error(loadError);
      setError("Failed to load media.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadMedia();
  }, []);

  useEffect(() => {
    if (videoRef.current === null) return;
    const element = videoRef.current as HTMLVideoElement;

    function handleTimeUpdate() {
      setCurrentTime(element.currentTime);
    }

    function handlePlay() {
      setIsPlaying(true);
    }

    function handlePause() {
      setIsPlaying(false);
    }

    function handleLoadedMetadata() {
      setCurrentTime(element.currentTime);
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      setExportFilename(buildFrameName(selectedVideo, element.currentTime));
    }

    element.addEventListener("timeupdate", handleTimeUpdate);
    element.addEventListener("play", handlePlay);
    element.addEventListener("pause", handlePause);
    element.addEventListener("loadedmetadata", handleLoadedMetadata);

    return () => {
      element.removeEventListener("timeupdate", handleTimeUpdate);
      element.removeEventListener("play", handlePlay);
      element.removeEventListener("pause", handlePause);
      element.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [selectedVideo]);

  useEffect(() => {
    setExportFilename(buildFrameName(selectedVideo, currentTime));
  }, [selectedVideo, currentTime]);

  // Reset player state when video changes
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
  }, [selectedFilename]);

  function seekByFrames(direction: -1 | 1) {
    const video = videoRef.current;
    if (!video) return;
    const deltaSeconds = (jumpFrames / jumpFps) * direction;
    const dur = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    const nextTime = Math.min(Math.max(video.currentTime + deltaSeconds, 0), dur);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function seekToClientX(clientX: number) {
    const video = videoRef.current;
    const bar = seekbarRef.current;
    if (!video || !bar || !Number.isFinite(video.duration) || video.duration === 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = ratio * video.duration;
    video.currentTime = newTime;
    setCurrentTime(newTime);
  }

  function handleSeekPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    seekToClientX(e.clientX);
  }

  function handleSeekPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.buttons & 1) === 0) return;
    seekToClientX(e.clientX);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  async function handleDownload() {
    const url = downloadUrl.trim();
    if (!url) {
      setError("Enter a media URL to download.");
      return;
    }

    setIsDownloading(true);
    setStatusMessage(null);
    try {
      const response = await api.downloadMediaVideo(url);
      setDownloadUrl("");
      setMode("player");
      setStatusMessage(`Saved ${response.video.title} to uploads.`);
      await loadMedia();
      setSelectedFilename(response.video.filename);
      setError(null);
    } catch (downloadError) {
      console.error(downloadError);
      setError(downloadError instanceof Error ? downloadError.message : "Download failed.");
    } finally {
      setIsDownloading(false);
    }
  }

  function handleUploadFileSelected(file: File) {
    setSelectedUploadFile(file);
  }

  function handleDropzoneDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDropzoneDragLeave(e: React.DragEvent) {
    // Only clear if leaving the zone entirely
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  function handleDropzoneDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUploadFileSelected(file);
  }

  function handleBrowseChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUploadFileSelected(file);
    e.target.value = "";
  }

  async function handleUploadSubmit() {
    if (!selectedUploadFile) return;
    setIsUploading(true);
    setStatusMessage(null);
    try {
      const response = await api.uploadMediaVideo(selectedUploadFile);
      setShowUploadModal(false);
      setSelectedUploadFile(null);
      setMode("player");
      setStatusMessage(`Uploaded ${response.video.title}.`);
      await loadMedia();
      setSelectedFilename(response.video.filename);
      setError(null);
    } catch (uploadError) {
      console.error(uploadError);
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  async function exportFrameToDirectory() {
    const video = videoRef.current;
    if (!video) return;

    setIsExporting(true);
    try {
      const frame = await captureVideoFrame(video);
      const response = await api.exportMediaFrame({
        frame,
        outputDir: exportDirectory,
        filename: exportFilename,
      });
      setStatusMessage(`Frame exported to ${response.path}`);
      setShowExportModal(false);
      setError(null);
    } catch (exportError) {
      console.error(exportError);
      setError(exportError instanceof Error ? exportError.message : "Frame export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  async function exportFrameToDataset() {
    const video = videoRef.current;
    if (!video || targetDatasetId === null) return;

    setIsExporting(true);
    try {
      const frame = await captureVideoFrame(video);
      const response = await api.exportMediaFrameToDataset({
        frame,
        datasetId: targetDatasetId,
        filename: exportFilename,
      });
      setStatusMessage(`Frame exported to ${response.path}`);
      setShowDatasetModal(false);
      setError(null);
    } catch (exportError) {
      console.error(exportError);
      setError(exportError instanceof Error ? exportError.message : "Dataset export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="page-stack">
      <PageSection eyebrow="Media" title="Media">
        <div className="split-page media-page">
          <aside className="left-rail media-sidebar">
            <div className="media-mode-stack">
              <button
                className={mode === "player" ? "primary-button" : "secondary-button"}
                type="button"
                onClick={() => setMode("player")}
              >
                Player
              </button>
              <button
                className={mode === "download" ? "primary-button" : "secondary-button"}
                type="button"
                onClick={() => setMode("download")}
              >
                Download
              </button>
            </div>

            <button className="media-upload-btn" type="button" onClick={() => setShowUploadModal(true)}>
              ↑ Upload Video
            </button>

            <div className="left-rail-header">
              <span className="eyebrow">Uploads</span>
              <strong>{videos.length} videos</strong>
            </div>

            <div className="media-video-list">
              {isLoading ? <div className="empty-state compact">Loading uploads...</div> : null}
              {!isLoading && videos.length === 0 ? (
                <div className="empty-state compact">No videos in `uploads` yet.</div>
              ) : null}
              {videos.map((video) => (
                <button
                  key={video.filename}
                  type="button"
                  className={video.filename === selectedFilename ? "media-video-card active" : "media-video-card"}
                  onClick={() => {
                    setSelectedFilename(video.filename);
                    setMode("player");
                  }}
                >
                  <div className="media-card-thumb">
                    <video
                      src={video.video_url}
                      muted
                      playsInline
                      preload="metadata"
                      className="media-card-thumb-video"
                      onMouseEnter={(e) => void (e.currentTarget as HTMLVideoElement).play()}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLVideoElement).pause(); (e.currentTarget as HTMLVideoElement).currentTime = 0; }}
                    />
                  </div>
                  <div className="media-card-info">
                    <strong>{video.title}</strong>
                    <span>{formatDuration(video.duration_seconds)}</span>
                    <span>{formatBytes(video.size_bytes)}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <div className="main-panel media-main">
            {error ? <div className="error-banner">{error}</div> : null}
            {statusMessage ? <div className="success-banner">{statusMessage}</div> : null}

            {mode === "download" ? (
              <div className="page-stack">
                <PageSection eyebrow="Fetcher" title="Download Media">
                  <div className="form-grid">
                    <label className="field-column">
                      Source URL
                      <input
                        type="url"
                        value={downloadUrl}
                        onChange={(event) => setDownloadUrl(event.target.value)}
                        placeholder="https://www.youtube.com/watch?v=..."
                      />
                    </label>
                  </div>
                  <div className="section-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void handleDownload()}
                      disabled={isDownloading}
                    >
                      {isDownloading ? "Downloading..." : "Download"}
                    </button>
                  </div>
                  <p className="panel-muted">Downloads are stored in `uploads/` and appear in the player list.</p>
                </PageSection>
              </div>
            ) : (
              <div className="page-stack">
                <PageSection eyebrow="Player" title={selectedVideo?.title ?? "Video Player"}>
                  {!selectedVideo ? (
                    <div className="empty-state">Select a video from the left, or upload one.</div>
                  ) : (
                    <div className="media-player-stack">
                      <div className="media-video-frame">
                        <video
                          key={selectedVideo.filename}
                          ref={videoRef}
                          src={selectedVideo.video_url}
                          className="media-video-element"
                          preload="metadata"
                          crossOrigin="anonymous"
                        />
                      </div>

                      <div className="media-controls-bar">
                        {/* Seekbar */}
                        <div
                          ref={seekbarRef}
                          className="media-seekbar-track"
                          onPointerDown={handleSeekPointerDown}
                          onPointerMove={handleSeekPointerMove}
                        >
                          <div className="media-seekbar-fill" style={{ width: `${seekPercent}%` }} />
                          <div className="media-seekbar-thumb" style={{ left: `${seekPercent}%` }} />
                        </div>

                        {/* Transport row */}
                        <div className="media-transport-row">
                          <button className="media-icon-btn" type="button" title="Back frames" onClick={() => seekByFrames(-1)}>
                            ⏮
                          </button>
                          <button className="media-icon-btn play" type="button" onClick={togglePlayback}>
                            {isPlaying ? "⏸" : "▶"}
                          </button>
                          <button className="media-icon-btn" type="button" title="Forward frames" onClick={() => seekByFrames(1)}>
                            ⏭
                          </button>

                          <label className="field-column media-jump-field">
                            Frames
                            <input
                              type="number"
                              min={1}
                              value={jumpFrames}
                              onChange={(event) => setJumpFrames(Math.max(1, Number(event.target.value) || 1))}
                            />
                          </label>

                          <span className="media-time-display">
                            {formatClock(currentTime)} / {duration > 0 ? formatClock(duration) : formatDuration(selectedVideo.duration_seconds)}
                          </span>

                          <button className="primary-button" type="button" onClick={() => setShowExportModal(true)}>
                            Export Frame
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => setShowDatasetModal(true)}
                            disabled={datasets.length === 0}
                          >
                            → Dataset
                          </button>
                        </div>
                      </div>

                      <div className="stats-grid media-stats-grid">
                        <div className="stat-card">
                          <span>Current Time</span>
                          <strong>{formatClock(currentTime)}</strong>
                        </div>
                        <div className="stat-card">
                          <span>Jump Size</span>
                          <strong>
                            {jumpFrames}f @ {jumpFps.toFixed(2)} fps
                          </strong>
                        </div>
                        <div className="stat-card">
                          <span>Duration</span>
                          <strong>{formatDuration(selectedVideo.duration_seconds)}</strong>
                        </div>
                        <div className="stat-card">
                          <span>Source</span>
                          <strong>{selectedVideo.source_url ? "yt_dlp" : "Local file"}</strong>
                        </div>
                      </div>
                    </div>
                  )}
                </PageSection>
              </div>
            )}
          </div>
        </div>
      </PageSection>

      {/* Upload modal */}
      {showUploadModal ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!isUploading) {
              setShowUploadModal(false);
              setSelectedUploadFile(null);
              setIsDragOver(false);
            }
          }}
        >
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="eyebrow">Upload</span>
              <h3>Upload Video</h3>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mp4,.mkv,.webm,.mov,.avi,.m4v"
              style={{ display: "none" }}
              onChange={handleBrowseChange}
            />

            <div
              className={isDragOver ? "media-upload-zone drag-over" : "media-upload-zone"}
              onDragOver={handleDropzoneDragOver}
              onDragLeave={handleDropzoneDragLeave}
              onDrop={handleDropzoneDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedUploadFile ? (
                <div className="media-upload-file-info">
                  <span className="media-upload-icon">🎬</span>
                  <strong>{selectedUploadFile.name}</strong>
                  <span>{formatBytes(selectedUploadFile.size)}</span>
                  <span className="media-upload-zone-hint">Click to choose a different file</span>
                </div>
              ) : (
                <>
                  <span className="media-upload-icon">↑</span>
                  <span className="media-upload-zone-label">Drop a video file here</span>
                  <span className="media-upload-zone-hint">or click to browse — mp4, mkv, webm, mov, avi</span>
                </>
              )}
            </div>

            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setShowUploadModal(false);
                  setSelectedUploadFile(null);
                  setIsDragOver(false);
                }}
                disabled={isUploading}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void handleUploadSubmit()}
                disabled={!selectedUploadFile || isUploading}
              >
                {isUploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Export frame modal */}
      {showExportModal ? (
        <div className="modal-backdrop" onClick={() => setShowExportModal(false)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="eyebrow">Frame Export</span>
              <h3>Export Frame</h3>
            </div>
            <div className="modal-field">
              <label className="modal-label">Output Directory</label>
              <input value={exportDirectory} onChange={(event) => setExportDirectory(event.target.value)} />
            </div>
            <div className="modal-field">
              <label className="modal-label">Filename</label>
              <input value={exportFilename} onChange={(event) => setExportFilename(event.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setShowExportModal(false)}>
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={() => void exportFrameToDirectory()} disabled={isExporting}>
                {isExporting ? "Exporting..." : "Export"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Export to dataset modal */}
      {showDatasetModal ? (
        <div className="modal-backdrop" onClick={() => setShowDatasetModal(false)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="eyebrow">Dataset Export</span>
              <h3>Export Frame To Dataset</h3>
            </div>
            <div className="modal-field">
              <label className="modal-label">Dataset</label>
              <select value={targetDatasetId ?? ""} onChange={(event) => setTargetDatasetId(Number(event.target.value))}>
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>
                    {dataset.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-field">
              <label className="modal-label">Filename</label>
              <input value={exportFilename} onChange={(event) => setExportFilename(event.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setShowDatasetModal(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void exportFrameToDataset()}
                disabled={targetDatasetId === null || isExporting}
              >
                {isExporting ? "Exporting..." : "Export"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
