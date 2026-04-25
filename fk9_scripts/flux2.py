from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from PIL.Image import Image as PILImage


def pad_to_size(img: "PILImage", target_size: tuple[int, int]) -> "PILImage":
    image_ops = import_module("PIL.ImageOps")
    return image_ops.pad(img, target_size, color=(0, 0, 0))


class Flux2Klein:
    def __init__(self, hf_repo: str = "black-forest-labs/FLUX.2-klein-9b-kv-fp8"):
        self._pipe = None
        self.HF_REPO = hf_repo
        torch = import_module("torch")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

    def _torch(self):
        return import_module("torch")

    def _pipeline_cls(self):
        diffusers = import_module("diffusers")
        return diffusers.Flux2KleinPipeline

    @property
    def pipe(self):
        if self._pipe is None:
            torch = self._torch()
            pipeline_cls = self._pipeline_cls()
            snapshot_download = import_module("huggingface_hub").snapshot_download
            local_path = snapshot_download(self.HF_REPO, local_files_only=True)
            self._pipe = pipeline_cls.from_pretrained(
                local_path,
                torch_dtype=torch.bfloat16,
            )
            try:
                self._pipe.enable_model_cpu_offload()
            except Exception:
                # Fall back to a direct device move when Accelerate offload is unavailable.
                self._pipe.to(self.device)
        return self._pipe

    def _apply_loras(self, loras: list[dict[str, float | str]] | None) -> None:
        if hasattr(self.pipe, "unload_lora_weights"):
            try:
                self.pipe.unload_lora_weights()
            except Exception:
                # Some diffusers builds require optional PEFT support for LoRA management.
                pass

        if not loras:
            return
        if not hasattr(self.pipe, "load_lora_weights"):
            raise RuntimeError("This FLUX pipeline does not support LoRA loading.")

        adapter_names = []
        adapter_weights = []
        for index, lora_spec in enumerate(loras):
            adapter_name = f"adapter_{index}"
            self.pipe.load_lora_weights(
                str(lora_spec["path"]), adapter_name=adapter_name
            )
            adapter_names.append(adapter_name)
            adapter_weights.append(float(lora_spec["strength"]))

        if hasattr(self.pipe, "set_adapters"):
            self.pipe.set_adapters(adapter_names, adapter_weights=adapter_weights)

    def _run_pipe(
        self,
        *,
        prompt: str,
        height: int,
        width: int,
        steps: int,
        image: Any = None,
        progress_callback=None,
        **extra_kwargs,
    ):
        call_kwargs: dict[str, Any] = {
            "prompt": prompt,
            "num_inference_steps": steps,
            "height": height,
            "width": width,
        }
        if image is not None:
            call_kwargs["image"] = image
        call_kwargs.update(extra_kwargs)

        def _invoke(pipe_obj):
            if progress_callback is None:
                return pipe_obj(**call_kwargs)

            def callback_on_step_end(_pipe, step_index, timestep, callback_kwargs):
                progress_callback(step_index + 1, steps)
                return callback_kwargs

            try:
                return pipe_obj(**call_kwargs, callback_on_step_end=callback_on_step_end)
            except TypeError:
                return pipe_obj(**call_kwargs)

        try:
            return _invoke(self.pipe)
        except Exception as exc:
            torch = self._torch()
            if not isinstance(exc, torch.cuda.OutOfMemoryError):
                raise
            # VRAM exhausted — clear cache and retry with sequential CPU offload.
            torch.cuda.empty_cache()
            if hasattr(self.pipe, "enable_sequential_cpu_offload"):
                try:
                    self.pipe.enable_sequential_cpu_offload()
                except Exception:
                    self.pipe.to("cpu")
            else:
                self.pipe.to("cpu")
            return _invoke(self.pipe)

    def image_edit(
        self,
        prompt: str,
        input_files: list[str],
        width: int,
        height: int,
        steps: int = 4,
        limit: int | None = None,
        loras: list[dict[str, float | str]] | None = None,
        progress_callback=None,
        stage_callback=None,
    ):
        if not input_files:
            raise ValueError("input_files must contain at least one image path.")

        selected_files = input_files[:limit] if limit is not None else input_files
        if len(selected_files) > 2:
            raise ValueError("image_edit supports at most 2 input images.")

        image_module = import_module("PIL.Image")
        prepared_images = []
        target_size = (width, height)

        if stage_callback is not None:
            stage_callback("preparing_images")
        for path in selected_files:
            with image_module.open(path) as img:
                prepared_images.append(pad_to_size(img.convert("RGB"), target_size))

        if stage_callback is not None:
            stage_callback("applying_loras")
        self._apply_loras(loras)
        if stage_callback is not None:
            stage_callback("running_inference")
        result = self._run_pipe(
            prompt=prompt,
            image=prepared_images,
            height=height,
            width=width,
            steps=steps,
            progress_callback=progress_callback,
        ).images[0]
        if stage_callback is not None:
            stage_callback("inference_complete")
        return result

    def text_2_image(
        self,
        prompt: str,
        output_path: str,
        steps: int = 4,
        loras: list[dict[str, float | str]] | None = None,
        progress_callback=None,
    ):
        self._apply_loras(loras)

        image = self._run_pipe(
            prompt=prompt,
            guidance_scale=0.0,
            height=1024,
            width=1024,
            steps=steps,
            progress_callback=progress_callback,
        ).images[0]
        image.save(output_path)
