import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AlertTriangle, Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { ModelProvider } from "@/features/inference/model-context";
import { AnalysisSessionProvider } from "@/features/session/analysis-session-context";
import { ShiftProvider } from "@/features/fleet/shift-context";

import { errorMessage } from "@/lib/format-error";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Visitor mode: no session is required to explore the app. Signed-out users
    // get the full detection pipeline; only database-backed features are gated.
    const { data } = await supabase.auth.getUser();
    return { user: data.user ?? null };
  },
  pendingComponent: () => (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Verifying your session…</span>
      </div>
    </div>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md space-y-3 text-center" role="alert">
        <AlertTriangle className="mx-auto h-6 w-6 text-destructive" aria-hidden="true" />
        <h1 className="text-lg font-semibold">Can't reach the service</h1>
        <p className="text-sm text-muted-foreground">
          We couldn't verify your session. Check your connection and try again.
        </p>
        <p className="break-words font-mono text-xs text-muted-foreground">
          {errorMessage(error)}
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    </div>
  ),
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  // ModelProvider sits above the shell so the selected model and its warm
  // ONNX session survive every navigation inside the app. AnalysisSessionProvider
  // does the same for the uploaded clip, its conversion and its results.
  // ShiftProvider owns the fleet shift lifecycle so a shift keeps running while
  // the driver moves between Live, Video and their reports.
  return (
    <ModelProvider>
      <AnalysisSessionProvider>
        <ShiftProvider>
          <AppShell>
            <Outlet />
          </AppShell>
        </ShiftProvider>
      </AnalysisSessionProvider>
    </ModelProvider>
  );
}

