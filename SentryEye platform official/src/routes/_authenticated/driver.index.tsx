import { createFileRoute, redirect } from "@tanstack/react-router";

// The driver workspace was merged into Live detection: shift start/end now
// lives in the control bar on that page. Keep the old URL working.
export const Route = createFileRoute("/_authenticated/driver/")({
  beforeLoad: () => {
    throw redirect({ to: "/live", replace: true });
  },
});
