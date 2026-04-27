import { useEffect, useState } from "react";

import { PageSection } from "../components/PageSection";
import { api, type SystemHealth } from "../lib/api";

export function HealthPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setHealth(await api.getSystemHealth());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load health.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="page-stack">
      <PageSection eyebrow="System" title="Model / Env Health" actions={<button className="secondary-button" onClick={() => void refresh()}>Refresh</button>}>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="health-grid">
          {health?.checks.map(check => (
            <div key={check.name} className={`health-card ${check.ok ? "ok" : "bad"}`}>
              <span className={`status-pill ${check.ok ? "completed" : "failed"}`}>{check.ok ? "ok" : "missing"}</span>
              <strong>{check.name}</strong>
              <code>{check.path || "not configured"}</code>
            </div>
          ))}
        </div>
      </PageSection>
      <PageSection eyebrow="Runtime" title="GPU / Workers">
        <div className="health-grid">
          {health?.gpus.map(gpu => (
            <div key={gpu.id} className="health-card ok">
              <strong>{gpu.name}</strong>
              <span>{gpu.vram_used_gb.toFixed(1)} / {gpu.vram_total_gb.toFixed(1)} GB</span>
              <span>{gpu.utilization_pct}% util · {gpu.temperature_c}C</span>
            </div>
          ))}
          {health ? (
            <div className="health-card">
              <strong>Generate worker</strong>
              <span>SDXL: {health.worker.state}</span>
              <span>Chroma: {health.worker.chroma_state}</span>
              <span>ControlNet: {health.worker.controlnet_state}</span>
            </div>
          ) : null}
        </div>
      </PageSection>
    </div>
  );
}
