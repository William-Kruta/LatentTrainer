import { useEffect, useRef, useState } from "react";

import { PageSection } from "../components/PageSection";
import { api, type Dataset, type MediaVideo, type SwapMaskAnchor, type SwapMaskMetadata } from "../lib/api";
import { applyMediaUrlCases, loadMediaUrlCases, saveMediaUrlCases, type MediaUrlCase } from "../lib/mediaUrlCases";

type MediaMode = "player" | "download" | "swap";

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

function computeMaskSlice(mask: SwapMaskMetadata, ratio: number, anchor: SwapMaskAnchor) {
  if (!mask.bbox) return null;
  const [x1, y1, x2, y2] = mask.bbox;
  const faceHeight = Math.max(1, y2 - y1);
  const sliceHeight = faceHeight * Math.min(1, Math.max(0.05, ratio));
  let sliceY = y1 + (faceHeight - sliceHeight) / 2;
  if (anchor === "top") sliceY = y1;
  if (anchor === "bottom") sliceY = y2 - sliceHeight;
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: Math.max(1, (x2 - x1) / 2), ry: Math.max(1, faceHeight / 2), sliceY, sliceHeight };
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
  const swapFaceInputRef = useRef<HTMLInputElement | null>(null);

  const [mode, setMode] = useState<MediaMode>("player");
  const [videos, setVideos] = useState<MediaVideo[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [urlCases, setUrlCases] = useState<MediaUrlCase[]>(loadMediaUrlCases);
  const [newUrlPattern, setNewUrlPattern] = useState("");
  const [newBaseUrlInputs, setNewBaseUrlInputs] = useState<Record<string, string>>({});
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
  const [clipStart, setClipStart] = useState<number | null>(null);
  const [clipEnd, setClipEnd] = useState<number | null>(null);
  const [isClipExporting, setIsClipExporting] = useState(false);
  const [showClipExportModal, setShowClipExportModal] = useState(false);
  const [showClipDatasetModal, setShowClipDatasetModal] = useState(false);
  const [clipDirectory, setClipDirectory] = useState("exports/clips");
  const [clipFilename, setClipFilename] = useState("clip.mp4");
  const [swapFaceFile, setSwapFaceFile] = useState<File | null>(null);
  const [swapFacePreviewUrl, setSwapFacePreviewUrl] = useState<string | null>(null);
  const [swapOutputPath, setSwapOutputPath] = useState("swap.mp4");
  const [maskStrength, setMaskStrength] = useState(0.85);
  const [maskFeather, setMaskFeather] = useState(0.40);
  const [maskVerticalRatio, setMaskVerticalRatio] = useState(0.65);
  const [maskAnchor, setMaskAnchor] = useState<SwapMaskAnchor>("top");
  const [swapJobId, setSwapJobId] = useState<string | null>(null);
  const [swapProgress, setSwapProgress] = useState<{ current: number; total: number } | null>(null);
  const [swapPreviewFrameUrl, setSwapPreviewFrameUrl] = useState<string | null>(null);
  const [isSwapRunning, setIsSwapRunning] = useState(false);
  const [isSwapCancelling, setIsSwapCancelling] = useState(false);
  const [showSwapPreviewModal, setShowSwapPreviewModal] = useState(false);
  const [swapPreviewImageUrl, setSwapPreviewImageUrl] = useState<string | null>(null);
  const [swapPreviewMask, setSwapPreviewMask] = useState<SwapMaskMetadata | null>(null);
  const [isSwapPreviewing, setIsSwapPreviewing] = useState(false);

  const selectedVideo = videos.find((video) => video.filename === selectedFilename) ?? null;
  const jumpFps = selectedVideo?.fps && selectedVideo.fps > 0 ? selectedVideo.fps : 24;
  const seekPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const clipStartPercent = duration > 0 && clipStart !== null ? (clipStart / duration) * 100 : null;
  const clipEndPercent = duration > 0 && clipEnd !== null ? (clipEnd / duration) * 100 : null;
  const swapMaskSlice = swapPreviewMask ? computeMaskSlice(swapPreviewMask, maskVerticalRatio, maskAnchor) : null;

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

  function notify(message: string, isError = false) {
    if (isError) {
      setError(message);
      setStatusMessage(null);
      setTimeout(() => setError(null), 5000);
    } else {
      setStatusMessage(message);
      setError(null);
      setTimeout(() => setStatusMessage(null), 5000);
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
  }, [selectedVideo, mode]);

  useEffect(() => {
    setExportFilename(buildFrameName(selectedVideo, currentTime));
  }, [selectedVideo, currentTime]);

  useEffect(() => {
    if (selectedVideo) {
      const stem = selectedVideo.filename.replace(/\.[^.]+$/, "");
      setClipFilename(`${stem}_clip.mp4`);
      setSwapOutputPath(`${stem}_swap.mp4`);
    }
  }, [selectedVideo]);

  useEffect(() => {
    if (!swapJobId) return;
    const interval = window.setInterval(async () => {
      try {
        const status = await api.swapStatus(swapJobId);
        setSwapProgress({ current: status.current_frame, total: status.total_frames });
        setSwapPreviewFrameUrl(api.swapPreviewFrame(swapJobId));
        if (status.status === "cancelling") {
          setIsSwapCancelling(true);
        }
        if (status.status === "done" || status.status === "cancelled" || status.status === "error") {
          setIsSwapRunning(false);
          setIsSwapCancelling(false);
          setSwapJobId(null);
          if (status.status === "error") {
            notify(status.error ?? "Swap failed.", true);
          } else if (status.status === "cancelled") {
            notify(`Swap stopped and saved: ${status.output_path}`);
          } else {
            notify(`Swap complete: ${status.output_path}`);
          }
          window.clearInterval(interval);
        }
      } catch {
        // Ignore transient polling failures while the worker is starting.
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [swapJobId]);

  // Reset player state when video changes
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setClipStart(null);
    setClipEnd(null);
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

  function applyUrlCases(raw: string): string {
    return applyMediaUrlCases(raw, urlCases);
  }

  function saveUrlCases(next: MediaUrlCase[]) {
    setUrlCases(next);
    saveMediaUrlCases(next);
  }

  function addUrlCase() {
    const pattern = newUrlPattern.trim();
    if (!pattern || urlCases.some((c) => c.pattern === pattern)) return;
    saveUrlCases([...urlCases, { pattern, baseUrls: [] }]);
    setNewUrlPattern("");
  }

  function removeUrlCase(pattern: string) {
    saveUrlCases(urlCases.filter((c) => c.pattern !== pattern));
  }

  function addBaseUrl(pattern: string) {
    const value = (newBaseUrlInputs[pattern] ?? "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!value) return;
    const next = urlCases.map((c) =>
      c.pattern === pattern && !c.baseUrls.includes(value)
        ? { ...c, baseUrls: [...c.baseUrls, value] }
        : c
    );
    saveUrlCases(next);
    setNewBaseUrlInputs((prev) => ({ ...prev, [pattern]: "" }));
  }

  function removeBaseUrl(pattern: string, baseUrl: string) {
    const next = urlCases.map((c) =>
      c.pattern === pattern ? { ...c, baseUrls: c.baseUrls.filter((b) => b !== baseUrl) } : c
    );
    saveUrlCases(next);
  }

  async function handleDownload() {
    const url = applyUrlCases(downloadUrl.trim());
    if (!url) {
      notify("Enter a media URL to download.", true);
      return;
    }

    setIsDownloading(true);
    try {
      const job = await api.createMediaDownloadJob(url);
      setDownloadUrl("");
      notify(`Queued download job ${job.job_id}. Track it in Jobs.`);
    } catch (downloadError) {
      console.error(downloadError);
      notify(downloadError instanceof Error ? downloadError.message : "Download failed.", true);
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
    try {
      const response = await api.uploadMediaVideo(selectedUploadFile);
      setShowUploadModal(false);
      setSelectedUploadFile(null);
      setMode("player");
      notify(`Uploaded ${response.video.title}.`);
      await loadMedia();
      setSelectedFilename(response.video.filename);
    } catch (uploadError) {
      console.error(uploadError);
      notify(uploadError instanceof Error ? uploadError.message : "Upload failed.", true);
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
      notify(`Frame exported to ${response.path}`);
      setShowExportModal(false);
    } catch (exportError) {
      console.error(exportError);
      notify(exportError instanceof Error ? exportError.message : "Frame export failed.", true);
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
      notify(`Frame exported to ${response.path}`);
      setShowDatasetModal(false);
    } catch (exportError) {
      console.error(exportError);
      notify(exportError instanceof Error ? exportError.message : "Dataset export failed.", true);
    } finally {
      setIsExporting(false);
    }
  }

  async function exportClipToDirectory() {
    if (!selectedFilename || clipStart === null || clipEnd === null) return;
    setIsClipExporting(true);
    try {
      const response = await api.exportMediaClip({
        filename: selectedFilename,
        startTime: clipStart,
        endTime: clipEnd,
        outputDir: clipDirectory,
        outputFilename: clipFilename,
      });
      notify(`Clip exported to ${response.path}`);
      setShowClipExportModal(false);
    } catch (exportError) {
      console.error(exportError);
      notify(exportError instanceof Error ? exportError.message : "Clip export failed.", true);
    } finally {
      setIsClipExporting(false);
    }
  }

  async function exportClipToDataset() {
    if (!selectedFilename || clipStart === null || clipEnd === null || targetDatasetId === null) return;
    setIsClipExporting(true);
    try {
      const response = await api.exportMediaClipToDataset({
        filename: selectedFilename,
        startTime: clipStart,
        endTime: clipEnd,
        datasetId: targetDatasetId,
        outputFilename: clipFilename,
      });
      notify(`Clip added to dataset: ${response.path}`);
      setShowClipDatasetModal(false);
    } catch (exportError) {
      console.error(exportError);
      notify(exportError instanceof Error ? exportError.message : "Clip dataset export failed.", true);
    } finally {
      setIsClipExporting(false);
    }
  }
  async function handleDeleteVideo(e: React.MouseEvent, filename: string) {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;

    try {
      await api.deleteMediaVideo(filename);
      notify(`Deleted ${filename}.`);
      if (selectedFilename === filename) {
        setSelectedFilename(null);
      }
      await loadMedia();
    } catch (err) {
      console.error(err);
      notify(err instanceof Error ? err.message : "Failed to delete video.", true);
    }
  }

  function handleSwapFaceSelected(file: File) {
    if (swapFacePreviewUrl) URL.revokeObjectURL(swapFacePreviewUrl);
    setSwapFaceFile(file);
    setSwapFacePreviewUrl(URL.createObjectURL(file));
  }

  async function handlePreviewSwap() {
    if (!swapFaceFile || !selectedVideo) return;
    const timestampSeconds = videoRef.current?.currentTime ?? currentTime;
    setIsSwapPreviewing(true);
    setShowSwapPreviewModal(true);
    setSwapPreviewImageUrl(null);
    setSwapPreviewMask(null);
    try {
      const preview = await api.swapPreview({
        faceImage: swapFaceFile,
        videoFilename: selectedVideo.filename,
        timestampSeconds,
        maskStrength,
        maskFeather,
        maskVerticalRatio,
        maskAnchor,
      });
      setSwapPreviewImageUrl(preview.url);
      setSwapPreviewMask(preview.mask);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Preview failed.", true);
      setShowSwapPreviewModal(false);
    } finally {
      setIsSwapPreviewing(false);
    }
  }

  async function handleRerunPreview() {
    if (!swapFaceFile || !selectedVideo) return;
    const timestampSeconds = videoRef.current?.currentTime ?? currentTime;
    setIsSwapPreviewing(true);
    setSwapPreviewImageUrl(null);
    setSwapPreviewMask(null);
    try {
      const preview = await api.swapPreview({
        faceImage: swapFaceFile,
        videoFilename: selectedVideo.filename,
        timestampSeconds,
        maskStrength,
        maskFeather,
        maskVerticalRatio,
        maskAnchor,
      });
      setSwapPreviewImageUrl(preview.url);
      setSwapPreviewMask(preview.mask);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Preview failed.", true);
    } finally {
      setIsSwapPreviewing(false);
    }
  }

  async function handleRunSwap() {
    if (!swapFaceFile || !selectedVideo) return;
    setIsSwapRunning(true);
    setIsSwapCancelling(false);
    setSwapPreviewFrameUrl(null);
    setSwapProgress(null);
    try {
      const response = await api.swapRun({
        faceImage: swapFaceFile,
        videoFilename: selectedVideo.filename,
        outputFilename: swapOutputPath,
        maskStrength,
        maskFeather,
        maskVerticalRatio,
        maskAnchor,
      });
      setSwapJobId(response.job_id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Swap failed to start.", true);
      setIsSwapRunning(false);
      setIsSwapCancelling(false);
    }
  }

  async function handleCancelSwap() {
    if (!swapJobId || isSwapCancelling) return;
    setIsSwapCancelling(true);
    try {
      await api.swapCancel(swapJobId);
      notify("Stopping swap after the current frame. Partial output will be saved.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to stop swap.", true);
      setIsSwapCancelling(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (!selectedVideo) return;

      if (event.key === " ") {
        event.preventDefault();
        togglePlayback();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekByFrames(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        seekByFrames(1);
        return;
      }
      if (event.key === "[") {
        event.preventDefault();
        setClipStart(videoRef.current?.currentTime ?? currentTime);
        return;
      }
      if (event.key === "]") {
        event.preventDefault();
        setClipEnd(videoRef.current?.currentTime ?? currentTime);
        return;
      }
      if (event.key.toLowerCase() === "p" && mode === "swap" && swapFaceFile && !isSwapPreviewing) {
        event.preventDefault();
        void handlePreviewSwap();
        return;
      }
      if (event.key === "Escape" && isSwapRunning && swapJobId && !isSwapCancelling) {
        event.preventDefault();
        void handleCancelSwap();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentTime,
    isSwapCancelling,
    isSwapPreviewing,
    isSwapRunning,
    jumpFrames,
    jumpFps,
    mode,
    selectedVideo,
    swapFaceFile,
    swapJobId,
  ]);

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
              <button
                className={mode === "swap" ? "primary-button" : "secondary-button"}
                type="button"
                onClick={() => setMode("swap")}
              >
                Swap
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
                    <button
                      className="media-card-delete-btn"
                      type="button"
                      title="Delete video"
                      onClick={(e) => void handleDeleteVideo(e, video.filename)}
                    >
                      ×
                    </button>
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
                  <div className="download-url-card">
                    <div className="download-url-row">
                      <input
                        className="download-url-input"
                        type="text"
                        value={downloadUrl}
                        onChange={(event) => setDownloadUrl(event.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void handleDownload(); }}
                        placeholder="https://www.youtube.com/watch?v=..."
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button
                        className="primary-button download-url-btn"
                        type="button"
                        onClick={() => void handleDownload()}
                        disabled={isDownloading}
                      >
                        {isDownloading ? (
                          <span className="download-spinner" />
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M8 1v9M4 7l4 4 4-4M2 13h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        {isDownloading ? "Downloading…" : "Download"}
                      </button>
                    </div>
                    {urlCases.length > 0 && downloadUrl && applyUrlCases(downloadUrl.trim()) !== downloadUrl.trim() && (
                      <div className="download-url-preview">
                        <span className="download-url-preview-label">Cleaned URL:</span>
                        <span className="download-url-preview-value">{applyUrlCases(downloadUrl.trim())}</span>
                      </div>
                    )}
                    <p className="panel-muted" style={{ marginTop: "0.75rem" }}>
                      Downloads are saved to <code>uploads/</code> and appear in the player list.
                    </p>
                  </div>
                </PageSection>

                <PageSection eyebrow="Rules" title="URL Cases">
                  <p className="panel-muted" style={{ marginBottom: "1rem" }}>
                    Each rule strips a URL at the first occurrence of the split pattern. Optionally restrict a rule to specific domains — if no domains are added, the rule applies to all URLs.
                  </p>
                  {urlCases.length > 0 && (
                    <div className="url-cases-list">
                      {urlCases.map(({ pattern, baseUrls }) => (
                        <div key={pattern} className="url-case-item">
                          <div className="url-case-header">
                            <div className="url-case-header-left">
                              <span className="url-case-label">Split on</span>
                              <code className="url-case-pattern">{pattern}</code>
                            </div>
                            <button
                              className="url-case-delete"
                              type="button"
                              onClick={() => removeUrlCase(pattern)}
                              title="Remove rule"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="url-case-domains">
                            <span className="url-case-label">{baseUrls.length === 0 ? "Domains: all" : "Domains:"}</span>
                            <div className="url-case-chips">
                              {baseUrls.map((b) => (
                                <span key={b} className="url-case-chip">
                                  {b}
                                  <button
                                    type="button"
                                    className="url-case-chip-remove"
                                    onClick={() => removeBaseUrl(pattern, b)}
                                    title={`Remove ${b}`}
                                  >✕</button>
                                </span>
                              ))}
                              <input
                                className="url-case-chip-input"
                                type="text"
                                value={newBaseUrlInputs[pattern] ?? ""}
                                onChange={(e) => setNewBaseUrlInputs((prev) => ({ ...prev, [pattern]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === "Enter") addBaseUrl(pattern); }}
                                placeholder="add domain…"
                                spellCheck={false}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="url-case-add-row">
                    <input
                      className="url-case-input"
                      type="text"
                      value={newUrlPattern}
                      onChange={(e) => setNewUrlPattern(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") addUrlCase(); }}
                      placeholder="e.g. ?utm_source"
                      spellCheck={false}
                    />
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={addUrlCase}
                      disabled={!newUrlPattern.trim()}
                    >
                      Add Rule
                    </button>
                  </div>
                </PageSection>
              </div>
            ) : mode === "swap" ? (
              <div className="page-stack">
                <PageSection eyebrow="Face Swap" title={selectedVideo?.title ?? "Select a video"}>
                  <input
                    ref={swapFaceInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleSwapFaceSelected(file);
                      event.target.value = "";
                    }}
                  />
                  {!selectedVideo ? (
                    <div className="empty-state">Select a video from the left to begin swapping.</div>
                  ) : (
                    <div className="swap-panel">
                      <div className="swap-inputs-row">
                        <div>
                          <div className="swap-face-label">Reference Face</div>
                          <button
                            className="swap-face-tile"
                            type="button"
                            onClick={() => swapFaceInputRef.current?.click()}
                            title="Upload a reference face image"
                          >
                            {swapFacePreviewUrl ? (
                              <img src={swapFacePreviewUrl} alt="reference face" />
                            ) : (
                              <>
                                <span className="swap-face-tile-plus">+</span>
                                <span className="swap-face-tile-hint">Upload face image</span>
                              </>
                            )}
                          </button>
                        </div>

                        <div className="swap-video-wrapper">
                          <div className="swap-face-label">Target Video</div>
                          <div className="swap-video-container">
                            <video
                              key={selectedVideo.filename}
                              ref={videoRef}
                              src={selectedVideo.video_url}
                              className="media-video-element"
                              preload="metadata"
                              crossOrigin="anonymous"
                            />
                            {isSwapRunning ? (
                              <div className="swap-job-overlay">
                                <div className="swap-job-overlay-card">
                                  <span className="swap-job-overlay-label">{isSwapCancelling ? "Stopping..." : "Processing..."}</span>
                                  <span className="swap-job-overlay-count">
                                    {swapProgress ? `${swapProgress.current} / ${swapProgress.total} frames` : "Starting..."}
                                  </span>
                                  {swapPreviewFrameUrl ? (
                                    <img className="swap-job-preview-thumb" src={swapPreviewFrameUrl} alt="latest swapped frame" />
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                          </div>
                          {!isSwapRunning ? (
                            <div className="media-controls-bar swap-video-controls">
                              <div
                                ref={seekbarRef}
                                className="media-seekbar-track"
                                onPointerDown={handleSeekPointerDown}
                                onPointerMove={handleSeekPointerMove}
                              >
                                <div className="media-seekbar-fill" style={{ width: `${seekPercent}%` }} />
                                <div className="media-seekbar-thumb" style={{ left: `${seekPercent}%` }} />
                              </div>

                              <div className="media-transport-row swap-transport-row">
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
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="swap-output-row">
                        <label className="swap-output-label">Output filename</label>
                        <input
                          value={swapOutputPath}
                          onChange={(event) => setSwapOutputPath(event.target.value)}
                          spellCheck={false}
                        />
                      </div>

                      <div className="swap-action-row">
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={!swapFaceFile || isSwapPreviewing || isSwapRunning}
                          onClick={() => void handlePreviewSwap()}
                        >
                          {isSwapPreviewing ? "Previewing..." : "Preview Swap"}
                        </button>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={!swapFaceFile || isSwapRunning}
                          onClick={() => void handleRunSwap()}
                        >
                          {isSwapRunning ? "Swapping..." : "Swap Video"}
                        </button>
                        {isSwapRunning ? (
                          <button
                            className="danger-button"
                            type="button"
                            disabled={isSwapCancelling}
                            onClick={() => void handleCancelSwap()}
                          >
                            {isSwapCancelling ? "Stopping..." : "Stop & Save"}
                          </button>
                        ) : null}
                      </div>

                      {isSwapRunning && swapProgress ? (
                        <div className="swap-progress-bar">
                          <div className="swap-progress-header">
                            <span>Swapping frames...</span>
                            <span className="swap-slider-value">
                              {swapProgress.current} / {swapProgress.total} ({swapProgress.total > 0 ? Math.round((swapProgress.current / swapProgress.total) * 100) : 0}%)
                            </span>
                          </div>
                          <div className="swap-progress-track">
                            <div
                              className="swap-progress-fill"
                              style={{ width: `${swapProgress.total > 0 ? (swapProgress.current / swapProgress.total) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
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
                          {clipStartPercent !== null && (
                            <div
                              className="media-seekbar-marker start"
                              style={{ left: `${clipStartPercent}%` }}
                              title={`Start: ${formatClock(clipStart!)}`}
                            />
                          )}
                          {clipEndPercent !== null && (
                            <div
                              className="media-seekbar-marker end"
                              style={{ left: `${clipEndPercent}%` }}
                              title={`End: ${formatClock(clipEnd!)}`}
                            />
                          )}
                          {clipStartPercent !== null && clipEndPercent !== null && (
                            <div
                              className="media-seekbar-clip-range"
                              style={{
                                left: `${Math.min(clipStartPercent, clipEndPercent)}%`,
                                width: `${Math.abs(clipEndPercent - clipStartPercent)}%`,
                              }}
                            />
                          )}
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

                          <button
                            className="secondary-button compact"
                            type="button"
                            onClick={() => setClipStart(currentTime)}
                          >
                            Set Start
                          </button>
                          <button
                            className="secondary-button compact"
                            type="button"
                            onClick={() => setClipEnd(currentTime)}
                          >
                            Set End
                          </button>

                          <button
                            className="primary-button"
                            type="button"
                            onClick={() => setShowClipExportModal(true)}
                            disabled={clipStart === null || clipEnd === null}
                          >
                            Export Clip
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => setShowClipDatasetModal(true)}
                            disabled={clipStart === null || clipEnd === null || datasets.length === 0}
                          >
                            Clip → Dataset
                          </button>

                          <div className="divider-v" />

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
      {/* Export clip modal */}
      {showClipExportModal ? (
        <div className="modal-backdrop" onClick={() => setShowClipExportModal(false)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="eyebrow">Clip Export</span>
              <h3>Export Clip</h3>
            </div>
            <div className="modal-field">
              <label className="modal-label">Output Directory</label>
              <input value={clipDirectory} onChange={(event) => setClipDirectory(event.target.value)} />
            </div>
            <div className="modal-field">
              <label className="modal-label">Filename</label>
              <input value={clipFilename} onChange={(event) => setClipFilename(event.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setShowClipExportModal(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void exportClipToDirectory()}
                disabled={isClipExporting}
              >
                {isClipExporting ? "Exporting..." : "Export"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Export clip to dataset modal */}
      {showClipDatasetModal ? (
        <div className="modal-backdrop" onClick={() => setShowClipDatasetModal(false)}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="eyebrow">Dataset Export</span>
              <h3>Add Clip To Dataset</h3>
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
              <input value={clipFilename} onChange={(event) => setClipFilename(event.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setShowClipDatasetModal(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void exportClipToDataset()}
                disabled={targetDatasetId === null || isClipExporting}
              >
                {isClipExporting ? "Exporting..." : "Export"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showSwapPreviewModal ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!isSwapPreviewing) setShowSwapPreviewModal(false);
          }}
        >
          <div className="modal-box swap-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <span className="eyebrow">Face Swap</span>
              <h3>Preview Swap</h3>
            </div>

            <div className="swap-preview-modal-body">
              {swapPreviewImageUrl ? (
                <div
                  className="swap-preview-image-wrap"
                  style={swapPreviewMask ? { aspectRatio: `${swapPreviewMask.image_width} / ${swapPreviewMask.image_height}` } : undefined}
                >
                  <img className="swap-preview-image" src={swapPreviewImageUrl} alt="swap preview" />
                  {swapPreviewMask && swapMaskSlice ? (
                    <svg
                      className="swap-mask-overlay"
                      viewBox={`0 0 ${swapPreviewMask.image_width} ${swapPreviewMask.image_height}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <defs>
                        <clipPath id="swap-mask-face-clip">
                          <ellipse cx={swapMaskSlice.cx} cy={swapMaskSlice.cy} rx={swapMaskSlice.rx} ry={swapMaskSlice.ry} />
                        </clipPath>
                      </defs>
                      <rect
                        x={0}
                        y={swapMaskSlice.sliceY}
                        width={swapPreviewMask.image_width}
                        height={swapMaskSlice.sliceHeight}
                        className="swap-mask-fill"
                        clipPath="url(#swap-mask-face-clip)"
                      />
                      <ellipse
                        cx={swapMaskSlice.cx}
                        cy={swapMaskSlice.cy}
                        rx={swapMaskSlice.rx}
                        ry={swapMaskSlice.ry}
                        className="swap-mask-outline"
                      />
                      <line
                        x1={swapMaskSlice.x1}
                        y1={swapMaskSlice.sliceY}
                        x2={swapMaskSlice.x2}
                        y2={swapMaskSlice.sliceY}
                        className="swap-mask-cutline"
                      />
                      <line
                        x1={swapMaskSlice.x1}
                        y1={swapMaskSlice.sliceY + swapMaskSlice.sliceHeight}
                        x2={swapMaskSlice.x2}
                        y2={swapMaskSlice.sliceY + swapMaskSlice.sliceHeight}
                        className="swap-mask-cutline"
                      />
                    </svg>
                  ) : null}
                </div>
              ) : (
                <div className="swap-preview-image-placeholder">
                  {isSwapPreviewing ? "Running swap..." : "No preview yet"}
                </div>
              )}

              <div className="swap-settings-panel">
                <div className="swap-settings-label">Mask Settings</div>

                <label className="swap-slider-row">
                  <div className="swap-slider-header">
                    <span>Mask Strength</span>
                    <span className="swap-slider-value">{maskStrength.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={maskStrength}
                    onChange={(event) => setMaskStrength(Number(event.target.value))}
                  />
                </label>

                <label className="swap-slider-row">
                  <div className="swap-slider-header">
                    <span>Mask Feather</span>
                    <span className="swap-slider-value">{maskFeather.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={maskFeather}
                    onChange={(event) => setMaskFeather(Number(event.target.value))}
                  />
                </label>

                <label className="swap-slider-row">
                  <div className="swap-slider-header">
                    <span>Mask Vertical Ratio</span>
                    <span className="swap-slider-value">{maskVerticalRatio.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.01}
                    value={maskVerticalRatio}
                    onChange={(event) => setMaskVerticalRatio(Number(event.target.value))}
                  />
                </label>

                <label className="swap-slider-row">
                  <div className="swap-slider-header">
                    <span>Mask Anchor</span>
                  </div>
                  <select
                    className="swap-anchor-select"
                    value={maskAnchor}
                    onChange={(event) => setMaskAnchor(event.target.value as SwapMaskAnchor)}
                  >
                    <option value="top">Top</option>
                    <option value="center">Center</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </label>

                <p className="swap-mask-summary">
                  {maskAnchor[0].toUpperCase() + maskAnchor.slice(1)} {Math.round(maskVerticalRatio * 100)}% mask.
                </p>

                <div className="swap-settings-divider" />

                <button
                  className="secondary-button"
                  type="button"
                  disabled={isSwapPreviewing}
                  onClick={() => void handleRerunPreview()}
                >
                  {isSwapPreviewing ? "Running..." : "Re-run Preview"}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setShowSwapPreviewModal(false)}
                >
                  Use These Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
