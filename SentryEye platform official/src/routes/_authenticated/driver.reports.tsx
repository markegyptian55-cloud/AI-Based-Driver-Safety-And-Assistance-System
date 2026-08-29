import { createFileRoute, redirect } from "@tanstack/react-router";

// "My safety" is now "My report" at /my-report.
export const Route = createFileRoute("/_authenticated/driver/reports")({
  beforeLoad: () => {
    throw redirect({ to: "/my-report", replace: true });
  },
});
