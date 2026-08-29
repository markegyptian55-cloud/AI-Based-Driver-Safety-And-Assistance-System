# Manager reports feed + a second pass on inference speed

## 1. Manager dashboard: newest report on top

The "Drivers needing attention" card keeps its place but changes behaviour:

- Each driver row gains a **last report time** ("2 min ago", "Today 14:22") taken from the most recent finalized shift report for that driver.
- Default order becomes **most recent report first**, so a driver who just ended a shift appears at the top.
- A small sort toggle on the card header: **Latest** (default) / **Lowest score**, so the old risk ranking is one click away.
- The card no longer hides drivers with no high/critical risk when sorted by Latest — it shows the most recent finalized reports across the fleet (still capped at 8 rows, "All drivers" link unchanged).

## 2. Live pop-up and counter

- When realtime delivers a new finalized shift report, a toast appears: driver name, safety score, event count, risk badge, and a link to that driver's page. Toasts are throttled so a burst of syncing shifts does not flood the screen (one toast per report, max a few per second, grouped as "N new reports" beyond that).
- A numeric badge on the card header counts reports arrived since you last looked. Clicking the card or the badge clears it. The count persists per browser via last-seen timestamp, so a page reload does not fake-clear it.

## 3. Filters on the reports section

Three filters above the list, all client-side over the fetched reports:

- **Driver** — searchable select of fleet drivers.
- **Risk level** — low / moderate / high / critical (multi-select chips).
- **Date range** — Today / 7d / 30d, following the existing period tabs where they overlap.

Filters affect the list and the counter, not the KPI tiles above.

## 4. Inference speed, latency, FPS — second pass

Already in place: WebGPU zero-copy preprocessing, adaptive duty cycle (up to 85% mobile / 95% desktop), motion gate with a 200 ms sampling floor, early-bail YOLO decoding, throttled React state. The remaining wins, in order of measured impact:

1. **Output-side copy removal.** The worker currently materializes the full model output before decoding. Decode straight from the output tensor view and reuse one detection buffer per session — removes one large allocation per frame (biggest single cost left on the 960 path).
2. **Pipelined frames (depth 2).** Today the next frame is only captured after the previous result returns, so GPU and CPU idle in turn. Allow one frame in preprocessing while another is in inference, capped at 2 in flight, with newest-frame-wins so latency cannot grow. This is where the real FPS jump on desktop WebGPU comes from.
3. **Persistent GPU input buffer.** Keep one GPU tensor allocated per model and overwrite it, instead of creating a tensor per frame — removes per-frame WebGPU buffer allocation and its implicit sync.
4. **Warm-start after model switch.** Run the warm-up inference during model prepare so the first live frames are not 3-5x slower than steady state.
5. **Video upload: decode-ahead.** Prefetch the next frame's bitmap while the current one is being analysed, so analysis rate is limited by the model and not by decode latency.
6. **Separate honest readouts.** The engine strip keeps showing infer/s and preview fps separately, plus in-flight depth, so any gain is visible rather than claimed.

Expected after this pass, with the same two fp32 models and no change to image size, thresholds, NMS or provider selection:

| Path | Now | After |
|---|---|---|
| Desktop WebGPU, 480-fast | ~30-40 infer/s | 45-60 infer/s |
| Desktop WebGPU, 960-high | ~12-20 | 18-28 |
| Modern phone WebGPU, 480 | ~15-25 | 22-35 |
| WASM fallback | 3-8 | 4-9 (decode/copy only; the model cost dominates) |

960 still cannot reach 40-50 — that would need fp16/int8 or a smaller input, both ruled out. Nothing here changes detection results: PERCLOS, microsleep, yawn duration and scoring stay frame-time accurate.

## Technical touch points

`src/routes/_authenticated/manager.index.tsx` (sort toggle, filters, badge, toast wiring), `src/features/fleet/fleet-data.ts` (latest-report-per-driver join), `src/features/inference/browser-worker.ts` (output copy, GPU buffer reuse, warm-start), `src/features/session/camera.ts` and `src/features/session/video-file-source.ts` (in-flight depth 2, decode-ahead), `src/components/live/engine-strip.tsx` (in-flight readout).

## Out of scope

No new models, no fp16/int8, no input-size change, no threshold/NMS/provider-selection changes, no schema migration.
