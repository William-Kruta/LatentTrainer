from __future__ import annotations

import base64
import io
import json
import shutil
import zipfile
from datetime import timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlmodel import Session, select

from app.db import BASE_DIR, get_session
from app.models import (
    AutoCaptionRequest,
    Dataset,
    DatasetCreate,
    DatasetDetail,
    DatasetFile,
    DatasetRead,
    RenameFilesRequest,
)

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff"}
DATASETS_DIR = BASE_DIR / "datasets"


def _normalise_image(path: Path) -> tuple[bytes, str]:
    """Return (bytes, mime) for a llama.cpp-compatible image (JPEG or PNG)."""
    from PIL import Image  # local import — optional dependency
    buf = io.BytesIO()
    with Image.open(path) as img:
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            img.save(buf, format="PNG")
            return buf.getvalue(), "image/png"
        else:
            img = img.convert("RGB")
            img.save(buf, format="JPEG", quality=92)
            return buf.getvalue(), "image/jpeg"


def _refresh_counts(dataset: Dataset) -> None:
    p = Path(dataset.path)
    if not p.exists():
        return
    images = [f for f in p.iterdir() if f.suffix.lower() in IMAGE_EXTENSIONS]
    dataset.image_count = len(images)
    dataset.size_bytes = sum(f.stat().st_size for f in p.iterdir())
    dataset.caption_count = sum(
        1 for img in images
        if (img.with_suffix(".txt")).exists() and (img.with_suffix(".txt")).stat().st_size > 0
    )


def _read_files(dataset_path: Path) -> list[DatasetFile]:
    files = []
    if dataset_path.exists():
        for img_file in sorted(dataset_path.iterdir()):
            if img_file.suffix.lower() in IMAGE_EXTENSIONS:
                caption_file = img_file.with_suffix(".txt")
                has_caption = caption_file.exists() and caption_file.stat().st_size > 0
                caption = caption_file.read_text().strip() if has_caption else None
                files.append(DatasetFile(filename=img_file.name, has_caption=has_caption, caption=caption))
    return files


# ── List / create ────────────────────────────────────────────────────────────

@router.get("", response_model=list[DatasetRead])
def list_datasets(session: Session = Depends(get_session)) -> list[Dataset]:
    datasets = list(session.exec(select(Dataset).order_by(Dataset.name)).all())
    for dataset in datasets:
        _refresh_counts(dataset)
    session.commit()
    return datasets


@router.post("", response_model=DatasetRead, status_code=201)
def create_dataset(payload: DatasetCreate, session: Session = Depends(get_session)) -> Dataset:
    dataset = Dataset(**payload.model_dump())
    session.add(dataset)
    session.commit()
    session.refresh(dataset)
    return dataset


# ── Upload zip → new dataset ─────────────────────────────────────────────────

@router.post("/upload-zip", response_model=DatasetRead, status_code=201)
async def upload_zip(
    file: UploadFile = File(...),
    name: str = Form(default=""),
    session: Session = Depends(get_session),
) -> Dataset:
    dataset_name = name.strip() or Path(file.filename or "dataset").stem
    dataset_path = DATASETS_DIR / dataset_name
    dataset_path.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for member in zf.namelist():
                member_path = Path(member)
                suffix = member_path.suffix.lower()
                if suffix in IMAGE_EXTENSIONS or suffix == ".txt":
                    data = zf.read(member)
                    (dataset_path / member_path.name).write_bytes(data)
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid zip archive.")

    dataset = Dataset(name=dataset_name, path=str(dataset_path))
    _refresh_counts(dataset)
    session.add(dataset)
    session.commit()
    session.refresh(dataset)
    return dataset


# ── Upload raw files → new dataset ───────────────────────────────────────────

@router.post("/upload-files", response_model=DatasetRead, status_code=201)
async def upload_files(
    files: list[UploadFile] = File(...),
    name: str = Form(...),
    session: Session = Depends(get_session),
) -> Dataset:
    dataset_name = name.strip()
    if not dataset_name:
        raise HTTPException(status_code=400, detail="Dataset name is required.")
    dataset_path = DATASETS_DIR / dataset_name
    dataset_path.mkdir(parents=True, exist_ok=True)

    for upload in files:
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix in IMAGE_EXTENSIONS or suffix == ".txt":
            content = await upload.read()
            (dataset_path / Path(upload.filename or "file").name).write_bytes(content)

    dataset = Dataset(name=dataset_name, path=str(dataset_path))
    _refresh_counts(dataset)
    session.add(dataset)
    session.commit()
    session.refresh(dataset)
    return dataset


# ── Add files to existing dataset ────────────────────────────────────────────

@router.post("/{dataset_id}/upload-images", response_model=DatasetRead)
async def upload_images(
    dataset_id: int,
    files: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
) -> Dataset:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")

    dataset_path = Path(dataset.path)
    dataset_path.mkdir(parents=True, exist_ok=True)

    for upload in files:
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix in IMAGE_EXTENSIONS or suffix == ".txt":
            content = await upload.read()
            (dataset_path / Path(upload.filename or "file").name).write_bytes(content)

    _refresh_counts(dataset)
    session.add(dataset)
    session.commit()
    session.refresh(dataset)
    return dataset


# ── Dataset detail ────────────────────────────────────────────────────────────

@router.get("/{dataset_id}", response_model=DatasetDetail)
def get_dataset(dataset_id: int, session: Session = Depends(get_session)) -> DatasetDetail:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    files = _read_files(Path(dataset.path))
    return DatasetDetail(
        **dataset.model_dump(exclude={"created_at"}),
        created_at=dataset.created_at.astimezone(timezone.utc),
        files=files,
    )


# ── Save caption ──────────────────────────────────────────────────────────────

@router.put("/{dataset_id}/caption/{stem}", status_code=204)
async def save_caption(
    dataset_id: int,
    stem: str,
    request: Request,
    session: Session = Depends(get_session),
) -> None:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    body = await request.body()
    caption_file = Path(dataset.path) / f"{stem}.txt"
    caption_file.write_text(body.decode())


# ── Serve image ───────────────────────────────────────────────────────────────

@router.get("/{dataset_id}/image/{filename}")
def get_image(dataset_id: int, filename: str, session: Session = Depends(get_session)) -> FileResponse:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    image_path = (Path(dataset.path) / filename).resolve()
    if not image_path.is_relative_to(Path(dataset.path).resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    if not image_path.exists() or image_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=404, detail="Image not found.")
    return FileResponse(image_path)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: int, session: Session = Depends(get_session)) -> None:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    shutil.rmtree(dataset.path, ignore_errors=True)
    session.delete(dataset)
    session.commit()


# ── Rename files ─────────────────────────────────────────────────────────────

@router.post("/{dataset_id}/rename-files", response_model=DatasetDetail)
def rename_files(
    dataset_id: int,
    payload: RenameFilesRequest,
    session: Session = Depends(get_session),
) -> DatasetDetail:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")

    prefix = payload.prefix.strip()
    if not prefix:
        raise HTTPException(status_code=400, detail="Prefix cannot be empty.")

    dataset_path = Path(dataset.path)
    images = sorted(f for f in dataset_path.iterdir() if f.suffix.lower() in IMAGE_EXTENSIONS)

    if not images:
        raise HTTPException(status_code=400, detail="No images to rename.")

    # Phase 1 — rename all pairs to unique temp names so final targets never clash
    temp_pairs: list[tuple[Path, Path | None, str]] = []
    for i, img in enumerate(images):
        txt = img.with_suffix(".txt")
        temp_img = dataset_path / f"__rename_tmp_{i}{img.suffix}"
        img.rename(temp_img)
        temp_txt: Path | None = None
        if txt.exists():
            temp_txt = dataset_path / f"__rename_tmp_{i}.txt"
            txt.rename(temp_txt)
        temp_pairs.append((temp_img, temp_txt, img.suffix))

    # Phase 2 — rename temp files to final names
    for i, (temp_img, temp_txt, ext) in enumerate(temp_pairs, start=1):
        temp_img.rename(dataset_path / f"{prefix}{i}{ext}")
        if temp_txt is not None:
            temp_txt.rename(dataset_path / f"{prefix}{i}.txt")

    _refresh_counts(dataset)
    session.add(dataset)
    session.commit()
    session.refresh(dataset)

    files = _read_files(dataset_path)
    return DatasetDetail(
        **dataset.model_dump(exclude={"created_at"}),
        created_at=dataset.created_at.astimezone(timezone.utc),
        files=files,
    )


# ── Auto-caption ──────────────────────────────────────────────────────────────

@router.post("/{dataset_id}/autocaption")
async def autocaption(
    dataset_id: int,
    payload: AutoCaptionRequest,
    session: Session = Depends(get_session),
) -> StreamingResponse:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found.")

    dataset_path = Path(dataset.path)
    image_files = sorted(
        f for f in dataset_path.iterdir() if f.suffix.lower() in IMAGE_EXTENSIONS
    ) if dataset_path.exists() else []

    llama_url = payload.llama_url.rstrip("/")
    system_prompt = payload.system_prompt.strip()

    async def stream():
        async with httpx.AsyncClient(timeout=120.0) as client:
            for img_file in image_files:
                caption_file = img_file.with_suffix(".txt")

                if not payload.overwrite and caption_file.exists() and caption_file.stat().st_size > 0:
                    yield f"data: {json.dumps({'status': 'skipped', 'filename': img_file.name})}\n\n"
                    continue

                try:
                    img_bytes, mime = _normalise_image(img_file)
                    img_b64 = base64.b64encode(img_bytes).decode()

                    # Merge system prompt into user turn — many LLaVA templates
                    # don't support a separate "system" role with vision content.
                    user_text = (system_prompt + "\n\n") if system_prompt else ""
                    user_text += "Describe this image."

                    messages = [
                        {
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}},
                                {"type": "text", "text": user_text},
                            ],
                        },
                    ]

                    body: dict = {"messages": messages, "max_tokens": payload.max_tokens}
                    if payload.model:
                        body["model"] = payload.model

                    resp = await client.post(f"{llama_url}/v1/chat/completions", json=body)

                    if not resp.is_success:
                        detail = resp.text[:300]
                        yield f"data: {json.dumps({'status': 'error', 'filename': img_file.name, 'error': f'HTTP {resp.status_code}: {detail}'})}\n\n"
                        continue

                    caption = resp.json()["choices"][0]["message"]["content"].strip()
                    if payload.trigger_word:
                        caption = f"{payload.trigger_word}, {caption}"

                    caption_file.write_text(caption)
                    yield f"data: {json.dumps({'status': 'done', 'filename': img_file.name, 'caption': caption})}\n\n"

                except Exception as exc:
                    yield f"data: {json.dumps({'status': 'error', 'filename': img_file.name, 'error': str(exc)})}\n\n"

        yield f"data: {json.dumps({'status': 'complete'})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
