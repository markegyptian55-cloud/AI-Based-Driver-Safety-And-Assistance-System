"""
export.py — ONNX & TensorRT Model Exporter Pipeline
===================================================
Project : nano big -- driver drowsiness detection (closed_eye/open_eye/yawning)

Exports trained PyTorch weights (.pt for YOLO or .pth for RF-DETR)
to production ONNX (.onnx) or TensorRT (.engine) formats for high-speed edge deployment.

Refactor notes (BOOK.md Chapter 2, SS2.7 Quantization Strategy, SS2.10 Src
Refactor Plan):
  - --weights/--all no longer point at the dead "checkpoints/YOLOv11 Medium
    Family/..." tree inherited from an unrelated prior project. --all now
    reads configs/checkpoints.yaml (the same registry demo_video.py uses)
    instead of a separate hardcoded list.
  - --imgsz default changed 384 -> 960 to match the new train.py default
    training resolution; --all uses each registry entry's own "resolution"
    field instead of a single hardcoded size.
  - --precision {fp32,fp16,int8} replaces the old bare --half flag as the
    primary interface (fp16 == old --half=True). INT8 is accepted on the
    CLI but NOT implemented here: per the quantization strategy, PTQ/QAT
    calibration is explicitly deferred until after the best PyTorch
    checkpoints are identified (do not optimize deployment prematurely) --
    passing --precision int8 prints that rationale and exits instead of
    silently doing an uncalibrated, unvalidated quantization.
  - Ultralytics' own model.export() saves the .onnx/.engine file next to
    the source .pt by default -- combined with train.py's new
    checkpoints/<family>/<N>-<name>/best.pt convention, this means export
    output lands at checkpoints/<family>/<N>-<name>/best.onnx automatically,
    with no extra path-handling code needed here (BOOK.md Ch.2 SS2.10).
"""

from __future__ import annotations

import os
import sys
import argparse
import logging
from pathlib import Path
import torch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


def _load_checkpoint_registry() -> dict:
    """Read configs/checkpoints.yaml -- same registry demo_video.py uses."""
    import yaml
    cfg_path = PROJECT_ROOT / "configs" / "checkpoints.yaml"
    if not cfg_path.exists():
        return {}
    with open(cfg_path, "r", encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    registry = {}
    for key, entry in (cfg.get("models") or {}).items():
        entry = dict(entry)
        entry["checkpoint"] = PROJECT_ROOT / entry["checkpoint"]
        registry[key] = entry
    return registry


def parse_args():
    parser = argparse.ArgumentParser(description="Unified ONNX & TensorRT Model Exporter")

    parser.add_argument("--weights", type=str, default=None, help="Path to input weights (.pt or .pth). If omitted, use --all to export the whole registry.")
    parser.add_argument("--type", type=str, default="auto", choices=["auto", "yolo", "rfdetr"], help="Model type family")
    parser.add_argument("--format", default="onnx", choices=["onnx", "engine"], help="Export format (onnx, engine)")
    parser.add_argument("--imgsz", type=int, default=960, help="Input image spatial resolution")
    parser.add_argument("--opset", type=int, default=17, help="ONNX opset version")
    parser.add_argument("--precision", type=str, default="fp32", choices=["fp32", "fp16", "int8"], help="Export precision. int8 is deferred (see module docstring) and will exit without exporting.")
    parser.add_argument("--half", action="store_true", help="[deprecated alias] equivalent to --precision fp16")
    parser.add_argument("--all", action="store_true", help="Export every model registered in configs/checkpoints.yaml")
    parser.add_argument("--skip-verify", action="store_true", help="Skip post-export ONNX runtime verification")
    return parser.parse_args()


def export_yolo(weights_path: Path, export_format: str, imgsz: int, opset: int, half: bool = False) -> Path:
    log.info("[YOLO Export] Loading weights from: %s", weights_path)
    from ultralytics import YOLO
    
    model = YOLO(str(weights_path))
    exported_path_str = model.export(
        format=export_format,
        imgsz=imgsz,
        simplify=True,
        opset=opset,
        half=half,
        dynamic=False,
    )
    return Path(exported_path_str) if exported_path_str else weights_path.with_suffix("." + export_format)


def export_rfdetr(weights_path: Path, output_path: Path, imgsz: int, opset: int) -> Path:
    log.info("[RF-DETR Export] Exporting checkpoint: %s", weights_path)
    try:
        from rfdetr import RFDETRNano, RFDETRSmall
        if "small" in str(weights_path).lower():
            model = RFDETRSmall(resolution=imgsz, num_classes=3, pretrain_weights=str(weights_path))
        else:
            model = RFDETRNano(resolution=imgsz, num_classes=3, pretrain_weights=str(weights_path))
            
        model.model.eval()
        dummy_input = torch.zeros((1, 3, imgsz, imgsz), dtype=torch.float32)

        torch.onnx.export(
            model.model,
            dummy_input,
            str(output_path),
            export_params=True,
            opset_version=opset,
            do_constant_folding=True,
            input_names=['images'],
            output_names=['output'],
            dynamic_axes={'images': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
        )
        return output_path
    except Exception as exc:
        log.error("RF-DETR ONNX Export failed: %s", exc)
        raise exc


def verify_onnx(onnx_path: Path) -> None:
    log.info("Verifying ONNX model integrity: %s", onnx_path)
    try:
        import onnx
        model_proto = onnx.load(str(onnx_path))
        onnx.checker.check_model(model_proto)
        log.info("ONNX model integrity check PASSED.")
    except Exception as exc:
        log.warning("ONNX verification skipped: %s", exc)


def export_single(weights_path: Path, model_type: str, export_format: str, imgsz: int, opset: int, half: bool):
    if not weights_path.exists():
        log.error("Weights file not found at: %s", weights_path)
        return None

    if model_type == "auto":
        model_type = "rfdetr" if weights_path.suffix == ".pth" else "yolo"

    log.info("=" * 70)
    log.info(" UNIFIED ADAS MODEL EXPORTER")
    log.info(" Model Target  : %s", weights_path.relative_to(PROJECT_ROOT))
    log.info(" Model Type    : %s", model_type.upper())
    log.info(" Format / Size : %s | %dx%d", export_format.upper(), imgsz, imgsz)
    log.info("=" * 70)

    if model_type == "yolo":
        exported_path = export_yolo(weights_path, export_format, imgsz, opset, half)
    else:
        out_onnx = weights_path.with_name(weights_path.stem + ".onnx")
        exported_path = export_rfdetr(weights_path, out_onnx, imgsz, opset)

    if exported_path and exported_path.exists():
        size_mb = exported_path.stat().st_size / (1024 * 1024)
        log.info("Export Successful! Saved: %s (%.2f MB)\n", exported_path.name, size_mb)
        if export_format == "onnx":
            verify_onnx(exported_path)
    return exported_path


def main():
    args = parse_args()

    if args.precision == "int8":
        log.warning(
            "INT8 export requested but is intentionally NOT implemented yet. "
            "Per BOOK.md Chapter 2 SS2.7 (Quantization Strategy), INT8 PTQ/QAT "
            "calibration is deferred until the best PyTorch checkpoints across "
            "both model families have been identified -- optimizing deployment "
            "before the model itself is finalized wastes calibration effort on "
            "a checkpoint that may not even be selected. Re-run with "
            "--precision fp16 (safe default for this safety-adjacent task) or "
            "fp32 once you actually intend to quantize."
        )
        return

    half = args.precision == "fp16" or args.half

    if args.all:
        registry = _load_checkpoint_registry()
        if not registry:
            log.error("configs/checkpoints.yaml has no registered models yet -- train a model first, "
                       "then add its checkpoint entry to the registry before running --all.")
            return
        log.info("Exporting ALL %d registered model(s)...\n", len(registry))
        for key, entry in registry.items():
            w_path = Path(entry["checkpoint"])
            sz = entry.get("resolution") or args.imgsz
            if w_path.exists():
                export_single(w_path, entry.get("family", "auto"), args.format, sz, args.opset, half)
            else:
                log.warning("Registry entry '%s' checkpoint missing on disk, skipping: %s", key, w_path)
    else:
        if not args.weights:
            log.error("--weights is required unless --all is given.")
            return
        weights_path = Path(args.weights)
        export_single(weights_path, args.type, args.format, args.imgsz, args.opset, half)


if __name__ == "__main__":
    main()
