"""
diagnose_misses.py -- why does the model miss what it misses?
================================================================================
Project : nano big -- driver drowsiness detection

Recall, not precision, is the binding constraint: the best checkpoint misses
1,985 of 7,427 test objects while precision sits far higher. "Missed" is a
single number hiding four very different failure modes, and they have opposite
fixes -- so before spending GPU-days on more training, split it.

For every ground-truth box that the operating point (conf >= 0.35, IoU >= 0.5)
failed to match, every detection on that image is re-examined down to conf 0.001
and the miss is attributed to exactly one cause:

  BELOW_CONF    a same-class box with good overlap exists, just under threshold.
                The model saw it. An operating-point choice, not blindness --
                and for a drowsiness detector, missing an eye-closure is worse
                than a false alarm, so this is a product decision to revisit.

  POOR_BOX      a same-class box overlaps the target but under IoU 0.5. The model
                found the object and drew it differently. This is the mode that
                would implicate the dataset's documented 2.2x annotation-looseness
                inconsistency between closed_eye and open_eye (BOOK.md Ch. II)
                rather than the model -- so the predicted/GT area ratio is
                reported for these, which tests that directly.

  WRONG_CLASS   something is detected right there, labelled as another class.
                Confusable-class problem (open vs closed eye, open mouth vs yawn).

  BLIND         nothing of that class anywhere near it at any confidence. Only
                this category is genuine detection failure that more or better
                training data could fix.

Only BLIND (and partly WRONG_CLASS) argues for the pseudo-label completion of
BOOK.md D2. A result dominated by POOR_BOX would mean the ceiling is largely an
annotation-geometry artifact and label completion would not help -- which is why
this runs before any dataset work, not after.

Read-only: touches no labels, no images, no checkpoints.

Usage
-----
    python src/diagnose_misses.py                      # best model, full test split
    python src/diagnose_misses.py --limit 300          # quick smoke test
    python src/diagnose_misses.py --model yolo26n-3-fresh-640
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
                       run_inference, source_family, build_ignore_rules,
                       IOU_THRESH, OP_THRESH, NUM_CLASSES)

# A same-class box overlapping this little is not "the same object drawn badly",
# it is a different detection that happens to be nearby.
POOR_BOX_MIN_IOU = 0.10

CAUSES = ["BELOW_CONF", "POOR_BOX", "WRONG_CLASS", "BLIND"]


def classify_miss(gt_box, gt_class, detections, matched_det_ids):
    """
    Attribute one missed ground-truth box to a single cause. Order matters:
    a detection the model made and merely scored low is a different failure from
    one it never made, so BELOW_CONF is tested before the weaker evidence.
    """
    best_same_iou, best_same_conf, best_same_ratio = 0.0, 0.0, None
    best_other_iou, best_other_class = 0.0, None

    gt_area = max((gt_box[2] - gt_box[0]) * (gt_box[3] - gt_box[1]), 1e-9)

    for det_id, d in enumerate(detections):
        box = (d["x1"], d["y1"], d["x2"], d["y2"])
        iou = compute_iou(box, gt_box)
        if iou <= 0:
            continue
        if d["class_id"] == gt_class:
            if iou > best_same_iou:
                area = max((box[2] - box[0]) * (box[3] - box[1]), 1e-9)
                best_same_iou, best_same_conf = iou, d["confidence"]
                best_same_ratio = area / gt_area
        elif iou > best_other_iou:
            best_other_iou, best_other_class = iou, d["class_id"]

    if best_same_iou >= IOU_THRESH:
        # Good box of the right class existed. Either it scored under the
        # operating threshold, or it was already consumed matching a different
        # GT box (greedy assignment) -- both mean the model was not blind here.
        return "BELOW_CONF", best_same_iou, best_same_conf, best_same_ratio, None
    if best_same_iou >= POOR_BOX_MIN_IOU:
        return "POOR_BOX", best_same_iou, best_same_conf, best_same_ratio, None
    if best_other_iou >= IOU_THRESH:
        return "WRONG_CLASS", best_other_iou, 0.0, None, best_other_class
    return "BLIND", best_same_iou, best_same_conf, best_same_ratio, None


def diagnose(model_key, images_dir, labels_dir, limit=None):
    cfg = MODEL_REGISTRY[model_key]
    ckpt = cfg["checkpoint"]
    if not ckpt.exists():
        print(f"ERROR: checkpoint not found: {ckpt}")
        return None

    print(f"[DIAGNOSE] {cfg['display_name']}")
    model = load_yolo_model(ckpt)

    image_paths = sorted(list(images_dir.glob("*.jpg")) + list(images_dir.glob("*.png")))
    if limit:
        image_paths = image_paths[:limit]

    ignore_by_image, _ = build_ignore_rules(image_paths, labels_dir)

    counts = defaultdict(lambda: defaultdict(int))    # class -> cause -> n
    ratios = defaultdict(list)                        # class -> predicted/GT area ratio (POOR_BOX)
    near_confs = defaultdict(list)                    # class -> confidence of the below-threshold box
    poor_ious = defaultdict(list)
    confusions = defaultdict(int)                     # (gt_class, pred_class) -> n
    total_gt = defaultdict(int)
    examples = defaultdict(list)
    # Attribute every miss to the source corpus it came from. The area_frac of a
    # box is confounded by crop scale -- an extreme mouth crop yields a huge
    # area_frac for a perfectly ordinary annotation -- so corpus attribution is
    # what separates "the corpora disagree on the convention" from "the corpora
    # frame their images differently".
    by_family = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))  # fam -> cls -> cause -> n
    fam_gt = defaultdict(lambda: defaultdict(int))                          # fam -> cls -> gt count
    fam_ratio = defaultdict(list)                                            # fam -> predicted/GT area ratios

    for img_idx, img_path in enumerate(image_paths):
        detections, shape = run_inference(model, "yolo", img_path, conf_threshold=0.001)
        if shape is None:
            continue
        h, w = shape
        gt = load_ground_truth(labels_dir / (img_path.stem + ".txt"), w, h)
        if not gt:
            continue
        fam = source_family(img_path.stem)
        for g in gt:
            total_gt[g["class_id"]] += 1
            fam_gt[fam][g["class_id"]] += 1

        # Reproduce evaluate.py's operating-point matching exactly, so the miss
        # count reconciles with the numbers in the evaluation report.
        op_dets = sorted([d for d in detections if d["confidence"] >= OP_THRESH],
                          key=lambda d: -d["confidence"])
        gt_used = [False] * len(gt)
        matched_det_ids = set()
        for di, d in enumerate(op_dets):
            best_iou, best_j = 0.0, -1
            for j, g in enumerate(gt):
                if gt_used[j] or g["class_id"] != d["class_id"]:
                    continue
                iou = compute_iou((d["x1"], d["y1"], d["x2"], d["y2"]), g["box"])
                if iou > best_iou:
                    best_iou, best_j = iou, j
            if best_iou >= IOU_THRESH:
                gt_used[best_j] = True
                matched_det_ids.add(di)

        for j, g in enumerate(gt):
            if gt_used[j]:
                continue
            c = g["class_id"]
            cause, iou, conf, ratio, other = classify_miss(
                g["box"], c, detections, matched_det_ids)
            counts[c][cause] += 1
            by_family[fam][c][cause] += 1
            if cause == "POOR_BOX":
                poor_ious[c].append(iou)
                if ratio is not None:
                    ratios[c].append(ratio)
                    if c == 2:
                        fam_ratio[fam].append(ratio)
            elif cause == "BELOW_CONF":
                near_confs[c].append(conf)
            elif cause == "WRONG_CLASS" and other is not None:
                confusions[(c, other)] += 1
            if len(examples[cause]) < 6:
                examples[cause].append(f"{CLASSES[c]}  {img_path.name}")

        if (img_idx + 1) % 500 == 0:
            print(f"  ...{img_idx + 1}/{len(image_paths)}")

    return {
        "model_key": model_key, "display_name": cfg["display_name"],
        "num_images": len(image_paths),
        "counts": counts, "ratios": ratios, "near_confs": near_confs,
        "poor_ious": poor_ious, "confusions": confusions,
        "total_gt": total_gt, "examples": examples,
        "by_family": by_family, "fam_gt": fam_gt, "fam_ratio": fam_ratio,
    }


def report(r):
    lines = []
    A = lines.append
    A("=" * 92)
    A(f" MISSED-DETECTION DIAGNOSIS -- {r['display_name']}")
    A("=" * 92)
    A("")
    A(f"Images evaluated : {r['num_images']}")
    A(f"Operating point  : conf >= {OP_THRESH}, IoU >= {IOU_THRESH}")
    A("")

    grand = {c: 0 for c in CAUSES}
    total_missed = 0
    A(f"{'Class':<13}{'GT':>7}{'MISSED':>8}   " + "".join(f"{c:>13}" for c in CAUSES))
    A("-" * 92)
    for ci in range(NUM_CLASSES):
        miss = sum(r["counts"][ci].values())
        total_missed += miss
        cells = ""
        for cause in CAUSES:
            n = r["counts"][ci][cause]
            grand[cause] += n
            pct = 100 * n / miss if miss else 0
            cells += f"{n:>7} {pct:>4.0f}%"
        A(f"{CLASSES[ci]:<13}{r['total_gt'][ci]:>7}{miss:>8}   {cells}")
    A("-" * 92)
    cells = "".join(f"{grand[c]:>7} {100*grand[c]/max(total_missed,1):>4.0f}%" for c in CAUSES)
    A(f"{'TOTAL':<13}{sum(r['total_gt'].values()):>7}{total_missed:>8}   {cells}")
    A("")

    A("INTERPRETATION")
    A("-" * 92)
    fixable_by_threshold = grand["BELOW_CONF"]
    geometry = grand["POOR_BOX"]
    real = grand["BLIND"]
    A(f"  Model saw it, scored it too low   : {fixable_by_threshold:>5}  "
      f"({100*fixable_by_threshold/max(total_missed,1):.1f}%)  -> operating-point decision")
    A(f"  Found it, drew the box differently: {geometry:>5}  "
      f"({100*geometry/max(total_missed,1):.1f}%)  -> annotation geometry / IoU threshold")
    A(f"  Detected as the wrong class       : {grand['WRONG_CLASS']:>5}  "
      f"({100*grand['WRONG_CLASS']/max(total_missed,1):.1f}%)  -> class confusion")
    A(f"  Genuinely did not see it          : {real:>5}  "
      f"({100*real/max(total_missed,1):.1f}%)  -> only this needs more/better data")
    A("")

    if any(r["ratios"].values()):
        A("BOX-GEOMETRY CHECK (POOR_BOX cases: predicted area / ground-truth area)")
        A("-" * 92)
        A("  A ratio far from 1.0 means the model and the annotator disagree on how big")
        A("  the object is -- the signature of BOOK.md D4, not of a model that cannot see.")
        A("")
        for ci in range(NUM_CLASSES):
            v = r["ratios"][ci]
            if not v:
                continue
            v = np.array(v)
            iou = np.array(r["poor_ious"][ci])
            A(f"  {CLASSES[ci]:<12} n={len(v):>5}   median ratio={np.median(v):>6.2f}   "
              f"p25={np.percentile(v,25):>5.2f} p75={np.percentile(v,75):>5.2f}   "
              f"median IoU={np.median(iou):.3f}")
        A("")

    if any(r["near_confs"].values()):
        A("BELOW-THRESHOLD CONFIDENCES (how close were they?)")
        A("-" * 92)
        for ci in range(NUM_CLASSES):
            v = r["near_confs"][ci]
            if not v:
                continue
            v = np.array(v)
            A(f"  {CLASSES[ci]:<12} n={len(v):>5}   median conf={np.median(v):.3f}   "
              f"share above 0.20: {100*np.mean(v >= 0.20):.0f}%")
        A("")

    if r["confusions"]:
        A("CLASS CONFUSION (ground truth -> what was predicted there)")
        A("-" * 92)
        for (gc, pc), n in sorted(r["confusions"].items(), key=lambda kv: -kv[1]):
            A(f"  {CLASSES[gc]:<12} -> {CLASSES[pc]:<12} {n:>5}")
        A("")

    A("YAWNING MISSES BY SOURCE CORPUS (does one corpus own the box failures?)")
    A("-" * 92)
    A(f"{'family':<16}{'yawn GT':>9}{'POOR_BOX':>10}{'% of GT':>9}{'BELOW_CONF':>12}"
      f"{'BLIND':>7}{'median pred/GT area':>21}")
    for fam in sorted(r["fam_gt"], key=lambda f: -r["by_family"][f][2]["POOR_BOX"]):
        g = r["fam_gt"][fam][2]
        if g == 0:
            continue
        pb = r["by_family"][fam][2]["POOR_BOX"]
        rat = r["fam_ratio"].get(fam, [])
        rs = f"{np.median(rat):.2f}" if rat else "-"
        A(f"{fam:<16}{g:>9}{pb:>10}{100*pb/g:>8.1f}%"
          f"{r['by_family'][fam][2]['BELOW_CONF']:>12}{r['by_family'][fam][2]['BLIND']:>7}{rs:>21}")
    A("")
    A("=" * 92)
    return "\n".join(lines)


def parse_args():
    p = argparse.ArgumentParser(description="Diagnose why detections are missed")
    p.add_argument("--model", default="yolo26n-2-finetune",
                    help="Key from configs/checkpoints.yaml (default: the best checkpoint)")
    p.add_argument("--split", default="test", choices=["test", "val"])
    p.add_argument("--limit", type=int, default=None)
    return p.parse_args()


def main():
    args = parse_args()
    if args.model not in MODEL_REGISTRY:
        print(f"ERROR: unknown model '{args.model}'. Known: {list(MODEL_REGISTRY)}")
        return
    images_dir, labels_dir = resolve_test_split(split=args.split)
    r = diagnose(args.model, images_dir, labels_dir, limit=args.limit)
    if r is None:
        return

    text = report(r)
    print("\n" + text)

    out_dir = derive_test_result_dir(MODEL_REGISTRY[args.model]["checkpoint"]) / "missed-detection-analysis"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"missed_analysis_{args.split}.txt").write_text(text, encoding="utf-8")

    payload = {
        "model": args.model, "split": args.split, "num_images": r["num_images"],
        "counts": {CLASSES[c]: dict(v) for c, v in r["counts"].items()},
        "total_gt": {CLASSES[c]: n for c, n in r["total_gt"].items()},
        "poor_box_area_ratio_median": {
            CLASSES[c]: float(np.median(v)) for c, v in r["ratios"].items() if v},
        "below_conf_median": {
            CLASSES[c]: float(np.median(v)) for c, v in r["near_confs"].items() if v},
        "confusions": {f"{CLASSES[a]}->{CLASSES[b]}": n for (a, b), n in r["confusions"].items()},
        "examples": {k: v for k, v in r["examples"].items()},
    }
    (out_dir / f"missed_analysis_{args.split}.json").write_text(
        json.dumps(payload, indent=2), encoding="utf-8")
    print(f"  -> {out_dir}")


if __name__ == "__main__":
    main()
