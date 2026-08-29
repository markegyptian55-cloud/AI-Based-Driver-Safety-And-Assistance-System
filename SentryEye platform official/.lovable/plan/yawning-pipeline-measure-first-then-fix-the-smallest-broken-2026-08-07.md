# Yawning pipeline: measure first, then fix the smallest broken layer

Scope is the yawn path only. Eyes (class 0/1), the model, input resolution, NMS behaviour for eyes, camera and PERCLOS are untouched.

## What the code already proves (verified, not guessed)

- Class mapping is correct end to end: the active registry rows (320/416/640 exports) all carry `labels {0: closed_eye, 1: open_eye, 2: yawning}` and `semantic_map {yawning: yawn}`. `postprocess.ts` resolves label → semantic with no special-casing, so class 2 is not renamed or dropped by mapping.
- There is exactly **one global confidence gate** — `cfg.confThreshold` (0.35, from `postprocess_config`; the mobile "recovery" preset uses 0.22). Class 2 is filtered by the same number as the eyes, before the app can see it. There is currently **no per-class threshold**.
- Class-aware NMS runs per class, then a cross-class dedupe drops any box overlapping a kept box by IoU > 0.65. A mouth box rarely overlaps an eye that much, but this is the one place class 2 could silently vanish, so the diagnostic will measure it rather than assume.
- After NMS, `readMouth` applies a second, app-level gate: aspect floor 0.38 + confidence floor 0.35 + a learned baseline. Then the aggregator requires held ≥ 1200 ms and ≥ 2 confirming frames.
- No face-landmark library exists anywhere in the project.

So a class-2 detection must survive **four** gates today, and nothing currently records where it dies. That is the first thing to fix.

## Step 1 — Class-2 instrumentation (no behaviour change)

Add a yawn probe that taps the pipeline at four points and counts, per frame:

```text
raw candidates (pre-threshold)  -> conf histogram for class 2
survived confThreshold          -> count + max conf
survived NMS / cross-class      -> count + suppressed-by reason
reached readMouth               -> aspect, baseline, verdict
reached the state machine       -> state + rejection reason
```

To see below-threshold class 2 the probe needs the raw scores, so postprocess gains an optional `probe` callback that reports the best class-2 score for the frame **before** the threshold branch. When no probe is attached the code path is identical to today. The probe is off unless debug mode is on, and it aggregates in-memory (no per-frame console spam; a rolling summary plus an optional verbose `[YAWN DEBUG]` line).

Deliverable of this step is a measurement, reported back to you:
- does class 2 appear at all in real yawning footage,
- its confidence distribution,
- which gate consumes it.

If class 2 never appears above ~0.1 on clear yawning frames, the report will say **"model-level yawning detection is insufficient"** and list what retraining would need (class balance, yawn sample count, hard negatives on smiles/talking) — no software fake-fix, no model change.

## Step 2 — Class-specific sensitivity (only if the data justifies it)

If the measurement shows real yawning frames sitting between, say, 0.15 and 0.35:

- Add `yawnCandidateConf` as a **separate, lower** threshold applied to class 2 only, inside postprocess. The eye classes keep the existing `confThreshold` byte for byte.
- Candidate boxes carry a `candidate: true` marker so downstream code knows they are weaker evidence.
- The confirmed-event bar stays higher (`yawnEventConf`) and is reached through temporal evidence, not by lowering anything globally.
- Exempt class 2 from cross-class dedupe against eye classes if the probe shows suppression there.

## Step 3 — Explicit yawn state machine

Replace the scattered booleans in `event-aggregator.ts` with a single `YawnStateMachine` module:

```text
IDLE -> CANDIDATE -> ACTIVE -> END -> COOLDOWN -> IDLE
             \-> MICRO_YAWN -> COOLDOWN
             \-> REJECTED (reason)
```

Rules:
- Candidate opens on the first yawn-shaped class-2 frame; short dropouts are bridged by the existing gap grace.
- `normal_yawn` requires min duration, min consecutive frames, and stable confidence; `micro_yawn` requires short but continuous duration with **strong** confidence and a clear open → sustained → close shape.
- A micro-yawn that keeps going is **upgraded in place** to a normal yawn — the counter increments once, and the already-emitted micro event is superseded, never added to it.
- Cooldown after a confirmed event prevents one physical yawn producing many.
- Every rejection stores a reason (`too_short`, `no_continuity`, `low_conf`, `smile_geometry`, `cooldown`).

All numbers live in config (`YAWN_MIN_DURATION_MS`, `YAWN_MAX_DURATION_MS`, `YAWN_MIN_CONSECUTIVE_FRAMES`, `YAWN_CANDIDATE_CONF`, `YAWN_EVENT_CONF`, `YAWN_COOLDOWN_MS`), defaulted from the measurement in step 1 and overridable per user in settings. They are presented as tuned-to-your-footage, not universal.

## Step 4 — Smile / laugh rejection without a second model

YOLO class 2 stays the primary signal. Secondary validation uses geometry already available from the box, normalised so camera distance does not matter:

- `normalisedOpening = mouthHeight / faceHeight`, where face height is estimated from the eye-box geometry of the same frame (inter-eye distance and eye box size), falling back to the driver's own rolling baseline when eyes are missing. No raw pixel thresholds.
- Yawn evidence: vertical growth, sustained plateau, then decay. Smile evidence: horizontal widening with little vertical growth and a short plateau.
- The trajectory (rise → hold → fall) is scored across the candidate window rather than per frame, which is what actually separates a laugh from a yawn.

Face landmarks are **not** added in this pass. If step 1 shows geometry alone cannot separate smile from yawn, a lightweight landmark check running at a reduced rate (a few Hz, off the inference path, optional and disable-able) is proposed as a follow-up with a measured FPS cost — never as a YOLO replacement.

## Step 5 — Counters, timeline and UI

- `YAWNS/MIN` = confirmed yawn events in the rolling minute, never class-2 frames. Verified by test.
- Recent events show one row per physical yawn: `yawn 74%` / `micro_yawn 81%`.
- A dedicated **yawn timeline and summary** next to the eye timeline: each candidate with start/end, duration, peak confidence, outcome (confirmed / micro / rejected) and rejection reason, for both live and uploaded video.
- Debug panel gains the live yawn readout: YOLO conf, normalised opening, candidate duration, state, decision, reason.

## Step 6 — Per-driver yawn calibration

Extend the existing calibration path (which already exists for eyes and syncs to the user's account) with a mouth phase: the first few seconds of footage learn the resting mouth aspect and normalised opening, and scale the candidate/event thresholds to that driver. Stored alongside the current calibration profile, applied to both live and uploaded runs.

## Step 7 — Shareable yawn-focused driver report

Extend the existing driver report with a yawn section: confirmed yawns, micro-yawns, rejected candidates by reason, a confusion-matrix-style table against whatever ground truth the run provides, and the top failure frames (with lighting and distance context). Generated from the session's stored yawn timeline, shareable via the existing share-link mechanism.

## Step 8 — Validation on real footage

Run the pipeline over: real yawns (short and long), smiling, laughing, talking, non-yawn mouth opening, blinks, eyes closed, and multiple yawns in one clip. Report per case: frames, class-2 detections and confidence range, confirmed yawns, micro-yawns, false positives, misses. Plus a check that the eye counters for the same clips are byte-identical to a pre-change run — that is the regression guard for "eyes still work".

Unit tests cover: single frame never confirms, micro→normal never double-counts, cooldown suppresses duplicates, smile trajectory rejected, gap-interrupted yawn still counted, yawns/min uses events.

## Files in scope

- `src/features/inference/postprocess.ts` — optional class-2 probe; optional class-2-only candidate threshold; cross-class dedupe exemption if measured necessary.
- `src/features/drowsiness/yawn-state-machine.ts` (new) — states, upgrade/merge, cooldown, rejection reasons.
- `src/features/drowsiness/mouth-state.ts` — normalised opening, trajectory features, smile rejection.
- `src/features/drowsiness/event-aggregator.ts` — delegates the mouth path to the state machine; eye path untouched.
- `src/features/drowsiness/yawn-diagnostics.ts` (new) — the probe aggregator and report.
- `src/features/drowsiness/types.ts`, `src/hooks/use-user-settings.ts` — new configurable parameters.
- `src/components/live/debug-overlay.tsx`, a new yawn timeline component, `live.tsx`, `video.tsx` — display only.
- Calibration and driver-report modules for steps 6 and 7.

## Reported back at the end

A → L exactly as you listed: whether class 2 is produced, its confidence range, which threshold filtered it, survival counts at each stage, confirmed vs micro counts, rejected false positives, files changed, eye-path proof, build/test status, and whether real footage produced a yawn event.
