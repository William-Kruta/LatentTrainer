from __future__ import annotations

from pathlib import Path
from typing import Callable, Protocol, runtime_checkable

from app.models.generation import GenerateImageRequest


@runtime_checkable
class PersistentWorkerClient(Protocol):
    """Common interface implemented by PersistentGenerateWorker and PersistentChromaWorker."""

    def run(
        self,
        payload: GenerateImageRequest,
        output_dir: Path,
        on_log: Callable[[str], None],
        on_progress: Callable[[int, int, float | None, str | None, int], None],
        on_stage: Callable[[str], None] | None = None,
    ) -> list[str]: ...
