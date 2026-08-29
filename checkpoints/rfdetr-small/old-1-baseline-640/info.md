# RF-DETR Small Baseline

`rfdetr-small/640/1-baseline/`

Self-reported values only, no raw config file exists.

## Files in this folder
- (no weight files found at the expected path -- see note)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\archived-candidate-models\RF-DETR Small Family\1-rfdetr_small_baseline_run`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | fresh (RF-DETR Small pretrained backbone) |
| Real imgsz | 640 (self-reported) |
| Epochs (completed/planned) | 15/15 |
| Optimizer | AdamW |
| lr0 | decoder 2e-5 / encoder 1e-6 |
| momentum | n/a |
| weight_decay | 1e-4 |
| warmup_epochs | unrecorded |
| box / cls / dfl loss weight | 5.0 (giou) / 1.5 / n/a |
| Wall-clock training time | 51,120s (14.20h) |

## Augmentation (worst-case)

*Heavy lighting & spatial distortion, per model_summary.txt* (RF-DETR augmentation is not a per-parameter Ultralytics-style block; only the qualitative description above is on record.)

## Results

**Validation:** self-reported: mAP50 83.80%

**Test:** No independent test evaluation found for this specific run (superseded by the standard run below).

**Test-result trust: NO INDEPENDENT TEST EVALUATION FOUND.** Only training-time self-reported val numbers exist for this run (from its own `model_summary.txt`/`model_analysis.txt`, which have been found to disagree with each other and with `args.yaml` for other runs in this project -- treat any single-source number here as unverified).

## Size
checkpoint_best_ema.pth 128,292,439 B (122.4MB)
