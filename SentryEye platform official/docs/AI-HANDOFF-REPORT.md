# SentryEye — Full Handoff Report (for an AI assistant)

This is the single self-contained document describing the whole product: stack,
routes, file map, inference pipeline, micro-events, scoring, offline behaviour,
database schema, security model, and roadmap. Give this file to any chatbot and
it has everything it needs to reason about the codebase.

Companions: `docs/SYSTEM-REPORT.md` (short narrative) and the live `/docs` page
in the app (generated from runtime constants, so its numbers can never drift).

---

## 1. Product

Browser-native AI driver-drowsiness detection platform. **All inference runs
on-device in a Web Worker.** No frame, image, or video ever leaves the device;
the cloud only receives summarised safety events and finalized shift reports.

| Role | What they get | What they cannot do |
| --- | --- | --- |
| Driver | Live / Video / Image detection, automatic shift lifecycle, own reports & history, offline model store | See other drivers, edit a finalized report, reach manager pages |
| Manager | Fleet KPIs from daily aggregates, driver detail + trends, reports feed with filters, sync health, audit log, notes | Run detection pages, change a computed score |
| Visitor (signed out) | Live / Video / Image detection with no shift attached | Persist anything, view reports/dashboards |

Manager access is clamped in the database by the `tg_clamp_fleet_role` trigger
(reserved manager email), not in the UI.

---

## 2. Stack

- React 19 + **TanStack Start v1** (file routes in `src/routes`, `createServerFn`
  for server logic, server routes under `src/routes/api/*`). No React Router.
- Vite 7, Tailwind CSS v4 configured through `src/styles.css` (`@theme` tokens,
  Electric Neon Green palette, all colours are semantic tokens).
- shadcn/ui components in `src/components/ui`.
- **Lovable Cloud (Supabase)**: Postgres + RLS + explicit GRANTs, Auth, Storage,
  Realtime. Client at `src/integrations/supabase/client.ts` (auto-generated).
- `onnxruntime-web` (self-hosted WASM binaries under `public/ort`) for inference,
  `ffmpeg.wasm` for video transcoding, Recharts for analytics, jsPDF for reports.
- vitest for unit tests (tracker, router, profiler, presets, preflight, scoring…).

---

## 3. Layered architecture

```text
UI            src/routes/**, src/components/**
              hooks: use-live-session, use-quality-monitor, use-roles, use-auth,
                     use-model-selection, use-auto-downgrade, use-online-status
Logic (pure)  src/features/drowsiness  perclos · event-aggregator · mouth-state ·
                                       safety-score · alarm · labels · yawn-summary
              src/features/session     camera · frame-source · video-file-source ·
                                       calibration · auto-calibrate · detection-quality ·
                                       low-light · capture-profiler · replay-buffer ·
                                       session-stats/csv · diagnostics-{log,redact,bundle} ·
                                       preflight · telemetry · session-recorder
              src/features/fleet       shift-context · shift-report · event-mapping ·
                                       offline-queue · shift-sync · safety-score · types
Inference     src/features/inference   registry → DetectionEngine
                                       browser-onnx-provider → browser-worker
                                       remote-fastapi-provider · hybrid-router
                                       preprocess · gpu-preprocess (WGSL) · postprocess
                                       detection-tracker · mobile-presets · model-store ·
                                       model-ladder · engine-{preference,memory,attempts} ·
                                       startup-log · warmup · benchmark
Data          Lovable Cloud Postgres + server functions (src/lib/*.functions.ts)
```

**Hard rule:** the UI never talks to ONNX or SQL directly — it talks to hooks;
hooks talk to pure logic plus the provider interface.

---

## 4. Routes

Public: `/` (landing), `/auth`, `/docs`, `/share/$token` (expiring diagnostics).

Under `_authenticated/` (route gate redirects to `/auth`):

| Route | Purpose |
| --- | --- |
| `live` | Real-time webcam detection (driver/visitor) |
| `video` | Video-file detection with annotated MP4 download |
| `image` | Single-frame detection |
| `models`, `model` | Offline model download manager, per-model detail |
| `benchmark` | A/B engine benchmark, remote FastAPI endpoint config |
| `monitoring` | Health probes / system status |
| `driver.index`, `driver.reports`, `my-report` | Driver home, own report feed |
| `report.index`, `report.$sessionId` | Session report + PDF/CSV export |
| `history`, `analytics`, `dashboard` | Session history, KPIs & trends |
| `manager.index` | Fleet dashboard (realtime, toasts, unread badge, filters) |
| `manager.drivers.index`, `manager.drivers.$driverId` | Fleet roster + driver detail |
| `manager.history`, `manager.audit` | Reports feed, audit log |
| `settings`, `profile` | Preferences, calibration sync, account |

---

## 5. Inference pipeline

**Models — exactly two, no others ever:**

| id | imgsz | precision | size | Use |
| --- | --- | --- | --- | --- |
| `yolo26n-480-fast` | 480 | fp32 | ~10 MB | Default on constrained/mobile devices |
| `yolo26n-960-high` | 960 | fp32 | ~10 MB | Higher accuracy; gated off devices with < 4 GB RAM |

Both fp32 on **every** execution provider — no fp16 exports, no CPU twins.
Classes: `0 closed_eye`, `1 open_eye`, `2 yawning`.

- **Preprocess:** RGB, NCHW, letterbox padding. With WebGPU live, a WGSL compute
  shader (`gpu-preprocess.ts`) does the letterbox zero-copy on the GPU.
- **Postprocess:** per-class confidence floors, class-aware NMS with cross-class
  dedupe (so one eye never carries a stack of boxes), inverse-letterbox mapping
  back to display coordinates, corrupt-output rejection for known-bad mobile
  GPU drivers. Supports `ultralytics-v8` and `rf-detr` head formats.
- **Engine ladder:** WebGPU adapter probe (watchdog-guarded) → worker self-test
  on the created session → WASM (SIMD + threads) as the always-available floor.
  Every attempt and its rejection reason is surfaced in the Diagnostics card
  (`engine-attempts.ts`). Winning engine + model are persisted (`engine-memory.ts`)
  so the next boot skips re-probing.
- **Scheduling:** depth-2 pipelined loop, latest-frame-wins `ImageBitmap` capture
  queue, duty-cycle adaptive scheduler, capture-resolution ladder
  (1080p → 900p → 720p), motion gate that skips still frames.
- **Tracking:** IoU association + EMA smoothing with hysteresis; tracks expire by
  **milliseconds** (`maxMissedMs`), not frame counts, so low FPS doesn't strand boxes.
- **Observability:** `PerfMetricsBar` HUD on Live and Video — p50/p95 latency,
  inference vs preview FPS, queue occupancy, drop rate. `capture-profiler.ts`
  records per-frame preprocess/infer/postprocess splits and sensor state.

**Presets** (`mobile-presets.ts`, chosen automatically or manually):

| | Desktop | Mobile / low light |
| --- | --- | --- |
| conf floor | 0.35 | 0.22 (display 0.30) |
| IoU | 0.50 | 0.50 (never relaxed for dim light) |
| tracker smoothing | 0.5 | 0.35 |
| max missed | 2 frames / 200 ms | 5 frames / 500 ms |
| eye-closed threshold | 400 ms | longer hold |

**Alternate providers:** `remote-fastapi-provider` (Python service in `backend/`,
FastAPI + Ultralytics, `/v1/detect` accepting raw JPEG, Swagger at `/docs`) and
`hybrid-router` which routes frames to remote when on-device FPS/confidence sag,
with sustain + cooldown timers to prevent flapping. Off unless a URL is configured.

---

## 6. Micro-events

`event-aggregator.ts` turns per-frame detections into debounced spells and emits
semantic events; `event-mapping.ts` decides which are persisted.

| Emitted | Stored as | Severity | Trigger |
| --- | --- | --- | --- |
| `eye_closed_sustained` | `eyes_closed` | medium | Eyes closed past the preset threshold (400 ms desktop) |
| `microsleep` | `microsleep` | high | Closure ≥ 0.5 s — WebAudio alarm fires |
| `critical_microsleep` | `microsleep` | critical | Closure past the critical threshold — continuous alarm |
| `yawn` | `yawning` | low | Mouth-open spell confirmed with yawn geometry, not a smile |
| `long_yawn` | `yawning` | medium | Confirmed yawn held past the long threshold |
| `drowsy_yawn` | `drowsiness` | high | Long yawn while risk is already elevated |
| `drowsy` | `drowsiness` | high | PERCLOS or yawn rate crosses thresholds |
| `yawn_started` | — | UI only | Transient state, never stored |
| `alert_cleared` | — | UI only | Recovery never inflates event counts |

Supporting logic: PERCLOS sliding-window closure fraction; MAR-based mouth state
separating smile/talking from yawn (rejected spells kept as tuning evidence);
per-eye left/right labels; WebAudio oscillator alarm (no asset, works offline).

---

## 7. Capture quality & calibration

- `detection-quality.ts` scores lighting, blur, distance, occlusion, confidence
  and framerate into 0–100 with a dominant reason **and its fix**.
- `quality-cues-overlay.tsx` shows *where* the problem is: framing ellipse,
  darkness veil, blur vignette, per-factor chips.
- `quality-gate.tsx` + `preflight-checklist.tsx` block or warn before a session.
- `low-light.ts` applies exposure/gain/frame-rate `MediaStreamTrack` constraints.
- Calibration wizard learns personal blink/yawn baselines; uploaded clips are
  auto-calibrated from their first seconds through the *same* `computeCalibration()`.
  Profiles sync to `user_settings` so they follow the driver across devices.

---

## 8. Shifts, scoring, manager view

- A driver's shift starts automatically on sign-in; **End Shift** stops
  inference, flushes events and finalizes.
- `finalize_shift()` is a **security-definer** function: it computes the report,
  the `driver_daily_stats` aggregate and the audit row in one transaction, so the
  client can never influence the numbers.
- Score = `100 − Σ weightᵢ × min(1, indicatorᵢ / capᵢ) × 100`, clamped 0–100.
  Weights, caps and risk-band thresholds come from the organization's
  `scoring_config`; every classification carries the `factors[]` that produced it.
  Bands: `low / moderate / high / critical`.
- Reports are **insert-once**; drivers have no UPDATE/DELETE path.
- Manager dashboard reads aggregates only (never raw events), refreshes over
  Supabase Realtime with throttled toasts and an unread badge, and supports
  sorting by latest or score plus driver / risk-level / date-range filters.

---

## 9. Offline

- Service worker caches the app shell in **published** tabs only; previews
  unregister stale workers so cached code can never mask a fresh build.
- Models cached in IndexedDB via `model-store.ts`: resumable segmented
  (4-way parallel) downloads with checkpointing, checksum verification,
  per-model deletion, stop control, and orphan purge.
- Shifts, events and reports are written locally first with a stable
  `clientShiftId`.
- Sync states: `local → pending_sync → syncing → synced | sync_error`.
  Uploads go shift → events → report as **idempotent upserts**, so a retry can
  never create a second report. A background drainer runs on reconnect; the
  manager sees fleet-wide sync health (`sync-health-card.tsx`).

---

## 10. Data model (public schema)

Tables: `profiles`, `user_roles`, `organizations`, `org_members`, `drivers`,
`shifts`, `safety_events`, `shift_reports`, `driver_daily_stats`,
`manager_notes`, `sessions`, `detection_events`, `benchmark_runs`,
`model_registry`, `media_assets`, `diagnostics_shares`, `notifications`,
`user_settings`, `audit_log`, `system_metrics`.

Functions: `finalize_shift`, `has_role`, `has_any_role`, `is_org_manager`,
`is_reserved_manager`, `fleet_role_for_email`, `current_fleet_role`,
`current_org_id`, `current_user_roles`, `my_driver_id`, `manager_audit_feed`,
`purge_expired_diagnostics_shares`, trigger `tg_clamp_fleet_role`.

Every table has RLS enabled plus explicit GRANTs; roles live only in
`user_roles` (never on `profiles`) and are read through security-definer helpers.

---

## 11. Security posture

- RLS + GRANTs on every public table; role checks via security-definer functions.
- Manager-only server functions guarded **server-side** (`src/lib/manager.functions.ts`);
  `<Can>` and `use-roles` are UI convenience only, never the enforcement point.
- Private storage buckets with owner checks on write/delete.
- Diagnostics share links are expiring and redacted (`diagnostics-redact.ts` strips
  anything identifying; no images, emails or tokens are ever recorded).
- `audit_log` rows for signup, shift finalization and manager actions.

---

## 12. Reporting & export

- `report/$sessionId` — professional driver report with event timeline and a
  plain-language narrative (`report-narrative.ts`).
- PDF via jsPDF (`pdf-report.ts`, `session-pdf.ts`), CSV via `session-csv.ts`.
- `replay-buffer.ts` + `replay-scrubber.tsx` — scrub back through what the model
  saw at any moment (~20 min at 10 analysed FPS).
- `diagnostics-bundle.ts` — one file (`sentryeye.diagnostics.v2`) containing log,
  down-sampled frame trace, profiler stats, benchmark table and runtime identity.

---

## 13. Known constraints / invariants (do not violate)

1. Only two models exist — `yolo26n-480-fast` and `yolo26n-960-high`, both fp32.
   No fp16 exports, no CPU-specific twins.
2. Never force phones onto WASM-only: WebGPU is tried first, the worker self-test
   is the safety net.
3. Never raise the NMS IoU threshold to compensate for low light — it stacks
   boxes on one eye. Lower the confidence floor and let the tracker decide.
4. Never claim the 480 and 960 models have equal accuracy; compare `closed_eye`
   AP, not aggregate mAP.
5. Detection pages are off-limits to managers (server-side redirect).

---

## 14. Roadmap

See `.lovable/plan/sentryeye-next-future-plan-2026-08-23.md`:
deeper micro-events (distraction, no-driver gaps, evidence thumbnails), offline
hardening (storage-quota awareness, Background Sync API), manager intelligence
(period deltas, scheduled digests, exports), a third performance pass, and
retention/transparency controls.
