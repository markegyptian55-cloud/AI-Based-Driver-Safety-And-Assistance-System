"""
Offline video processing pipeline: decode -> detect -> analyse -> encode.

DESIGN: A GENERATOR, NOT A THREAD
=================================
`process_video` yields progress and finally a result. It does not spawn a
thread and it does not own a UI. That is deliberate: Streamlit's script runner
attaches a ScriptRunContext to the running thread, and background threads that
touch `st.*` either warn, no-op, or race. Driving the loop from the page --
consuming N items per fragment rerun -- keeps every `st.*` call on the script
thread, makes the Cancel button work without inter-thread signalling, and lets
the caller decide how often to repaint.

ONE DECODE, TWO ENCODES
=======================
The raw (browser-safe transcode) and annotated outputs are written in the same
pass. Decoding is the expensive half; a second pass to produce the "original"
video for the before/after toggle would roughly double the cost for nothing.
The raw frame is encoded *before* the overlay is drawn, since `render_adas_ui`
mutates the frame in place.

EVERY FRAME IS PROCESSED
========================
No frame skipping by default. A micro-blink is under 0.3s -- 9 frames at 30fps
-- so dropping every other frame would corrupt exactly the measurement this
platform exists to make. `stride` is exposed for a deliberate fast-preview
mode, and the caller is expected to disable micro-event reporting when it is
set above 1.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

import numpy as np

from .adas_render import CLASSES, new_state_history, render_adas_ui
from .analyzer import FatigueAnalyzer
from .detect import predict_frame
from .events import Event, MicroEventDetector
from .video_io import H264Writer, VideoInfo, iter_frames, nvenc_available, probe


@dataclass
class Progress:
    """Emitted per processed frame."""
    frame_idx: int
    n_frames_total: int
    t: float
    pct: float
    fatigue_score: float
    alert_level: str
    detections: list[dict]
    infer_fps: float
    preview_bgr: np.ndarray | None      # only populated every `preview_every` frames
    new_events: list[Event] = field(default_factory=list)
    all_events: list[Event] = field(default_factory=list)
    event_counts: dict[str, int] = field(default_factory=dict)


@dataclass
class Result:
    """Emitted once, last."""
    annotated_path: Path
    raw_path: Path
    info: VideoInfo
    events: list[Event]
    telemetry: list[dict]
    summary: dict[str, Any]
    cancelled: bool = False


def _summarize(
    telemetry: list[dict],
    detector: MicroEventDetector,
    info: VideoInfo,
    elapsed_s: float,
) -> dict[str, Any]:
    if not telemetry:
        return {}
    scores = [row["fatigue"] for row in telemetry]
    levels = [row["alert"] for row in telemetry]
    n = len(telemetry)
    # Per-frame duration for time-in-state. Uses real timestamps rather than
    # n/fps so it stays correct for variable-frame-rate sources.
    span = max(telemetry[-1]["t"] - telemetry[0]["t"], 1e-9)
    per_frame = span / max(n - 1, 1)

    counts = detector.counts()
    cls_counts = {c: 0 for c in CLASSES}
    for row in telemetry:
        for name in row["classes"]:
            if name in cls_counts:
                cls_counts[name] += 1

    return {
        "frames": n,
        "duration_s": span,
        "peak_fatigue": max(scores),
        "mean_fatigue": sum(scores) / n,
        "time_warning_s": levels.count("WARNING") * per_frame,
        "time_critical_s": levels.count("CRITICAL") * per_frame,
        "micro_blinks": counts["micro_blink"],
        "micro_sleeps": counts["micro_sleep"],
        "full_closures": counts["full_closure"],
        "yawns": counts["yawn"],
        "longest_closure_s": detector.longest_closure(),
        "class_frame_counts": cls_counts,
        "total_detections": sum(row["n_det"] for row in telemetry),
        "processing_s": elapsed_s,
        "processing_fps": n / elapsed_s if elapsed_s > 0 else 0.0,
    }


def process_video(
    video_path: str | Path,
    model,
    *,
    model_name: str,
    imgsz: int,
    out_annotated: str | Path,
    out_raw: str | Path,
    conf: float = 0.35,
    max_seconds: float | None = 60.0,
    window_size: int = 30,
    warning_threshold: float = 0.40,
    critical_threshold: float = 0.65,
    critical_hold_seconds: float = 1.5,
    hud_pos: str = "top-right",
    preview_every: int = 3,
    stride: int = 1,
    use_nvenc: bool | None = None,
    should_cancel=None,
) -> Iterator[Progress | Result]:
    """Process a video, yielding Progress per frame then a final Result.

    `should_cancel` is a zero-arg callable polled each frame; returning True
    stops the run, still finalizes both mp4s (a truncated but *valid* video is
    far more useful than a corrupt one) and yields a Result with cancelled=True.
    """
    video_path = Path(video_path)
    info = probe(video_path)

    if use_nvenc is None:
        use_nvenc = nvenc_available()

    n_expected = info.n_frames_est
    if max_seconds is not None and info.fps > 0:
        n_expected = min(n_expected or 10**9, int(round(max_seconds * info.fps)))
    n_expected = max(int(n_expected // max(stride, 1)), 1)

    analyzer = FatigueAnalyzer(
        window_size=window_size,
        warning_threshold=warning_threshold,
        critical_threshold=critical_threshold,
        critical_hold_seconds=critical_hold_seconds,
    )
    detector = MicroEventDetector()
    state_history = new_state_history()

    telemetry: list[dict] = []
    cancelled = False
    started = time.perf_counter()

    writer_a = H264Writer(out_annotated, info.width, info.height, info.fps, use_nvenc=use_nvenc)
    writer_r = H264Writer(out_raw, info.width, info.height, info.fps, use_nvenc=use_nvenc)

    try:
        out_idx = 0
        for src_idx, (frame, t) in enumerate(iter_frames(video_path, max_seconds=max_seconds)):
            if stride > 1 and (src_idx % stride):
                continue

            if should_cancel is not None and should_cancel():
                cancelled = True
                break

            # Write raw unannotated frame first
            writer_r.write(frame)

            t0 = time.perf_counter()
            detections = predict_frame(model, frame, conf=conf, imgsz=imgsz)
            infer_s = time.perf_counter() - t0
            infer_fps = 1.0 / max(infer_s, 1e-6)

            class_names = [d["class_name"] for d in detections]
            step = analyzer.step(class_names, t)
            new_events = detector.update(t, out_idx, class_names)

            annotated_frame = frame.copy()
            render_adas_ui(
                annotated_frame,
                model_name=model_name,
                frame_idx=out_idx,
                fps=infer_fps,
                detections=detections,
                state_history=state_history,
                fatigue_score=step.fatigue_score,
                alert_level=step.alert_level,
                hud_pos=hud_pos,
            )
            writer_a.write(annotated_frame)

            telemetry.append({
                "frame": out_idx,
                "t": t,
                "fatigue": step.fatigue_score,
                "alert": step.alert_level,
                "n_det": len(detections),
                "classes": class_names,
                "infer_ms": infer_s * 1000.0,
            })

            want_preview = (out_idx % max(preview_every, 1) == 0)
            yield Progress(
                frame_idx=out_idx,
                n_frames_total=n_expected,
                t=t,
                pct=min(1.0, (out_idx + 1) / n_expected),
                fatigue_score=step.fatigue_score,
                alert_level=step.alert_level,
                detections=detections,
                infer_fps=infer_fps,
                preview_bgr=annotated_frame if want_preview else None,
                new_events=new_events,
                all_events=list(detector.events),
                event_counts=detector.counts(),
            )
            out_idx += 1

        detector.flush()
    finally:
        writer_a.close()
        writer_r.close()

    elapsed = time.perf_counter() - started
    yield Result(
        annotated_path=Path(out_annotated),
        raw_path=Path(out_raw),
        info=info,
        events=list(detector.events),
        telemetry=telemetry,
        summary=_summarize(telemetry, detector, info, elapsed),
        cancelled=cancelled,
    )


# ------------------------------------------------------------------ CLI

def _cli() -> None:
    """Headless driver, so the pipeline is testable without Streamlit:
        python -m core.pipeline <video> <checkpoint> [--seconds 10]
    """
    import argparse

    from .detect import load_yolo_model

    ap = argparse.ArgumentParser(description="Headless drowsiness video pipeline")
    ap.add_argument("video")
    ap.add_argument("checkpoint")
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--imgsz", type=int, default=960)
    ap.add_argument("--out", default="runtime")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    print(f"Loading {args.checkpoint} ...")
    model = load_yolo_model(args.checkpoint)

    last = None
    for item in process_video(
        args.video, model,
        model_name=Path(args.checkpoint).parent.name,
        imgsz=args.imgsz,
        out_annotated=out / "cli_annotated.mp4",
        out_raw=out / "cli_raw.mp4",
        conf=args.conf,
        max_seconds=args.seconds,
    ):
        if isinstance(item, Progress):
            if item.frame_idx % 25 == 0:
                print(f"  frame {item.frame_idx}/{item.n_frames_total} "
                      f"t={item.t:6.2f}s  fatigue={item.fatigue_score:.2f} "
                      f"{item.alert_level:8s} {item.infer_fps:5.1f} fps")
        else:
            last = item

    if last:
        print("\nSUMMARY")
        for k, v in last.summary.items():
            if k == "class_frame_counts":
                print(f"  {k}: {v}")
            elif isinstance(v, float):
                print(f"  {k}: {v:.3f}")
            else:
                print(f"  {k}: {v}")
        print(f"\nEvents ({len(last.events)}):")
        for e in last.events[:20]:
            print(f"  {e.kind:14s} {e.t_start:6.2f}-{e.t_end:6.2f}s "
                  f"({e.duration:.3f}s) {e.severity}")
        print(f"\nAnnotated: {last.annotated_path}")


if __name__ == "__main__":
    _cli()
