# YOLO11m 384 Worst-Case Fine-Tune

`yolo11m/384/1-worstcase-finetune/`

Real imgsz confirmed 384 from its own `args.yaml`.

## Files in this folder
- `best.pt` (40,481,893 bytes)
- `last.pt` (40,481,893 bytes)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\archived-candidate-models\YOLOv11 Medium Family\2-yolo11m_384_worstcase_run`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | warm-started from 640/1-baseline-trial2-winner |
| Real imgsz | 384 |
| Epochs (completed/planned) | 40/40 |
| Optimizer | AdamW |
| lr0 | 0.002 |
| momentum | 0.937 (recorded field, largely inert under AdamW) |
| weight_decay | 0.0005 |
| warmup_epochs | unrecorded |
| box / cls / dfl loss weight | 7.5 / 1.2 (verified from args.yaml -- NOT the 1.5 its own model_summary.txt claims) / 1.5 |
| Wall-clock training time | 27,661.1s (7.68h) |

## Augmentation (worst-case (extreme cabin-glare variant))

| Param | Value |
|---|---|
| hsv_h | unrecorded (model_summary describes 'extreme HSV jitter, severe contrast reduction' qualitatively only) |
| hsv_s | - |
| hsv_v | - |
| degrees | - |
| translate | - |
| scale | - |
| shear | - |
| perspective | - |
| fliplr | - |
| flipud | - |
| mosaic | - |
| mixup | - |
| erasing | 0.3 (stated) |
| auto_augment | - |
| amp | - |

## Results

**Validation:** self-reported peak: mAP50 88.94%

**Test:** info_legacy_archive claims 91.05% mAP50 / 66.88% mAP50-95 / 84.07% P / 88.95% R

**Test-result trust: LOW -- do not treat as verified.** This report's confusion-matrix table (closed_eye 2,160/180/45/25, open_eye 220/2,850/95/50, yawning 35/45/1,910/22) is **byte-identical** to test reports for other, architecturally different models in this project (confirmed by direct comparison this session) -- a physical impossibility for independently-run evaluations. The mAP50/P/R headline numbers may still be real, but this cannot be confirmed from the file alone. Treat as self-reported and unverified, not as a measured result.

## Size
best.pt 40,481,893 B (38.6MB), best.onnx 80,326,952 B (76.6MB)
