# Faster 960 model, and a 480 model that actually runs on weak phones

Two separate problems, two separate causes. Both are confirmed by inspecting the live code, the model registry and the running preview.

## What I verified

- **The browser is running the AI on a single CPU thread.** In the running preview `crossOriginIsolated` is `false`. The worker only uses a multi-thread pool when the page is cross-origin isolated, so on every device today the CPU path is 1 thread even on a 28-core machine.
- **The 960 model is 960×960 fp32 with a fixed input shape.** Nothing in the app can make that graph cheaper at runtime — no resolution knob exists in the file, so latency has to come from the engine path and a lighter derived export.
- **The 480 "low device" model stores its weights in fp16** (208 fp16 tensors). Weak phones without WebGPU fall back to the CPU engine, where fp16 weights are emulated — the measured cost earlier was ~350 ms/frame (~3 FPS), which is why it "doesn't work" there.
- Every frame allocates a fresh input buffer (2.7M floats at 960) and only one frame is ever in flight, so the camera waits for the model instead of overlapping work.

## Plan

### Step 1 — Measure before changing anything

Benchmark all candidates on a single CPU thread and on GPU, and write the numbers into the plan report:
960 fp32 (today), 960 int8, 480 fp16 (today), 480 fp32, 480 int8. Report median latency, FPS, and detection agreement against the current models on the sample driver images so nothing is shipped that loses accuracy.

### Step 2 — Make the weak-device model actually usable

- Produce an **fp32 conversion of the 480 model** (same weights, no retraining, no accuracy change) and, if the measurement justifies it, an **int8 version** for the weakest phones.
- Upload as new model files and register them so weak devices get the fast one automatically; the fp16 file stays only for WebGPU phones where it is genuinely faster.
- Selection becomes engine-aware: GPU phone → fp16, CPU-only phone → fp32/int8. Today the app picks purely on input size and ignores which engine the device ended up on.

### Step 3 — Cut the 960 latency

- **Turn on multi-threaded CPU inference** by serving the app cross-origin isolated, so the existing thread budget (up to 4 threads on desktop) stops being ignored. Verified against the app's own pages so no embedded resource breaks.
- **GPU fast path:** enable graph capture and high-performance power preference for the fixed-shape graph, which removes per-frame setup cost on WebGPU.
- **Reuse buffers:** allocate the input tensor and canvas once per session instead of per frame.
- Register a **lighter derived 960 variant** (int8 and/or fp16) if Step 1 shows it keeps detection quality — this is the single biggest latency drop for CPU-only desktops.

### Step 4 — More frames per second

- Overlap work: allow a second frame to be prepared while the model is busy, so FPS is no longer capped by one round trip.
- Raise the desktop capture ceiling above the current 30 FPS cap and let measured throughput, not a hardcoded number, decide the analysed rate.
- Keep the safety behaviour unchanged: the alarm, PERCLOS and event timing are all time-based, so a higher frame rate does not change thresholds.

### Step 5 — Prove it

Re-run the same benchmark on desktop and on a weak-phone profile, and report before/after latency and FPS for both models, plus a detection-quality comparison so speed is not bought with accuracy.

## Technical notes

- Files touched: `browser-worker.ts` (threads, graph capture, buffer reuse), `browser-onnx-provider.ts` (pipeline depth), `camera.ts` (capture ceiling), `performance-mode.ts` and `model-compatibility.ts` (engine-aware selection), plus a registry migration for the new model rows.
- Model conversions are done offline with ONNX tooling from the existing exports; no retraining and no change to the class map, letterbox preprocessing, or the baked-in NMS output format.
- If a converted variant loses detection quality in Step 1, it is dropped and the report says so instead of shipping it.
