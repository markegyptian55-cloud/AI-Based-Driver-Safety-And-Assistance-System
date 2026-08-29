"""
audit_dataset.py -- rapid label-only dataset audit (no image decode, no GPU)
================================================================================
Project : nano big -- driver drowsiness detection

One pass over every label file in every split, computing all label-derived
checks simultaneously. Built under a deadline: the point is to surface the
DOMINANT high-confidence defect fast, not to be exhaustive.

Checks:
  1. Yawning box convention by source corpus  <- the decisive one. If two
     separated area_frac regimes exist, no single model can satisfy both and
     yawning's measured AP ceiling (91.53%, BOOK.md D8) is a property of the
     annotation definition rather than of the model.
  2. Suspicious boxes, TIER-AWARE. The archived p05_10_analysis.py rules are
     tier-blind, so box_is_whole_image / eye_box_too_large fire by construction
     on every tier-C extreme crop -- which is a labelling convention, not a
     defect. Gating by tier is the fix.
  3. Cross-class IoU conflicts (same region claimed as two classes) and
     same-class duplicate boxes -- both are demonstrably wrong, not judgement
     calls.
  4. Geometry outliers: border-touching, tiny, huge, per-class aspect bounds.
  5. Class and source distribution per split.

Read-only. Writes a report to INFO/_audit/.

Usage
-----
    python src/audit_dataset.py
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate import source_family, compute_iou, TIER_A_MAX_AREA_FRAC

CLASSES = {0: "closed_eye", 1: "open_eye", 2: "yawning"}
LABELS_ROOT = PROJECT_ROOT / "data" / "Dataset-Main" / "labels"
OUT_DIR = PROJECT_ROOT / "INFO" / "_audit"
IMG_SIDE = 640                      # H1 verified every exported image is 640x640
BORDER_EPS = 2.0 / IMG_SIDE         # +/-2 px, expressed in normalized units
TINY_AREA_FRAC = 0.0005
HUGE_AREA_FRAC = 0.90
IOU_CONFLICT = 0.5


def tier_of(max_area_frac):
    if max_area_frac < TIER_A_MAX_AREA_FRAC:
        return "A_full_frame"
    if max_area_frac < 0.50:
        return "B_moderate"
    return "C_extreme"


def read_boxes(label_path):
    """-> list of (cls, xc, yc, bw, bh) in normalized units."""
    out = []
    try:
        for line in label_path.read_text().splitlines():
            p = line.split()
            if len(p) < 5:
                continue
            out.append((int(float(p[0])), float(p[1]), float(p[2]), float(p[3]), float(p[4])))
    except OSError:
        pass
    return out


def to_xyxy(b):
    _, xc, yc, bw, bh = b
    return (xc - bw / 2, yc - bh / 2, xc + bw / 2, yc + bh / 2)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    yawn_af = defaultdict(lambda: defaultdict(list))   # split -> family -> [area_frac]
    cls_count = defaultdict(lambda: defaultdict(int))  # split -> cls -> n
    fam_count = defaultdict(lambda: defaultdict(int))  # split -> family -> n images
    suspicious = defaultdict(lambda: defaultdict(int))  # split -> rule -> n
    conflicts = defaultdict(list)                       # split -> [(stem, a, b, iou)]
    dup_boxes = defaultdict(list)
    aspects = defaultdict(list)                         # cls -> [aspect]
    geom = defaultdict(lambda: defaultdict(int))
    n_imgs = defaultdict(int)

    for split in ("train", "val", "test"):
        d = LABELS_ROOT / split
        for lp in d.glob("*.txt"):
            n_imgs[split] += 1
            fam = source_family(lp.stem)
            fam_count[split][fam] += 1
            boxes = read_boxes(lp)
            if not boxes:
                continue
            max_af = max(b[3] * b[4] for b in boxes)
            tier = tier_of(max_af)

            for b in boxes:
                cls, xc, yc, bw, bh = b
                af = bw * bh
                px_area = (bw * IMG_SIDE) * (bh * IMG_SIDE)
                cls_count[split][cls] += 1
                if cls == 2:
                    yawn_af[split][fam].append(af)
                if bh > 0:
                    aspects[cls].append(bw / bh)

                # --- tier-aware suspicious rules ---------------------------------
                # Tier C is a single object filling the frame BY CONSTRUCTION, so a
                # large area_frac there is the labelling convention, not a defect.
                if tier != "C_extreme":
                    if cls in (0, 1) and af > 0.25:
                        suspicious[split]["eye_box_too_large"] += 1
                    if cls == 2 and af > 0.60:
                        suspicious[split]["yawn_box_covers_image"] += 1
                    if af > HUGE_AREA_FRAC:
                        suspicious[split]["box_is_whole_image"] += 1
                if cls in (0, 1) and px_area < 64:
                    suspicious[split]["eye_box_tiny"] += 1
                if cls == 2 and px_area < 100:
                    suspicious[split]["yawn_box_tiny"] += 1
                if bh > 0 and (bw / bh > 6 or bw / bh < 1 / 6):
                    suspicious[split]["extreme_aspect"] += 1

                # --- geometry ----------------------------------------------------
                x1, y1, x2, y2 = to_xyxy(b)
                if x1 <= BORDER_EPS or y1 <= BORDER_EPS or x2 >= 1 - BORDER_EPS or y2 >= 1 - BORDER_EPS:
                    geom[split]["border_touching"] += 1
                if af < TINY_AREA_FRAC:
                    geom[split]["tiny"] += 1
                if af > HUGE_AREA_FRAC:
                    geom[split]["huge"] += 1

            # --- pairwise conflicts within the image ----------------------------
            for i in range(len(boxes)):
                for j in range(i + 1, len(boxes)):
                    iou = compute_iou(to_xyxy(boxes[i]), to_xyxy(boxes[j]))
                    if iou < IOU_CONFLICT:
                        continue
                    if boxes[i][0] != boxes[j][0]:
                        conflicts[split].append((lp.stem, CLASSES[boxes[i][0]],
                                                  CLASSES[boxes[j][0]], round(iou, 3)))
                    else:
                        dup_boxes[split].append((lp.stem, CLASSES[boxes[i][0]], round(iou, 3)))

    # ================= report =================
    L, A = [], lambda s: L.append(s)
    A("=" * 96)
    A(" RAPID DATASET AUDIT -- label-only, all splits")
    A("=" * 96)
    A("")
    for s in ("train", "val", "test"):
        A(f"  {s:<6} images={n_imgs[s]:>6}   " +
          "  ".join(f"{CLASSES[c]}={cls_count[s][c]}" for c in (0, 1, 2)))
    A("")

    A("-" * 96)
    A(" 1. YAWNING BOX CONVENTION BY SOURCE CORPUS   <-- decisive check")
    A("-" * 96)
    A("  If two separated area_frac regimes exist, the corpora disagree on what a")
    A("  'yawning' box IS, and no single set of predictions can match both.")
    A("")
    conv = {}
    for s in ("train", "val", "test"):
        A(f"  [{s}]")
        A(f"    {'family':<20}{'boxes':>7}{'median af':>11}{'p10':>8}{'p90':>8}{'  regime':>10}")
        for fam in sorted(yawn_af[s], key=lambda f: -len(yawn_af[s][f])):
            v = np.array(yawn_af[s][fam])
            if len(v) < 10:
                continue
            med = float(np.median(v))
            regime = "LOOSE" if med >= 0.30 else ("tight" if med < 0.10 else "mid")
            conv.setdefault(s, {})[fam] = {"n": len(v), "median_af": med, "regime": regime}
            A(f"    {fam:<20}{len(v):>7}{med:>11.3f}{np.percentile(v,10):>8.3f}"
              f"{np.percentile(v,90):>8.3f}{regime:>10}")
        A("")

    # bimodality on the pooled train distribution
    tr = np.concatenate([np.array(v) for v in yawn_af["train"].values()]) if yawn_af["train"] else np.array([])
    if len(tr):
        loose = float((tr >= 0.30).mean())
        tight = float((tr < 0.10).mean())
        mid = 1 - loose - tight
        A(f"  TRAIN pooled yawning boxes: n={len(tr)}")
        A(f"    tight (af<0.10) : {100*tight:5.1f}%")
        A(f"    mid            : {100*mid:5.1f}%")
        A(f"    LOOSE (af>=0.30): {100*loose:5.1f}%")
        A("")

    A("-" * 96)
    A(" 2. SUSPICIOUS BOXES (tier-aware)")
    A("-" * 96)
    for s in ("train", "val", "test"):
        tot = sum(cls_count[s].values())
        items = sorted(suspicious[s].items(), key=lambda kv: -kv[1])
        A(f"  [{s}] total boxes={tot}")
        if not items:
            A("    none")
        for k, v in items:
            A(f"    {k:<26}{v:>7}  ({100*v/max(tot,1):.2f}% of boxes)")
    A("")

    A("-" * 96)
    A(" 3. CROSS-CLASS CONFLICTS AND DUPLICATE BOXES (IoU >= 0.5, same image)")
    A("-" * 96)
    for s in ("train", "val", "test"):
        A(f"  [{s}] cross-class conflicts={len(conflicts[s])}   same-class duplicates={len(dup_boxes[s])}")
        for row in conflicts[s][:5]:
            A(f"      conflict: {row[1]} vs {row[2]}  IoU={row[3]}  {row[0][:60]}")
    A("")

    A("-" * 96)
    A(" 4. GEOMETRY OUTLIERS")
    A("-" * 96)
    for s in ("train", "val", "test"):
        tot = sum(cls_count[s].values())
        A(f"  [{s}] " + "  ".join(f"{k}={v} ({100*v/max(tot,1):.2f}%)"
                                    for k, v in sorted(geom[s].items())))
    A("")

    A("-" * 96)
    A(" 5. SOURCE DISTRIBUTION (images per split)")
    A("-" * 96)
    fams = sorted({f for s in fam_count for f in fam_count[s]},
                   key=lambda f: -fam_count["train"][f])
    A(f"  {'family':<20}" + "".join(f"{s:>12}" for s in ("train", "val", "test")))
    for f in fams:
        row = "".join(f"{100*fam_count[s][f]/max(n_imgs[s],1):>11.1f}%" for s in ("train", "val", "test"))
        A(f"  {f:<20}{row}")
    A("")
    A("=" * 96)

    text = "\n".join(L)
    print(text)
    (OUT_DIR / "audit_labels.txt").write_text(text, encoding="utf-8")
    (OUT_DIR / "audit_labels.json").write_text(json.dumps({
        "images": dict(n_imgs),
        "class_counts": {s: {CLASSES[c]: n for c, n in d.items()} for s, d in cls_count.items()},
        "yawn_convention": conv,
        "suspicious": {s: dict(d) for s, d in suspicious.items()},
        "cross_class_conflicts": {s: len(v) for s, v in conflicts.items()},
        "same_class_duplicates": {s: len(v) for s, v in dup_boxes.items()},
        "conflict_examples": {s: v[:50] for s, v in conflicts.items()},
        "duplicate_examples": {s: v[:50] for s, v in dup_boxes.items()},
        "geometry": {s: dict(d) for s, d in geom.items()},
    }, indent=2), encoding="utf-8")
    print(f"\n  -> {OUT_DIR}")


if __name__ == "__main__":
    main()
