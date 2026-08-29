# Fix Android "Start live detection" hanging + pick the right model up front

## What I checked

- The registry has three active models: `yolo26n960-high-device` (960px, ~10 MB, bestFor desktop), `yolo26n480-low-device` (480px fp16, ~5 MB, bestFor mobile) and `yolo26n480-cpu-fallback` (480px fp32, ~9.7 MB, bestFor cpu-fallback).
- The selected model is remembered per account (`selected_model_id`) and in local storage, and it is **not** re-checked against the device. So a phone opening Live keeps whatever was picked on the desktop — the screenshot shows the 960 desktop model selected.
- Live's Start button is disabled until `warmup.status === "ready"`, and the prepare chain (adapter probe → download → session create → warm-up → verify) has **no timeout anywhere**. If any step stalls on an Android driver or a slow download, the page stays in the "preparing" state forever with no error and no way out — that matches "stuck on this area".

Exact Android cause is not confirmed from here (no Android device in the sandbox), so the plan both removes the stall-forever behaviour and surfaces the failing stage instead of hiding it.

## What changes

### 1. Device-correct model up front
- On a phone, if the remembered model is not suitable for this device (960px / desktop-only), auto-switch to the phone model and say so once ("Switched to yolo26n480 — the model that runs on this phone").
- Add a compact "Choose model" list on the Live start card, visible before you press Start, with each model showing: name, input size, download size, a badge — `Recommended for this phone` / `Desktop only` / `CPU fallback` — plus "Saved on this device" and last measured ms/frame when known.
- Desktop behaviour is unchanged: it keeps recommending the 960 model.

### 2. Never hang
- Add per-stage watchdogs in the prepare chain: WebGPU adapter probe (3 s), session create (25 s), warm-up (15 s), verification (10 s). A timeout is treated exactly like a failure of that stage.
- On adapter/session timeout the worker falls through to the next execution provider (WASM) instead of waiting, and on WASM timeout the model prepare ends with a clear error.
- If the phone-recommended model itself fails or times out, step down automatically to the CPU-fallback build once, then report.

### 3. Tell the user what is happening
- The start card shows the live stage text on mobile too (`checking GPU`, `downloading 40%`, `preparing engine`, `checking model`) with elapsed seconds after 10 s.
- Add a visible "Cancel / try CPU mode" action while preparing, which aborts the current attempt and retries with the WASM engine preference.
- Any prepare error renders inline with the failing stage and a Retry button, instead of leaving a disabled Start button.

## Technical notes

- `src/features/inference/model-context.tsx`: device-aware re-selection on hydration, timeout wrappers around `warmUpProvider` / `verifyModel`, abort support for the in-flight prepare.
- `src/features/inference/browser-worker.ts`: timeout around `requestAdapter()` and around `InferenceSession.create` per provider so a stuck driver falls through to WASM.
- `src/routes/_authenticated/live.tsx` + a small model-choice component reusing `ModelSelector` data: badges, saved-offline state, stage/elapsed text, Cancel and Retry.
- No model files, decoding, or detection logic change.

## Verification

- Playwright run with an Android UA + mobile viewport: confirm Live auto-selects the 480 model, the stage text advances, and prepare either reaches ready or surfaces an error within the watchdog window (no infinite spinner).
- Desktop run: confirm the 960 model and current behaviour are unchanged.
- You then confirm on your real Android device.
