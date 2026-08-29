# RF-DETR Nano Fine-Tuned -- the single best-accuracy result in the OLD project (real, trusted)

`rfdetr-nano/384/2-finetune-best-old-project/`

RF-DETR does not use Ultralytics' args.yaml -- values below are self-reported from model_summary.txt, not independently verified against a raw config file.

## Files in this folder
- `best_model.pth` (120,771,472 bytes)
- `checkpoint_best_ema.pth` (120,822,971 bytes)
- `rfdetr-nano.onnx` (113,383,423 bytes)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\checkpoints\Streamlit Platform Models\RF-DETR Nano Fine-Tuned\2-rfdetr_nano_finetune_run`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | 1-baseline (this family) |
| Real imgsz | 384 (self-reported) |
| Epochs (completed/planned) | 15/15 |
| Optimizer | AdamW |
| lr0 | decoder 2e-5 / encoder 1e-6 |
| momentum | n/a |
| weight_decay | 1e-4 |
| warmup_epochs | unrecorded |
| box / cls / dfl loss weight | 5.0 (giou) / 1.5 / n/a |
| Wall-clock training time | 42,630s (11.84h) |

## Augmentation (worst-case)

*Extreme low-light/IR-glare simulation, brightness/contrast jitter 0.35, rotation +-15 deg, per model_summary.txt* (RF-DETR augmentation is not a per-parameter Ultralytics-style block; only the qualitative description above is on record.)

## Results

**Validation:** self-reported peak: mAP50 91.95% (ep5), mAP50-95 66.88% (ep13), recall 88.95% (ep15, highest overall safety recall of any model in either project)

**Test:** TRUSTED report: mAP50 92.36% / P 75.62% / R 94.61% / F1 83.78%. Per-class AP50: closed_eye 97.10%, open_eye 87.69%, yawning 92.28%. NOTE: a SEPARATE, suspect info_legacy_archive report for this SAME checkpoint claims 91.95% and shares the templated confusion matrix -- that second report is not trusted; use the 92.36% figure.

**Test-result trust: HIGH.** Sourced from the old project's root `info/<name>/test_summary.md`, which does not include the templated confusion-matrix block found in every `archived-candidate-models/**/test_summary.md` report (see below) -- this report's numbers are distinct and internally consistent, not shared with any other model's report.

Architecture note for deployment: despite the "nano" name, this is a transformer detector, ~10M params, and its ONNX export is **113MB** -- roughly 10x heavier than any YOLO-nano ONNX in this project. Not a lightweight/mobile candidate despite the label.

## Size
best_model.pth 120,771,472 B, checkpoint_best_ema.pth 120,822,971 B, rfdetr-nano.onnx 113,383,423 B (108.1MB)
