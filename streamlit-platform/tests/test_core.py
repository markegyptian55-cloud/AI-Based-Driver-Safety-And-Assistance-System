"""
Core logic tests. Run:  python tests/test_core.py

Two things are worth testing here and nothing else is:

1. PERCLOS PARITY -- `FatigueAnalyzer` deviates from the parent project's
   `DrownsinessAnalyzer` on purpose (instance thresholds, injected clock), but
   the *scoring maths* must be bit-identical or this platform reports different
   numbers than the project's own experiments. This test pins that.

2. EVENT BOUNDARIES -- micro_blink/micro_sleep/full_closure are separated by
   exact duration cutoffs, and the half-open-interval convention means a
   9-frame closure at 30fps is exactly 0.30s. Off-by-one here silently
   reclassifies real events, so the boundaries are tested explicitly.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.analyzer import FatigueAnalyzer
from core.events import MicroEventDetector

FAILURES: list[str] = []


def check(name: str, got, expected) -> None:
    if got == expected:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}: got {got!r}, expected {expected!r}")
        FAILURES.append(name)


def approx(name: str, got: float, expected: float, tol: float = 1e-9) -> None:
    if abs(got - expected) <= tol:
        print(f"  PASS  {name}  ({got:.6f})")
    else:
        print(f"  FAIL  {name}: got {got!r}, expected {expected!r}")
        FAILURES.append(name)


# ---------------------------------------------------------------- PERCLOS

def reference_score(history: list[list[str]]) -> float:
    """Upstream `DrownsinessAnalyzer.fatigue_score()`, transcribed verbatim
    from src/inference.py so parity is checked against the real formula
    rather than against our own restatement of it."""
    if not history:
        return 0.0
    total = 0.0
    for frame_classes in history:
        if "closed_eye" in frame_classes:
            total += 0.70
        elif "yawning" in frame_classes:
            total += 0.30
    return min(total / len(history), 1.0)


def test_perclos_parity() -> None:
    print("\nPERCLOS parity vs src/inference.py")
    sequences = [
        [],
        [["open_eye"]],
        [["closed_eye"]],
        [["yawning"]],
        [["closed_eye", "yawning"]],                    # first-match-wins -> 0.70 not 1.00
        [["open_eye"], ["closed_eye"], ["yawning"], []],
        [["closed_eye"]] * 30,                          # saturated
        [["closed_eye"], ["open_eye"]] * 15,
        [["yawning"], []] * 10,
    ]
    for i, seq in enumerate(sequences):
        a = FatigueAnalyzer(window_size=30)
        for frame in seq:
            a.update(frame)
        approx(f"sequence {i} (n={len(seq)})", a.fatigue_score(), reference_score(seq))

    # window truncation must match: only the last N frames count
    a = FatigueAnalyzer(window_size=5)
    for _ in range(10):
        a.update(["closed_eye"])
    for _ in range(5):
        a.update(["open_eye"])
    approx("window truncation", a.fatigue_score(), 0.0)

    # both-classes-in-one-frame is 0.70, never 1.00
    a = FatigueAnalyzer(window_size=1)
    a.update(["closed_eye", "yawning"])
    approx("closed+yawn same frame", a.fatigue_score(), 0.70)


def test_alert_uses_injected_clock() -> None:
    """The whole point of the rewrite: CRITICAL must depend on the supplied
    time, not on how fast the machine runs."""
    print("\nAlert escalation uses injected clock")

    a = FatigueAnalyzer(window_size=4, critical_hold_seconds=1.5)
    # saturate above the 0.65 critical threshold
    for i in range(4):
        s = a.step(["closed_eye"], t=i * 0.1)
    check("above threshold but hold not met -> WARNING", s.alert_level, "WARNING")

    s = a.step(["closed_eye"], t=2.0)   # 2.0s since first critical frame
    check("hold satisfied -> CRITICAL", s.alert_level, "CRITICAL")

    # dropping below threshold resets the hold timer
    for i in range(4):
        s = a.step(["open_eye"], t=3.0 + i * 0.1)
    check("recovered -> SAFE", s.alert_level, "SAFE")

    # Escalation flag. window_size=1 so a single closed frame saturates the
    # score to 0.70 (above the 0.65 critical threshold); with window_size=2 it
    # would be 0.35, below even the warning threshold, and correctly stay SAFE.
    a2 = FatigueAnalyzer(window_size=1, critical_hold_seconds=0.0)
    s = a2.step(["open_eye"], t=0.0)
    check("baseline SAFE", s.alert_level, "SAFE")
    s = a2.step(["closed_eye"], t=0.1)
    check("escalation detected", s.escalated, True)
    check("  escalated to CRITICAL", s.alert_level, "CRITICAL")
    s = a2.step(["closed_eye"], t=0.2)
    check("no re-escalation at same level", s.escalated, False)


# ----------------------------------------------------------------- events

def run_closure(n_frames: int, fps: float = 30.0, pad: int = 3) -> list:
    """`pad` open frames, then `n_frames` closed, then open again to close the
    run. Returns the emitted events."""
    d = MicroEventDetector()
    idx = 0
    t = 0.0
    step = 1.0 / fps
    for _ in range(pad):
        d.update(t, idx, ["open_eye"]); idx += 1; t += step
    for _ in range(n_frames):
        d.update(t, idx, ["closed_eye"]); idx += 1; t += step
    d.update(t, idx, ["open_eye"])
    return d.events


def test_event_boundaries() -> None:
    print("\nMicro-event duration boundaries (30 fps)")

    # 1 frame = below min_run_frames -> suppressed entirely (detector noise)
    check("1 frame closure suppressed", len(run_closure(1)), 0)

    # 8 frames = 0.2667s -> micro_blink
    ev = run_closure(8)
    check("8 frames (0.267s) -> micro_blink", ev[0].kind if ev else None, "micro_blink")

    # 9 frames = exactly 0.30s -> NOT less than blink_max -> micro_sleep
    ev = run_closure(9)
    check("9 frames (exactly 0.300s) -> micro_sleep", ev[0].kind if ev else None, "micro_sleep")
    approx("  its duration", ev[0].duration, 9 / 30.0, tol=1e-6)

    # 60 frames = exactly 2.0s -> still micro_sleep (<= microsleep_max)
    ev = run_closure(60)
    check("60 frames (exactly 2.000s) -> micro_sleep", ev[0].kind if ev else None, "micro_sleep")

    # 61 frames = 2.033s -> full_closure
    ev = run_closure(61)
    check("61 frames (2.033s) -> full_closure", ev[0].kind if ev else None, "full_closure")

    # severities
    check("micro_blink severity", run_closure(8)[0].severity, "info")
    check("micro_sleep severity", run_closure(9)[0].severity, "warning")
    check("full_closure severity", run_closure(61)[0].severity, "critical")


def test_event_flush_and_yawn() -> None:
    print("\nEvent flush + yawn tracker")

    # a run still open at end of stream must be emitted by flush()
    d = MicroEventDetector()
    for i in range(20):
        d.update(i / 30.0, i, ["closed_eye"])
    check("open run not yet emitted", len(d.events), 0)
    d.flush()
    check("flush emits the open run", len(d.events), 1)

    # short yawn suppressed, long yawn kept
    d = MicroEventDetector()
    for i in range(5):                      # 5 frames = 0.167s < 0.5s minimum
        d.update(i / 30.0, i, ["yawning"])
    d.update(5 / 30.0, 5, ["open_eye"])
    check("short yawn suppressed", len(d.events), 0)

    d = MicroEventDetector()
    for i in range(30):                     # 30 frames = 1.0s
        d.update(i / 30.0, i, ["yawning"])
    d.update(1.0, 30, ["open_eye"])
    check("long yawn kept", [e.kind for e in d.events], ["yawn"])

    # variable frame rate: durations come from t, not frame count
    d = MicroEventDetector()
    d.update(0.0, 0, ["closed_eye"])
    d.update(0.5, 1, ["closed_eye"])
    d.update(1.4, 2, ["closed_eye"])
    d.update(3.5, 3, ["open_eye"])          # closes at t=3.5 -> duration 3.5s
    check("VFR duration from timestamps", d.events[0].kind, "full_closure")
    approx("  VFR duration", d.events[0].duration, 3.5)


def test_counts() -> None:
    print("\nSummary helpers")
    d = MicroEventDetector()
    idx, t, step = 0, 0.0, 1.0 / 30
    for n in (8, 9, 61):                    # blink, microsleep, closure
        for _ in range(n):
            d.update(t, idx, ["closed_eye"]); idx += 1; t += step
        for _ in range(3):
            d.update(t, idx, ["open_eye"]); idx += 1; t += step
    c = d.counts()
    check("counts", (c["micro_blink"], c["micro_sleep"], c["full_closure"]), (1, 1, 1))
    approx("longest closure", d.longest_closure(), 61 / 30.0, tol=1e-6)


if __name__ == "__main__":
    test_perclos_parity()
    test_alert_uses_injected_clock()
    test_event_boundaries()
    test_event_flush_and_yawn()
    test_counts()

    print("\n" + "=" * 60)
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S): {', '.join(FAILURES)}")
        sys.exit(1)
    print("All core tests passed.")
