import { useEffect, useState } from "react";

import { PageSection } from "../components/PageSection";
import { api, type GPU, type Job } from "../lib/api";
import { formatDate } from "../lib/format";

export function HomePage() {
  const [gpus, setGpus] = useState<GPU[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    api.getJobs().then(setJobs).catch(console.error);
    api.getGpus().then(setGpus).catch(console.error);
    const intervalId = window.setInterval(() => {
      api.getGpus().then(setGpus).catch(console.error);
    }, 3000);
    return () => window.clearInterval(intervalId);
  }, []);

  const runningJob = jobs.find((job) => job.status === "running");
  const recentJobs = jobs.filter((job) => job.status !== "running").slice(0, 6);

  return (
    <div className="page-stack">
      <PageSection eyebrow="System" title="GPU Status">
        <div className="gpu-grid">
          {gpus.map((gpu) => {
            const usage = Math.round((gpu.vram_used_gb / gpu.vram_total_gb) * 100);
            return (
              <article key={gpu.id} className="gpu-card">
                <div className="gpu-name">
                  GPU {gpu.id} · {gpu.name}
                </div>
                <div className="gpu-statline">
                  {gpu.vram_used_gb} / {gpu.vram_total_gb} GB
                </div>
                <div className="meter">
                  <div className="meter-fill success" style={{ width: `${usage}%` }} />
                </div>
                <div className="gpu-meta">
                  <span>Util {gpu.utilization_pct}%</span>
                  <span>{gpu.temperature_c}°C</span>
                </div>
              </article>
            );
          })}
        </div>
      </PageSection>

      <div className="two-column-home">
        <PageSection eyebrow="Activity" title="Running Jobs">
          {runningJob ? (
            <div className="running-job-card">
              <div className="status-pill running">Running</div>
              <h3>{runningJob.name}</h3>
              <p>Config #{runningJob.config_id} · Dataset #{runningJob.dataset_id}</p>
              <div className="job-stats-inline">
                <span>Started {formatDate(runningJob.started_at)}</span>
                <span>{runningJob.output_dir}</span>
              </div>
            </div>
          ) : (
            <div className="empty-state">No training job is currently running.</div>
          )}
        </PageSection>

        <PageSection eyebrow="History" title="Recent Jobs">
          {recentJobs.length > 0 ? (
            <div className="job-list">
              {recentJobs.map((job) => (
                <div key={job.id} className="job-row">
                  <div>
                    <div className="job-name">{job.name}</div>
                    <div className="job-meta">{formatDate(job.started_at)}</div>
                  </div>
                  <span className={`status-pill ${job.status}`}>{job.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No completed or failed jobs yet.</div>
          )}
        </PageSection>
      </div>
    </div>
  );
}
