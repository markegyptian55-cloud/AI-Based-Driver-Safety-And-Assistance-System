"""
SentryEye remote inference service.

Purpose: give phones that cannot sustain real-time on-device inference a fast,
GPU-backed path with the exact same detection contract as the browser engine.

Contract notes that matter to the client:
  * Detections are returned as class ids plus **normalized** xywh in original
    frame space. The service never sends labels — the client owns the label and
    semantic mapping so the checkpoint can change without a client release.
  * The service is model-agnostic: point MODEL_PATH at any Ultralytics-exported
    .pt/.onnx and the class ids follow that checkpoint.

Run:
    pip install -r requirements.txt
    MODEL_PATH=./best.pt uvicorn app.main:app --host 0.0.0.0 --port 8000

Docs: http://localhost:8000/docs (Swagger) and /redoc.
"""

from __future__ import annotations

import io
import os
import time
from typing import Annotated

import numpy as np
from fastapi import FastAPI, Header, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

MODEL_PATH = os.environ.get("MODEL_PATH", "./best.pt")
DEFAULT_IMGSZ = int(os.environ.get("IMGSZ", "640"))
MODEL_NAME = os.environ.get("MODEL_NAME", "yolov11n-drowsiness")
MODEL_VERSION = os.environ.get("MODEL_VERSION", "1.0.0")
ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*").split(",")
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(4 * 1024 * 1024)))

app = FastAPI(
    title="SentryEye Inference Service",
    version=MODEL_VERSION,
    description=(
        "Remote YOLO inference for the SentryEye driver drowsiness system. "
        "Used as an automatic fallback when a device cannot sustain real-time "
        "on-device inference."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    max_age=86400,
)


class DetectionOut(BaseModel):
    class_id: int = Field(..., description="Class index as defined by the checkpoint.")
    confidence: float = Field(..., ge=0, le=1)
    bbox: list[float] = Field(
        ...,
        min_length=4,
        max_length=4,
        description="Normalized [x, y, w, h], top-left origin, original frame space.",
    )


class DetectResponse(BaseModel):
    detections: list[DetectionOut]
    inference_ms: float
    model_name: str
    model_version: str
    engine: str
    imgsz: int


class HealthResponse(BaseModel):
    status: str
    engine: str
    modelName: str
    modelVersion: str
    imgsz: int
    labels: dict[str, str]
    warm: bool


class _Engine:
    """Lazy singleton around the Ultralytics model.

    Loading at import time makes the container fail its own health check while
    weights download, so the first request pays for the load instead.
    """

    def __init__(self) -> None:
        self._model = None
        self._device = "cpu"
        self._labels: dict[str, str] = {}

    def load(self):
        if self._model is not None:
            return self._model
        from ultralytics import YOLO  # imported lazily: heavy dependency

        try:
            import torch

            self._device = "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:  # torch is optional for onnxruntime-only deployments
            self._device = "cpu"

        model = YOLO(MODEL_PATH)
        names = getattr(model, "names", {}) or {}
        self._labels = {str(k): str(v) for k, v in names.items()}
        self._model = model
        return model

    @property
    def device(self) -> str:
        return self._device

    @property
    def labels(self) -> dict[str, str]:
        return self._labels

    @property
    def warm(self) -> bool:
        return self._model is not None


engine = _Engine()


@app.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    """Liveness plus model identity. The client probes this before routing."""
    return HealthResponse(
        status="ok",
        engine=engine.device,
        modelName=MODEL_NAME,
        modelVersion=MODEL_VERSION,
        imgsz=DEFAULT_IMGSZ,
        labels=engine.labels,
        warm=engine.warm,
    )


@app.post("/v1/warmup", tags=["system"])
def warmup() -> dict[str, object]:
    """Loads weights and runs one dummy frame so the first real frame is fast."""
    model = engine.load()
    blank = np.zeros((DEFAULT_IMGSZ, DEFAULT_IMGSZ, 3), dtype=np.uint8)
    t0 = time.perf_counter()
    model.predict(blank, imgsz=DEFAULT_IMGSZ, verbose=False, device=engine.device)
    return {"ok": True, "engine": engine.device, "warmup_ms": (time.perf_counter() - t0) * 1000}


def _run(raw: bytes, conf: float, iou: float, max_det: int, imgsz: int) -> DetectResponse:
    if not raw:
        raise HTTPException(status_code=400, detail="Empty request body.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Frame too large.")
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # noqa: BLE001 - surface a clean 400 to the client
        raise HTTPException(status_code=400, detail=f"Unreadable image: {exc}") from exc

    width, height = image.size
    model = engine.load()

    t0 = time.perf_counter()
    results = model.predict(
        np.asarray(image),
        imgsz=imgsz,
        conf=conf,
        iou=iou,
        max_det=max_det,
        verbose=False,
        device=engine.device,
    )
    inference_ms = (time.perf_counter() - t0) * 1000

    detections: list[DetectionOut] = []
    for result in results:
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            continue
        for xyxy, cls, confidence in zip(
            boxes.xyxy.tolist(), boxes.cls.tolist(), boxes.conf.tolist()
        ):
            x1, y1, x2, y2 = xyxy
            detections.append(
                DetectionOut(
                    class_id=int(cls),
                    confidence=float(confidence),
                    # Normalized so the client can draw on any display size.
                    bbox=[
                        max(0.0, x1 / width),
                        max(0.0, y1 / height),
                        max(0.0, (x2 - x1) / width),
                        max(0.0, (y2 - y1) / height),
                    ],
                )
            )

    return DetectResponse(
        detections=detections,
        inference_ms=round(inference_ms, 2),
        model_name=MODEL_NAME,
        model_version=MODEL_VERSION,
        engine=engine.device,
        imgsz=imgsz,
    )


@app.post("/v1/detect", response_model=DetectResponse, tags=["inference"])
async def detect(
    request: Request,
    x_conf_threshold: Annotated[float, Header()] = 0.35,
    x_iou_threshold: Annotated[float, Header()] = 0.45,
    x_max_detections: Annotated[int, Header()] = 20,
    x_imgsz: Annotated[int, Header()] = DEFAULT_IMGSZ,
) -> DetectResponse:
    """Detect on a single raw JPEG/PNG body.

    Raw body (not multipart) is deliberate: it is the cheapest possible upload
    for a phone streaming ~10 frames per second over mobile data.
    """
    raw = await request.body()
    return _run(raw, x_conf_threshold, x_iou_threshold, x_max_detections, x_imgsz)


@app.post("/v1/detect/upload", response_model=DetectResponse, tags=["inference"])
async def detect_upload(
    file: Annotated[UploadFile, File(description="Single image frame.")],
    conf: float = 0.35,
    iou: float = 0.45,
    max_det: int = 20,
    imgsz: int = DEFAULT_IMGSZ,
) -> DetectResponse:
    """Multipart variant, for Swagger UI and manual testing."""
    return _run(await file.read(), conf, iou, max_det, imgsz)
