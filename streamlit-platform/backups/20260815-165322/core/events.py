"""
Micro-event detection: micro-blink / micro-sleep / full closure / yawn.

New in this platform -- the parent project measures per-frame detections and a
PERCLOS score, but never groups consecutive closed-eye frames into *events*
with durations. That grouping is what turns "the model saw a closed eye" into
"the driver had a 1.4-second microsleep", which is the clinically meaningful
unit and the thing a real ADAS logs.

DEFINITIONS (duration-based, drowsiness-research convention)
    micro_blink    < 0.30 s   normal blinking, informational
    micro_sleep    0.30-2.0 s the dangerous band -- driver is briefly gone
    full_closure   > 2.0 s    sustained closure, critical
    yawn           >= 0.50 s  separate tracker, suppresses single-frame flicker

TIME BASE
    Durations come from the caller's `t`, which for video is the true PyAV
    presentation timestamp. This matters: at 30 fps a 0.30 s micro-blink is
    exactly 9 frames, so a frame-count approximation would be systematically
    wrong on any clip that is not exactly 30 fps, and wrong everywhere on
    variable-frame-rate phone video.

BOUNDARIES
    Runs are half-open intervals [t_open, t_close). A run of n frames at 30 fps
    has duration n/30, so a 9-frame closure is exactly 0.30 s and classifies as
    micro_sleep (the comparison is `duration < blink_max`, strictly less).
    See tests/test_events.py -- this boundary is tested explicitly.

FALSE-POSITIVE GUARD
    A run must reach `min_run_frames` (default 2) consecutive detections before
    it is emitted at all. A single stray frame of `closed_eye` in an otherwise
    open-eyed sequence is detector noise, not a blink.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Literal

EventKind = Literal["micro_blink", "micro_sleep", "full_closure", "yawn"]
Severity = Literal["info", "warning", "critical"]

BLINK_MAX_S = 0.30
MICROSLEEP_MAX_S = 2.0
YAWN_MIN_S = 0.50
MIN_RUN_FRAMES = 2

# Tolerance for duration-boundary comparisons -- see _classify_closure.
_EPS_S = 1e-6


@dataclass(frozen=True)
class Event:
    kind: EventKind
    t_start: float
    t_end: float
    duration: float
    severity: Severity
    frame_start: int
    frame_end: int

    def as_dict(self) -> dict:
        return asdict(self)


class _Run:
    """An open, not-yet-closed run of consecutive frames matching one class."""

    __slots__ = ("t_start", "frame_start", "t_last", "frame_last", "n")

    def __init__(self, t: float, frame_idx: int) -> None:
        self.t_start = t
        self.frame_start = frame_idx
        self.t_last = t
        self.frame_last = frame_idx
        self.n = 1

    def extend(self, t: float, frame_idx: int) -> None:
        self.t_last = t
        self.frame_last = frame_idx
        self.n += 1


class MicroEventDetector:
    """Groups consecutive per-frame detections into duration-classified events."""

    def __init__(
        self,
        min_run_frames: int = MIN_RUN_FRAMES,
        blink_max: float = BLINK_MAX_S,
        microsleep_max: float = MICROSLEEP_MAX_S,
        yawn_min: float = YAWN_MIN_S,
    ) -> None:
        self.min_run_frames = min_run_frames
        self.blink_max = blink_max
        self.microsleep_max = microsleep_max
        self.yawn_min = yawn_min

        self._closed_run: _Run | None = None
        self._yawn_run: _Run | None = None
        self._last_t: float = 0.0
        self._last_frame: int = 0
        self.events: list[Event] = []

    # -- classification ---------------------------------------------------

    def _classify_closure(self, duration: float) -> tuple[EventKind, Severity]:
        # Epsilon-tolerant boundaries. Timestamps accumulate float error (a
        # 9-frame run at 30fps computes as 0.29999999999999993, not 0.3), so a
        # bare `<` would classify a genuine 0.30s micro-sleep as a blink. 1us is
        # far below any physiologically meaningful distinction.
        if duration < self.blink_max - _EPS_S:
            return "micro_blink", "info"
        if duration <= self.microsleep_max + _EPS_S:
            return "micro_sleep", "warning"
        return "full_closure", "critical"

    def _close_run(self, run: _Run, t_close: float, frame_close: int, is_yawn: bool) -> Event | None:
        if run.n < self.min_run_frames:
            return None
        duration = max(0.0, t_close - run.t_start)
        if is_yawn:
            if duration < self.yawn_min - _EPS_S:
                return None
            kind: EventKind = "yawn"
            severity: Severity = "warning"
        else:
            kind, severity = self._classify_closure(duration)
        return Event(
            kind=kind,
            t_start=run.t_start,
            t_end=t_close,
            duration=duration,
            severity=severity,
            frame_start=run.frame_start,
            frame_end=frame_close,
        )

    # -- per-frame --------------------------------------------------------

    def update(self, t: float, frame_idx: int, class_names: list[str]) -> list[Event]:
        """Feed one frame. Returns any events that CLOSED on this frame."""
        self._last_t = t
        self._last_frame = frame_idx
        emitted: list[Event] = []

        closed_now = "closed_eye" in class_names
        yawn_now = "yawning" in class_names

        # closure run
        if closed_now:
            if self._closed_run is None:
                self._closed_run = _Run(t, frame_idx)
            else:
                self._closed_run.extend(t, frame_idx)
        elif self._closed_run is not None:
            ev = self._close_run(self._closed_run, t, frame_idx, is_yawn=False)
            self._closed_run = None
            if ev:
                emitted.append(ev)

        # yawn run
        if yawn_now:
            if self._yawn_run is None:
                self._yawn_run = _Run(t, frame_idx)
            else:
                self._yawn_run.extend(t, frame_idx)
        elif self._yawn_run is not None:
            ev = self._close_run(self._yawn_run, t, frame_idx, is_yawn=True)
            self._yawn_run = None
            if ev:
                emitted.append(ev)

        self.events.extend(emitted)
        return emitted

    def flush(self, t_end: float | None = None) -> list[Event]:
        """Close any runs still open at end of stream. Call once after the last frame."""
        t_close = self._last_t if t_end is None else t_end
        emitted: list[Event] = []
        for run, is_yawn in ((self._closed_run, False), (self._yawn_run, True)):
            if run is not None:
                ev = self._close_run(run, t_close, self._last_frame, is_yawn=is_yawn)
                if ev:
                    emitted.append(ev)
        self._closed_run = None
        self._yawn_run = None
        self.events.extend(emitted)
        return emitted

    # -- summary ----------------------------------------------------------

    def counts(self) -> dict[str, int]:
        out = {"micro_blink": 0, "micro_sleep": 0, "full_closure": 0, "yawn": 0}
        for e in self.events:
            out[e.kind] = out.get(e.kind, 0) + 1
        return out

    def longest_closure(self) -> float:
        closures = [e.duration for e in self.events
                    if e.kind in ("micro_blink", "micro_sleep", "full_closure")]
        return max(closures) if closures else 0.0

    def reset(self) -> None:
        self._closed_run = None
        self._yawn_run = None
        self.events.clear()
