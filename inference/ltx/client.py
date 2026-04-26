from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Callable

HF_CACHE_DIR = "/mnt/machine_learning/AI_APPS/huggingface_cache"


class LtxWorkerClient:
    def __init__(self, *, ltx_install_path: str | Path) -> None:
        self.ltx_install_path = Path(ltx_install_path)
        self.python_path = self.ltx_install_path / ".venv" / "bin" / "python"
        self.worker_script = Path(__file__).resolve().parent / "worker.py"

    def _run(self, args: list[str], on_event: Callable[[dict], None] | None = None) -> dict:
        if not self.python_path.exists():
            raise FileNotFoundError(f"LTX Python runtime not found: {self.python_path}")
        if not self.worker_script.exists():
            raise FileNotFoundError(f"LTX worker script not found: {self.worker_script}")

        command = [str(self.python_path), str(self.worker_script), *args]
        env = os.environ.copy()
        env.setdefault("HF_HOME", HF_CACHE_DIR)
        env["HF_HUB_OFFLINE"] = "0"

        process = subprocess.Popen(
            command,
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
            detail = raw_output[-1] if raw_output else "Unknown LTX worker failure."
            raise RuntimeError(detail)

        if last_json_event is None:
            raise RuntimeError(f"LTX worker returned no JSON output.\n{chr(10).join(raw_output)}")
        return last_json_event

    def generate_video(
        self,
        *,
        prompt: str,
        negative_prompt: str = "",
        checkpoint_path: str,
        gemma_repo_id: str,
        spatial_upsampler_path: str = "",
        distilled_lora_path: str = "",
        distilled_lora_strength: float = 0.8,
        offload_mode: str = "cpu",
        output_path: str | Path,
        width: int = 768,
        height: int = 512,
        num_frames: int = 121,
        frame_rate: int = 24,
        num_inference_steps: int = 30,
        cfg_scale: float = 3.0,
        stg_scale: float = 1.0,
        seed: int = 42,
        input_image_path: str | Path | None = None,
        loras: list[dict] | None = None,
        on_event: Callable[[dict], None] | None = None,
    ) -> Path:
        args = [
            "--checkpoint-path", checkpoint_path,
            "--gemma-repo-id", gemma_repo_id,
            "--prompt", prompt,
            "--negative-prompt", negative_prompt,
            "--output-path", str(output_path),
            "--width", str(width),
            "--height", str(height),
            "--num-frames", str(num_frames),
            "--frame-rate", str(frame_rate),
            "--num-inference-steps", str(num_inference_steps),
            "--cfg-scale", str(cfg_scale),
            "--stg-scale", str(stg_scale),
            "--seed", str(seed),
            "--offload-mode", offload_mode,
        ]
        if input_image_path:
            args.extend(["--input-image", str(input_image_path)])
        if spatial_upsampler_path:
            args.extend(["--spatial-upsampler-path", spatial_upsampler_path])
        if distilled_lora_path:
            args.extend([
                "--distilled-lora-path", distilled_lora_path,
                "--distilled-lora-strength", str(distilled_lora_strength),
            ])
        for lora in loras or []:
            args.extend(["--lora", f"{lora['path']};{lora['strength']}"])

        payload = self._run(args, on_event=on_event)
        return Path(payload["output_path"])
