"""
crosscheck_ultralytics_val.py -- independent second opinion on our own evaluator
================================================================================
Project : nano big -- driver drowsiness detection

Why this exists
---------------
The project has two different mAP numbers per model and has never compared them
fairly:

  * val mAP50  -- produced by Ultralytics' own validator during training
  * test mAP50 -- produced by src/evaluate.py, a hand-rolled evaluator

They differ in AP integration (evaluate.py uses all-point interpolation,
Ultralytics uses 101-point), in letterbox/padding geometry, and in batching. So
the ~6-point val->test drop seen across all three experiments could be a real
property of the data OR partly an artifact of swapping evaluators -- nobody
checked, and BOOK.md line 1003 simply assumes "both should agree".

This script runs Ultralytics' validator on whichever split you ask for, so:
  * `--split test` gives a test number directly comparable to the training-time
    val number (same evaluator on both ends).
  * running it on both splits isolates the true val->test delta.

It also prints PER-CLASS AP, which currently exists nowhere in the project --
training.log only ever recorded aggregate P/R/mAP, so the per-class val
breakdown needed to attribute the drop has never been available.

This reports RAW metrics only. It has no notion of the dataset's partial
annotation, so its numbers are directly comparable to evaluate.py's *raw*
column, never to the label-gap-corrected one.

Usage
-----
    python src/crosscheck_ultralytics_val.py --split test
    python src/crosscheck_ultralytics_val.py --split val
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from demo_video import MODEL_REGISTRY, CLASSES, derive_test_result_dir

DEFAULT_DATA_YAML = PROJECT_ROOT / "data" / "Dataset-Main" / "data.yaml"


def parse_args():
    p = argparse.ArgumentParser(description="Ultralytics-validator cross-check of evaluate.py")
    p.add_argument("--split", default="test", choices=["test", "val"])
    p.add_argument("--data", default=str(DEFAULT_DATA_YAML))
    p.add_argument("--model", default="all",
                    help="Key from configs/checkpoints.yaml, or 'all'")
    return p.parse_args()


def main():
    args = parse_args()
    if not MODEL_REGISTRY:
        print("ERROR: configs/checkpoints.yaml has no registered models.")
        return

    from ultralytics import YOLO

    keys = list(MODEL_REGISTRY.keys()) if args.model == "all" else [args.model]
    rows = []

    for key in keys:
        cfg = MODEL_REGISTRY[key]
        ckpt = cfg["checkpoint"]
        if not ckpt.exists():
            print(f"WARNING [{key}]: checkpoint missing, skipping -> {ckpt}")
            continue

        print(f"\n[CROSSCHECK] {cfg['display_name']}  split={args.split}")
        model = YOLO(str(ckpt))
        # imgsz is intentionally NOT passed: Ultralytics restores each checkpoint's
        # own training imgsz (verified 960/960/640 for Exp1/2/3), which is what we
        # want -- every model judged at the resolution it was trained for.
        #
        # project/name are pinned because Ultralytics otherwise dumps into
        # runs/detect/val at the repo root, outside this project's folder
        # convention (AGENTS.md). plots=False since evaluate.py already owns the
        # charts -- this script exists for the numbers alone.
        out_dir = derive_test_result_dir(ckpt) / "ultralytics-crosscheck"
        m = model.val(data=args.data, split=args.split, verbose=False, plots=False,
                       project=str(out_dir), name=args.split, exist_ok=True)

        per_class = {}
        for i, c in enumerate(m.ap_class_index):
            per_class[CLASSES[int(c)]] = float(m.box.ap50[i])

        rows.append({
            "key": key,
            "name": cfg["display_name"],
            "imgsz": model.overrides.get("imgsz"),
            "map50": float(m.box.map50),
            "map5095": float(m.box.map),
            "precision": float(m.box.mp),
            "recall": float(m.box.mr),
            "per_class": per_class,
        })

    if not rows:
        return

    print("\n" + "=" * 96)
    print(f" ULTRALYTICS VALIDATOR -- split={args.split}   (RAW metrics; compare to evaluate.py's RAW column)")
    print("=" * 96)
    hdr = f"{'model':<38}{'imgsz':>6}{'mAP50':>9}{'mAP50-95':>10}{'P':>8}{'R':>8}   " + \
          "".join(f"{c:>13}" for c in CLASSES)
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        cells = "".join(f"{100*r['per_class'].get(c, 0.0):>12.2f}%" for c in CLASSES)
        print(f"{r['name']:<38}{str(r['imgsz']):>6}{100*r['map50']:>8.2f}%{100*r['map5095']:>9.2f}%"
              f"{100*r['precision']:>7.2f}%{100*r['recall']:>7.2f}%   {cells}")
    print("=" * 96)


if __name__ == "__main__":
    main()
