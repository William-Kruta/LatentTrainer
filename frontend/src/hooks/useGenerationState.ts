import { useEffect, useState } from "react";

import { ApiError, api, type GenerateImageRequest, type GenerateImageResponse } from "../lib/api";

type UseGenerationStateOptions = {
  setError?: (value: string | null) => void;
  onError?: (message: string) => void;
  refreshWorkerStatus?: () => Promise<void> | void;
};

export function useGenerationState({
  setError,
  onError,
  refreshWorkerStatus,
}: UseGenerationStateOptions = {}) {
  const [result, setResult] = useState<GenerateImageResponse | null>(null);
  const [currentGenerationId, setCurrentGenerationId] = useState<string | null>(null);
  const [isSubmittingGeneration, setIsSubmittingGeneration] = useState(false);

  const isGenerating = result?.status === "pending" || result?.status === "running";

  useEffect(() => {
    if (!currentGenerationId) return;
    const generationId = currentGenerationId;
    let cancelled = false;

    const id = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const next = await api.getGeneration(generationId);
        if (cancelled) return;
        setResult(next);
        if (next.status === "completed" || next.status === "failed") {
          window.clearInterval(id);
          if (next.status === "failed") {
            setError?.(next.error ?? "Generation failed.");
          }
        }
      } catch (error) {
        console.error(error);
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [currentGenerationId, setError]);

  async function submitGeneration(
    payload: GenerateImageRequest,
    generateFn?: (p: GenerateImageRequest) => Promise<GenerateImageResponse>,
  ): Promise<GenerateImageResponse | null> {
    setIsSubmittingGeneration(true);
    setError?.(null);
    try {
      const response = await (generateFn ? generateFn(payload) : api.generateImage(payload));
      setResult(response);
      setCurrentGenerationId(response.generation_id);
      await refreshWorkerStatus?.();
      return response;
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Generation failed. Check the model path and backend logs.";
      setError?.(message);
      onError?.(message);
      return null;
    } finally {
      setIsSubmittingGeneration(false);
    }
  }

  async function cancelLatest() {
    try {
      await api.removeLatestQueuedGeneration();
      await refreshWorkerStatus?.();
    } catch (error) {
      setError?.(error instanceof ApiError ? error.message : "Failed to remove queued generation.");
    }
  }

  function clearResult() {
    setResult(null);
    setCurrentGenerationId(null);
  }

  return {
    result,
    isGenerating,
    isSubmittingGeneration,
    submitGeneration,
    cancelLatest,
    clearResult,
  };
}
