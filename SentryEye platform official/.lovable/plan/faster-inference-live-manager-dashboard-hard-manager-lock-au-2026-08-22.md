# Faster inference, live manager dashboard, hard manager lock, audit page

Four separate pieces of work. Nothing in the detection pipeline gets re-architected — GPU preprocessing, per-frame instrumentation and the warm-up path stay as they are.

## 1. Push latency down and frames-per-second up

Measured today: the duty-cycle scheduler targets 80% of the frame budget on desktop and 60% on mobile, so it deliberately leaves headroom idle. Concrete changes:

- **Adaptive duty ceiling.** Instead of a fixed 0.8 / 0.6, ramp the target up while the preview keeps a stable 60 fps and no dropped frames, and back off the moment preview fps or stall time degrades. On a desktop at ~15 ms per inference this moves the ceiling from ~50 to ~60+ inferences/sec; on Android it lifts the floor without reintroducing jank.
- **Skip idle frames.** When two consecutive frames are near-identical (no motion in the face region), reuse the previous result instead of running inference. Cuts average load substantially on a still driver, which is most of a shift.
- **Cheaper post-processing.** Reuse the typed arrays used for decoding and NMS instead of allocating per frame, and bail out of the decode loop early on rows below the lowest per-class threshold.
- **Decouple drawing from inference.** Overlay boxes are already smoothed; make the overlay redraw strictly on `requestAnimationFrame` from the last known result so preview fps never waits on the model.
- **Honest ceiling.** The 480 model on WebGPU is where 50-60 inferences/sec is reachable. The 960 fp32 model cannot hit that on any browser device — it will improve, but it stays in the low-teens on mobile. The engine strip will keep showing `infer/s` and `preview fps` separately so the numbers are verifiable rather than claimed.

A before/after measurement on desktop and on the weak Android device is part of the work, not an afterthought.

## 2. Manager dashboard refreshes itself

- Realtime subscription on shifts, shift reports and safety events for the organization; any insert or finalize invalidates the fleet queries so KPIs, charts and the sync-health card update within a second.
- A 30-second polling fallback plus refetch on window focus, for browsers or networks where the realtime socket drops.
- The manual Refresh button stays, and the header keeps showing "updated X ago" driven by the real last-fetch time.

## 3. Hard server-side manager lock

Today the manager check happens in the browser. The database already clamps the manager role to your email on insert and update, but manager data is fetched with the browser client, so enforcement is one layer thin.

- Add a server-side manager guard: an authenticated server function middleware that resolves the caller's email from the verified token and refuses anything that is not `markegyptian55@gmail.com`, returning a 403.
- Route every manager data read (fleet totals, driver list, daily stats, shift history, sync health, audit log) through that guard instead of direct browser queries.
- Tighten the database policies for manager-scope reads so a hand-crafted request from another account returns nothing even if it bypasses the app.
- Keep the client-side redirect as UX only: any non-manager landing on `/manager/*` is bounced to their driver home with a clear message.

## 4. Manager audit log page

`/manager/audit` — a table of account and access activity with filters by action type and date range, and paging.

What it can show today: signups and shift finalizations, which are already recorded. Sign-ins, manager access checks (allowed and denied) and dashboard refreshes are **not** currently recorded, so this work adds that logging:

- Log a `auth.signin` row on each successful sign-in.
- Log `manager.access_granted` / `manager.access_denied` from the new server-side guard, including the attempting account.
- Log `manager.dashboard_refresh` when the dashboard data is refreshed.

Each row shows time, account, action, target and outcome. Denied attempts are highlighted.

## Technical notes

- Access control: `requireSupabaseAuth` middleware plus an email assertion inside new server functions in `src/lib/manager.functions.ts`; audit writes use the same verified identity, never a client-supplied one.
- Audit reads need a policy change — the manager account currently holds the `operator` app role, and the existing audit-log read policy admits `admin` only, so it would return an empty table as-is.
- Scheduler changes live in `src/features/session/camera.ts` and the video source; decode changes in `src/features/inference/postprocess.ts`. `gpu-preprocess.ts` and the worker's instrumentation are untouched.
- Realtime uses the existing Supabase client with query invalidation; no new state layer.
