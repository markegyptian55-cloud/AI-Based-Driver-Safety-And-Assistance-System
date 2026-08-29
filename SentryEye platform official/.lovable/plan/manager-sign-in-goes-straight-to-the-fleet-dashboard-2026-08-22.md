# Manager sign-in goes straight to the fleet dashboard

Three fixes: land managers on the dashboard immediately, lock the manager role to one email, and add a refresh button to the dashboard.

## 1. Manager lands on the dashboard directly

Today the sign-in page decides where to go from the role card you tapped ("Driver" / "Manager"), not from your real account role. Signing in with the manager account while the card says Driver sends you to the Live detection page first, and only then does the app bounce you to `/manager`. The public landing page at `/` also stays on the marketing page for a signed-in manager.

Changes:
- After sign-in (email and Google), always read the account's real fleet role and route on it: manager/admin to `/manager`, everyone else to `/live`. The role card becomes a hint only.
- The `/auth` already-signed-in redirect resolves the same way instead of defaulting to `/live`.
- The landing page `/` redirects a signed-in manager to `/manager` and a signed-in driver to `/live`, so no intermediate page is shown.

## 2. Only markegyptian55@gmail.com can be a manager

Current state (verified): the signup trigger assigns `manager` only to that email, everyone else gets `driver`, and there is no insert/update policy on the membership table, so an account cannot promote itself. The sign-in page's "Manager" card is only a destination hint and already falls back to the driver workspace for non-managers.

To make this a hard guarantee rather than a convention, add a database trigger on the membership table that forces the role back to `driver` for any row whose account email is not the reserved manager email — on insert and on update. Any future path that tries to write a manager row for another account is silently downgraded.

UI wording: the "Manager" card on the sign-up tab makes clear that manager access is issued by the fleet owner and that creating an account always creates a driver account.

## 3. Refresh button on the manager dashboard

Add a "Refresh" button in the fleet dashboard header that refetches the dashboard queries (drivers, current period stats, previous period stats, active shifts, sync health), shows a spinning state while fetching, and displays the last-updated time next to it.

## Technical notes

- `src/routes/auth.tsx`: `goNext()` resolves role from the membership row for every path (not just when intent is manager); `beforeLoad` resolves the same destination.
- `src/routes/index.tsx`: session-aware redirect based on the membership role.
- `src/routes/_authenticated/manager.index.tsx`: header refresh button invalidating the `fleet-*` query keys plus the sync-health query used by `SyncHealthCard`.
- New migration: `BEFORE INSERT OR UPDATE` trigger on `public.org_members` reusing `public.fleet_role_for_email()` to clamp the role.
- No changes to detection, inference, or shift logic.
