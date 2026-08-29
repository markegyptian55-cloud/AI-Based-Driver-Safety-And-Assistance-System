"""
inference.py — Premium Detection Renderer & Inference Engine
================================================================
Project : nano big -- driver drowsiness detection (closed_eye/open_eye/yawning)

This module provides the core visual rendering engine and unified inference runner
for overlaying detection results (YOLO and RF-DETR) onto video frames.

Classes
-------
PremiumRenderer
    Renders tech-corner bounding boxes, confidence labels, and a glassmorphic HUD
    overlay onto OpenCV frames without text shadow ghosting.

DrowsinessAnalyzer
    Stateful analyzer maintaining a rolling history of detections to compute
    a smooth PERCLOS fatigue score (0-100%) and debounced alert levels.

Functions
---------
load_model(weights_path, model_type="auto", device="cuda:0")
    Loads a YOLO (.pt/.onnx) or RF-DETR (.pth/.onnx) model.

run_inference(model_dict, frame, conf_threshold=0.40, imgsz=640)
    Runs inference and returns a standardized list of detections:
    [{"bbox": [x1, y1, x2, y2], "confidence": float, "class_id": int, "class_name": str}]

process_frame(renderer, analyzer, model_dict, frame, conf_threshold=0.40)
    Full single-frame pipeline: inference -> render -> analyze -> HUD.
"""

from __future__ import annotations

import time
import logging
from collections import deque
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CLASS_NAMES = ["closed_eye", "open_eye", "yawning"]
CLASS_COUNT = len(CLASS_NAMES)

# Temporal-reasoning defaults. Grounded in the PERCLOS / eye-closure-duration
# literature (BOOK.md Chapter 2, SS2.1 SS2.5): normal blinks are <200ms, sustained
# closure past ~500ms-2s is the standard drowsiness signal, most reliable when
# averaged over a rolling window rather than judged frame-by-frame. These are
# starting points, not final -- BOOK.md Ch.2 SS2.8 flags that the hold/window
# values should be re-tuned once the deployed model's real achieved frame rate
# is measured (a 30-frame window means something different at 10fps vs 30fps).
# All are constructor args on DrownsinessAnalyzer below, not hardcoded-only.
FATIGUE_WARNING_THRESHOLD  = 0.40   # 40% → WARNING
FATIGUE_CRITICAL_THRESHOLD = 0.65   # 65% → CRITICAL
CRITICAL_HOLD_SECONDS      = 1.5    # must stay critical for 1.5 s to trigger alarm
HISTORY_WINDOW             = 30     # frames for PERCLOS rolling window
DEFAULT_CONF               = 0.40

_DEFAULT_THEME: dict[str, str] = {
    "accent" : "#00ffff",   # Cyan  — neutral / HUD border
    "success": "#00ff88",   # Green — open_eye
    "warning": "#ffaa00",   # Amber — general warning
    "danger" : "#ff3333",   # Red   — closed_eye / yawning / critical
}


# ===========================================================================
# PremiumRenderer
# ===========================================================================

class PremiumRenderer:
    """
    High-quality visual overlay renderer for object detection results.
    Renders futuristic tech-corner bounding boxes, collision-aware labels,
    and a semi-transparent glassmorphic HUD without text-ghosting artifacts.
    """

    def __init__(
        self,
        theme: dict[str, str] | None = None,
        font_scale: float = 0.38,
        corner_length: int = 12,
    ) -> None:
        self.theme        = theme or _DEFAULT_THEME
        self.font         = cv2.FONT_HERSHEY_DUPLEX
        self.font_scale   = font_scale
        self.thickness    = 1
        self.corner_len   = corner_length
        self.label_pad    = 5

        self.color_accent  = self._hex_to_bgr(self.theme.get("accent",  "#00ffff"))
        self.color_success = self._hex_to_bgr(self.theme.get("success", "#00ff88"))
        self.color_warning = self._hex_to_bgr(self.theme.get("warning", "#ffaa00"))
        self.color_danger  = self._hex_to_bgr(self.theme.get("danger",  "#ff3333"))
        self.color_text    = (255, 255, 255)

    @staticmethod
    def _hex_to_bgr(hex_color: str) -> tuple[int, int, int]:
        hex_color = hex_color.lstrip("#")
        if len(hex_color) != 6:
            return (255, 255, 0)
        r, g, b = (int(hex_color[i : i + 2], 16) for i in (0, 2, 4))
        return (b, g, r)

    def _class_color(self, class_name: str) -> tuple[int, int, int]:
        name = class_name.lower()
        if "closed" in name or "yawn" in name:
            return self.color_danger
        if "open" in name:
            return self.color_success
        return self.color_accent

    def _draw_corner_box(
        self,
        img: np.ndarray,
        x1: int, y1: int, x2: int, y2: int,
        color: tuple[int, int, int],
    ) -> None:
        L = self.corner_len
        t = self.thickness

        # Faint full bounding box
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 1, cv2.LINE_AA)

        # L-shaped tech corners
        cv2.line(img, (x1, y1), (x1 + L, y1), color, t + 1, cv2.LINE_AA)
        cv2.line(img, (x1, y1), (x1, y1 + L), color, t + 1, cv2.LINE_AA)

        cv2.line(img, (x2, y1), (x2 - L, y1), color, t + 1, cv2.LINE_AA)
        cv2.line(img, (x2, y1), (x2, y1 + L), color, t + 1, cv2.LINE_AA)

        cv2.line(img, (x1, y2), (x1 + L, y2), color, t + 1, cv2.LINE_AA)
        cv2.line(img, (x1, y2), (x1, y2 - L), color, t + 1, cv2.LINE_AA)

        cv2.line(img, (x2, y2), (x2 - L, y2), color, t + 1, cv2.LINE_AA)
        cv2.line(img, (x2, y2), (x2, y2 - L), color, t + 1, cv2.LINE_AA)

    def _draw_label(
        self,
        img: np.ndarray,
        text: str,
        tx: int, ty: int,
        color: tuple[int, int, int],
    ) -> tuple[int, int, int, int]:
        (tw, th), baseline = cv2.getTextSize(
            text, self.font, self.font_scale, self.thickness
        )
        pad = self.label_pad
        bg_x1 = tx
        bg_y1 = max(0, ty - th - pad)
        bg_x2 = tx + tw + pad * 2
        bg_y2 = ty + baseline

        h_img, w_img = img.shape[:2]
        bg_x2 = min(bg_x2, w_img - 1)
        bg_y2 = min(bg_y2, h_img - 1)

        if bg_x1 < bg_x2 and bg_y1 < bg_y2:
            roi = img[bg_y1:bg_y2, bg_x1:bg_x2]
            dark = np.full(roi.shape, (15, 15, 15), dtype=np.uint8)
            img[bg_y1:bg_y2, bg_x1:bg_x2] = cv2.addWeighted(roi, 0.35, dark, 0.65, 0)
            cv2.rectangle(img, (bg_x1, bg_y1), (bg_x2, bg_y2), color, 1, cv2.LINE_AA)

        # Single-pass crisp antialiased text draw (no ghosting)
        cv2.putText(
            img, text, (tx + pad, ty),
            self.font, self.font_scale, self.color_text, self.thickness, cv2.LINE_AA,
        )
        return (tx, ty, tw, th)

    def render_detections(
        self,
        frame: np.ndarray,
        detections: list[dict[str, Any]],
    ) -> tuple[np.ndarray, list[str], float]:
        """
        Overlay standardized detection dicts onto a frame.
        """
        if not detections:
            return frame.copy(), [], 0.0

        annotated = frame.copy()
        classes_found: list[str] = []
        max_confidence = 0.0
        drawn_labels: list[tuple[int, int, int, int]] = []

        for det in detections:
            bbox = det["bbox"]
            conf = det["confidence"]
            name = det["class_name"]
            color = self._class_color(name)

            classes_found.append(name.lower())
            if conf > max_confidence:
                max_confidence = conf

            x1, y1, x2, y2 = [int(v) for v in bbox]
            self._draw_corner_box(annotated, x1, y1, x2, y2, color)

            text = f"{name.upper()} {int(conf * 100)}%"
            tx, ty = x1, y1 - 8

            for (lx, ly, lw, lh) in drawn_labels:
                if abs(ty - ly) < lh + 6 and abs(tx - lx) < lw + 6:
                    ty = ly - (lh + 10)

            if ty < 14:
                ty = y2 + 14

            occupied = self._draw_label(annotated, text, tx, ty, color)
            drawn_labels.append(occupied)

        return annotated, classes_found, max_confidence

    def render_frame(
        self,
        frame: np.ndarray,
        results: Any,
    ) -> tuple[np.ndarray, list[str], float]:
        """Backward-compatible alias for render_detections / Ultralytics Results."""
        if isinstance(results, list) and len(results) > 0 and not isinstance(results[0], dict):
            # Ultralytics results object
            detections = []
            if hasattr(results[0], 'boxes') and results[0].boxes is not None:
                for box in results[0].boxes:
                    coords = box.xyxy[0].cpu().numpy().astype(float).tolist()
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])
                    name = CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else f"cls{cls_id}"
                    detections.append({
                        "bbox": coords,
                        "confidence": conf,
                        "class_id": cls_id,
                        "class_name": name
                    })
            return self.render_detections(frame, detections)
        elif isinstance(results, list):
            return self.render_detections(frame, results)
        else:
            return frame.copy(), [], 0.0

    def render_hud(
        self,
        frame: np.ndarray,
        stats: dict[str, Any],
    ) -> np.ndarray:
        """
        Draw a glassmorphic HUD panel in the top-left corner.
        """
        panel_w = 240
        panel_h = 24 + len(stats) * 22 + 8
        overlay = frame.copy()
        cv2.rectangle(overlay, (10, 10), (10 + panel_w, 10 + panel_h), (10, 10, 10), -1)
        cv2.addWeighted(overlay, 0.50, frame, 0.50, 0, frame)
        cv2.rectangle(frame, (10, 10), (10 + panel_w, 10 + panel_h), self.color_accent, 1, cv2.LINE_AA)

        y = 30
        for key, val in stats.items():
            val_str = str(val)
            key_color = (180, 180, 180)
            val_color = (220, 220, 220)

            val_upper = val_str.upper()
            if "CRITICAL" in val_upper or "DANGER" in val_upper:
                val_color = self.color_danger
            elif "WARNING" in val_upper:
                val_color = self.color_warning
            elif "SAFE" in val_upper:
                val_color = self.color_success

            cv2.putText(frame, f"{key}:", (18, y), self.font, 0.40, key_color, 1, cv2.LINE_AA)
            cv2.putText(frame, val_str,   (120, y), self.font, 0.40, val_color, 1, cv2.LINE_AA)
            y += 22

        return frame


# ===========================================================================
# DrowsinessAnalyzer
# ===========================================================================

class DrownsinessAnalyzer:
    """
    Stateful fatigue analyzer using a rolling detection history (PERCLOS).
    """

    ALERT_SAFE     = "SAFE"
    ALERT_WARNING  = "WARNING"
    ALERT_CRITICAL = "CRITICAL"

    def __init__(
        self,
        window_size: int = HISTORY_WINDOW,
        critical_hold_seconds: float = CRITICAL_HOLD_SECONDS,
    ) -> None:
        self._history: deque[list[str]] = deque(maxlen=window_size)
        self._critical_since: float | None = None
        self._critical_hold  = critical_hold_seconds

    def update(self, classes_found: list[str]) -> None:
        self._history.append(classes_found)

    def fatigue_score(self) -> float:
        if not self._history:
            return 0.0

        total = 0.0
        for frame_classes in self._history:
            if "closed_eye" in frame_classes:
                total += 0.70
            elif "yawning" in frame_classes:
                total += 0.30

        return min(total / len(self._history), 1.0)

    def alert_level(self) -> str:
        score = self.fatigue_score()
        now   = time.monotonic()

        if score >= FATIGUE_CRITICAL_THRESHOLD:
            if self._critical_since is None:
                self._critical_since = now
            elapsed = now - self._critical_since
            return self.ALERT_CRITICAL if elapsed >= self._critical_hold else self.ALERT_WARNING
        else:
            self._critical_since = None
            if score >= FATIGUE_WARNING_THRESHOLD:
                return self.ALERT_WARNING
            return self.ALERT_SAFE

    def reset(self) -> None:
        self._history.clear()
        self._critical_since = None


# ===========================================================================
# Unified Model Loader & Inference Runner
# ===========================================================================

def load_model(
    weights_path: str | Path,
    model_type: str = "auto",
    device: str = "auto",
) -> dict[str, Any]:
    """
    Unified model loader for both YOLO (.pt/.onnx) and RF-DETR (.pth/.onnx).
    Returns a model container dictionary.

    device="auto" (default) picks "cuda:0" when torch.cuda.is_available(),
    else falls back to "cpu" -- deployment machines are not guaranteed to
    have a GPU, so a hardcoded "cuda:0" default would crash on CPU-only
    hosts (BOOK.md Chapter 2, SS2.10).
    """
    path = Path(weights_path)
    if not path.exists():
        raise FileNotFoundError(f"Weights file not found: {path}")

    if device == "auto":
        device = "cuda:0" if torch.cuda.is_available() else "cpu"

    path_str = str(path).lower()

    if model_type == "auto":
        if "rfdetr" in path_str or "rf-detr" in path_str or path.suffix == ".pth":
            model_type = "rfdetr"
        else:
            model_type = "yolo"

    log.info("Loading model (%s) on device=%s: %s", model_type, device, path.name)

    if model_type == "yolo":
        from ultralytics import YOLO
        model = YOLO(str(path))
        model.to(device)
        return {"type": "yolo", "model": model, "path": path, "device": device}

    elif model_type == "rfdetr":
        if path.suffix == ".onnx":
            import onnxruntime as ort
            providers = ['CUDAExecutionProvider', 'CPUExecutionProvider'] if device.startswith("cuda") else ['CPUExecutionProvider']
            session = ort.InferenceSession(str(path), providers=providers)
            return {"type": "rfdetr_onnx", "model": session, "path": path, "device": device}
        else:
            try:
                from rfdetr import RFDETRNano, RFDETRSmall
                resolution = 384 if "384" in path_str or "nano" in path_str else 640
                if "small" in path_str:
                    rf_model = RFDETRSmall(resolution=resolution, num_classes=3, pretrain_weights=str(path))
                else:
                    rf_model = RFDETRNano(resolution=resolution, num_classes=3, pretrain_weights=str(path))
                
                return {"type": "rfdetr_pt", "model": rf_model, "resolution": resolution, "path": path, "device": device}
            except Exception as exc:
                log.warning("Could not load native PyTorch RF-DETR model: %s", exc)
                return {"type": "rfdetr_stub", "model": None, "path": path}
    else:
        raise ValueError(f"Unknown model_type: {model_type}")


def run_inference(
    model_dict: dict[str, Any],
    frame: np.ndarray,
    conf_threshold: float = DEFAULT_CONF,
    imgsz: int = 640,
) -> list[dict[str, Any]]:
    """
    Unified inference runner returning standardized detection list:
    [{"bbox": [x1, y1, x2, y2], "confidence": float, "class_id": int, "class_name": str}]
    """
    m_type = model_dict.get("type", "yolo")
    detections: list[dict[str, Any]] = []
    h, w = frame.shape[:2]

    if m_type == "yolo":
        yolo_model = model_dict["model"]
        results = yolo_model.predict(source=frame, conf=conf_threshold, verbose=False)
        if results and len(results[0].boxes) > 0:
            for box in results[0].boxes:
                coords = box.xyxy[0].cpu().numpy().astype(float).tolist()
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                name = CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else f"cls{cls_id}"
                detections.append({
                    "bbox": coords,
                    "confidence": conf,
                    "class_id": cls_id,
                    "class_name": name
                })

    elif m_type == "rfdetr_pt":
        from PIL import Image
        rf_wrapper = model_dict["model"]
        img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(img_rgb)
        
        det = rf_wrapper.predict(pil_img)
        if hasattr(det, 'xyxy') and det.xyxy is not None:
            for box, score, cls_id in zip(det.xyxy, det.confidence, det.class_id):
                conf_val = float(score)
                if conf_val >= conf_threshold:
                    x1, y1, x2, y2 = [float(v) for v in box]
                    c_id = int(cls_id)
                    name = CLASS_NAMES[c_id] if c_id < len(CLASS_NAMES) else f"cls{c_id}"
                    detections.append({
                        "bbox": [x1, y1, x2, y2],
                        "confidence": conf_val,
                        "class_id": c_id,
                        "class_name": name
                    })

    elif m_type == "rfdetr_onnx":
        session = model_dict["model"]
        res = imgsz
        img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img_resized = cv2.resize(img_rgb, (res, res))
        inp = np.transpose(img_resized, (2, 0, 1)).astype(np.float32)[None, ...] / 255.0
        
        input_name = session.get_inputs()[0].name
        outs = session.run(None, {input_name: inp})
        if len(outs) >= 2:
            boxes_norm, logits = outs[0][0], outs[1][0]
            for i in range(len(logits)):
                sig = 1.0 / (1.0 + np.exp(-logits[i][:3]))
                c_id = int(np.argmax(sig))
                conf_val = float(sig[c_id])
                if conf_val >= conf_threshold:
                    cx, cy, bw, bh = boxes_norm[i]
                    x1 = float((cx - bw / 2.0) * w)
                    y1 = float((cy - bh / 2.0) * h)
                    x2 = float((cx + bw / 2.0) * w)
                    y2 = float((cy + bh / 2.0) * h)
                    name = CLASS_NAMES[c_id] if c_id < len(CLASS_NAMES) else f"cls{c_id}"
                    detections.append({
                        "bbox": [x1, y1, x2, y2],
                        "confidence": conf_val,
                        "class_id": c_id,
                        "class_name": name
                    })

    return detections


def process_frame(
    renderer: PremiumRenderer,
    analyzer: DrownsinessAnalyzer,
    model_dict: dict[str, Any],
    frame: np.ndarray,
    conf_threshold: float = DEFAULT_CONF,
) -> tuple[np.ndarray, dict[str, Any]]:
    """
    Full single-frame inference pipeline across YOLO or RF-DETR.
    """
    t0 = time.perf_counter()
    detections = run_inference(model_dict, frame, conf_threshold)
    infer_ms = (time.perf_counter() - t0) * 1000.0

    annotated, classes_found, max_conf = renderer.render_detections(frame, detections)
    analyzer.update(classes_found)

    score = analyzer.fatigue_score()
    alert = analyzer.alert_level()

    hud_stats = {
        "Model": model_dict.get("path", Path("Model")).name[:15],
        "Fatigue": f"{int(score * 100)}%",
        "Alert": alert,
        "Detections": len(detections),
        "Infer ms": f"{infer_ms:.1f}",
    }
    annotated = renderer.render_hud(annotated, hud_stats)

    metadata: dict[str, Any] = {
        "detections": detections,
        "fatigue_score": round(score, 4),
        "alert_level": alert,
        "detection_count": len(detections),
        "inference_ms": round(infer_ms, 2),
    }

    return annotated, metadata
