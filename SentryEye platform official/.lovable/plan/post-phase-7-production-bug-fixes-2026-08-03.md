# Post-Phase 7 — Production Bug Fixes

Six production bugs around model lifetime, preloading, model selection, and the missing Image Detection page. No new features beyond restoring Image Detection.

## What I verified in the code

- The warm cache (`src/features/inference/provider-cache.ts`) is a module-level singleton and already survives page navigation; nothing in the routes disposes it.
- The cache holds exactly one entry keyed `providerId:modelId`, and any acquire with a different `modelId` evicts and re-initializes (re-download + re-compile).
- `useModelSelection` starts with `selectedId = null` on every mount and only hydrates from localStorage in an effect; until then `selected` falls back to `models[0]` (registry order = highest mAP50). A start triggered before hydration, or a registry order where RF-DETR Nano is not first, therefore passes a different `modelId` than the stored one and evicts the warm entry.
- Nothing preloads a model at app start — the model is only acquired inside `start()` in `use-live-session.ts`, i.e. after the user presses Analyze.
- There is no `/image` route (it was removed during Phase 7 placeholder cleanup) and no Image Detection entry in the sidebar.
- Video and Live pages read the selected model but render no model selector.

## Fixes

### 1. App-owned model lifetime
- Add an app-level `ModelProvider` context mounted in the root layout that owns: the selected model id, the resolved metadata, and the warm-up state (`idle | loading | ready | error`).
- The context calls `acquireProvider` once and holds the reference for the app lifetime; pages consume it instead of triggering their own first-time load.
- Selection hydration moves into the context so a single stable model id exists before any page can request a session — this removes the fallback-vs-stored id mismatch that evicts the cache.
- Cache eviction happens only on explicit model change or tab close/reload (existing `pagehide` handler stays).
- `use-live-session.ts` keeps using `acquireProvider`, which is then always a cache hit.

### 2. Background preloading
- Immediately after the app mounts (and after auth is available), the context preloads the selected model in the background.
- Changing the selected model cancels/supersedes the previous warm-up and preloads the new one.
- A small non-blocking status pill in the app shell header shows `Loading model… <percent>` / `Model ready` / `Model failed — retry`, driven by the existing worker `stage` events (`model-download-progress` already reports received/total).

### 3. Default model
- Default selection for users with no stored choice becomes RF-DETR Nano, resolved by registry name/version rather than mAP order, with a safe fallback to the first active model if it is absent.

### 4. Model selector on Video and Live
- Add a shared compact `ModelSelector` component (dropdown of active models + Ready/Loading badge).
- Render it on `/video` and `/live` headers. It is disabled while a session is running.
- Both pages always display selected model name and readiness.

### 5. Image Detection page
- New route `/image` plus sidebar entry.
- Upload + drag & drop, preview, model selector, Analyze button.
- Runs one inference through the existing provider (`ImageBitmap` → `provider.infer`) — no duplicated AI logic, no new preprocessing/postprocessing.
- Renders bounding boxes with labels and confidence scores over the preview using the existing detection overlay, plus a results list.
- "Download annotated image" composites the image and boxes on a canvas and saves a PNG.
- Saves a session using the existing `SessionRecorder` with `source: "image-upload"` (already allowed by the sessions constraint), so it appears in History/Report/Analytics like a video session.

### 6. Navigation verification
- Walk Video → History → Report → Analytics → Monitoring → Image → Video in a real browser and assert the worker/session initializes once: `provider-cache-miss` appears exactly once and every later acquire logs `provider-cache-hit`, with no repeated `model-download-start`.

## Technical notes

- Files added: model context (`src/features/inference/model-context.tsx`), `src/components/model-selector.tsx`, `src/routes/_authenticated/image.tsx`, image-source helper for single-frame inference.
- Files modified: `provider-cache.ts` (expose warm-up/preload + progress), `use-model-selection.ts` (delegates to the context, default = RF-DETR Nano), `app-shell.tsx` (status pill + Image nav), `video.tsx`, `live.tsx`, `_authenticated/route.tsx` (mount provider).
- No database migrations. No changes to preprocessing, postprocessing, or the worker protocol beyond reusing existing stage events.

## Final report
After implementation I'll report: root cause of repeated loading, the redesigned cache ownership, components modified, browser-verified proof the model initializes once across the full navigation loop, Image Detection verification, and any remaining production issues found.
