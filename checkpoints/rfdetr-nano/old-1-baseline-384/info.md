# RF-DETR Nano Baseline

`rfdetr-nano/384/1-baseline/`

RF-DETR does not use Ultralytics' args.yaml -- resolution/hyperparameters below are self-reported from model_summary.txt only, not independently verified against a raw config file (none exists for RF-DETR runs in this project).

## Files in this folder
- `checkpoint_best_ema.pth` (120,822,075 bytes)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\archived-candidate-models\RF-DETR Nano Family\1-rfdetr_nano_baseline_run\result`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | fresh (RF-DETR Nano pretrained backbone) |
| Real imgsz | 384 (self-reported, not independently verified) |
| Epochs (completed/planned) | 50/50 |
| Optimizer | AdamW |
| lr0 | decoder 2e-5 / encoder 1e-6 |
| momentum | n/a (AdamW) |
| weight_decay | 1e-4 |
| warmup_epochs | unrecorded |
| box / cls / dfl loss weight | 5.0 (giou) / 1.0 / n/a (not a YOLO loss term) |
| Wall-clock training time | 16,200s (4.50h) |

## Augmentation (standard (clean))

*HorizontalFlip p=0.5 only, per model_summary.txt* (RF-DETR augmentation is not a per-parameter Ultralytics-style block; only the qualitative description above is on record.)

## Results

**Validation:** self-reported: mAP50 91.80%

**Test:** No independent test evaluation found for this specific run (superseded by the fine-tune below).

**Test-result trust: NO INDEPENDENT TEST EVALUATION FOUND.** Only training-time self-reported val numbers exist for this run (from its own `model_summary.txt`/`model_analysis.txt`, which have been found to disagree with each other and with `args.yaml` for other runs in this project -- treat any single-source number here as unverified).

## Size
checkpoint_best_ema.pth 120,822,075 B (115.2MB)
