# YOLO11n Worst-Case Fine-Tune (WebGPU Prototype) -- the DMS checkpoint used for this project's cross-dataset warm-start experiments

`yolo11n/640/2-worstcase-finetune-dms/`

Real imgsz 640 confirmed from its own `args.yaml` (this one's folder name IS accurate, unlike its parent baseline above).

## Files in this folder
- `best.pt` (5,473,811 bytes)
- `last.pt` (5,473,811 bytes)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\checkpoints\Frontend Browser Models (WebGPU Prototype)\YOLO11n Nano Worst-Case (WebGPU Prototype)\2-yolo11n_640_worstcase_finetune_run`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | warm-started from 1-baseline-fresh (this folder, 384) |
| Real imgsz | 640 |
| Epochs (completed/planned) | 60/60 |
| Optimizer | AdamW |
| lr0 | 0.001 |
| momentum | 0.937 |
| weight_decay | 0.0005 |
| warmup_epochs | 3.0 |
| box / cls / dfl loss weight | 7.5 / 2.0 / 1.5 |
| Wall-clock training time | 25,233.6s (7.01h) |

## Augmentation (worst-case)

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

**Validation:** results.csv peak: mAP50 = 90.03% (ep58, plateaued 58-60)

**Test:** mAP50 86.72% / P 81.85% / R 72.79% / F1 76.99%. Per-class AP50: closed_eye 90.48%, open_eye 81.40%, yawning 88.29%.

**Test-result trust: HIGH.** Sourced from the old project's root `info/<name>/test_summary.md`, which does not include the templated confusion-matrix block found in every `archived-candidate-models/**/test_summary.md` report (see below) -- this report's numbers are distinct and internally consistent, not shared with any other model's report.

## Size
best.pt 5,473,811 B (5.22MB), best.onnx 10,605,756 B (10.11MB)
