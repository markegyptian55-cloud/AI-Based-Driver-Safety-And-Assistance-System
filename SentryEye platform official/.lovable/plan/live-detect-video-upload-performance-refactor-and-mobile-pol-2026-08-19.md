# Live Detect + Video Upload: performance refactor and mobile polish

## What is already in place (verified in code)

- Inference already runs off the main thread in a dedicated worker (`browser-worker.ts`); the UI thread never runs the model.
- Frames are already downscaled to the model's input size with letterbox preprocessing; the preview element renders the native stream.
- Provider order is already WebGPU then WASM, with a worker self-test that falls through when a driver returns noise.
- Detection boxes already pass through a tracker with EMA smoothing between frames.
- Uploaded video already steps frames through `requestVideoFrameCallback`.
- A 90s prepare watchdog and per-stage timeouts (adapter probe, session create, self-test) already exist and report a stage.

So this work is the remaining delta, not a rebuild.

## What changes

### 1. Real-time pipeline

- **Decouple preview from inference:** the overlay repaints on its own rAF at display rate while inference is capped to a target rate (default 18 FPS on mobile, 30 on desktop), configurable, so a slow model can never slow the preview.
- **Render-time interpolation:** the overlay interpolates each tracked box toward its newest position per animation frame (LERP on top of the existing EMA), so overlays glide at screen rate rather than stepping at inference rate. Tracks are matched by identity so a box never lerps across faces.
- **Backend order:** keep WebGPU then WASM. A WebGL step is not added: onnxruntime-web's WebGL backend cannot execute these YOLO graphs, so listing it would only add a failing attempt and a delay. The engine picker will say GPU / CPU explicitly.
- **Video upload:** keep native `requestVideoFrameCallback` decoding, add chunked yielding between frames so long clips never block paint, and show a percentage progress bar with time remaining and a Cancel button.

Note on the 320x320 request: the two shipped models are exported at 480 and 960 input. Feeding 320 would need a new export; the pipeline already scales frames down to the selected model's own input, which is the equivalent saving. If you want a true 320 export added, say so and it becomes a separate step.

### 2. Mobile layout

- Sticky top bar on Live: compact model dropdown plus a **Download** button that pre-fetches the selected model with an inline progress bar and animated state.
- Camera preview directly beneath, given the dominant share of the screen.
- Below it, one glassmorphic card with only the top signals (risk state, FPS, latency, engine). Everything else — telemetry, benchmark, compatibility, quality, replay, calibration — moves into a collapsible "Advanced" drawer, closed by default on phones.
- Desktop keeps the current richer layout; the simplification is width-gated.

### 3. Diagnostics, benchmark and watchdog

- **Pre-start diagnostics card:** camera permission, worker boot, GPU/WebGPU support, and the engine actually selected (GPU or CPU fallback), each with a pass/warn/fail state and a Recheck action.
- **Launch capability test:** a short synthetic benchmark on page open. If the device is below the usable threshold even on the baseline model, show a dismissible modal — "Your device performance is limited. Detection speed may vary." — with **Dismiss & Continue** that unlocks the camera immediately. The choice is remembered per device so it appears once.
- **Watchdog reporter:** on any prepare timeout, render an error report naming the stage that timed out (adapter probe, session create, self-test, warm-up) and its exact duration, with Retry and Try CPU mode, plus the same detail written to the diagnostics log for sharing.

## Technical notes

- `src/components/live/detection-overlay.tsx`: per-track LERP state, interpolation on rAF, unchanged coordinate/letterbox maths.
- `src/features/session/use-live-session.ts` and `camera.ts`: explicit inference-rate cap separate from capture, preview untouched.
- `src/features/inference/model-context.tsx`: expose stage, elapsed ms per stage, and the timeout that fired; add a `prefetch(modelId)` action for the download button.
- New `src/components/live/diagnostics-card.tsx`, `src/components/live/device-capability-modal.tsx`, `src/components/live/prepare-failure-report.tsx`.
- `src/routes/_authenticated/live.tsx`: split into a mobile-first shell (sticky bar, preview, signal card, advanced drawer) reusing existing panels; no detection logic moves.
- `src/routes/_authenticated/video.tsx` + `video-file-source.ts`: progress percentage, cancel, chunked yielding.

## Verification

- Playwright with an Android UA and mobile viewport: Live reaches ready, diagnostics card fills in, watchdog report renders when a stage is forced to time out, and the overlay rAF keeps painting while inference is throttled.
- Desktop run to confirm no regression in the current layout and latency.
- You confirm on your real Android device.
