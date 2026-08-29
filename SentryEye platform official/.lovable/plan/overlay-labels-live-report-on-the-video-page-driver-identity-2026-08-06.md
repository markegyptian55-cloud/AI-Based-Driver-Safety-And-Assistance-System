# Overlay labels, live report on the video page, driver identity

## 1. Detection labels overlap each other

Confirmed: the overlay always draws the label at the top-left corner of each
box. Two eyes detected side by side sit a few pixels apart, so the two labels
collide and read as one string ("eye_ope eye_open 64%").

Fix in the overlay drawing code:
- Anchor the label to the outer side of each box: a box on the left half of the
  face draws its label right-aligned above-left, a box on the right half draws
  it left-aligned above-right, so the two labels fan outwards instead of
  stacking on top of each other.
- Detect collisions between the already-drawn label rectangles for the current
  frame and nudge the colliding one further outwards (never downwards over the
  eye), so three or more boxes still stay readable.
- Clamp every label to the video content rect so nothing is drawn into the
  letterbox bars or off-canvas.
- Shorten the text to `open 64%` / `closed 64%` / `yawn 64%` and keep the
  monospace pill, which alone removes most of the width pressure.

## 2. "Driver report" opens nothing useful for the current clip

Confirmed causes:
- The button links to `/report/:sessionId`, which only exists for a signed-in
  user whose session was written to the database. For a visitor the button is
  hidden and the report is only rendered inline at the bottom of the page.
- The inline report is gated on being a visitor AND the run being finished, so a
  signed-in user never gets a report on the video page itself.

Fix:
- Show the finished report inline on the video page for **everyone** (visitor or
  signed in) as soon as a run completes, built from the in-memory summary.
- Turn the "Driver report" button into a scroll-to-report action for the current
  clip, with a separate "Open saved report" link (signed-in only) for the
  persisted database version.
- Add a live report card **while the run is in progress**: current safety score,
  fatigue level, PERCLOS, microsleep/blink counters and the running event list,
  so there is always a report view for the current video, not only after it ends.

## 3. Coming back to the video stops the model and inference

Confirmed: the analysis context keeps the clip, the pipeline and detections, but
the inference loop itself is owned by the page component and dies with it on
navigation; the model provider is also disposed when nothing holds it.

Fix:
- Keep the run alive across navigation: move the run handle into the app-level
  analysis context so leaving `/video` no longer tears down the loop, and pin the
  model provider (no dispose) while a run is active.
- On returning to the page, rebind the video element and overlay to the running
  session instead of resetting, and restore playback position.
- If a run genuinely cannot continue (element gone), show an explicit "Resume
  analysis" button that restarts from the current playback position rather than
  silently ending.
- Verify with Playwright: start a run, navigate to History and back, confirm the
  pipeline still reads "Running AI inference" and counters keep increasing.

## 4. Driver ID tracker

There is no driver identity anywhere today: sessions have a nullable
`driver_label` that nothing writes, and reports show "Driver"/"Visitor".

Proposal:
- A **Drivers** table (name, driver code/ID, optional notes) owned by the signed-in
  account, with access limited to its owner.
- A driver picker on the Live, Video and Image pages ("Analysing: driver #D-014
  — Ahmed"), stored on the session so every report, history row and PDF carries
  the driver ID.
- History and Analytics gain a driver filter and a per-driver trend (safety score
  over time, microsleeps per drive).
- Visitors get a local-only driver label, no database record.

## 5. What else is missing for a production-grade system (research-backed)

Ranked, based on how commercial DMS (driver monitoring system) products are
specified:
1. Calibration and confidence gating — per-driver baseline eye aspect and a
   minimum confidence before a frame counts, which removes most false positives.
2. Temporal smoothing — N consecutive frames before a state flips (kills the
   single-frame 37% "eye_closed" flicker).
3. Per-eye pairing — require both eyes closed rather than any box.
4. Head pose / distraction — looking away, head nodding, phone use; the current
   system only sees eyes and yawns.
5. Drive-level verdict — "fit to drive / take a break now", worst 60-second
   window, microsleeps per minute.
6. Escalation policy — repeated alarm, then a persistent siren, then a logged
   critical incident (partially there, needs policy + settings).
7. Annotated video export — burn the boxes into a downloadable clip.
8. Timeline scrubbing — click an event to jump the video to that instant.
9. Offline/PWA + camera on mobile, so the app runs in the vehicle.
10. Data retention & privacy controls — delete-my-data, retention window,
    consent notice; required for anything handling driver footage.
11. Benchmark page — model accuracy, FPS per backend (WebGPU/WASM), so the
    portfolio shows measured numbers.

I would implement 1–3 and 5 first: they change accuracy and trust, which is what
the demo is judged on.

## Technical notes

- `src/components/live/detection-overlay.tsx`: label placement helper that
  returns an anchored, clamped, collision-resolved rect per detection.
- `src/routes/_authenticated/video.tsx`: always-on report section (live +
  final), scroll-to-report button, "Open saved report" link for signed-in users.
- `src/features/session/analysis-session-context.tsx` +
  `use-live-session.ts`: hoist the run handle so it survives unmount; pin the
  provider in `provider-cache` while running.
- Drivers feature: one migration (table, grants, owner-only policies), a driver
  picker component, `driver_id` on `sessions`, plus filters in history and
  analytics.
