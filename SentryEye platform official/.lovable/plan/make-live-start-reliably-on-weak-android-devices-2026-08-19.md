# Make Live start reliably on weak Android devices

## Confirmed diagnosis

- The screenshot stops at `posting-init`: the main thread posted initialization, but the worker never returned its first `worker-init-received` stage.
- A worker startup/module error updates an internal error field but does **not** reject the provider's initialization promise. The UI therefore waits until the global 90-second watchdog.
- That watchdog only changes the visible status. It does not terminate or evict the stalled worker. Pressing Retry then finds the same cached provider and awaits the same unresolved promise again.
- On a WebGPU-capable phone, “saved” currently checks only the GPU model file. If WebGPU fails, preparation may still download the separate CPU file before CPU fallback, so the badge and expected startup time can be misleading.
- The full model-first list already renders on desktop and mobile. The compact selector/download strip is mobile-only; it will be made consistently visible on PC as requested.

## Changes

### 1. Fix worker startup and real cancellation

- Give worker boot/initialization its own short handshake timeout instead of waiting 90 seconds for a stage that never arrives.
- Reject the initialization promise on worker `error` or `messageerror`, including useful startup details, and terminate that worker immediately.
- Make the overall prepare watchdog abort and evict the in-flight provider, clear its cached promise, and ignore late messages from the terminated attempt.
- Make **Retry** always create a fresh worker. Model changes and CPU fallback will also cancel the current attempt before starting another one.
- Harden the provider cache so an initializing/failed entry cannot remain marked warm or in-use.

### 2. Fast automatic recovery for weak Android

- Keep the required policy: try the 480px model with WebGPU first; do not force every phone onto CPU.
- If adapter probing, worker boot, WebGPU session creation, or WebGPU self-test fails/times out, automatically restart once with the 480px CPU/WASM asset and clearly show the switch.
- Use a bounded stage budget so a bad GPU path falls back quickly rather than consuming most of the 90-second window. CPU preparation receives its own realistic timeout.
- Do not retry endlessly: after one automatic CPU attempt, show the exact failed stage with working **Try again** and **Choose another model** actions.
- Remove duplicate blocking preparation work: the worker already performs a self-test and kernel warm-up, so the UI-level verification will run after readiness without delaying the Start button.

### 3. Correct download/cache state

- Track GPU and CPU model assets separately in the model chooser and download control.
- Show `GPU file saved`, `CPU file saved`, or `ready for fallback` rather than a single ambiguous `saved` badge.
- When weak-device recovery selects CPU, reuse the CPU file if present; otherwise show its real download progress and size.
- Avoid duplicate storage for the separate “CPU fallback” registry row when it points to the same CPU asset as the mobile model.

### 4. Model-first selection on PC and mobile

- Keep the full pre-start model list on both form factors, with selected model, input size, file size, recommended-device badge, engine asset status, and download action.
- Extend the compact model selector/download strip to desktop so the chosen working model remains obvious before Start.
- Disable selection only during the short active initialization, and make switching models cancel the old preparation immediately.

## Technical scope

- `src/features/inference/browser-onnx-provider.ts`: reject/cleanup on worker boot errors, handshake timeout, single-settle init lifecycle.
- `src/features/inference/provider-cache.ts`: explicit initializing/ready/failed state and forced eviction for retry/cancel.
- `src/features/inference/model-context.tsx`: abortable prepare attempts, fresh retry, one-time automatic CPU recovery, non-blocking post-ready verification.
- `src/features/inference/browser-worker.ts`: shorter stage-specific GPU failure budgets and clear fallback stage events.
- `src/features/inference/model-store.ts` and engine asset helpers: canonical cache identity and GPU/CPU cache reporting.
- Live model chooser/download/diagnostics UI: desktop parity, accurate asset state, automatic-fallback messaging.

## Verification

- Unit tests: worker startup error rejects promptly; watchdog terminates and evicts; Retry creates a new worker; late messages cannot change the new attempt; GPU failure triggers CPU exactly once.
- Android-emulated Playwright run: 480px model is selected, the chooser is visible before Start, no state can remain at `posting-init`, CPU fallback progress is honest, and Retry is a real restart.
- Weak-device simulation: force worker boot failure, WebGPU session timeout, and CPU failure separately; each must resolve to ready or a stage-specific error within its budget.
- Desktop run: selector is visible before Start, 960px remains recommended, and successful WebGPU preparation is unchanged.
- Final confirmation on the user's real weak Android device, since its exact Brave/driver behavior cannot be reproduced in the sandbox.
