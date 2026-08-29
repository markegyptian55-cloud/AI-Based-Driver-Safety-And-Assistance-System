# Plan: Remove Live and Video Detection Lag

## Goal
Keep the existing 480 and 960 fp32 models, image sizes, thresholds, WebGPU preprocessing, self-test, and provider-selection rules unchanged while making preview, controls, and overlays stay responsive on desktop and mobile.

## Confirmed current behavior
- Live and Video use the same ONNX provider and worker, including the WebGPU zero-copy path and per-frame `preprocessMs`, `inferMs`, and `postprocessMs` instrumentation.
- Live already adapts its capture rate to measured inference cost and keeps only the newest frame.
- Video Upload currently submits frames directly from playback with only a single in-flight guard; it has no adaptive inference budget equivalent to Live.
- Uploaded clips are analyzed through normal video playback, so processing is intentionally bounded by playback time and is not an offline faster-than-real-time decoder.
- When WebGPU is unavailable and WASM is selected, 960 preprocessing performs a full 960×960 readback and roughly 2.8 million float writes per analyzed frame. This work is off the UI thread but explains high model latency; it cannot be removed without changing the execution path.
- React statistics are already throttled to 5 Hz and the overlay already renders independently from inference, so those mechanisms should be retained rather than rebuilt.

## Implementation

### 1. Establish performance acceptance checks
- Capture the existing per-stage timings for both models on Live and Video: preprocessing, inference, postprocessing, processed FPS, dropped/skipped frames, and final engine.
- Treat preview smoothness separately from inference throughput: the video/camera preview and controls must remain responsive even when 960/WASM can only analyze a few frames per second.
- Verify the active path explicitly as `webgpu + gpu preprocessing` or `wasm + cpu preprocessing`; do not hide slow fallback behind a combined latency number.

### 2. Give Video Upload the proven adaptive scheduler
- Add the same inference-cost EMA and duty-cycle budget used by Live to the uploaded-video frame source.
- Use latest-frame-wins backpressure with at most one pending bitmap; close superseded bitmaps immediately so decode and UI rendering never wait behind stale frames.
- Pace submissions from measured end-to-end frame cost rather than attempting every decoded frame.
- Keep playback at normal speed and preserve chronological timestamps, event timing, PERCLOS, microsleep, and yawn duration semantics.
- Expose source FPS, analyzed FPS, target inference FPS, and skipped frames through the existing telemetry contract.

### 3. Reduce main-thread work without changing inference results
- Keep frame transfer as transferable `ImageBitmap`; do not introduce canvas pixel copies on the main thread.
- Batch non-safety telemetry and diagnostic writes at a lower cadence while leaving tracker, event aggregation, alarms, and scoring frame-accurate.
- Replace repeated timeline front-removal with a bounded/ring-buffer strategy so long uploaded videos do not accumulate avoidable array-copy work.
- Retain the current 5 Hz React-state throttle and ref-driven overlay; audit the Video page for any progress or persistence updates that bypass that throttle.

### 4. Make slow 960 fallback honest and usable
- Preserve the selected 960 model and full 960 input when requested; never resize it to 480 or silently switch models.
- When 960 runs on WASM, lower only the sampling frequency to the sustainable rate so playback remains smooth while the model still receives full-resolution frames.
- Surface the engine, preprocessing path, model, per-stage timing, and sustainable analysis FPS beside Video progress so users can distinguish a smooth low-rate analysis from UI lag.
- Keep model changes user-controlled. Any recommendation to use 480 must be advisory, not automatic.

### 5. Recovery and resource cleanup
- Ensure every skipped, replaced, stopped, errored, or route-unmounted frame closes its `ImageBitmap` exactly once.
- Stop scheduling immediately on pause/end/error and prevent stale inference results from mutating a restarted session.
- Release video decoder/listeners and worker resources through the existing stop/retry paths, without changing worker initialization or provider selection.

### 6. Verification matrix
- Test Live and Video with both 480 and 960 models on desktop WebGPU and Android/WASM fallback.
- For each run, record engine attempts, active engine/preprocess path, p50 inference latency, processed FPS, skipped frames, preview responsiveness, and memory behavior over a longer clip.
- Confirm detection boxes remain aligned and that eye-closure, microsleep, yawn, PERCLOS, timeline, CSV, and PDF outputs retain correct media timestamps.
- Run a long-video test to confirm memory remains bounded and pause/resume/stop/retry do not leak frames or duplicate processing.

## Files in scope
- `src/features/session/video-file-source.ts` — adaptive pacing, latest-frame queue, frame cleanup, telemetry.
- `src/features/session/use-live-session.ts` — bounded timeline storage and lower-frequency non-safety diagnostics.
- `src/routes/_authenticated/video.tsx` — expose the real scheduling/engine telemetry and preserve smooth playback progress.
- Focused tests for frame pacing, cancellation, timestamps, and cleanup.

## Explicitly out of scope
- No new models, quantization, fp16 assets, or input-size reduction.
- No threshold, NMS, scoring, self-test, timeout, provider-selection, or model-selection changes.
- No rewrite of GPU preprocessing, ONNX worker initialization, Fleet/Manager features, reports, or visual redesign.
- No faster-than-real-time WebCodecs/offline decoder in this pass; that is a separate feature because it changes processing semantics and browser support requirements.
