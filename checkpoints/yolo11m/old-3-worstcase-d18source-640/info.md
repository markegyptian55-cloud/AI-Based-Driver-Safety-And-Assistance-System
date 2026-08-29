# YOLO11m 640 Worst-Case -- the checkpoint this project's D18 cross-dataset warm-start (86.42% real test, this project's best result) was built from

`yolo11m/640/2-worstcase-finetune-d18-source/`

Real imgsz 640 confirmed from its own `args.yaml`.

## Files in this folder
- `best.pt` (40,516,133 bytes)
- `last.pt` (40,516,133 bytes)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\checkpoints\Fullstack Web App Models\YOLOv11m 640 Worst-Case\2-yolo11m_640_worstcase_run`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | warm-started from 640/1-baseline-trial2-winner |
| Real imgsz | 640 |
| Epochs (completed/planned) | 40/40 |
| Optimizer | AdamW |
| lr0 | 0.001 |
| momentum | 0.937 |
| weight_decay | 0.0005 |
| warmup_epochs | unrecorded |
| box / cls / dfl loss weight | 7.5 / 2.0 (verified from args.yaml -- NOT the 1.5 its own model_summary.txt claims) / 1.5 |
| Wall-clock training time | 145,547.9s (40.43h) -- the single longest training run in either project |

## Augmentation (worst-case)

| Param | Value |
|---|---|
| hsv_h | 0.02 |
| hsv_s | 0.6 |
| hsv_v | 0.5 |
| degrees | 15.0 |
| translate | 0.1 |
| scale | 0.3 |
| shear | 5.0 |
| perspective | 0.0 |
| fliplr | 0.5 |
| flipud | 0.0 |
| mosaic | 0.8 |
| mixup | 0.1 |
| erasing | 0.3 |
| auto_augment | - |
| amp | - |

## Results

**Validation:** self-reported peak: mAP50 91.52%

**Test:** mAP50 90.32% / P 82.48% / R 77.92% / F1 80.14%. Per-class AP50: closed_eye 95.46%, open_eye 84.37%, yawning 91.13%.

**Test-result trust: HIGH.** Sourced from the old project's root `info/<name>/test_summary.md`, which does not include the templated confusion-matrix block found in every `archived-candidate-models/**/test_summary.md` report (see below) -- this report's numbers are distinct and internally consistent, not shared with any other model's report.

## Size
best.pt 40,516,133 B (38.6MB), best.onnx 80,625,666 B (76.9MB)
