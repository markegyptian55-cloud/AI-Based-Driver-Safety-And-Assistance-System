# Fix bad detection quality on mobile

## What the screenshots show

Both mobile screenshots (Live and Image pages) show the same failure signature: dozens of overlapping boxes covering the whole frame, almost all labelled at exactly **50%** confidence, one at 42%. That is not "the model is weak" — a healthy run gives a handful of boxes with varied confidences. A flood of near-0.50 scores means the model output is effectively noise on that device, so post-processing keeps everything that passes the threshold and NMS can't collapse them because the boxes don't overlap consistently.

Two things can produce that on a phone while desktop video upload looks fine:

1. The inference backend. The worker prefers WebGPU whenever `navigator.gpu` exists, with no verification that WebGPU actually produced sane numbers. Several Android GPU drivers run the graph in reduced precision or silently return garbage; the session still "succeeds".
2. Nothing downstream sanity-checks the result, so garbage renders as confident detections instead of being rejected.

Diagnosis of cause 1 is inferred from the output signature, not yet confirmed on a device — the first step of the work is to confirm it, then apply the fix.

## Plan

### 1. Confirm the backend is the cause
Add a one-time self-test in the inference worker right after the session is created: run a fixed synthetic frame through the model and check the output tensor for NaN/Inf, all-identical values, and an implausible number of above-threshold boxes. Report the result as a pipeline stage so it shows in the existing debug panel and in logs. This tells us with certainty whether WebGPU on that phone is returning noise.

### 2. Fall back automatically when the self-test fails
If the self-test fails on WebGPU, dispose the session and rebuild it on WASM, re-run the self-test, and only then report ready. Expose the engine actually in use (already surfaced as `engine`) so the Live page shows "WebGPU" vs "CPU (WASM)".

### 3. Treat phones conservatively by default
On mobile/low-core devices, start on WASM directly instead of gambling on WebGPU, and enable SIMD plus a small thread count so CPU inference stays usable. Keep an override in Settings for anyone who wants to force WebGPU.

### 4. Guard against noise reaching the UI
In post-processing, drop a frame's detections when they look degenerate: more boxes than a sane cap, or nearly all confidences clustered in a very narrow band around the threshold. A rejected frame renders no boxes rather than a wall of them, and increments a "frames rejected" counter shown in the debug/status panel.

### 5. Mobile capture quality and load
- Request a camera resolution suited to the model input rather than whatever the phone offers, and keep the front camera.
- Cap the analysed frame rate on mobile so the phone isn't queueing inference behind a 30fps stream (the source already skips frames while one is in flight; the cap makes it explicit and reduces heat/throttling).
- Show a short notice on the Live page when running on CPU that frame rate will be lower.

### 6. Verify
Run the existing tests plus a browser check of the Live and Image pages at a mobile viewport, and confirm: the self-test stage appears, engine is reported, and a real image yields a small number of varied-confidence boxes instead of a grid.

## Technical notes

- Worker changes: `src/features/inference/browser-worker.ts` (self-test, EP selection, WASM SIMD/threads, engine reporting).
- Sanity filter: `src/features/inference/postprocess.ts` (degenerate-output rejection, exported and unit-tested pure function).
- Capture: `src/features/session/camera.ts` (constraints, mobile frame cap).
- UI surfacing: `src/components/live/provider-status.tsx` and `src/components/live/pipeline-progress.tsx` for engine + rejected-frame counters.
- No database or model changes; the model file and registry stay as they are.
