"""
utils/metrics.py
----------------
Object-detection evaluation metrics, implemented from scratch.

A prediction is a True Positive only if:
    (1) its class matches a ground-truth box's class, AND
    (2) its IoU with that (still-unmatched) GT box >= iou_thresh.
Each GT box can be matched at most once; extra overlapping predictions are
False Positives. This is why detection uses mAP, not plain accuracy: accuracy
has no notion of localization or of matching many predictions to many objects.
"""

import numpy as np
import torch

from utils.box_utils import box_iou
import config


def _to_np(x):
    return x.detach().cpu().numpy() if torch.is_tensor(x) else np.asarray(x)


def compute_ap(recall, precision):
    """Area under the precision-recall curve (all-point interpolation)."""
    mrec = np.concatenate(([0.0], recall, [1.0]))
    mpre = np.concatenate(([0.0], precision, [0.0]))
    # make precision monotonically decreasing
    for i in range(len(mpre) - 1, 0, -1):
        mpre[i - 1] = max(mpre[i - 1], mpre[i])
    idx = np.where(mrec[1:] != mrec[:-1])[0]
    return float(np.sum((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]))


def evaluate_detections(preds, gts, iou_thresh=0.5, num_fg=config.NUM_FG_CLASSES):
    """
    preds, gts : lists (one entry per image).
        preds[i] = {"boxes":[P,4], "labels":[P], "scores":[P]}
        gts[i]   = {"boxes":[G,4], "labels":[G]}
    Returns a dict with per-class AP, mAP, micro precision/recall/F1, mean IoU.
    """
    aps = {}
    total_tp = total_fp = total_fn = 0
    matched_ious = []

    for c in range(1, num_fg + 1):          # foreground classes: 1..num_fg
        # collect all predictions of class c across images, with image index
        scores, img_ids, boxes = [], [], []
        n_gt = 0
        gt_by_img = {}
        for i, g in enumerate(gts):
            gl = _to_np(g["labels"]); gb = _to_np(g["boxes"])
            mask = gl == c
            gt_by_img[i] = {"boxes": gb[mask], "used": np.zeros(mask.sum(), bool)}
            n_gt += int(mask.sum())
        for i, p in enumerate(preds):
            pl = _to_np(p["labels"]); ps = _to_np(p["scores"]); pb = _to_np(p["boxes"])
            mask = pl == c
            for s, b in zip(ps[mask], pb[mask]):
                scores.append(s); img_ids.append(i); boxes.append(b)

        if n_gt == 0:
            aps[config.MODEL_LABELS[c]] = float("nan")
            continue

        # sort this class's predictions by score, high to low
        order = np.argsort(-np.asarray(scores)) if scores else np.array([], int)
        tp = np.zeros(len(order)); fp = np.zeros(len(order))

        for rank, k in enumerate(order):
            i = img_ids[k]
            gb = gt_by_img[i]["boxes"]
            if len(gb) == 0:
                fp[rank] = 1
                continue
            ious = box_iou(torch.tensor(boxes[k]).float().unsqueeze(0),
                           torch.tensor(gb).float())[0].numpy()
            j = int(ious.argmax())
            if ious[j] >= iou_thresh and not gt_by_img[i]["used"][j]:
                tp[rank] = 1
                gt_by_img[i]["used"][j] = True
                matched_ious.append(float(ious[j]))
            else:
                fp[rank] = 1

        tp_cum = np.cumsum(tp); fp_cum = np.cumsum(fp)
        recall = tp_cum / (n_gt + 1e-9)
        precision = tp_cum / (tp_cum + fp_cum + 1e-9)
        aps[config.MODEL_LABELS[c]] = compute_ap(recall, precision)

        total_tp += int(tp.sum()); total_fp += int(fp.sum())
        total_fn += n_gt - int(tp.sum())

    valid = [v for v in aps.values() if not np.isnan(v)]
    mAP = float(np.mean(valid)) if valid else 0.0
    precision = total_tp / (total_tp + total_fp + 1e-9)
    recall = total_tp / (total_tp + total_fn + 1e-9)
    f1 = 2 * precision * recall / (precision + recall + 1e-9)

    return {
        "AP_per_class": aps,
        "mAP@0.5": mAP,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "mean_iou": float(np.mean(matched_ious)) if matched_ious else 0.0,
    }


def compute_map_range(preds, gts, thresholds=None):
    """mAP averaged over IoU thresholds 0.50, 0.55, ..., 0.95 (COCO-style)."""
    if thresholds is None:
        thresholds = np.arange(0.5, 1.0, 0.05)
    maps = [evaluate_detections(preds, gts, iou_thresh=t)["mAP@0.5"] for t in thresholds]
    return float(np.mean(maps))


def confusion_matrix(preds, gts, iou_thresh=0.5, num_classes=config.NUM_CLASSES):
    """
    Confusion matrix over MATCHED detections (rows = GT class, cols = pred class).
    Index 0 = background: row 0 = false positives, col 0 = missed GTs.
    """
    cm = np.zeros((num_classes, num_classes), int)
    for p, g in zip(preds, gts):
        gb = _to_np(g["boxes"]); gl = _to_np(g["labels"])
        pb = _to_np(p["boxes"]); pl = _to_np(p["labels"])
        used = np.zeros(len(gb), bool)
        # match each prediction to the best unused GT
        order = np.argsort(-_to_np(p["scores"])) if len(pl) else []
        for k in order:
            if len(gb) == 0:
                cm[0, pl[k]] += 1; continue
            ious = box_iou(torch.tensor(pb[k]).float().unsqueeze(0),
                           torch.tensor(gb).float())[0].numpy()
            j = int(ious.argmax())
            if ious[j] >= iou_thresh and not used[j]:
                cm[gl[j], pl[k]] += 1; used[j] = True
            else:
                cm[0, pl[k]] += 1          # unmatched prediction -> false positive
        for j in range(len(gb)):
            if not used[j]:
                cm[gl[j], 0] += 1          # missed GT -> predicted background
    return cm
