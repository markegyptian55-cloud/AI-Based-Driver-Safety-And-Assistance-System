"""
PERCLOS-based fatigue analysis.

PROVENANCE
==========
Rewritten 2026-08-14 from `src/inference.py::DrownsinessAnalyzer` (note the
upstream typo -- an extra 'n'; corrected here since this is our own file).

The scoring maths is IDENTICAL to upstream and must stay that way, so numbers
reproduce the parent project:
    - rolling window of the last N frames' detected class-name lists
    - closed_eye contributes 0.70 per frame
    - elif yawning contributes 0.30 per frame   (first-match-wins: a frame with
      BOTH closed_eye and yawning scores 0.70, not 1.00)
    - open_eye contributes 0.0
    - score = min(total / len(history), 1.0)
    - WARNING at >= 0.40, CRITICAL at >= 0.65 sustained for >= 1.5s

DEVIATIONS FROM UPSTREAM (three, all deliberate)
------------------------------------------------
1. THRESHOLDS ARE INSTANCE ATTRIBUTES.
   Upstream reads module globals FATIGUE_WARNING_THRESHOLD /
   FATIGUE_CRITICAL_THRESHOLD directly inside `alert_level()`, despite a
   docstring claiming they are constructor args. That makes per-session UI
   sliders impossible without monkeypatching a shared module -- which would
   leak one browser session's settings into another. Here they are per-instance.

2. TIME IS INJECTED, NOT READ FROM THE WALL CLOCK.
   Upstream's `alert_level()` calls `time.monotonic()`. The CRITICAL escalation
   requires the score to stay above threshold for 1.5 *seconds*, so on offline
   video the result depends on how fast the machine processes frames rather
   than on what the driver did: a GPU chewing through a clip at 5x real-time
   escalates far too readily, and a slow CPU may never escalate at all. Here
   `step()` takes an explicit `t`. Video mode passes the PyAV presentation
   timestamp (true video seconds); webcam mode passes `time.monotonic()`.
   Same class, clock chosen by the caller.

3. `step()` REPLACES THE update/score/alert CALL TRIO.
   Upstream's `alert_level()` is not a pure getter -- it mutates
   `_critical_since`. Calling it twice per frame, or not at all, silently
   changes behaviour. `step()` performs the whole per-frame transaction exactly
   once and returns everything the caller needs.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

# Upstream defaults, preserved.
DEFAULT_WINDOW = 30
DEFAULT_WARNING_THRESHOLD = 0.40
DEFAULT_CRITICAL_THRESHOLD = 0.65
DEFAULT_CRITICAL_HOLD_S = 1.5

WEIGHT_CLOSED_EYE = 0.70
WEIGHT_YAWNING = 0.30

ALERT_SAFE = "SAFE"
ALERT_WARNING = "WARNING"
ALERT_CRITICAL = "CRITICAL"

_LEVEL_RANK = {ALERT_SAFE: 0, ALERT_WARNING: 1, ALERT_CRITICAL: 2}


@dataclass(frozen=True)
class AnalyzerStep:
    """Everything one frame of analysis produced."""
    t: float
    fatigue_score: float
    alert_level: str
    escalated: bool          # level went UP vs the previous frame
    previous_level: str


class FatigueAnalyzer:
    """PERCLOS rolling-window fatigue analyzer with an injected clock."""

    ALERT_SAFE = ALERT_SAFE
    ALERT_WARNING = ALERT_WARNING
    ALERT_CRITICAL = ALERT_CRITICAL

    def __init__(
        self,
        window_size: int = DEFAULT_WINDOW,
        warning_threshold: float = DEFAULT_WARNING_THRESHOLD,
        critical_threshold: float = DEFAULT_CRITICAL_THRESHOLD,
        critical_hold_seconds: float = DEFAULT_CRITICAL_HOLD_S,
    ) -> None:
        if window_size < 1:
            raise ValueError("window_size must be >= 1")
        self.window_size = window_size
        self.warning_threshold = warning_threshold
        self.critical_threshold = critical_threshold
        self.critical_hold_seconds = critical_hold_seconds

        self._history: deque[list[str]] = deque(maxlen=window_size)
        self._critical_since: float | None = None
        self._last_level: str = ALERT_SAFE

    # -- core -------------------------------------------------------------

    def update(self, classes_found: list[str]) -> None:
        """Push one frame's detected class names into the rolling window."""
        self._history.append(list(classes_found))

    def fatigue_score(self) -> float:
        """PERCLOS score in [0, 1]. Identical maths to upstream.

        Note the divisor is len(history), not window_size -- so the score is
        'hot' during the first frames before the window fills. Preserved
        deliberately: changing it would make this platform's numbers disagree
        with the parent project's.
        """
        if not self._history:
            return 0.0
        total = 0.0
        for frame_classes in self._history:
            if "closed_eye" in frame_classes:
                total += WEIGHT_CLOSED_EYE
            elif "yawning" in frame_classes:
                total += WEIGHT_YAWNING
        return min(total / len(self._history), 1.0)

    def _alert_level(self, score: float, t: float) -> str:
        """Alert level, with the sustained-hold gate driven by `t`."""
        if score >= self.critical_threshold:
            if self._critical_since is None:
                self._critical_since = t
            elapsed = t - self._critical_since
            return ALERT_CRITICAL if elapsed >= self.critical_hold_seconds else ALERT_WARNING
        self._critical_since = None
        if score >= self.warning_threshold:
            return ALERT_WARNING
        return ALERT_SAFE

    def step(self, classes_found: list[str], t: float) -> AnalyzerStep:
        """One frame's complete analysis transaction. Call exactly once per frame.

        `t` is seconds on whatever clock the caller owns:
          - offline video -> PyAV presentation timestamp
          - live webcam   -> time.monotonic()
        """
        self.update(classes_found)
        score = self.fatigue_score()
        level = self._alert_level(score, t)
        previous = self._last_level
        self._last_level = level
        return AnalyzerStep(
            t=t,
            fatigue_score=score,
            alert_level=level,
            escalated=_LEVEL_RANK[level] > _LEVEL_RANK[previous],
            previous_level=previous,
        )

    def reset(self) -> None:
        self._history.clear()
        self._critical_since = None
        self._last_level = ALERT_SAFE
