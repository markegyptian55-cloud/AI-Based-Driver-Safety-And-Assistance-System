"""
benchmark_latency.py — measured inference latency / FPS per model
==================================================================
Project : nano big -- driver drowsiness detection (closed_eye/open_eye/yawning)

Produces the numbers the project has never had: real per-model inference
latency, throughput, parameter count and on-disk size, measured rather
than inferred from input geometry.

Writes INFO/_benchmark/latency.json (machine-readable) and
INFO/_benchmark/latency_summary.md (a report table), alongside the
per-model evidence under INFO/<family>/<run>-test-result/.

Measurement notes -- these are the parts that make a GPU benchmark
honest, and they are easy to get wrong:

  * CUDA kernel launches are ASYNCHRONOUS. Timing them without
    torch.cuda.synchronize() on both sides measures how fast Python can
    queue work, not how long the model takes -- which is why naive GPU
    benchmarks report impossibly low latencies. Every timed region here
    is synchronised.
  * The first inferences are not representative: they pay CUDA context
    setup, kernel autotuning and cuDNN algorithm selection. Warmup
    iterations run first and are discarded.
  * A mean alone hides tail behaviour that a driver-monitoring system
    actually feels as dropped frames, so median and p95 are reported
    too. Median is the headline number; FPS is derived from it rather
    than from the mean.
  * Latency is measured on a synthetic zero tensor of the model's own
    input size. That is legitimate here because convolutional inference
    cost is shape-dependent, not content-dependent -- but it means these
    figures exclude pre/post-processing and NMS-on-real-detections. The
    report states that scope rather than implying end-to-end pipeline
    timing.
"""

from __future__ import annotations

import argparse
import json
import platform
import statistics
import sys
import time
from pathlib import Path

import torch
import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src"))

OUT_DIR = PROJECT_ROOT / "INFO" / "_benchmark"

DEFAULT_WARMUP = 10
DEFAULT_ITERS = 50


def load_registry() -> dict:
    cfg_path = PROJECT_ROOT / "configs" / "checkpoints.yaml"
    with open(cfg_path, "r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    return cfg.get("models") or {}


def device_report() -> dict:
    info = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "torch": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
    }
    if torch.cuda.is_available():
        props = torch.cuda.get_device_properties(0)
        info["gpu_name"] = props.name
        info["gpu_vram_gb"] = round(props.total_memory / 1e9, 2)
        info["cuda_version"] = torch.version.cuda
    return info


def time_calls(fn, warmup: int, iters: int, cuda: bool) -> dict:
    """Run fn() warmup+iters times, return timing stats in milliseconds."""
    for _ in range(warmup):
        fn()
    if cuda:
        torch.cuda.synchronize()

    samples = []
    for _ in range(iters):
        if cuda:
            torch.cuda.synchronize()
        t0 = time.perf_counter()
        fn()
        if cuda:
            # Without this the timer stops before the GPU has finished.
            torch.cuda.synchronize()
        samples.append((time.perf_counter() - t0) * 1000.0)

    samples.sort()
    median = statistics.median(samples)
    return {
        "mean_ms": round(statistics.mean(samples), 3),
        "median_ms": round(median, 3),
        "p95_ms": round(samples[min(int(len(samples) * 0.95), len(samples) - 1)], 3),
        "min_ms": round(samples[0], 3),
        "max_ms": round(samples[-1], 3),
        "stdev_ms": round(statistics.stdev(samples), 3) if len(samples) > 1 else 0.0,
        # Derived from the median, not the mean: one slow outlier should not
        # flatter or punish the headline throughput figure.
        "fps": round(1000.0 / median, 2) if median > 0 else None,
        "iterations": iters,
        "warmup": warmup,
    }


def model_static_info(weights: Path, model) -> dict:
    info = {"file_size_bytes": weights.stat().st_size if weights.exists() else None}
    try:
        params = sum(p.numel() for p in model.parameters())
        info["parameters"] = params
        info["parameters_millions"] = round(params / 1e6, 3)
    except Exception:
        info["parameters"] = None
    return info


def bench_yolo(key: str, cfg: dict, args) -> dict | None:
    from ultralytics import YOLO

    weights = PROJECT_ROOT / cfg["checkpoint"]
    if not weights.exists():
        print(f"[skip] {key}: checkpoint missing at {weights}")
        return None

    imgsz = int(cfg.get("resolution") or 640)
    row: dict = {
        "model_key": key,
        "display_name": cfg.get("display_name", key),
        "family": "yolo",
        "imgsz": imgsz,
        "checkpoint": cfg["checkpoint"],
    }

    model = YOLO(str(weights))
    row.update(model_static_info(weights, model.model))

    for dev in args.devices:
        if dev == "cuda" and not torch.cuda.is_available():
            print(f"[skip] {key}: cuda requested but unavailable")
            continue
        cuda = dev == "cuda"
        x = torch.zeros(1, 3, imgsz, imgsz, device=dev)
        net = model.model.to(dev).eval()

        def run():
            with torch.no_grad():
                net(x)

        try:
            row[f"torch_{dev}"] = time_calls(run, args.warmup, args.iters, cuda)
            print(f"  [{dev:4}] {row[f'torch_{dev}']['median_ms']:8.2f} ms  "
                  f"{row[f'torch_{dev}']['fps']:7.2f} FPS")
        except Exception as exc:
            row[f"torch_{dev}"] = {"error": f"{type(exc).__name__}: {exc}"}
            print(f"  [{dev:4}] FAILED: {exc}")

    onnx_path = weights.with_suffix(".onnx")
    if args.onnx and onnx_path.exists():
        row["onnx"] = bench_onnx(onnx_path, imgsz, args)
    return row


def bench_onnx(onnx_path: Path, imgsz: int, args) -> dict:
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError as exc:
        return {"error": f"onnxruntime unavailable: {exc}"}

    out: dict = {"file": str(onnx_path.relative_to(PROJECT_ROOT)),
                 "file_size_bytes": onnx_path.stat().st_size}
    ort.set_default_logger_severity(3)

    for provider in args.onnx_providers:
        if provider not in ort.get_available_providers():
            out[provider] = {"error": "provider not available in this build"}
            continue
        try:
            sess = ort.InferenceSession(str(onnx_path), providers=[provider])
            inp = sess.get_inputs()[0]
            dtype = np.float16 if "float16" in inp.type else np.float32
            x = np.zeros((1, 3, imgsz, imgsz), dtype=dtype)
            name = inp.name

            def run():
                sess.run(None, {name: x})

            out[provider] = time_calls(run, args.warmup, args.iters, cuda=False)
            print(f"  [onnx:{provider[:12]:12}] {out[provider]['median_ms']:8.2f} ms  "
                  f"{out[provider]['fps']:7.2f} FPS")
        except Exception as exc:
            out[provider] = {"error": f"{type(exc).__name__}: {exc}"}
    return out


def bench_rfdetr(key: str, cfg: dict, args) -> dict | None:
    """
    RF-DETR is loaded through the project's own inference.py loader rather
    than reimplemented here, so a benchmark can never diverge from how the
    model is actually run elsewhere in the project.
    """
    weights = PROJECT_ROOT / cfg["checkpoint"]
    if not weights.exists():
        print(f"[skip] {key}: checkpoint missing at {weights}")
        return None

    imgsz = int(cfg.get("resolution") or 384)
    row: dict = {
        "model_key": key,
        "display_name": cfg.get("display_name", key),
        "family": "rfdetr",
        "imgsz": imgsz,
        "checkpoint": cfg["checkpoint"],
        "file_size_bytes": weights.stat().st_size,
    }

    try:
        # Lives in demo_video.py (which owns the shared model-loading
        # helpers), not inference.py -- same import evaluate.py uses.
        from demo_video import load_rfdetr_model
        model = load_rfdetr_model(
            str(weights), resolution=imgsz, rfdetr_class=cfg.get("rfdetr_class", "nano")
        )
    except Exception as exc:
        row["error"] = f"load failed: {type(exc).__name__}: {exc}"
        print(f"  load FAILED: {exc}")
        return row

    net = getattr(model, "model", model)
    inner = getattr(net, "model", net)
    try:
        row.update(model_static_info(weights, inner))
    except Exception:
        pass

    for dev in args.devices:
        if dev == "cuda" and not torch.cuda.is_available():
            continue
        cuda = dev == "cuda"
        try:
            inner_dev = inner.to(dev).eval()
            x = torch.zeros(1, 3, imgsz, imgsz, device=dev)

            def run():
                with torch.no_grad():
                    inner_dev(x)

            row[f"torch_{dev}"] = time_calls(run, args.warmup, args.iters, cuda)
            print(f"  [{dev:4}] {row[f'torch_{dev}']['median_ms']:8.2f} ms  "
                  f"{row[f'torch_{dev}']['fps']:7.2f} FPS")
        except Exception as exc:
            row[f"torch_{dev}"] = {"error": f"{type(exc).__name__}: {exc}"}
            print(f"  [{dev:4}] FAILED: {exc}")
    return row


def write_summary(payload: dict) -> None:
    lines = [
        "# Measured inference latency",
        "",
        f"**Measured:** {payload['measured_at']}",
        f"**GPU:** {payload['device'].get('gpu_name', 'n/a')} "
        f"({payload['device'].get('gpu_vram_gb', '?')} GB)",
        f"**torch:** {payload['device']['torch']} | "
        f"**CUDA:** {payload['device'].get('cuda_version', 'n/a')} | "
        f"**Python:** {payload['device']['python']}",
        f"**Protocol:** {payload['warmup']} warmup + {payload['iters']} timed "
        "iterations per configuration, CUDA-synchronised, batch size 1.",
        "",
        "Latency is forward-pass only on a synthetic tensor of each model's own "
        "input size: it excludes pre-processing, post-processing and decoding of "
        "real detections, and so is a lower bound on end-to-end pipeline cost. "
        "FPS is derived from the median, not the mean.",
        "",
        "| Model | Family | Input | Params (M) | Size (MB) | GPU median (ms) | GPU FPS | CPU median (ms) | CPU FPS |",
        "|---|---|---|---|---|---|---|---|---|",
    ]

    def cell(row, dev, field):
        d = row.get(f"torch_{dev}")
        if not isinstance(d, dict) or "error" in d:
            return "—"
        v = d.get(field)
        return f"{v:.2f}" if isinstance(v, (int, float)) else "—"

    for row in payload["models"]:
        size_mb = (f"{row['file_size_bytes'] / 1024 / 1024:.2f}"
                   if row.get("file_size_bytes") else "—")
        params = (f"{row['parameters_millions']:.2f}"
                  if row.get("parameters_millions") else "—")
        lines.append(
            f"| {row['display_name']} | {row['family']} | {row['imgsz']} | "
            f"{params} | {size_mb} | {cell(row,'cuda','median_ms')} | "
            f"{cell(row,'cuda','fps')} | {cell(row,'cpu','median_ms')} | "
            f"{cell(row,'cpu','fps')} |"
        )

    failed = [r for r in payload["models"] if r.get("error")]
    if failed:
        lines += ["", "## Models that could not be benchmarked", ""]
        lines += [f"- **{r['display_name']}** — {r['error']}" for r in failed]

    (OUT_DIR / "latency_summary.md").write_text("\n".join(lines) + "\n",
                                                encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser(description="Measure per-model inference latency")
    registry = load_registry()
    p.add_argument("--model", default="all",
                   help="registry key, or 'all' (default)")
    p.add_argument("--devices", nargs="+", default=["cuda", "cpu"],
                   choices=["cuda", "cpu"],
                   help="devices to benchmark (default: cuda cpu)")
    p.add_argument("--iters", type=int, default=DEFAULT_ITERS,
                   help=f"timed iterations (default {DEFAULT_ITERS})")
    p.add_argument("--warmup", type=int, default=DEFAULT_WARMUP,
                   help=f"discarded warmup iterations (default {DEFAULT_WARMUP})")
    p.add_argument("--onnx", action="store_true",
                   help="also benchmark the ONNX export where one exists")
    p.add_argument("--onnx-providers", nargs="+",
                   default=["CPUExecutionProvider"],
                   help="ONNX Runtime execution providers to try")
    args = p.parse_args()

    if not registry:
        print("configs/checkpoints.yaml has no registered models.")
        return 1

    keys = list(registry) if args.model == "all" else [args.model]
    unknown = [k for k in keys if k not in registry]
    if unknown:
        print(f"Unknown model key(s): {unknown}\nAvailable: {list(registry)}")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dev = device_report()
    print(f"GPU: {dev.get('gpu_name', 'none')} | torch {dev['torch']}")
    print(f"Protocol: {args.warmup} warmup + {args.iters} timed, batch 1\n")

    rows = []
    for i, key in enumerate(keys, 1):
        cfg = registry[key]
        print(f"[{i}/{len(keys)}] {cfg.get('display_name', key)} "
              f"({cfg.get('family')}, {cfg.get('resolution')}px)")
        fn = bench_rfdetr if cfg.get("family") == "rfdetr" else bench_yolo
        try:
            row = fn(key, cfg, args)
        except Exception as exc:
            row = {"model_key": key, "display_name": cfg.get("display_name", key),
                   "family": cfg.get("family"), "imgsz": cfg.get("resolution"),
                   "error": f"{type(exc).__name__}: {exc}"}
            print(f"  FAILED: {exc}")
        if row:
            rows.append(row)
        print()

    payload = {
        "measured_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "device": dev,
        "warmup": args.warmup,
        "iters": args.iters,
        "batch_size": 1,
        "scope": ("forward pass only, synthetic input, excludes pre/post-processing"),
        "models": rows,
    }
    with open(OUT_DIR / "latency.json", "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    write_summary(payload)

    print(f"Benchmarked {len(rows)} model(s).")
    print(f"  {OUT_DIR / 'latency.json'}")
    print(f"  {OUT_DIR / 'latency_summary.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
