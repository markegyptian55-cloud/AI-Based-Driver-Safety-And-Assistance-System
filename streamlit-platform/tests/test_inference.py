"""
Tests for the batched-inference path and the batch auto-tuner.

The property that matters here is not speed but EQUIVALENCE: batching
changes only how the inference call is grouped, and must not change a
single detection, fatigue score or micro-event. The fatigue analyser and
the micro-event detector are sequential state machines, so a batching bug
that reorders or misaligns frames would not raise -- it would silently
shift event timings, which is exactly the measurement this platform
exists to produce. These tests pin that equivalence.

They run without a GPU and without Streamlit's runtime, using a stub
model, so they stay fast and are safe in CI. The one test that needs a
real checkpoint skips itself when none is present.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

PLATFORM_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PLATFORM_ROOT))

from core.detect import predict_batch  # noqa: E402


class _StubResult:
    """Minimal stand-in for an Ultralytics Results object."""

    class _Boxes:
        def __init__(self, marker: int):
            self._marker = marker

        def __len__(self):
            return 1

        @property
        def cls(self):
            return [_Scalar(0)]

        @property
        def conf(self):
            return [_Scalar(0.9)]

        @property
        def xyxy(self):
            return [_Tensor([self._marker, 0, self._marker + 1, 1])]

    def __init__(self, marker: int):
        self.boxes = self._Boxes(marker)


class _Scalar:
    def __init__(self, v):
        self._v = v

    def item(self):
        return self._v


class _Tensor:
    def __init__(self, vals):
        self._vals = vals

    def cpu(self):
        return self

    def tolist(self):
        return self._vals


class _StubModel:
    """Returns one detection per input, tagged with that input's own value.

    This makes reordering detectable: if the batch is shuffled, the marker
    carried back will not match the frame it was produced from.
    """

    def __init__(self):
        self.calls: list[int] = []

    def predict(self, source=None, **kwargs):
        frames = source if isinstance(source, list) else [source]
        self.calls.append(len(frames))
        return [_StubResult(int(f[0, 0, 0])) for f in frames]


def _frame(marker: int) -> np.ndarray:
    f = np.zeros((4, 4, 3), dtype=np.uint8)
    f[0, 0, 0] = marker
    return f


def test_predict_batch_preserves_order():
    model = _StubModel()
    frames = [_frame(i) for i in (3, 1, 4, 1, 5)]
    out = predict_batch(model, frames, conf=0.35, imgsz=64)

    assert len(out) == len(frames)
    # Each frame's detection must carry that frame's own marker, in order.
    markers = [dets[0]["x1"] for dets in out]
    assert markers == [3, 1, 4, 1, 5]


def test_predict_batch_single_call():
    """A batch must be ONE inference call, not a loop -- that is the point."""
    model = _StubModel()
    predict_batch(model, [_frame(i) for i in range(8)], conf=0.35, imgsz=64)
    assert model.calls == [8]


def test_predict_batch_empty():
    assert predict_batch(_StubModel(), [], conf=0.35, imgsz=64) == []


def test_batching_matches_unbatched():
    """Grouping must not change results, at any batch size."""
    frames = [_frame(i) for i in range(10)]
    reference = [
        predict_batch(_StubModel(), [f], conf=0.35, imgsz=64)[0] for f in frames
    ]
    for size in (2, 3, 5, 10):
        model = _StubModel()
        got: list = []
        for i in range(0, len(frames), size):
            got.extend(predict_batch(model, frames[i:i + size], conf=0.35, imgsz=64))
        assert got == reference, f"batch size {size} changed the result"


def test_rfdetr_falls_back_to_per_frame():
    """RF-DETR has no batched predict(); it must degrade, not crash."""

    class _RFStub:
        def __init__(self):
            self.calls = 0

        def predict(self, img, threshold=None):
            self.calls += 1
            return None  # extract_rfdetr_detections handles None -> []

    model = _RFStub()
    out = predict_batch(model, [_frame(i) for i in range(4)],
                        conf=0.35, imgsz=64, family="rfdetr")
    assert len(out) == 4
    assert model.calls == 4


# ------------------------------------------------------------------ autotune


def test_autotune_cache_roundtrip(tmp_path, monkeypatch):
    from core import autotune

    monkeypatch.setattr(autotune, "CACHE_PATH", tmp_path / "autotune.json")
    autotune.save_cache({"m": {"batch": 4, "device": autotune._device_key()}})
    assert autotune.cached_batch("m") == 4


def test_autotune_ignores_other_device(tmp_path, monkeypatch):
    """A cache copied from another machine must not be trusted."""
    from core import autotune

    monkeypatch.setattr(autotune, "CACHE_PATH", tmp_path / "autotune.json")
    autotune.save_cache({"m": {"batch": 8, "device": "some other GPU"}})
    assert autotune.cached_batch("m") is None


def test_autotune_unknown_model(tmp_path, monkeypatch):
    from core import autotune

    monkeypatch.setattr(autotune, "CACHE_PATH", tmp_path / "autotune.json")
    assert autotune.cached_batch("never-tuned") is None


def test_autotune_rfdetr_records_batch_one(tmp_path, monkeypatch):
    """RF-DETR must be recorded as batch 1, not left absent."""
    from core import autotune

    monkeypatch.setattr(autotune, "CACHE_PATH", tmp_path / "autotune.json")
    res = autotune.tune_model(object(), "rf", 384, family="rfdetr")
    assert res["batch"] == 1
    assert "rfdetr" in res["reason"]


# ------------------------------------------------------------------ registry


def test_registry_metrics_match_source():
    """Every card's accuracy must equal the evaluation it claims to report.

    This exists because a card once advertised 88.65 % -- its peak
    VALIDATION mAP, picked up by a fallback that mislabelled itself as a
    test measurement -- while its real test score was 83.11 %. It ranked
    first in the picker on a number that was never measured on the test
    split.
    """
    import json

    from core.registry import load_registry

    info = Path(r"C:\ssd projects\nano big\INFO")
    if not info.exists():
        pytest.skip("parent project INFO/ not available")

    truth = {}
    for mj in info.glob("*/*-test-result/tested-images/metrics.json"):
        d = json.loads(mj.read_text(encoding="utf-8"))
        truth[d["model_key"]] = d

    alias = {
        "yolo11m-1-warmstart": "yolo11m-warmstart-pilot-640",
        "yolo11n-1-capacity": "yolo11n-capacity-960",
    }

    entries, _ = load_registry()
    if not entries:
        pytest.skip("no models registered")

    mismatched = []
    for key, entry in entries.items():
        src = truth.get(key) or truth.get(alias.get(key, ""))
        if src is None:
            continue
        claimed = entry.map50_corrected
        actual = src.get("map50_corrected")
        if claimed is None or actual is None:
            continue
        if abs(claimed - actual) > 1e-4:
            mismatched.append((key, claimed, actual))

    assert not mismatched, f"card metrics disagree with evaluation: {mismatched}"


# ------------------------------------------------------------------ retention


def _mk_run(d: Path, run_id: str, mtime: float) -> list[Path]:
    import os
    made = []
    for suffix in ("annotated", "raw"):
        f = d / f"{run_id}_{suffix}.mp4"
        f.write_bytes(b"x" * 100)
        os.utime(f, (mtime, mtime))
        made.append(f)
    return made


def test_retention_keeps_newest_runs(tmp_path):
    from core.retention import prune_outputs

    for i in range(10):
        _mk_run(tmp_path, f"run{i:02d}", 1_000_000 + i * 60)

    runs, freed = prune_outputs(tmp_path, keep_runs=3)

    assert runs == 7
    assert freed == 7 * 2 * 100
    remaining = sorted({p.name.split("_", 1)[0] for p in tmp_path.glob("*.mp4")})
    assert remaining == ["run07", "run08", "run09"]


def test_retention_deletes_runs_whole(tmp_path):
    """Both files of a run go together -- half a run is worse than none."""
    from core.retention import prune_outputs

    for i in range(5):
        _mk_run(tmp_path, f"r{i}", 1_000_000 + i * 60)
    prune_outputs(tmp_path, keep_runs=2)

    by_run: dict[str, int] = {}
    for p in tmp_path.glob("*.mp4"):
        by_run[p.name.split("_", 1)[0]] = by_run.get(p.name.split("_", 1)[0], 0) + 1
    assert all(n == 2 for n in by_run.values()), by_run


def test_retention_protects_named_runs(tmp_path):
    """A run the user is still viewing must survive regardless of age."""
    from core.retention import prune_outputs

    for i in range(8):
        _mk_run(tmp_path, f"p{i}", 1_000_000 + i * 60)
    prune_outputs(tmp_path, keep_runs=2, protect={"p0"})

    survivors = {p.name.split("_", 1)[0] for p in tmp_path.glob("*.mp4")}
    assert "p0" in survivors, "protected run was deleted"


def test_retention_missing_dir_is_safe(tmp_path):
    from core.retention import prune_outputs

    assert prune_outputs(tmp_path / "does-not-exist") == (0, 0)


def test_retention_empty_dir_is_safe(tmp_path):
    from core.retention import prune_outputs

    assert prune_outputs(tmp_path) == (0, 0)
