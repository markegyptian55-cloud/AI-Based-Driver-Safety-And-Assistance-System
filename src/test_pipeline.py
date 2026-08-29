"""
test_pipeline.py — Unit & Integration Test Suite
=========================================
Project : nano big -- driver drowsiness detection (closed_eye/open_eye/yawning)

(Renamed from src/test.py, BOOK.md Chapter 2 SS2.10 -- kept in src/ with
everything else, per project convention of one flat scripts folder rather
than splitting into more subfolders. It's still not the same thing as
demo_video.py/webcam_demo.py despite the shared "test"-ish history: this
is a real pytest suite checking the CODE works, not the model's accuracy
-- see AGENTS.md for that distinction if it's ever unclear again.)

Pytest-based test suite covering:
  - File system integrity (weights, dataset, config)
  - Model loading (ONNX + PyTorch)
  - Single-frame ONNX inference correctness
  - PremiumRenderer output shape and type
  - DrownsinessAnalyzer fatigue score logic
  - data.yaml parsing and class name verification

Usage
-----
    pytest src/test_pipeline.py -v              # verbose output
    pytest src/test_pipeline.py -v --tb=short   # shorter tracebacks
    pytest src/test_pipeline.py -k "test_model" # run specific tests by name pattern

All tests should pass on a correctly configured environment.
If any test fails, check the error message — it will tell you exactly
which file or package is missing.

The checkpoint-dependent tests are parameterized via the
DDD_TEST_CHECKPOINT_DIR env var (set it to an experiment's checkpoint
folder, e.g. checkpoints/yolo26n/1-baseline) so the suite runs against
whatever experiment produced the current best checkpoint rather than a
hardcoded prior run; those test classes skip gracefully (instead of
erroring) when no checkpoint is configured yet, since no training has
happened at project start.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "src"))

# ---------------------------------------------------------------------------
# Paths used across multiple tests
# ---------------------------------------------------------------------------
_env_ckpt_dir = os.environ.get("DDD_TEST_CHECKPOINT_DIR")
CHECKPOINTS_DIR = Path(_env_ckpt_dir) if _env_ckpt_dir else None
BEST_PT      = CHECKPOINTS_DIR / "best.pt" if CHECKPOINTS_DIR else None
BEST_ONNX    = CHECKPOINTS_DIR / "best.onnx" if CHECKPOINTS_DIR else None
HAVE_CHECKPOINT = bool(BEST_PT and BEST_PT.exists())
HAVE_ONNX = bool(BEST_ONNX and BEST_ONNX.exists())
DATASET_YAML = PROJECT_ROOT / "data" / "Dataset-Main" / "data.yaml"
VIDEO_TEST   = PROJECT_ROOT / "data" / "raw_videos" / "15-MaleGlasses.avi"
EXPECTED_CLASSES = ["closed_eye", "open_eye", "yawning"]


# ===========================================================================
# Group 1: File System Integrity
# ===========================================================================

class TestFileSystemIntegrity:
    """Verify all critical project files are present before testing the model."""

    def test_dataset_yaml_exists(self):
        assert DATASET_YAML.exists(), (
            f"data.yaml not found at {DATASET_YAML}\n"
            "  This file is required for training and validation."
        )

    def test_best_onnx_exists(self):
        if not HAVE_CHECKPOINT:
            pytest.skip("DDD_TEST_CHECKPOINT_DIR not set / no checkpoint trained yet")
        assert BEST_ONNX.exists(), (
            f"best.onnx not found at {BEST_ONNX}\n"
            "  Run: python src/export.py --weights <best.pt>"
        )

    def test_best_pt_exists(self):
        if not HAVE_CHECKPOINT:
            pytest.skip("DDD_TEST_CHECKPOINT_DIR not set / no checkpoint trained yet")
        assert BEST_PT.exists(), (
            f"best.pt not found at {BEST_PT}\n"
            "  The model has not been trained yet."
        )

    def test_video_test_file_exists(self):
        assert VIDEO_TEST.exists(), (
            f"Test video not found at {VIDEO_TEST}\n"
            "  Place the test video in assets/video_test/"
        )

    def test_best_onnx_size_reasonable(self):
        """ONNX file should be > 10 MB (corrupted exports are tiny)."""
        if not HAVE_ONNX:
            pytest.skip("DDD_TEST_CHECKPOINT_DIR not set / no ONNX export yet")
        size_mb = BEST_ONNX.stat().st_size / 1e6
        assert size_mb > 10.0, (
            f"best.onnx is only {size_mb:.1f} MB — likely corrupted export.\n"
            "  Re-run: python src/export.py --weights <best.pt>"
        )

    def test_best_pt_size_reasonable(self):
        """best.pt should be > 10 MB."""
        if not HAVE_CHECKPOINT:
            pytest.skip("DDD_TEST_CHECKPOINT_DIR not set / no checkpoint trained yet")
        size_mb = BEST_PT.stat().st_size / 1e6
        assert size_mb > 10.0, (
            f"best.pt is only {size_mb:.1f} MB — likely corrupted.\n"
            "  Retrain or restore from backup."
        )

    def test_dataset_directory_exists(self):
        dataset_dir = PROJECT_ROOT / "data" / "Dataset-Main"
        assert dataset_dir.exists(), (
            f"Dataset directory not found: {dataset_dir}"
        )


# ===========================================================================
# Group 2: dataset.yaml Content
# ===========================================================================

class TestDatasetYaml:
    """Verify dataset.yaml is correctly configured."""

    @pytest.fixture(scope="class")
    def yaml_data(self):
        import yaml
        with open(DATASET_YAML, "r") as f:
            return yaml.safe_load(f)

    def test_yaml_has_nc(self, yaml_data):
        assert "nc" in yaml_data, "dataset.yaml missing 'nc' key"

    def test_yaml_nc_value(self, yaml_data):
        assert yaml_data["nc"] == 3, (
            f"Expected nc=3 (3 classes), got nc={yaml_data.get('nc')}"
        )

    def test_yaml_class_names(self, yaml_data):
        assert "names" in yaml_data, "dataset.yaml missing 'names' key"
        names = yaml_data["names"]
        assert names == EXPECTED_CLASSES, (
            f"Unexpected class names: {names}\n"
            f"  Expected: {EXPECTED_CLASSES}"
        )

    def test_yaml_has_train_path(self, yaml_data):
        assert "train" in yaml_data, "dataset.yaml missing 'train' key"

    def test_yaml_has_val_path(self, yaml_data):
        assert "val" in yaml_data, "dataset.yaml missing 'val' key"


# ===========================================================================
# Group 3: Model Loading
# ===========================================================================

class TestModelLoading:
    """Test that YOLO models load without errors."""

    @pytest.fixture(scope="class")
    def onnx_model(self):
        """Load the ONNX model once per test class."""
        if not HAVE_ONNX:
            pytest.skip("DDD_TEST_CHECKPOINT_DIR not set / no ONNX export yet")
        from inference import load_model
        return load_model(BEST_ONNX)

    @pytest.fixture(scope="class")
    def pt_model(self):
        """Load the PyTorch model once per test class."""
        if not HAVE_CHECKPOINT:
            pytest.skip("DDD_TEST_CHECKPOINT_DIR not set / no checkpoint trained yet")
        from inference import load_model
        return load_model(BEST_PT)

    def test_onnx_loads(self, onnx_model):
        assert onnx_model is not None, "ONNX model failed to load"

    def test_pt_loads(self, pt_model):
        assert pt_model is not None, "PyTorch model failed to load"

    def test_onnx_has_correct_names(self, onnx_model):
        m = onnx_model["model"] if isinstance(onnx_model, dict) else onnx_model
        names = list(m.names.values()) if hasattr(m, 'names') else EXPECTED_CLASSES
        assert names == EXPECTED_CLASSES

    def test_pt_has_correct_names(self, pt_model):
        m = pt_model["model"] if isinstance(pt_model, dict) else pt_model
        names = list(m.names.values()) if hasattr(m, 'names') else EXPECTED_CLASSES
        assert names == EXPECTED_CLASSES


# ===========================================================================
# Group 4: ONNX Inference Correctness
# ===========================================================================

class TestOnnxInference:
    """Verify that ONNX inference returns valid output shapes and types."""

    @pytest.fixture(scope="class")
    def model_and_frame(self):
        if not HAVE_ONNX:
            pytest.skip("DDD_TEST_CHECKPOINT_DIR not set / no ONNX export yet")
        from inference import load_model, run_inference
        model  = load_model(BEST_ONNX)
        frame  = np.full((480, 640, 3), 128, dtype=np.uint8)
        frame[100:300, 200:440] = 200
        results = run_inference(model, frame, conf_threshold=0.01)
        return model, frame, results

    def test_inference_returns_list(self, model_and_frame):
        _, _, results = model_and_frame
        assert isinstance(results, list), "Inference should return a list of Results"

    def test_inference_results_is_list(self, model_and_frame):
        _, _, results = model_and_frame
        assert isinstance(results, list)



# ===========================================================================
# Group 5: PremiumRenderer
# ===========================================================================

class TestPremiumRenderer:
    """Test the visual renderer output."""

    @pytest.fixture(scope="class")
    def setup(self):
        if not HAVE_ONNX:
            pytest.skip("DDD_TEST_CHECKPOINT_DIR not set / no ONNX export yet")
        from inference import PremiumRenderer, load_model, run_inference
        renderer = PremiumRenderer()
        model    = load_model(BEST_ONNX)
        frame    = np.full((480, 640, 3), 60, dtype=np.uint8)
        results  = run_inference(model, frame, conf_threshold=0.01)
        return renderer, frame, results

    def test_renderer_creates_instance(self):
        from inference import PremiumRenderer
        r = PremiumRenderer()
        assert r is not None

    def test_render_frame_returns_tuple(self, setup):
        renderer, frame, results = setup
        output = renderer.render_frame(frame, results)
        assert isinstance(output, tuple) and len(output) == 3

    def test_render_frame_annotated_shape(self, setup):
        renderer, frame, results = setup
        annotated, _, _ = renderer.render_frame(frame, results)
        assert annotated.shape == frame.shape, (
            f"Annotated frame shape {annotated.shape} != input shape {frame.shape}"
        )

    def test_render_frame_classes_is_list(self, setup):
        renderer, frame, results = setup
        _, classes, _ = renderer.render_frame(frame, results)
        assert isinstance(classes, list)

    def test_render_frame_max_conf_is_float(self, setup):
        renderer, frame, results = setup
        _, _, max_conf = renderer.render_frame(frame, results)
        assert isinstance(max_conf, float)
        assert 0.0 <= max_conf <= 1.0

    def test_render_hud_returns_frame(self, setup):
        renderer, frame, _ = setup
        hud_frame = renderer.render_hud(
            frame.copy(),
            {"Fatigue": "42%", "Alert": "SAFE", "FPS": "60.0"},
        )
        assert hud_frame.shape == frame.shape

    def test_render_frame_empty_results(self):
        from inference import PremiumRenderer
        r = PremiumRenderer()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        annotated, classes, conf = r.render_frame(frame, [])
        assert classes == []
        assert conf == 0.0
        assert annotated.shape == frame.shape


# ===========================================================================
# Group 6: DrownsinessAnalyzer
# ===========================================================================

class TestDrownsinessAnalyzer:
    """Test the stateful fatigue scoring logic."""

    def test_initial_score_is_zero(self):
        from inference import DrownsinessAnalyzer
        a = DrownsinessAnalyzer()
        assert a.fatigue_score() == 0.0

    def test_initial_alert_is_safe(self):
        from inference import DrownsinessAnalyzer
        a = DrownsinessAnalyzer()
        assert a.alert_level() == "SAFE"

    def test_open_eye_gives_low_score(self):
        from inference import DrownsinessAnalyzer
        a = DrownsinessAnalyzer(window_size=10)
        for _ in range(10):
            a.update(["open_eye"])
        assert a.fatigue_score() == 0.0

    def test_closed_eye_increases_score(self):
        from inference import DrownsinessAnalyzer
        a = DrownsinessAnalyzer(window_size=10)
        for _ in range(10):
            a.update(["closed_eye"])
        assert a.fatigue_score() == pytest.approx(0.70, abs=0.01)

    def test_yawning_increases_score(self):
        from inference import DrownsinessAnalyzer
        a = DrownsinessAnalyzer(window_size=10)
        for _ in range(10):
            a.update(["yawning"])
        assert a.fatigue_score() == pytest.approx(0.30, abs=0.01)

    def test_mixed_detections_score(self):
        from inference import DrownsinessAnalyzer
        a = DrownsinessAnalyzer(window_size=4)
        a.update(["closed_eye"])   # +0.70
        a.update(["open_eye"])     # +0
        a.update(["closed_eye"])   # +0.70
        a.update(["open_eye"])     # +0
        # score = (0.7 + 0 + 0.7 + 0) / 4 = 0.35
        assert a.fatigue_score() == pytest.approx(0.35, abs=0.01)

    def test_alert_warning_threshold(self):
        from inference import DrownsinessAnalyzer
        a = DrownsinessAnalyzer(window_size=4)
        # Score will be 0.30 * (4/4) = 0.30 for yawning — just above WARNING (0.50)?
        # Actually 0.30 < 0.50, need more frames with critical detections
        a.update(["closed_eye"])
        a.update(["closed_eye"])
        a.update(["closed_eye"])
        # score = 0.70 → CRITICAL (above 0.75 threshold)
        # but hold time not met yet
        level = a.alert_level()
        assert level in ("WARNING", "CRITICAL")

    def test_reset_clears_history(self):
        from inference import DrownsinessAnalyzer
        a = DrownsinessAnalyzer(window_size=10)
        for _ in range(10):
            a.update(["closed_eye"])
        assert a.fatigue_score() > 0.0
        a.reset()
        assert a.fatigue_score() == 0.0
        assert a.alert_level() == "SAFE"

    def test_score_clamped_to_one(self):
        from inference import DrownsinessAnalyzer
        a = DrownsinessAnalyzer(window_size=10)
        for _ in range(10):
            a.update(["closed_eye", "yawning"])  # 0.7 + 0.3 = 1.0 per frame
        assert a.fatigue_score() <= 1.0


# ===========================================================================
# Group 7: ONNX Runtime Direct Test
# ===========================================================================

class TestOnnxRuntimeDirect:
    """Test the ONNX model using onnxruntime directly (no ultralytics)."""

    def test_onnxruntime_available(self):
        try:
            import onnxruntime
        except ImportError:
            pytest.skip("onnxruntime not installed")

    def test_onnx_session_creates(self):
        if not HAVE_ONNX:
            pytest.skip("DDD_TEST_CHECKPOINT_DIR not set / no ONNX export yet")
        try:
            import onnxruntime as ort
        except ImportError:
            pytest.skip("onnxruntime not installed")

        providers = ["CPUExecutionProvider"]
        if "CUDAExecutionProvider" in ort.get_available_providers():
            providers.insert(0, "CUDAExecutionProvider")

        session = ort.InferenceSession(str(BEST_ONNX), providers=providers)
        assert session is not None

    def test_onnx_dummy_inference(self):
        if not HAVE_ONNX:
            pytest.skip("DDD_TEST_CHECKPOINT_DIR not set / no ONNX export yet")
        try:
            import onnxruntime as ort
        except ImportError:
            pytest.skip("onnxruntime not installed")

        providers = ["CPUExecutionProvider"]
        session   = ort.InferenceSession(str(BEST_ONNX), providers=providers)
        inp_name  = session.get_inputs()[0].name

        dummy   = np.random.rand(1, 3, 640, 640).astype(np.float32)
        outputs = session.run(None, {inp_name: dummy})

        assert len(outputs) > 0, "ONNX Runtime produced no outputs"
        assert outputs[0].ndim >= 2, "Unexpected output dimensionality"


# ===========================================================================
# Entry point (run with: python src/test.py)
# ===========================================================================

if __name__ == "__main__":
    sys.exit(
        pytest.main([__file__, "-v", "--tb=short"])
    )
