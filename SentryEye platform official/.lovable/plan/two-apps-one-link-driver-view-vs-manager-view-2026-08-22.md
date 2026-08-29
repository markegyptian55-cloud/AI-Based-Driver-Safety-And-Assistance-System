# Two apps, one link: Driver view vs Manager view

Right now every signed-in user sees the same navigation, shift start/end lives on its own `/driver` page, and the sign-in screen gives no hint about driver vs manager vs guest. This plan splits the product into two clearly separated experiences chosen by who signs in, plus a guest path.

## 1. Sign-in page

Add a role selector at the top of `/auth` with three cards: **Driver**, **Manager**, **Guest / visitor**.

- Driver and Manager both show the same email + password + Google form; the choice only sets where you land after sign-in (`/live` for driver, `/manager` for manager).
- The real role always comes from the account in the database, never from the button. If a driver picks "Manager", they sign in fine and land on the driver home with a short note that their account is a driver account.
- `markegyptian55@gmail.com` is the manager account.
- Guest goes straight to live detection with no account, detection works, nothing is saved (this already exists — it just becomes an explicit third card).

## 2. Driver experience (role = driver)

Navigation is reduced to exactly three items:

1. **Live detection** — with the shift controls merged in
2. **Video detection**
3. **My report**

Everything else (Dashboard, Analytics, History, Benchmark, Models, Monitoring, Image detection, Fleet pages) is hidden from drivers.

- **Image detection is removed** from the app entirely (route and nav).
- **`/driver` page is deleted.** Start Shift / End Shift becomes a control bar at the top of the Live detection page: big Start Shift button when idle; when active it shows elapsed time, live alert count, sync state and an End Shift button. Ending a shift shows the shift report inline right there.
- **`/my-report`** replaces both the driver Dashboard and "My safety": one page with Day / Week / Month / Year filters showing safety score trend, total and critical events, drowsiness rate, behaviour breakdown, and the list of past shifts, each opening its full shift report.

## 3. Manager experience (role = manager/admin)

Manager signs in and lands on the master dashboard. Navigation:

1. **Fleet dashboard** — KPIs (drivers, active shifts, average safety score, high/critical drivers, monitored hours), fleet drowsiness and event trend charts, drivers needing attention, recent finalized reports. Same Day / Week / Month / Year filter as the driver report.
2. **Drivers** — ranked table with score, risk, drowsiness rate, critical events, trend arrow, last shift and recommendation.
3. **Driver detail** — the decision page: current risk, trend charts over the selected period, risk-explanation factors, shift history, manager notes, and a clear **decision panel** that states the recommendation (Keep / Monitor / Needs attention / High risk / Management review) with the evidence lines behind it, plus explicit wording that this is a safety recommendation and not an automatic employment decision.
4. **History** — the same fleet data browsed over past days/weeks/months/years.

Managers do not see the driver Live/Video shift controls in their navigation (they can still reach live detection, but it is not part of the manager flow).

## 4. Guest

Live and Video detection only, with a "Sign in to save your shifts" prompt. No shift, no report.

## Technical notes

- A single `useFleetRole()` source of truth (already available via the fleet identity in `shift-context`) drives navigation groups, the post-login landing route, and route guards in `src/components/app-shell.tsx`.
- Role-based route guards: driver-only routes redirect managers to `/manager`, manager routes redirect drivers to `/live`. RLS in the database stays the real security boundary; the guards are UX only.
- `src/routes/_authenticated/driver.index.tsx` and `image.tsx` are deleted; `driver.reports.tsx` moves to `my-report.tsx`; shift controls move into a `ShiftControlBar` component rendered by `live.tsx` (and reused, minus start, by `video.tsx`).
- Existing admin/technical pages (Analytics, Benchmark, Models, Monitoring, History) stay but are visible only to the `admin` app role, so neither driver nor manager sees clutter.
- No changes to the inference engine, model selection or the scoring functions.
