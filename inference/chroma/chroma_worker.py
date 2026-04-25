from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
import time


def emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


def find_flux_pipeline() -> str:
    """Locate FLUX.1-schnell or FLUX.1-dev in the local HF hub cache."""
    import os
    from pathlib import Path

    hf_home = os.environ.get("HF_HOME") or os.path.join(
        os.path.expanduser("~"), ".cache", "huggingface"
    )
    hub_dir = Path(hf_home) / "hub"

    candidates = [
        "models--black-forest-labs--FLUX.1-schnell",
        "models--black-forest-labs--FLUX.1-dev",
    ]
    for candidate in candidates:
        snapshots_dir = hub_dir / candidate / "snapshots"
        if not snapshots_dir.exists():
            continue
        # Prefer the hash pointed to by refs/main, fall back to most recent dir.
        refs_main = hub_dir / candidate / "refs" / "main"
        if refs_main.exists():
            commit = refs_main.read_text().strip()
            snapshot = snapshots_dir / commit
            if snapshot.exists():
                return str(snapshot)
        snapshots = sorted(snapshots_dir.iterdir())
        if snapshots:
            return str(snapshots[-1])

    raise RuntimeError(
        "Could not find FLUX.1-schnell or FLUX.1-dev in the local HuggingFace cache "
        f"(searched {hub_dir}). Download one of these models first."
    )


def load_runtime(args: argparse.Namespace):
    import torch
    from diffusers import ChromaPipeline, ChromaTransformer2DModel

    dtype = torch.bfloat16

    emit({"type": "stage", "stage": "loading_transformer"})
    transformer = ChromaTransformer2DModel.from_single_file(
        args.ckpt_path, torch_dtype=dtype
    )

    emit({"type": "stage", "stage": "loading_pipeline"})
    pipeline_path = args.pipeline_repo or find_flux_pipeline()
    pipe = ChromaPipeline.from_pretrained(
        pipeline_path,
        transformer=transformer,
        torch_dtype=dtype,
        local_files_only=True,
    )

    try:
        pipe.enable_model_cpu_offload()
    except Exception:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        pipe.to(device)

    try:
        pipe.enable_vae_tiling()
    except Exception:
        pass
    try:
        pipe.enable_vae_slicing()
    except Exception:
        pass

    return pipe


def generate_batch(pipe, request: dict) -> list[str]:
    import torch

    prompt = request["prompt"]
    negative_prompt = request.get("negative_prompt", "") or ""
    output_dir = request["output_dir"]
    steps = int(request["steps"])
    cfg_scale = float(request["cfg_scale"])
    width = int(request["width"])
    height = int(request["height"])
    seed = request.get("seed")
    batch_count = max(1, int(request.get("batch_count", 1)))

    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    filenames: list[str] = []
    generation_started_at = time.perf_counter()

    for batch_idx in range(batch_count):
        img_seed = (seed + batch_idx) if seed is not None else None
        generator = (
            torch.Generator(device="cpu").manual_seed(img_seed)
            if img_seed is not None
            else None
        )

        started_at = generation_started_at

        def _make_callback(idx: int, t0: float):
            def callback_on_step_end(_pipe, step_index, timestep, callback_kwargs):
                current_step = step_index + 1
                elapsed = max(time.perf_counter() - t0, 1e-6)
                it_s = current_step / elapsed
                if it_s >= 1:
                    rate_value, rate_unit = it_s, "it/s"
                else:
                    rate_value, rate_unit = 1.0 / it_s, "s/it"
                emit({
                    "type": "progress",
                    "step": current_step,
                    "total": steps,
                    "rate_value": round(rate_value, 2),
                    "rate_unit": rate_unit,
                    "batch_index": idx,
                    "batch_total": batch_count,
                })
                return callback_kwargs
            return callback_on_step_end

        call_kwargs: dict = {
            "prompt": prompt,
            "num_inference_steps": steps,
            "guidance_scale": cfg_scale,
            "width": width,
            "height": height,
            "generator": generator,
            "callback_on_step_end": _make_callback(batch_idx, started_at),
        }
        if negative_prompt:
            call_kwargs["negative_prompt"] = negative_prompt

        try:
            result = pipe(**call_kwargs)
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            if hasattr(pipe, "enable_sequential_cpu_offload"):
                try:
                    pipe.enable_sequential_cpu_offload()
                except Exception:
                    pipe.to("cpu")
            else:
                pipe.to("cpu")
            result = pipe(**call_kwargs)

        image = result.images[0]
        filename = f"image_{timestamp}_{batch_idx:03d}.png"
        image.save(os.path.join(output_dir, filename))
        filenames.append(filename)

    return filenames


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ckpt_path", required=True, help="Path to Chroma transformer .safetensors")
    parser.add_argument("--pipeline_repo", default="", help="Local path to FLUX.1 pipeline (auto-detected if omitted)")
    args = parser.parse_args()

    try:
        pipe = load_runtime(args)
    except Exception as exc:
        emit({"type": "startup_error", "error": str(exc)})
        raise

    emit({"type": "ready"})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            emit({"type": "error", "error": "Invalid request payload."})
            continue

        if request.get("type") == "shutdown":
            emit({"type": "shutdown"})
            break

        try:
            filenames = generate_batch(pipe, request)
            emit({"type": "completed", "filenames": filenames})
        except Exception as exc:
            emit({"type": "error", "error": str(exc)})


if __name__ == "__main__":
    main()
