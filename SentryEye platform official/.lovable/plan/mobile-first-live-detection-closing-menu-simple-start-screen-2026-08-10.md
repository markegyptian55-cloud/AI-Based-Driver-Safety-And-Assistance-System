# Mobile-first live detection: closing menu, simple start screen, offline models, portrait camera

Four fixes so a phone user can open the app, pick a model, download it once, and run live detection in portrait without wading through settings.

## 1. Navigation drawer closes on tap

Today the mobile drawer stays open after tapping a destination, so it must be closed by hand. Every nav link (and the logo and footer status link) will close the drawer on tap when on mobile, so the destination page is visible immediately.

## 2. Simple-first live page

The live page currently opens with the full expert console: calibration, compatibility check, quick test, automatic fallback, driver picker, low-light, sync, diagnostics. On a phone, the first screen becomes:

- Model card: which model, its size, and whether it is already saved on this device
- One primary button: **Download model** if not saved, otherwise **Start session**
- A short line of guidance ("Runs fully offline once downloaded")

Everything else moves under a single collapsed **Advanced settings** section (calibration, compatibility, quick test, fallback threshold, driver, low-light, sync, diagnostics). Desktop keeps the current expanded layout; the collapse applies to small screens, and the section remembers whether the user opened it.

## 3. Choose and download a model, then run offline

The model weights are already cached in the browser database after the first load, but nothing tells the user this or lets them do it deliberately.

- The model chooser shows each model with size and a clear badge: **Saved on device** or **Not downloaded**
- **Download** button with a real progress bar and the downloaded size; on completion the badge flips to saved
- **Remove from device** to free space
- When the device is offline, models that are not saved are shown as unavailable with an explanation, and the app starts a session from the saved model without any network call
- Start is blocked (with a clear message) only when the selected model is neither saved nor downloadable

## 4. Portrait camera on phones

The preview is currently locked to a 16:9 landscape frame, which wastes most of a phone screen and makes the face small (which also hurts detection).

- On phones, the camera requests a portrait-shaped stream (taller than wide) and the preview box uses a portrait aspect that fills the screen width
- The frame shape follows the device: if the user rotates the phone (and rotation is enabled in their system settings), the preview switches to landscape; otherwise it stays portrait
- Detection boxes stay aligned because the overlay is sized from the actual video dimensions, and the mirrored front-camera transform is preserved
- Desktop and uploaded-video playback keep today's behaviour

## Technical notes

- `src/components/app-shell.tsx`: use the sidebar context's `setOpenMobile(false)` in nav item, header and footer link handlers.
- New `src/components/live/model-manager.tsx`: model list with per-model cache state, download/remove actions; backed by new helpers in `src/features/inference/model-store.ts` (`hasCachedModel`, `deleteCachedModel`, `listCachedModels`) and a download path that streams progress into the existing warm-up progress reporting.
- New `src/components/live/advanced-settings.tsx` wrapping existing panels in a shadcn `Collapsible`, with the open state persisted in local storage.
- `src/routes/_authenticated/live.tsx`: restructure to primary action + advanced section; reuse existing state and handlers, no logic changes to inference.
- `src/features/session/camera.ts`: add a portrait rung to the constraint ladder driven by `window.matchMedia("(orientation: portrait)")` plus the constrained-device check; keep the existing progressive fallback.
- Preview container swaps `aspect-video` for an orientation-aware aspect on small screens; `detection-overlay.tsx` continues to size from `videoWidth`/`videoHeight`.
- No database, schema, or model/inference-math changes.
