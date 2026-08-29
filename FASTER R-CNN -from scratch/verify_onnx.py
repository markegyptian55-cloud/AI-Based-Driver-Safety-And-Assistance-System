"""Compare PyTorch and ONNX detections on one local image."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "Backend"))

from app.domain.models.faster_rcnn import FasterRCNNBackend
from app.domain.models.onnx_faster_rcnn import OnnxFasterRCNNBackend


def timed_predict(backend, image):
    started = time.perf_counter()
    detections = backend.predict(image)
    return detections, (time.perf_counter() - started) * 1000


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()
    bgr = cv2.imread(str(args.image))
    if bgr is None:
        raise SystemExit(f"Could not read image: {args.image}")
    image = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    checkpoint_dir = PROJECT_ROOT / "ML/checkpoints/tuned"
    backends = {
        "PyTorch": FasterRCNNBackend(
            checkpoint_dir / "best.pth", device="cpu", score_threshold=args.threshold
        ),
        "ONNX": OnnxFasterRCNNBackend(
            checkpoint_dir / "best.onnx", device="cpu", score_threshold=args.threshold
        ),
    }
    for name, backend in backends.items():
        backend.load()
        detections, elapsed = timed_predict(backend, image)
        print(f"{name}: {elapsed:.1f} ms, {len(detections)} detections")
        for detection in detections:
            print(
                f"  class={detection.label_index} score={detection.score:.4f} "
                f"box=({detection.x1:.1f},{detection.y1:.1f},"
                f"{detection.x2:.1f},{detection.y2:.1f})"
            )


if __name__ == "__main__":
    main()
