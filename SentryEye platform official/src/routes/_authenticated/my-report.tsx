import { OfflineDataNotice } from "@/components/fleet/offline-data-notice";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PeriodTabs } from "@/components/fleet/period-tabs";
import { RiskBadge } from "@/components/fleet/risk-badge";
import { useShift } from "@/features/fleet/shift-context";
import {
  fetchDailyStats,
  fetchShiftHistory,
  periodRange,
  totalsFor,
} from "@/features/fleet/fleet-data";
import { trendDirection, trendPct } from "@/features/fleet/safety-score";
import type { PeriodKey, RiskLevel } from "@/features/fleet/types";

export const Route = createFileRoute("/_authenticated/my-report")({
  head: () => ({
    meta: [
      { title: "My report — personal driving safety history | SentryEye" },
      {
        name: "description",
        content:
          "Your own shift reports, drowsiness rate, safety score and behaviour trends over the last 7, 30, 90 or 365 days.",
      },
      { property: "og:title", content: "My report — SentryEye" },
      {
        property: "og:description",
        content: "Personal driving safety history, trends and finalized shift reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyReportPage,
});

function MyReportPage() {
  const { identity } = useShift();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const range = periodRange(period);

  const daily = useQuery({
    queryKey: ["my-daily", identity?.driverId, period],
    enabled: !!identity?.driverId,
    queryFn: () => fetchDailyStats(range.from, range.to, identity!.driverId),
  });
  const prev = useQuery({
    queryKey: ["my-daily-prev", identity?.driverId, period],
    enabled: !!identity?.driverId,
    queryFn: () => fetchDailyStats(range.prevFrom, range.prevTo, identity!.driverId),
  });
  const shifts = useQuery({
    queryKey: ["my-shifts", identity?.driverId],
    enabled: !!identity?.driverId,
    queryFn: () => fetchShiftHistory(identity!.driverId, 50),
  });

  if (!identity) {
    return <p className="text-sm text-muted-foreground">Sign in to see your safety history.</p>;
  }

  const rows = daily.data ?? [];
  const totals = totalsFor(rows);
  const before = totalsFor(prev.data ?? []);
  const pct = trendPct(totals.drowsinessRate, before.drowsinessRate);
  const dir = trendDirection(pct);

  const chart = rows.map((r) => ({
    date: r.date.slice(5),
    score: Math.round(r.safetyScore),
    drowsiness: Number(r.drowsinessRate.toFixed(2)),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <OfflineDataNotice />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My report</h1>
          <p className="text-sm text-muted-foreground">
            Only your own shifts are visible here — never another driver's.
          </p>
        </div>
        <PeriodTabs value={period} onChange={setPeriod} />
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Safety score" value={totals.safetyScore.toFixed(0)} />
        <Kpi label="Completed shifts" value={String(totals.completedShifts)} />
        <Kpi label="Monitored hours" value={totals.monitoredHours.toFixed(1)} />
        <Kpi label="Total alerts" value={String(totals.totalEvents)} />
        <Kpi label="Critical events" value={String(totals.criticalEvents)} />
        <Kpi label="Drowsiness / hour" value={totals.drowsinessRate.toFixed(2)} />
        <Kpi label="Yawning events" value={String(totals.yawningEvents)} />
        <Kpi
          label="Trend"
          value={pct === null ? dir : `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Safety score and drowsiness over time</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {chart.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="score"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary) / 0.2)"
                />
                <Area
                  type="monotone"
                  dataKey="drowsiness"
                  stroke="hsl(var(--destructive))"
                  fill="hsl(var(--destructive) / 0.15)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground">
              No finalized shifts in this period yet. Start a shift from{" "}
              <Link to="/live" className="text-primary underline-offset-4 hover:underline">
                Live detection
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shift history</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Drowsiness</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(shifts.data ?? []).map((s) => {
                const report = (Array.isArray(s.shift_reports) ? s.shift_reports[0] : s.shift_reports) as
                  | { safety_score: number; risk_level: RiskLevel; total_events: number; drowsiness_events: number }
                  | null
                  | undefined;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      {new Date(s.started_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{Math.round((s.duration_seconds ?? 0) / 60)} min</TableCell>
                    <TableCell>{report?.total_events ?? 0}</TableCell>
                    <TableCell>{report?.drowsiness_events ?? 0}</TableCell>
                    <TableCell className="font-mono">
                      {report ? Math.round(report.safety_score) : "—"}
                    </TableCell>
                    <TableCell>
                      {report ? <RiskBadge level={report.risk_level} /> : "—"}
                    </TableCell>
                    <TableCell className="text-xs capitalize text-muted-foreground">
                      {s.status}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!shifts.data?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-sm text-muted-foreground">
                    No shifts recorded yet.
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
