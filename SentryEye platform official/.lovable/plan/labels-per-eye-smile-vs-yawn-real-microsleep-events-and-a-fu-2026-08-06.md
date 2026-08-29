# Labels per eye, smile-vs-yawn, real microsleep events, and a full handover report

## 1. Labels: strictly per-eye, never crossing

Today a label is anchored to the "outer" side and, when two pills collide, it is
pushed sideways with a leader line — which is what makes the two eye labels look
connected.

New rule, purely in the overlay drawing code:

- Split detections by their box centre relative to the face midpoint (mean of all
  eye box centres, falling back to the picture centre).
- Left-side box: pill is right-aligned to the box's left edge and drawn above it.
  Right-side box: pill is left-aligned to the box's right edge, above it.
- Each label is confined to its own half of the picture, so a left label can never
  slide into the right eye's area (and vice versa). If space is tight, the pill
  shrinks (drops the `%`) instead of moving sideways.
- Remove the leader lines entirely — with a fixed per-eye anchor they are noise.
- Stacking only happens vertically within the same half (one pill per row) and is
  clamped inside the video content rect.

## 2. Telling a smile apart from a yawn

The model has a single "yawn" class and fires it on wide smiles. Fix without
retraining, using geometry + time:

- **Mouth aspect ratio (MAR)**: from the detected mouth box, `h / w`. An open
  yawning mouth is tall (ratio high); a smile is wide and short (ratio low).
  Below a configurable ratio the detection is re-labelled `smile` and never counts
  as a yawn.
- **Confidence floor**: a separate, higher confidence threshold for yawn than for
  eyes, so weak boxes do not create yawn events.
- **Temporal gating (the "yawn spell", mirroring microsleep)**: a real yawn stays
  open. A candidate must hold for a minimum duration to become a yawn event:
  - held ≥ ~400 ms → `yawn_started` (info)
  - held ≥ ~1200 ms → `yawn` confirmed (warn), counted once per spell
  - held ≥ ~2500 ms → `long_yawn` (danger-leaning), a strong fatigue signal
  - shorter than the first threshold → discarded as a smile/talking flicker
- **Combined danger rule (what you asked for)**: a confirmed yawn that overlaps
  with, or is immediately followed by, an eye-closure spell escalates to a
  `drowsy_yawn` critical event and triggers the wake-up alarm — yawning alone is a
  warning, yawning with closed eyes is danger.
- Every threshold above lives in the scoring config (and in Settings), never
  hardcoded, and the overlay shows `smile` vs `yawn` distinctly so you can see the
  classifier's decision live.

## 3. Real microsleep events, visible and verifiable

The counters already exist; the events are not surfaced as a list.

- Keep a live in-memory event log for the current run: every
  `eye_closed_sustained`, `microsleep`, `critical_microsleep`, `yawn`, `long_yawn`,
  `drowsy_yawn`, `drowsy`, `alert_cleared` with video timestamp, duration, frame
  count and confidence.
- **Live event timeline** on the Video and Live pages: a scrolling rail under the
  risk panel showing `00:14.2 · MICROSLEEP · 0.8s · 3 frames`, colour-coded by
  severity, newest highlighted.
- **Threshold legend** rendered next to it (blink < 500 ms, microsleep ≥ 500 ms,
  critical ≥ 1500 ms, yawn ≥ 1200 ms) so the numbers are auditable while watching.
- Events persist into the session so the saved report timeline and the PDF show
  the same list; the report gains a "Microsleep episodes" table (start, duration,
  peak confidence).
- Clicking a live event seeks the video to that instant, which is how you verify
  accuracy frame by frame.

## 4. Full handover report

A new `docs/SYSTEM-REPORT.md` (also linked from the app's model/info page) that
you can lift into your other full-stack site:

- Every feature built, phase by phase, and the request that drove it.
- Architecture: inference provider abstraction, worker, pre/post-processing,
  scoring layer, session ports (cloud vs visitor), reporting/PDF.
- The drowsiness maths: PERCLOS window, closure state machine, microsleep and
  yawn thresholds, safety score and fatigue level formulas.
- Database schema (tables, columns, access rules) and the auth/role model.
- File-by-file map of what to copy, and what has to be re-implemented against a
  different backend.

## 5. Returning to the video page freezes the boxes (still broken)

Symptom you are seeing: after navigating away and back, the clip plays but the
boxes sit frozen and nothing updates — the run is dead while the UI still shows
the last detections and "Idle".

What actually happens: the inference loop is torn down when the page unmounts,
the last detection array stays in the shared ref (so stale boxes keep painting),
and the automatic resume only fires when the media reports ready in time —
otherwise the page stays idle with no visible sign that inference stopped.

Fix:
- Clear the detections ref and stop the overlay the moment a run is torn down,
  so stale boxes can never be mistaken for live ones.
- Make the auto-resume robust: wait for the video to actually be seekable/ready
  (not a one-shot check), then restart inference from the current playback
  position; retry once before giving up.
- Make the state honest: while a run is interrupted, the status reads
  "Analysis paused — resume" instead of "Idle", the risk panel is dimmed, and the
  "Resume analysis" button is always visible in that state (not only when one
  flag happens to be set).
- Also pause the video itself when the run is interrupted, so the clip and the
  analysis can't drift apart.
- Verify with Playwright: start a run, navigate to History and back, confirm
  either inference resumes automatically with counters increasing, or the page
  clearly shows the paused state and one click resumes it.

## Technical notes


- `src/components/live/detection-overlay.tsx`: half-space label anchoring, no
  leader lines, vertical-only stacking.
- `src/features/drowsiness/` — new `mouth-state.ts` (MAR + smile/yawn decision),
  yawn spell state machine in `event-aggregator.ts`, new event kinds and thresholds
  in `types.ts`, new config defaults in `use-user-settings.ts`.
- `src/features/session/use-live-session.ts`: expose the full event log, not just
  recent events; new `LiveEventTimeline` component reused by `/video` and `/live`.
- Persisting the new event kinds needs a migration to widen the
  `detection_events` / timeline type mapping.
- `src/routes/_authenticated/video.tsx` + `src/features/session/use-live-session.ts`
  + `analysis-session-context.tsx`: clear the detections ref on teardown, ready-state
  polling for resume, explicit paused state driving the button and status text.

