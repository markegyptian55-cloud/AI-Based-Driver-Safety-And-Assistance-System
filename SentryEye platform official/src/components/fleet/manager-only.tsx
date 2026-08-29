// Server-verified manager gate.
//
// The answer comes from a server function that reads the caller's email out of
// the verified bearer token, so a tampered client cannot fake it. The redirect
// below is only presentation — the manager data functions each re-check on the
// server, and RLS re-checks in the database.

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { checkManagerAccess } from "@/lib/manager.functions";

export function useManagerAccess() {
  const check = useServerFn(checkManagerAccess);
  return useQuery({
    queryKey: ["manager-access"],
    queryFn: async () => {
      try {
        return await check();
      } catch {
        return { allowed: false, email: null as string | null };
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function ManagerOnly({ children }: { children: ReactNode }) {
  const { data, isLoading } = useManagerAccess();

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Checking manager access…</span>
      </div>
    );
  }

  if (!data?.allowed) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
            Manager access denied
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            The fleet workspace is restricted to the reserved manager account. This
            attempt has been recorded in the activity log.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/live">Go to Live detection</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
