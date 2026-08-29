import { createFileRoute, redirect } from "@tanstack/react-router";

// Image detection was removed from the product; drivers use Live and Video.
export const Route = createFileRoute("/_authenticated/image")({
  beforeLoad: () => {
    throw redirect({ to: "/live", replace: true });
  },
});
