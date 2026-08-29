# Faster model downloads, storage you control, lower latency — plus an accessibility audit

## 1. Accessibility audit (done now, findings below)

I read the app shell, live components, tables, dialogs and the root document.

**Critical: none found.** Icon-only buttons I checked (alarm mute, replay frame steps, calibration close, notifications, copy link, history expand) all carry `aria-label`. `lang="en"` is set on `<html>`, `<main>` landmarks exist on the public routes, `min-h-dvh` is used instead of `h-screen`, and `tabIndex` is only ever `-1` (skip-link target, correct).

**Warnings to fix**
- The detection canvas (`detection-overlay.tsx`) has no accessible name and no text alternative, so screen-reader users get nothing about what the camera sees. Add `role="img"` + `aria-label` and an off-screen live summary of the current state.
- Download progress in `model-manager.tsx` is a visual bar only — no `aria-live` announcement of "downloading 42%" or "saved".
- Risk/alert state on Live is communicated mainly by colour; add a text label next to the colour so it is not colour-only.
- The authenticated pages under `app-shell.tsx` render into a `div#main-content`, not a `<main>` landmark.

**Info**
- Some stat groups render as `div` stacks rather than lists; convert the Stored-files list to a proper `<ul>` with per-item controls (this happens anyway in part 2).

## 2. Storage you control (Stored files)

Today `Stored files` on the Models page is a read-only list, and old builds only disappear when they happen to share a model id.

- Each stored file gets its own **Delete** button, with a confirm step and the size shown, so removing 10 MB is one tap.
- Files whose model is no longer in the registry are marked **Unused (old build)** and get a one-tap **Remove all unused** action.
- Half-finished downloads become visible too, with **Resume** and **Discard**, instead of silently occupying space.
- A **Free up space** summary shows total used vs device quota and how much the unused files account for.

## 3. Downloads that are fast and don't stall

Root causes in the current downloader (`model-store.ts`):

- Every received chunk calls back into React state, so a 10 MB download triggers thousands of re-renders — that alone stalls a phone.
- Each 2 MB checkpoint rebuilds and copies the entire buffer, then the final save copies it twice more. Cost grows with the square of file size, so the 960 model is the worst case.
- A single stream with no timeout: if the connection stalls mid-stream, nothing ever times out and the UI sits on "downloading" forever.

Fixes:

- Throttle progress to ~4 updates a second and keep the byte counter in a ref, not React state.
- Store chunks as separate records and assemble once at the end (or keep a `Blob`), removing the repeated full-buffer copies.
- Parallel range requests (4 segments) when the server reports range support, falling back to the current single stream when it doesn't — this is the main wall-clock win on mobile.
- Stall detection: if no bytes arrive for 15 s, abort and auto-retry the remaining range with backoff (up to 3 times), keeping the resume checkpoint. The UI shows "reconnecting" instead of freezing.
- Cancel button that actually aborts the fetch and preserves what arrived.

## 4. Reducing inference latency

Confirmed in code: the ONNX runtime is loaded from a public CDN (`browser-worker.ts:75`) and CPU threads are forced to 1 unless the page is cross-origin isolated (`:86`). Isolation headers are currently set in dev only, and CDN loading is what previously broke when they were enabled.

- Self-host the runtime `.wasm`/`.mjs` files from this app, then enable the isolation headers in both dev and the deployed server so multi-threaded CPU inference actually turns on. This is the single largest latency reduction available for phones.
- Keep the existing per-device thread cap and the fp32 CPU-fallback selection so weak phones get the export they can execute natively.
- Overlap capture with inference (prepare the next frame while the model runs) so throughput is not one round trip per frame.
- Re-measure before/after on desktop and phone and report both latency and detection counts, so speed is not bought with accuracy.

## Technical notes

- `model-store.ts`: chunked/parallel range fetch, stall watchdog, chunk-record storage, `deleteCachedKey(key)` and `listOrphanedKeys(registryIds)` helpers.
- `routes/_authenticated/models.tsx` + `components/live/model-manager.tsx`: per-file delete, unused-build cleanup, partial download rows, `aria-live` progress.
- `browser-worker.ts` + `vite.config.ts` + `src/server.ts`: self-hosted `ort` assets and COOP/COEP in dev and production.
- `detection-overlay.tsx`, `app-shell.tsx`, `risk-panel.tsx`: the accessibility fixes above.
- No change to model weights, class map, letterbox preprocessing, thresholds, or the baked-in NMS output.
