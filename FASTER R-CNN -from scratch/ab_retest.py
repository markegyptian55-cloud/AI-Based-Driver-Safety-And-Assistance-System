"""
ab_retest.py
------------
Before/after harness for the auto-label experiment. It snapshots full TEST-set
metrics (plus the phantom-false-positive breakdown) for a given model, and
prints a side-by-side diff of two snapshots.

WHY A RETRAIN IS REQUIRED
    Auto-labeling adds the missing labels to the TRAIN split. Train labels never
    enter test.py, so committing them and re-testing the SAME weights changes
    nothing. The metric only moves after you RETRAIN on the improved labels and
    test on the (untouched) test set. The recommended flow:

        # 0. lock the baseline
        python ab_retest.py snapshot --tag before --checkpoint checkpoints/tuned/best.pth

        # 1. propose + review + commit missing TRAIN labels
        python auto_label_candidates.py --split train --min-conf 0.95
        python approve_labels.py                       # review, approve, commit

        # 2. fine-tune from the current model on the improved labels
        python train.py --run-name tuned_fixed --resume checkpoints/tuned/best.pth --epochs 60

        # 3. measure again on the SAME test set, then diff
        python ab_retest.py snapshot --tag after --checkpoint checkpoints/tuned_fixed/best.pth
        python ab_retest.py compare

Snapshots are saved to results/ab_<tag>.json.

    A NOTE ON TEST-LABEL COMPLETION (optional, diagnostic only)
    You can instead complete the *test* labels (approve_labels.py on test-split
    candidates) and snapshot the same model. That shows how much of the "lost"
    precision was simply missing annotations -- but it is an UPPER BOUND, not a
    model improvement, because it only adds objects the model already found and
    never restores the ones it missed. Never report it as the model's accuracy.
"""

import os
import json
import argparse

import torch
from torch.utils.data import DataLoader

import config
from dataset import load_split, DrowsinessDataset, collate_fn
from models.faster_rcnn import FasterRCNN
from utils.gpu_utils import select_device
from utils.metrics import evaluate_detections, compute_map_range
# reuse the exact inference + phantom classification from the FP tool
from visualize_false_positives import run_inference, classify_image


def snapshot(args):
    device = select_device(args.device)
    names = load_split(os.path.join(config.SPLITS_DIR, f"{args.split}.txt"))
    ds = DrowsinessDataset(names, train=False)
    loader = DataLoader(ds, batch_size=config.BATCH_SIZE, shuffle=False,
                        collate_fn=collate_fn, num_workers=4)
    print(f"[{args.tag}] split={args.split} images={len(ds)}")

    model = FasterRCNN().to(device)
    ckpt = torch.load(args.checkpoint, map_location=device)
    model.load_state_dict(ckpt["model"])
    print(f"[{args.tag}] loaded {args.checkpoint} (epoch {ckpt.get('epoch', '?')})")

    preds, gts, ids = run_inference(model, loader, device)

    m = evaluate_detections(preds, gts, iou_thresh=args.iou)
    map5095 = compute_map_range(preds, gts)

    tot = {"tp": 0, "fp_phantom": 0, "fp_overlap": 0, "fn": 0}
    for pred, gt in zip(preds, gts):
        c = classify_image(pred, gt, args.iou, args.overlap_iou, config.SCORE_THRESH)
        for k in tot:
            tot[k] += len(c[k])
    fp_total = tot["fp_phantom"] + tot["fp_overlap"]
    prec_if_phantom = tot["tp"] / (tot["tp"] + tot["fp_overlap"] + 1e-9)

    snap = {
        "tag": args.tag, "checkpoint": args.checkpoint, "split": args.split,
        "epoch": ckpt.get("epoch", None), "num_images": len(ds),
        "mAP@0.5": m["mAP@0.5"], "mAP@0.5:0.95": map5095,
        "precision": m["precision"], "recall": m["recall"], "f1": m["f1"],
        "mean_iou": m["mean_iou"], "AP_per_class": m["AP_per_class"],
        "tp": tot["tp"], "fp_total": fp_total,
        "fp_phantom": tot["fp_phantom"], "fp_overlap": tot["fp_overlap"],
        "fn": tot["fn"], "precision_if_phantoms_real": prec_if_phantom,
    }
    out = os.path.join(config.RESULTS_DIR, f"ab_{args.tag}.json")
    os.makedirs(config.RESULTS_DIR, exist_ok=True)
    with open(out, "w") as f:
        json.dump(snap, f, indent=2)

    print(f"\n[{args.tag}] mAP@0.5={m['mAP@0.5']:.4f}  P={m['precision']:.4f}  "
          f"R={m['recall']:.4f}  F1={m['f1']:.4f}")
    print(f"[{args.tag}] FP total={fp_total} (phantom={tot['fp_phantom']}, "
          f"overlap={tot['fp_overlap']})  FN={tot['fn']}")
    print(f"[{args.tag}] saved -> {out}")


def _fmt(a, b):
    d = b - a
    return f"{a:.4f} -> {b:.4f}  ({'+' if d >= 0 else ''}{d:.4f})"


def _fmt_int(a, b):
    d = b - a
    return f"{a:6d} -> {b:6d}  ({'+' if d >= 0 else ''}{d})"


def compare(args):
    with open(args.before) as f:
        a = json.load(f)
    with open(args.after) as f:
        b = json.load(f)

    L = []
    L.append("\n============ BEFORE vs AFTER  (test set) ============")
    L.append(f"  before : {a['checkpoint']} (epoch {a.get('epoch')})")
    L.append(f"  after  : {b['checkpoint']} (epoch {b.get('epoch')})")
    if a["num_images"] != b["num_images"]:
        L.append(f"  !! image counts differ ({a['num_images']} vs "
                 f"{b['num_images']}) -- comparison is not apples-to-apples")
    L.append("")
    for k in ["mAP@0.5", "mAP@0.5:0.95", "precision", "recall", "f1", "mean_iou"]:
        L.append(f"  {k:16s}: {_fmt(a[k], b[k])}")
    L.append("  AP per class:")
    for name in a.get("AP_per_class", {}):
        if name in b.get("AP_per_class", {}):
            L.append(f"    {name:14s}: {_fmt(a['AP_per_class'][name], b['AP_per_class'][name])}")
    L.append("")
    for k in ["fp_total", "fp_phantom", "fp_overlap", "fn", "tp"]:
        L.append(f"  {k:16s}: {_fmt_int(a[k], b[k])}")
    report = "\n".join(L)
    print(report)

    out = os.path.join(config.RESULTS_DIR, "ab_compare.txt")
    with open(out, "w") as f:
        f.write(report + "\n")
    print(f"\nsaved -> {out}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("snapshot", help="measure one model on the test set")
    s.add_argument("--tag", required=True, help="e.g. before / after")
    s.add_argument("--checkpoint", default=f"{config.CKPT_DIR}/tuned/best.pth")
    s.add_argument("--split", default="test")
    s.add_argument("--device", default=None)
    s.add_argument("--iou", type=float, default=0.5)
    s.add_argument("--overlap-iou", type=float, default=0.2)
    s.set_defaults(func=snapshot)

    c = sub.add_parser("compare", help="diff two snapshots")
    c.add_argument("--before", default=f"{config.RESULTS_DIR}/ab_before.json")
    c.add_argument("--after", default=f"{config.RESULTS_DIR}/ab_after.json")
    c.set_defaults(func=compare)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
