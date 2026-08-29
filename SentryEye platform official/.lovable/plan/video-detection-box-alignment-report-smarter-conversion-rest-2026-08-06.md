# Video detection: box alignment, report, smarter conversion, restart, microsleep

## 1. Boxes drawn next to the eye instead of on it

Confirmed cause. The video is displayed with letterboxing (black bars left/right, visible in your screenshots), but the overlay maps detection boxes onto the **whole video element**, including those bars. Every box is therefore stretched and pushed sideways.

Fix: the overlay computes the real picture rectangle from the video's intrinsic size versus its displayed box (the same math the browser uses for `object-contain`) and draws inside that rectangle only. Boxes then sit exactly on the eyes at any window size, for both landscape and portrait clips.

## 2. No report when the video finishes

Confirmed cause. The report link is only produced for signed-in users; in visitor mode the session is never persisted, so the page has nothing to link to — the run just ends silently.

Fix:
- Visitor mode: render the full driver report **inline on the page** when the run finishes (safety score, fatigue level, PERCLOS, eye-closure and microsleep counters, yawns, event timeline) from the in-memory session summary, using the same report component signed-in users get, plus the existing PDF export.
- Signed-in: after the run ends, show a clear completion card with the score and a prominent "Open full report" button instead of only a small link.
- Both: when analysis reaches the end of the clip, scroll/focus the results card so the outcome is impossible to miss.

## 3. Don't convert a video that is already playable

Today conversion is skipped when the browser reports it can play the file, but the decision is invisible and the download button appears in cases where nothing was produced.

Changes:
- Skip conversion whenever the browser can decode the file (already the rule) and show it explicitly in the pipeline: "Conversion skipped — browser plays this format natively".
- Show the download button **only when a converted file actually exists**, labelled with the real output format ("Download MP4" or "Download WebM" for the fallback path), plus the output size.
- For an already-playable original, offer no conversion download (nothing was converted) — the user already has the file.

## 4. "New analysis" replays the video without running detection

Not yet root-caused; the reset path clears the media element, the analysis context and the auto-start flag, so something in that sequence leaves the pipeline unarmed. First step is a Playwright reproduction of upload → finish → new analysis → upload, capturing the pipeline stage and the auto-start flags at each step, then fixing the specific flag that stays stale. Verification is the same script: the second run must reach "Running AI inference" and produce a report.

## 5. Microsleep detection

The detection engine and wake-up alarm were added in the last change but are not yet visible in your screenshots (they predate it). This plan makes it visible and trustworthy:
- Microsleep panel on the video and live pages: current closure duration, microsleep count (>= 0.5 s), critical count (>= 1.5 s), closed frames vs analysed frames, longest closure, blink count.
- Full-frame red flash + audible alarm while a microsleep is active, with a mute toggle.
- Microsleep markers on the session timeline and a microsleep section in the driver report and the PDF.
- Thresholds (0.5 s / 1.5 s) become editable in Settings instead of fixed constants.

## Recommendations (what I would add next, in priority order)

1. **Persist microsleep metrics** to the session record so history, analytics and the PDF can compare runs over time (needs new columns on the sessions table).
2. **Temporal smoothing** — require N consecutive frames of the same state before switching, which removes single-frame flicker like the 37 % "eye_closed" in your third screenshot appearing next to a 61 % "eye_open".
3. **Per-eye tracking** — pair left/right eye boxes and require both closed, so a partly occluded face does not trigger a false microsleep.
4. **Confidence gating** — ignore detections below a configurable confidence for scoring (they can still be drawn), which cuts most false alerts.
5. **Timeline scrubbing** — click an event in the report timeline to jump the video to that moment for verification.
6. **Annotated video export** — render the boxes into the downloaded video so the clip itself shows the detections (ffmpeg is already in the app).
7. **Analytics on drowsiness patterns** — microsleeps per minute over time, worst 60-second window, and a "fit to drive" verdict per session.

## Technical notes

- `src/components/live/detection-overlay.tsx`: derive the content rect from `videoWidth`/`videoHeight` versus `clientWidth`/`clientHeight`; scale and offset all boxes and labels by it; recompute on resize and on `loadedmetadata`.
- `src/routes/_authenticated/video.tsx`: inline report card driven by `state.lastSummary` for guests; gate the download button on `converted === true` and on the real blob MIME type; explicit "skipped" conversion stage.
- `src/components/report/driver-report-view.tsx`: accept an in-memory summary in addition to a persisted session id.
- Restart bug: reproduce first with Playwright under `/tmp/browser/`, then fix the stale flag in the reset path.
- Settings: add microsleep and critical-microsleep thresholds to user settings (one migration) and read them in the scoring config.
