"""
YOLO model loading and detection extraction.

PROVENANCE
==========
Vendored 2026-08-14 from `src/demo_video.py` of the parent project:
`extract_yolo_detections`, `load_yolo_model`. See `adas_render.py`'s header for
why the parent module is copied rather than imported.

DEVIATIONS FROM UPSTREAM
------------------------
1. RF-DETR loader / extractor were dropped when this file was first vendored
   (YOLO-only platform at the time). Re-added 2026-08-18, ported from this
   same `demo_video.py` (`load_rfdetr_model`, `extract_rfdetr_detections`,
   `process_video`'s RF-DETR branch) so the platform can test all model
   families, not just YOLO. Detections are normalized to the exact same dict
   shape as `extract_yolo_detections`, so nothing downstream (`adas_render.py`,
   the analyzer) needed to change.
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


def cuda_available() -> bool:
    try:
        import torch
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def warmup_model(model, imgsz: int = 640, half: bool = False) -> None:
    """Warm up CUDA kernels to avoid frame-0 pipeline stutter.

    `imgsz` MUST be the resolution inference will actually run at. cuDNN
    selects and caches its convolution algorithms per input shape, so a
    warmup at a different size warms the wrong kernels and the first real
    frame pays the full selection cost anyway -- which is exactly what used
    to happen: this was hardcoded to 640 while the registry runs models at
    384, 480, 640 and 960.

    `half` matters for the same reason: the FP16 and FP32 kernel sets are
    distinct, so a FP32 warmup does not warm an FP16 inference path.
    """
    try:
        dummy = np.zeros((imgsz, imgsz, 3), dtype=np.uint8)
        model.predict(source=dummy, imgsz=imgsz, half=half, verbose=False)
    except Exception:
        pass


@st.cache_resource(show_spinner=False, max_entries=2)
def load_yolo_model(checkpoint_path: str | Path, imgsz: int = 640,
                    half: bool = False):
    """Load an Ultralytics YOLO checkpoint and warm it at its own resolution.

    `max_entries=2` bounds GPU memory: without it, every distinct checkpoint
    tested in one session stays resident forever, and repeated
    model-switching (this platform's whole point) eventually exhausts VRAM --
    observed as a silent, traceback-less process crash at video finalize
    (NVENC's flush is the first thing to need memory once it's tight).

    `imgsz` and `half` participate in the cache key deliberately: they change
    which kernels the warmup primes, so a cached model warmed for a different
    configuration would silently reintroduce the frame-0 stall.
    """
    from ultralytics import YOLO
    model = YOLO(str(checkpoint_path))
    warmup_model(model, imgsz=imgsz, half=half)
    return model


# Alias for backward/forward compatibility
get_cached_yolo_model = load_yolo_model


@st.cache_resource(show_spinner=False, max_entries=2)
def load_rfdetr_model(checkpoint_path: str | Path, resolution: int,
                      rfdetr_class: str = "nano", half: bool = False):
    """Load an RF-DETR checkpoint (Nano or Small). Ported from `src/demo_video.py`.

    `max_entries=2`, same reasoning as `load_yolo_model` -- RF-DETR checkpoints
    are heavier, so this matters more here.

    When `half` is set, RF-DETR's own `optimize_for_inference` is applied.
    That is the library's supported fast path (it fuses and casts internally);
    calling `.half()` on the module directly is not, and breaks its
    preprocessing, which still feeds float32. Failure is non-fatal -- the
    model stays usable at full precision rather than the load failing.
    """
    from rfdetr import RFDETRNano, RFDETRSmall
    cls = RFDETRSmall if rfdetr_class == "small" else RFDETRNano
    model = cls(resolution=resolution, num_classes=len(CLASSES), pretrain_weights=str(checkpoint_path))
    if half and cuda_available():
        try:
            import torch
            model.optimize_for_inference(dtype=torch.float16)
        except Exception:
            pass
    return model


# Alias, symmetric with get_cached_yolo_model
get_cached_rfdetr_model = load_rfdetr_model


def load_model(checkpoint_path: str | Path, family: str = "yolo", resolution: int = 640,
                rfdetr_class: str = "nano", half: bool = False):
    """Family-dispatching loader. Defaults to the existing YOLO path unchanged.

    `half` is silently ignored on CPU: FP16 has no hardware path there and
    would run slower than FP32 through emulation, so honouring the request
    would make the "faster" option the slower one.
    """
    half = bool(half) and cuda_available()
    if family == "rfdetr":
        return load_rfdetr_model(checkpoint_path, resolution=resolution,
                                 rfdetr_class=rfdetr_class, half=half)
    return load_yolo_model(checkpoint_path, imgsz=resolution, half=half)


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


def extract_rfdetr_detections(det) -> list[dict[str, Any]]:
    """supervision-style `Detections` -> flat detection dicts, same shape as
    `extract_yolo_detections`. Ported from `src/demo_video.py`."""
    detections: list[dict[str, Any]] = []
    if det is None or det.xyxy is None or len(det.xyxy) == 0:
        return detections
    for i in range(len(det.xyxy)):
        cls_id = int(det.class_id[i])
        confidence = float(det.confidence[i])
        x1, y1, x2, y2 = map(int, det.xyxy[i])
        class_name = CLASSES[cls_id] if 0 <= cls_id < len(CLASSES) else f"class_{cls_id}"
        detections.append({
            "id": i + 1, "class_id": cls_id, "class_name": class_name,
            "confidence": confidence, "x1": x1, "y1": y1, "x2": x2, "y2": y2,
        })
    return detections


def predict_frame(model, frame, conf: float, imgsz: int, family: str = "yolo",
                  half: bool = False) -> list[dict[str, Any]]:
    """One BGR frame -> detection dicts, at the model's own training resolution.

    Defaults to `family="yolo"` and `half=False` so every existing call site
    that doesn't pass them keeps behaving exactly as before.

    RF-DETR takes no per-call precision argument: its precision is fixed at
    load time by `optimize_for_inference`, so `half` is a no-op on that path
    rather than being forwarded into a call that would reject it.
    """
    if family == "rfdetr":
        import cv2
        from PIL import Image
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb_frame)
        det = model.predict(pil_img, threshold=conf)
        return extract_rfdetr_detections(det)
    result = model.predict(source=frame, conf=conf, imgsz=imgsz,
                           half=bool(half), verbose=False)[0]
    return extract_yolo_detections(result)


def predict_batch(model, frames, conf: float, imgsz: int,
                  family: str = "yolo", half: bool = False) -> list[list[dict[str, Any]]]:
    """Several BGR frames -> one detection list per frame, order preserved.

    Order preservation is not incidental: the caller feeds these results to
    a sequential fatigue analyser and micro-event detector whose state
    depends on frame order, so a reordered batch would silently corrupt
    event timings rather than fail loudly.

    RF-DETR has no batched predict(), so it falls back to a per-frame loop.
    The result shape is identical either way, so callers need not branch.
    """
    if not frames:
        return []
    if family == "rfdetr":
        return [predict_frame(model, f, conf, imgsz, family, half) for f in frames]
    results = model.predict(source=list(frames), conf=conf, imgsz=imgsz,
                            half=bool(half), verbose=False)
    return [extract_yolo_detections(r) for r in results]


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

