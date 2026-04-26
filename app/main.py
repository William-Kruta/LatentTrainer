from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session

from app.api.configs import router as configs_router
from app.api.datasets import router as datasets_router
from app.api.generate import router as generate_router
from app.api.gallery import router as gallery_router
from app.api.image_edit import router as image_edit_router
from app.api.ltx import router as ltx_router
from app.api.jobs import router as jobs_router
from app.api.media import router as media_router
from app.api.settings import router as settings_router
from app.api.system import router as system_router
from app.core.seed import seed_data
from app.db import BASE_DIR, create_db_and_tables, engine

app = FastAPI(title="LatentTrainer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(configs_router)
app.include_router(datasets_router)
app.include_router(generate_router)
app.include_router(gallery_router)
app.include_router(image_edit_router)
app.include_router(ltx_router)
app.include_router(jobs_router)
app.include_router(media_router)
app.include_router(settings_router)
app.include_router(system_router)

STATIC_DIR = BASE_DIR / "app" / "static"


@app.on_event("startup")
def on_startup() -> None:
    create_db_and_tables()
    with Session(engine) as session:
        seed_data(session)


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


if STATIC_DIR.exists() and (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str) -> FileResponse:
        index_path = STATIC_DIR / "index.html"
        return FileResponse(index_path)


def create_app() -> FastAPI:
    return app
