# Fix slow new models + model persistence, compatibility check, load status, quick test

## What I verified first

Registry today (all active, all 3 classes):

```text
rfdetr-nano-int8            384px  rf-detr          30.5 MB
yolo11m-worstcase-640-int8  640px  ultralytics-v8   20.5 MB
yolo11n-320-mobile          320px  ultralytics-v8   10.5 MB
yolo11n-416-mobile          416px  ultralytics-v8   10.5 MB
yolo11n-640-worstcase       640px  ultralytics-v8   10.6 MB
```

So the two new entries are the heaviest work in the list: a medium-size
backbone at 640px, and a transformer detector with a 30 MB download. Both are
INT8. That is consistent with "super delay + latency", but I have not yet
measured them in the browser, so the plan measures before it tunes rather than
asserting a cause.

Also confirmed: the picked model is stored only in browser localStorage —
`user_settings.selected_model_id` exists in the database but no code reads or
writes it. So the choice does not follow the user across devices/sign-ins.

## 1. Measure, then fix the slowness (first step, no guessing)

Use the existing `/benchmark` page to record, per model, on desktop and on a
phone: download time, session-create time, and median inference latency/FPS,
plus which backend actually ran (WebGPU vs WASM).

Expected outcomes and the matching fix, decided by the numbers:

- If INT8 runs slower than the existing FP32 models (common in browsers —
  quantized ops often fall back to slower kernels): mark the two new models as
  non-default and label them clearly as "accuracy reference / desktop only";
  keep the fast 320/416 exports as the live-detection defaults.
- If the transformer model can't hit usable FPS anywhere: restrict it to the
  Video and Image pages (offline analysis) and hide it from live selection.
- If a model is only slow on the first run, it is download/compile cost — the
  loading status in section 4 covers it and no model change is needed.

No changes to the detection maths, decoding, or scoring logic.

## 2. Remember the chosen model per user

- Read `user_settings.selected_model_id` when the app loads; use it as the
  selected model when present, falling back to localStorage, then to the
  device-aware default.
- Write it back (fire and forget) whenever the user picks a model.
- Visitors/signed-out users keep the current localStorage behaviour.
- If the saved model was removed or deactivated, fall back to the default and
  say so once in the picker.

## 3. Compatibility check before live detection starts

A small pre-start validation that reads the model's registry metadata and
blocks Start with a clear reason when something can't work, instead of running
a broken session:

- Metadata sanity: model file URL present, class count matches the three
  classes the app scores, input size present and sane.
- Pipeline support: head format is one this app decodes (`ultralytics-v8` or
  `rf-detr`); resize/normalize mode is supported.
- Runtime fit: warns (does not block) when a 640px or transformer model is
  selected on a phone-class device, with a one-tap "switch to the fast mobile
  model" button.

Shown as an inline panel above the Start button on Live, with the failing check
named in plain language.

## 4. Live loading status with the model name

Replace the small pill with an explicit status line wherever detection starts
(Live, Video, Image):

```text
Loading yolo11n-320-mobile — downloading 62% (6.5 / 10.5 MB)
Loading yolo11n-320-mobile — preparing model…
Ready · yolo11n-320-mobile · WebGPU
```

The download percentage, stage, and error/retry already flow through the model
context; this surfaces them fully instead of truncating to "Loading model…".
Start stays disabled with a "waiting for model" note until the model is ready.

## 5. Quick test mode

A "Quick test" panel on the Live page: pick a short video or a photo, run the
currently selected model over it, and get a small verdict card before starting
a real session:

- per-class counts and mean confidence for open eye / closed eye / yawn
- frames analysed and average inference latency + FPS for that clip
- a plain verdict: "This model detected yawning and both eye states — good to
  go" / "No yawns detected in this clip" / "Too slow for live on this device —
  try the 320px model"

It reuses the existing video/image analysis path and the warm model session, so
nothing new enters the inference pipeline.

## Technical notes

- `src/features/inference/model-context.tsx`: hydrate/persist selection through
  `useUserSettings`; expose the validation result.
- New `src/features/inference/model-compatibility.ts`: pure function
  `checkModelCompatibility(meta, device)` returning blocking errors + warnings,
  with unit tests.
- `src/components/model-selector.tsx`: richer status line (name, stage, bytes,
  backend, retry).
- New `src/components/live/quick-test-panel.tsx` driving the existing
  `video-file-source` / image analysis helpers.
- `src/routes/_authenticated/live.tsx`: compatibility panel + Start gating +
  quick test entry point.
- Registry metadata for the two new models updated only after the benchmark
  numbers exist.
