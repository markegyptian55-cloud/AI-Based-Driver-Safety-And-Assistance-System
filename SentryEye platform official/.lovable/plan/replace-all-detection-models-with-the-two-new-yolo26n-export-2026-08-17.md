# Replace all detection models with the two new YOLO26n exports

## What changes for you

The two old `yolo11n` models disappear from the app. In their place:

| Model | Input | Size | Use for | Accuracy |
|---|---|---|---|---|
| `yolo26n480-low-device` | 480 | 4.7 MB | phones / low-power devices | not yet independently verified at 480 |
| `yolo26n960-high-device` | 960 | 9.6 MB | desktop / strong devices | 82.75% real test mAP50 (validated) |

Phones auto-select the 480 model, desktops the 960 one, and either can be picked manually. The picker and model page label the 480 model honestly as "accuracy at this input size not yet verified" instead of quoting the 960 number.

Note on the mobile pick: the old mobile model ran at **320** input, so 480 is roughly 2.25x more pixels per frame — computationally heavier on exactly the low-end devices it serves, even though it downloads smaller. File size is only download/memory; it is not the justification. This is treated as a decision to confirm with measurement (Step 1b), not a given.

Before any UI wiring, the two models are run offline against the 3 provided sample images to confirm boxes and classes look right.

## Step 1 — verify the models against the sample images first

Run both ONNX files headlessly (Node + onnxruntime) over `sample-images/`, applying exactly the manifest spec: letterbox to 480/960 with grey 114 padding, RGB, /255, NCHW, then read `[1,300,6]` rows, filter per class (closed_eye 0.30, open_eye 0.33, yawning 0.25), inverse-letterbox the boxes. Print class/confidence/box for each image and render the boxes onto the images for visual inspection.

**Padding-row gate (pass/fail, measured not assumed).** The tensor is always 300 rows; most are padding. For every image and both models, print how many of the 300 rows survive the confidence + class-id + non-zero-area filter, plus the raw distribution (how many rows have conf > 0, what the padding rows actually contain — zeros, -1 class ids, or something else). Expected survivor count is roughly 1-6 per image. If dozens survive, the padding convention is not what the filter assumes and would produce phantom boxes at runtime: stop, report, and fix the filter before Step 2. No UI work starts until this gate passes and the rendered sample images are shared.

## Step 1b — measure real 480 throughput and fp16-on-WASM viability

Benchmark the 480 model's per-frame inference time under throttled mobile conditions (CPU-throttled emulation plus a real low-end Android device if reachable), on both WebGPU and WASM, and report the achieved FPS against the old 320 baseline.

**fp16 on the WASM EP is tested explicitly, not assumed.** The 480 model is fp16 and the 960 is fp32, which inverts the risk: WebGPU handles fp16 natively, but ONNX Runtime Web's WASM EP has patchy fp16 support (slow emulation or an outright load/run failure depending on version and ops). The devices most likely to lack WebGPU and land on WASM are exactly the low-end phones the 480 model targets. So the WASM run is a first-class check, reporting three things separately: does the session load, are the detections numerically correct (compared against the WebGPU/Node fp32 reference on the same sample images), and what frame rate does it hold.

Outcomes brought back for a decision rather than silently shipped:
- fp16 fails or degrades on WASM → request an fp32 re-export at 480 (same weights, same unverified-at-480 caveat) before finalising the mobile default.
- 480 is simply too heavy at usable frame rates → discuss options: a more aggressive step-down ladder, reduced capture rate, or requesting a genuine 320 export — which would carry the same "re-exported, not retrained at this resolution" caveat and would itself need accuracy verification, not assumption.



## Step 2 — publish the model files

Upload `exp4-480-weak/best.onnx` and `exp4-960-full/best.onnx` to the asset CDN and keep pointer JSONs under `public/models/`. The binaries never enter the repository. The old two pointer files are deleted.

## Step 3 — new decode path for NMS-baked output

The current decoders assume raw Ultralytics `[1, 4+C, N]` output and run JavaScript NMS. These models are different: NMS is already inside the graph. A new head format `yolo-nms` is added to the decoder:

- reads `[1, 300, 6]` rows as `[x1, y1, x2, y2, conf, class_id]`
- no NMS, no sigmoid, no cross-class dedupe
- filters each row by its own class threshold (0.30 / 0.33 / 0.25)
- applies the inverse letterbox: subtract pad, divide by scale, clamp to frame, convert to the normalised xywh the rest of the app uses
- drops rows with a class id outside 0-2 or a zero-area box

Per-class thresholds become a first-class field on the provider config, sourced from the registry, so the existing global confidence slider no longer silently overrides them (it can only tighten, never loosen below the measured operating points).

## Step 4 — registry migration

One migration deactivates and removes the two `yolo11n` rows and inserts the two new ones with the exact manifest values: `head_format = 'yolo-nms'`, imgsz 480/960, `resize: letterbox`, `normalize: unit`, `classIdOffset: 0`, `maxDetections: 300`, the per-class threshold map, precision (fp16/fp32), file size, `bestFor` (mobile / desktop), and for the 480 row a note that its accuracy at that resolution is unverified. `map50` is 0.8275 for the 960 model and left null for the 480 one so the UI cannot claim a number that was never measured. Labels/semantic map keep the exact index order 0 closed_eye, 1 open_eye, 2 yawning.

## Step 5 — app wiring

- Default selection: 480 model on mobile, 960 on desktop (replaces the `yolo11n` / `320-mobile` name matching).
- Compatibility check accepts the new head format and raises the mobile input-size limit so the 480 model is not flagged; selecting the 960 model on a phone still warns.
- Model picker, `/model` and `/models` pages: show size, input resolution, device fit, and for the 480 model an explicit "accuracy at 480 not yet verified" caveat rather than an inherited score.
- Execution provider: WebGPU first with automatic WASM fallback on both device classes (the existing self-test fallback stays).
- Per-model box cap raised from 8 to a value that fits these graphs, and the noisy-output guard is re-tuned so NMS-baked output is not mistaken for a corrupted flood.
- Tests referencing the old model names are updated, and new unit tests cover the `yolo-nms` decode: row parsing, per-class thresholding, and inverse-letterbox coordinate correctness against hand-computed values.

## Technical notes

- `head_format` is a plain text column, so no constraint change is needed.
- Downstream scoring is untouched: PERCLOS, yawn state machine, tracker and events keep consuming the same `eye_open` / `eye_closed` / `yawn` semantic tags.
- The existing `preprocessFrame` letterbox path already matches the manifest (grey 114, unit normalisation, NCHW) and returns the scale/pad needed for the inverse transform, so preprocessing needs no change — only the decoder consumes those values differently.
- Automatic model step-down keeps working: the ladder simply becomes 960 → 480.
