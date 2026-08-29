// Fleet-wide sync health: how many drivers still have shifts that never
// finished reaching the cloud, and how fresh the last successful upload is.

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CloudOff, CloudUpload, RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchFleetSyncHealth } from "@/features/fleet/fleet-data";
import { cn } from "@/lib/utils";

function relative(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function SyncHealthCard() {
  const health = useQuery({
    queryKey: ["fleet-sync-health"],
    queryFn: fetchFleetSyncHealth,
    refetchInterval: 60_000,
  });

  const data = health.data;
  const healthy = !!data && data.pendingShifts === 0;
  const degraded = !!data && (data.erroredShifts > 0 || data.staleActiveShifts > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          {healthy ? (
            <CloudUpload className="h-4 w-4 text-safe" aria-hidden="true" />
          ) : degraded ? (
            <TriangleAlert className="h-4 w-4 text-destructive" aria-hidden="true" />
          ) : (
            <CloudOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          Offline shift sync
        </CardTitle>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void health.refetch()}
          disabled={health.isFetching}
        >
          <RefreshCw
            className={cn("mr-2 h-4 w-4", health.isFetching && "animate-spin")}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Drivers with pending shifts" value={String(data?.driversWithPending ?? 0)} />
          <Stat label="Shifts awaiting upload" value={String(data?.pendingShifts ?? 0)} />
          <Stat
            label="Failed uploads"
            value={String(data?.erroredShifts ?? 0)}
            tone={data && data.erroredShifts > 0 ? "bad" : undefined}
          />
          <Stat label="Last successful sync" value={relative(data?.lastSyncedAt ?? null)} />
        </div>

        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {health.isError
            ? "Sync health is unavailable right now."
            : healthy
              ? `Everything is uploaded. ${data?.syncedLast24h ?? 0} shift reports finalised in the last 24 hours.`
              : data
                ? `Oldest pending shift started ${relative(data.oldestPendingAt)}${
                    data.staleActiveShifts > 0
                      ? ` · ${data.staleActiveShifts} shift(s) still marked active for over 12 hours`
                      : ""
                  }. Pending shifts upload by themselves the moment the driver's device is back online.`
                : "Checking fleet sync status…"}
        </p>

        {data?.drivers.length ? (
          <ul className="space-y-2">
            {data.drivers.slice(0, 5).map((d) => (
              <li key={d.driverId}>
                <Link
                  to="/manager/drivers/$driverId"
                  params={{ driverId: d.driverId }}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/50"
                >
                  <span className="font-medium">{d.driverName}</span>
                  <span className="text-xs text-muted-foreground">
                    {d.pendingShifts} pending
                    {d.erroredShifts > 0 ? ` · ${d.erroredShifts} failed` : ""} · oldest{" "}
                    {relative(d.oldestPendingAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold", tone === "bad" && "text-destructive")}>
        {value}
      </p>
    </div>
  );
}
