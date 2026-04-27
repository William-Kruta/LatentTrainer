import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ErrorDetails } from "./ErrorDetails";
import { api, type DownloadJobStatus, type SystemOverview } from "../lib/api";

const RUNNING = new Set(["running", "queued", "pending", "cancelling"]);

function statusClass(status: string) {
  if (status === "completed" || status === "done") return "completed";
  if (status === "failed" || status === "error") return "failed";
  if (RUNNING.has(status)) return "running";
  return "pending";
}

function pct(current?: number | null, total?: number | null) {
  if (!current || !total || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function JobRow({ title, subtitle, status, progress, error, onCancel }: {
  title: string;
  subtitle?: string;
  status: string;
  progress?: number | null;
  error?: string | null;
  onCancel?: () => void;
}) {
  return (
    <div className="global-job-row">
      <div className="global-job-main">
        <div className="global-job-title">{title}</div>
        {subtitle ? <div className="global-job-subtitle">{subtitle}</div> : null}
        {progress !== null && progress !== undefined ? (
          <div className="global-job-progress"><span style={{ width: `${progress}%` }} /></div>
        ) : null}
        {statusClass(status) === "failed" && error ? (
          <ErrorDetails title={`${title} failed`} message={error} details={{ title, subtitle, status, error }} />
        ) : null}
      </div>
      <span className={`status-pill ${statusClass(status)}`}>{status}</span>
      {onCancel ? (
        <button className="global-job-cancel" type="button" onClick={onCancel}>Stop</button>
      ) : null}
    </div>
  );
}

function flattenJobs(overview: SystemOverview | null) {
  if (!overview) return [];
  const jobs: Array<{
    key: string;
    title: string;
    subtitle?: string;
    status: string;
    progress?: number | null;
    error?: string | null;
    cancel?: () => Promise<unknown>;
  }> = [];

  for (const job of overview.training_jobs.filter(j => ["running", "stopped", "failed"].includes(j.status)).slice(0, 5)) {
    jobs.push({
      key: `training-${job.id}`,
      title: `Training: ${job.name}`,
      subtitle: job.output_dir,
      status: job.status,
      error: job.status === "failed" ? `Training failed. Log: ${job.log_path}` : undefined,
      cancel: job.status === "running" ? () => api.cancelJob(job.id) : undefined,
    });
  }

  if (overview.generate_queue.active_generation_id || overview.generate_queue.queued_count > 0) {
    jobs.push({
      key: "generate-queue",
      title: "Image generation",
      subtitle: `${overview.generate_queue.queued_count} queued`,
      status: overview.generate_queue.active_generation_id ? "running" : "queued",
      cancel: overview.generate_queue.queued_count > 0 ? () => api.removeLatestQueuedGeneration() : undefined,
    });
  }

  for (const job of overview.swap_jobs) {
    jobs.push({
      key: `swap-${job.job_id}`,
      title: "Face swap",
      subtitle: job.output_path ?? job.job_id,
      status: job.status,
      progress: pct(job.current_frame, job.total_frames),
      error: job.error,
      cancel: ["running", "queued"].includes(job.status) ? () => api.swapCancel(job.job_id) : undefined,
    });
  }

  for (const job of overview.ltx_jobs) {
    jobs.push({
      key: `ltx-${job.job_id}`,
      title: "Video generation",
      subtitle: job.stage ?? job.video_url ?? job.job_id,
      status: job.status,
      progress: pct(job.current_step, job.total_steps),
      error: job.error,
    });
  }

  for (const job of overview.image_edit_jobs) {
    jobs.push({
      key: `image-edit-${job.job_id}`,
      title: "Image edit",
      subtitle: job.stage ?? job.image_url ?? job.job_id,
      status: job.status,
      progress: pct(job.current_step, job.total_steps),
      error: job.error,
    });
  }

  for (const job of overview.download_jobs.slice(0, 8) as DownloadJobStatus[]) {
    jobs.push({
      key: `download-${job.job_id}`,
      title: "Download",
      subtitle: job.video?.title ?? job.label,
      status: job.status,
      progress: pct(job.downloaded_bytes, job.total_bytes),
      error: job.error,
      cancel: ["queued", "running"].includes(job.status) ? () => api.cancelMediaDownloadJob(job.job_id) : undefined,
    });
  }

  return jobs;
}

export function GlobalJobDrawer() {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState<SystemOverview | null>(null);

  async function refresh() {
    const next = await api.getSystemOverview();
    setOverview(next);
  }

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(id);
  }, []);

  const jobs = useMemo(() => flattenJobs(overview), [overview]);
  const activeCount = jobs.filter(job => RUNNING.has(job.status)).length;

  return (
    <>
      <button className="global-jobs-button" type="button" onClick={() => setOpen(true)}>
        Jobs {activeCount > 0 ? <span>{activeCount}</span> : null}
      </button>
      {open ? (
        <div className="drawer-backdrop" onClick={() => setOpen(false)}>
          <aside className="global-job-drawer" onClick={event => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <div className="eyebrow">Global</div>
                <h3>Jobs</h3>
              </div>
              <button className="secondary-button" type="button" onClick={() => setOpen(false)}>Close</button>
            </div>
            <div className="global-job-list">
              {jobs.length === 0 ? <div className="empty-state compact">No active jobs.</div> : null}
              {jobs.map(job => (
                <JobRow
                  key={job.key}
                  title={job.title}
                  subtitle={job.subtitle}
                  status={job.status}
                  progress={job.progress}
                  error={job.error}
                  onCancel={job.cancel ? () => { void job.cancel?.().then(refresh); } : undefined}
                />
              ))}
            </div>
            <div className="drawer-footer">
              <Link to="/health" onClick={() => setOpen(false)}>Open health page</Link>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
