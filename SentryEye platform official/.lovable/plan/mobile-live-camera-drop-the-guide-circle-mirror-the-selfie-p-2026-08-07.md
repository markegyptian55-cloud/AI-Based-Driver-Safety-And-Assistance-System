# Mobile live camera: drop the guide circle, mirror the selfie preview, raise capture quality

Three surgical changes to the live-camera capture and presentation layer only. The model, ONNX loading, preprocessing, NMS, class mapping, thresholds, PERCLOS and event logic are untouched.

## 1. Remove the red dotted guide and stop blocking on quality

Current behaviour (verified in the code): the live page computes `gateBlocking` when the quality score drops below 45, shows a "Continue anyway" button, and a timer calls `stop()` after ~8 seconds of low quality — so a face that is simply a bit far away ends the run. The dashed oval and the dark/blur veils are drawn by the quality-cues overlay.

Changes:
- Delete the dashed oval guide, the darkness veil and the blur vignette from the cues overlay. What remains is a small, unobtrusive status line (for example "Quality 62 — face slightly far from camera"), no full-frame graphics.
- Remove the auto-stop timer and the `gateBlocking` state on the live page, along with the "Continue anyway" button. Inference always keeps running.
- Keep every measurement (lighting, blur, distance, occlusion, confidence, framerate) and keep writing the score into the session timeline and diagnostics exactly as today. The side panel keeps showing the score and the weakest factor, worded as a warning instead of "Analysis blocked".
- The video page's use of the cues overlay inherits the same non-blocking, guide-free rendering.

## 2. Natural mirrored front-camera preview

Today the preview is not mirrored, which is why a move to the right looks like a move to the left.

- The camera layer records whether the active track is front-facing (from the applied `facingMode` / track settings), and exposes that to the live page.
- The video element and the detection-overlay canvas get one shared horizontal flip via CSS when the camera is front-facing. Because both flip together, boxes and eye labels stay glued to the right eye — no coordinate math changes and no change to what the model receives (frames are grabbed from the raw stream, which CSS never touches).
- Label text inside the box overlay is drawn unflipped so it stays readable.
- The quality/status text and all other UI sit outside the flipped element, so nothing else mirrors.
- Rear camera, desktop webcam and uploaded-video playback are unaffected.

## 3. Better mobile capture quality

Mobile currently requests 480x360 at 15 fps, which is why the picture looks poor.

- Mobile requests 1280x720 at 30 fps as the ideal, then falls back progressively to 960x540, then 640x480, then a bare `facingMode: user` request if the device rejects the constraints.
- Desktop keeps its behaviour, with 1280x720 as the ideal.
- After the stream opens, the actually-applied track settings are read and logged into diagnostics, so a device that silently gives less is visible rather than assumed.
- Inference is unaffected: frames are still downscaled to the model's own input size by the existing preprocessing, and the existing adaptive frame skipping still protects inference FPS if a higher-resolution stream costs more per frame.

## Technical notes

- Files touched: `src/components/live/quality-cues-overlay.tsx`, `src/routes/_authenticated/live.tsx`, `src/components/live/quality-gate.tsx` (wording only), `src/features/session/camera.ts`, and a small mirror prop on `src/components/live/detection-overlay.tsx`.
- `detection-quality.ts` thresholds and the `usable` flag stay as-is; only the consumer stops acting on them destructively.
- Verification: type check, existing unit tests, and a Playwright pass on the live page (desktop stream) confirming no dashed guide is drawn, the session keeps running under a low quality score, and overlay boxes track the video under the mirror transform.
