# New model, neon-green theme, visitor mode, MP4 download

## 1. Replace all models with the new one

The uploaded `best-4.onnx` is a YOLOv11-nano detector (10.6 MB, 640x640, classes `closed_eye`, `open_eye`, `yawning`, ultralytics-v8 head, letterbox + unit normalize). Final training metrics from `results-2.csv`: precision 0.763, recall 0.862, mAP50 0.900, mAP50-95 0.566.

- Upload the new ONNX to CDN storage and add a pointer at `public/models/yolo11n-640-worstcase.onnx.asset.json`.
- Delete the two old pointers (`rfdetr-nano`, `yolo11m-worstcase-384`).
- Database migration: deactivate/remove the old `model_registry` rows and insert the new model with its labels, semantic map, postprocess config, and the metrics above.
- Update the default-model name in `src/features/inference/model-context.tsx` from `rfdetr-nano` to the new model, so it warms up automatically.
- Clear any stale `localStorage` model selection that points at a removed model (fall back to default when the stored id is not in the registry).

## 2. Neon green color system

Retheme `src/styles.css` tokens (light + dark blocks) from cyan to the requested greens, keeping everything token-based:

- primary: Electric Neon Green `#00FF66`
- ring / sidebar-primary: same green
- accent / chart-2: Vibrant Emerald `#00E676`
- chart-3 / warn accents: Neon Chartreuse `#AEEA00`, Lime Neon `#76FF03`
- safe: Neon Mint `#69F0AE`
- glow/scanline effects and detection-overlay box colors updated to the green family; danger red and background stay for contrast and risk clarity.

No hardcoded colors in components — only token values change, so every page picks it up.

## 3. Visitor / guest mode

- `src/routes/_authenticated/route.tsx`: `beforeLoad` returns `{ user: null }` instead of redirecting when there is no session.
- `src/routes/auth.tsx`: add the "Visitor Mode" button in the card header and the "Continue as Guest / Visitor" button under the forms, both calling `goNext()`.
- Guest-safe behavior: browser ONNX inference, model selection, live/video/image detection, thresholds and alarms all run locally on `CLIENT_DEFAULTS`.
- Database-backed writes (session recording, history, analytics, reports) cannot run without an account. For guests these will be skipped silently instead of throwing, and the affected pages show a small "Sign in to save sessions" notice with a sign-in link. Detection itself is fully usable.
- Sidebar/header shows a "Visitor" badge with a sign-in action.

## 4. Download converted MP4 on the Video Detection page

- Add a "Download MP4" button next to the video controls, enabled once a playable MP4 blob exists (transcoded output, or the original file when it is already MP4).
- Downloads via a temporary anchor + object URL, named after the source file with an `.mp4` extension; the URL is revoked right after, leaving the persisted session blob untouched.

## Technical notes

- Files touched: `src/styles.css`, `src/routes/auth.tsx`, `src/routes/_authenticated/route.tsx`, `src/routes/_authenticated/video.tsx`, `src/features/inference/model-context.tsx`, `src/features/session/supabase-session-port.ts` (guest no-op writes), `public/models/*`, plus one database migration.
- No inference/pipeline logic changes; the model swap is data-driven through `model_registry`.
