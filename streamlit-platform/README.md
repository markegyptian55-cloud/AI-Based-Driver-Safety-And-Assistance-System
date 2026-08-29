# Drowsiness Detection Platform / منصة كشف النعاس

A standalone Streamlit dashboard for testing driver-drowsiness detection
models. This folder is self-contained — copy it to any Windows PC and it runs;
it does not depend on anything outside itself.

## Quick start

1. **Setup** (first time only, ~5-15 minutes depending on disk speed):
   ```
   env\setup.bat
   ```
   This builds a local Python virtual environment from the offline wheels in
   `env\wheelhouse\`, auto-detects whether the machine has an NVIDIA GPU and
   installs the matching PyTorch build, and verifies everything imports
   correctly. Requires **Python 3.11** to already be installed (torch's
   offline wheels are built specifically for it).

2. **Run**:
   ```
   run.bat
   ```
   Opens the dashboard at `http://localhost:8501`.

No internet connection is required for either step — everything needed is
already in `env\wheelhouse\`.

## What's inside

- **Video Analysis** — upload a video (any common format) or point at a local
  file, run detection, and get an annotated result with a custom player
  (play/pause, ±5s, frame-step, speed, fullscreen), a fatigue timeline, and a
  micro-event log (blinks / micro-sleeps / full closures / yawns).
- **Live Camera** — the same analysis running on a live webcam feed.
- **Models** — every trained model with its measured accuracy, size, and
  training configuration, plus a per-class comparison chart.
- **Benchmark** — inference speed measured on the machine you are running
  on, per model: single-frame latency, batched latency, the resulting
  throughput, and an accuracy-against-speed plot. Also runs the batch
  auto-tuner. Nothing on this page is estimated.
- **About** — how the fatigue scoring and event detection actually work.

Switch theme (dark / neon / light) and language (English / Arabic) from the
sidebar at any time.

## إعداد سريع

1. **الإعداد** (مرة واحدة فقط): شغّل `env\setup.bat`
2. **التشغيل**: شغّل `run.bat`

لا حاجة للإنترنت في أي من الخطوتين.

## Status (2026-08-22)

**Functionally complete; 21/21 models load, infer, and process video.**
Verified this session: all 21 registry entries load and run inference, all
five pages render without exceptions, 15 unit tests pass, and end-to-end
video processing produces valid output for YOLO26n, YOLO11m and RF-DETR.

**Still not portable.** `env\setup.bat`'s venv build fails with
`ResolutionImpossible` on ultralytics' torch/torchvision pin. Dev and
testing run in the `AI-3.11` conda env
(`python -m streamlit run app.py`), which works but is not the standalone
artifact this folder is meant to be. Repro below.

### Inference speed

Batched inference is available and is chosen per model by measurement,
not by a fixed setting. The reason it is per-model is that batching is
**not** universally faster here:

| Model | 1 frame | batched | tuned batch |
|---|---|---|---|
| YOLO11n 384 | 7.56 ms | 1.19 ms | 8 (6.33x) |
| YOLO26n 480 | 7.26 ms | 2.02 ms | 8 (3.60x) |
| YOLO26n 960 | 11.23 ms | 8.29 ms | 4 (1.35x) |
| YOLO11m 640 | 12.28 ms | 13.27 ms | **1** (batching is slower) |
| YOLO26s 960 | 14.34 ms | 16.06 ms | **1** (batching is slower) |

Small models at low resolution do not saturate the GPU at one frame at a
time, so their cost is dominated by fixed kernel-launch overhead, which
batching amortises. Larger models are already compute-bound, so batching
only adds memory pressure. A single hard-coded batch size would speed up
half the registry and slow down the rest, which is why `core/autotune.py`
measures each model and caches the winner to `models/autotune.json`,
keyed by GPU so a cache copied to another machine is ignored.

End-to-end effect on a 6-second clip with YOLO26n 480: **57.8 -> 107.5
fps**, with telemetry byte-identical to the unbatched run.

FP16 is exposed in the sidebar but measured **no** speed-up on this GPU
(0.98-1.01x) for the same overhead-bound reason. It is left available
because it reduces GPU memory and should help on compute-bound hardware,
but it is not advertised as a speed feature here.

**Bugs found and fixed this session** (all via reading the actual crash /
tracing the actual code, not guessing):
- `pages/1_video.py`: upload destination filename used `uuid.uuid4().hex`
  freshly on *every rerun*, not just on upload -- any full rerun (sidebar
  theme/lang/model change) while a video was processing silently changed
  `result_key` and orphaned the `_video_run_id::...` state, crashing with
  `KeyError`. Fixed: filename now keyed off `uploaded.file_id` (stable).
  Also swapped remaining bracket `session_state[...]` reads in this file for
  `.get()` with the same defaults `app.py` seeds, so a genuine edge case
  degrades to "back to idle" instead of a hard crash.
- `pages/1_video.py`, `pages/2_webcam.py`: `st.rerun(scope="fragment")` on the
  *first-ever* fragment call raises `StreamlitAPIException` -- Streamlit
  disallows fragment-scoped reruns during a full-script run, which the first
  call always is. Wrapped in try/except, falling back to a plain `st.rerun()`
  for that one bootstrap call only.
- `ui/player.py`: `_static_url()` built the served-video URL without a
  leading `/` (`app/static/...` instead of `/app/static/...`, confirmed
  against Streamlit's own registered route `app/static/{path}` and its own
  doc example `/app/static/report.html`). This is very likely why the player
  showed the black player chrome but no video ever loaded.
- `ui/player.py`: `_cues_json()` imported `from .audio import cue_data_uri` --
  `audio.py` lives in `core/`, not `ui/` (same class of bug as the earlier
  `model_picker.py` import fix). `ModuleNotFoundError` on every result render.
- `ui/static_js/player.js.tpl`: the player tried to report `currentTime` back
  to Python via `postMessage` on unload, but `st.iframe()` has no listener for
  that -- dead code, so `start_at` was always 0 and any sidebar-triggered full
  rerun restarted playback from 0:00. Replaced with `localStorage`, keyed by
  video URL, written every ~1s on `timeupdate` -- pure client-side, survives
  any rerun with no server round-trip.
- `pages/1_video.py`: the live "processing" preview looked like a slideshow
  jumping once every ~1-2s instead of a flowing feed. Root cause: the
  per-batch loop computed a fresh preview frame every 4 frames (`preview_every`
  in `core/pipeline.py`) but only ever *displayed* the frame from the LAST
  item of each 20-frame batch -- and since 20 is an exact multiple of 4, that
  last item's index always landed on a non-preview frame, so the *other*
  captured frames were silently discarded. Fixed by pushing each preview
  frame to the `st.empty()` placeholder immediately inside the loop (Streamlit
  placeholders update the browser the instant they're called, not just when
  the script run ends) instead of batching updates for after the loop.
- `ui/theme.py`, `app.py`: `light` theme removed entirely (bad contrast
  against the ADAS-style dark panels per user feedback); `neon` is now
  `DEFAULT_THEME` and the `app.py` session default.

## Notes for whoever maintains this

- `core/` holds detection, analysis, and video I/O logic vendored/rewritten
  from the parent research project — see each file's module docstring for
  exactly what changed and why. Nothing here imports from `../src`.
- `models/registry.yaml` and the `card.json` per model are generated by
  `tools/build_models.py`, run from the parent project (not part of the
  shipped platform). Re-run it after training a new model to refresh the
  registry.
- Adding a new language: add a dict to `ui/i18n.py`'s `TRANSLATIONS`. Run
  `python -c "from ui.i18n import missing_keys; print(missing_keys())"` to
  find any English strings your translation is missing.
- `tests/test_core.py` pins the fatigue-scoring maths to match the parent
  project exactly, and pins the micro-event duration boundaries. Run it after
  touching `core/analyzer.py` or `core/events.py`.
- `tests/test_inference.py` pins the property that matters for batching:
  batched and unbatched inference must produce *identical* results. The
  fatigue analyser and micro-event detector are sequential state machines,
  so a batching bug would not raise -- it would silently shift event
  timings. Run it after touching `core/detect.py` or `core/pipeline.py`.
- `tools/check_ui_refs.py` verifies that every `t()` key and every
  `theme.<field>` reference in the UI actually resolves, in both languages.
  A missing translation key renders as the raw key rather than raising, so
  it ships broken instead of failing. Run it after adding UI strings.
- `models/autotune.json` holds measured per-model batch sizes. Delete it to
  force re-tuning; it is regenerated from the Benchmark page or the sidebar.
