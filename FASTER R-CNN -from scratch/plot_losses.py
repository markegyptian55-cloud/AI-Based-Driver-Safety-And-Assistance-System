"""
plot_losses.py
--------------
Draw the training loss curves (and validation mAP) from results/train_log.csv,
which train.py writes one row per epoch.

Usage:
    python plot_losses.py
    python plot_losses.py --csv results/train_log.csv --out results/loss_curve.png
"""

import os
import csv
import argparse

import matplotlib.pyplot as plt

import config


def read_log(csv_path):
    """Read the per-epoch CSV into a dict of columns (lists of floats)."""
    cols = {"epoch": [], "rpn_obj_loss": [], "rpn_box_loss": [],
            "det_cls_loss": [], "det_box_loss": [], "total": [], "val_map": []}
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            for k in cols:
                cols[k].append(float(row[k]))
    return cols


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=os.path.join(config.RESULTS_DIR, "train_log.csv"))
    ap.add_argument("--out", default=os.path.join(config.RESULTS_DIR, "loss_curve.png"))
    args = ap.parse_args()

    if not os.path.exists(args.csv):
        raise FileNotFoundError(
            f"{args.csv} not found. It is written by train.py during training "
            "(one row per epoch). Train at least one epoch first.")

    d = read_log(args.csv)
    epochs = d["epoch"]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5))

    # left: the four losses + total
    ax1.plot(epochs, d["total"],        "k-",  lw=2.2, label="total")
    ax1.plot(epochs, d["rpn_obj_loss"], label="rpn_obj")
    ax1.plot(epochs, d["rpn_box_loss"], label="rpn_box")
    ax1.plot(epochs, d["det_cls_loss"], label="det_cls")
    ax1.plot(epochs, d["det_box_loss"], label="det_box")
    ax1.set_xlabel("epoch"); ax1.set_ylabel("loss")
    ax1.set_title("Training loss per epoch")
    ax1.grid(True, alpha=0.3); ax1.legend()

    # right: validation mAP
    ax2.plot(epochs, d["val_map"], "g-o", ms=3, label="val mAP@0.5")
    best_i = max(range(len(epochs)), key=lambda i: d["val_map"][i])
    ax2.scatter([epochs[best_i]], [d["val_map"][best_i]], color="red", zorder=5,
                label=f"best {d['val_map'][best_i]:.4f} @ epoch {int(epochs[best_i])}")
    ax2.set_xlabel("epoch"); ax2.set_ylabel("mAP@0.5")
    ax2.set_title("Validation mAP per epoch")
    ax2.grid(True, alpha=0.3); ax2.legend()

    fig.tight_layout()
    fig.savefig(args.out, dpi=130)
    print(f"saved {args.out}")
    plt.show()


if __name__ == "__main__":
    main()
