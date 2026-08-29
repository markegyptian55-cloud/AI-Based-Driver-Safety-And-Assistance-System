"""
utils/driver_state.py
---------------------
Turn per-frame detections into an overall driver state, using consecutive-frame
counters so a single noisy frame never triggers an alarm.

This module does NOT do any detection -- it only interprets the labels the
detector already produced, over time. Keeping it separate means you can tune
the "how long counts as drowsy" logic without touching the model.
"""

# model labels (must match config.MODEL_LABELS):
#   1 = closed_eye, 2 = open_eye, 3 = yawn
CLOSED_EYE, OPEN_EYE, YAWN = 1, 2, 3

# how many consecutive frames before we commit to a state
CLOSED_FRAMES_FOR_DROWSY = 15
YAWN_FRAMES_FOR_YAWNING = 12


class DriverStateMonitor:
    def __init__(self,
                 closed_frames=CLOSED_FRAMES_FOR_DROWSY,
                 yawn_frames=YAWN_FRAMES_FOR_YAWNING):
        self.closed_frames = closed_frames
        self.yawn_frames = yawn_frames
        self.closed_count = 0
        self.yawn_count = 0
        self.state = "NORMAL"

    def update(self, labels):
        """
        labels : iterable of model labels detected in the CURRENT frame.
        Returns the current smoothed state string.
        """
        present = [int(l) for l in labels]
        n_open = present.count(OPEN_EYE)
        n_closed = present.count(CLOSED_EYE)
        n_yawn = present.count(YAWN)

        # Eyes count as CLOSED this frame only if closed detections are the
        # dominant eye signal. A visible open eye means the driver is awake,
        # so it cancels a stray closed-eye box (avoids false DROWSY).
        eyes_closed = n_closed > 0 and n_closed > n_open

        # update consecutive counters (reset the moment the sign disappears)
        self.closed_count = self.closed_count + 1 if eyes_closed else 0
        self.yawn_count = self.yawn_count + 1 if n_yawn > 0 else 0

        # decide state (closed eyes = most critical, checked first)
        if self.closed_count >= self.closed_frames:
            self.state = "DROWSY / SLEEPING"
        elif self.yawn_count >= self.yawn_frames:
            self.state = "YAWNING"
        else:
            self.state = "NORMAL"
        return self.state


if __name__ == "__main__":
    m = DriverStateMonitor(closed_frames=5, yawn_frames=4)
    # 4 open frames (label 2) -> NORMAL
    for _ in range(4):
        assert m.update([OPEN_EYE]) == "NORMAL"
    # 5 closed frames (label 1) -> DROWSY
    for _ in range(5):
        s = m.update([CLOSED_EYE])
    assert s == "DROWSY / SLEEPING", s
    # eyes open again -> back to NORMAL immediately after counter resets
    assert m.update([OPEN_EYE]) == "NORMAL"
    # sustained yawning -> YAWNING
    for _ in range(4):
        s = m.update([YAWN])
    assert s == "YAWNING", s
    print("SELF-TEST PASSED")
