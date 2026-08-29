# Mobile-grade live detection: presets, smoothing, debug overlay, preflight, diagnostics

Five additions that make live webcam detection trustworthy on phones, where low light, low frame rate, and weaker backends currently produce jittery or missing eye boxes.

## 1. Mobile inference presets

A named preset that is auto-selected on phones/tablets (and overridable in Settings: Auto / Desktop / Mobile low-light / Force desktop):

- Lower detection confidence floor (mobile webcams under-score in dim light), compensated by the smoothing layer below so the extra weak boxes can't flicker on screen.
- Longer eye-closure and yawn confirmation windows expressed in milliseconds, not frames, so a 10 fps phone stream and a 30 fps laptop stream reach the same microsleep decision at the same real-world moment.
- Slightly relaxed NMS overlap so two nearby eyes are not merged into one box at small face sizes.
- Auto-gain hint: when the incoming frame is very dark, the preprocessor brightens the frame before inference instead of feeding a near-black image to the model.

## 2. Temporal smoothing (anti-jitter)

A new tracker sits between raw model output and everything downstream (overlay, aggregator, recorder):

- Each detection is matched to the previous frame's track by overlap and class, then the box is exponentially smoothed, so boxes glide instead of vibrating.
- A track survives a configurable number of missed frames before disappearing, so a single bad frame no longer blanks the eyes.
- A new track must be seen for a couple of consecutive frames before it is shown, killing one-frame phantom boxes.
- Class label is smoothed too: eye open/closed only flips after the new state wins a short run of frames, so the label stops strobing between "open" and "closed".
- Two confidence levels: a low intake threshold for tracking continuity, a higher display/scoring threshold for what is drawn and counted.

Eye-closure counting reads the smoothed stream, so microsleep timing gets more stable rather than more noisy.

## 3. Live debug overlay

A toggleable panel over the video (off by default, remembered per device; also reachable from the live page header):

- Source FPS, processed FPS, inference FPS, end-to-end and provider latency
- Dropped frames (skipped while inference was busy) and rejected frames (failed the sanity guard)
- Active provider and execution backend, plus the model name/version
- Current top detection confidence per class and active track count
- Live preset in use and current frame brightness

Compact, monospaced, and readable on a small screen.

## 4. Mobile preflight checklist

Before the first live run on a constrained device, a short guided check runs against the camera preview and blocks Start until all pass (with a "Start anyway" escape hatch):

- Camera permission granted and a stream is flowing
- Enough light — measured average frame brightness above a floor
- Face large enough / close enough — the detected face-region boxes cover a minimum share of the frame
- Face detected steadily for a couple of seconds

Each item shows pass/fail with a one-line fix ("Move closer", "Turn on a light", "Center your face"). It re-runs on demand and auto-passes once satisfied.

## 5. Downloadable session diagnostics

A diagnostics recorder collects a rolling, bounded log during a live session: startup stages, backend self-test results, preset chosen, device/browser capabilities, periodic performance samples, rejected-frame reasons, and detection events — with no video frames or personal data.

From the live page and the session report: **Download diagnostics** (JSON file) and, where the browser supports it, **Share** via the native share sheet. Filename carries the session id and timestamp.

## Technical notes

- New: `src/features/inference/mobile-presets.ts` (pure preset table + device selection), `src/features/inference/detection-tracker.ts` (pure IoU matching, EMA smoothing, hysteresis), `src/features/session/diagnostics-log.ts` (bounded ring buffer + JSON export), `src/features/session/preflight.ts` (pure pass/fail rules over brightness and box coverage), plus `src/components/live/debug-overlay.tsx` and `src/components/live/preflight-checklist.tsx`.
- `use-live-session.ts` runs raw detections through the tracker before writing `detectionsRef` and feeding the aggregator, and feeds every stage/result into the diagnostics log.
- Brightness is sampled in the worker during preprocessing (already has the frame on a canvas) and returned in result metadata — no extra per-frame canvas work on the main thread.
- Preset values flow through the existing `ScoringConfig` / `ProviderConfig` paths; no schema or backend changes, and preset + debug-overlay preferences persist in local storage next to the existing engine preference.
- Unit tests for the tracker (jitter reduction, gap tolerance, label hysteresis), the preset selector, and the preflight rules.
