import { useEffect, useState } from "react";

import { ApiError, api, type GenerateQueueStatus, type GenerateWorkerStatus, type Job } from "../lib/api";

type UseWorkerStatusOptions = {
  setError?: (value: string | null) => void;
};

export function useWorkerStatus({ setError }: UseWorkerStatusOptions = {}) {
  const [workerStatus, setWorkerStatus] = useState<GenerateWorkerStatus | null>(null);
  const [queueStatus, setQueueStatus] = useState<GenerateQueueStatus | null>(null);
  const [isUnloading, setIsUnloading] = useState(false);

  async function refreshWorkerStatus() {
    try {
      const [worker, queue] = await Promise.all([
        api.getGenerateWorkerStatus(),
        api.getGenerateQueueStatus(),
      ]);
      setWorkerStatus(worker);
      setQueueStatus(queue);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void refreshWorkerStatus();
    const id = window.setInterval(() => void refreshWorkerStatus(), 500);
    return () => window.clearInterval(id);
  }, []);

  async function handleUnloadWorker(trainingJob?: Job | null) {
    setIsUnloading(true);
    try {
      if (trainingJob) {
        await api.cancelJob(trainingJob.id);
      }
      await api.unloadGenerateWorkers();
      await refreshWorkerStatus();
      setError?.(null);
    } catch (error) {
      setError?.(error instanceof ApiError ? error.message : "Failed to unload models.");
    } finally {
      setIsUnloading(false);
    }
  }

  return {
    workerStatus,
    queueStatus,
    isUnloading,
    handleUnloadWorker,
    refreshWorkerStatus,
  };
}
