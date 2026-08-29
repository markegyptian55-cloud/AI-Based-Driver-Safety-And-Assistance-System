# Manager cleanup, automatic shifts, and a straight answer on 40-50 FPS

## 1. Saving this version to GitHub

I can't push to GitHub from here — repository connection is done from your side in the Lovable project settings (GitHub / Git sync). Once connected, every version syncs to the repo automatically and this current state becomes a commit on `main`, so you can always roll back to it. If you want an extra safety marker, after the first sync create a tag or a branch named e.g. `stable-fleet-v1` from that commit in GitHub.

Nothing in the app code needs to change for this.

## 2. Manager view: no model/engine surfaces

Confirmed current state: the manager sidebar already lists only Fleet dashboard, Drivers, History — but the app shell still renders the model status pill in the header for every signed-in user, and `/models`, `/live`, `/video`, `/benchmark` remain reachable by direct URL for a manager.

Changes:
- Hide the model status pill and any download/engine indicator in the header when the signed-in user is a manager.
- Route guard: a manager landing on `/models`, `/live`, `/video`, `/image`, `/benchmark` is redirected to `/manager` (the existing redirect effect in the app shell is extended to cover these paths).
- Skip model provider bootstrapping work (model listing, cache checks, offline readiness cards) for managers so nothing downloads or probes the GPU on a manager device.

Result: the manager only ever sees dashboard, drivers, history and sync health.

## 3. Driver: automatic shift start, End shift feeds the manager

- On a driver signing in (or opening Live/Video) with no active shift, a shift is started automatically in the background using the currently selected model and execution provider. No "Start shift" button press needed.
- The control bar becomes a status bar: shift active, elapsed time, monitored time, alert count, plus the **End shift** button.
- Edge cases handled: an already-active shift on this or another device is resumed instead of duplicated; auto-start is skipped for guests/managers; if the device is offline the shift starts locally and syncs later (existing offline queue).
- **End shift** keeps the current behaviour and I will verify it end-to-end: finalize locally → push shift + safety events → server-side `finalize_shift` builds the shift report and daily driver stats → manager dashboard, driver detail page and history reflect it. Manager-side queries get invalidated/refetched so a finished shift appears without a manual refresh.

## 4. Latency and 40-50 FPS — honest answer

Two different numbers get mixed up here:

- **Preview FPS** (camera/video on screen): already 60 FPS and independent of inference. That stays.
- **Inference FPS** (model runs per second): this is what's currently limited.

What is realistic with the two 10 MB fp32 models you require:

| Device / path | Model | Realistic inference FPS |
|---|---|---|
| Desktop with WebGPU | 480-fast | 40-60 — the 40-50 target is reachable |
| Desktop with WebGPU | 960-high | 12-25 — 40+ is not physically reachable at 960x960 fp32 |
| Modern phone, WebGPU | 480-fast | 20-35 |
| Weak Android, WASM | either | 3-8 |

Why 960 cannot hit 40-50: it processes 4x the pixels of 480 at full fp32 precision. The only ways to get there would be fp16/int8 exports or a smaller input size — both of which you explicitly ruled out. I won't fake the number by resizing the input behind your back.

What I can still do in this pass, without touching the model contract:
- Raise the inference-rate ceiling on the 480 + WebGPU path so a fast desktop is allowed to run at 40-50 instead of being capped lower.
- Skip redundant per-frame work when the tracker sees a duplicate frame (no new decoded frame yet).
- Report inference FPS and preview FPS as two separate numbers in the engine strip, so "40-50 FPS" is a claim we can actually see and verify.

Detection safety semantics (PERCLOS, microsleep timing, yawn duration, scoring) stay frame-time accurate regardless of the rate.

## Technical touch points
`src/components/app-shell.tsx` (manager guards, header pill), `src/components/model-selector.tsx` (pill visibility), `src/features/fleet/shift-context.tsx` (auto-start, resume, invalidation on end), `src/components/fleet/shift-control-bar.tsx` (status-only UI), `src/features/session/use-live-session.ts` and the inference scheduler (rate ceiling, duplicate-frame skip), `src/components/live/engine-strip.tsx` (separate FPS readouts).

## Out of scope
No new models, no fp16/int8, no input-size change, no changes to thresholds, NMS, provider selection or the GPU preprocessing path.
