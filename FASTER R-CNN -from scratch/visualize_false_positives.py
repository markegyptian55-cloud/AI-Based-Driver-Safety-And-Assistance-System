"""
visualize_false_positives.py
----------------------------
Diagnose WHY precision is ~0.71: render every false-positive detection on the
test images and split it into two buckets so you can tell model errors from
label gaps.

A prediction is scored with the SAME rule test.py / utils.metrics use:
    TP  = IoU >= --iou with an unused GT box of the SAME class
    FP  = anything else
Each FP is then categorized by its best IoU against ANY ground-truth box
(regardless of class):

    PHANTOM  (max IoU over ALL GT  <  --overlap-iou)
        The model found an object where NOTHING is annotated. On a merged
        multi-source dataset these are usually REAL eyes/mouths the annotator
        left unlabeled -> the "false positive" is actually correct, and your
        true precision is higher than the metric says. This is the bucket that
        tests the labeling theory.

    OVERLAP  (max IoU over ALL GT  >= --overlap-iou)
        The FP sits on top of a real annotated object: a duplicate box, a
        loosely-localized box (right object, IoU < 0.5), or a wrong-class call.
        These are genuine model errors, not label gaps.

Missed ground-truth boxes (false negatives) are drawn too, so each image tells
the whole story.

Drawing key (BGR):
    white  thin      = ground truth (matched)
    white  dashed-ish= ground truth MISSED (false negative)
    green  thin      = true-positive prediction
    magenta thick    = FALSE POSITIVE - phantom  (candidate unlabeled object)
    yellow thick     = FALSE POSITIVE - overlap  (dup / loose / wrong class)

Outputs:
    results/false_positives/<rank>_<nphantom>ph_<id>.jpg   worst images first
    results/false_positives/_summary.csv                   per-image counts
    prints dataset-wide totals (sanity-check against the confusion matrix)

Usage:
    python visualize_false_positives.py --checkpoint checkpoints/best.pth
    python visualize_false_positives.py --num 60 --sort phantom --min-score 0.5
"""

import os
import csv
import argparse

import cv2
import numpy as np
import torch
from torch.utils.data import DataLoader

import config
from dataset import load_split, DrowsinessDataset, collate_fn
from models.faster_rcnn import FasterRCNN
from utils.gpu_utils import select_device
from utils.box_utils import box_iou


# --------------------------------------------------------------------------
# inference (same shape as test.run_test)
# --------------------------------------------------------------------------
@torch.no_grad()
def run_inference(model, loader, device):
    model.eval()
    preds, gts, ids = [], [], []
    for images, targets in loader:
        images = images.to(device)
        dets = model(images)
        for det, tgt in zip(dets, targets):
            preds.append({k: v.cpu().numpy() for k, v in det.items()})
            gts.append({"boxes": tgt["boxes"].numpy(), "labels": tgt["labels"].numpy()})
            ids.append(tgt["image_id"])
    return preds, gts, ids


def _iou_matrix(boxes_a, boxes_b):
    """[Na,4] x [Nb,4] -> [Na,Nb] IoU. Empty-safe."""
    if len(boxes_a) == 0 or len(boxes_b) == 0:
        return np.zeros((len(boxes_a), len(boxes_b)), np.float32)
    ta = torch.as_tensor(boxes_a, dtype=torch.float32)
    tb = torch.as_tensor(boxes_b, dtype=torch.float32)
    return box_iou(ta, tb).numpy()


def classify_image(pred, gt, iou_thresh, overlap_iou, min_score):
    """
    Reproduce metrics.evaluate_detections matching for ONE image and record the
    fate of every prediction and GT box.

    Returns dict of index lists:
        tp        : prediction indices that are true positives
        fp_phantom: FP indices with no GT overlap (likely unlabeled object)
        fp_overlap: FP indices that overlap some GT (dup / loose / wrong class)
        fn        : GT indices never matched (missed)
    """
    pb, pl, ps = pred["boxes"], pred["labels"], pred["scores"]
    gb, gl = gt["boxes"], gt["labels"]

    keep = ps >= min_score
    p_idx = np.nonzero(keep)[0]

    used = np.zeros(len(gb), bool)          # GT matched flag (any class)
    tp, fp_phantom, fp_overlap = [], [], []

    # IoU of every kept prediction against every GT (any class), computed once
    iou_all = _iou_matrix(pb[p_idx], gb)    # [P_kept, G]

    # process per class, high score first (matches metrics.py ordering)
    for c in range(1, config.NUM_FG_CLASSES + 1):
        # kept predictions of class c, sorted by score desc
        cls_local = [k for k, gi in enumerate(p_idx) if pl[gi] == c]
        cls_local.sort(key=lambda k: -ps[p_idx[k]])
        gt_c = np.nonzero(gl == c)[0]       # GT indices of class c

        for k in cls_local:
            row = iou_all[k]
            # best same-class, currently-unused GT
            best_j, best_iou = -1, 0.0
            for j in gt_c:
                if not used[j] and row[j] > best_iou:
                    best_iou, best_j = row[j], j
            if best_j >= 0 and best_iou >= iou_thresh:
                used[best_j] = True
                tp.append(p_idx[k])
            else:
                # false positive: does it overlap ANY GT (any class)?
                max_any = row.max() if len(gb) else 0.0
                if max_any >= overlap_iou:
                    fp_overlap.append(p_idx[k])
                else:
                    fp_phantom.append(p_idx[k])

    fn = [j for j in range(len(gb)) if not used[j]]
    return {"tp": tp, "fp_phantom": fp_phantom, "fp_overlap": fp_overlap, "fn": fn}


# --------------------------------------------------------------------------
# drawing
# --------------------------------------------------------------------------
def _box(img, b, color, thick, text=None, text_below=False):
    x1, y1, x2, y2 = [int(v) for v in b]
    cv2.rectangle(img, (x1, y1), (x2, y2), color, thick)
    if text:
        if text_below:
            cv2.putText(img, text, (x1, min(y2 + 13, img.shape[0] - 2)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
        else:
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            yb = max(y1, th + 4)
            cv2.rectangle(img, (x1, yb - th - 4), (x1 + tw + 2, yb), color, -1)
            cv2.putText(img, text, (x1 + 1, yb - 3),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1)


WHITE   = (255, 255, 255)
GREEN   = (0, 200, 0)
MAGENTA = (255, 0, 255)
YELLOW  = (0, 220, 220)


def render(img, pred, gt, cats):
    pb, pl, ps = pred["boxes"], pred["labels"], pred["scores"]
    gb, gl = gt["boxes"], gt["labels"]
    fn = set(cats["fn"])

    # ground truth first (so predictions draw on top)
    for j in range(len(gb)):
        name = config.MODEL_LABELS[int(gl[j])]
        if j in fn:
            _box(img, gb[j], WHITE, 1, f"MISS:{name}", text_below=True)
            # corner ticks to make missed GT stand out
            x1, y1, x2, y2 = [int(v) for v in gb[j]]
            cv2.line(img, (x1, y1), (x1 + 8, y1), WHITE, 2)
            cv2.line(img, (x2 - 8, y2), (x2, y2), WHITE, 2)
        else:
            _box(img, gb[j], WHITE, 1, f"GT:{name}", text_below=True)

    for i in cats["tp"]:
        _box(img, pb[i], GREEN, 1,
             f"{config.MODEL_LABELS[int(pl[i])]} {int(ps[i]*100)}%")
    for i in cats["fp_overlap"]:
        _box(img, pb[i], YELLOW, 2,
             f"FP-ovl {config.MODEL_LABELS[int(pl[i])]} {int(ps[i]*100)}%")
    for i in cats["fp_phantom"]:
        _box(img, pb[i], MAGENTA, 2,
             f"FP? {config.MODEL_LABELS[int(pl[i])]} {int(ps[i]*100)}%")
    return img


def legend(img):
    lines = [
        (WHITE,   "white = ground truth (MISS = missed)"),
        (GREEN,   "green = correct detection (TP)"),
        (MAGENTA, "magenta = FP, no GT near -> likely UNLABELED object"),
        (YELLOW,  "yellow = FP over a GT -> dup / loose box / wrong class"),
    ]
    y = 16
    for color, text in lines:
        cv2.putText(img, text, (6, y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 3)
        cv2.putText(img, text, (6, y), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
        y += 16
    return img


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=f"{config.CKPT_DIR}/best.pth")
    ap.add_argument("--device", default=None)
    ap.add_argument("--iou", type=float, default=0.5,
                    help="IoU threshold for a TP match (same as test.py)")
    ap.add_argument("--overlap-iou", type=float, default=0.3,
                    help="FP with best-GT IoU below this = PHANTOM (unlabeled?)")
    ap.add_argument("--min-score", type=float, default=config.SCORE_THRESH,
                    help="ignore detections below this confidence")
    ap.add_argument("--num", type=int, default=40,
                    help="how many images to save (worst first)")
    ap.add_argument("--sort", choices=["phantom", "overlap", "fp", "fn"],
                    default="phantom", help="rank images by this count, desc")
    ap.add_argument("--out", default=os.path.join(config.RESULTS_DIR, "false_positives"))
    args = ap.parse_args()

    device = select_device(args.device)
    os.makedirs(args.out, exist_ok=True)

    test_ds = DrowsinessDataset(load_split(f"{config.SPLITS_DIR}/test.txt"), train=False)
    loader = DataLoader(test_ds, batch_size=config.BATCH_SIZE, shuffle=False,
                        collate_fn=collate_fn, num_workers=4)
    print(f"test images: {len(test_ds)}")

    model = FasterRCNN().to(device)
    ckpt = torch.load(args.checkpoint, map_location=device)
    model.load_state_dict(ckpt["model"])
    print(f"loaded {args.checkpoint} (epoch {ckpt.get('epoch', '?')})")

    preds, gts, ids = run_inference(model, loader, device)

    # classify every image
    rows = []
    tot = {"tp": 0, "fp_phantom": 0, "fp_overlap": 0, "fn": 0}
    per_image = []
    for pred, gt, name in zip(preds, gts, ids):
        cats = classify_image(pred, gt, args.iou, args.overlap_iou, args.min_score)
        n = {k: len(v) for k, v in cats.items()}
        for k in tot:
            tot[k] += n[k]
        per_image.append((name, pred, gt, cats, n))
        rows.append([name, n["tp"], n["fp_phantom"], n["fp_overlap"], n["fn"]])

    # ---- dataset-wide summary ----
    total_fp = tot["fp_phantom"] + tot["fp_overlap"]
    print("\n===== FALSE-POSITIVE BREAKDOWN "
          f"(score>={args.min_score}, IoU@{args.iou}) =====")
    print(f"true positives         : {tot['tp']}")
    print(f"false positives (total): {total_fp}")
    if total_fp:
        print(f"   - PHANTOM (no GT near) : {tot['fp_phantom']:6d}"
              f"   ({100*tot['fp_phantom']/total_fp:.1f}% of FPs)  <- likely unlabeled objects")
        print(f"   - OVERLAP (dup/loose/cls): {tot['fp_overlap']:6d}"
              f"   ({100*tot['fp_overlap']/total_fp:.1f}% of FPs)  <- genuine model errors")
    print(f"missed GT (false neg)  : {tot['fn']}")
    prec = tot["tp"] / (tot["tp"] + total_fp + 1e-9)
    prec_if_phantom_ok = tot["tp"] / (tot["tp"] + tot["fp_overlap"] + 1e-9)
    print(f"\nprecision as measured            : {prec:.3f}")
    print(f"precision IF phantoms are real   : {prec_if_phantom_ok:.3f}"
          "   (upper bound if every magenta box is a true unlabeled object)")

    # ---- per-image CSV ----
    csv_path = os.path.join(args.out, "_summary.csv")
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["image_id", "tp", "fp_phantom", "fp_overlap", "fn"])
        w.writerows(rows)
    print(f"\nper-image counts -> {csv_path}")

    # ---- save worst images ----
    key = {"phantom": "fp_phantom", "overlap": "fp_overlap",
           "fp": None, "fn": "fn"}[args.sort]
    if args.sort == "fp":
        rank = lambda t: t[4]["fp_phantom"] + t[4]["fp_overlap"]
    else:
        rank = lambda t: t[4][key]
    per_image.sort(key=rank, reverse=True)

    saved = 0
    for name, pred, gt, cats, n in per_image:
        if rank((name, pred, gt, cats, n)) == 0:
            break  # nothing interesting left
        path = os.path.join(config.IMAGES_DIR, name)
        img = cv2.imread(path)
        if img is None:
            continue
        img = cv2.resize(img, (config.IMG_SIZE, config.IMG_SIZE))  # boxes are in 640 space
        render(img, pred, gt, cats)
        legend(img)
        out_name = f"{saved:03d}_{n['fp_phantom']}ph_{n['fp_overlap']}ov_{name}"
        if not out_name.lower().endswith((".jpg", ".jpeg", ".png")):
            out_name += ".jpg"
        cv2.imwrite(os.path.join(args.out, out_name), img)
        saved += 1
        if saved >= args.num:
            break
    print(f"saved {saved} annotated images -> {args.out}")
    print("\nHOW TO READ: open the images sorted first (most magenta boxes).")
    print("If the magenta 'FP?' boxes sit on real eyes/mouths with no white GT")
    print("box, those are label gaps, not model errors -- your true precision is")
    print("closer to the 'precision IF phantoms are real' number above.")


if __name__ == "__main__":
    main()
