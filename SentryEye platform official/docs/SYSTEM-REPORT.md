# SentryEye — System Report

Live version of this document: `/docs` in the app. That page is generated from
the same constants the runtime uses, so the numbers there can never drift.
This file is the narrative companion.

---

## 1. What the product is

A browser-native AI driver-drowsiness platform. All detection runs on the
device; the cloud only ever receives summarised safety events and finalized
shift reports.

Three audiences:

| Role | Surface |
| --- | --- |
| Driver | Live / Video / Image detection, automatic shift lifecycle, own reports, offline model store |
| Manager | Fleet dashboard from daily aggregates, driver detail + trends, reports feed, sync health, audit log |
| Visitor | Detection pages with no shift attached |

Manager access is clamped at the database level (`tg_clamp_fleet_role`), not in
the UI.

---

## 2. Architecture

```text
UI (React 19 · TanStack Start · Tailwind v4)
  routes/  index · auth · docs · share.$token · _authenticated/*
        │  hooks (use-live-session, use-quality-monitor, use-roles, …)
Logic (pure, testable)
  features/drowsiness  perclos · event-aggregator · mouth-state · safety-score · alarm
  features/session     camera · video-file-source · calibration · detection-quality · low-light
  features/fleet       shift-context · shift-report · event-mapping · offline-queue · shift-sync
        │
Inference (swappable DetectionEngine)
  browser-onnx (Web Worker · WebGPU/WASM) · remote-fastapi · hybrid-router
  preprocess (WGSL letterbox) · postprocess (class-aware NMS) · detection-tracker
        │
Data (Lovable Cloud · Postgres + RLS + GRANTs)
  organizations · org_members · drivers · shifts · safety_events · shift_reports
  driver_daily_stats · manager_notes · sessions · model_registry · audit_log · …
```

Rule enforced throughout: the UI never talks to ONNX or SQL directly.

---

## 3. Inference

- **Models:** exactly two — `yolo26n-480-fast` and `yolo26n-960-high`, both fp32
  (~10 MB), used on every execution provider. Classes `closed_eye`,
  `open_eye`, `yawning`.
- **Preprocess:** RGB, NCHW, letterbox padding; a WGSL compute shader does the
  letterbox on the GPU with no CPU copy when WebGPU is live.
- **Postprocess:** per-class thresholds, class-aware NMS with cross-class
  dedupe, inverse-letterbox mapping back to display coordinates, corrupt-output
  rejection for known-bad mobile drivers.
- **Engine ladder:** WebGPU adapter probe → session self-test → WASM floor.
  Every attempt and its rejection reason is listed in the Diagnostics card. The
  winning engine and model are persisted so the next boot skips re-probing.
- **Scheduling:** depth-2 pipelined loop, latest-frame-wins capture queue,
  duty-cycle adaptive scheduler, capture-resolution ladder (1080p → 900p →
  720p), motion gate that skips still frames.
- **Observability:** on-screen HUD with p50/p95 latency, inference vs preview
  FPS, queue occupancy and drop rate, on both Live and Video.

---

## 4. Micro-events

Per-frame detections never leave the device. `event-aggregator.ts` converts
them into debounced spells and emits semantic events; `event-mapping.ts` decides
which of those are worth storing.

| Emitted | Stored as | Severity |
| --- | --- | --- |
| `eye_closed_sustained` | `eyes_closed` | medium |
| `microsleep` (≥ 0.5 s) | `microsleep` | high |
| `critical_microsleep` | `microsleep` | critical |
| `yawn` | `yawning` | low |
| `long_yawn` | `yawning` | medium |
| `drowsy_yawn` | `drowsiness` | high |
| `drowsy` | `drowsiness` | high |
| `yawn_started` | — | UI only |
| `alert_cleared` | — | UI only |

Supporting logic: PERCLOS sliding window, mouth-aspect baseline that separates a
smile or talking from a yawn (rejected spells are kept as tuning evidence),
time-based track expiry so low frame rates don't strand boxes, WebAudio alarm
for microsleep (no asset, works offline).

---

## 5. Shifts, scoring, manager view

- A driver's shift starts automatically; End Shift stops inference, flushes
  events and finalizes.
- `finalize_shift()` is a security-definer function: it computes the report, the
  `driver_daily_stats` aggregate and the audit row in one transaction, so the
  client cannot influence the numbers.
- Score = `100 − Σ weightᵢ × min(1, indicatorᵢ / capᵢ) × 100`, clamped 0–100,
  with weights and caps read from the organization's `scoring_config`. Risk
  bands map to `low / moderate / high / critical`, and every classification
  carries the `factors[]` that produced it.
- Reports are insert-once; drivers have no UPDATE/DELETE path.
- The manager dashboard reads aggregates only, refreshes over realtime with
  toasts and an unread badge, and supports sorting by latest or score plus
  driver / risk / date filters.

---

## 6. Offline

- Service worker caches the app shell in published tabs only; previews
  unregister stale workers so cached code can never mask a fresh build.
- Models live in IndexedDB with resumable segmented downloads, checksum
  verification, per-model deletion and orphan purge.
- Shifts, events and reports are written locally first with a stable
  `clientShiftId`.
- Sync states: `local → pending_sync → syncing → synced | sync_error`. Uploads
  go shift → events → report as idempotent upserts, so a retry can never create
  a second report. A background drainer runs on reconnect and the manager sees
  fleet-wide sync health.

---

## 7. Security posture

RLS plus explicit GRANTs on every public table; roles in a dedicated
`user_roles` table checked through security-definer functions; manager-only
server functions guarded server-side; private storage buckets with owner
checks; expiring, redacted diagnostics share links; audit rows for signup, shift
finalization and manager actions.

---

## 8. Roadmap

See `.lovable/plan/sentryeye-next-future-plan-2026-08-23.md` — deeper
micro-events (distraction, no-driver gaps, evidence thumbnails), offline
hardening (quota awareness, Background Sync), manager intelligence (period
deltas, digests, exports), a third performance pass, and retention/transparency
work.
