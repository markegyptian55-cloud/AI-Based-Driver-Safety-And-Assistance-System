# YOLO11m Baseline / Trial 2 -- old project's self-declared '#1 overall winner'

`yolo11m/640/1-baseline-trial2-winner/`

No `args.yaml` survives for this run anywhere on disk. Real imgsz (**640**) recovered this session by loading its own exported `best.onnx` and reading the input tensor shape directly (`[1,3,640,640]`) -- not assumed from any document. Params (20,055,321) and class names confirmed by loading `best.pt` directly.

## Files in this folder
- `best.pt` (120,829,505 bytes)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\archived-candidate-models\YOLOv11 Medium Family\1-yolo11m_drowsiness_run`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | fresh (a predecessor 'Trial 1' COCO baseline ~88.5% is mentioned only in this run's own prose; no checkpoint or config for Trial 1 exists anywhere) |
| Real imgsz | 640 (recovered from ONNX input shape, this session) |
| Epochs (completed/planned) | 53/? (patience=10 triggered) |
| Optimizer | SGD (the only SGD run in either project; every other run used AdamW) |
| lr0 | 0.002 |
| momentum | 0.937 |
| weight_decay | unrecorded |
| warmup_epochs | unrecorded |
| box / cls / dfl loss weight | unrecorded / unrecorded / unrecorded |
| Wall-clock training time | 95,898s (26.64h) |

## Augmentation (unrecorded (no args.yaml))

| Param | Value |
|---|---|
| hsv_h | - |
| hsv_s | - |
| hsv_v | - |
| degrees | - |
| translate | - |
| scale | - |
| shear | - |
| perspective | - |
| fliplr | - |
| flipud | - |
| mosaic | 1.0 (stated) |
| mixup | 0.0 (stated) |
| erasing | - |
| auto_augment | - |
| amp | - |

## Results

**Validation:** self-reported peak: mAP50 91.33%, mAP50-95 65.37% (best localization of any model in either project)

**Test:** info_legacy_archive: mAP50 91.33% / mAP50-95 65.37% / P 79.09% / R 84.27%

**Test-result trust: PLAUSIBLE, not confirmed.** Sourced from `archived-candidate-models/info_legacy_archive/`, the same folder that contains 3 confirmed-templated reports for other models (byte-identical P/R/mAP50-95/confusion-matrix across different architectures). This specific report's numbers are NOT shared with those templated ones -- they are internally distinct -- so it is not proven fake, but it comes from a folder with a demonstrated fabrication problem. Treat with real caution.

## Size
best.pt 120,829,505 B (115.2MB, likely unstripped -- includes optimizer state), best.onnx 80,434,545 B (76.7MB, separately exported and stripped)
