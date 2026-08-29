# Shift auto-end, manager analytics, yawn accuracy, login video, new logo

## 1. Shift ends itself when the driver leaves

- Sign-out becomes a shift-safe action: if a shift is active, finalize it first (same path as the End shift button), then clear the session. The driver gets the report toast before landing on the sign-in page.
- Same finalization on tab close/refresh (`pagehide`), so a closed browser does not leave a shift hanging.
- Offline behaviour: the shift is finalized locally against the offline queue (report computed on-device, marked `pending_sync`) — nothing is lost when there is no network.
- Reconnect: the existing background drainer keeps pushing pending shifts, and we add a push attempt on the browser `online` event and on the next sign-in, so the manager dashboard receives the report as soon as the driver is back online.

## 2. Manager account no longer counted as a driver

The reserved manager account (`markegyptian55@gmail.com`) currently has a driver record, so it appears inside driver lists, charts and the audit feed.

- Filter the manager's own driver row out of the manager dashboard: driver list, summaries, all charts, "drivers needing attention" and the reports feed.
- Audit page: hide/flag the manager's own rows behind a "show my actions" toggle instead of mixing them into driver activity.
- Fleet KPIs (drivers monitored, fleet score) recompute from the filtered set.

## 3. Manager dashboard: 8 charts instead of 2

Replace the two current charts (alerts+score line, lowest scores bar) with a grid built from `driver_daily_stats` and `shift_reports`:

1. Fleet safety score trend (daily, with period comparison)
2. Event mix over time (drowsiness / eyes closed / yawning / phone) — stacked area
3. Top 5 safest drivers — horizontal bar
4. Top 5 highest-risk drivers — horizontal bar
5. Risk-level distribution across the fleet — donut
6. Alerts per monitored hour, by driver — bar (normalises long vs short shifts)
7. Critical events by hour of day — bar (fatigue windows)
8. Monitored hours vs completed shifts per day — combo bar+line

Each chart has an empty state and respects the existing period tabs and filters.

## 4. Yawn detection accuracy and frame rate

Diagnosis first — the plan does not assume a cause yet. Measured yawn recall dropped versus an earlier check, and the candidates are: the yawn confidence floor now derived from the live preset, cross-class NMS interaction, or the temporal yawn aggregation window. Step one is to instrument, then fix:

- Run the existing yawn probe counters (raw / passed-conf / suppressed / after-NMS) on a recorded clip and record where the yawn boxes are being lost.
- Fix only the stage the probe implicates — likely candidates are the yawn confidence floor and the mouth-state hold window, tuned so yawn recall recovers without stacking boxes on the eyes.
- Verify with the same clip before/after and report the measured yawn hit-rate.

Frame rate: raise sustained FPS by tightening the live/video scheduler (skip redundant preprocess when the frame is unchanged, keep the pipeline depth full) — no pipeline re-architecture, and no NMS IoU changes.

## 5. Login page product video

- Add the uploaded clip as a CDN asset and place it in the empty area of the sign-in page (desktop side panel, below the form on mobile).
- Autoplay, loop, muted by default, `playsInline`; a single sound toggle button unmutes/mutes. Poster frame while loading, and it does not block sign-in interaction.

## 6. New ADAS logo

- Replace the current eye icon + "SentryEye" wordmark in the sidebar/header and the landing page with the uploaded ADAS logo.
- Set the app favicon from a square copy of the same mark.

## Technical notes

- Sign-out finalization runs through the existing `ShiftProvider.endShift()` so the local report builder and `finalize_shift()` RPC stay the single source of truth — no duplicate report paths.
- Manager exclusion is a UI/read-layer filter on top of RLS; database policies are unchanged.
- New charts reuse `driver_daily_stats` aggregation already loaded by the dashboard; no new tables or migrations.
