# Production Android Live Detection Recovery Plan

## Confirmed diagnosis

The screenshot’s **2.0 analysed FPS**, **28/100 quality**, delayed detection, and clustered eye boxes share a causal chain in the current implementation:

- A 640×640 ONNX inference round trip blocks capture of the next frame. On the tested Android phone, roughly 400–500 ms per inference caps analysis near 2 FPS.
- Constrained phones are forced to WASM even when WebGPU exists. WASM is limited to one thread unless the deployment is cross-origin isolated.
- The quality score intentionally treats 2 analysed FPS as zero for its frame-rate factor, so the low quality score is expected rather than a separate camera fault.
- The automatic mobile preset lowers confidence, raises the NMS IoU threshold, and preserves missed tracks for five frames. At 2 FPS, stale boxes can remain for more than two seconds and overlap with new boxes.
- A 0.5-second microsleep cannot be robustly identified from a stream producing approximately one analysed frame during that interval.

A browser-only 640×640 model cannot guarantee reliable real-time inference across low-end Android hardware. The production solution will therefore use the approved **automatic hybrid architecture**.

## 1. Establish a measurable ground truth

- Add a reproducible Python evaluation package for the original checkpoint and validation dataset.
- Validate class order, label semantics, input color order, normalization, resize/letterbox behavior, output tensor layout, confidence calculation, NMS, and inverse coordinate mapping.
- Export representative Android camera clips and compare Python checkpoint results, Python ONNX results, browser WASM results, browser WebGPU results, and remote results frame by frame.
- Produce per-class precision, recall, F1, confusion matrix, mAP, false alarms per minute, event latency, and microsleep detection metrics.
- Add golden-frame fixtures so a model or decoder change cannot silently introduce noise grids, duplicate eyes, swapped labels, or shifted coordinates.

## 2. Build mobile-specific model artifacts

Confirmed from the uploaded checkpoint `best-5.pt`: Ultralytics 8.4.64, architecture **yolo11n** (nano, ~5.5 MB), task `detect`, trained at **imgsz 640**, three classes in this exact order — `0 closed_eye`, `1 open_eye`, `2 yawning`. The runtime label map, semantic tags, left/right eye assignment, and smile-vs-yawn logic must be validated against this exact class list, since the model itself has no left/right or smile class.

- Export fixed-shape ONNX variants at **320×320** and **416×416** for mobile from this checkpoint; retain 640×640 for desktop/server evaluation.

- Start with FP32 and FP16 where supported, then evaluate INT8 only if validation confirms acceptable accuracy.
- Simplify and validate each ONNX graph with the target ONNX Runtime version and supported opset.
- Select the smallest artifact that meets accuracy thresholds on actual Android-style footage; do not assume 640 is automatically more accurate after latency and frame loss are considered.
- If the single full-frame detector still misses small eyes, retrain/evaluate a two-stage architecture: lightweight face/driver ROI localization followed by a compact eye/mouth state model on the crop. This greatly reduces pixels while preserving facial detail.
- Store explicit artifact metadata: checksum, input shape, preprocessing contract, output schema, labels, quantization, validated providers, and validation scores.

## 3. Replace the capture/inference pipeline

- Use `requestVideoFrameCallback` and transferable `ImageBitmap`/`VideoFrame` objects; add `MediaStreamTrackProcessor` as the preferred Chrome/Android capture path when supported.
- Keep capture, resize/letterbox, tensor creation, inference, decoding, and NMS in a dedicated worker.
- Implement a **single-slot latest-frame-wins queue**: one active inference plus at most one replacement frame, with all older frames closed and dropped. Camera capture must never wait for inference.
- Reuse typed arrays, canvases, and tensor buffers where supported to reduce garbage collection and memory pressure.
- Add separate timings for capture, transfer, preprocess, inference, postprocess, render, end-to-end age, dropped frames, and memory pressure.
- Read and report actual camera `track.getSettings()` values rather than requested constraints.

## 4. Correct mobile detections and tracking

- Restore class-aware NMS to a stricter validated threshold; raising IoU must not be used as a low-light compensation strategy.
- Add duplicate suppression for same-class eye detections and enforce plausible facial geometry: maximum one left eye, one right eye, and one mouth state inside the active driver ROI.
- Replace frame-count track expiry with millisecond-based expiry so behavior remains stable at 2 FPS or 20 FPS.
- Use timestamp-aware EMA/Kalman smoothing and confidence hysteresis without allowing stale tracks to survive long gaps.
- Never apply the low-light preset merely because a device is constrained; select it from measured luminance/blur conditions.
- Strengthen runtime output validation to reject malformed, non-finite, out-of-range, implausibly dense, and spatially repetitive detections, then immediately change provider or route remotely.

## 5. Add an automatic capability and correctness router

Run a short preflight benchmark before live analysis:

1. Validate camera orientation, dimensions, source FPS, lighting, sharpness, and face coverage.
2. Run known synthetic/golden inputs through each available execution provider and verify output fingerprints, not merely that inference completes.
3. Benchmark sustained latency for several seconds, not a single warm-up frame.
4. Select the fastest provider that is both correct and stable:
   - WebGPU for verified devices.
   - Multi-threaded WASM when cross-origin isolation and SIMD/threads are active.
   - Remote inference when local p95 latency, output validity, memory, or thermal stability fails policy.
5. Continue monitoring during the session and switch to remote inference if local p95 latency or invalid outputs exceed limits. Use hysteresis to avoid provider flapping.

Initial routing target: local mode must sustain at least **10 analysed FPS**, with **15 FPS preferred**. Below that, use remote inference automatically. The exact threshold will be finalized from event-level validation.

## 6. Production remote inference fallback

- Implement the existing model-agnostic remote provider contract against the FastAPI service with WebSocket streaming.
- Send resized/cropped frames with sequence number, capture timestamp, orientation, and calibration profile; never send queued stale frames.
- Use one in-flight frame and latest-frame replacement on both client and server.
- Return normalized detections plus server preprocessing/inference/postprocessing timings and model version.
- Add reconnect, timeout, adaptive JPEG/WebP quality, congestion control, heartbeat, and automatic return to local mode only after a successful stability benchmark.
- Keep event aggregation on the client so switching inference providers does not reset the active session or report timeline.
- Make camera-upload consent and the active local/remote mode explicit in the live interface.

## 7. Make microsleep detection time-based and medically honest

- Do not infer a 0.5-second microsleep from one classification frame.
- Track eye-closed state using capture timestamps and confidence hysteresis, tolerating only short measured gaps.
- Trigger the 0.5-second alarm only when sufficient temporal evidence exists at the validated analysis rate; mark intervals as **unreliable** when frame gaps exceed policy.
- Keep audible alarm activation user-initiated to satisfy mobile browser audio restrictions.
- Validate event onset/offset latency and false alarms on annotated clips, including glasses, head turns, low light, skin-tone diversity, partial occlusion, and one-eye visibility.

## 8. Deployment and observability

- Serve the app with COOP/COEP headers required for WASM threads, while auditing model, worker, font, and media resources for compatible cross-origin policies.
- Cache versioned model artifacts and verify checksums before session creation.
- Expand diagnostics sharing with anonymized device class, browser version, actual camera settings, selected provider, cross-origin isolation, model checksum, stage timings, drop rate, output-validation reason, quality factors, and provider-switch history.
- Add a sustained 10-minute test to detect thermal throttling, memory growth, worker leaks, frame leaks, and provider degradation.

## 9. Verification matrix and release gates

Test representative low-, mid-, and high-tier Android phones under daylight, indoor light, low light, glasses, movement, portrait/landscape rotation, front/rear camera, and thermal load.

Release gates:

- No noise-grid or duplicate-eye regression in golden fixtures.
- Local/remote normalized outputs agree within defined coordinate and confidence tolerances.
- At least 10 analysed FPS locally or automatic remote fallback within the preflight window.
- No inference result older than the configured maximum frame age is rendered or aggregated.
- Microsleep event recall, precision, onset latency, and false alarms meet dataset-defined targets.
- Provider switching preserves session recording, event logging, alarms, dashboard updates, and reports.
- Sustained tests show bounded memory and no leaked `VideoFrame`, `ImageBitmap`, worker, WebSocket, ONNX session, GPU, timer, or audio resources.

## Implementation order

```text
Ground-truth evaluator and golden fixtures
  -> 320/416 exports and model selection
  -> non-blocking capture worker and strict decoder/NMS
  -> capability benchmark and automatic router
  -> FastAPI WebSocket remote provider
  -> timestamp-based microsleep logic
  -> Android device matrix and production rollout
```

This order avoids spending more effort tuning UI thresholds around an unverified model/export contract and a fundamentally under-sampled stream.
