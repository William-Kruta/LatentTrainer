import { useEffect, useRef, useState } from "react";

import { PageSection } from "../components/PageSection";
import { api, type ConfigSummary, type Dataset, type Job } from "../lib/api";

interface Stats { loss: string; step: string; eta: string; speed: string; progress: number; }
const BLANK_STATS: Stats = { loss: "—", step: "—", eta: "—", speed: "—", progress: 0 };

function parseStats(line: string): Partial<Stats> {
  const out: Partial<Stats> = {};

  // tqdm step counter: "| 52/3000 ["
  const stepMatch = line.match(/\|\s*(\d+)\/(\d+)\s*\[/);
  if (stepMatch) {
    const cur = parseInt(stepMatch[1]);
    const tot = parseInt(stepMatch[2]);
    out.step = `${cur} / ${tot}`;
    out.progress = Math.round((cur / tot) * 100);
  }

  // ETA after "<": "<1:30:20,"
  const etaMatch = line.match(/<(\d+:\d+(?::\d+)?)[,\]]/);
  if (etaMatch) out.eta = etaMatch[1];

  // Speed: "1.84s/it" → convert to it/s, or "1.23it/s"
  const sitMatch = line.match(/([\d.]+)s\/it/);
  if (sitMatch) out.speed = (1 / parseFloat(sitMatch[1])).toFixed(2);
  const itsMatch = line.match(/([\d.]+)it\/s/);
  if (itsMatch) out.speed = parseFloat(itsMatch[1]).toFixed(2);

  // Loss: "avr_loss=0.0692"
  const lossMatch = line.match(/avr_loss=([\d.]+)/);
  if (lossMatch) out.loss = parseFloat(lossMatch[1]).toFixed(4);

  return out;
}

const defaultForm = {
  name: "my_lora_v1",
  config_id: 0,
  dataset_id: 0,
};

export function TrainingPage() {
  const [configs, setConfigs] = useState<ConfigSummary[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>(BLANK_STATS);
  const logEndRef = useRef<HTMLDivElement>(null);
  const streamingJobId = useRef<number | null>(null);

  useEffect(() => {
    Promise.all([api.getConfigs(), api.getDatasets(), api.getJobs()])
      .then(([configData, datasetData, jobData]) => {
        setConfigs(configData);
        setDatasets(datasetData);
        setJobs(jobData);
        setForm((current) => ({
          ...current,
          config_id: current.config_id || configData[0]?.id || 0,
          dataset_id: current.dataset_id || datasetData[0]?.id || 0,
        }));
        const running = jobData.find((j) => j.status === "running");
        if (running) connectStream(running.id);
      })
      .catch(console.error);
  }, []);

  // Auto-scroll log to bottom as new lines arrive.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  function connectStream(jobId: number) {
    if (streamingJobId.current === jobId) return;
    streamingJobId.current = jobId;
    setLogLines([]);
    setStats(BLANK_STATS);

    const es = new EventSource(`/api/jobs/${jobId}/stream`);

    es.onmessage = (evt) => {
      setLogLines((prev) => [...prev, evt.data]);
      const parsed = parseStats(evt.data);
      if (Object.keys(parsed).length > 0) setStats((prev) => ({ ...prev, ...parsed }));
    };

    es.onerror = () => {
      es.close();
      streamingJobId.current = null;
      // Refresh job list so status pill updates.
      api.getJobs().then(setJobs).catch(console.error);
    };

    // Also close when the server closes the stream (readyState → CLOSED).
    const poll = setInterval(() => {
      if (es.readyState === EventSource.CLOSED) {
        clearInterval(poll);
        streamingJobId.current = null;
        api.getJobs().then(setJobs).catch(console.error);
      }
    }, 1000);
  }

  const runningJob = jobs.find((job) => job.status === "running");
  const stoppedJob = !runningJob ? jobs.find((job) => job.status === "stopped") : undefined;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const created = await api.createJob({ ...form, output_dir: `outputs/${form.name}` });
      setJobs((current) => [created, ...current]);
      connectStream(created.id);
    } catch {
      setError("Unable to start training. Another job may already be running.");
    }
  }

  return (
    <div className="split-page">
      <PageSection eyebrow="Run Setup" title="New Training Run" className="left-rail" bare>
        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            <span>Run Name</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            <span>Config</span>
            <select
              value={form.config_id}
              onChange={(event) => setForm({ ...form, config_id: Number(event.target.value) })}
            >
              {configs.map((config) => (
                <option key={config.id} value={config.id}>
                  {config.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Dataset</span>
            <select
              value={form.dataset_id}
              onChange={(event) => setForm({ ...form, dataset_id: Number(event.target.value) })}
            >
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
          </label>
          {error ? <div className="error-banner">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={!!runningJob || !!stoppedJob}>
            {runningJob ? "Training in progress…" : stoppedJob ? "Resume or cancel stopped job first" : "Start Training"}
          </button>
        </form>
      </PageSection>

      <PageSection eyebrow="Live Output" title="Training Log" className="main-panel" bare>
        <div className="panel-toolbar">
          <span className={`status-pill ${runningJob ? "running" : stoppedJob ? "stopped" : "pending"}`}>
            {runningJob ? "RUNNING" : stoppedJob ? "STOPPED" : "IDLE"}
          </span>
          <span className="panel-muted">{runningJob ? runningJob.name : stoppedJob ? stoppedJob.name : "No active job"}</span>
          {runningJob && (
            <button
              className="danger-button"
              type="button"
              onClick={() => api.cancelJob(runningJob.id).catch(console.error)}
            >
              Stop
            </button>
          )}
          {stoppedJob && (
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                api.resumeJob(stoppedJob.id)
                  .then(() => api.getJobs().then(setJobs))
                  .then(() => connectStream(stoppedJob.id))
                  .catch(console.error);
              }}
            >
              Resume "{stoppedJob.name}"
            </button>
          )}
        </div>
        <div className="meter">
          <div className="meter-fill accent" style={{ width: `${stats.progress}%`, transition: "width 0.5s" }} />
        </div>
        {logLines.length > 0 ? (
          <div className="log-view">
            {logLines.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        ) : (
          <div className="log-view empty-state" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            {runningJob ? "Connecting to log stream…" : "Start a training run to see output here."}
          </div>
        )}
        <div className="stats-grid">
          {([["Loss", stats.loss], ["Step", stats.step], ["ETA", stats.eta], ["it/s", stats.speed]] as const).map(([label, value]) => (
            <div key={label} className="stat-card">
              <div className="eyebrow">{label}</div>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </PageSection>
    </div>
  );
}
