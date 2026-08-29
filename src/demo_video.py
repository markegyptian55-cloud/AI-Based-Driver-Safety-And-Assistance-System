"""
demo_video.py — Multi-Model Video Demo Harness (YOLO + RF-DETR)
==================================================================
Project : nano big -- driver drowsiness detection

(Renamed from test_video.py, BOOK.md Chapter 2 SS2.10 -- this is a visual
demo/HUD tool, not a pytest test; the old "test_" prefix meant pytest could
try to collect it as a test module.)

Runs any (or all) registered models against ONE video clip (randomly picked
from data/raw_videos/ unless --video is given) and renders the drowsiness
HUD onto the output, saved to
INFO/<family>/<N-name>-test-result/tested-video/ -- derived automatically
from the checkpoint's own path (see derive_test_result_dir() below and
AGENTS.md / BOOK.md Ch.2 SS2.10 for the full folder convention).

What changed from the original test_video.py, and why
-------------------------------------------------------
- MODEL_REGISTRY is no longer a hardcoded dict of 4 stale checkpoint paths
  under inconsistently-named folders (that checkpoints/ tree did not exist
  in this project at all -- it belonged to a different, prior project
  copy). It is now loaded from configs/checkpoints.yaml, the single source
  of truth also used by export.py, so the two scripts cannot drift apart.
- --seed added for deterministic default video selection (was
  unseeded random.choice()).
- All rendering/HUD/extraction logic (draw_navigation_bar,
  draw_detection_boxes, extract_yolo_detections, etc.) is UNCHANGED --
  recon found this part of the file solid and reusable as-is.

Usage
-----
    python src/demo_video.py --model all --duration 20
    python src/demo_video.py --model <key from configs/checkpoints.yaml> --duration 20
"""

from __future__ import annotations

import os
import sys
import random
import argparse
import time
from pathlib import Path
from collections import Counter, deque

import cv2
import numpy as np

# ============================================================
# PROJECT PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from inference import DrownsinessAnalyzer

CLASSES = ["closed_eye", "open_eye", "yawning"]

CLASS_SHORT = {0: "C", 1: "O", 2: "Y"}   # Closed / Open / Yawning — used on the box label

# ============================================================
# MODEL REGISTRY — loaded from configs/checkpoints.yaml
# ============================================================

def _load_model_registry():
    import yaml
    cfg_path = PROJECT_ROOT / "configs" / "checkpoints.yaml"
    if not cfg_path.exists():
        return {}
    with open(cfg_path, "r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    registry = {}
    for key, entry in (cfg.get("models") or {}).items():
        entry = dict(entry)
        entry["checkpoint"] = PROJECT_ROOT / entry["checkpoint"]
        registry[key] = entry
    return registry


MODEL_REGISTRY = _load_model_registry()

CHECKPOINTS_ROOT = PROJECT_ROOT / "checkpoints"


def derive_test_result_dir(checkpoint_path) -> Path:
    """
    INFO/<family>/<N-name>-test-result/, derived from a checkpoint living at
    checkpoints/<family>/<N-name>/best.pt (train.py's output convention,
    BOOK.md Ch.2 SS2.10). Shared with evaluate.py so both scripts' outputs
    land in the same per-experiment folder (tested-images/ vs tested-video/
    subfolders inside it). Falls back to INFO/_ad_hoc/<stem>-test-result/
    for checkpoints that don't follow that layout.
    """
    checkpoint_path = Path(checkpoint_path).resolve()
    exp_dir = checkpoint_path.parent
    family_dir = exp_dir.parent
    if family_dir.parent == CHECKPOINTS_ROOT:
        return PROJECT_ROOT / "INFO" / family_dir.name / f"{exp_dir.name}-test-result"
    return PROJECT_ROOT / "INFO" / "_ad_hoc" / f"{checkpoint_path.stem}-test-result"


# ============================================================
# SEMANTIC COLOR SYSTEM (BGR)
# ============================================================

COLOR_MAP = {
    0: (45, 55, 235),      # RED    -> closed_eye
    1: (65, 225, 95),      # GREEN  -> open_eye
    2: (0, 180, 255),      # AMBER  -> yawning
}

COLOR_BG        = (12, 15, 20)
COLOR_TEXT      = (210, 215, 220)
COLOR_MUTED     = (120, 130, 140)
COLOR_BORDER    = (55, 70, 65)
COLOR_CYAN      = (220, 200, 60)
COLOR_BLACK     = (0, 0, 0)
COLOR_SEPARATOR = (45, 52, 58)

ALERT_COLORS = {
    "SAFE":     (65, 225, 95),
    "WARNING":  (0, 180, 255),
    "CRITICAL": (45, 55, 235),
}

FONT = cv2.FONT_HERSHEY_DUPLEX   # bolder than SIMPLEX — holds up much better at small sizes under video compression
STATE_HISTORY_SIZE = 10


# ============================================================
# UTILITY FUNCTIONS
# ============================================================

def clamp(val, lo, hi):
    return max(lo, min(val, hi))


def scale(base, fw, ref=640):
    return max(1, int(base * fw / ref))


def font_scale(base, fw, ref=640):
    return max(0.25, base * fw / ref)


def draw_alpha_rect(frame, x1, y1, x2, y2, color, alpha=0.82):
    h, w = frame.shape[:2]
    x1, x2 = int(clamp(x1, 0, w)), int(clamp(x2, 0, w))
    y1, y2 = int(clamp(y1, 0, h)), int(clamp(y2, 0, h))
    if x2 <= x1 or y2 <= y1:
        return
    roi = frame[y1:y2, x1:x2]
    overlay = np.full_like(roi, color, dtype=np.uint8)
    cv2.addWeighted(overlay, alpha, roi, 1.0 - alpha, 0, roi)


def put_text_on_panel(frame, text, pos, fscale, color, thickness=1):
    """Text on a solid alpha panel — no shadow needed, single clean draw."""
    x, y = int(pos[0]), int(pos[1])
    cv2.putText(frame, text, (x, y), FONT, fscale, color, thickness, cv2.LINE_AA)


def put_text_on_video(frame, text, pos, fscale, color, thickness=1):
    """Text directly on raw video — crisp non-AA drop shadow for legibility."""
    x, y = int(pos[0]), int(pos[1])
    cv2.putText(frame, text, (x + 2, y + 2), FONT, fscale, COLOR_BLACK, thickness + 1, cv2.LINE_8)
    cv2.putText(frame, text, (x, y), FONT, fscale, color, thickness, cv2.LINE_AA)


# ============================================================
# DRIVER STATE LOGIC
# ============================================================

def determine_driver_state(detections):
    if not detections:
        return {"label": "NO DETECTION", "color": COLOR_MUTED, "short": "UNKNOWN"}
    class_ids = [d["class_id"] for d in detections]
    if 2 in class_ids:
        return {"label": "YAWNING DETECTED", "color": COLOR_MAP[2], "short": "WARNING"}
    if 0 in class_ids:
        return {"label": "EYES CLOSED", "color": COLOR_MAP[0], "short": "DROWSY"}
    return {"label": "ATTENTIVE", "color": COLOR_MAP[1], "short": "NORMAL"}


def stabilize_driver_state(current_state, state_history):
    state_history.append(current_state["short"])
    if len(state_history) < 3:
        return current_state
    counts = Counter(state_history)
    stable, _ = counts.most_common(1)[0]
    if stable == "WARNING":
        return {"label": "YAWNING DETECTED", "color": COLOR_MAP[2], "short": "WARNING"}
    if stable == "DROWSY":
        return {"label": "EYES CLOSED", "color": COLOR_MAP[0], "short": "DROWSY"}
    if stable == "NORMAL":
        return {"label": "ATTENTIVE", "color": COLOR_MAP[1], "short": "NORMAL"}
    return current_state


# ============================================================
# 1. NAVIGATION BAR  (top-left, ~50% smaller, 4 rows only)
# ============================================================

def draw_navigation_bar(frame, driver_state, fps, frame_idx, model_name, detections,
                         fatigue_score, alert_level):
    """
    Compact HUD — 4 rows only:
        ADAS · <MODEL>
        ● ATTENTIVE
        FATIGUE 12%  SAFE
        FPS 71.0   FRAME 00240
    """
    fh, fw = frame.shape[:2]

    pad   = scale(8, fw)
    bar_x = pad
    bar_y = pad
    bar_w = scale(230, fw)     # readable middle-ground (v4 went too small at 190)
    bar_h = scale(112, fw)     # readable middle-ground (v4 went too small at 92)
    bar_w = min(bar_w, fw // 2 - pad)
    bar_h = min(bar_h, fh // 2 - pad)

    draw_alpha_rect(frame, bar_x, bar_y, bar_x + bar_w, bar_y + bar_h, COLOR_BG, alpha=0.84)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h), COLOR_BORDER, 1, cv2.LINE_AA)

    lx = bar_x + scale(10, fw)
    cy = bar_y + scale(20, fw)
    line_h = scale(26, fw)

    fs_title = font_scale(0.42, fw)
    fs_label = font_scale(0.38, fw)
    fs_small = font_scale(0.34, fw)

    # Row 1: title + model name on one line
    model_short = model_name if len(model_name) <= 18 else model_name[:16] + ".."
    put_text_on_panel(frame, f"ADAS · {model_short}", (lx, cy), fs_title, COLOR_CYAN, 1)
    cy += line_h

    # Row 2: status dot + label
    state_color = driver_state["color"]
    dot_r = max(3, scale(4, fw))
    cv2.circle(frame, (lx + dot_r, cy - scale(3, fw)), dot_r, state_color, -1, cv2.LINE_AA)
    put_text_on_panel(frame, driver_state["label"], (lx + dot_r * 2 + scale(6, fw), cy),
                       fs_label, state_color, 1)
    cy += line_h

    # Row 3: fatigue score + debounced alert
    alert_color = ALERT_COLORS.get(alert_level, COLOR_MUTED)
    put_text_on_panel(frame, f"FATIGUE {int(fatigue_score * 100):3d}%  {alert_level}",
                       (lx, cy), fs_small, alert_color, 1)
    cy += line_h

    # Row 4: FPS + frame counter
    fps_str = f"FPS {fps:04.1f}"
    frm_str = f"F{frame_idx:05d}"
    put_text_on_panel(frame, fps_str, (lx, cy), fs_small, COLOR_MUTED, 1)
    (tw, _), _ = cv2.getTextSize(frm_str, FONT, fs_small, 1)
    put_text_on_panel(frame, frm_str, (bar_x + bar_w - scale(10, fw) - tw, cy), fs_small, COLOR_MUTED, 1)


# ============================================================
# 2. EYE DETECTION BOXES — real raw coordinates + confidence %
# ============================================================

def draw_detection_boxes(frame, detections):
    """
    Draws the model's actual raw bounding box (no artificial shrink),
    with a compact "O 92%" / "C 88%" / "Y 76%" label — this is now the
    ONLY place confidence is shown, since the side panel is removed.
    """
    if not detections:
        return

    fh, fw = frame.shape[:2]

    for det in detections:
        x1, y1, x2, y2 = det["x1"], det["y1"], det["x2"], det["y2"]
        cls_id = det["class_id"]
        conf_pct = int(det["confidence"] * 100)
        color = COLOR_MAP.get(cls_id, (65, 225, 95))

        rx1 = int(clamp(x1, 0, fw - 1))
        ry1 = int(clamp(y1, 0, fh - 1))
        rx2 = int(clamp(x2, 0, fw - 1))
        ry2 = int(clamp(y2, 0, fh - 1))
        if rx2 <= rx1 or ry2 <= ry1:
            continue

        cv2.rectangle(frame, (rx1, ry1), (rx2, ry2), color, 1, cv2.LINE_AA)

        short = CLASS_SHORT.get(cls_id, "?")
        label = f"{short} {conf_pct}%"
        fs = font_scale(0.34, fw)
        (tw, th), _ = cv2.getTextSize(label, FONT, fs, 1)

        # Place label just above the box; flip below if it would go off-screen
        tx = rx1
        ty = ry1 - 4
        if ty - th < 0:
            ty = ry2 + th + 4

        put_text_on_video(frame, label, (tx, ty), fs, color, 1)


# ============================================================
# 3. MAIN RENDER PIPELINE
# ============================================================

def render_adas_ui(frame, model_name, frame_idx, fps, detections, state_history,
                    fatigue_score, alert_level, source_fps=30.0):
    """
    Visual hierarchy:
      1. Video / driver (untouched)
      2. Eye bounding boxes with class + confidence % label
      3. Compact nav bar (top-left) — NO right-side navigator anymore
    """
    raw_state    = determine_driver_state(detections)
    driver_state = stabilize_driver_state(raw_state, state_history)

    draw_detection_boxes(frame, detections)
    draw_navigation_bar(frame, driver_state, fps, frame_idx, model_name, detections,
                         fatigue_score, alert_level)

    return driver_state


# ============================================================
# DETECTION EXTRACTION
# ============================================================

def extract_yolo_detections(result):
    detections = []
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


def extract_rfdetr_detections(det):
    detections = []
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


# ============================================================
# MODEL LOADERS
# ============================================================

def load_yolo_model(checkpoint_path):
    from ultralytics import YOLO
    return YOLO(str(checkpoint_path))


def load_rfdetr_model(checkpoint_path, resolution, rfdetr_class="nano", optimize=False):
    from rfdetr import RFDETRNano, RFDETRSmall
    cls = RFDETRSmall if rfdetr_class == "small" else RFDETRNano
    print(f"[RF-DETR] Loading {rfdetr_class} checkpoint: {checkpoint_path}")
    model = cls(resolution=resolution, num_classes=len(CLASSES), pretrain_weights=str(checkpoint_path))
    if optimize:
        try:
            import torch
            model.optimize_for_inference(dtype=torch.float16)
            print("[RF-DETR] optimize_for_inference(float16) applied.")
        except Exception as exc:
            print(f"[RF-DETR] optimize_for_inference failed, continuing unoptimized: {exc}")
    return model


# ============================================================
# UNIFIED VIDEO PROCESSING LOOP
# ============================================================

def process_video(
    video_path, model_key, model_cfg,
    target_duration_sec=60, conf_threshold=0.35, optimize=False,
    save_keyframes=False,
):
    display_name = model_cfg["display_name"]
    family = model_cfg["family"]
    checkpoint = model_cfg["checkpoint"]

    if not checkpoint.exists():
        print(f"WARNING [{model_key}]: checkpoint not found, skipping:\n  {checkpoint}")
        return

    test_result_dir = derive_test_result_dir(checkpoint)
    tested_video_dir = test_result_dir / "tested-video"
    tested_video_dir.mkdir(parents=True, exist_ok=True)
    out_video_path = tested_video_dir / "detection_demo_1to2min.mp4"

    keyframes_dir = None
    if save_keyframes:
        keyframes_dir = tested_video_dir / "keyframes"
        keyframes_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n[{family.upper()} TEST] {Path(video_path).name}")
    print(f"Model      : {display_name}")
    print(f"Checkpoint : {checkpoint}")

    try:
        if family == "yolo":
            model = load_yolo_model(checkpoint)
        else:
            model = load_rfdetr_model(
                checkpoint, resolution=model_cfg["resolution"],
                rfdetr_class=model_cfg.get("rfdetr_class", "nano"), optimize=optimize,
            )
    except Exception as exc:
        print(f"ERROR: Could not load model '{display_name}' — {exc}")
        return

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print(f"ERROR: Failed to open video: {video_path}")
        return

    width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    source_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames_in_video = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if target_duration_sec and target_duration_sec > 0:
        total_target_frames = min(total_frames_in_video, int(source_fps * target_duration_sec))
    else:
        total_target_frames = total_frames_in_video if total_frames_in_video > 0 else 999999

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(out_video_path), fourcc, source_fps, (width, height))
    if not out.isOpened():
        print("ERROR: Failed to initialize VideoWriter.")
        cap.release()
        return

    analyzer = DrownsinessAnalyzer()
    state_history = deque(maxlen=STATE_HISTORY_SIZE)
    seen_class_ids = set()

    if family == "rfdetr":
        from PIL import Image

    frame_count = 0
    keyframe_counter = 0
    processing_start = time.perf_counter()

    while cap.isOpened() and frame_count < total_target_frames:
        ret, frame = cap.read()
        if not ret:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = cap.read()
            if not ret:
                break

        frame_count += 1
        inference_start = time.perf_counter()

        if family == "yolo":
            result = model.predict(source=frame, conf=conf_threshold, verbose=False)[0]
            detections = extract_yolo_detections(result)
        else:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(rgb_frame)
            det = model.predict(pil_img, threshold=conf_threshold)
            detections = extract_rfdetr_detections(det)

        inference_time = time.perf_counter() - inference_start
        inference_fps = 1.0 / max(inference_time, 1e-6)

        for d in detections:
            seen_class_ids.add(d["class_id"])

        analyzer.update([d["class_name"] for d in detections])
        fatigue_score = analyzer.fatigue_score()
        alert_level   = analyzer.alert_level()

        render_adas_ui(
            frame=frame, model_name=display_name, frame_idx=frame_count, fps=inference_fps,
            detections=detections, state_history=state_history,
            fatigue_score=fatigue_score, alert_level=alert_level, source_fps=source_fps,
        )

        out.write(frame)

        if save_keyframes:
            interval = max(total_target_frames // 5, 1)
            if frame_count % interval == 0 and keyframe_counter < 5:
                keyframe_counter += 1
                cv2.imwrite(str(keyframes_dir / f"keyframe_{keyframe_counter:02d}.jpg"), frame)

    cap.release()
    out.release()

    total_time = time.perf_counter() - processing_start
    actual_fps = frame_count / max(total_time, 1e-6)

    print("\n" + "=" * 50)
    print(f"{display_name} — VIDEO TEST COMPLETE")
    print(f"Frames processed   : {frame_count}")
    print(f"Processing FPS     : {actual_fps:.2f}")
    print(f"Class ids observed : {sorted(seen_class_ids)}  (valid range: {list(range(len(CLASSES)))})")
    if not seen_class_ids:
        print("  WARNING: model produced ZERO detections across the whole clip.")
    print(f"Output             : {out_video_path}")
    print("=" * 50 + "\n")


# ============================================================
# MAIN
# ============================================================

def parse_args():
    parser = argparse.ArgumentParser(description="Multi-model video test harness")
    parser.add_argument("--video", type=str, default=None)
    parser.add_argument("--duration", type=int, default=60)
    parser.add_argument("--conf", type=float, default=0.35)
    parser.add_argument("--model", choices=list(MODEL_REGISTRY.keys()) + ["all"], default="all")
    parser.add_argument("--optimize", action="store_true")
    parser.add_argument("--seed", type=int, default=0,
                         help="Seed for default video selection when --video is omitted "
                               "(was unseeded/nondeterministic before)")
    parser.add_argument("--save-keyframes", action="store_true",
                         help="Also save 5 sample JPEG keyframes (off by default — video only)")
    return parser.parse_args()


def main():
    args = parse_args()

    if not MODEL_REGISTRY:
        print("ERROR: configs/checkpoints.yaml has no registered models yet. "
              "Train a model first (python src/train.py --config configs/yolo26n_baseline.yaml), "
              "then add its checkpoint to configs/checkpoints.yaml.")
        return

    if args.video:
        selected_video = Path(args.video)
        if not selected_video.exists():
            print(f"ERROR: --video path does not exist: {selected_video}")
            return
    else:
        raw_video_dir = PROJECT_ROOT / "data" / "raw_videos"
        raw_videos = sorted(list(raw_video_dir.glob("*.avi")) + list(raw_video_dir.glob("*.mp4")))
        if not raw_videos:
            print("ERROR: No raw videos found in data/raw_videos/")
            return
        rng = random.Random(args.seed)
        selected_video = rng.choice(raw_videos)

    print(f"Selected video: {selected_video.name}")

    keys_to_run = list(MODEL_REGISTRY.keys()) if args.model == "all" else [args.model]
    for key in keys_to_run:
        process_video(
            video_path=selected_video, model_key=key, model_cfg=MODEL_REGISTRY[key],
            target_duration_sec=args.duration, conf_threshold=args.conf,
            optimize=args.optimize, save_keyframes=args.save_keyframes,
        )


if __name__ == "__main__":
    main()