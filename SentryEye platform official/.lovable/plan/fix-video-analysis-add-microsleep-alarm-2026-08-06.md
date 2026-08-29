# Fix video analysis + add microsleep alarm

## What is actually broken

The console from your session shows the real failure, twice:

```text
[video] load sequence did not complete — Error: Media load timed out
```

The clip was uploaded and converted successfully (`15-MaleGlasses.converted.mp4 · 3.3 MB · auto-converted`), but the `<video>` element never reached `loadedmetadata` within 30s, so:

- `mediaReady` stays `false` → the Run button stays stuck on "Preparing video…"
- auto-start never fires → pipeline stage stays `idle`, no inference, no detections

Two timeouts in a row point at the load path, not at the model: after conversion the page calls `loadIntoVideo()` on the **current** element, and then React remounts a **new** element (it is keyed by the object URL) and the restore effect loads the same blob URL again. Two elements attach to the same blob URL around the same time, and the surviving element never gets metadata. The exact culprit between "double load race" and "the generated MP4 itself is not decodable by this browser" is not yet proven, so step 1 of the work is a reproduction that prints the media diagnostics for the converted blob.

## Plan

### 1. Reproduce and confirm (first, before any fix)
Drive the page in a headless browser with a converted clip, capture `readyState`, `networkState`, `video.error`, and whether the same blob URL plays in a standalone element. This tells us definitively whether the blob is bad or the load sequence is racing.

### 2. Make the load path single-owner and non-silent
- Load the media from exactly one place: a single effect keyed on `(element, objectUrl)`. Remove the eager `loadIntoVideo()` call inside `runTranscode` — the keyed remount already triggers the loader, so the pre-remount call is dead work that fights the real one.
- Give every load an `AbortController`; a superseded load aborts instead of running its own 30s timer to a misleading timeout.
- If the load does fail, surface it in the UI (error card + toast + pipeline stage `error`) instead of only `console.warn`. Right now a failed load looks identical to "still preparing", which is why this looked like a hang.
- Add a "Retry load" and "Play without analysis" escape hatch when a load times out.

### 3. Harden the converted output (if step 1 shows the blob is at fault)
- Run a decode self-test on the ffmpeg output before it is handed to the page (attach to an offscreen element, wait for metadata, check dimensions). If it fails, retry the conversion with a stricter profile (`-profile:v baseline -level 3.1`, audio dropped) and report clearly if that also fails.
- Cap resolution for very large clips (`scale=-2:720`) so conversion and inference stay fast.

## Microsleep detection + wake-up alarm (the feature you asked for)

Extend `EventAggregator` (pure logic, already testable) with a closure-duration state machine:

| Closure duration | Level | Response |
| --- | --- | --- |
| >= 0.4s (existing threshold) | eye_closed_sustained | warn badge |
| >= 0.5s | microsleep | red banner + short alarm beep |
| >= 1.5s | critical microsleep | continuous alarm until eyes open |

What gets tracked and shown:
- Frames counted per closure spell and total closed frames in the session (`closedFrames / analysedFrames`, exact numbers, not just the PERCLOS percentage).
- Longest single closure, number of microsleep events, and blink rate per minute — all persisted to the session summary and rendered in the driver report, timeline and PDF.
- The safety score gains a microsleep penalty term so a driver with one 2s closure cannot score "safe".

Alarm implementation:
- WebAudio oscillator (no asset download, no autoplay-blocked `<audio>` after a user gesture) with escalating pattern, plus optional spoken "Wake up" via speech synthesis.
- A mute/volume control in Settings, and a persisted user preference for the microsleep threshold (default 0.5s).
- Visual fallback: full-screen red flash + vibration on mobile (`navigator.vibrate`) for muted contexts.

## Recommendations to reach production level

1. **Head pose / gaze fallback** — eye-closed detection alone fails when the driver looks away or the face leaves frame. Add a "no face / driver not visible" state so the system does not silently report "safe" on an empty frame.
2. **Calibration pass** — first 5 seconds of a session establish a baseline (open-eye confidence, face size) so thresholds adapt per driver and camera.
3. **Temporal smoothing** — a 3-of-5 frame vote before flipping the closed/open state removes single-frame false positives from motion blur.
4. **Performance budget** — expose an inference FPS floor; if processed FPS drops below ~8, warn that fatigue timing is unreliable and offer a lower input resolution.
5. **Offline-first** — cache the ONNX weights in the Cache API so a returning driver starts instantly and works without network.
6. **Evidence capture** — store a JPEG snapshot for each critical event so the report shows what triggered the alarm.
7. **Session integrity** — record model id/version, thresholds and device info with every session so reports remain reproducible after the model changes.
8. **Tests** — unit tests for the microsleep state machine and safety scoring, plus one end-to-end Playwright test that uploads a fixture clip and asserts a completed session; this is what would have caught the current bug.
9. **Fleet view (bigger add-on)** — multi-driver dashboard with per-driver trends and a weekly fatigue leaderboard, plus email/webhook alerts on critical events.

## Technical notes

- Files touched by the fix: `src/routes/_authenticated/video.tsx` (single load owner, abortable loads, visible errors), `src/features/session/media-element-lifecycle.ts` (abort support, richer failure messages), `src/features/session/video-transcoder.ts` (decode self-test + fallback profile).
- Files touched by the feature: `src/features/drowsiness/event-aggregator.ts`, `src/features/drowsiness/types.ts`, `src/features/drowsiness/safety-score.ts`, a new `src/features/drowsiness/alarm.ts`, `src/components/live/risk-panel.tsx`, report/PDF renderers, and a migration adding the new per-session counters.
- Alarm and thresholds stay in user settings; scoring stays pure and deterministic so a stored session always reproduces the same report.
