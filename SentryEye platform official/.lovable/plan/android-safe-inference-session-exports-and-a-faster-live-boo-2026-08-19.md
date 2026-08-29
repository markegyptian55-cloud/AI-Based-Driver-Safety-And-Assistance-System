# Android-safe inference, session exports, and a faster Live boot

Eight changes across the Live and Video Upload experiences. Both pages already share the same
model/provider layer (`model-context` + the warm provider cache), so most reliability work lands
once and benefits both.

## 1. Android-safe startup + CPU fallback on Video Upload

The Video Upload page currently displays provider stages but relies on the plain preparation path.
It will use the exact same hardened flow as Live: bounded worker boot handshake, lazy runtime
import, automatic GPU → CPU (fp32, single-thread) recovery, and stage-level watchdogs.

## 2. One-tap "Try again" recovery

A single button on both Live and Video that:
- terminates the current inference worker,
- evicts the warm provider cache and any half-initialized entry,
- clears the failed engine preference so the next attempt re-probes cleanly,
- restarts preparation from stage zero with fresh progress.

## 3. Debug status panel (Android)

A collapsible panel, shown by default on mobile, listing every worker startup stage in order with
its status plus any runtime/import error text (message + stage where it happened), and a copy
button so the log can be shared.

## 4. Stage timeline with real-time timestamps

Extends the existing pipeline progress UI so Adapter Probe, Session Create, Self-Test and Warm-Up
each show start time and elapsed duration live while running, and final duration once done. A stage
that hangs is visually obvious because its timer keeps climbing.

## 5. Live detection becomes the default page, Dashboard second

Signed-in entry points and the main navigation put Live detection first; Dashboard moves to second
position. Existing URLs keep working.

## 6. Session export (PDF + CSV)

After a Live or Video session finishes, an Export button offers:
- PDF: performance stats (FPS, latency, engine, model), event counts, and the detection timeline.
- CSV: per-frame timeline rows and the semantic event list.

Reuses the existing report and CSV builders.

## 7. Accessibility: live region + high-contrast overlay

- A polite ARIA live region announces state changes (drowsiness alerts, session start/stop,
  recovery events) without spamming — throttled and deduplicated.
- A "High contrast overlay" toggle that switches bounding boxes and landmarks to thick,
  high-contrast strokes with solid label chips; off by default, remembered per device.

## 8. Persisted model + engine, and an adaptive inference scheduler

- The selected model and last successful engine (WebGPU / WASM) are stored per device and reused on
  the next visit, so the Live page boots straight into that engine without re-probing. A failed boot
  clears the stored engine so the device never gets stuck on a broken one.
- The inference scheduler measures actual frame cost and preview health, and moves the inference
  rate inside a 15–20 FPS band (dropping lower only if the device cannot hold the floor), keeping the
  camera preview smooth on Android.

## Technical notes

- Recovery/cache work: `src/features/inference/provider-cache.ts`,
  `browser-onnx-provider.ts`, `browser-worker.ts`, `model-context.tsx`.
- New `src/features/inference/engine-memory.ts` for last-good engine persistence, alongside the
  existing `engine-preference.ts`; model id persistence extends `use-model-selection`.
- Stage timings extend `pipeline-trace.ts` and `pipeline-progress.tsx` (which already renders live
  durations) with the four named stages.
- Exports reuse `features/report/session-pdf.ts` and `features/session/session-csv.ts`, wired into a
  shared `SessionExportButton` used by both Live and Video.
- Overlay contrast mode and the announcer live in `components/live/detection-overlay.tsx` plus a new
  live-region component; preference stored in `features/session/live-preferences.ts`.
- Adaptive scheduling lands in the capture loop in `features/session/use-live-session.ts` using the
  existing capture profiler samples.
