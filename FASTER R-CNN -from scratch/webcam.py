"""
webcam.py
---------
Real-time driver drowsiness detection from a webcam.

Usage:
    python webcam.py --checkpoint checkpoints/best.pth --device cuda:0 --cam 0

Press 'q' to quit. This script is intentionally separate from training: it
reuses the trained model for inference and adds temporal state logic + FPS.
"""

import argparse
import time
import cv2

import config
from inference import load_model, detect_image
from utils.gpu_utils import select_device
from utils.visualization import draw_detections
from utils.driver_state import DriverStateMonitor

STATE_COLORS = {
    "NORMAL": (0, 200, 0),
    "YAWNING": (0, 180, 255),
    "DROWSY / SLEEPING": (0, 0, 230),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=f"{config.CKPT_DIR}/best.pth")
    ap.add_argument("--device", default=None)
    ap.add_argument("--cam", type=int, default=0)
    ap.add_argument("--score", type=float, default=config.SCORE_THRESH)
    args = ap.parse_args()

    device = select_device(args.device)
    model = load_model(args.checkpoint, device)
    monitor = DriverStateMonitor()

    cap = cv2.VideoCapture(args.cam)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open camera {args.cam}")

    prev = time.time()
    while True:
        ok, frame = cap.read()
        if not ok:
            break

        boxes, labels, scores = detect_image(model, frame, device, args.score)
        draw_detections(frame, boxes, labels, scores)

        # temporal driver state from this frame's labels
        state = monitor.update(labels)

        # FPS (smoothed a little)
        now = time.time()
        fps = 1.0 / max(now - prev, 1e-6)
        prev = now

        color = STATE_COLORS.get(state, (255, 255, 255))
        cv2.putText(frame, f"State: {state}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
        cv2.putText(frame, f"FPS: {fps:.1f}", (10, 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

        cv2.imshow("Driver Drowsiness Detection", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
