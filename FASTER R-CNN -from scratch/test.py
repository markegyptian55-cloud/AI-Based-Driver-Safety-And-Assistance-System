"""
test.py
-------
FINAL evaluation on the held-out TEST split. Run this ONCE, after training and
validation are done, on the best checkpoint. It never updates weights and never
influences training -- it only reports how the final model does on unseen data.

Usage:
    python test.py --checkpoint checkpoints/best.pth --device cuda:0

Reports: Precision, Recall, F1, Mean IoU, AP per class, mAP@0.5, mAP@0.5:0.95,
custom Detection Accuracy, and a confusion matrix. Saves results/test_metrics.json
and a few example images (ground truth vs predictions) to results/examples/.

Why mAP and not accuracy?
    Classification accuracy = (correct labels) / (total images): one label per
    image, no location. Detection must also judge WHERE each object is and match
    many predictions to many objects, at every confidence level. mAP (area under
    the precision-recall curve, averaged over classes) captures all of that;
    accuracy cannot express "the box was 40% off" or "two of three objects missed".
"""

import os
import json
import argparse
import cv2
import numpy as np
import torch
from torch.utils.data import DataLoader

import config
from dataset import load_split, DrowsinessDataset, collate_fn
from models.faster_rcnn import FasterRCNN
from utils.gpu_utils import select_device
from utils.metrics import evaluate_detections, compute_map_range, confusion_matrix
from utils.visualization import draw_detections


@torch.no_grad()
def run_test(model, loader, device):
    model.eval()
    all_preds, all_gts, ids = [], [], []
    for images, targets in loader:
        images = images.to(device)
        dets = model(images)
        for det, tgt in zip(dets, targets):
            all_preds.append({k: v.cpu() for k, v in det.items()})
            all_gts.append({"boxes": tgt["boxes"], "labels": tgt["labels"]})
            ids.append(tgt["image_id"])
    return all_preds, all_gts, ids


def detection_accuracy(precision, recall):
    """TP/(TP+FP+FN) derived from precision and recall (custom single number)."""
    if precision <= 0 or recall <= 0:
        return 0.0
    return 1.0 / (1.0 / precision + 1.0 / recall - 1.0)


def save_example_images(preds, gts, ids, n=6, tag=""):
    sub = "examples" if not tag else f"examples_{tag}"
    out_dir = os.path.join(config.RESULTS_DIR, sub)
    os.makedirs(out_dir, exist_ok=True)
    for k in range(min(n, len(ids))):
        path = os.path.join(config.IMAGES_DIR, ids[k])
        img = cv2.imread(path)
        if img is None:
            continue
        img = cv2.resize(img, (config.IMG_SIZE, config.IMG_SIZE))   # GT boxes are in 640 space
        draw_detections(img, gts[k]["boxes"].numpy(), gts[k]["labels"].numpy(), gt=True)
        draw_detections(img, preds[k]["boxes"].numpy(),
                        preds[k]["labels"].numpy(), preds[k]["scores"].numpy())
        cv2.imwrite(os.path.join(out_dir, f"test_{k:02d}_{ids[k]}"), img)
    print(f"saved example images -> {out_dir}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=f"{config.CKPT_DIR}/best.pth")
    ap.add_argument("--device", default=None)
    ap.add_argument("--iou", type=float, default=0.5, help="IoU threshold for match")
    ap.add_argument("--tag", default="",
                    help="suffix for output files, e.g. 'tuned' -> results/test_metrics_tuned.json")
    args = ap.parse_args()

    device = select_device(args.device)
    os.makedirs(config.RESULTS_DIR, exist_ok=True)

    # data: TEST split only
    test_ds = DrowsinessDataset(load_split(f"{config.SPLITS_DIR}/test.txt"), train=False)
    test_loader = DataLoader(test_ds, batch_size=config.BATCH_SIZE, shuffle=False,
                             collate_fn=collate_fn, num_workers=4)
    print(f"test images: {len(test_ds)}")

    # model
    model = FasterRCNN().to(device)
    ckpt = torch.load(args.checkpoint, map_location=device)
    model.load_state_dict(ckpt["model"])
    print(f"loaded {args.checkpoint} (epoch {ckpt.get('epoch','?')})")

    # run
    preds, gts, ids = run_test(model, test_loader, device)

    # metrics
    m = evaluate_detections(preds, gts, iou_thresh=args.iou)
    map_5095 = compute_map_range(preds, gts)
    acc = detection_accuracy(m["precision"], m["recall"])
    cm = confusion_matrix(preds, gts, iou_thresh=args.iou)

    # ---- print summary ----
    print("\n================ TEST RESULTS ================")
    print(f"Precision            : {m['precision']:.4f}")
    print(f"Recall               : {m['recall']:.4f}")
    print(f"F1-score             : {m['f1']:.4f}")
    print(f"Mean IoU (TP boxes)  : {m['mean_iou']:.4f}")
    print(f"Detection Accuracy   : {acc:.4f}   (custom: TP/(TP+FP+FN))")
    print(f"mAP@0.5              : {m['mAP@0.5']:.4f}")
    print(f"mAP@0.5:0.95         : {map_5095:.4f}")
    print("\nAP per class:")
    for name, ap_val in m["AP_per_class"].items():
        print(f"  {name:12s}: {ap_val:.4f}")
    print("\nConfusion matrix (rows = GT, cols = predicted; index 0 = background):")
    header = "        " + "".join(f"{n[:9]:>10s}" for n in config.MODEL_LABELS)
    print(header)
    for r, name in enumerate(config.MODEL_LABELS):
        print(f"{name[:8]:>8s}" + "".join(f"{cm[r, c]:>10d}" for c in range(config.NUM_CLASSES)))

    # ---- save ----
    results = {
        "checkpoint": args.checkpoint,
        "num_test_images": len(test_ds),
        "iou_threshold": args.iou,
        "precision": m["precision"],
        "recall": m["recall"],
        "f1": m["f1"],
        "mean_iou": m["mean_iou"],
        "detection_accuracy": acc,
        "mAP@0.5": m["mAP@0.5"],
        "mAP@0.5:0.95": map_5095,
        "AP_per_class": m["AP_per_class"],
        "confusion_matrix": cm.tolist(),
        "confusion_matrix_labels": config.MODEL_LABELS,
    }
    fname = "test_metrics.json" if not args.tag else f"test_metrics_{args.tag}.json"
    out_path = os.path.join(config.RESULTS_DIR, fname)
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nsaved metrics -> {out_path}")

    save_example_images(preds, gts, ids, tag=args.tag)


if __name__ == "__main__":
    main()
