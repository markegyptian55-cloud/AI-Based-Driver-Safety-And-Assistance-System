# Fix step 5 "Running AI inference" failures, especially on weak Android

## What I verified in the code first

- Cross-origin isolation headers (`COOP: same-origin`, `COEP: credentialless`) are set in both dev (`vite.config.ts`) and production (`src/server.ts`), so threaded WASM should be possible — but `crossOriginIsolated` is only read, never reported to the user when it is false.
- The worker probes `navigator.gpu.requestAdapter()` with a 3 s timeout before choosing providers, so "no WebGPU" is already handled.
- Precision is already engine-aware: the WASM path downloads the fp32 twin when the registry supplies `cpuModelUrl`. So fp16-on-WASM is not the bug here.
- **Real defect found:** the ONNX runtime module is loaded once, up front, with `wantsGpu = plan.includes("webgpu")`. When WebGPU then fails at session-create or self-test, the WASM retry keeps running on the JSEP/GPU bundle instead of the dedicated CPU entrypoint — exactly the bundle that crashes on some Android/Brave builds. The CPU fallback therefore inherits the GPU bundle's failure.
- **Second gap:** nothing gates the 960 model by device memory. `navigator.deviceMemory` is read for diagnostics only; `model-compatibility.ts` warns on input size for phones but never blocks, so a 2 GB Android can still select 960 (11 MB input tensor plus activations) and hit an out-of-memory abort.
- **Third gap:** the failure message is `No usable inference backend on this device (<last failure>)`. Only the last provider's reason survives, so OOM, adapter loss, download 404 and timeout all look identical.

The exact error on your device is still unknown, so the plan makes the pipeline report it precisely and removes the two failure modes the code demonstrably has.

## Changes

### 1. True per-provider runtime loading
- Load the runtime lazily inside the provider loop: WebGPU attempt loads `onnxruntime-web/webgpu`, the CPU attempt loads `onnxruntime-web/wasm` fresh.
- Release the GPU session and runtime before the CPU attempt, so GPU memory is freed before CPU allocation.
- Record `runtime-load-start/done` per attempt in the startup log so the timeline shows which bundle each attempt used.

### 2. Memory-aware model gating
- Add a memory check to `model-compatibility.ts`: estimate peak working set from `imgsz` (input tensor plus a fixed activation multiplier) and compare against `navigator.deviceMemory` and the mobile flag.
- Below the threshold the 960 model is a blocking error ("needs about X GB, this device reports Y"), not a soft warning, and the model chooser shows it disabled with the reason.
- 480 stays the default on phones; desktop behaviour unchanged.

### 3. Honest failure reporting
- Collect a per-provider attempt record (provider, asset id, stage reached, duration, error) and put all of them into the thrown error and the diagnostics panel, instead of only the last one.
- Classify the error into a short cause line: out of memory, model download failed (with status), WebGPU unavailable, self-test failed, timed out at <stage>, WASM SIMD unsupported.
- Surface an environment line in the Live diagnostics card and in the copied log: `crossOriginIsolated`, `navigator.gpu` present, adapter found, wasm threads, deviceMemory, selected model + precision, resolved engine.

### 4. Explicit "safe mode" retry
- Add a one-tap **Run in safe mode** action on the inference error: forces 480 + fp32 + WASM single-threaded, bypassing WebGPU entirely, and keeps that choice for the session.
- Add a non-SIMD WASM binary as a last-resort fallback when SIMD loading fails, so very old Android browsers get a slow-but-working path rather than a hard error.

### 5. Timeout tuning for weak devices
- First-inference / warm-up on a weak CPU can legitimately take 10-30 s. Keep the short budgets for the GPU path (fail fast, fall back) and raise the CPU self-test/warm-up budget, with visible elapsed time so it never looks frozen.

## Technical scope

- `src/features/inference/browser-worker.ts` — per-attempt runtime load and teardown, attempt ledger, error classification, non-SIMD fallback, CPU timeout budgets.
- `src/features/inference/model-compatibility.ts` (+ its test) — memory estimate and blocking rule.
- `src/features/inference/engine-preference.ts` — safe-mode preference persistence.
- `src/components/live/model-choice-list.tsx`, `diagnostics-card.tsx`, `worker-debug-panel.tsx` — disabled-with-reason state, environment line, safe-mode button.
- Same worker path already backs Video Upload, so both features get the fix.

## Verification

- Unit tests: WebGPU failure loads the CPU bundle on retry; 960 blocked at low reported memory; each classified error maps to its signature.
- Playwright with an Android UA: WebGPU forced to fail, confirm the CPU attempt starts on the WASM bundle and reaches ready, and the diagnostics card shows both attempts.
- You confirm on the real weak Android — and if it still fails, the new error line names the exact cause instead of "no usable backend".
