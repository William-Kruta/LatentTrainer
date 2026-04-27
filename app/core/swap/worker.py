from __future__ import annotations

import argparse
import json
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class SwapJob:
    job_id: str
    status: str = "queued"
    current_frame: int = 0
    total_frames: int = 0
    output_path: str | None = None
    error: str | None = None
    cancel_requested: bool = False
    cancel_path: Path | None = field(default=None, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def update(self, **kwargs: object) -> None:
        with self._lock:
            for key, value in kwargs.items():
                setattr(self, key, value)

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "job_id": self.job_id,
                "status": self.status,
                "current_frame": self.current_frame,
                "total_frames": self.total_frames,
                "output_path": self.output_path,
                "error": self.error,
            }

    def request_cancel(self) -> None:
        with self._lock:
            self.cancel_requested = True
            if self.status in {"queued", "running"}:
                self.status = "cancelling"
            cancel_path = self.cancel_path
        if cancel_path is not None:
            cancel_path.write_text("cancel\n")


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _swap_python() -> Path:
    configured = os.environ.get("LATENTTRAINER_SWAP_PYTHON")
    if configured:
        return Path(configured)
    return _project_root() / ".venv-swap" / "bin" / "python"


def _ensure_swap_python() -> Path:
    python_path = _swap_python()
    if not python_path.exists():
        raise RuntimeError(
            f"Swap Python not found at {python_path}. Create it with "
            "`uv venv .venv-swap` and install `swap_requirements.txt`."
        )
    return python_path


def _swap_venv_site_packages(python_path: Path) -> Path:
    return python_path.parents[1] / "lib" / "python3.12" / "site-packages"


def _nvidia_library_dirs(python_path: Path) -> list[Path]:
    site_packages = _swap_venv_site_packages(python_path)
    nvidia_root = site_packages / "nvidia"
    if not nvidia_root.exists():
        return []
    return sorted(path for path in nvidia_root.glob("*/lib") if path.exists())


def _prepend_ld_library_path(env: dict[str, str], python_path: Path) -> None:
    lib_dirs = [str(path) for path in _nvidia_library_dirs(python_path)]
    if not lib_dirs:
        return
    existing = env.get("LD_LIBRARY_PATH")
    env["LD_LIBRARY_PATH"] = ":".join([*lib_dirs, existing] if existing else lib_dirs)


def _read_status(status_path: Path) -> dict[str, object] | None:
    try:
        return json.loads(status_path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _write_status(status_path: Path, **values: object) -> None:
    status_path.write_text(json.dumps(values))


def _run_swap_subprocess(
    args: list[str],
    *,
    status_path: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    python_path = _ensure_swap_python()
    env = os.environ.copy()
    env["PYTHONPATH"] = str(_project_root())
    env.setdefault("MPLCONFIGDIR", "/tmp/latenttrainer-matplotlib")
    _prepend_ld_library_path(env, python_path)
    cmd = [str(python_path), "-m", "app.core.swap.worker", *args]
    return subprocess.run(cmd, check=False, capture_output=True, text=True, env=env)


def preview_single_frame_subprocess(
    video_path: Path,
    face_image_path: Path,
    output_path: Path,
    metadata_path: Path,
    timestamp_seconds: float,
    mask_strength: float,
    mask_feather: float,
    mask_vertical_ratio: float,
    mask_anchor: str,
) -> None:
    result = _run_swap_subprocess(
        [
            "preview",
            "--video-path",
            str(video_path),
            "--face-image-path",
            str(face_image_path),
            "--output-path",
            str(output_path),
            "--metadata-path",
            str(metadata_path),
            "--timestamp-seconds",
            str(timestamp_seconds),
            "--mask-strength",
            str(mask_strength),
            "--mask-feather",
            str(mask_feather),
            "--mask-vertical-ratio",
            str(mask_vertical_ratio),
            "--mask-anchor",
            mask_anchor,
        ]
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "Swap preview subprocess failed."
        raise RuntimeError(detail)


def _load_models() -> tuple[object, object]:
    """Load InsightFace models lazily. The first call can be slow."""
    from insightface.app import FaceAnalysis  # noqa: PLC0415
    import insightface  # noqa: PLC0415

    providers, provider_options, ctx_id = _resolve_execution_providers()
    face_app = FaceAnalysis(
        name="buffalo_l",
        providers=providers,
        provider_options=provider_options,
    )
    face_app.prepare(ctx_id=ctx_id, det_size=(640, 640))

    configured_model = os.environ.get("LATENTTRAINER_INSWAPPER_PATH")
    local_model = Path(configured_model) if configured_model else _project_root() / "models" / "insightface" / "inswapper_128.onnx"
    if local_model.exists():
        swapper = insightface.model_zoo.get_model(str(local_model), providers=providers, provider_options=provider_options)
    else:
        try:
            swapper = insightface.model_zoo.get_model(
                "inswapper_128.onnx",
                download=True,
                download_zip=True,
                providers=providers,
                provider_options=provider_options,
            )
        except Exception as exc:
            raise RuntimeError(
                "Failed to load inswapper_128.onnx. InsightFace could not download it, "
                f"and no local model was found at {local_model}. Put the ONNX file there "
                "or set LATENTTRAINER_INSWAPPER_PATH=/absolute/path/to/inswapper_128.onnx."
            ) from exc
    _assert_cuda_provider_if_requested(face_app, swapper, ctx_id)
    return face_app, swapper


def _assert_cuda_provider_if_requested(face_app: object, swapper: object, ctx_id: int) -> None:
    if ctx_id < 0 or os.environ.get("LATENTTRAINER_SWAP_ALLOW_CPU", "").lower() in {"1", "true", "yes"}:
        return

    cpu_models: list[str] = []
    for name, model in getattr(face_app, "models", {}).items():
        session = getattr(model, "session", None)
        providers = session.get_providers() if session is not None else []
        if "CUDAExecutionProvider" not in providers:
            cpu_models.append(str(name))

    swapper_session = getattr(swapper, "session", None)
    swapper_providers = swapper_session.get_providers() if swapper_session is not None else []
    if "CUDAExecutionProvider" not in swapper_providers:
        cpu_models.append("inswapper")

    if cpu_models:
        raise RuntimeError(
            "Swap models loaded without CUDAExecutionProvider "
            f"({', '.join(cpu_models)}). Install CUDA runtime wheels into .venv-swap "
            "with `uv pip install --python .venv-swap/bin/python -r swap_requirements.txt`. "
            "Set LATENTTRAINER_SWAP_ALLOW_CPU=1 only if you intentionally want slow CPU swapping."
        )


def _resolve_execution_providers() -> tuple[list[str], list[dict[str, int]], int]:
    import onnxruntime  # noqa: PLC0415

    ctx_id = int(os.environ.get("LATENTTRAINER_SWAP_CTX_ID", "0"))
    available = set(onnxruntime.get_available_providers())
    if ctx_id >= 0 and "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"], [{"device_id": ctx_id}, {}], ctx_id
    return ["CPUExecutionProvider"], [{}], -1


def _face_area(face: object) -> float:
    x1, y1, x2, y2 = face.bbox
    return max(float(x2 - x1), 0.0) * max(float(y2 - y1), 0.0)


def _select_target_face(target_faces: list[object], previous_face: object | None = None) -> object:
    if previous_face is None:
        return max(target_faces, key=_face_area)

    import numpy as np  # noqa: PLC0415

    previous_center = _face_center(previous_face)
    previous_area = _face_area(previous_face)

    def score(face: object) -> float:
        center = _face_center(face)
        distance = float(np.linalg.norm(center - previous_center))
        area_delta = abs(_face_area(face) - previous_area) / max(previous_area, 1.0)
        return distance + area_delta * 80.0

    return min(target_faces, key=score)


def _face_center(face: object) -> object:
    import numpy as np  # noqa: PLC0415

    bbox = np.asarray(face.bbox, dtype=np.float32)
    return (bbox[:2] + bbox[2:]) * 0.5


def _smooth_face(current_face: object, previous_face: object | None, tracking_strength: float = 0.65) -> object:
    if previous_face is None or tracking_strength <= 0:
        return current_face

    import numpy as np  # noqa: PLC0415

    alpha = float(np.clip(tracking_strength, 0.0, 0.95))
    smoothed_bbox = (
        alpha * np.asarray(previous_face.bbox, dtype=np.float32)
        + (1.0 - alpha) * np.asarray(current_face.bbox, dtype=np.float32)
    )
    smoothed_kps = None
    if getattr(previous_face, "kps", None) is not None and getattr(current_face, "kps", None) is not None:
        smoothed_kps = (
            alpha * np.asarray(previous_face.kps, dtype=np.float32)
            + (1.0 - alpha) * np.asarray(current_face.kps, dtype=np.float32)
        )
    return _face_with_geometry(current_face, smoothed_bbox, smoothed_kps)


def _face_with_geometry(face: object, bbox: object, kps: object | None = None) -> object:
    from insightface.app.common import Face  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415

    updated = Face(dict(face))
    updated.bbox = np.asarray(bbox, dtype=np.float32)
    if kps is not None:
        updated.kps = np.asarray(kps, dtype=np.float32)
    return updated


def _swap_detection_interval() -> int:
    raw = os.environ.get("LATENTTRAINER_SWAP_FACE_DETECT_INTERVAL", "3")
    try:
        return max(1, int(raw))
    except ValueError:
        return 3


def _build_face_mask(
    shape: tuple[int, int],
    face: object,
    mask_strength: float,
    mask_feather: float,
    mask_vertical_ratio: float,
    mask_anchor: str,
) -> object:
    import cv2  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415

    h, w = shape
    mask = np.zeros((h, w), dtype=np.float32)

    bbox = face.bbox.astype(int)
    x1, y1, x2, y2 = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
    rw, rh = max(1, (x2 - x1) // 2), max(1, (y2 - y1) // 2)

    cv2.ellipse(mask, (cx, cy), (rw, rh), 0, 0, 360, 1.0, -1)

    ratio = float(np.clip(mask_vertical_ratio, 0.05, 1.0))
    if ratio < 1.0:
        face_height = max(1, y2 - y1)
        slice_height = max(1, int(face_height * ratio))
        anchor = mask_anchor if mask_anchor in {"top", "center", "bottom"} else "center"
        if anchor == "top":
            slice_y1 = y1
        elif anchor == "bottom":
            slice_y1 = y2 - slice_height
        else:
            slice_y1 = cy - slice_height // 2
        slice_y2 = slice_y1 + slice_height
        slice_y1 = max(0, min(h, slice_y1))
        slice_y2 = max(0, min(h, slice_y2))

        vertical_mask = np.zeros((h, w), dtype=np.float32)
        vertical_mask[slice_y1:slice_y2, :] = 1.0
        mask *= vertical_mask

    if mask_feather > 0:
        ksize = max(3, int(min(rw, rh) * mask_feather * 2) | 1)
        mask = cv2.GaussianBlur(mask, (ksize, ksize), 0)

    return np.clip(mask * mask_strength, 0.0, 1.0)


def _swap_with_source_face(
    frame_bgr: object,
    source_face: object | None,
    mask_strength: float,
    mask_feather: float,
    mask_vertical_ratio: float,
    mask_anchor: str,
    face_app: object,
    swapper: object,
    show_mask_overlay: bool = False,
    target_face: object | None = None,
    detect_target: bool = True,
) -> object:
    import cv2  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415

    if source_face is None:
        return frame_bgr

    if target_face is None and detect_target:
        target_faces = face_app.get(frame_bgr)
        if not target_faces:
            return frame_bgr
        target_face = _select_target_face(target_faces)
    if target_face is None:
        return frame_bgr

    swapped = swapper.get(frame_bgr, target_face, source_face, paste_back=True)
    mask = _build_face_mask(
        frame_bgr.shape[:2],
        target_face,
        mask_strength,
        mask_feather,
        mask_vertical_ratio,
        mask_anchor,
    )
    mask_3ch = mask[:, :, np.newaxis]
    result = (
        swapped.astype(np.float32) * mask_3ch
        + frame_bgr.astype(np.float32) * (1.0 - mask_3ch)
    ).astype(np.uint8)
    if not show_mask_overlay:
        return result

    orange = np.array([0, 152, 255], dtype=np.float32)
    overlay_strength = np.clip(mask[:, :, np.newaxis] * 0.42, 0.0, 0.42)
    result = (
        result.astype(np.float32) * (1.0 - overlay_strength)
        + orange * overlay_strength
    ).astype(np.uint8)

    mask_u8 = (mask > 0.04).astype(np.uint8) * 255
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(result, contours, -1, (0, 176, 255), 2, cv2.LINE_AA)
    return result


def swap_single_frame(
    frame_bgr: object,
    face_image_path: Path,
    mask_strength: float,
    mask_feather: float,
    mask_vertical_ratio: float,
    mask_anchor: str,
    face_app: object | None = None,
    swapper: object | None = None,
    show_mask_overlay: bool = False,
) -> object:
    import cv2  # noqa: PLC0415

    if face_app is None or swapper is None:
        face_app, swapper = _load_models()

    ref_img = cv2.imread(str(face_image_path))
    if ref_img is None:
        return frame_bgr

    source_faces = face_app.get(ref_img)
    source_face = max(source_faces, key=_face_area) if source_faces else None
    return _swap_with_source_face(
        frame_bgr,
        source_face,
        mask_strength,
        mask_feather,
        mask_vertical_ratio,
        mask_anchor,
        face_app,
        swapper,
        show_mask_overlay,
    )


def extract_frame_at(video_path: Path, timestamp_seconds: float) -> object | None:
    import cv2  # noqa: PLC0415

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    target_frame_idx = int(timestamp_seconds * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame_idx)
    ret, frame = cap.read()
    cap.release()
    return frame if ret else None


def _process_swap_video(
    video_path: Path,
    face_image_path: Path,
    output_path: Path,
    preview_path: Path,
    mask_strength: float,
    mask_feather: float,
    mask_vertical_ratio: float,
    mask_anchor: str,
    status_path: Path,
    cancel_path: Path,
) -> None:
    import cv2  # noqa: PLC0415

    temp_path = output_path.with_suffix(".tmp.mp4")
    cap: cv2.VideoCapture | None = None
    writer: cv2.VideoWriter | None = None
    try:
        _write_status(
            status_path,
            status="running",
            current_frame=0,
            total_frames=0,
            output_path=None,
            error=None,
        )
        face_app, swapper = _load_models()

        cap = cv2.VideoCapture(str(video_path))
        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        _write_status(
            status_path,
            status="running",
            current_frame=0,
            total_frames=total,
            output_path=None,
            error=None,
        )

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(temp_path), fourcc, fps, (width, height))

        ref_img = cv2.imread(str(face_image_path))
        source_faces = face_app.get(ref_img) if ref_img is not None else []
        source_face = max(source_faces, key=_face_area) if source_faces else None
        detect_interval = _swap_detection_interval()
        previous_face = None
        was_cancelled = False

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if source_face is not None and (previous_face is None or frame_idx % detect_interval == 0):
                target_faces = face_app.get(frame)
                if target_faces:
                    selected_face = _select_target_face(target_faces, previous_face)
                    previous_face = _smooth_face(selected_face, previous_face)

            frame = _swap_with_source_face(
                frame,
                source_face,
                mask_strength,
                mask_feather,
                mask_vertical_ratio,
                mask_anchor,
                face_app,
                swapper,
                target_face=previous_face,
                detect_target=False,
            )
            writer.write(frame)

            if frame_idx % 30 == 0:
                cv2.imwrite(str(preview_path), frame)
                _write_status(
                    status_path,
                    status="running",
                    current_frame=frame_idx,
                    total_frames=total,
                    output_path=None,
                    error=None,
                )

            frame_idx += 1
            if cancel_path.exists():
                was_cancelled = True
                break

        cap.release()
        cap = None
        writer.release()
        writer = None

        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(temp_path),
            "-i",
            str(video_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-shortest",
            str(output_path),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        temp_path.unlink(missing_ok=True)
        _write_status(
            status_path,
            status="cancelled" if was_cancelled else "done",
            current_frame=frame_idx,
            total_frames=total,
            output_path=str(output_path),
            error=None,
        )
    except Exception as exc:
        _write_status(
            status_path,
            status="error",
            current_frame=0,
            total_frames=0,
            output_path=None,
            error=str(exc),
        )
        raise
    finally:
        if cap is not None:
            cap.release()
        if writer is not None:
            writer.release()


def run_swap_job(
    job: SwapJob,
    video_path: Path,
    face_image_path: Path,
    output_path: Path,
    preview_path: Path,
    mask_strength: float,
    mask_feather: float,
    mask_vertical_ratio: float,
    mask_anchor: str,
) -> None:
    status_path = preview_path.with_suffix(".status.json")
    cancel_path = preview_path.with_suffix(".cancel")
    process: subprocess.Popen[str] | None = None
    try:
        job.cancel_path = cancel_path
        if job.cancel_requested:
            cancel_path.write_text("cancel\n")
            job.update(status="cancelling")
        else:
            job.update(status="running")
        _write_status(
            status_path,
            status="running",
            current_frame=0,
            total_frames=0,
            output_path=None,
            error=None,
        )
        python_path = _ensure_swap_python()
        env = os.environ.copy()
        env["PYTHONPATH"] = str(_project_root())
        env.setdefault("MPLCONFIGDIR", "/tmp/latenttrainer-matplotlib")
        _prepend_ld_library_path(env, python_path)
        process = subprocess.Popen(
            [
                str(python_path),
                "-m",
                "app.core.swap.worker",
                "run",
                "--video-path",
                str(video_path),
                "--face-image-path",
                str(face_image_path),
                "--output-path",
                str(output_path),
                "--preview-path",
                str(preview_path),
                "--status-path",
                str(status_path),
                "--cancel-path",
                str(cancel_path),
                "--mask-strength",
                str(mask_strength),
                "--mask-feather",
                str(mask_feather),
                "--mask-vertical-ratio",
                str(mask_vertical_ratio),
                "--mask-anchor",
                mask_anchor,
            ],
            cwd=str(_project_root()),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        while process.poll() is None:
            status = _read_status(status_path)
            if status:
                if job.cancel_requested and status.get("status") == "running":
                    status["status"] = "cancelling"
                job.update(**status)
            time.sleep(0.5)

        stdout, stderr = process.communicate()
        status = _read_status(status_path)
        if status:
            job.update(**status)
        if process.returncode != 0:
            detail = stderr.strip() or stdout.strip() or "Swap subprocess failed."
            job.update(status="error", error=detail)
    except Exception as exc:
        job.update(status="error", error=str(exc))
    finally:
        preview_path.unlink(missing_ok=True)
        face_image_path.unlink(missing_ok=True)
        status_path.unlink(missing_ok=True)
        cancel_path.unlink(missing_ok=True)
        job.cancel_path = None


def _preview_command(args: argparse.Namespace) -> None:
    import cv2  # noqa: PLC0415

    frame = extract_frame_at(Path(args.video_path), args.timestamp_seconds)
    if frame is None:
        raise RuntimeError("Could not extract frame from video.")

    face_app, swapper = _load_models()
    ref_img = cv2.imread(str(args.face_image_path))
    if ref_img is None:
        raise RuntimeError("Could not read source face image.")
    source_faces = face_app.get(ref_img)
    source_face = max(source_faces, key=_face_area) if source_faces else None
    target_faces = face_app.get(frame)
    target_face = _select_target_face(target_faces) if target_faces else None

    result = _swap_with_source_face(
        frame,
        source_face,
        args.mask_strength,
        args.mask_feather,
        args.mask_vertical_ratio,
        args.mask_anchor,
        face_app,
        swapper,
        target_face=target_face,
        detect_target=False,
    )
    ok = cv2.imwrite(str(args.output_path), result, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise RuntimeError("Could not write preview image.")
    metadata = {
        "image_width": int(frame.shape[1]),
        "image_height": int(frame.shape[0]),
        "bbox": [float(v) for v in target_face.bbox] if target_face is not None else None,
    }
    Path(args.metadata_path).write_text(json.dumps(metadata))


def _run_command(args: argparse.Namespace) -> None:
    _process_swap_video(
        video_path=Path(args.video_path),
        face_image_path=Path(args.face_image_path),
        output_path=Path(args.output_path),
        preview_path=Path(args.preview_path),
        status_path=Path(args.status_path),
        cancel_path=Path(args.cancel_path),
        mask_strength=args.mask_strength,
        mask_feather=args.mask_feather,
        mask_vertical_ratio=args.mask_vertical_ratio,
        mask_anchor=args.mask_anchor,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run LatentTrainer face swap tasks.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    preview = subparsers.add_parser("preview")
    preview.add_argument("--video-path", required=True)
    preview.add_argument("--face-image-path", required=True)
    preview.add_argument("--output-path", required=True)
    preview.add_argument("--metadata-path", required=True)
    preview.add_argument("--timestamp-seconds", type=float, required=True)
    preview.add_argument("--mask-strength", type=float, required=True)
    preview.add_argument("--mask-feather", type=float, required=True)
    preview.add_argument("--mask-vertical-ratio", type=float, required=True)
    preview.add_argument("--mask-anchor", choices=["top", "center", "bottom"], required=True)
    preview.set_defaults(func=_preview_command)

    run = subparsers.add_parser("run")
    run.add_argument("--video-path", required=True)
    run.add_argument("--face-image-path", required=True)
    run.add_argument("--output-path", required=True)
    run.add_argument("--preview-path", required=True)
    run.add_argument("--status-path", required=True)
    run.add_argument("--cancel-path", required=True)
    run.add_argument("--mask-strength", type=float, required=True)
    run.add_argument("--mask-feather", type=float, required=True)
    run.add_argument("--mask-vertical-ratio", type=float, required=True)
    run.add_argument("--mask-anchor", choices=["top", "center", "bottom"], required=True)
    run.set_defaults(func=_run_command)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
