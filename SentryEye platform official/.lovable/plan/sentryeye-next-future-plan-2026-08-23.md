# SentryEye — next future plan

A staged roadmap built on what already exists (on-device YOLO26n inference, micro-event aggregation, offline-first shifts, manager fleet dashboard). Nothing here re-architects the inference pipeline.

## Stage 1 — Documented product report in the app

Add a `/docs` route (and refresh `docs/SYSTEM-REPORT.md`) containing the full feature/logic report: engine ladder, micro-event catalogue with thresholds, scoring formula, offline sync state machine, role matrix. Generated from the same constants the code uses, so it can't drift.

## Stage 2 — Micro-event depth

- Add `distraction` micro-events (head-pose proxy from box geometry: face box off-centre or absent for N ms) and `no_driver` gaps, so a shift distinguishes "not monitored" from "safe".
- Per-event evidence thumbnails stored locally, optionally uploaded to the private `media` bucket on sync, linked from the shift report.
- Event timeline scrubber on the shift report (replay the spells, not the video).

## Stage 3 — Offline hardening

- Sync conflict/telemetry surface: per-shift retry count, last error, manual retry from the driver header.
- Quota awareness: warn before IndexedDB pressure evicts a queued shift; oldest-synced-first eviction.
- Background Sync API registration where supported, so shifts upload even after the tab closes.

## Stage 4 — Manager intelligence

- Trend deltas vs previous equal period on every KPI, with the factor that moved most.
- Fleet-level weekly digest (server function, optional email) summarising risk movement and drivers needing attention.
- CSV/PDF export of any filtered manager view.

## Stage 5 — Performance pass 3

- Persistent GPU input tensors + double-buffered output reads on WebGPU.
- Optional 320 imgsz fast lane for very weak Android as a runtime step-down, without adding a third registry model.
- Continuous on-device benchmark that records p95 latency per device profile and pre-selects the engine on next boot.

## Stage 6 — Trust and compliance

- Retention policy per organization (auto-purge raw events after N days, keep aggregates).
- Driver-facing transparency page: exactly what is recorded, what leaves the device, what the manager sees.
- Expand audit coverage to note edits, filter exports, and role changes.

## Technical notes

- Micro-event additions go through `features/drowsiness/event-aggregator.ts` and `features/fleet/event-mapping.ts` only; UI reads labels from the mapping table.
- Any new persisted table follows the existing pattern: CREATE TABLE → GRANT → ENABLE RLS → policies, with `organization_id` and manager/driver scoping.
- Scoring changes stay in the organization `scoring_config` JSONB and the server-side `finalize_shift()`; never hardcoded in components.
