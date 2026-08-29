# RF-DETR Small 384 Worst-Case

`rfdetr-small/384/3-worstcase/`

Self-reported values only, no raw config file exists.

## Files in this folder
- `checkpoint_best_ema.pth` (126,719,511 bytes)
- `checkpoint_best_regular.pth` (126,754,127 bytes)

Original source: `D:\project\Driver project\BaSuny\c\AI-Based Driver Safety And Assistance System\archived-candidate-models\RF-DETR Small Family\3-rfdetr_small_384_worstcase_run\result`

## Hyperparameters (verified from `args.yaml` where it exists; self-reported otherwise, stated explicitly)

| | |
|---|---|
| Init | 1-baseline (this family, but re-scaled to 384) |
| Real imgsz | 384 (self-reported) |
| Epochs (completed/planned) | 17/? (halted on plateau) |
| Optimizer | AdamW |
| lr0 | decoder 2e-5 / encoder 1e-6 |
| momentum | n/a |
| weight_decay | 1e-4 |
| warmup_epochs | unrecorded |
| box / cls / dfl loss weight | 5.0 (giou) / 1.5 / n/a |
| Wall-clock training time | ~30,600s (~8.50h) -- prose-approximate only, no exact seconds recorded anywhere |

## Augmentation (worst-case (extreme))

*Extreme low-light, IR glare, brightness/contrast jitter 0.35, rotation +-15 deg, per model_summary.txt* (RF-DETR augmentation is not a per-parameter Ultralytics-style block; only the qualitative description above is on record.)

## Results

**Validation:** self-reported peak: mAP50 88.67% (ep7), mAP50-95 55.91% (ep15)

**Test:** No independent test evaluation found for this specific run.

**Test-result trust: NO INDEPENDENT TEST EVALUATION FOUND.** Only training-time self-reported val numbers exist for this run (from its own `model_summary.txt`/`model_analysis.txt`, which have been found to disagree with each other and with `args.yaml` for other runs in this project -- treat any single-source number here as unverified).

## Size
checkpoint_best_ema.pth 126,719,511 B, checkpoint_best_regular.pth 126,754,127 B
