# YOLO26n Nano Worst-Case Fine-Tune (old project)

`yolo26n/384/2-nano-worstcase-finetune/`

Real imgsz confirmed 384 from its own `args.yaml`.

## Files in this folder
- `best.pt` (5,350,014 bytes)
- `last.pt` (5,350,014 bytes)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\archived-candidate-models\YOLOv11 Nano Family\2-yolo26n_nano_worstcase_finetune_run\result`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | warm-started from 1-nano-baseline (this folder) |
| Real imgsz | 384 |
| Epochs (completed/planned) | 20/20 |
| Optimizer | AdamW |
| lr0 | 0.001 |
| momentum | 0.937 |
| weight_decay | unrecorded |
| warmup_epochs | unrecorded |
| box / cls / dfl loss weight | 7.5 / 1.2 / 1.5 |
| Wall-clock training time | 3,807.4s (1.06h) -- computed fresh from results.csv |

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

**Validation:** self-reported peak: mAP50 88.69%

**Test:** mAP50 88.69% / mAP50-95 57.19% / P 76.67% / R 82.76%. Per-class AP50: closed_eye 87.80%, open_eye 86.03%, yawning 91.35%.

**Test-result trust: LOW -- do not treat as verified.** This report's confusion-matrix table (closed_eye 2,160/180/45/25, open_eye 220/2,850/95/50, yawning 35/45/1,910/22) is **byte-identical** to test reports for other, architecturally different models in this project (confirmed by direct comparison this session) -- a physical impossibility for independently-run evaluations. The mAP50/P/R headline numbers may still be real, but this cannot be confirmed from the file alone. Treat as self-reported and unverified, not as a measured result.

(Newly-confirmed this session -- shares the identical confusion-matrix table with its own baseline above and with 3 other unrelated models.)

## Size
best.pt 5,350,014 B (5.10MB)
