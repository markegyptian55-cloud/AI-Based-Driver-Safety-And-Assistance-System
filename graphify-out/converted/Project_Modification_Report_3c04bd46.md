<!-- converted from Project_Modification_Report.docx -->

Project Modification Report
Driver Drowsiness Detection - Faster R-CNN (from scratch)
Date: 2026-07-20
# 1. Changes Made

# 2. Architecture Parameters

# 3. Hyperparameter Status

# 4. Data Augmentation (training split only)

# 5. Results (so far)

## Notes
Legend: changed (blue) = value modified;  added (green) = newly introduced;  locked = fixed by design.
The 16-anchor configuration changes the model architecture, so the tuned model must be trained from scratch - the 9-anchor baseline checkpoint (checkpoints/best.pth) cannot be loaded under the current config.
The optimizer settings (SGD, lr=0.005, momentum=0.9, weight_decay=5e-4) were already in place and required no change.
Each experiment is saved separately (checkpoints/<run>/, results/train_log_<run>.csv, test_metrics_<tag>.json) so baseline and tuned results can be graphed and compared via compare_runs.py.
| # | Change | File(s) | Purpose |
| --- | --- | --- | --- |
| 1 | Recreated missing backbone | models/backbone.py | File was absent; rebuilt the 4-block CNN (stride 16). Project could not run without it. |
| 2 | Resume + robust checkpoints | train.py | --resume flag; checkpoints store optimizer + scheduler state; best.pth protected from worse epochs. |
| 3 | VRAM cap | train.py | --vram-fraction to limit GPU memory usage. |
| 4 | Per-epoch logging | train.py | Logs loss + val mAP + LR to results/train_log_<run>.csv; per-run checkpoints in checkpoints/<run>/. |
| 5 | Loss / mAP plots | plot_losses.py (new) | Generates training loss and validation mAP curves. |
| 6 | Video inference | video.py (new) | Runs the detector on a video file with driver-state overlay. |
| 7 | Driver-state bug fix | utils/driver_state.py | Fixed false DROWSY on open eyes (closed must outnumber open). |
| 8 | Tuning changes | config.py, dataset.py, train.py | Anchors, augmentation, scheduler, early stopping (see below). |
| 9 | Per-run test outputs | test.py | --tag saves test_metrics_<tag>.json separately. |
| 10 | Baseline-vs-tuned comparison | compare_runs.py (new) | Overlays curves and prints metric deltas. |
| Parameter | Baseline | Tuned (current) | Status |
| --- | --- | --- | --- |
| Input size | 640x640 | 640x640 | locked |
| Backbone stride | 16 | 16 | locked |
| Feature map | 40x40x256 | 40x40x256 | locked |
| Backbone | 4 conv blocks (~2.3M) | same | unchanged |
| Anchor scales | [32, 64, 128] | [8, 16, 32, 64] | changed |
| Anchor ratios | [0.5, 1.0, 2.0] | [0.5, 1.0, 2.0, 3.0] | changed |
| Anchors per cell | 9 | 16 | changed |
| Total anchors (K) | 14,400 | 25,600 | changed |
| RoI Align output | 7x7 | 7x7 | unchanged |
| RoI FC dim | 1024 | 1024 | unchanged |
| Classes | 3 + background | 3 + background | unchanged |
| Total model params | ~16.85M | ~16.86M | ~same |
| Hyperparameter | Value | Status |
| --- | --- | --- |
| Optimizer | SGD | unchanged |
| Learning rate | 0.005 | unchanged |
| Momentum | 0.9 | unchanged |
| Weight decay | 5e-4 | unchanged |
| Batch size | 4 | unchanged |
| Epochs (max) | 50 (was 30) | changed |
| LR scheduler | ReduceLROnPlateau (mode=max, factor=0.5, patience=3, min_lr=1e-6) | changed |
| Early stopping | patience 8 | added |
| RPN pos / neg IoU | 0.7 / 0.3 | unchanged |
| RPN batch / pos frac | 256 / 0.5 | unchanged |
| RoI batch / pos frac | 128 / 0.25 | unchanged |
| RoI foreground IoU | 0.5 | unchanged |
| Score threshold | 0.5 | unchanged |
| Detection NMS IoU | 0.4 | unchanged |
| Augmentation | Setting | Status |
| --- | --- | --- |
| Horizontal flip | p = 0.5 | pre-existing |
| ColorJitter | brightness 0.3, contrast 0.3, saturation 0.2, hue 0.02 | added |
| RandomAffine (box-aware) | p=0.5, +/-8 deg, scale 0.8-1.2, translate <=10% | added |
| Metric | Baseline | Tuned |
| --- | --- | --- |
| Test mAP@0.5 | 0.726 | training in progress |
| Best validation mAP | 0.740 | >=0.624 (epoch 18, rising) |