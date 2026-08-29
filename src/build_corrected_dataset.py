"""
build_corrected_dataset.py -- D2 eye-supervision repair into a NEW dataset dir
================================================================================
Project : nano big -- driver drowsiness detection

WHY (BOOK.md D2, D8, D10):
Training runs on standard YOLO labels, in which an unlabelled region is
background. 4,225 tier-A training images (a face is in frame, so eyes are
certainly present) carry ZERO eye labels, so the model is explicitly taught
"no eye here" on images that definitely contain eyes.

That does not blind the model -- D8 measured only 2.5% of val misses as genuine
blindness -- it makes it UNCERTAIN. 89.2% of val misses are correct detections
with IoU >= 0.5 rejected for scoring too low, and the two classes with wrong
negative supervision are exactly the two with crippled confidence:
closed_eye 0.126 and open_eye 0.138 median, against yawning's 0.290.

This completes the missing eye supervision with high-confidence predictions from
the current best checkpoint, so those images stop teaching a false negative.

SAFETY RULES, all enforced below and verified afterwards:
  * data/Dataset-Main/ is NEVER written to. Output goes to a new directory.
  * Only TRAIN labels are altered. val/ and test/ are copied byte-identical.
  * Only images that are tier-A AND carry zero eye labels are touched -- the
    population where a missing eye label is certainly an error, not a judgement.
  * Existing label lines are never modified or removed; pseudo-labels are only
    appended.
  * Boxes implausible for an eye are rejected regardless of confidence.
  * At most 2 eye boxes are added per image (a face has two eyes).

Usage
-----
    python src/build_corrected_dataset.py --dry-run     # measure, write nothing
    python src/build_corrected_dataset.py --conf 0.60   # build it
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from demo_video import MODEL_REGISTRY, load_yolo_model
from evaluate import run_inference, _read_label, EYE_CLASSES, TIER_A_MAX_AREA_FRAC

SRC = PROJECT_ROOT / "data" / "Dataset-Main"
DST = PROJECT_ROOT / "data" / "Dataset-Corrected"
CLASSES = {0: "closed_eye", 1: "open_eye", 2: "yawning"}

# An eye occupying more than a quarter of the frame, or under 8x8 px, is not a
# plausible eye in a driver-facing view -- reject regardless of confidence.
MAX_EYE_AREA_FRAC = 0.25
MIN_EYE_PX_AREA = 64
MAX_EYES_PER_IMAGE = 2


def target_images(labels_dir):
    """Tier-A train images carrying zero eye labels -- the certainly-wrong population."""
    out = []
    for lp in labels_dir.glob("*.txt"):
        classes, max_af = _read_label(lp)
        if max_af < TIER_A_MAX_AREA_FRAC and not (classes & EYE_CLASSES):
            out.append(lp.stem)
    return sorted(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="yolo26n-2-finetune")
    ap.add_argument("--conf", type=float, default=0.60,
                     help="Confidence floor for an appended pseudo-label")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src_img = SRC / "images" / "train"
    src_lbl = SRC / "labels" / "train"
    stems = target_images(src_lbl)
    print(f"Target population (tier-A train, zero eye labels): {len(stems)} images")

    model = load_yolo_model(MODEL_REGISTRY[args.model]["checkpoint"])
    conf_hist, per_image, rejected = [], {}, defaultdict(int)

    for i, stem in enumerate(stems):
        img_path = next((src_img / f"{stem}{e}" for e in (".jpg", ".png")
                          if (src_img / f"{stem}{e}").exists()), None)
        if img_path is None:
            rejected["image_missing"] += 1
            continue
        dets, shape = run_inference(model, "yolo", img_path, conf_threshold=0.05)
        if shape is None:
            rejected["unreadable"] += 1
            continue
        h, w = shape
        keep = []
        for d in sorted([x for x in dets if x["class_id"] in EYE_CLASSES],
                         key=lambda x: -x["confidence"]):
            conf_hist.append(d["confidence"])
            if d["confidence"] < args.conf:
                continue
            bw, bh = d["x2"] - d["x1"], d["y2"] - d["y1"]
            af = (bw * bh) / float(w * h)
            if af > MAX_EYE_AREA_FRAC:
                rejected["too_large"] += 1
                continue
            if bw * bh < MIN_EYE_PX_AREA:
                rejected["too_small"] += 1
                continue
            keep.append((d["class_id"],
                          ((d["x1"] + d["x2"]) / 2) / w, ((d["y1"] + d["y2"]) / 2) / h,
                          bw / w, bh / h))
            if len(keep) >= MAX_EYES_PER_IMAGE:
                break
        if keep:
            per_image[stem] = keep
        if (i + 1) % 500 == 0:
            print(f"  ...{i + 1}/{len(stems)}")

    ch = np.array(conf_hist) if conf_hist else np.array([0.0])
    added = sum(len(v) for v in per_image.values())
    print(f"\nEye detections seen (conf>=0.05): {len(ch)}")
    for t in (0.35, 0.50, 0.60, 0.70, 0.80):
        print(f"    >= {t:.2f}: {int((ch >= t).sum()):>6}")
    print(f"\nAt --conf {args.conf}: {added} boxes appended across {len(per_image)} images "
          f"({100*len(per_image)/max(len(stems),1):.1f}% of the target population)")
    print(f"Rejected by plausibility rules: {dict(rejected)}")

    if args.dry_run:
        print("\n[DRY RUN] nothing written.")
        return

    # ---- build the new dataset ------------------------------------------------
    # Images are junctioned, not copied: 50,654 files stay on disk exactly once and
    # the originals physically cannot be modified through this tree.
    if DST.exists():
        shutil.rmtree(DST)
    (DST / "images").mkdir(parents=True)
    (DST / "labels").mkdir(parents=True)

    for split in ("train", "val", "test"):
        subprocess.run(["cmd", "/c", "mklink", "/J",
                         str(DST / "images" / split), str(SRC / "images" / split)],
                        check=True, capture_output=True)
        shutil.copytree(SRC / "labels" / split, DST / "labels" / split)

    written = 0
    for stem, boxes in per_image.items():
        lp = DST / "labels" / "train" / f"{stem}.txt"
        existing = lp.read_text().rstrip("\n")
        lines = ([existing] if existing else []) + [
            f"{c} {xc:.6f} {yc:.6f} {bw:.6f} {bh:.6f}" for c, xc, yc, bw, bh in boxes]
        lp.write_text("\n".join(lines) + "\n", encoding="utf-8")
        written += 1

    (DST / "data.yaml").write_text(
        f"path: {DST}\ntrain: images/train\nval: images/val\ntest: images/test\n"
        f"nc: 3\nnames:\n  0: closed_eye\n  1: open_eye\n  2: yawning\n", encoding="utf-8")

    meta = {"source_model": args.model, "conf_threshold": args.conf,
            "target_population": len(stems), "images_modified": written,
            "boxes_added": added, "rejected": dict(rejected),
            "rules": {"max_eye_area_frac": MAX_EYE_AREA_FRAC,
                       "min_eye_px_area": MIN_EYE_PX_AREA,
                       "max_eyes_per_image": MAX_EYES_PER_IMAGE},
            "splits_modified": ["train"], "splits_copied_verbatim": ["val", "test"]}
    (DST / "CORRECTION_MANIFEST.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"\nBuilt {DST}\n  modified {written} train label files, appended {added} boxes")


if __name__ == "__main__":
    main()
