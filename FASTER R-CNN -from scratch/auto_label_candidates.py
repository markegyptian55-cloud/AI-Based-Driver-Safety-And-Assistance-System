"""
auto_label_candidates.py
------------------------
Semi-automatic auto-labeling, STEP 1 of 2  (generation only -- never writes
to any real label file).

What it does:
    1. Loads the best checkpoint and runs it on the chosen split(s).
    2. Finds "phantom" predictions: detections that do NOT overlap ANY ground-
       truth box (max IoU over all GT < --overlap-iou). These are objects the
       model sees where the annotator left no label.
    3. Keeps only phantoms with confidence >= --min-conf (default 0.95).
    4. Writes results/auto_label/candidate_labels.txt  (a review sheet -- the
       ORIGINAL data/labels/*.txt files are left completely untouched).
    5. Draws results/auto_label/review/<image>.jpg with the recommended boxes
       (white = existing GT, magenta = proposed new label, tagged with its
       candidate id + confidence).

Then a human reviews the photos and runs  approve_labels.py  (STEP 2) which is
the ONLY script that ever appends to a YOLO .txt file, and only for approved
candidates.

The proposed YOLO coordinates are the detection box (in the 640x640 model
space) divided by 640. Because the dataset resizes every image to 640x640 with
an independent x/y scale, a normalized coordinate in that square equals the
normalized coordinate in the original image -- so the numbers are valid YOLO
labels regardless of the original aspect ratio.

Usage:
    python auto_label_candidates.py --checkpoint checkpoints/tuned/best.pth
    python auto_label_candidates.py --split train --min-conf 0.95
    python auto_label_candidates.py --split all --max-images 500   (quick trial)
"""

import os
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

OUT_DIR      = os.path.join(config.RESULTS_DIR, "auto_label")
REVIEW_DIR   = os.path.join(OUT_DIR, "review")
CAND_FILE    = os.path.join(OUT_DIR, "candidate_labels.txt")

# column order of candidate_labels.txt (pipe-delimited)
COLUMNS = ["id", "decision", "image_id", "label_file",
           "class", "yolo_id", "conf", "cx", "cy", "w", "h"]


def gather_names(split):
    if split == "all":
        seen, names = set(), []
        for s in ("train", "val", "test"):
            for n in load_split(os.path.join(config.SPLITS_DIR, f"{s}.txt")):
                if n not in seen:
                    seen.add(n); names.append(n)
        return names
    return load_split(os.path.join(config.SPLITS_DIR, f"{split}.txt"))


def _iou_matrix(a, b):
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)), np.float32)
    return box_iou(torch.as_tensor(a, dtype=torch.float32),
                   torch.as_tensor(b, dtype=torch.float32)).numpy()


@torch.no_grad()
def find_candidates(model, loader, device, min_conf, overlap_iou):
    """Yield per-image (image_id, gt_boxes_640, [candidate dicts])."""
    model.eval()
    for images, targets in loader:
        images = images.to(device)
        dets = model(images)
        for det, tgt in zip(dets, targets):
            pb = det["boxes"].cpu().numpy()
            pl = det["labels"].cpu().numpy()
            ps = det["scores"].cpu().numpy()
            gb = tgt["boxes"].numpy()
            name = tgt["image_id"]

            keep = ps >= min_conf
            cands = []
            if keep.any():
                iou_all = _iou_matrix(pb[keep], gb)          # [K, G]
                for row, i in zip(iou_all, np.nonzero(keep)[0]):
                    max_gt = float(row.max()) if len(gb) else 0.0
                    if max_gt < overlap_iou:                 # phantom -> propose
                        cands.append({
                            "box640": pb[i], "yolo_id": int(pl[i]) - 1,
                            "label": config.MODEL_LABELS[int(pl[i])],
                            "conf": float(ps[i]),
                        })
            yield name, gb, cands


def box640_to_yolo(box, size=config.IMG_SIZE):
    x1, y1, x2, y2 = box
    cx = ((x1 + x2) / 2.0) / size
    cy = ((y1 + y2) / 2.0) / size
    w  = (x2 - x1) / size
    h  = (y2 - y1) / size
    # clamp into [0,1] so we never emit an out-of-range YOLO label
    return (min(max(cx, 0.0), 1.0), min(max(cy, 0.0), 1.0),
            min(max(w, 0.0), 1.0), min(max(h, 0.0), 1.0))


def draw_review(name, gb, cands):
    path = os.path.join(config.IMAGES_DIR, name)
    img = cv2.imread(path)
    if img is None:
        return False
    img = cv2.resize(img, (config.IMG_SIZE, config.IMG_SIZE))
    # existing GT in white
    for b in gb:
        x1, y1, x2, y2 = [int(v) for v in b]
        cv2.rectangle(img, (x1, y1), (x2, y2), (255, 255, 255), 1)
    # proposals in magenta, tagged with candidate id
    for c in cands:
        x1, y1, x2, y2 = [int(v) for v in c["box640"]]
        cv2.rectangle(img, (x1, y1), (x2, y2), (255, 0, 255), 2)
        tag = f'{c["id"]} {c["label"]} {int(c["conf"]*100)}%'
        (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        yb = max(y1, th + 4)
        cv2.rectangle(img, (x1, yb - th - 4), (x1 + tw + 2, yb), (255, 0, 255), -1)
        cv2.putText(img, tag, (x1 + 1, yb - 3),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 1)
    cv2.imwrite(os.path.join(REVIEW_DIR, name if name.lower().endswith(
        (".jpg", ".jpeg", ".png")) else name + ".jpg"), img)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default=f"{config.CKPT_DIR}/tuned/best.pth")
    ap.add_argument("--device", default=None)
    ap.add_argument("--split", choices=["train", "val", "test", "all"],
                    default="train",
                    help="which split(s) to auto-label. NOTE: auto-labeling the "
                         "TEST split with the model's own predictions and then "
                         "evaluating on it is circular -- prefer 'train'.")
    ap.add_argument("--min-conf", type=float, default=0.95,
                    help="keep only predictions with confidence >= this")
    ap.add_argument("--overlap-iou", type=float, default=0.2,
                    help="a prediction counts as 'no GT' if its best IoU with "
                         "any GT box is below this")
    ap.add_argument("--max-images", type=int, default=0,
                    help="cap number of images (0 = all); handy for a quick trial")
    args = ap.parse_args()

    device = select_device(args.device)
    os.makedirs(REVIEW_DIR, exist_ok=True)

    names = gather_names(args.split)
    if args.max_images:
        names = names[:args.max_images]
    ds = DrowsinessDataset(names, train=False)
    loader = DataLoader(ds, batch_size=config.BATCH_SIZE, shuffle=False,
                        collate_fn=collate_fn, num_workers=4)
    print(f"split={args.split}  images={len(ds)}  min_conf={args.min_conf}")

    model = FasterRCNN().to(device)
    ckpt = torch.load(args.checkpoint, map_location=device)
    model.load_state_dict(ckpt["model"])
    print(f"loaded {args.checkpoint} (epoch {ckpt.get('epoch', '?')})")

    rows = []
    n_img_with_cands = 0
    cid = 0
    for name, gb, cands in find_candidates(model, loader, device,
                                           args.min_conf, args.overlap_iou):
        if not cands:
            continue
        for c in cands:
            cid += 1
            c["id"] = f"C{cid:05d}"
            cx, cy, w, h = box640_to_yolo(c["box640"])
            stem = os.path.splitext(name)[0]
            rows.append({
                "id": c["id"], "decision": "pending", "image_id": name,
                "label_file": stem + ".txt", "class": c["label"],
                "yolo_id": c["yolo_id"], "conf": round(c["conf"], 4),
                "cx": round(cx, 6), "cy": round(cy, 6),
                "w": round(w, 6), "h": round(h, 6),
            })
        if draw_review(name, gb, cands):
            n_img_with_cands += 1

    # ---- write candidate_labels.txt ----
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(CAND_FILE, "w", encoding="utf-8") as f:
        f.write("# candidate_labels.txt -- auto-label review sheet (STEP 1 output)\n")
        f.write(f"# split={args.split} min_conf={args.min_conf} "
                f"overlap_iou={args.overlap_iou} checkpoint={args.checkpoint}\n")
        f.write("# Review the photos in results/auto_label/review/ , then set the\n")
        f.write("# DECISION column to  approve  or  reject  (default: pending).\n")
        f.write("# Commit approved labels with:  python approve_labels.py --commit\n")
        f.write("# The original data/labels/*.txt files are NOT modified by this script.\n")
        f.write("# " + " | ".join(COLUMNS) + "\n")
        for r in rows:
            f.write(" | ".join(str(r[c]) for c in COLUMNS) + "\n")

    print(f"\ncandidates (conf>={args.min_conf}, no GT overlap): {len(rows)}")
    print(f"images with candidates                         : {n_img_with_cands}")
    print(f"review sheet -> {CAND_FILE}")
    print(f"review photos -> {REVIEW_DIR}")
    print("\nNEXT: eyeball the photos, mark approve/reject, then run approve_labels.py")


if __name__ == "__main__":
    main()
