"""
compare_experiments.py — Cross-Experiment Comparison Charts
=========================================================
Project : nano big -- driver drowsiness detection (closed_eye/open_eye/yawning)

(Renamed from visualize-info/visualize_model.py, BOOK.md Chapter 2 SS2.10.)
The original version of that file generated 10 charts and a "summary card"
image entirely from HARDCODED FAKE NUMBERS (mAP@50=91.33%, "26h 38m 18s (53
Epochs)", 33,365 total images -- none of these were ever measured; the real
dataset has 50,654 images) and wrote them into a stale path from an
unrelated prior project. None of that was reusable.

What this version actually does: per-model evaluation charts (PR curves,
confusion matrix, per-class AP, confidence curves) already exist and are
done correctly with REAL data by src/evaluate.py -- this file does not
duplicate that. Instead it aggregates REAL results ACROSS every completed
experiment so far, to support the Pareto (accuracy vs latency vs size)
comparison methodology described in EVALUATION_PROTOCOL.md, reading the
project's checkpoints/ + INFO/ folder convention (BOOK.md Ch.2 SS2.10 /
AGENTS.md):

  - checkpoints/*/*/run_config.json      (written by train.py after every
                                           run -- resolved hyperparameters
                                           + final metrics)
  - INFO/*/*-test-result/tested-images/metrics.json
                                          (written by evaluate.py after every
                                           evaluation -- mAP50/precision/
                                           recall/F1 + per-class AP)

If neither source has any data yet (nothing has been trained/evaluated),
this script says so explicitly and exits -- it does NOT fabricate
placeholder numbers to make the output directory look populated.

Usage:
    python src/compare_experiments.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt
import numpy as np

matplotlib.use("Agg")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

CLASSES = ["closed_eye", "open_eye", "yawning"]

# This aggregates results ACROSS every family (yolo26n, yolo11n, ...), so
# it doesn't belong inside any single family's folder -- INFO/_comparison/
# is the shared cross-experiment location (BOOK.md Ch.2 SS2.10 / AGENTS.md).
OUT_DIR = PROJECT_ROOT / "INFO" / "_comparison"


def _load_run_configs() -> list[dict]:
    checkpoints_dir = PROJECT_ROOT / "checkpoints"
    configs = []
    if not checkpoints_dir.exists():
        return configs
    for cfg_path in checkpoints_dir.rglob("run_config.json"):
        try:
            with open(cfg_path, "r", encoding="utf-8") as fh:
                cfg = json.load(fh)
            cfg["_run_dir"] = str(cfg_path.parent)
            # "<family>/<N-name>", e.g. "yolo26n/1-baseline"
            cfg["_run_name"] = f"{cfg_path.parent.parent.name}/{cfg_path.parent.name}"
            configs.append(cfg)
        except Exception as exc:
            print(f"[warn] could not read {cfg_path}: {exc}")
    return configs


def _load_eval_metrics() -> list[dict]:
    info_dir = PROJECT_ROOT / "INFO"
    results = []
    if not info_dir.exists():
        return results
    for metrics_path in info_dir.rglob("tested-images/metrics.json"):
        try:
            with open(metrics_path, "r", encoding="utf-8") as fh:
                results.append(json.load(fh))
        except Exception as exc:
            print(f"[warn] could not read {metrics_path}: {exc}")
    return results


def plot_training_comparison(configs: list[dict]) -> None:
    """Bar chart of final mAP50 / mAP50-95 across all completed training runs."""
    names, map50s, map5095s = [], [], []
    for cfg in configs:
        fm = cfg.get("final_metrics") or {}
        if not fm:
            continue
        names.append(cfg.get("_run_name", "?"))
        map50s.append(fm.get("mAP50", 0.0))
        map5095s.append(fm.get("mAP50-95", 0.0))

    if not names:
        print("[skip] no run_config.json contains final_metrics yet.")
        return

    x = np.arange(len(names))
    width = 0.35
    plt.figure(figsize=(max(8, len(names) * 1.2), 5))
    plt.bar(x - width / 2, map50s, width, label="mAP@50", color="#0ea5e9")
    plt.bar(x + width / 2, map5095s, width, label="mAP@50-95", color="#6366f1")
    plt.xticks(x, names, rotation=30, ha="right")
    plt.ylabel("Score")
    plt.ylim(0, 1.05)
    plt.title("Training Runs — Final mAP Comparison (real data from run_config.json)")
    plt.legend()
    plt.grid(True, alpha=0.3, axis="y")
    plt.tight_layout()
    out_path = OUT_DIR / "runs_map_comparison.png"
    plt.savefig(out_path, dpi=200)
    plt.close()
    print(f"Saved: {out_path}")


def plot_eval_per_class_ap(eval_results: list[dict]) -> None:
    """Per-class AP@50, one grouped bar chart per evaluated model."""
    if not eval_results:
        print("[skip] no INFO/*/*-test-result/tested-images/metrics.json found yet -- run evaluate.py first.")
        return

    names = [r.get("display_name", r.get("model_key", "?")) for r in eval_results]
    x = np.arange(len(CLASSES))
    width = 0.8 / max(len(eval_results), 1)

    plt.figure(figsize=(9, 5))
    for i, r in enumerate(eval_results):
        ap = r.get("ap_per_class", {})
        vals = [ap.get(c, 0.0) for c in CLASSES]
        plt.bar(x + i * width, vals, width, label=names[i])
    plt.xticks(x + width * (len(eval_results) - 1) / 2, CLASSES)
    plt.ylabel("AP@50")
    plt.ylim(0, 1.05)
    plt.title("Per-Class AP@50 by Evaluated Model (real data from evaluate.py)")
    plt.legend()
    plt.grid(True, alpha=0.3, axis="y")
    plt.tight_layout()
    out_path = OUT_DIR / "eval_per_class_ap.png"
    plt.savefig(out_path, dpi=200)
    plt.close()
    print(f"Saved: {out_path}")


def write_summary_report(configs: list[dict], eval_results: list[dict]) -> None:
    lines = ["# Experiment Comparison Summary\n"]
    lines.append(f"Generated from {len(configs)} run_config.json file(s) and "
                 f"{len(eval_results)} metrics.json file(s) found on disk.\n")

    if configs:
        lines.append("\n## Training Runs\n")
        lines.append("| Run | Weights | imgsz | epochs | mAP50 | mAP50-95 | Precision | Recall | Train Time |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        for cfg in configs:
            fm = cfg.get("final_metrics") or {}
            secs = cfg.get("total_train_seconds")
            time_str = f"{secs/3600:.1f}h" if secs else "?"
            lines.append(
                f"| {cfg.get('_run_name','?')} | {cfg.get('weights','?')} | "
                f"{cfg.get('imgsz','?')} | {cfg.get('epochs','?')} | "
                f"{fm.get('mAP50',0.0):.4f} | {fm.get('mAP50-95',0.0):.4f} | "
                f"{fm.get('precision',0.0):.4f} | {fm.get('recall',0.0):.4f} | {time_str} |"
            )
    else:
        lines.append("\nNo completed training runs found under checkpoints/ yet.\n")

    if eval_results:
        lines.append("\n## Evaluation Results\n")
        lines.append("| Model | mAP50 | Precision | Recall | F1 |")
        lines.append("|---|---|---|---|---|")
        for r in eval_results:
            lines.append(
                f"| {r.get('display_name','?')} | {r.get('map50',0.0):.4f} | "
                f"{r.get('precision',0.0):.4f} | {r.get('recall',0.0):.4f} | {r.get('f1',0.0):.4f} |"
            )
    else:
        lines.append("\nNo evaluation results found under INFO/ yet.\n")

    out_path = OUT_DIR / "comparison_summary.md"
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"Saved: {out_path}")


def generate_visualizations() -> None:
    configs = _load_run_configs()
    eval_results = _load_eval_metrics()

    if not configs and not eval_results:
        print("No run_config.json or metrics.json found yet -- nothing to visualize.")
        print("Train a model first: python src/train.py --config configs/yolo26n_baseline.yaml")
        print("Then evaluate it:     python src/evaluate.py --weights <best.pt>")
        return

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    plot_training_comparison(configs)
    plot_eval_per_class_ap(eval_results)
    write_summary_report(configs, eval_results)
    print(f"\nDone. Outputs written to: {OUT_DIR}")


if __name__ == "__main__":
    generate_visualizations()
