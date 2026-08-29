# Fix the Inference Engine: real WebGPU acceleration for the 960 model

Priority is the engine. Fleet/Manager is deferred to a later phase at the end of this document, unchanged in scope.

## Why the 960 model is at ~352 ms / 3 FPS

I inspected the worker, preprocessing and provider selection. Three concrete defects, none of which are "the model is too big":

1. **Per-frame CPU preprocessing dominates.** `preprocessFrame` draws the camera frame into a 2D `OffscreenCanvas`, calls `getImageData` on 960x960 (921,600 pixels), then runs a JavaScript loop writing 2,764,800 float32 values into the NCHW buffer. On a laptop that is 40-90 ms per frame, on a phone far more — before ORT even runs. This cost is identical whether WebGPU is active or not, so it caps the whole pipeline.
2. **The WebGPU path round-trips every tensor through CPU memory.** The input tensor is built as a CPU `Float32Array` (11 MB at 960) and uploaded each frame; outputs are read back to CPU with no `preferredOutputLocation`. Upload + readback + sync per frame erases most of the GPU's advantage. Your previous ~15 ms measurement was almost certainly a GPU-resident pipeline (or a native runtime) without this round trip.
3. **The device may not be on WebGPU at all.** The selection ladder demotes to WASM on a single failed adapter probe or one self-test timeout, and the memory gate (`estimateWorkingSetGb`, 12x activation multiplier, 35% of `navigator.deviceMemory`) blocks 960 on any device reporting 4 GB or less — including capable laptops, since Chrome caps `deviceMemory` at 8. 352 ms is the signature of 960 running on WASM. Today the UI does not make the active provider obvious, so this looked like "the model is slow".

Secondary: warm-up runs 2 synthetic frames; WebGPU shader compilation typically needs 3-5 before steady state, so the first real frames are still paying compile cost and skew the FPS average.

## Approach: measure first, then remove the copies — never lower the target

### Step 1 — Honest instrumentation (no behaviour change yet)
- Report per-frame `preprocessMs / inferMs / postprocessMs` and the active execution provider into the live HUD and the debug panel (the worker already computes these; they are not surfaced).
- Add a "why this engine" ledger to the UI: adapter probe result, each provider attempt, the reason for any demotion.
- With this in place we get the real split from your desktop and your phone, and every later change is verified against numbers instead of assumptions.

### Step 2 — Kill the CPU preprocessing copy
- **GPU path**: share one `GPUDevice` between the app and ORT (`ort.env.webgpu.device`), run letterbox + RGB + normalise as a small compute/render shader straight into a `GPUBuffer`, and hand ORT a `Tensor.fromGpuBuffer`. The frame goes camera -> GPU texture -> model with zero CPU touches. Set `preferredOutputLocation` so detection outputs stay on the GPU and only the small decoded output is read back.
- **CPU path**: replace the `getImageData` + JS loop with a single canvas resize into the model resolution and a typed-array transpose over the already-downscaled pixels (at 480 that is 4x less work than today's 960 loop), plus reuse of one `ImageData`/`Float32Array` pair.
- Expected effect on desktop with GPU at 960: preprocess drops from tens of ms to ~1 ms, inference to roughly 8-18 ms — the 15 ms range you measured.

### Step 3 — Real capability detection instead of guesses
- Probe the adapter properly: request adapter, read `limits`, `features` (including `shader-f16`), `isFallbackAdapter`, and retry once with `powerPreference: "high-performance"` before concluding WebGPU is unusable. A single failed probe never demotes a capable machine.
- Replace the static memory gate with a **measured micro-benchmark**: after the session warms up, run 10 synthetic frames and compute median inference time. That measurement — not `deviceMemory` — decides whether the device keeps 960 or moves to 480.
- Decision rule after warm-up: median <= 40 ms keeps 960; 40-90 ms keeps 960 with a reduced inference rate; > 90 ms switches to 480 and says why. The benchmark result is cached per device+model so the next launch boots straight into the right configuration, offline.
- Precision stays engine-matched: fp16 on WebGPU (`shader-f16` present), fp32 on WASM. The uploaded `yolo26n-960-high-fp32.onnx` is registered as the 960 CPU/desktop-fallback artifact so the 960 entry is complete.
- Warm-up extends to 5 runs and discards the first two from the reported average.

### Step 4 — Scheduler and rendering
- Camera preview and overlay render on their own `requestAnimationFrame` loop, fully independent of inference; boxes are interpolated between results so 60 FPS preview holds even at 20 inferences/sec.
- Strict single-frame-in-flight back-pressure: while a frame is in the worker, new frames are dropped, not queued — latency can never accumulate.
- All buffers reused: one `OffscreenCanvas`, one GPU buffer, one input tensor, one output staging buffer for the lifetime of the session.

### Step 5 — Surface the truth in the UI
A compact live status strip showing: model (960-high / 480-fast), precision (fp16/fp32), provider (WebGPU / WASM xN threads), measured inference latency (p50/p95) and inference FPS after warm-up, plus preview FPS separately. One tap opens the full attempt ledger and stage timeline.

### Offline
Nothing changes about caching: model bytes, the benchmark verdict and the chosen engine persist locally, so a downloaded model starts with no network.

## Realistic outcome per device
- Desktop/laptop with a real GPU, 960 fp16 WebGPU: target 10-20 ms inference, 50+ inferences/sec possible, preview 60 FPS.
- Modern phone, WebGPU: 960 attempted first and kept if the benchmark clears the threshold; otherwise 480 fp16, ~20-35 ms.
- Weak Android, WASM: 480 fp32, single-thread-safe, preview still 60 FPS.

The 960 model is never pre-emptively blocked on a device that has not been measured.

## Verification
- Playwright run on the preview capturing the HUD numbers before and after each step, so the improvement is recorded, not claimed.
- Unit tests for the new capability probe, the benchmark-based selection rule and the back-pressure scheduler.
- Existing test suite must stay green.

## Technical touch points
`src/features/inference/browser-worker.ts` (runtime load, GPU device sharing, tensor IO, warm-up, benchmark), `src/features/inference/preprocess.ts` (+ a new WebGPU preprocessing module), `src/features/inference/browser-onnx-provider.ts` (frame transfer, back-pressure), `src/features/inference/model-compatibility.ts` (drop the static memory block, keep the honest checks), `src/features/inference/model-context.tsx` (benchmark-driven selection, cached verdict), `src/features/session/use-live-session.ts` (render loop split), live UI components for the status strip. Registry row updated so 960 carries both fp16 and fp32 artifacts.

---

## Deferred: Fleet Mode (separate task, not part of this work)

Kept here only so the scope is recorded:
- Roles: **driver** (live/video/image + own reports) and **manager** (analytics only, no detection pages).
- Manager account: `markegyptian55@gmail.com`, password `markegyptian55@gmail.com`, provisioned with the manager role and email confirmed. Only that account gets the manager role; the sign-in form is unchanged and the role decides the landing page. Noting once for the record that an email-as-password credential on a published site is weak, and a password change should follow later.
- Driver **End shift** action rolls the day's sessions into a shift summary and pushes it to the manager view live.
- Manager dashboard: fleet KPIs, driver leaderboard, charts, risk list, daily rule-based recommendations (fire/promote/reassign signals), CSV/PDF export.
