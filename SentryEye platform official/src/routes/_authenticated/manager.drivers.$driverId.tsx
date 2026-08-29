import { OfflineDataNotice } from "@/components/fleet/offline-data-notice";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PeriodTabs } from "@/components/fleet/period-tabs";
import { RecommendationBadge, RiskBadge, TrendPill } from "@/components/fleet/risk-badge";
import { useShift } from "@/features/fleet/shift-context";
import {
  explainRisk,
  fetchDailyStats,
  fetchDrivers,
  fetchSafetyEvents,
  fetchShiftHistory,
  periodDays,
  periodRange,
  summariseDriver,
} from "@/features/fleet/fleet-data";
import { eventTypeLabel } from "@/features/fleet/event-mapping";
import type { PeriodKey, RiskLevel } from "@/features/fleet/types";

export const Route = createFileRoute("/_authenticated/manager/drivers/$driverId")({
  head: () => ({
    meta: [
      { title: "Driver safety detail — evidence behind the score | SentryEye" },
      {
        name: "description",
        content:
          "Per-driver drowsiness history: safety score trend, shift-by-shift reports, recorded safety events and the evidence behind each risk classification.",
      },
      { property: "og:title", content: "Driver safety detail — SentryEye" },
      {
        property: "og:description",
        content: "Shift reports, safety events and risk evidence for a single driver.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriverDetail,
});

function DriverDetail() {
  const { driverId } = Route.useParams();
  const { isManager } = useShift();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const range = periodRange(period);
  const days = periodDays(period);

  const drivers = useQuery({ queryKey: ["fleet-drivers"], enabled: isManager, queryFn: fetchDrivers });
  const current = useQuery({
    queryKey: ["driver-daily", driverId, period],
    enabled: isManager,
    queryFn: () => fetchDailyStats(range.from, range.to, driverId),
  });
  const previous = useQuery({
    queryKey: ["driver-daily-prev", driverId, period],
    enabled: isManager,
    queryFn: () => fetchDailyStats(range.prevFrom, range.prevTo, driverId),
  });
  const shifts = useQuery({
    queryKey: ["driver-shifts", driverId],
    enabled: isManager,
    queryFn: () => fetchShiftHistory(driverId, 30),
  });
  const events = useQuery({
    queryKey: ["driver-events", driverId],
    enabled: isManager,
    queryFn: () => fetchSafetyEvents(60, driverId),
  });

  if (!isManager) {
    return <p className="text-sm text-muted-foreground">Manager access required.</p>;
  }

  const driver = (drivers.data ?? []).find((d) => d.id === driverId);
  if (!driver) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Driver not found in your organization.</p>
        <Button asChild size="sm" variant="outline">
          <Link to="/manager/drivers">Back to drivers</Link>
        </Button>
      </div>
    );
  }

  const summary = summariseDriver(driver, current.data ?? [], previous.data ?? [], days, null);
  const evidence = explainRisk(summary, days);
  const chart = (current.data ?? []).map((r) => ({
    date: r.date.slice(5),
    score: Math.round(r.safetyScore),
    events: r.totalEvents,
  }));

  return (
    <div className="space-y-6">
      <OfflineDataNotice />

      <div>
        <Button asChild size="sm" variant="ghost" className="mb-2 -ml-2">
          <Link to="/manager/drivers">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" /> Drivers
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{driver.fullName}</h1>
            <p className="text-sm text-muted-foreground">
              {driver.employeeRef ?? "No employee reference"} · {driver.status}
            </p>
          </div>
          <PeriodTabs value={period} onChange={setPeriod} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <RiskBadge level={summary.riskLevel} />
        <RecommendationBadge value={summary.recommendation} />
        <TrendPill trend={summary.trend} pct={summary.trendPct} />
        <span className="font-mono text-sm">Score {summary.safetyScore.toFixed(0)}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Why this classification</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {evidence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            These figures are AI-derived estimates from on-device detection. Review the underlying
            shifts before any personnel decision.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Score and alerts over time</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          {chart.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="hsl(var(--primary))" dot={false} />
                <Line type="monotone" dataKey="events" stroke="hsl(var(--destructive))" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground">No finalized shifts in this period.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shift reports</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Engine</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(shifts.data ?? []).map((s) => {
                const r = (Array.isArray(s.shift_reports) ? s.shift_reports[0] : s.shift_reports) as
                  | { safety_score: number; risk_level: RiskLevel; total_events: number }
                  | null
                  | undefined;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">
                      {new Date(s.started_at).toLocaleString()}
                    </TableCell>
                    <TableCell>{Math.round((s.duration_seconds ?? 0) / 60)} min</TableCell>
                    <TableCell>{r?.total_events ?? 0}</TableCell>
                    <TableCell className="font-mono">
                      {r ? Math.round(r.safety_score) : "—"}
                    </TableCell>
                    <TableCell>{r ? <RiskBadge level={r.risk_level} /> : "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {s.model_name ?? "—"} / {s.execution_provider ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!shifts.data?.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    No shifts recorded.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent safety events</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Behaviour</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(events.data ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">
                    {new Date(e.started_at).toLocaleString()}
                  </TableCell>
                  <TableCell>{eventTypeLabel(e.event_type)}</TableCell>
                  <TableCell>
                    <RiskBadge level={e.severity as RiskLevel} />
                  </TableCell>
                  <TableCell className="font-mono">
                    {(e.duration_seconds ?? 0).toFixed(1)}s
                  </TableCell>
                  <TableCell className="font-mono">
                    {Math.round((e.confidence ?? 0) * 100)}%
                  </TableCell>
                </TableRow>
              ))}
              {!events.data?.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    No safety events recorded for this driver.
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
