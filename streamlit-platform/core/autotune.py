"""
Per-model inference batch-size auto-tuning.

WHY THIS EXISTS
===============
Batching inference is normally assumed to be a straightforward speed win.
On this platform it measurably is not, and the direction of the effect
depends on the model:

    yolo26n @480   batch 1 -> 7.70 ms/frame   batch 8 -> 2.33 ms/frame   3.31x FASTER
    yolo26n @960   batch 1 -> 10.67 ms/frame  batch 8 -> 9.88 ms/frame   1.08x
    yolo11m @640   batch 1 -> 12.31 ms/frame  batch 8 -> 13.88 ms/frame  0.89x SLOWER

The reason is that a small model at low resolution does not saturate the
GPU at batch 1 -- its per-frame time is dominated by fixed kernel-launch
overhead, which batching amortises. A larger model, or the same model at
higher resolution, is already compute-bound, so batching adds memory
pressure and scheduling cost without anything to amortise.

A single hard-coded batch size would therefore speed up some models and
slow down others. Rather than guess a heuristic from three data points,
this module measures the actual machine: it times a short sweep per model
and records the batch size that was fastest, cached to disk so the cost
is paid once.

Results are keyed by model AND by GPU name, because the optimum is a
property of the hardware as much as the model -- a cache copied to a
different machine must not be trusted.
"""

from __future__ import annotations

import json
import statistics
import time
from pathlib import Path
from typing import Any

import numpy as np

PLATFORM_ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = PLATFORM_ROOT / "models" / "autotune.json"

# Powers of two only: intermediate sizes showed no distinct optimum in the
# measured sweeps, and every extra candidate costs tuning time the user waits
# through.
CANDIDATES = (1, 2, 4, 8)

# Below this relative gain, stay at batch 1. A 5 % difference is inside the
# run-to-run noise observed on an otherwise-busy desktop, and switching to
# batched inference for a benefit that small adds latency to the live preview
# (frames arrive in groups rather than singly) for no real throughput return.
MIN_GAIN = 1.05


def _device_key() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except Exception:
        pass
    return "cpu"


def _sync():
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.synchronize()
    except Exception:
        pass


def load_cache() -> dict[str, Any]:
    if not CACHE_PATH.exists():
        return {}
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_cache(cache: dict[str, Any]) -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(cache, indent=2), encoding="utf-8")
    except Exception:
        pass


def cached_batch(model_key: str) -> int | None:
    """Tuned batch size for this model on THIS device, or None if untuned."""
    entry = load_cache().get(model_key)
    if not isinstance(entry, dict):
        return None
    if entry.get("device") != _device_key():
        return None
    b = entry.get("batch")
    return int(b) if isinstance(b, int) and b >= 1 else None


def tune_model(model, model_key: str, imgsz: int, family: str = "yolo",
               reps: int = 8, warmup: int = 3) -> dict[str, Any]:
    """Time a batch sweep for one model and cache the winner.

    RF-DETR is not swept: its predict() takes a single PIL image, so there
    is no batched path to measure. It is recorded as batch 1 rather than
    left absent, so the UI can distinguish "measured, no batching possible"
    from "not yet tuned".
    """
    device = _device_key()

    if family != "yolo" or device == "cpu":
        # CPU inference is compute-bound by construction -- there is no launch
        # overhead to amortise, so batching cannot produce the effect this
        # tuner exists to exploit.
        result = {"batch": 1, "device": device, "reason":
                  "rfdetr (no batched API)" if family != "yolo" else "cpu",
                  "timings": {}}
        cache = load_cache()
        cache[model_key] = result
        save_cache(cache)
        return result

    dummy = np.zeros((imgsz, imgsz, 3), dtype=np.uint8)
    timings: dict[str, float] = {}

    for b in CANDIDATES:
        batch = [dummy] * b
        try:
            for _ in range(warmup):
                model.predict(source=batch, imgsz=imgsz, verbose=False)
            _sync()
            samples = []
            for _ in range(reps):
                _sync()
                t0 = time.perf_counter()
                model.predict(source=batch, imgsz=imgsz, verbose=False)
                _sync()
                samples.append((time.perf_counter() - t0) * 1000.0 / b)
            timings[str(b)] = round(statistics.median(samples), 3)
        except Exception:
            # Out of memory at this batch size is a legitimate answer, not a
            # failure: record nothing and let a smaller batch win.
            break

    if not timings:
        result = {"batch": 1, "device": device, "reason": "sweep failed",
                  "timings": {}}
    else:
        base = timings.get("1")
        best_b = min(timings, key=lambda k: timings[k])
        # Only adopt a larger batch if it clears the noise floor.
        if base and timings[best_b] > 0 and base / timings[best_b] < MIN_GAIN:
            best_b = "1"
        result = {
            "batch": int(best_b),
            "device": device,
            "reason": "measured",
            "timings": timings,
            "gain_vs_batch1": (round(base / timings[best_b], 3)
                               if base and timings[best_b] else 1.0),
        }

    cache = load_cache()
    cache[model_key] = result
    save_cache(cache)
    return result
