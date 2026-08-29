"""
YOLO model loading and detection extraction.

PROVENANCE
==========
Vendored 2026-08-14 from `src/demo_video.py` of the parent project:
`extract_yolo_detections`, `load_yolo_model`. See `adas_render.py`'s header for
why the parent module is copied rather than imported.

DEVIATIONS FROM UPSTREAM
------------------------
1. RF-DETR loader / extractor dropped (YOLO-only platform).
2. `predict_frame()` is new, and it passes `imgsz=` explicitly. Upstream never
   does -- neither `demo_video.process_video` nor `inference.run_inference`
   forwards it (the latter accepts the argument and then ignores it on the YOLO
   path). The result is that 960-trained checkpoints have been running inference
   at Ultralytics' 640 default everywhere in the parent project. Passing the
   registry's per-model resolution is a real accuracy fix, not cosmetics.
"""

import os
from pathlib import Path
from typing import Any

import numpy as np
import streamlit as st

# Disable Ultralytics network checks, telemetry, and auto-downloads
os.environ["YOLO_VERBOSE"] = "False"
os.environ["ULTRALYTICS_AUTOINSTALL"] = "0"

from .adas_render import CLASSES


def _configure_ultralytics():
    """Ensure Ultralytics runs completely offline without network timeouts."""
    try:
        from ultralytics.utils import SETTINGS
        SETTINGS.update({
            "sync": False,
            "check": False,
            "hub": False,
            "clearml": False,
            "comet": False,
            "dvc": False,
            "mlflow": False,
            "neptune": False,
            "raytune": False,
            "vscode_msg": False,
        })
    except Exception:
        pass


_configure_ultralytics()


def warmup_model(model, imgsz: int = 640) -> None:
    """Warm up PyTorch CUDA kernels to avoid frame-0 pipeline stutter."""
    try:
        dummy = np.zeros((imgsz, imgsz, 3), dtype=np.uint8)
        model.predict(source=dummy, imgsz=imgsz, verbose=False)
    except Exception:
        pass


@st.cache_resource(show_spinner=False)
def load_yolo_model(checkpoint_path: str | Path):
    """Load an Ultralytics YOLO checkpoint and perform a fast warmup pass."""
    from ultralytics import YOLO
    model = YOLO(str(checkpoint_path))
    warmup_model(model, imgsz=640)
    return model


# Alias for backward/forward compatibility
get_cached_yolo_model = load_yolo_model


def extract_yolo_detections(result) -> list[dict[str, Any]]:
    """Ultralytics Results -> flat detection dicts.

    Shape (matches the parent project's `demo_video` convention exactly, which
    is what `adas_render.draw_detection_boxes` expects):
        {"id", "class_id", "class_name", "confidence", "x1", "y1", "x2", "y2"}
    Coordinates are ints in original-frame pixel space.
    """
    detections: list[dict[str, Any]] = []
    if result.boxes is None:
        return detections
    boxes = result.boxes
    for i in range(len(boxes)):
        cls_id = int(boxes.cls[i].item())
        confidence = float(boxes.conf[i].item())
        x1, y1, x2, y2 = map(int, boxes.xyxy[i].cpu().tolist())
        class_name = CLASSES[cls_id] if cls_id < len(CLASSES) else f"class_{cls_id}"
        detections.append({
            "id": i + 1, "class_id": cls_id, "class_name": class_name,
            "confidence": confidence, "x1": x1, "y1": y1, "x2": x2, "y2": y2,
        })
    return detections


def predict_frame(model, frame, conf: float, imgsz: int) -> list[dict[str, Any]]:
    """One BGR frame -> detection dicts, at the model's own training resolution."""
    result = model.predict(source=frame, conf=conf, imgsz=imgsz, verbose=False)[0]
    return extract_yolo_detections(result)


@st.cache_data(show_spinner=False)
def describe_device() -> dict[str, Any]:
    """Device report for the sidebar badge and `verify_env.py`."""
    info = {"device": "cpu", "name": "CPU", "cuda": False, "torch": None}
    try:
        import torch
        info["torch"] = torch.__version__
        if torch.cuda.is_available():
            info["cuda"] = True
            info["device"] = "cuda:0"
            info["name"] = torch.cuda.get_device_name(0)
    except Exception:
        pass
    return info

