"""
sweep_threshold.py -- what does the confidence cut actually cost us?
================================================================================
Project : nano big -- driver drowsiness detection

D8 (BOOK.md Ch.3) measured that 83.2% of the best model's 1,985 "missed"
detections are correct boxes with IoU >= 0.5 that simply scored below the 0.35
operating threshold -- and that only 23 objects across the whole test split are
genuine blindness. The confidences of those rejected-but-correct detections sit
at a median of 0.110 (closed_eye), 0.137 (open_eye) and 0.285 (yawning), with
82% of yawning's above 0.20. So the operating point is leaving a large amount of
real recall on the table.

This sweeps the threshold and reports what each setting actually buys and costs,
per class, so the choice is made on numbers rather than on the inherited 0.35.

READ THIS BEFORE QUOTING ANY NUMBER FROM THIS SCRIPT
----------------------------------------------------
mAP50 integrates across every confidence threshold, so it is **identical at
every row below** -- the low-confidence detections are already counted in it.
Lowering the threshold raises operating-point recall; it does NOT raise mAP50
and must never be reported as an accuracy improvement. What it is: a genuine
product decision about where to sit on the precision/recall curve, which for a
drowsiness detector is a real safety argument -- a missed eye-closure costs more
than a false alarm.

Inference runs ONCE at conf 0.001 and every threshold is evaluated post-hoc off
the same cached detections, so the rows are exactly comparable and the sweep
costs one pass, not one pass per threshold.

Read-only: touches no labels, no images, no checkpoints.

Usage
-----
    python src/sweep_threshold.py
    python src/sweep_threshold.py --limit 300
    python src/sweep_threshold.py --model yolo26n-3-fresh-640
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from demo_video import MODEL_REGISTRY, CLASSES, load_yolo_model, derive_test_result_dir
from evaluate import (compute_iou, load_ground_truth, resolve_test_split,
                       run_inference, build_ignore_rules, IOU_THRESH, NUM_CLASSES)

HEADLINE = [0.35, 0.30, 0.25, 0.20]
FINE = [round(x, 2) for x in np.arange(0.05, 0.65, 0.025)]


def score_at(threshold, cached, ignore_by_image):
    """Greedy operating-point matching at one threshold -> per-class TP/FP/FN."""
    tp = defaultdict(int)
    fp = defaultdict(int)
    fp_corrected = defaultdict(int)
    fn = defaultdict(int)

    for img_idx, (dets, gt) in enumerate(cached):
        ignore = ignore_by_image[img_idx]
        # dets arrive pre-sorted descending by confidence (see collect), so the
        # accepted set is just a prefix -- re-sorting here would repeat an
        # O(n log n) sort ~30x over every image in the split.
        op = [d for d in dets if d["confidence"] >= threshold]
        used = [False] * len(gt)
        for d in op:
            best_iou, best_j = 0.0, -1
            for j, g in enumerate(gt):
                if used[j] or g["class_id"] != d["class_id"]:
                    continue
                iou = compute_iou((d["x1"], d["y1"], d["x2"], d["y2"]), g["box"])
                if iou > best_iou:
                    best_iou, best_j = iou, j
            if best_iou >= IOU_THRESH:
                used[best_j] = True
                tp[d["class_id"]] += 1
            else:
                fp[d["class_id"]] += 1
                if d["class_id"] not in ignore:
                    fp_corrected[d["class_id"]] += 1
        for j, g in enumerate(gt):
            if not used[j]:
                fn[g["class_id"]] += 1

    out = {}
    for c in range(NUM_CLASSES):
        p = tp[c] / max(tp[c] + fp[c], 1)
        r = tp[c] / max(tp[c] + fn[c], 1)
        f1 = 2 * p * r / max(p + r, 1e-9)
        pc = tp[c] / max(tp[c] + fp_corrected[c], 1)
        f1c = 2 * pc * r / max(pc + r, 1e-9)
        out[c] = {"tp": tp[c], "fp": fp[c], "fp_corrected": fp_corrected[c], "fn": fn[c],
                   "precision": p, "recall": r, "f1": f1,
                   "precision_corrected": pc, "f1_corrected": f1c}
    return out


def collect(model_key, images_dir, labels_dir, limit=None):
    cfg = MODEL_REGISTRY[model_key]
    ckpt = cfg["checkpoint"]
    if not ckpt.exists():
        print(f"ERROR: checkpoint not found: {ckpt}")
        return None, None, None

    print(f"[SWEEP] {cfg['display_name']}  (single inference pass at conf=0.001)")
    model = load_yolo_model(ckpt)

    image_paths = sorted(list(images_dir.glob("*.jpg")) + list(images_dir.glob("*.png")))
    if limit:
        image_paths = image_paths[:limit]
    ignore_by_image, _ = build_ignore_rules(image_paths, labels_dir)

    cached = []
    for i, img_path in enumerate(image_paths):
        dets, shape = run_inference(model, "yolo", img_path, conf_threshold=0.001)
        if shape is None:
            cached.append(([], []))
            continue
        h, w = shape
        dets.sort(key=lambda d: -d["confidence"])   # sorted once, reused by every threshold
        cached.append((dets, load_ground_truth(labels_dir / (img_path.stem + ".txt"), w, h)))
        if (i + 1) % 500 == 0:
            print(f"  ...{i + 1}/{len(image_paths)}")
    return cfg, cached, ignore_by_image


def report(cfg, cached, ignore_by_image):
    lines, A = [], lambda s: lines.append(s)
    A("=" * 100)
    A(f" CONFIDENCE THRESHOLD SWEEP -- {cfg['display_name']}")
    A("=" * 100)
    A("")
    A(f"Images: {len(cached)}    IoU threshold: {IOU_THRESH}")
    A("")
    A("mAP50 is IDENTICAL at every threshold below -- it already integrates over all")
    A("confidence levels. This sweep changes the operating point, not the model's")
    A("accuracy. Do not report any row here as an accuracy improvement.")
    A("")

    results = {}
    for t in HEADLINE:
        results[t] = score_at(t, cached, ignore_by_image)

    for ci in range(NUM_CLASSES):
        A(f"--- {CLASSES[ci]} " + "-" * (96 - len(CLASSES[ci])))
        A(f"{'conf':>6}{'Precision':>11}{'Recall':>9}{'F1':>9}{'TP':>7}{'FP':>7}{'FN':>7}"
          f"{'  |':>4}{'P (gap-corr)':>14}{'F1 (gap-corr)':>15}")
        for t in HEADLINE:
            m = results[t][ci]
            A(f"{t:>6.2f}{100*m['precision']:>10.2f}%{100*m['recall']:>8.2f}%{100*m['f1']:>8.2f}%"
              f"{m['tp']:>7}{m['fp']:>7}{m['fn']:>7}{'  |':>4}"
              f"{100*m['precision_corrected']:>13.2f}%{100*m['f1_corrected']:>14.2f}%")
        A("")

    A("--- overall (macro mean across the three classes) " + "-" * 50)
    A(f"{'conf':>6}{'Precision':>11}{'Recall':>9}{'F1':>9}{'total FP':>10}{'total FN':>10}")
    for t in HEADLINE:
        r = results[t]
        p = np.mean([r[c]["precision"] for c in range(NUM_CLASSES)])
        rc = np.mean([r[c]["recall"] for c in range(NUM_CLASSES)])
        f1 = np.mean([r[c]["f1"] for c in range(NUM_CLASSES)])
        A(f"{t:>6.2f}{100*p:>10.2f}%{100*rc:>8.2f}%{100*f1:>8.2f}%"
          f"{sum(r[c]['fp'] for c in range(NUM_CLASSES)):>10}"
          f"{sum(r[c]['fn'] for c in range(NUM_CLASSES)):>10}")
    A("")

    # Per-class F1-optimal point. Classes have different confidence distributions
    # (D8: yawning's rejected detections sit at median 0.285, the eye classes near
    # 0.11-0.14), so one global cut is unlikely to be right for all three.
    A("--- F1-optimal threshold, swept finely per class " + "-" * 51)
    A(f"{'class':<14}{'best conf':>11}{'F1 there':>11}{'Recall there':>14}{'F1 @ 0.35':>12}{'gain':>9}")
    best_per_class = {}
    fine = {t: score_at(t, cached, ignore_by_image) for t in FINE}
    for ci in range(NUM_CLASSES):
        bt = max(FINE, key=lambda t: fine[t][ci]["f1"])
        bf1 = fine[bt][ci]["f1"]
        base = results[0.35][ci]["f1"]
        best_per_class[CLASSES[ci]] = {"threshold": bt, "f1": bf1,
                                        "recall": fine[bt][ci]["recall"]}
        A(f"{CLASSES[ci]:<14}{bt:>11.3f}{100*bf1:>10.2f}%{100*fine[bt][ci]['recall']:>13.2f}%"
          f"{100*base:>11.2f}%{100*(bf1-base):>+8.2f}")
    A("")
    A("=" * 100)
    return "\n".join(lines), results, best_per_class


def parse_args():
    p = argparse.ArgumentParser(description="Confidence-threshold sweep at fixed IoU")
    p.add_argument("--model", default="yolo26n-2-finetune")
    p.add_argument("--split", default="test", choices=["test", "val"])
    p.add_argument("--limit", type=int, default=None)
    return p.parse_args()


def main():
    args = parse_args()
    if args.model not in MODEL_REGISTRY:
        print(f"ERROR: unknown model '{args.model}'. Known: {list(MODEL_REGISTRY)}")
        return
    images_dir, labels_dir = resolve_test_split(split=args.split)
    cfg, cached, ignore_by_image = collect(args.model, images_dir, labels_dir, args.limit)
    if cached is None:
        return

    text, results, best = report(cfg, cached, ignore_by_image)
    print("\n" + text)

    out_dir = derive_test_result_dir(cfg["checkpoint"]) / "threshold-sweep"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"threshold_sweep_{args.split}.txt").write_text(text, encoding="utf-8")
    (out_dir / f"threshold_sweep_{args.split}.json").write_text(json.dumps({
        "model": args.model, "split": args.split, "images": len(cached),
        "thresholds": {str(t): {CLASSES[c]: results[t][c] for c in range(NUM_CLASSES)}
                        for t in HEADLINE},
        "f1_optimal_per_class": best,
    }, indent=2), encoding="utf-8")
    print(f"  -> {out_dir}")


if __name__ == "__main__":
    main()
