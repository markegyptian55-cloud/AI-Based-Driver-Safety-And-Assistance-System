"""
collect_training_curves.py — mirror real training curves into INFO/
===================================================================
Project : nano big -- driver drowsiness detection (closed_eye/open_eye/yawning)

plot_training_curves.py writes its output next to the weights, under
checkpoints/<family>/<N-name>/report/. The per-model evidence base the
project reports from lives under INFO/<family>/<N-name>-test-result/, so
this copies each generated curve into that model's own result folder,
under a `training-curves/` subfolder kept deliberately separate from
`tested-images/charts/`: those ten charts are TEST-time measurements,
these two are TRAIN-time history, and merging them would blur which
split a figure came from.

Runs with no results.csv anywhere get an explicit NO_TRAINING_HISTORY.md
instead of a plot. Their training history was not preserved (the RF-DETR
checkpoints store only final `epoch`/`global_step`, no per-epoch loss),
and the archived PNGs that appear to show it are not trustworthy -- one
byte-identical image is shared across four runs spanning two different
architectures. A stated absence is recoverable; a fabricated curve in a
printed report is not.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CHECKPOINTS = PROJECT_ROOT / "checkpoints"
INFO = PROJECT_ROOT / "INFO"

CURVES = ("01_loss_curves.png", "02_map_curves.png")

ABSENT_NOTE = """# Training history not preserved

No per-epoch training record exists for this run, so no loss or mAP curve
can be plotted for it.

**What was checked**

- No `results.csv` (or `metrics.csv`) in this run's checkpoint directory.
- No `results.csv` recoverable from the originating project archive.
- For the RF-DETR runs, the checkpoint itself was opened directly: it
  stores `epoch`, `global_step`, `args`, `model_config` and weights, but
  no per-epoch loss series.

**Why no chart is supplied instead**

Chart images in the originating archive that appear to show this run's
training history are not trustworthy: hashing them showed one
byte-identical `07_training_loss_curves.png` shared across four runs
spanning two different architectures, and a single identical
`08_confusion_matrix.png` shared across all eleven archived runs. Those
images cannot represent this model and are not reproduced here.

Test-time evaluation for this model is unaffected and is present in
`tested-images/` -- it was measured directly from the checkpoint on the
held-out test split.
"""


def find_result_dir(family: str, run_name: str) -> Path | None:
    """INFO/<family>/<run_name>-test-result, if the model has one."""
    candidate = INFO / family / f"{run_name}-test-result"
    return candidate if candidate.is_dir() else None


def main() -> int:
    if not CHECKPOINTS.is_dir():
        print(f"No checkpoints/ at {CHECKPOINTS} -- nothing to collect.")
        return 1

    copied = missing = orphan = 0

    for run_dir in sorted(p for p in CHECKPOINTS.glob("*/*") if p.is_dir()):
        family, run_name = run_dir.parent.name, run_dir.name
        result_dir = find_result_dir(family, run_name)

        if result_dir is None:
            print(f"[no result dir ] {family}/{run_name}")
            orphan += 1
            continue

        report_dir = run_dir / "report"
        available = [c for c in CURVES if (report_dir / c).exists()]

        out_dir = result_dir / "training-curves"
        out_dir.mkdir(parents=True, exist_ok=True)

        if available:
            # A previous run may have left the absence note here; the run
            # now has real curves, so the note no longer applies.
            stale = out_dir / "NO_TRAINING_HISTORY.md"
            if stale.exists():
                stale.unlink()
            for name in available:
                shutil.copy2(report_dir / name, out_dir / name)
            print(f"[curves {len(available)}      ] {family}/{run_name}")
            copied += 1
        else:
            (out_dir / "NO_TRAINING_HISTORY.md").write_text(
                ABSENT_NOTE, encoding="utf-8"
            )
            print(f"[no history    ] {family}/{run_name}")
            missing += 1

    print(
        f"\n{copied} model(s) with real training curves, "
        f"{missing} with a stated-absence note, "
        f"{orphan} checkpoint(s) with no INFO result folder."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
