"""
webcam_demo.py — Real-Time Live Camera & Video Stream Demo
============================================================
Project : nano big -- driver drowsiness detection (closed_eye/open_eye/yawning)

(Renamed from webcam-test.py, BOOK.md Chapter 2 SS2.10 -- this is a live
interactive demo, not a unit test, and the hyphenated filename wasn't a
valid Python module name.)

Runs real-time driver drowsiness detection (open_eye, closed_eye, yawning)
on live webcam feed (device index 0) or input video stream using the unified
engine in src/inference.py.

Usage:
  python src/webcam_demo.py --weights checkpoints/yolo26n/1-baseline/best.pt
  python src/webcam_demo.py --weights <best.pt> --source 0                  # Live webcam
  python src/webcam_demo.py --weights <best.pt> --source path/to/video.mp4  # Video file

Refactor notes (BOOK.md Chapter 2, SS2.10): the old default weights path
pointed at a dead checkpoint tree inherited from an unrelated prior project
-- there is no sane trained-model default before Experiment 0 finishes, so
--weights is now required (falls back to configs/checkpoints.yaml's first
entry if present) rather than silently pointing at a nonexistent file. Also
fixed the `from src.inference import ...` package-style import (inconsistent
with every other src/ script, and only works if launched from PROJECT_ROOT)
to match the sys.path.insert + bare-module pattern used elsewhere. Added
per-frame FPS/latency logging to the HUD and console, since this is the one
script meant for live interactive testing where that number matters most.
"""

import sys
import time
import argparse
from pathlib import Path

import cv2

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from inference import load_model, process_frame, PremiumRenderer, DrownsinessAnalyzer


def _default_weights() -> Path | None:
    """First entry in configs/checkpoints.yaml, if any have been trained yet."""
    import yaml
    cfg_path = PROJECT_ROOT / "configs" / "checkpoints.yaml"
    if not cfg_path.exists():
        return None
    with open(cfg_path, "r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    models = cfg.get("models") or {}
    if not models:
        return None
    first = next(iter(models.values()))
    return PROJECT_ROOT / first["checkpoint"]


def _parse_args():
    parser = argparse.ArgumentParser(description="Live Webcam & Video Driver Safety Tester")
    parser.add_argument("--weights", type=str, default=None, help="Path to trained model (.pt or .pth). Defaults to the first entry in configs/checkpoints.yaml if omitted.")
    parser.add_argument("--source", default="0", help="Webcam index (0) or path to video file")
    parser.add_argument("--conf", type=float, default=0.35, help="Confidence threshold")
    return parser.parse_args()


def main():
    args = _parse_args()

    weights_path = Path(args.weights) if args.weights else _default_weights()
    if weights_path is None or not weights_path.exists():
        print(f"[error] No usable weights found (got: {weights_path}).")
        print("        Train a model first (python src/train.py --config configs/yolo26n_baseline.yaml)")
        print("        then pass --weights <path/to/best.pt>, or register it in configs/checkpoints.yaml.")
        return

    model_container = load_model(weights_path)
    renderer = PremiumRenderer()
    analyzer = DrownsinessAnalyzer()

    src_arg = int(args.source) if str(args.source).isdigit() else args.source
    cap = cv2.VideoCapture(src_arg)
    if not cap.isOpened():
        print(f"[error] Could not open video/webcam source: {args.source}")
        return

    print(f"[stream] Driver Safety live stream active ({args.source}). Press 'q' to quit.")

    frame_count = 0
    fps_t0 = time.perf_counter()
    smoothed_fps = 0.0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        annotated, metadata = process_frame(
            renderer=renderer,
            analyzer=analyzer,
            model_dict=model_container,
            frame=frame,
            conf_threshold=args.conf
        )

        frame_count += 1
        now = time.perf_counter()
        elapsed = now - fps_t0
        if elapsed >= 0.5:
            instant_fps = frame_count / elapsed
            smoothed_fps = instant_fps if smoothed_fps == 0.0 else 0.5 * smoothed_fps + 0.5 * instant_fps
            frame_count = 0
            fps_t0 = now
            print(f"[stream] FPS={smoothed_fps:.1f}  infer_ms={metadata['inference_ms']:.1f}  alert={metadata['alert_level']}")

        cv2.putText(annotated, f"FPS: {smoothed_fps:.1f}", (10, annotated.shape[0] - 12),
                    cv2.FONT_HERSHEY_DUPLEX, 0.5, (0, 255, 255), 1, cv2.LINE_AA)

        cv2.imshow("AI Driver Safety Assistance System (Press 'q' to exit)", annotated)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

