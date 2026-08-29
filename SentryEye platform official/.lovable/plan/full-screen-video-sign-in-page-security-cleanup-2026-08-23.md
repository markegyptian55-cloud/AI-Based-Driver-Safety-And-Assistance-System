# Full-screen video sign-in page + security cleanup

## 1. Video as the page background

- The intro clip becomes a full-viewport background layer on `/auth`: muted, looping, autoplaying, `playsInline`, `object-cover`, sitting behind everything and ignoring pointer events.
- A dark gradient/scrim over the video keeps the form readable and preserves the current dark green cockpit look; the scanline overlay stays.
- The sign-in card floats on top, centered on mobile and right-aligned on wide screens, so the empty left area is now filled by the video itself.
- The separate boxed video next to the form and the duplicate mobile copy are removed.

## 2. "Watch full video" button

- A single button under the card (and visible on mobile) labelled **Watch full video**.
- Clicking opens a dialog with the same clip playing from the start, unmuted, with native controls. Closing the dialog stops it and the background clip keeps playing silently.
- Background video is never unmuted in place, so no surprise audio on page load.

## 3. Performance and accessibility

- Background video gets a poster frame and `preload="metadata"`; the file is large, so on slow connections or when the device reports reduced data/`prefers-reduced-motion`, the page shows a static poster instead of the moving video.
- The background is `aria-hidden`; the dialog player is the accessible one.

## 4. Security findings

Three open warnings, all fixed by database migration:

- **Hardcoded manager email**: `is_reserved_manager` currently decides audit-log access from a literal email. Replace with a role check against `org_members`/`user_roles`, keeping the current manager account as the only holder of that role so access does not change today, but the rule is role-based going forward.
- **Public execute on a SECURITY DEFINER function**: revoke `EXECUTE` from the anonymous role on the definer functions that do not need to be callable while signed out.
- **Diagnostics shares policies**: add an explicit owner-scoped `INSERT` policy and confirm token-based public reads go only through the server path, not a broad table policy.

## Technical notes

- Edits: `src/routes/auth.tsx` (layout), `src/components/auth/intro-video.tsx` (background + dialog variants), plus one new migration for the three findings.
- No change to auth logic, routing, or the detection pipeline.
