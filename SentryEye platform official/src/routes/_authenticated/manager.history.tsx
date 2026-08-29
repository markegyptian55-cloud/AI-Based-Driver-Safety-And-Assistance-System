import { OfflineDataNotice } from "@/components/fleet/offline-data-notice";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PeriodTabs } from "@/components/fleet/period-tabs";
import { RiskBadge } from "@/components/fleet/risk-badge";
import { useShift } from "@/features/fleet/shift-context";
import { fetchDailyStats, fetchRecentReports, periodRange, totalsFor } from "@/features/fleet/fleet-data";
import type { PeriodKey } from "@/features/fleet/types";

export const Route = createFileRoute("/_authenticated/manager/history")({
  head: () => ({
    meta: [
      { title: "Fleet history — past shift reports by period | SentryEye" },
      {
        name: "description",
        content:
          "Browse finalized fleet shift reports and safety totals by day, week, month or year to support driver decisions.",
      },
      { property: "og:title", content: "Fleet history — SentryEye" },
      {
        property: "og:description",
        content: "Finalized fleet shift reports and safety totals across any period.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ManagerHistory,
});

function ManagerHistory() {
  const { isManager, identityLoading } = useShift();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const range = periodRange(period);

  const daily = useQuery({
    queryKey: ["fleet-history-daily", period],
    enabled: isManager,
    queryFn: () => fetchDailyStats(range.from, range.to),
  });
  const reports = useQuery({
    queryKey: ["fleet-history-reports"],
    enabled: isManager,
    queryFn: () => fetchRecentReports(100),
  });

  if (identityLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!isManager) {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Manager access required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Fleet history is limited to fleet managers in your organization.</p>
          <Link to="/live" className="text-primary underline-offset-4 hover:underline">
            Go to Live detection
          </Link>
        </CardContent>
      </Card>
    );
  }

  const totals = totalsFor(daily.data ?? []);
  const inRange = (reports.data ?? []).filter((r) => {
    const t = new Date(r.startedAt).getTime();
    return t >= new Date(range.from).getTime() && t <= new Date(range.to).getTime() + 86_400_000;
  });

  return (
    <div className="space-y-6">
      <OfflineDataNotice />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fleet history</h1>
          <p className="text-sm text-muted-foreground">
            Finalized shift reports across the whole fleet for the selected period.
          </p>
        </div>
        <PeriodTabs value={period} onChange={setPeriod} />
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Avg safety score" value={totals.safetyScore.toFixed(0)} />
        <Kpi label="Shifts" value={String(totals.completedShifts)} />
        <Kpi label="Monitored hours" value={totals.monitoredHours.toFixed(1)} />
        <Kpi label="Critical events" value={String(totals.criticalEvents)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shift reports</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Monitored</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Critical</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Risk</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inRange.map((r) => (
                <TableRow key={r.shiftId}>
                  <TableCell>{r.driverName ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {new Date(r.startedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{Math.round(r.monitoredSeconds / 60)} min</TableCell>
                  <TableCell>{r.totalEvents}</TableCell>
                  <TableCell>{r.criticalEvents}</TableCell>
                  <TableCell className="font-mono">{Math.round(r.safetyScore)}</TableCell>
                  <TableCell>
                    <RiskBadge level={r.riskLevel} />
                  </TableCell>
                </TableRow>
              ))}
              {!inRange.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    No finalized shifts in this period.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-mono text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
