# Replace the detection models with the new YOLO26n package

## What is in the folder you uploaded

A self-documenting deployment package (`README.md` + `models/manifest.json`) with **two models, each in two precisions**, plus full evaluation reports and annotated demo clips.

| Model | Input | fp16 | fp32 | mAP@50 corrected (raw) | Compute |
|---|---|---|---|---|---|
| `yolo26n-480-fast` | 480 | 4.94 MB | 9.73 MB | 82.72% (82.28%) | 1x |
| `yolo26n-960-high` | 960 | 5.08 MB | 10.02 MB | 82.75% (82.34%) | ~4x |

The 480 model is **trained natively at 480** (`6-weakdevice-480-worstcase`), not a re-export — which removes the "accuracy unverified" caveat currently attached to our 480 row.

### The aggregate tie hides a real trade-off

Per-class AP@50 (label-gap-corrected), and recall at conf 0.35:

| class | AP 960 | AP 480 | delta | recall 960 | recall 480 |
|---|---|---|---|---|---|
| closed_eye | 88.69% | 86.39% | **−2.30** | 81.29% | 78.12% |
| open_eye | 83.27% | 83.00% | −0.27 | — | 68.72% |
| yawning | 76.28% | 78.77% | **+2.49** | — | 70.09% |

The 480 model buys its yawning gain by giving up closed_eye — 76 more missed closed-eye instances out of 2395 ground-truth. **closed_eye is the microsleep signal**, the most safety-critical class in the product, so "same accuracy" is not a claim this plan makes or ships.

The counter-argument in 480's favour is temporal, not per-frame: at ~4x less compute it produces far more detections per second, and PERCLOS/microsleep are windowed signals where detection *rate* can recover more closed-eye events than a stronger, slower per-frame model. That is a hypothesis to **measure** (step 6), not an assumption.

### The contract itself is unchanged

Input `images` `[1,3,imgsz,imgsz]` float32 NCHW, letterbox pad RGB(114), /255, no mean/std. Output `output0` `[1,300,6]` = `x1,y1,x2,y2,conf,class_id`, NMS in-graph, coordinates in letterboxed input pixels. Our existing `yolo-nms` decoder and `preprocess.ts` already match exactly — **no decoder or preprocessing rewrite**.

## Plan

### 1. Gate: does ORT Web load the fp16 graphs? (blocking, first)

The fp16 exports fail `onnx.checker` topological-sort validation — the fp16 converter inserts boundary cast nodes without reordering. ORT Python loads and runs them regardless; **ORT Web is a different implementation and may be stricter.** Before any registry or UI work, load both fp16 files in our actual worker runtime, on WebGPU and on WASM, and run one frame.

- Pass → the fp16 track proceeds.
- Fail → the entire fp16 half is dead; ship fp32 only and request a clean re-export. No further fp16 work happens until this gate is green.

Also re-run the fp16-vs-fp32 numerical comparison in *our* runtime (your ORT Python result: 960 99/99 boxes matching within 0.64px, 480 98/98 within 0.36px).

### 2. Publish the ONNX files
Upload all four to the asset CDN, add pointer JSONs under `public/models/`, delete the three old pointers. Binaries never enter the repo. The `/__l5e/assets-v1/...` path is a **relative, same-origin** URL and today's models already download successfully under COOP/COEP isolation — but response headers on the new files are re-confirmed in step 6 rather than assumed.

### 3. Precision is chosen by execution provider, not globally

fp16 halves download but is not universally faster: WebGPU runs fp16 natively, while the WASM EP frequently emulates it through casts and can be **slower than fp32** — on exactly the weak devices that need speed most. So precision follows the resolved EP:

- WebGPU resolved → fp16 file
- WASM resolved → fp32 file

This makes the existing fp32 path a first-class EP-driven choice rather than an error-recovery fallback. Both rows carry both URLs; the worker picks after the adapter probe resolves, which it already does before download.

### 4. Registry migration

One migration: clear `selected_model_id` references, deactivate and delete the three current rows, insert two:

- `yolo26n-480-fast` — imgsz 480, `bestFor: default`
- `yolo26n-960-high` — imgsz 960, `bestFor: high-quality`

Each stores **both** mAP figures explicitly — `map50` = raw (0.8228 / 0.8234, the standard convention so external benchmarking matches) and `map50Corrected` (0.8272 / 0.8275) plus a note explaining the label-gap correction — along with per-class AP (raw and corrected), precision, recall, F1, both file URLs and byte sizes, and precision tags. `head_format = 'yolo-nms'`, letterbox / unit / pad 114 / maxDetections 300 / classIdOffset 0, class order 0 closed_eye, 1 open_eye, 2 yawning. `accuracyUnverified` is dropped.

**Rollback:** the migration is written with the three current rows' full definitions preserved in a commented restore block, and the old asset pointers are recoverable from git history — the old CDN files are not deleted. Reverting = run the restore block and restore the pointer files; no data loss, since sessions reference models by id and historic sessions keep their recorded model name.

### 5. Confidence thresholds — derived from curves, not from 0.35

0.35 is *not* the point the mAP figures were measured at; mAP@50 integrates over all confidences and is threshold-independent. 0.35 is only the operating point for the confusion matrix / P-R-F1 table. So there is no "match the measurement" reason to raise the live default from 0.25 to 0.35 — and raising it would cut recall, which is already the weak axis (72–73%) in a product where a missed microsleep costs far more than a spurious alert.

Instead: **per-class operating points are read off the precision/recall/F1-vs-confidence curves** (`03/04/05_*_confidence_curve.png`, per model, per class), chosen against the product's cost asymmetry — recall-favouring for `closed_eye`, balanced for `yawning` (which already has the highest FP count, 697). Please add the `charts/` folder so this is done from the curves rather than by judgement.

Until those curves are in hand, the current per-class thresholds (0.30 / 0.33 / 0.25) stay as they are — no threshold change ships blind.

**Precedence, stated explicitly:** per-class thresholds are the authoritative floor. The global slider can only *tighten* (raise) a class threshold, never lower it below its per-class value. A flat global value never silently replaces the tuned per-class map.

### 6. Measurement before UI wiring

Run on the demo clips and sample images, in our runtime:

1. Row survivor count per frame at the chosen thresholds (expect ~1-6 of 300).
2. fp16 vs fp32 numerical agreement (both EPs).
3. **Throughput**: 480 vs 960, WebGPU and WASM, on a throttled mobile profile and on desktop.
4. **The decisive one — closed-eye event recall over time, not per frame.** Replay the same clip through both models end to end and compare detected microsleep/PERCLOS events against the clip's ground truth. If 480's higher frame rate does not recover the per-frame closed_eye deficit, 960 stays the desktop default and 480 remains mobile-only.

The default-selection change in step 7 is contingent on result 4.

### 7. Selection defaults — contingent on step 6

Proposed (pending measurement): 480 becomes the default on all devices with 960 as an explicit "Higher closed-eye accuracy, 4x compute" option for strong hardware. If step 6 shows 480 loses microsleep events end to end, defaults stay as today (480 mobile / 960 desktop).

**Step-down ladder:** if 480 becomes the universal default there is nothing beneath it, so the ladder only fires for users who opted into 960 — it stops being a weak-device safety net. That makes the adaptive frame-rate scheduler the *only* remaining adaptation mechanism, so it gets an explicit load test (sustained inference on a throttled Android profile, confirming it holds a stable preview and degrades inference FPS rather than stalling) before the ladder's role is reduced.

### 8. Inference-speed items still worth doing

Already in place: COOP/COEP isolation, WASM thread capping, worker inference, IndexedDB caching, throttled inference with adaptive scheduler, tensor/buffer reuse, WebGPU→WASM fallback. Remaining:

- Warm-up run must use the **exact static shape** of the selected model, so WebGPU compiles shaders once.
- Assert no dynamic-shape path can reach the session — a resize mid-session collapses WebGPU shader caching.

### 9. UI copy — accurate, not promotional

Picker, `/model`, `/models` show for each model: input size, download size and precision, mAP@50 (raw, with the corrected figure and its convention explained on hover), and **per-class accuracy including closed_eye**. Labels:

- 480 — "Fast — 4x less compute, slightly lower closed-eye accuracy"
- 960 — "Highest closed-eye accuracy — desktop / discrete GPU"

No "same accuracy" wording anywhere. All "accuracy not verified" wording is removed.

## Technical notes

- No schema change: extra fields (both mAP conventions, per-class AP, F1, dual precision URLs) ride in `postprocess_config`.
- Tests referencing the three old model ids (`model-compatibility.test.ts`, `mobile-recovery.test.ts`) are updated.
- Demo videos are verification material only; they are not shipped in the app.

## What I need from you

1. The `charts/` folder (P/R/F1-vs-confidence curves) so step 5 is derived rather than guessed.
2. Confirmation that step 6's event-level comparison can use the supplied demo clips, or a clip with ground-truth microsleep timestamps if you have one.
