from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Callable

HF_CACHE_DIR = "/mnt/machine_learning/AI_APPS/huggingface_cache"


class Flux2WorkerClient:
    def __init__(
        self,
        *,
        root_dir: str | Path | None = None,
        hf_repo: str = "black-forest-labs/FLUX.2-klein-9B",
    ) -> None:
        self.root_dir = Path(root_dir or Path(__file__).resolve().parent.parent.parent)
        self.hf_repo = hf_repo
        self.python_path = self.root_dir / ".venv-flux" / "bin" / "python"
        self.worker_script = self.root_dir / "inference" / "flux" / "worker.py"

    def _run(self, args: list[str], on_event: Callable[[dict], None] | None = None) -> dict:
        if not self.python_path.exists():
            raise FileNotFoundError(f"FLUX Python runtime not found: {self.python_path}")
        if not self.worker_script.exists():
            raise FileNotFoundError(f"FLUX worker script not found: {self.worker_script}")

        command = [
            str(self.python_path),
            str(self.worker_script),
            "--hf-repo",
            self.hf_repo,
            *args,
        ]
        env = os.environ.copy()
        env.setdefault("HF_HOME", HF_CACHE_DIR)
        process = subprocess.Popen(
            command,
            cwd=self.root_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )
        assert process.stdout is not None

        last_json_event: dict | None = None
        raw_output: list[str] = []
        for raw_line in process.stdout:
            line = raw_line.strip()
            if not line:
                continue
            raw_output.append(line)
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            last_json_event = event
            if on_event is not None:
                on_event(event)

        return_code = process.wait()
        if return_code != 0:
            detail = raw_output[-1] if raw_output else "Unknown FLUX worker failure."
            raise RuntimeError(detail)

        if last_json_event is None:
            raise RuntimeError(f"FLUX worker returned no JSON output: {' '.join(raw_output)}")
        return last_json_event

    def image_edit(
        self,
        *,
        prompt: str,
        input_files: list[str],
        output_path: str | Path,
        width: int,
        height: int,
        steps: int = 4,
        limit: int | None = None,
        loras: list[dict[str, float | str]] | None = None,
        on_event: Callable[[dict], None] | None = None,
        cpu_offload: bool = False,
        sequential_cpu_offload: bool = False,
        vae_tiling: bool = False,
        vae_slicing: bool = False,
    ) -> Path:
        args = [
            "image-edit",
            "--prompt",
            prompt,
            "--output-path",
            str(output_path),
            "--width",
            str(width),
            "--height",
            str(height),
            "--steps",
            str(steps),
        ]
        if limit is not None:
            args.extend(["--limit", str(limit)])
        for lora in loras or []:
            args.extend(["--lora-weight", f"{lora['path']};{lora['strength']}"])
        for input_file in input_files:
            args.extend(["--input-file", input_file])
        if cpu_offload:
            args.append("--cpu-offload")
        if sequential_cpu_offload:
            args.append("--sequential-cpu-offload")
        if vae_tiling:
            args.append("--vae-tiling")
        if vae_slicing:
            args.append("--vae-slicing")

        payload = self._run(args, on_event=on_event)
        return Path(payload["output_path"])

    def text_to_image(
        self,
        *,
        prompt: str,
        output_path: str | Path,
        steps: int = 4,
        loras: list[dict[str, float | str]] | None = None,
    ) -> Path:
        args = [
            "text-to-image",
            "--prompt",
            prompt,
            "--output-path",
            str(output_path),
            "--steps",
            str(steps),
        ]
        for lora in loras or []:
            args.extend(["--lora-weight", f"{lora['path']};{lora['strength']}"])
        payload = self._run(args)
        return Path(payload["output_path"])
