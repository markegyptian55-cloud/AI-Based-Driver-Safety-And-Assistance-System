"""
compare_runs.py
---------------
Compare the BASELINE run against the TUNED run:
  * overlays their validation mAP and total-loss curves on one figure
  * prints a side-by-side table of the final TEST metrics

Usage (defaults assume the baseline was saved and the tuned run used
--run-name tuned + test.py --tag tuned):

    python compare_runs.py

    # or point at specific files:
    python compare_runs.py --baseline-log results/baseline_train_log.csv \
                           --tuned-log results/train_log_tuned.csv \
                           --baseline-metrics results/baseline_test_metrics.json \
                           --tuned-metrics results/test_metrics_tuned.json
"""

import os
import csv
import json
import argparse

import matplotlib.pyplot as plt

import config


def read_log(path):
    """Read a train_log CSV -> dict of columns (epoch, total, val_map)."""
    ep, total, vmap = [], [], []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            ep.append(float(row["epoch"]))
            total.append(float(row["total"]))
            vmap.append(float(row["val_map"]))
    return ep, total, vmap


def load_json(path):
    with open(path) as f:
        return json.load(f)


def fmt(a, b):
    """Format 'a -> b (+delta)' for a metric."""
    d = b - a
    sign = "+" if d >= 0 else ""
    return f"{a:.4f} -> {b:.4f}  ({sign}{d:.4f})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline-log", default="results/baseline_train_log.csv")
    ap.add_argument("--tuned-log", default="results/train_log_tuned.csv")
    ap.add_argument("--baseline-metrics", default="results/baseline_test_metrics.json")
    ap.add_argument("--tuned-metrics", default="results/test_metrics_tuned.json")
    ap.add_argument("--out", default="results/comparison.png")
    args = ap.parse_args()

    # ---- curves ----
    have_logs = os.path.exists(args.baseline_log) and os.path.exists(args.tuned_log)
    if have_logs:
        b_ep, b_total, b_map = read_log(args.baseline_log)
        t_ep, t_total, t_map = read_log(args.tuned_log)

        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5))
        ax1.plot(b_ep, b_total, "o-", ms=3, label="baseline")
        ax1.plot(t_ep, t_total, "s-", ms=3, label="tuned")
        ax1.set_xlabel("epoch"); ax1.set_ylabel("total loss")
        ax1.set_title("Total training loss"); ax1.grid(True, alpha=0.3); ax1.legend()

        ax2.plot(b_ep, b_map, "o-", ms=3, label="baseline")
        ax2.plot(t_ep, t_map, "s-", ms=3, label="tuned")
        ax2.set_xlabel("epoch"); ax2.set_ylabel("val mAP@0.5")
        ax2.set_title("Validation mAP"); ax2.grid(True, alpha=0.3); ax2.legend()

        fig.tight_layout()
        fig.savefig(args.out, dpi=130)
        print(f"saved comparison curve -> {args.out}")
    else:
        print("[curves] skipped (need both "
              f"{args.baseline_log} and {args.tuned_log})")

    # ---- metrics table ----
    if os.path.exists(args.baseline_metrics) and os.path.exists(args.tuned_metrics):
        base = load_json(args.baseline_metrics)
        tune = load_json(args.tuned_metrics)

        lines = []
        lines.append("\n================ BASELINE vs TUNED (test set) ================")
        for key in ["mAP@0.5", "mAP@0.5:0.95", "precision", "recall", "f1",
                    "detection_accuracy", "mean_iou"]:
            if key in base and key in tune:
                lines.append(f"  {key:20s}: {fmt(base[key], tune[key])}")
        lines.append("  AP per class:")
        for name in base.get("AP_per_class", {}):
            if name in tune.get("AP_per_class", {}):
                lines.append(f"    {name:16s}: "
                             f"{fmt(base['AP_per_class'][name], tune['AP_per_class'][name])}")
        report = "\n".join(lines)
        print(report)

        txt_path = os.path.join(config.RESULTS_DIR, "comparison_metrics.txt")
        with open(txt_path, "w") as f:
            f.write(report + "\n")
        print(f"\nsaved comparison table -> {txt_path}")
    else:
        print("[metrics] skipped (need both "
              f"{args.baseline_metrics} and {args.tuned_metrics}); "
              "run test.py on each model first.")


if __name__ == "__main__":
    main()
