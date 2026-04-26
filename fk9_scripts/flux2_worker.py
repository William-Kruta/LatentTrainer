from __future__ import annotations

import argparse
import importlib
import json
from pathlib import Path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hf-repo", default="black-forest-labs/FLUX.2-klein-9B")

    subparsers = parser.add_subparsers(dest="command", required=True)

    image_edit = subparsers.add_parser("image-edit")
    image_edit.add_argument("--prompt", required=True)
    image_edit.add_argument("--input-file", action="append", dest="input_files", required=True)
    image_edit.add_argument("--output-path", required=True)
    image_edit.add_argument("--width", type=int, required=True)
    image_edit.add_argument("--height", type=int, required=True)
    image_edit.add_argument("--steps", type=int, default=4)
    image_edit.add_argument("--limit", type=int, default=None)
    image_edit.add_argument("--lora-weight", action="append", dest="lora_weights", default=[])

    text_to_image = subparsers.add_parser("text-to-image")
    text_to_image.add_argument("--prompt", required=True)
    text_to_image.add_argument("--output-path", required=True)
    text_to_image.add_argument("--steps", type=int, default=4)
    text_to_image.add_argument("--lora-weight", action="append", dest="lora_weights", default=[])

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    print(json.dumps({"type": "stage", "stage": "bootstrapping"}), flush=True)
    print(json.dumps({"type": "stage", "stage": "importing_torch"}), flush=True)
    importlib.import_module("torch")
    print(json.dumps({"type": "stage", "stage": "importing_pil"}), flush=True)
    importlib.import_module("PIL.Image")
    importlib.import_module("PIL.ImageOps")
    print(json.dumps({"type": "stage", "stage": "importing_diffusers"}), flush=True)
    importlib.import_module("diffusers")
    print(json.dumps({"type": "stage", "stage": "importing_flux2"}), flush=True)
    from flux2 import Flux2Klein

    print(json.dumps({"type": "stage", "stage": "creating_flux_wrapper"}), flush=True)
    flux = Flux2Klein(hf_repo=args.hf_repo)

    loras = []
    for spec in getattr(args, "lora_weights", []) or []:
        if ";" not in spec:
            raise ValueError("Each LoRA weight must be provided as `path;strength`.")
        path, strength = spec.split(";", 1)
        loras.append({"path": path, "strength": float(strength)})

    if args.command == "image-edit":
        output_path = Path(args.output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        generation_started_at = __import__("time").perf_counter()

        def stage_callback(stage: str) -> None:
            print(json.dumps({"type": "stage", "stage": stage}), flush=True)

        def progress_callback(step: int, total: int) -> None:
            elapsed = max(__import__("time").perf_counter() - generation_started_at, 1e-6)
            it_per_second = step / elapsed
            if it_per_second >= 1:
                rate_value = it_per_second
                rate_unit = "it/s"
            else:
                rate_value = 1 / it_per_second
                rate_unit = "s/it"
            print(
                json.dumps(
                    {
                        "type": "progress",
                        "stage": "running",
                        "step": step,
                        "total": total,
                        "rate_value": round(rate_value, 2),
                        "rate_unit": rate_unit,
                    }
                ),
                flush=True,
            )

        stage_callback("loading_model")
        image = flux.image_edit(
            prompt=args.prompt,
            input_files=args.input_files,
            width=args.width,
            height=args.height,
            steps=args.steps,
            limit=args.limit,
            loras=loras,
            progress_callback=progress_callback,
            stage_callback=stage_callback,
        )
        stage_callback("saving")
        image.save(output_path)
        print(json.dumps({"type": "completed", "output_path": str(output_path.resolve())}))
        return

    if args.command == "text-to-image":
        output_path = Path(args.output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        flux.text_2_image(
            prompt=args.prompt,
            output_path=str(output_path),
            steps=args.steps,
            loras=loras,
        )
        print(json.dumps({"type": "completed", "output_path": str(output_path.resolve())}))
        return

    raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
