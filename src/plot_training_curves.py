"""
plot_training_curves.py — Real Loss/mAP Curve Plotter
=========================================================
Project : nano big -- driver drowsiness detection (closed_eye/open_eye/yawning)

(Renamed from visualize-info/plot_loss.py, BOOK.md Chapter 2 SS2.10 -- it
now plots mAP curves too, not just loss.) Reads Ultralytics' own
results.csv (written automatically by every train.py run) for each
checkpoints/<family>/<N-name>/ experiment and plots real train/val loss +
validation mAP curves into checkpoints/<family>/<N-name>/report/.
"""

from pathlib import Path
import os
import csv
import sys
import matplotlib.pyplot as plt
import matplotlib

matplotlib.use("Agg")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def parse_csv_metrics(metrics_file: Path):
    with open(metrics_file, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    epochs_data = {}
    for r in rows:
        ep = r.get("epoch", "")
        if ep == "":
            continue
        ep = int(float(ep))
        if ep not in epochs_data:
            epochs_data[ep] = {}
        for k, v in r.items():
            if v is not None and v.strip() != "":
                try:
                    epochs_data[ep][k] = float(v)
                except ValueError:
                    epochs_data[ep][k] = v
    return epochs_data


def plot_metrics_for_run(run_dir: Path, title_prefix: str = "Model Run"):
    """
    Reads Ultralytics' own results.csv (written automatically by every
    YOLO().train() run) and plots real train/val loss + mAP curves.

    Fixed a real bug here (BOOK.md Chapter 2, SS2.10): the previous version
    looked for "train/loss"/"val/loss" columns that Ultralytics' results.csv
    has never used -- the real column names are
    train/box_loss, train/cls_loss, train/dfl_loss, val/box_loss,
    val/cls_loss, val/dfl_loss, metrics/mAP50(B), metrics/mAP50-95(B),
    metrics/precision(B), metrics/recall(B). The old code would have
    silently plotted a flat 0.0 line for every run.
    """
    report_dir = run_dir / "report"
    os.makedirs(report_dir, exist_ok=True)
    metrics_file = run_dir / "metrics.csv"
    if not metrics_file.exists():
        metrics_file = run_dir / "results.csv"

    if not metrics_file.exists():
        print(f"No metrics.csv/results.csv found in {run_dir}.")
        return

    print(f"Loading metrics from: {metrics_file}")
    epochs_data = parse_csv_metrics(metrics_file)
    if not epochs_data:
        print("No valid epoch data found.")
        return

    epochs = sorted(epochs_data.keys())
    ep_num = [e + 1 for e in epochs]

    def col(name, default=0.0):
        return [epochs_data[e].get(name, default) for e in epochs]

    train_box = col("train/box_loss")
    train_cls = col("train/cls_loss")
    train_dfl = col("train/dfl_loss")
    val_box = col("val/box_loss")
    val_cls = col("val/cls_loss")
    val_dfl = col("val/dfl_loss")

    # Combined per-component loss total, train vs val
    tr_total = [b + c + d for b, c, d in zip(train_box, train_cls, train_dfl)]
    val_total = [b + c + d for b, c, d in zip(val_box, val_cls, val_dfl)]

    plt.figure(figsize=(10, 6))
    if any(v != 0.0 for v in tr_total):
        plt.plot(ep_num, tr_total, label="Training Loss (box+cls+dfl)", linewidth=2.5, marker="o", color="#1f77b4")
    if any(v != 0.0 for v in val_total):
        plt.plot(ep_num, val_total, label="Validation Loss (box+cls+dfl)", linewidth=2.5, marker="s", color="#ff7f0e")

    plt.xlabel("Epoch", fontsize=12)
    plt.ylabel("Loss Value", fontsize=12)
    plt.title(f"{title_prefix} - Training vs Validation Loss", fontsize=14, fontweight="bold")
    plt.grid(True, linestyle="--", alpha=0.6)
    plt.legend(fontsize=11)
    plt.tight_layout()
    loss_out_path = report_dir / "01_loss_curves.png"
    plt.savefig(loss_out_path, dpi=300)
    plt.close()
    print(f"Saved loss curve plot to: {loss_out_path}")

    map50 = col("metrics/mAP50(B)")
    map5095 = col("metrics/mAP50-95(B)")
    if any(v != 0.0 for v in map50) or any(v != 0.0 for v in map5095):
        plt.figure(figsize=(10, 6))
        plt.plot(ep_num, map50, label="mAP@50", linewidth=2.5, marker="o", color="#10b981")
        plt.plot(ep_num, map5095, label="mAP@50-95", linewidth=2.5, marker="s", color="#6366f1")
        plt.xlabel("Epoch", fontsize=12)
        plt.ylabel("mAP", fontsize=12)
        plt.title(f"{title_prefix} - Validation mAP", fontsize=14, fontweight="bold")
        plt.grid(True, linestyle="--", alpha=0.6)
        plt.legend(fontsize=11)
        plt.ylim(0, 1.05)
        plt.tight_layout()
        map_out_path = report_dir / "02_map_curves.png"
        plt.savefig(map_out_path, dpi=300)
        plt.close()
        print(f"Saved mAP curve plot to: {map_out_path}")


def main():
    print("Generating loss and metrics plots...")
    # Scans checkpoints/<family>/<N-name>/ (train.py's output convention,
    # BOOK.md Ch.2 SS2.10 / AGENTS.md). Run directories are named
    # "<N>-<name>" (e.g. "1-baseline", "2-worst-case-augmentation") nested
    # under a per-family folder, so scan every leaf directory that actually
    # contains a results.csv/metrics.csv instead of matching a fixed suffix
    # pattern, and title each plot "<family>/<N-name>" for context.
    checkpoints_dir = PROJECT_ROOT / "checkpoints"
    if not checkpoints_dir.exists():
        print(f"No checkpoints/ directory found yet at {checkpoints_dir} -- train a model first.")
        return
    found = False
    for candidate in checkpoints_dir.rglob("results.csv"):
        found = True
        run_path = candidate.parent
        title = f"{run_path.parent.name}/{run_path.name}"
        plot_metrics_for_run(run_path, title)
    for candidate in checkpoints_dir.rglob("metrics.csv"):
        run_path = candidate.parent
        if (run_path / "report" / "01_loss_curves.png").exists():
            continue  # already handled via results.csv in this same dir
        found = True
        title = f"{run_path.parent.name}/{run_path.name}"
        plot_metrics_for_run(run_path, title)
    if not found:
        print(f"No results.csv/metrics.csv found under {checkpoints_dir} yet.")


if __name__ == "__main__":
    main()
