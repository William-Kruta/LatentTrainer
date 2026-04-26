from __future__ import annotations

from app.models import GPUStat

try:
    import pynvml
except ImportError:  # pragma: no cover - depends on local GPU/NVML availability
    pynvml = None


def _bytes_to_gb(value: int) -> float:
    return round(value / (1024**3), 1)


def get_gpu_stats() -> list[GPUStat]:
    if pynvml is None:
        return []

    try:
        pynvml.nvmlInit()
        device_count = pynvml.nvmlDeviceGetCount()
        stats: list[GPUStat] = []

        for index in range(device_count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(index)
            memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
            utilization = pynvml.nvmlDeviceGetUtilizationRates(handle)
            try:
                temperature = pynvml.nvmlDeviceGetTemperature(
                    handle,
                    pynvml.NVML_TEMPERATURE_GPU,
                )
            except pynvml.NVMLError:
                temperature = 0

            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8", errors="replace")

            stats.append(
                GPUStat(
                    id=index,
                    name=name,
                    vram_used_gb=_bytes_to_gb(memory.used),
                    vram_total_gb=_bytes_to_gb(memory.total),
                    utilization_pct=int(utilization.gpu),
                    temperature_c=int(temperature),
                )
            )

        return stats
    except pynvml.NVMLError:
        return []
    finally:
        try:
            pynvml.nvmlShutdown()
        except Exception:
            pass
