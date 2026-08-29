# RF-DETR Small Standard -- best RF-DETR Small result

`rfdetr-small/640/2-standard/`

Self-reported values only, no raw config file exists.

## Files in this folder
- (no weight files found at the expected path -- see note)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\checkpoints\Fullstack Web App Models\RF-DETR Small Standard\2-rfdetr_small_standard_run`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | 1-baseline (this family) |
| Real imgsz | 640 (self-reported) |
| Epochs (completed/planned) | 40/40 |
| Optimizer | AdamW |
| lr0 | decoder 2e-5 / encoder 1e-6 |
| momentum | n/a |
| weight_decay | 1e-4 |
| warmup_epochs | unrecorded |
| box / cls / dfl loss weight | 5.0 (giou) / 1.0 / n/a |
| Wall-clock training time | 120,000s (33.33h) |

## Augmentation (standard (clean))

*HorizontalFlip p=0.5 only, per model_summary.txt* (RF-DETR augmentation is not a per-parameter Ultralytics-style block; only the qualitative description above is on record.)

## Results

**Validation:** self-reported peak: mAP50 88.72% (ep40), mAP50-95 57.47% (ep38)

**Test:** TRUSTED report: mAP50 89.27% / P 72.71% / R 89.62% / F1 80.10%. Per-class AP50: closed_eye 92.88%, open_eye 84.82%, yawning 90.10%.

**Test-result trust: HIGH.** Sourced from the old project's root `info/<name>/test_summary.md`, which does not include the templated confusion-matrix block found in every `archived-candidate-models/**/test_summary.md` report (see below) -- this report's numbers are distinct and internally consistent, not shared with any other model's report.

## Size
checkpoint_best_ema.pth 128,291,863 B (122.4MB)
