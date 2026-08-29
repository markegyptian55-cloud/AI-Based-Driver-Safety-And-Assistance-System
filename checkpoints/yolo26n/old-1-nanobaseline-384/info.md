# YOLO26n Nano Baseline (old project)

`yolo26n/384/1-nano-baseline/`

Real imgsz confirmed 384 from its own `args.yaml`.

## Files in this folder
- `best.pt` (5,352,382 bytes)
- `last.pt` (5,352,382 bytes)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\archived-candidate-models\YOLOv11 Nano Family\1-yolo26n_nano_baseline_run\result`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | fresh yolo26n.pt |
| Real imgsz | 384 |
| Epochs (completed/planned) | 40/40 |
| Optimizer | AdamW |
| lr0 | 0.002 |
| momentum | 0.937 |
| weight_decay | unrecorded |
| warmup_epochs | unrecorded |
| box / cls / dfl loss weight | 7.5 / 1.2 / 1.5 |
| Wall-clock training time | 9,058.58s (2.52h) -- computed fresh from results.csv |

## Augmentation (worst-case)

| Param | Value |
|---|---|
| hsv_h | unrecorded |
| hsv_s | - |
| hsv_v | - |
| degrees | - |
| translate | - |
| scale | - |
| shear | - |
| perspective | - |
| fliplr | - |
| flipud | - |
| mosaic | 0.8 (stated) |
| erasing | 0.3 (stated) |
| mixup | - |
| auto_augment | - |
| amp | - |

## Results

**Validation:** self-reported peak: mAP50 87.79%

**Test:** mAP50 87.79% / mAP50-95 55.48% / P 77.19% / R 82.19%. Per-class AP50: closed_eye 86.91%, open_eye 85.16%, yawning 90.42%.

**Test-result trust: LOW -- do not treat as verified.** This report's confusion-matrix table (closed_eye 2,160/180/45/25, open_eye 220/2,850/95/50, yawning 35/45/1,910/22) is **byte-identical** to test reports for other, architecturally different models in this project (confirmed by direct comparison this session) -- a physical impossibility for independently-run evaluations. The mAP50/P/R headline numbers may still be real, but this cannot be confirmed from the file alone. Treat as self-reported and unverified, not as a measured result.

(This is a newly-confirmed finding from this session -- this report was not previously checked against the templated-confusion-matrix pattern; it shares the identical table.)

## Size
best.pt 5,352,382 B (5.10MB)
