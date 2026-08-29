# Keep only the two best models

## What changes

The registry currently offers five models. Three of them are either redundant or measurably worse:

| Model | Size | Input | mAP@50 | Verdict |
| --- | --- | --- | --- | --- |
| yolo11n-320-mobile | 10.0 MB | 320px | 0.900 | **Keep** — fastest, best accuracy/speed on phones |
| yolo11n-416-mobile | 10.0 MB | 416px | 0.900 | Remove — sits between the two keepers, adds no value |
| yolo11n-640-worstcase | 10.1 MB | 640px | 0.900 | **Keep** — same accuracy at full resolution, best on desktop |
| yolo11m-worstcase-640-int8 | 19.5 MB | 640px | 0.565 | Remove — twice the size, far worse accuracy |
| rfdetr-nano-int8 | 29.1 MB | 384px | 0.589 | Remove — largest and weaker accuracy |

After this, the selector shows exactly two options: **320 mobile** (phones, auto-default on constrained devices) and **640 worstcase** (desktop/laptop default).

## How

1. Migration that deactivates and deletes the three removed rows from the model registry, first clearing any `selected_model_id` references on user settings/sessions that point at them so nothing breaks.
2. Model selection code that names `416-mobile` as a mobile fallback (`model-context.tsx`) drops that branch — `320-mobile` stays the mobile pick, `640-worstcase` the desktop pick.
3. The "Fast — mid-range phones" copy for 416 in `labels.ts` is removed.
4. Update the affected unit tests (`mobile-recovery.test.ts`, `model-compatibility.test.ts`) so their fixtures use only the two remaining models.
5. Users whose saved model was one of the removed three fall back to the recommended default automatically — the existing "saved model is no longer available" notice already handles this.

The `.onnx` asset pointers for removed models can stay in `public/models/` (unused, no runtime cost) or be deleted; the plan deletes them to keep the repo clean.
