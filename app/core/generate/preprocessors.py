from __future__ import annotations

import numpy as np
from PIL import Image as PILImage


def apply_canny(image: PILImage.Image, low_threshold: int = 100, high_threshold: int = 200) -> PILImage.Image:
    import cv2  # noqa: PLC0415

    img_np = np.array(image.convert("RGB"))
    gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, low_threshold, high_threshold)
    edges_rgb = cv2.cvtColor(edges, cv2.COLOR_GRAY2RGB)
    return PILImage.fromarray(edges_rgb)


def preprocess(image: PILImage.Image, mode: str) -> PILImage.Image:
    if mode == "canny":
        return apply_canny(image)
    return image
