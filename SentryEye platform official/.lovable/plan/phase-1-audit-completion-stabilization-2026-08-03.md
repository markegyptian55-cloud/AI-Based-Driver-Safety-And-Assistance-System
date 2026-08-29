# Phase 1 — Audit, Completion & Stabilization

No redesign. No new architecture. Existing UI layout, routes, Supabase backend and browser-ONNX inference stay exactly as they are.

## Audit result (measured from current code)

| Module | State | % |
|---|---|---|
| Design system / app shell | Sidebar, tokens, layout done; no mobile verification pass | 90 |
| Authentication + RBAC | `use-auth`, `use-roles`, `<Can>`, `_authenticated` gate, RLS all live | 100 |
| Inference layer (browser ONNX) | Worker, preprocess, letterbox, YOLOv8-head decode, provider contract complete; single model hardcoded, session rebuilt per run | 75 |
| Drowsiness logic | PERCLOS window + event aggregator complete | 100 |
| Session pipeline | Recorder, Supabase port, camera + video-file sources, transcoder complete | 95 |
| Video Detection page | Working end to end (702 lines, incl. ffmpeg fallback) | 90 |
| Live Detection page | Working; not mobile-verified, no facing-mode/rotation handling | 80 |
| Dashboard | Real queries, partial widgets | 70 |
| AI Model Info | Renders registry row; metrics card is an explicit stub; no selector | 55 |
| Settings | Provider + thresholds persist; alarm/notification toggles unwired | 85 |
| Image Detection | `PagePlaceholder` | 0 |
| History | `PagePlaceholder` | 0 |
| Gallery | `PagePlaceholder` | 0 |
| Session Replay | `PagePlaceholder` | 0 |
| Analytics | `PagePlaceholder` | 0 |
| System Monitoring | `PagePlaceholder` | 0 |
| Profile | `PagePlaceholder` | 0 |
| Admin | `PagePlaceholder` | 0 |

**Overall: ~48%** (weighted by module size; 8 of 20 modules are 0%).

Dead/duplicated code found: `errorMessage` re-exported from `browser-onnx-provider.ts` (duplicate of `@/lib/format-error`), unused `getLastFfmpegLog`/`getRecentFfmpegLog` paths, `remote-fastapi` branch in `registry.ts` that silently returns the browser provider, `TranscodeValidation` fields hardcoded to zero, `page-placeholder.tsx` (removed once all 8 pages ship).

## Model files — status

- `best-2.onnx` and `best-3.onnx` are byte-identical (same MD5): one YOLOv11m, 384x384, classes `closed_eye/open_eye/yawning`. This is the Secondary model.
- `rfdetr-nano.onnx` (just uploaded, 113 MB) is a real RF-DETR export: single input `input`, two outputs `dets` (boxes) and `labels` (class logits). This is the Primary model. The earlier `checkpoint_best_ema.onnx` stub is discarded. **No blockers remain.**

## Work plan

### 1. Model registry & selector
- Migration: remove the old `yolo11m-drowsiness` 640 model row and delete its CDN asset; seed two rows — `rfdetr-nano-384` (Primary) and `yolo11m-worstcase-384` (Secondary) — each with `imgsz`, `labels`, `semantic_map`, `head_format`, metrics from the uploaded summaries, and `model_url`.
- Replace the static `public/models/labels.json` read in `features/drowsiness/labels.ts` with a registry-driven metadata loader keyed by model id. `labels.json` becomes the fallback for the selected model only.
- Add `selected_model_id` to `user_settings`; render a **Model Selector** in the existing Settings "Inference" card and a compact one in the existing Model Info page header. No new pages, no layout changes.
- Model Info page: fill the stubbed Metrics card with real values from the registry (mAP@50, mAP@50-95, precision, recall, per-class AP, FPS, training duration, hardware) for whichever model is selected.

### 2. Head-format abstraction (needed for RF-DETR)
`postprocess.ts` currently only decodes the Ultralytics v8 head. Add a `head_format` switch: `ultralytics-v8` (existing, with NMS) and `rf-detr` — reads the `dets` (cxcywh boxes) and `labels` (class logits) outputs, applies sigmoid, top-k by score, no NMS. Actual output shapes are confirmed with a real ORT run before the decoder is finalized. Selection comes from registry metadata — no model-specific code in UI or session layers.

### 3. Model caching (hard requirement)
Today `use-live-session.stop()` calls `provider.dispose()`, which terminates the worker and drops the ORT session, so every run re-downloads and re-initializes.
- Introduce a module-level `ProviderCache` keyed by `providerId + modelId`: the worker and ORT session are created once and kept warm.
- `stop()` releases the *session* (recorder, aggregator, frame source) but returns the provider to the cache instead of disposing it.
- Cache eviction happens only when the selected model changes, on explicit "unload model", or on `pagehide`.
- Result: switching videos, replaying the same video, and starting/stopping live all reuse the warm session. Verified by asserting the model-download stage fires exactly once across three consecutive runs.

### 4. Finish the 8 placeholder pages
Each built inside the existing shell and design tokens, reading data that already exists in the schema:
- **History** — paginated session table (source, duration, risk peak, event counts), filters, drill-in.
- **Session Replay** — timeline scrubber over `detection_events` for one session, risk/PERCLOS trace, event markers.
- **Analytics** — aggregate charts: events over time, risk distribution, PERCLOS trend, per-class detection counts.
- **Gallery** — thumbnail grid from the `thumbnails` bucket / `media_assets`, filter by event kind.
- **Image Detection** — single-image upload through the same cached provider, overlay + detection list, saved as an `image-upload` session.
- **System Monitoring** — `system_metrics` + live provider status (engine, FPS, latency, memory, cache state).
- **Profile** — display name, avatar upload, role badges, password change, session count.
- **Admin** — user list, role assignment via `user_roles`, audit log viewer. RBAC-gated with `<Can>`.
Then delete `page-placeholder.tsx`.

### 5. Mobile & tablet support
- Audit every page at 375/768/1024 widths in portrait and landscape with a real browser pass; fix overflow, sidebar behaviour, table scroll, chart sizing, and control targets. No visual redesign — responsive fixes only.
- Live camera on mobile: `facingMode` front/rear toggle, correct aspect handling, overlay scaling on orientation change.
- Video upload on mobile: capture-from-camera accepted, ffmpeg fallback memory-capped for mobile Safari.

### 6. Cleanup
Remove the duplicate `errorMessage` re-export, the fake `remote-fastapi` fallback branch (keep the interface, make the branch throw a clear "Phase 2" error), unused transcoder log helpers, dead validation fields, and any unused imports/components surfaced by lint.

### 7. Final report
Completion table recomputed, remaining blockers, and explicit confirmation of: model caching (with the one-download proof), mobile verification results per page, and selector readiness for both production models.

## Blockers

None. Both production models are in hand and both head formats are covered by the plan.

Practical risk to manage, not a blocker: RF-DETR is 113 MB and YOLOv11m is 80 MB. First load per model is a real download, which is exactly why the provider cache and a visible one-time download indicator matter.

## Technical notes

- Provider cache lives in `src/features/inference/provider-cache.ts`, keyed by `${providerId}:${modelId}`; `use-live-session` acquires/releases rather than constructs/disposes.
- Registry metadata replaces `loadModelMetadata()`'s hardcoded URL; `ProviderConfig` gains `headFormat`.
- Both models are 384x384 — `letterbox` already parameterizes `imgsz`, no change needed.
- New ONNX files are uploaded via `lovable-assets` pointers, never committed as binaries.
- No FastAPI, Flask, or Supabase changes. Browser-ONNX remains the only live provider.
