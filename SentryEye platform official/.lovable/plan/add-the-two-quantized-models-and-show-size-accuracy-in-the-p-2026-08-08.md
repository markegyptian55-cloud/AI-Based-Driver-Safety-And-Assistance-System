# Add the two quantized models and show size + accuracy in the picker

## What you get

Two new selectable models, uploaded to CDN and registered in the model registry:

| Model | Size | Input | Accuracy (presence F1) |
|---|---|---|---|
| yolo11m-worstcase-640-int8 | 20.5 MB | 640 | macro F1 0.896 (eyes 0.94/0.90, yawn ~0.88) |
| rfdetr-nano-int8 | 30.5 MB | 384 | macro F1 0.904 (eyes 0.92/0.89, yawn high) |

Anyone opening the site — including visitors without an account — can pick a model from the dropdown before starting live detection, and each entry shows its download size and accuracy level so the choice is informed.

## Changes

1. **Upload the two `.onnx` files to the CDN** with the assets CLI and keep pointer files under `public/models/`. The binaries never enter the repo.

2. **Register both models** in a migration inserting into `model_registry`, using exactly the config from the uploaded `model.yaml` files:
   - `yolo11m-worstcase-640-int8`: head `ultralytics-v8`, imgsz 640, letterbox + unit, conf 0.25, iou 0.45, offset 0.
   - `rfdetr-nano-int8`: head `rf-detr`, imgsz 384, stretch + imagenet, conf 0.25, offset 0, no NMS.
   Accuracy columns are filled from the measured `accuracy.json` (mAP50, mAP50-95, precision, recall), plus file size in bytes. Existing models stay registered and selectable.

3. **Store the presence-detection score.** Box mAP understates the yawn class badly (localisation-convention mismatch, documented in your ACCURACY.md), so the registry also keeps the measured image-level macro F1 in `postprocess_config` metadata and the picker shows that as the headline "accuracy" instead of the misleading yawn mAP.

4. **Enrich the model dropdown** (`src/components/model-selector.tsx`): each option shows model name, input size, file size (e.g. "20.5 MB"), and an accuracy badge (e.g. "F1 0.90 · Balanced"), with a short one-line hint — smaller = faster on phones, larger = more accurate on desktop.

5. **Model registry page** (`/model`) cards gain the same size/accuracy line and a plain-language "best for" note (phone vs desktop).

6. Device default logic is untouched: phones still auto-start on the small 320 mobile export, everyone can override manually.

## Technical notes

- INT8 ONNX graphs run through the existing browser-ONNX provider; quantized ops are best supported on the WASM backend, so the worker's existing WebGPU→WASM self-test fallback covers it. No change to the inference pipeline, postprocess, or event aggregation.
- No new columns; accuracy metadata rides in existing `model_registry` columns plus the JSON config field, so anonymous read grants stay as they are.
