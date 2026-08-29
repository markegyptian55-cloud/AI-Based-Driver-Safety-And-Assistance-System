# Fix yawn detection + the cramped text block after analysis

Two separate problems, one plan.

## Problem 1 — eyes are detected, yawns are not

Confirmed from the code, not guessed: a yawn is only counted when **four** gates pass at the same time, and any one of them can silently kill it.

1. `readMouth` (`mouth-state.ts`) throws the mouth box away unless its height/width ratio is at least **0.55** and its confidence is at least **0.45**. A real yawn filmed from a dashcam angle, or through the 320 px mobile export, often comes out as a box wider than it is tall — so it is labelled "smile" and never reaches the counter.
2. The confidence floor for mouth (0.45) is higher than the one for eyes, so the mouth class is held to a stricter bar than the class that already works.
3. The aggregator requires the mouth to be open continuously for **1200 ms** to count a yawn — but a *single* frame where the mouth box is missing resets the spell to zero. At 2-6 analysed FPS on a phone one dropped frame is enough to restart the clock forever, so the 1200 ms is never reached.
4. The tracker's warm-up and label-flip rules delay the mouth track appearing at all, eating into the same window.

### What to change

- **Make the geometry gate adaptive instead of a hard cut.** Keep MAR as a signal but stop using it as a veto: a mouth box passes as a yawn candidate when MAR is above a lower floor (≈0.38) *or* when it is clearly taller than the driver's own baseline mouth (running median of recent mouth boxes). Wide-but-flat mouths still classify as smile.
- **Lower the mouth confidence floor** to match the eye floor, and let the time gate (below) do the false-positive rejection instead of the confidence gate.
- **Add a hold-through-gap grace to the yawn spell**: the spell survives short dropouts (up to ~400 ms of missing mouth boxes) instead of resetting on the first missing frame, and accumulates held-open time from the frames actually seen. This is the single change most likely to make yawns appear on phone-rate video.
- **Scale the confirm window to the analysed frame rate**: require both a duration *and* a minimum number of confirming frames, so 1200 ms at 3 FPS is not an impossible bar.
- **Expose the evidence in the debug overlay** — top mouth confidence, current MAR, baseline MAR, held-open ms and why the last spell was rejected (low conf / low aspect / gap). Without this we are tuning blind on the next report.

### Verification

- Re-run the existing `15-MaleGlasses.mp4` clip through the video page and confirm the yawn counters move and yawn rows appear in the event timeline.
- Existing unit tests for the aggregator and mouth state get new cases: a yawn interrupted by one missing frame must still be counted; a wide flat smile must still be rejected.

## Problem 2 — the description column collapses into a tall narrow strip

On the video page the header is a two-column row: the title + description on the left, and the action buttons on the right marked `shrink-0`. After a run finishes, three more buttons appear (Download MP4, Driver report, Open saved report). The button row cannot shrink, so it squeezes the paragraph down to a ~150 px column that runs ten lines tall — exactly what the screenshot shows.

### What to change

- Stop the button row from starving the text: let the actions wrap to their own line on narrower widths instead of pinning the paragraph to a sliver.
- Shorten the standing description to one line and keep the detail out of the header.
- Group the post-run actions (Download MP4, Driver report, Open saved report, New analysis) into a single compact results bar that appears under the header once a run completes, rather than growing the header.
- Apply the same header treatment to the live page so the two pages stay consistent.

No detection logic is touched by problem 2 — it is layout only.

## Technical notes

Files in scope:

- `src/features/drowsiness/mouth-state.ts` — adaptive MAR, baseline tracking, rejection reason.
- `src/features/drowsiness/event-aggregator.ts` — gap-tolerant yawn spell, frame-count confirmation, rejection telemetry.
- `src/hooks/use-user-settings.ts` — `CLIENT_DEFAULTS` threshold values.
- `src/components/live/debug-overlay.tsx` — mouth diagnostics readout.
- `src/routes/_authenticated/video.tsx`, `src/routes/_authenticated/live.tsx` — header/actions layout.
- Tests: `src/features/drowsiness/*` unit tests extended.
