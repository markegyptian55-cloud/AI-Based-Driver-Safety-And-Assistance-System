# Fleet Driver Safety Mode

Turn the current single-user monitoring app into a two-role safety platform: drivers run shifts and see only their own history; managers see their organization's fleet, trends, and explainable recommendations. The AI inference engine is untouched — Fleet Mode sits on top of it.

## Scope boundary

Only: shifts, safety events, shift reports, daily aggregates, risk scoring, recommendations, manager dashboard, driver history, offline sync. No fuel/maintenance/dispatch/telematics. No changes to model selection, WebGPU/WASM path, schedulers, or preprocessing.

## Phase 1 — Data model and tenancy

New tables, all carrying `organization_id`, all with GRANTs + RLS:

- `organizations` — name, timezone, scoring config (JSONB weights)
- `org_members` — profile ↔ organization ↔ role (`driver` | `manager`, admin addable later)
- extend existing `drivers` with `organization_id`, `profile_id`, `employee_ref`, `status`
- `shifts` — status (`active`/`ending`/`completed`), started/ended, duration + monitored seconds, model id/version/imgsz/provider/precision, `sync_status`, `client_shift_id` (unique, for idempotent sync)
- `safety_events` — shift, driver, event_type, severity, confidence, started_at, duration, model_version, evidence ref
- `shift_reports` — one row per shift (unique on `shift_id`), full metric set, safety score, risk level, recommendation, factors JSONB, `finalized_at`
- `driver_daily_stats` — one row per (driver, date), updated on finalize
- `manager_notes`
- reuse existing `audit_log`, add `organization_id`

Security-definer helpers: `current_org_id()`, `is_org_manager(org)`, `my_driver_id()`. Policies: drivers read/write only their own rows; managers read all rows in their org; finalized reports are insert-once (no driver UPDATE/DELETE). Partial unique index enforcing one active shift per driver. Indexes on `(organization_id, driver_id)`, `(organization_id, date)`, `(driver_id, date)`, `(shift_id)`, `(organization_id, risk_level)`, `(organization_id, created_at)`.

Bootstrap: a trigger creates a personal organization for a new signup and a `driver` membership + driver row; `markegyptian55@gmail.com` is seeded as manager of the demo organization.

## Phase 2 — Shift lifecycle

`src/features/fleet/shift-lifecycle.ts` + a shift context provider:

- Start Shift: verify auth, refuse if an active shift exists, create the shift with the AI metadata already exposed by the engine (model, version, imgsz, provider, precision), then hand control to the existing live/image pipelines.
- During the shift the existing detection pipeline emits events through a thin adapter that persists only *meaningful* events (state transitions and alerts, debounced) — never per-frame results.
- End Shift: stop inference, flush events, compute metrics, write the report, mark `completed`, refresh aggregates, show the driver a summary.

## Phase 3 — Offline-first sync

`src/features/fleet/offline-queue.ts` backed by IndexedDB:

- Shift + events + report are always written locally first with a `client_shift_id`.
- States: `local` → `pending_sync` → `syncing` → `synced` / `sync_error`.
- On reconnect, upload in dependency order (shift → events → report) through idempotent upserts keyed on `client_shift_id`, so a retry can never duplicate a report.
- A visible sync badge in the driver header shows pending shifts.

## Phase 4 — Scoring, risk, recommendations

`src/features/fleet/safety-score.ts` (pure, unit-tested), weights read from the organization config row, never hardcoded in components:

- Normalized indicators: event rate/hour, drowsiness rate, critical-event density, longest-closure severity, recency-weighted repetition, trend vs previous equal-length period.
- Score 0–100 → `low` / `moderate` / `high` / `critical`.
- Every classification returns a `factors[]` list (label, value, comparison) so the UI always shows *why*.
- Recommendations: Excellent / Monitor / Needs Attention / High Risk / Critical, each rendered with its supporting evidence lines. Never an employment decision.
- Report aggregation is finalized server-side in a security-definer `finalize_shift(shift_id)` function so drivers cannot influence the computed numbers.

## Phase 5 — Driver experience

- `/driver` workspace: big Start Shift / End Shift control, active-shift duration, current alerts, AI status, model — nothing else distracting.
- Live and Image detection reuse the existing pages, now bound to the active shift.
- `/driver/reports` ("My Safety"): 7 / 30 / 90 / 365 filters, totals, drowsiness rate, behavior breakdown, trend chart, shift list → shift report detail.
- Existing `/live`, `/video`, `/image` stay working for signed-out visitor mode with no shift attached.

## Phase 6 — Manager experience

- `/manager`: fleet KPIs (drivers, active shifts, needing attention, high/critical, avg score, total events, monitored hours, drowsiness trend) + recent finalized reports, all read from `driver_daily_stats`, never from raw events.
- `/manager/drivers`: sortable/filterable table — name, score, risk, drowsiness rate, avg alerts/day, critical events, trend arrow, last shift, recommendation.
- `/manager/drivers/:id`: header with current risk/score/latest shift, 7/30/90/365/custom filters, performance + drowsiness + risk-behavior sections, time-series charts (safety score, drowsiness rate, event rate, critical frequency), paginated shift history, risk-explanation panel, manager notes.
- `/manager/reports`, `/manager/events` for org-wide browsing with pagination.
- Route gating by role for UX; RLS is the real boundary.

## Phase 7 — Realtime

Subscribe managers to `shift_reports` and `driver_daily_stats` inserts/updates plus shift start/complete for their organization only, invalidating the relevant queries. No realtime on inference events.

## Phase 8 — Hardening

Verify with tests and manual checks: cross-tenant isolation, driver-vs-driver isolation, finalized-report immutability, duplicate-free retry of an offline shift, dashboard queries hitting aggregates only, audit rows for start/finalize/note actions.

## Technical notes

- Data access goes through `createServerFn` with `requireSupabaseAuth` for anything user-scoped; the manager dashboard reads through authenticated server functions so RLS applies as that user.
- Event categories are derived from the deployed model's label/semantic map rather than hardcoded per screen, so a model change does not require UI edits.
- Period windows are computed in the organization's timezone, not browser-local.
- The inference subsystem (`src/features/inference/*`, capture/scheduling in `src/features/session/*`) is read-only in this work except for the event-emission adapter.

## Delivery

Phases 1–3 land first (nothing is visible to a manager until real shifts exist), then 4–6, then realtime and hardening. Each phase ends with the app in a working state.
