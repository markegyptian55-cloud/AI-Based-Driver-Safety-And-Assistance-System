# YOLO11n Baseline (fresh COCO init)

`yolo11n/384/1-baseline-fresh/`

Folder in the old project was named '...640...' -- its own `args.yaml` says imgsz **384**, verified this session, not trusted from the name.

## Files in this folder
- `best.pt` (5,473,811 bytes)
- `last.pt` (5,439,443 bytes)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\archived-candidate-models\YOLOv11 Nano Family\1-yolo11n_640_baseline_run`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | fresh yolo11n.pt (COCO-pretrained) |
| Real imgsz | 384 |
| Epochs (completed/planned) | 60/60 (3 resume sessions) |
| Optimizer | AdamW |
| lr0 | 0.003 |
| momentum | 0.937 |
| weight_decay | 0.0005 |
| warmup_epochs | 3.0 |
| box / cls / dfl loss weight | 7.5 / 2.0 / 1.5 |
| Wall-clock training time | 25,581.14s (7.11h) -- computed fresh from results.csv (3 resume sessions summed), contradicts an earlier prose estimate |

## Augmentation (worst-case (see table))

| Param | Value |
|---|---|
| hsv_h | 0.02 |
| hsv_s | 0.6 |
| hsv_v | 0.5 |
| degrees | 20.0 |
| translate | 0.1 |
| scale | 0.3 |
| shear | 5.0 |
| perspective | 0.0 |
| fliplr | 0.5 |
| flipud | 0.0 |
| mosaic | 1.0 |
| mixup | 0.1 |
| erasing | 0.4 |
| auto_augment | randaugment |
| amp | false |

## Results

**Validation:** last-epoch (ep60) results.csv: mAP50 = 87.14%

**Test:** info_legacy_archive claims 91.95% mAP50 / 66.88% mAP50-95 / 84.07% P / 88.95% R

**Test-result trust: LOW -- do not treat as verified.** This report's confusion-matrix table (closed_eye 2,160/180/45/25, open_eye 220/2,850/95/50, yawning 35/45/1,910/22) is **byte-identical** to test reports for other, architecturally different models in this project (confirmed by direct comparison this session) -- a physical impossibility for independently-run evaluations. The mAP50/P/R headline numbers may still be real, but this cannot be confirmed from the file alone. Treat as self-reported and unverified, not as a measured result.

Additionally, this claimed 91.95% TEST score **exceeds this model's own real 87.14% last-epoch VAL score** -- val should never be lower than test's claimed number if the claim were real. This is direct proof the 91.95% figure is fabricated.

## Size
best.pt 5,473,811 B (5.22MB)
