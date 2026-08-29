"""
evaluate.py — Real Model Evaluation & Report Generator
============================================================
Project : nano big -- driver drowsiness detection (closed_eye/open_eye/yawning)

(Renamed from validation.py, BOOK.md Chapter 2 SS2.10.) Runs a trained
checkpoint against the real test split defined in data/Dataset-Main/data.yaml
(5,589 images, 11.03% of the dataset), computes real detection metrics
(mAP@50, per-class precision/recall/F1, confusion matrix), and writes:

  INFO/<family>/<N-name>-test-result/tested-images/evaluation_report.txt
  INFO/<family>/<N-name>-test-result/tested-images/test_summary.md
  INFO/<family>/<N-name>-test-result/tested-images/metrics.json
  INFO/<family>/<N-name>-test-result/tested-images/charts/*.png / *.jpg

...derived automatically from the checkpoint's own path (which train.py
writes as checkpoints/<family>/<N-name>/best.pt) -- see AGENTS.md / BOOK.md
Ch.2 SS2.10 for the full folder convention. A checkpoint outside that
convention (e.g. an ad hoc weights path) falls back to
INFO/_ad_hoc/<checkpoint-stem>-test-result/tested-images/.

Model loading, checkpoint paths, and detection-format extraction are
imported directly from demo_video.py so both scripts can never drift
out of sync with each other.

Usage
-----
    python src/evaluate.py --weights checkpoints/yolo26n/1-baseline/best.pt --limit 200   # smoke test first
    python src/evaluate.py --weights checkpoints/yolo26n/1-baseline/best.pt               # full test set
    python src/evaluate.py --model all                                                     # every configs/checkpoints.yaml entry
"""

from __future__ import annotations

import re
import sys
import shutil
import argparse
from pathlib import Path
from collections import defaultdict

import numpy as np
import cv2

import matplotlib
matplotlib.use("Agg")   # headless — no display needed
import matplotlib.pyplot as plt

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from demo_video import (
    MODEL_REGISTRY, CLASSES, CLASS_SHORT, COLOR_MAP,
    load_yolo_model, load_rfdetr_model,
    extract_yolo_detections, extract_rfdetr_detections,
    derive_test_result_dir,
)

NUM_CLASSES = len(CLASSES)
IOU_THRESH = 0.5
OP_THRESH = 0.35   # same operating confidence demo_video.py uses, for the confusion matrix / single-number metrics


# ============================================================
# GEOMETRY / DATA LOADING
# ============================================================

def compute_iou(box_a, box_b):
    xa1, ya1, xa2, ya2 = box_a
    xb1, yb1, xb2, yb2 = box_b
    ix1, iy1 = max(xa1, xb1), max(ya1, yb1)
    ix2, iy2 = min(xa2, xb2), min(ya2, yb2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = max(0.0, xa2 - xa1) * max(0.0, ya2 - ya1)
    area_b = max(0.0, xb2 - xb1) * max(0.0, yb2 - yb1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def load_ground_truth(label_path: Path, img_w: int, img_h: int):
    """YOLO-format .txt (class cx cy w h, normalized) -> pixel xyxy boxes."""
    gt = []
    if not label_path.exists():
        return gt
    for line in label_path.read_text().splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        cls_id = int(float(parts[0]))
        cx, cy, w, h = map(float, parts[1:5])
        x1 = (cx - w / 2) * img_w
        y1 = (cy - h / 2) * img_h
        x2 = (cx + w / 2) * img_w
        y2 = (cy + h / 2) * img_h
        gt.append({"class_id": cls_id, "box": (x1, y1, x2, y2)})
    return gt


DEFAULT_DATA_YAML = PROJECT_ROOT / "data" / "Dataset-Main" / "data.yaml"


def resolve_test_split(data_yaml: Path = DEFAULT_DATA_YAML, split: str = "test"):
    """
    Split was hardcoded to `test`, which made an apples-to-apples val-vs-test
    comparison impossible: val numbers came from Ultralytics' evaluator during
    training and test numbers from this one, so the ~6-point val->test gap could
    never be attributed to the data rather than to evaluator differences.
    """
    import yaml
    with open(data_yaml) as f:
        cfg = yaml.safe_load(f)
    base = Path(cfg["path"])
    if not base.is_absolute():
        base = PROJECT_ROOT / base
    images_dir = base / cfg[split]
    labels_dir = Path(str(images_dir).replace("images", "labels"))
    return images_dir, labels_dir


def run_inference(model, family, image_path, conf_threshold):
    if family == "yolo":
        frame = cv2.imread(str(image_path))
        if frame is None:
            return [], None
        result = model.predict(source=frame, conf=conf_threshold, verbose=False)[0]
        return extract_yolo_detections(result), frame.shape[:2]
    else:
        from PIL import Image
        pil_img = Image.open(image_path).convert("RGB")
        det = model.predict(pil_img, threshold=conf_threshold)
        return extract_rfdetr_detections(det), (pil_img.height, pil_img.width)


# ============================================================
# LABEL-GAP (PARTIAL-ANNOTATION) HANDLING
# ============================================================
#
# This dataset is a merge of a separate eye-state corpus and a separate yawning
# corpus into one 3-class label space, WITHOUT re-annotation (BOOK.md Chapter V):
# of 50,654 images only 1,263 are annotated for both. Training already accounts
# for this (source-aware negative-label handling, Phase 12B/12C); evaluation did
# not, so a correct detection of a present-but-never-annotated object was scored
# as a false positive.
#
# The fix is the standard partially-annotated-dataset "ignore region" method
# (COCO's iscrowd): predictions of a class that was never annotated on an image
# are excluded from scoring entirely -- neither true nor false positive. Ground
# truth, TP and FN counts are untouched, so recall cannot be inflated.
#
# The rule below is deliberately CONSERVATIVE and is grounded in the project's
# own documented crop tiers (BOOK.md Ch. II, lines 2647-2678), not invented for
# this script. A missing class only counts as a label gap where the object must
# physically be in frame:
#
#   Tier A (max GT box area fraction < 0.06) -- wide/full-frame view, so a face
#       is in frame and its eyes necessarily are too. Zero eye labels here is a
#       genuine annotation gap.
#   Tier B (0.06-0.50) -- moderate crop, genuinely ambiguous (could be a face
#       crop or a large mouth crop). Left alone on purpose.
#   Tier C (>= 0.50)  -- extreme single-object crop. Verified by inspection that
#       e.g. yawn_new_* images are mouth-only crops with no eyes in frame at all,
#       so the absence of eye labels there is CORRECT, not a gap. Left alone.
#
# Yawning is treated asymmetrically because the classes are asymmetric, exactly
# as BOOK.md Chapter III notes: eyes are always a valid target when a face is
# visible, but a mouth is only a target when actively yawning -- so a missing
# yawn label usually means "not yawning", not "not annotated". Yawning is
# therefore only ignored in source corpora that contain zero yawning annotations
# anywhere (i.e. the class was structurally never in scope for that corpus).

EYE_CLASSES = {0, 1}
YAWN_CLASS = 2
TIER_A_MAX_AREA_FRAC = 0.06     # BOOK.md Ch. II tier boundary
MIN_FAMILY_SIZE = 15            # below this a family is too small to infer "never annotated"

_FAMILY_PREFIXES = (
    ("dd_v1_", "dd_v1"), ("closed_eye_", "closed_eye_corpus"), ("yawn_new_", "yawn_new"),
    ("yimg_", "Yimg"), ("img_", "img"), ("istockphoto", "istockphoto"), ("images-", "images-"),
)


def source_family(stem: str) -> str:
    """Source corpus a test image came from, per its filename provenance (BOOK.md 'The Corpus')."""
    n = stem.lower()
    for prefix, fam in _FAMILY_PREFIXES:
        if n.startswith(prefix):
            return fam
    if re.match(r"^_?\d+_jpg", n):
        return "bare_numeric"
    return "other_small"


def _read_label(label_path):
    """-> (set of class ids present, max box area fraction). Missing file = empty."""
    classes, max_area_frac = set(), 0.0
    if label_path.exists():
        for line in label_path.read_text().splitlines():
            parts = line.split()
            if len(parts) < 5:
                continue
            classes.add(int(float(parts[0])))
            max_area_frac = max(max_area_frac, float(parts[3]) * float(parts[4]))
    return classes, max_area_frac


def build_ignore_rules(image_paths, labels_dir):
    """
    Per-image set of class ids whose predictions must be excluded from scoring.
    Returns (ignore_by_image, stats) -- stats is reported alongside the metrics so
    the correction is always auditable rather than silently applied.
    """
    # Which corpora never annotate yawning is a property of the DATASET, so it is
    # derived from every label file in the split -- never from whatever subset is
    # being scored. Deriving it from the subset would let --limit silently change
    # the scoring rule (it does: on a 400-image head the answer is different).
    yawn_boxes_per_family, imgs_per_family = defaultdict(int), defaultdict(int)
    for label_path in labels_dir.glob("*.txt"):
        fam = source_family(label_path.stem)
        imgs_per_family[fam] += 1
        classes, _ = _read_label(label_path)
        if YAWN_CLASS in classes:
            yawn_boxes_per_family[fam] += 1

    # A corpus with zero yawning annotations across a meaningful number of images
    # never had yawning in scope -- absence there is structural, not "not yawning".
    yawn_blind = {f for f, n in imgs_per_family.items()
                  if n >= MIN_FAMILY_SIZE and yawn_boxes_per_family[f] == 0}

    families, gt_cache = [], []
    for img_path in image_paths:
        families.append(source_family(img_path.stem))
        gt_cache.append(_read_label(labels_dir / (img_path.stem + ".txt")))

    ignore_by_image, n_eye_ignored, n_yawn_ignored = [], 0, 0
    for (classes, max_area_frac), fam in zip(gt_cache, families):
        ignore = set()
        if max_area_frac < TIER_A_MAX_AREA_FRAC and not (classes & EYE_CLASSES):
            ignore |= EYE_CLASSES          # full frame, face in view, but eyes never labelled
            n_eye_ignored += 1
        if fam in yawn_blind:
            ignore.add(YAWN_CLASS)
            n_yawn_ignored += 1
        ignore_by_image.append(ignore)

    return ignore_by_image, {
        "eye_ignored_images": n_eye_ignored,
        "yawn_ignored_images": n_yawn_ignored,
        "yawn_blind_families": sorted(yawn_blind),
        "total_images": len(image_paths),
    }


# ============================================================
# CORE EVALUATION
# ============================================================

def compute_ap_per_class(preds_by_class, gt_by_image, num_gt_by_class, ignore_by_image=None):
    """
    All-point-interpolated AP@50 per class from the confidence-sorted predictions.
    When ignore_by_image is given, a prediction of class c on an image that never
    had class c annotated is dropped before the PR curve is built -- it counts as
    neither TP nor FP. Ground-truth counts are never touched, so recall (and
    therefore FN) is identical between the raw and corrected runs by construction.
    """
    ap_per_class, pr_curves = {}, {}

    for c in range(NUM_CLASSES):
        preds = sorted(preds_by_class[c], key=lambda x: -x[0])
        if ignore_by_image is not None:
            preds = [p for p in preds if c not in ignore_by_image[p[1]]]
        n_gt = num_gt_by_class[c]
        if n_gt == 0 or not preds:
            ap_per_class[c] = 0.0
            pr_curves[c] = (np.array([0.0]), np.array([0.0]), np.array([0.0]))
            continue

        gt_used_per_image = defaultdict(set)
        tp, fp = np.zeros(len(preds)), np.zeros(len(preds))
        confs = np.array([p[0] for p in preds])

        for i, (conf, img_idx, box) in enumerate(preds):
            gt = gt_by_image[img_idx]
            best_iou, best_j = 0.0, -1
            for j, g in enumerate(gt):
                if g["class_id"] != c or j in gt_used_per_image[img_idx]:
                    continue
                iou = compute_iou(box, g["box"])
                if iou > best_iou:
                    best_iou, best_j = iou, j
            if best_iou >= IOU_THRESH:
                tp[i] = 1
                gt_used_per_image[img_idx].add(best_j)
            else:
                fp[i] = 1

        tp_cum, fp_cum = np.cumsum(tp), np.cumsum(fp)
        recall = tp_cum / max(n_gt, 1)
        precision = tp_cum / np.maximum(tp_cum + fp_cum, 1e-9)

        mrec = np.concatenate(([0.0], recall, [1.0]))
        mpre = np.concatenate(([1.0], precision, [0.0]))
        for i in range(len(mpre) - 2, -1, -1):
            mpre[i] = max(mpre[i], mpre[i + 1])
        idx = np.where(mrec[1:] != mrec[:-1])[0]
        ap_per_class[c] = float(np.sum((mrec[idx + 1] - mrec[idx]) * mpre[idx + 1]))
        pr_curves[c] = (recall, precision, confs)

    return ap_per_class, pr_curves


def evaluate_model(model_key, model_cfg, images_dir, labels_dir, limit=None):
    """
    Two-pass evaluation:
      Pass 1 (conf=0.001, almost everything kept): builds the full
      precision-recall curve per class -> real AP@50 -> real mAP@50.
      Also builds a confusion matrix and single-number P/R/F1 at the
      OP_THRESH=0.35 operating point (same threshold demo_video.py
      renders with), by filtering pass-1 detections post-hoc.
    """
    family = model_cfg["family"]
    checkpoint = model_cfg["checkpoint"]
    if not checkpoint.exists():
        print(f"WARNING [{model_key}]: checkpoint not found, skipping.")
        return None

    print(f"\n[EVAL] {model_cfg['display_name']} ({family})")

    if family == "yolo":
        model = load_yolo_model(checkpoint)
    else:
        model = load_rfdetr_model(
            checkpoint, resolution=model_cfg["resolution"],
            rfdetr_class=model_cfg.get("rfdetr_class", "nano"),
        )

    image_paths = sorted(list(images_dir.glob("*.jpg")) + list(images_dir.glob("*.png")))
    if limit:
        image_paths = image_paths[:limit]
    if not image_paths:
        print(f"ERROR: no test images found in {images_dir}")
        return None

    ignore_by_image, ignore_stats = build_ignore_rules(image_paths, labels_dir)
    print(f"  label-gap rule: eyes ignored on {ignore_stats['eye_ignored_images']} images, "
          f"yawning on {ignore_stats['yawn_ignored_images']} "
          f"(yawn-blind corpora: {', '.join(ignore_stats['yawn_blind_families']) or 'none'})")

    preds_by_class = defaultdict(list)      # class_id -> [(confidence, img_idx, box)]
    gt_by_image = []                        # index-aligned to image_paths
    num_gt_by_class = defaultdict(int)
    confusion = np.zeros((NUM_CLASSES + 1, NUM_CLASSES + 1), dtype=np.int64)  # rows=GT, cols=Pred, last=background
    confusion_corrected = np.zeros_like(confusion)

    for img_idx, img_path in enumerate(image_paths):
        label_path = labels_dir / (img_path.stem + ".txt")

        detections, shape = run_inference(model, family, img_path, conf_threshold=0.001)
        if shape is None:
            gt_by_image.append([])
            continue
        h, w = shape
        gt = load_ground_truth(label_path, w, h)
        gt_by_image.append(gt)
        for g in gt:
            num_gt_by_class[g["class_id"]] += 1

        for d in detections:
            preds_by_class[d["class_id"]].append(
                (d["confidence"], img_idx, (d["x1"], d["y1"], d["x2"], d["y2"]))
            )

        # ---- operating-point confusion matrix (conf >= OP_THRESH only) ----
        op_dets = sorted([d for d in detections if d["confidence"] >= OP_THRESH],
                          key=lambda d: -d["confidence"])
        gt_used = [False] * len(gt)
        for d in op_dets:
            best_iou, best_j = 0.0, -1
            for j, g in enumerate(gt):
                if gt_used[j] or g["class_id"] != d["class_id"]:
                    continue
                iou = compute_iou((d["x1"], d["y1"], d["x2"], d["y2"]), g["box"])
                if iou > best_iou:
                    best_iou, best_j = iou, j
            if best_iou >= IOU_THRESH:
                gt_used[best_j] = True
                confusion[d["class_id"], d["class_id"]] += 1     # TP
                confusion_corrected[d["class_id"], d["class_id"]] += 1
            else:
                confusion[NUM_CLASSES, d["class_id"]] += 1        # FP
                # An ignored class has no ground truth on this image by
                # construction, so it can only ever land here -- drop it rather
                # than charge the model for detecting something real that the
                # source corpus simply never annotated.
                if d["class_id"] not in ignore_by_image[img_idx]:
                    confusion_corrected[NUM_CLASSES, d["class_id"]] += 1
        for j, g in enumerate(gt):
            if not gt_used[j]:
                confusion[g["class_id"], NUM_CLASSES] += 1        # FN
                confusion_corrected[g["class_id"], NUM_CLASSES] += 1

        if (img_idx + 1) % 500 == 0:
            print(f"  ...{img_idx + 1}/{len(image_paths)} images evaluated")

    # ---- full-curve AP per class -> mAP@50 ----
    # Scored twice off the SAME detections: raw (every prediction counts) and
    # label-gap-corrected (predictions of a never-annotated class are ignored).
    # One inference pass, two scorings, so the two numbers are exactly comparable
    # and the raw figure is always available next to the corrected one.
    ap_per_class, pr_curves = compute_ap_per_class(preds_by_class, gt_by_image, num_gt_by_class)
    map50 = float(np.mean(list(ap_per_class.values()))) if ap_per_class else 0.0

    ap_corrected, _ = compute_ap_per_class(
        preds_by_class, gt_by_image, num_gt_by_class, ignore_by_image=ignore_by_image)
    map50_corrected = float(np.mean(list(ap_corrected.values()))) if ap_corrected else 0.0

    # ---- operating-point precision/recall/F1 per class ----
    def op_metrics_from(cm):
        m = {}
        for c in range(NUM_CLASSES):
            tp = int(cm[c, c])
            fp = int(cm[NUM_CLASSES, c])
            fn = int(cm[c, NUM_CLASSES])
            precision = tp / max(tp + fp, 1)
            recall = tp / max(tp + fn, 1)
            f1 = 2 * precision * recall / max(precision + recall, 1e-9)
            m[c] = {"precision": precision, "recall": recall, "f1": f1, "tp": tp, "fp": fp, "fn": fn}
        return m

    op_metrics = op_metrics_from(confusion)
    op_metrics_corrected = op_metrics_from(confusion_corrected)

    overall_precision = float(np.mean([m["precision"] for m in op_metrics.values()]))
    overall_recall = float(np.mean([m["recall"] for m in op_metrics.values()]))
    overall_f1 = float(np.mean([m["f1"] for m in op_metrics.values()]))

    return {
        "model": model,
        "family": family,
        "model_key": model_key,
        "display_name": model_cfg["display_name"],
        "num_images": len(image_paths),
        "num_gt_by_class": dict(num_gt_by_class),
        "map50": map50,
        "ap_per_class": ap_per_class,
        "pr_curves": pr_curves,
        "confusion": confusion,
        "op_metrics": op_metrics,
        "overall_precision": overall_precision,
        "overall_recall": overall_recall,
        "overall_f1": overall_f1,
        "op_threshold": OP_THRESH,
        "sample_images": image_paths[:4],
        # Label-gap-corrected companions -- always reported ALONGSIDE the raw
        # numbers above, never in place of them.
        "map50_corrected": map50_corrected,
        "ap_corrected": ap_corrected,
        "op_metrics_corrected": op_metrics_corrected,
        "ignore_stats": ignore_stats,
    }


# ============================================================
# CHARTS  (10 files, saved into 10-visualizations/)
# ============================================================

def generate_charts(results, images_dir, labels_dir, out_dir: Path):
    if out_dir.exists():
        shutil.rmtree(out_dir)   # wipe any stale files from earlier script versions before writing fresh ones
    out_dir.mkdir(parents=True, exist_ok=True)
    model = results["model"]
    family = results["family"]
    r = results
    colors = [tuple(c / 255 for c in COLOR_MAP[i][::-1]) for i in range(NUM_CLASSES)]  # BGR->RGB, 0-1

    # 1. Confusion matrix
    cm = r["confusion"]
    labels = CLASSES + ["background"]
    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks(range(len(labels))); ax.set_xticklabels(labels, rotation=45, ha="right")
    ax.set_yticks(range(len(labels))); ax.set_yticklabels(labels)
    ax.set_xlabel("Predicted"); ax.set_ylabel("Ground Truth")
    ax.set_title(f"Confusion Matrix — {r['display_name']} (conf>={r['op_threshold']})")
    for i in range(len(labels)):
        for j in range(len(labels)):
            ax.text(j, i, int(cm[i, j]), ha="center", va="center",
                     color="white" if cm[i, j] > cm.max() / 2 else "black", fontsize=8)
    fig.colorbar(im, ax=ax)
    fig.tight_layout(); fig.savefig(out_dir / "01_confusion_matrix.png", dpi=140); plt.close(fig)

    # 2. Precision-Recall curve, all classes overlaid
    fig, ax = plt.subplots(figsize=(6, 5))
    for c in range(NUM_CLASSES):
        recall, precision, _ = r["pr_curves"][c]
        ax.plot(recall, precision, label=f"{CLASSES[c]} (AP={r['ap_per_class'][c]:.3f})", color=colors[c])
    ax.set_xlabel("Recall"); ax.set_ylabel("Precision")
    ax.set_title(f"Precision-Recall Curve — {r['display_name']}")
    ax.set_xlim(0, 1); ax.set_ylim(0, 1.02); ax.legend(); ax.grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(out_dir / "02_precision_recall_curve.png", dpi=140); plt.close(fig)

    # 3. Precision vs Confidence
    fig, ax = plt.subplots(figsize=(6, 5))
    for c in range(NUM_CLASSES):
        _, precision, confs = r["pr_curves"][c]
        if len(confs) > 1:
            ax.plot(confs, precision, label=CLASSES[c], color=colors[c])
    ax.set_xlabel("Confidence"); ax.set_ylabel("Precision")
    ax.set_title(f"Precision-Confidence — {r['display_name']}")
    ax.legend(); ax.grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(out_dir / "03_precision_confidence_curve.png", dpi=140); plt.close(fig)

    # 4. Recall vs Confidence
    fig, ax = plt.subplots(figsize=(6, 5))
    for c in range(NUM_CLASSES):
        recall, _, confs = r["pr_curves"][c]
        if len(confs) > 1:
            ax.plot(confs, recall, label=CLASSES[c], color=colors[c])
    ax.set_xlabel("Confidence"); ax.set_ylabel("Recall")
    ax.set_title(f"Recall-Confidence — {r['display_name']}")
    ax.legend(); ax.grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(out_dir / "04_recall_confidence_curve.png", dpi=140); plt.close(fig)

    # 5. F1 vs Confidence
    fig, ax = plt.subplots(figsize=(6, 5))
    for c in range(NUM_CLASSES):
        recall, precision, confs = r["pr_curves"][c]
        if len(confs) > 1:
            f1 = 2 * precision * recall / np.maximum(precision + recall, 1e-9)
            ax.plot(confs, f1, label=CLASSES[c], color=colors[c])
    ax.set_xlabel("Confidence"); ax.set_ylabel("F1")
    ax.set_title(f"F1-Confidence — {r['display_name']}")
    ax.legend(); ax.grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(out_dir / "05_f1_confidence_curve.png", dpi=140); plt.close(fig)

    # 6. Per-class AP@50 bar
    fig, ax = plt.subplots(figsize=(6, 5))
    aps = [r["ap_per_class"][c] * 100 for c in range(NUM_CLASSES)]
    ax.bar(CLASSES, aps, color=colors)
    ax.set_ylabel("AP@50 (%)"); ax.set_ylim(0, 100)
    ax.set_title(f"Per-Class AP@50 — {r['display_name']} (mAP@50={r['map50']*100:.2f}%)")
    for i, v in enumerate(aps):
        ax.text(i, v + 1, f"{v:.1f}%", ha="center")
    fig.tight_layout(); fig.savefig(out_dir / "06_per_class_ap50_bar.png", dpi=140); plt.close(fig)

    # 7. Per-class Precision/Recall/F1 grouped bar (operating point)
    fig, ax = plt.subplots(figsize=(7, 5))
    x = np.arange(NUM_CLASSES); width = 0.25
    prec = [r["op_metrics"][c]["precision"] * 100 for c in range(NUM_CLASSES)]
    rec  = [r["op_metrics"][c]["recall"] * 100 for c in range(NUM_CLASSES)]
    f1   = [r["op_metrics"][c]["f1"] * 100 for c in range(NUM_CLASSES)]
    ax.bar(x - width, prec, width, label="Precision")
    ax.bar(x, rec, width, label="Recall")
    ax.bar(x + width, f1, width, label="F1")
    ax.set_xticks(x); ax.set_xticklabels(CLASSES)
    ax.set_ylabel("%"); ax.set_title(f"Per-Class P/R/F1 @ conf={r['op_threshold']} — {r['display_name']}")
    ax.legend()
    fig.tight_layout(); fig.savefig(out_dir / "07_per_class_prf_bar.png", dpi=140); plt.close(fig)

    # 8. Confidence histogram (all predictions, all classes combined)
    fig, ax = plt.subplots(figsize=(6, 5))
    all_confs = [r["pr_curves"][c][2] for c in range(NUM_CLASSES) if len(r["pr_curves"][c][2]) > 1]
    all_confs = np.concatenate(all_confs) if all_confs else np.array([])
    if len(all_confs):
        ax.hist(all_confs, bins=30, color="#378ADD")
    ax.set_xlabel("Confidence"); ax.set_ylabel("Count")
    ax.set_title(f"Prediction Confidence Distribution — {r['display_name']}")
    fig.tight_layout(); fig.savefig(out_dir / "08_confidence_histogram.png", dpi=140); plt.close(fig)

    # 9. Ground-truth class distribution in the test set
    fig, ax = plt.subplots(figsize=(6, 5))
    counts = [r["num_gt_by_class"].get(c, 0) for c in range(NUM_CLASSES)]
    ax.bar(CLASSES, counts, color=colors)
    ax.set_ylabel("Ground-truth instances")
    ax.set_title(f"Test-Set Class Distribution ({r['num_images']} images)")
    for i, v in enumerate(counts):
        ax.text(i, v + max(counts + [1]) * 0.01, str(v), ha="center")
    fig.tight_layout(); fig.savefig(out_dir / "09_test_set_class_distribution.png", dpi=140); plt.close(fig)

    # 10. Sample predictions grid (2x2), re-inferenced at the operating threshold
    sample_imgs = []
    for img_path in r["sample_images"]:
        frame = cv2.imread(str(img_path))
        if frame is None:
            continue
        dets, _ = run_inference(model, family, img_path, conf_threshold=r["op_threshold"])
        for d in dets:
            color = COLOR_MAP.get(d["class_id"], (0, 255, 0))
            cv2.rectangle(frame, (d["x1"], d["y1"]), (d["x2"], d["y2"]), color, 2)
            label = f"{CLASS_SHORT.get(d['class_id'], '?')} {int(d['confidence']*100)}%"
            cv2.putText(frame, label, (d["x1"], max(15, d["y1"] - 6)),
                        cv2.FONT_HERSHEY_DUPLEX, 0.5, color, 1, cv2.LINE_AA)
        sample_imgs.append(cv2.resize(frame, (320, 240)))

    if sample_imgs:
        while len(sample_imgs) < 4:
            sample_imgs.append(np.zeros_like(sample_imgs[0]))
        grid = np.vstack([np.hstack(sample_imgs[0:2]), np.hstack(sample_imgs[2:4])])
        cv2.imwrite(str(out_dir / "10_sample_predictions_grid.jpg"), grid)


# ============================================================
# TEXT REPORTS
# ============================================================

def write_reports(results, out_root: Path):
    out_root.mkdir(parents=True, exist_ok=True)
    r = results

    lines = [
        "=" * 88,
        f" MODEL EVALUATION REPORT — {r['display_name']} ({r['family'].upper()})",
        "=" * 88,
        "",
        f"Test set images evaluated : {r['num_images']}",
        f"Total GT instances        : {sum(r['num_gt_by_class'].values())}",
        f"IoU threshold             : {IOU_THRESH}",
        f"Operating confidence      : {r['op_threshold']} (confusion matrix / P-R-F1 below use this)",
        "",
        f"mAP@50 (all classes)      : {r['map50']*100:.2f}%",
        f"Overall Precision         : {r['overall_precision']*100:.2f}%",
        f"Overall Recall            : {r['overall_recall']*100:.2f}%",
        f"Overall F1                : {r['overall_f1']*100:.2f}%",
        "",
        "--- Per-Class Metrics ---",
        f"{'Class':<14}{'AP@50':>10}{'Precision':>12}{'Recall':>10}{'F1':>10}{'TP':>7}{'FP':>7}{'FN':>7}",
    ]
    for c in range(NUM_CLASSES):
        m = r["op_metrics"][c]
        lines.append(
            f"{CLASSES[c]:<14}{r['ap_per_class'][c]*100:>9.2f}%{m['precision']*100:>11.2f}%"
            f"{m['recall']*100:>9.2f}%{m['f1']*100:>9.2f}%{m['tp']:>7}{m['fp']:>7}{m['fn']:>7}"
        )

    ig = r["ignore_stats"]
    lines += [
        "",
        "=" * 88,
        " LABEL-GAP-CORRECTED METRICS (same detections, partial-annotation aware)",
        "=" * 88,
        "",
        "This dataset merges a separate eye-state corpus and a separate yawning corpus",
        "into one label space without re-annotation (BOOK.md Ch. V), so many images carry",
        "objects that are present but were never annotated. Scoring a correct detection of",
        "such an object as a false positive understates real accuracy. Below, predictions of",
        "a class that was never annotated on an image are IGNORED (neither TP nor FP), the",
        "standard partially-annotated-dataset convention (COCO iscrowd). Ground truth is",
        "untouched, so recall and FN are identical to the raw numbers by construction.",
        "",
        f"Eye predictions ignored on   : {ig['eye_ignored_images']} images "
        f"(full-frame tier-A views carrying zero eye labels)",
        f"Yawn predictions ignored on  : {ig['yawn_ignored_images']} images "
        f"(corpora with zero yawning annotations anywhere: "
        f"{', '.join(ig['yawn_blind_families']) or 'none'})",
        "",
        f"mAP@50 RAW                : {r['map50']*100:.2f}%",
        f"mAP@50 CORRECTED          : {r['map50_corrected']*100:.2f}%   "
        f"(delta {100*(r['map50_corrected']-r['map50']):+.2f} pts)",
        "",
        f"{'Class':<14}{'AP raw':>10}{'AP corr':>10}{'delta':>9}{'P corr':>10}{'FP raw':>9}{'FP corr':>9}",
    ]
    for c in range(NUM_CLASSES):
        mc = r["op_metrics_corrected"][c]
        lines.append(
            f"{CLASSES[c]:<14}{r['ap_per_class'][c]*100:>9.2f}%{r['ap_corrected'][c]*100:>9.2f}%"
            f"{100*(r['ap_corrected'][c]-r['ap_per_class'][c]):>+8.2f} {mc['precision']*100:>9.2f}%"
            f"{r['op_metrics'][c]['fp']:>9}{mc['fp']:>9}"
        )
    lines += ["", "Charts saved in: 10-visualizations/", "=" * 88]

    (out_root / "evaluation_report.txt").write_text("\n".join(lines), encoding="utf-8")

    summary = (
        f"# {r['display_name']} — Test Summary\n\n"
        f"**Evaluated on:** {r['num_images']} test images, "
        f"{sum(r['num_gt_by_class'].values())} ground-truth instances\n"
        f"**mAP@50:** {r['map50']*100:.2f}%\n"
        f"**Overall Precision / Recall / F1 (@ conf {r['op_threshold']}):** "
        f"{r['overall_precision']*100:.2f}% / {r['overall_recall']*100:.2f}% / {r['overall_f1']*100:.2f}%\n\n"
        f"| Class | AP@50 | Precision | Recall | F1 |\n|---|---|---|---|---|\n"
    )
    for c in range(NUM_CLASSES):
        m = r["op_metrics"][c]
        summary += (
            f"| {CLASSES[c]} | {r['ap_per_class'][c]*100:.2f}% | {m['precision']*100:.2f}% "
            f"| {m['recall']*100:.2f}% | {m['f1']*100:.2f}% |\n"
        )

    (out_root / "test_summary.md").write_text(summary, encoding="utf-8")


# ============================================================
# MAIN
# ============================================================

def parse_args():
    p = argparse.ArgumentParser(description="Real evaluation + chart/report generator")
    p.add_argument("--model", choices=list(MODEL_REGISTRY.keys()) + ["all"], default="all",
                    help="Key from configs/checkpoints.yaml, or 'all'. "
                         "Ignored if --weights is given instead.")
    p.add_argument("--weights", type=str, default=None,
                    help="Evaluate an ad hoc checkpoint directly, bypassing configs/checkpoints.yaml "
                         "(e.g. a run that hasn't been registered yet)")
    p.add_argument("--name", type=str, default=None,
                    help="Display name for --weights runs (default: the weights filename)")
    p.add_argument("--data", type=str, default=str(DEFAULT_DATA_YAML), help="Path to data.yaml")
    p.add_argument("--limit", type=int, default=None,
                    help="Evaluate only the first N test images — use this for a quick smoke test "
                         "before running the full test set")
    p.add_argument("--split", type=str, default="test", choices=["test", "val", "train"],
                    help="Dataset split to evaluate. Use --split val to get a val number from THIS "
                         "evaluator, directly comparable to the test number (training-time val mAP "
                         "comes from Ultralytics' evaluator instead, so the two are not comparable).")
    return p.parse_args()


def main():
    args = parse_args()
    images_dir, labels_dir = resolve_test_split(Path(args.data), split=args.split)
    if not images_dir.exists():
        print(f"ERROR: test images dir not found: {images_dir}")
        return
    print(f"Test images : {images_dir}")
    print(f"Test labels : {labels_dir}")

    if args.weights:
        weights_path = Path(args.weights)
        cfgs = {(args.name or weights_path.stem): {
            "family": "yolo", "checkpoint": weights_path,
            "display_name": args.name or weights_path.stem, "resolution": None,
        }}
    else:
        if not MODEL_REGISTRY:
            print("ERROR: configs/checkpoints.yaml has no registered models yet, and --weights "
                  "was not given. Train a model first, or pass --weights <path to best.pt> directly.")
            return
        keys = list(MODEL_REGISTRY.keys()) if args.model == "all" else [args.model]
        cfgs = {k: MODEL_REGISTRY[k] for k in keys}

    for key, cfg in cfgs.items():
        results = evaluate_model(key, cfg, images_dir, labels_dir, limit=args.limit)
        if results is None:
            continue

        # INFO/<family>/<N-name>-test-result/tested-images/ -- the project's
        # folder convention (BOOK.md Ch.2 SS2.10 / AGENTS.md). Yes, this is
        # deliberately the same directory that holds BOOK.md on this
        # case-insensitive Windows filesystem (info/ == INFO/) -- that's the
        # intended location per the current convention, not an accident.
        test_result_dir = derive_test_result_dir(cfg["checkpoint"])
        # Non-test splits get their own subfolder so a val run can never overwrite
        # the certified test-split results sitting next to it.
        out_root = test_result_dir / ("tested-images" if args.split == "test"
                                       else f"evaluated-{args.split}")
        charts_dir = out_root / "charts"

        generate_charts(results, images_dir, labels_dir, charts_dir)
        write_reports(results, out_root)

        # Machine-readable row, for tabulating multiple experiments (Ch.2 SS2.10).
        import json
        metrics_row = {
            "model_key": key, "display_name": cfg["display_name"],
            "map50": results["map50"], "precision": results["overall_precision"],
            "recall": results["overall_recall"], "f1": results["overall_f1"],
            "ap_per_class": {CLASSES[c]: results["ap_per_class"][c] for c in range(NUM_CLASSES)},
            "map50_corrected": results["map50_corrected"],
            "ap_per_class_corrected": {CLASSES[c]: results["ap_corrected"][c] for c in range(NUM_CLASSES)},
            "label_gap_stats": results["ignore_stats"],
        }
        with open(out_root / "metrics.json", "w", encoding="utf-8") as fh:
            json.dump(metrics_row, fh, indent=2)

        print(f"[DONE] {cfg['display_name']}")
        print(f"  mAP@50 raw      : {results['map50']*100:.2f}%  |  "
              f"P: {results['overall_precision']*100:.2f}%  |  "
              f"R: {results['overall_recall']*100:.2f}%  |  "
              f"F1: {results['overall_f1']*100:.2f}%")
        print(f"  mAP@50 corrected: {results['map50_corrected']*100:.2f}%  "
              f"({100*(results['map50_corrected']-results['map50']):+.2f} pts, label-gap aware)")
        print(f"  -> {out_root}")


if __name__ == "__main__":
    main()