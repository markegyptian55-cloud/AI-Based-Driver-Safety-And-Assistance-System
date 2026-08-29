# Offline mode for drivers and guests

Give every user — driver, guest, manager — control over the detection models stored on their device, and make the app itself keep working without a network connection.

Today the model download/storage page exists at `/models` but is only listed for admins, and the app has no offline shell (no service worker, no manifest), so a reload with no connection shows a browser error page even when the model is already cached.

## 1. Offline models page for everyone

- Rename the sidebar entry to **Offline models** and show it to drivers and guests in the "Driving" group, right under Video detection. Managers keep their fleet nav plus this entry (they may also drive/test).
- Keep the page itself unchanged in behaviour: download each model once, see size and storage used on this device, resume or stop an interrupted download, delete a stored model, and clear leftover partial/orphaned data.
- Add a clear offline status block at the top: "Ready offline" when at least one model is fully stored, otherwise "Download a model to drive without a connection", plus device storage used vs available.
- Guests get the same control — model storage is device-local and needs no account.

## 2. Make the app itself work offline

- Add a web app manifest (name, icons, standalone display, theme colour matching the current dark/neon theme) so the app can be installed to a phone home screen.
- Add a service worker that pre-caches the app shell and runtime assets needed for detection: HTML shell, JS/CSS bundles, the ONNX runtime WASM files under `/ort`, and the ffmpeg core used by video upload. Models themselves stay in the existing IndexedDB store — the service worker never duplicates them.
- Strategy: cache-first for versioned static assets and runtime binaries, network-first with cache fallback for the app shell, and never cache backend/API calls.
- Register the worker only in the browser after hydration, and auto-refresh the cache when a new app version ships (a small "Update available — reload" toast).

## 3. Offline behaviour in the app

- A persistent, unobtrusive **Offline** badge in the header when the browser reports no connection.
- Live and Video detection keep running fully offline when the selected model is stored; if the selected model is not stored and there is no connection, show an inline message pointing to Offline models instead of a failed download.
- Shifts and safety events already queue in IndexedDB and sync when back online — surface that in the offline badge ("2 shifts waiting to sync").
- Manager dashboards and reports require a connection; when offline they show a friendly "reconnect to load fleet data" state rather than an error.

## Technical notes

- Nav change in `src/components/app-shell.tsx`: move `/models` out of `adminNav` into the driver group; keep the existing route file and add the offline-readiness summary to it.
- New `public/manifest.webmanifest` + icons, linked from `src/routes/__root.tsx` head.
- New `public/sw.js` registered from a client-only effect in `__root.tsx`; precache list generated at build time is not available in this setup, so the worker uses a versioned cache name plus runtime caching rules keyed by path (`/ort/`, `/wasm/`, `/assets/`).
- Online/offline state via a small `useOnlineStatus` hook (`navigator.onLine` + `online`/`offline` events), used by the header badge and the detection pages.
- No database or inference-pipeline changes; `src/features/inference/*` model store logic is reused as-is.

## Out of scope

- Offline manager analytics (fleet data stays server-backed).
- Background sync API; the existing reconnect-driven sync queue is kept.
