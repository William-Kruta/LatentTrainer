#!/usr/bin/env python3
"""
LTX-2 video generation worker.

Invoke with the LTX-2 repo's Python interpreter:
  /path/to/LTX-2/.venv/bin/python inference/ltx/worker.py [args]

Communicates via JSON lines on stdout, matching the flux2_worker pattern.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint-path", required=True)
    p.add_argument("--spatial-upsampler-path", default="")
    p.add_argument("--distilled-lora-path", default="")
    p.add_argument("--distilled-lora-strength", type=float, default=0.8)
    p.add_argument("--gemma-repo-id", required=True)
    p.add_argument("--offload-mode", default="cpu", choices=["none", "cpu", "disk"])
    p.add_argument("--prompt", required=True)
    p.add_argument("--negative-prompt", default="")
    p.add_argument("--output-path", required=True)
    p.add_argument("--width", type=int, default=768)
    p.add_argument("--height", type=int, default=512)
    p.add_argument("--num-frames", type=int, default=121)
    p.add_argument("--frame-rate", type=int, default=24)
    p.add_argument("--num-inference-steps", type=int, default=30)
    p.add_argument("--cfg-scale", type=float, default=3.0)
    p.add_argument("--stg-scale", type=float, default=1.0)
    p.add_argument("--seed", type=int, default=42)
    # Each LoRA: "path;strength"
    p.add_argument("--lora", action="append", dest="loras", default=[])
    return p


def resolve_gemma(repo_id: str) -> str:
    """Download (first run) or return cached local path for the Gemma encoder."""
    emit({"type": "stage", "stage": "resolving_text_encoder"})
    from huggingface_hub import snapshot_download
    local_path = snapshot_download(repo_id)
    return local_path


def main() -> None:
    args = build_parser().parse_args()

    emit({"type": "stage", "stage": "bootstrapping"})
    emit({"type": "stage", "stage": "importing_torch"})
    import torch  # noqa: F401

    emit({"type": "stage", "stage": "importing_ltx"})
    from ltx_pipelines import TI2VidTwoStagesPipeline
    from ltx_core.loader import LoraPathStrengthAndSDOps
    from ltx_core.components.guiders import MultiModalGuiderParams
    from ltx_core.offload import OffloadMode

    gemma_root = resolve_gemma(args.gemma_repo_id)

    offload_map = {
        "none": OffloadMode.NONE,
        "cpu": OffloadMode.CPU,
        "disk": OffloadMode.DISK,
    }
    offload_mode = offload_map[args.offload_mode]

    distilled_loras: list[LoraPathStrengthAndSDOps] = []
    if args.distilled_lora_path:
        distilled_loras = [
            LoraPathStrengthAndSDOps(args.distilled_lora_path, args.distilled_lora_strength)
        ]

    loras: list[LoraPathStrengthAndSDOps] = []
    for spec in args.loras:
        if ";" not in spec:
            raise ValueError(f"LoRA spec must be 'path;strength', got: {spec!r}")
        path, strength = spec.split(";", 1)
        loras.append(LoraPathStrengthAndSDOps(path, float(strength)))

    emit({"type": "stage", "stage": "loading_model"})

    pipeline = TI2VidTwoStagesPipeline(
        checkpoint_path=args.checkpoint_path,
        distilled_lora=distilled_loras,
        spatial_upsampler_path=args.spatial_upsampler_path or None,
        gemma_root=gemma_root,
        loras=loras,
        offload_mode=offload_mode,
    )

    video_guider = MultiModalGuiderParams(
        cfg_scale=args.cfg_scale,
        stg_scale=args.stg_scale,
        rescale_scale=0.6,
        stg_blocks=[29],
    )
    audio_guider = MultiModalGuiderParams(
        cfg_scale=args.cfg_scale,
        stg_scale=args.stg_scale,
        rescale_scale=0.6,
    )

    emit({"type": "stage", "stage": "generating"})

    output_path = Path(args.output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    frame_iter, audio = pipeline(
        prompt=args.prompt,
        negative_prompt=args.negative_prompt,
        seed=args.seed,
        height=args.height,
        width=args.width,
        num_frames=args.num_frames,
        frame_rate=args.frame_rate,
        num_inference_steps=args.num_inference_steps,
        video_guider_params=video_guider,
        audio_guider_params=audio_guider,
        images=[],
    )

    emit({"type": "stage", "stage": "encoding_video"})

    from ltx_pipelines.utils.media_io import encode_video
    encode_video(frame_iter, audio, str(output_path), fps=args.frame_rate)

    emit({"type": "completed", "output_path": str(output_path.resolve())})


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        sys.exit(1)
