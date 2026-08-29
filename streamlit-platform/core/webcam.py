"""
Live camera capture and per-frame analysis step.

WHY NOT streamlit-webrtc
=========================
Not available in the offline wheelhouse, and would need a STUN/TURN server for
reliable cross-machine use anyway. `cv2.VideoCapture` + a bounded per-fragment
loop (see pages/2_webcam.py) is simpler and needs nothing beyond what's
already installed.

WHY CAP_DSHOW EXPLICITLY
=========================
On Windows, `cv2.VideoCapture(i)` without a backend hint defaults to MSMF,
which can take 1-2 seconds to open or enumerate and occasionally hangs on
laptops with an IR + RGB camera pair. DSHOW opens near-instantly and is the
backend the rest of the Windows OpenCV ecosystem generally recommends.

SESSION OWNERSHIP
==================
`CameraSession` must live in `st.session_state`, never `st.cache_resource`.
`cache_resource` is process-wide -- two browser tabs would fight over the same
`VideoCapture` handle and deadlock. Each browser session gets its own camera
handle, opened on Start and released on Stop (and on any error).
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import cv2
import numpy as np

from .adas_render import CLASSES, new_state_history, render_adas_ui
from .analyzer import FatigueAnalyzer
from .detect import predict_frame
from .events import Event, MicroEventDetector

MAX_CAMERA_PROBE = 4


def list_cameras(max_idx: int = MAX_CAMERA_PROBE) -> list[int]:
    """Probe camera indices 0..max_idx-1. Cheap-ish; call once and cache in
    session_state rather than on every rerun."""
    found = []
    for i in range(max_idx):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        try:
            if cap.isOpened():
                ok, _ = cap.read()
                if ok:
                    found.append(i)
        finally:
            cap.release()
    return found


@dataclass
class FrameResult:
    bgr: np.ndarray
    t: float
    detections: list[dict]
    fatigue_score: float
    alert_level: str
    escalated: bool
    new_events: list[Event]
    infer_fps: float


class CameraSession:
    """Owns the capture handle and all per-session analysis state.

    Time base is `time.monotonic()` -- unlike offline video, frames arrive at
    real wall-clock speed here, so the analyzer's sustained-hold logic is
    correct as-is (this is exactly the case `time.monotonic()` was designed
    for; the video pipeline needed a different clock precisely because it is
    *not* wall-clock-paced).
    """

    def __init__(
        self,
        camera_index: int,
        *,
        window_size: int = 30,
        warning_threshold: float = 0.40,
        critical_threshold: float = 0.65,
        critical_hold_seconds: float = 1.5,
    ) -> None:
        self.camera_index = camera_index
        self.cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            self.cap.release()
            raise RuntimeError(f"Could not open camera {camera_index}")

        self.analyzer = FatigueAnalyzer(
            window_size=window_size,
            warning_threshold=warning_threshold,
            critical_threshold=critical_threshold,
            critical_hold_seconds=critical_hold_seconds,
        )
        self.detector = MicroEventDetector()
        self.state_history = new_state_history()
        self.frame_idx = 0
        self.recent_events: list[Event] = []
        self.released = False

    def release(self) -> None:
        if self.released:
            return
        try:
            self.detector.flush()
        except Exception:
            pass
        try:
            self.cap.release()
        except Exception:
            pass
        self.released = True


def step(session: CameraSession, model, *, model_name: str, conf: float, imgsz: int,
         hud_pos: str = "top-right", family: str = "yolo",
         half: bool = False) -> FrameResult | None:
    """One frame: read -> predict -> render -> analyse. Returns None on read failure.

    Live capture is inherently one frame at a time, so the batched path used
    by the offline video pipeline does not apply here -- there is no second
    frame available yet to batch with, and waiting for one would add exactly
    the latency a live view must not have.
    """
    ok, frame = session.cap.read()
    if not ok or frame is None:
        return None

    t = time.monotonic()
    t0 = time.perf_counter()
    detections = predict_frame(model, frame, conf=conf, imgsz=imgsz, family=family,
                               half=half)
    infer_fps = 1.0 / max(time.perf_counter() - t0, 1e-6)

    class_names = [d["class_name"] for d in detections]
    analyzer_step = session.analyzer.step(class_names, t)
    new_events = session.detector.update(t, session.frame_idx, class_names)
    if new_events:
        session.recent_events = (new_events + session.recent_events)[:10]

    render_adas_ui(
        frame,
        model_name=model_name,
        frame_idx=session.frame_idx,
        fps=infer_fps,
        detections=detections,
        state_history=session.state_history,
        fatigue_score=analyzer_step.fatigue_score,
        alert_level=analyzer_step.alert_level,
        hud_pos=hud_pos,
    )
    session.frame_idx += 1

    return FrameResult(
        bgr=frame,
        t=t,
        detections=detections,
        fatigue_score=analyzer_step.fatigue_score,
        alert_level=analyzer_step.alert_level,
        escalated=analyzer_step.escalated,
        new_events=new_events,
        infer_fps=infer_fps,
    )
