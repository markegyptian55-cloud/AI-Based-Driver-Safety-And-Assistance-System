"""
video.py
--------
Run the trained detector on a VIDEO FILE (not a live camera).

Reads a video frame by frame, detects drowsiness cues (open_eye / closed_eye /
yawn), overlays the boxes and the temporal driver state (NORMAL / YAWNING /
DROWSY), and writes an annotated output video. Optionally shows it live.

Usage:
    python video.py --video path/to/clip.mp4 --checkpoint checkpoints/best.pth \
                    --device cuda:0 --out results/clip_annotated.mp4

    # also watch it while it processes (press 'q' to stop early):
    python video.py --video clip.mp4 --show

This reuses the same inference path as inference.py / webcam.py.
"""

import os
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
    ap.add_argument("--video", required=True, help="path to input video file")
    ap.add_argument("--checkpoint", default=f"{config.CKPT_DIR}/best.pth")
    ap.add_argument("--device", default=None)
    ap.add_argument("--out", default="results/video_annotated1.mp4",
                    help="path to save the annotated output video")
    ap.add_argument("--score", type=float, default=config.SCORE_THRESH)
    ap.add_argument("--show", action="store_true",
                    help="display the video live while processing")
    ap.add_argument("--replay", action="store_true",
                    help="after processing, play the full annotated video "
                         "back at normal speed")
    args = ap.parse_args()

    device = select_device(args.device)
    model = load_model(args.checkpoint, device)
    monitor = DriverStateMonitor()

    # --- open the input video ---
    if not os.path.exists(args.video):
        raise FileNotFoundError(args.video)
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video {args.video}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"input: {args.video}  ({width}x{height} @ {fps:.1f} fps, {total} frames)")

    # --- prepare the output writer ---
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(args.out, fourcc, fps, (width, height))

    frame_idx = 0
    t0 = time.time()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_idx += 1

        boxes, labels, scores = detect_image(model, frame, device, args.score)
        draw_detections(frame, boxes, labels, scores)

        # temporal driver state from this frame's labels
        state = monitor.update(labels)
        color = STATE_COLORS.get(state, (255, 255, 255))
        cv2.putText(frame, f"State: {state}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)

        writer.write(frame)

        if args.show:
            cv2.imshow("Driver Drowsiness Detection (video)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                print("stopped early by user")
                break

        if total and frame_idx % 50 == 0:
            pct = 100.0 * frame_idx / total
            print(f"  {frame_idx}/{total} frames ({pct:.0f}%)")

    cap.release()
    writer.release()
    if args.show:
        cv2.destroyAllWindows()

    dt = time.time() - t0
    proc_fps = frame_idx / max(dt, 1e-6)
    print(f"done: {frame_idx} frames in {dt:.1f}s ({proc_fps:.1f} fps)")
    print(f"saved -> {args.out}")

    # --- optionally replay the finished video at normal speed ---
    if args.replay:
        replay(args.out)


def replay(path):
    """Play the annotated output video back at its native frame rate."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        print(f"cannot open {path} for replay")
        return
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    delay = max(1, int(1000.0 / fps))   # ms per frame -> real-time playback
    print(f"replaying {path} at {fps:.1f} fps (press 'q' to quit)")
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        cv2.imshow("Annotated video (replay)", frame)
        if cv2.waitKey(delay) & 0xFF == ord("q"):
            break
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
