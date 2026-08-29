"""
Alert cue synthesis -- WAV bytes generated with numpy, no asset files.

WHY SYNTHESIZED RATHER THAN SHIPPED AS FILES
============================================
The platform must run fully offline on a machine that has never seen it, and a
strict no-CDN rule applies. Generating the cues from numpy means there are no
binary assets to lose, no licences to track, and no network fetch that could
silently fail and leave the alert system mute. Each cue is 15-50 KB, small
enough to base64-inline into the player iframe.

CUE DESIGN
    warning       660 -> 880 Hz double blip, 220 ms   -- attention, not alarm
    critical      880/1100 Hz alternating, 4 pulses   -- unmistakable, 1.2 s
    microsleep    520 Hz single tone, 300 ms          -- distinct event marker
    full_closure  200 Hz saw pulse train              -- low, urgent, different
                                                         timbre so it is
                                                         distinguishable from
                                                         `critical` without
                                                         looking at the screen

Envelopes matter: a raw sine that starts at full amplitude clicks audibly on
every platform. Each tone gets a short attack and a longer release.
"""

from __future__ import annotations

import base64
import io
import wave
from functools import lru_cache
from typing import Literal

import numpy as np

CueKind = Literal["warning", "critical", "microsleep", "full_closure", "test"]

SAMPLE_RATE = 22050


def _envelope(n: int, sr: int, attack_ms: float = 8.0, release_ms: float = 40.0) -> np.ndarray:
    env = np.ones(n, dtype=np.float64)
    a = min(int(sr * attack_ms / 1000.0), n // 2)
    r = min(int(sr * release_ms / 1000.0), n // 2)
    if a > 0:
        env[:a] = np.linspace(0.0, 1.0, a)
    if r > 0:
        env[-r:] = np.linspace(1.0, 0.0, r)
    return env


def _tone(freq: float, ms: float, sr: int = SAMPLE_RATE, amp: float = 0.5,
          shape: str = "sine") -> np.ndarray:
    n = max(1, int(sr * ms / 1000.0))
    t = np.arange(n) / sr
    phase = 2.0 * np.pi * freq * t
    if shape == "square":
        wave_ = np.sign(np.sin(phase))
    elif shape == "saw":
        wave_ = 2.0 * ((freq * t) % 1.0) - 1.0
    else:
        wave_ = np.sin(phase)
    return amp * wave_ * _envelope(n, sr)


def _silence(ms: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    return np.zeros(max(1, int(sr * ms / 1000.0)), dtype=np.float64)


def _to_wav_bytes(signal: np.ndarray, sr: int = SAMPLE_RATE) -> bytes:
    peak = float(np.max(np.abs(signal))) or 1.0
    pcm = np.clip(signal / peak * 0.85, -1.0, 1.0)
    pcm16 = (pcm * 32767.0).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm16.tobytes())
    return buf.getvalue()


def _build(kind: CueKind) -> np.ndarray:
    if kind == "warning":
        return np.concatenate([
            _tone(660, 90), _silence(45), _tone(880, 110),
        ])
    if kind == "critical":
        parts: list[np.ndarray] = []
        for i in range(4):
            parts.append(_tone(880 if i % 2 == 0 else 1100, 130, amp=0.6, shape="square"))
            parts.append(_silence(45))
        return np.concatenate(parts)
    if kind == "microsleep":
        return _tone(520, 300, amp=0.45)
    if kind == "full_closure":
        parts = []
        for _ in range(5):
            parts.append(_tone(200, 140, amp=0.6, shape="saw"))
            parts.append(_silence(60))
        return np.concatenate(parts)
    # test
    return np.concatenate([_tone(440, 120), _silence(40), _tone(660, 160)])


@lru_cache(maxsize=16)
def cue_bytes(kind: CueKind) -> bytes:
    """WAV bytes for a cue. Cached -- synthesis is cheap but not free."""
    return _to_wav_bytes(_build(kind))


@lru_cache(maxsize=16)
def cue_data_uri(kind: CueKind) -> str:
    """`data:audio/wav;base64,...` for embedding in an <audio> element."""
    return "data:audio/wav;base64," + base64.b64encode(cue_bytes(kind)).decode("ascii")


def cue_for_event(kind: str) -> CueKind | None:
    """Map a micro-event kind to its cue. Blinks are normal -- no sound."""
    return {
        "micro_sleep": "microsleep",
        "full_closure": "full_closure",
        "yawn": "warning",
    }.get(kind)


def cue_for_level(level: str) -> CueKind | None:
    return {"WARNING": "warning", "CRITICAL": "critical"}.get(level)
