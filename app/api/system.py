from __future__ import annotations

from fastapi import APIRouter

from app.core.gpu import get_gpu_stats
from app.models import GPUStat

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/gpus", response_model=list[GPUStat])
def list_gpus() -> list[GPUStat]:
    return get_gpu_stats()
