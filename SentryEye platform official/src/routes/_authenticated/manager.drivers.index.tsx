import { OfflineDataNotice } from "@/components/fleet/offline-data-notice";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PeriodTabs } from "@/components/fleet/period-tabs";
import { RecommendationBadge, RiskBadge, TrendPill } from "@/components/fleet/risk-badge";
import { useShift } from "@/features/fleet/shift-context";
import {
  fetchDailyStats,
  fetchDrivers,
  periodDays,
  periodRange,
  summariseDriver,
  type DailyStatRow,
} from "@/features/fleet/fleet-data";
import type { PeriodKey } from "@/features/fleet/types";

export const Route = createFileRoute("/_authenticated/manager/drivers/")({
  head: () => ({
    meta: [
      { title: "Fleet drivers — safety scores and risk ranking | SentryEye" },
      {
        name: "description",
        content:
          "Every monitored driver ranked by safety score, drowsiness rate, critical events and trend, with drill-down into individual shift evidence.",
      },
      { property: "og:title", content: "Fleet drivers — SentryEye" },
      {
        property: "og:description",
        content: "Driver safety scores, drowsiness rates and risk ranking for fleet managers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriversTable,
});

function DriversTable() {
  const { isManager } = useShift();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [q, setQ] = useState("");
  const range = periodRange(period);
  const days = periodDays(period);

  const drivers = useQuery({ queryKey: ["fleet-drivers"], enabled: isManager, queryFn: fetchDrivers });
  const current = useQuery({
    queryKey: ["fleet-daily", period],
    enabled: isManager,
    queryFn: () => fetchDailyStats(range.from, range.to),
  });
  const previous = useQuery({
    queryKey: ["fleet-daily-prev", period],
    enabled: isManager,
    queryFn: () => fetchDailyStats(range.prevFrom, range.prevTo),
  });

  const summaries = useMemo(() => {
    const group = (list: DailyStatRow[]) => {
      const m = new Map<string, DailyStatRow[]>();
      for (const r of list) m.set(r.driverId, [...(m.get(r.driverId) ?? []), r]);
      return m;
    };
    const nowMap = group(current.data ?? []);
    const prevMap = group(previous.data ?? []);
    return (drivers.data ?? [])
      .map((d) => summariseDriver(d, nowMap.get(d.id) ?? [], prevMap.get(d.id) ?? [], days, null))
      .filter((s) => s.fullName.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => a.safetyScore - b.safetyScore);
  }, [drivers.data, current.data, previous.data, days, q]);

  if (!isManager) {
    return <p className="text-sm text-muted-foreground">Manager access required.</p>;
  }

  return (
    <div className="space-y-6">
      <OfflineDataNotice />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Drivers</h1>
          <p className="text-sm text-muted-foreground">
            Ranked by safety score for the selected period.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search drivers"
            aria-label="Search drivers"
            className="w-48"
          />
          <PeriodTabs value={period} onChange={setPeriod} />
        </div>
      </header>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Drowsiness/h</TableHead>
                <TableHead>Alerts/day</TableHead>
                <TableHead>Critical</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Trend</TableHead>
                <TableHead>Recommendation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link
                      to="/manager/drivers/$driverId"
                      params={{ driverId: s.id }}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {s.fullName}
                    </Link>
                    {s.employeeRef ? (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {s.employeeRef}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono">{s.safetyScore.toFixed(0)}</TableCell>
                  <TableCell>
                    <RiskBadge level={s.riskLevel} />
                  </TableCell>
                  <TableCell className="font-mono">{s.drowsinessRate.toFixed(2)}</TableCell>
                  <TableCell className="font-mono">{s.avgAlertsPerDay.toFixed(1)}</TableCell>
                  <TableCell className="font-mono">{s.criticalEvents}</TableCell>
                  <TableCell className="font-mono">{s.monitoredHours.toFixed(1)}</TableCell>
                  <TableCell>
                    <TrendPill trend={s.trend} pct={s.trendPct} />
                  </TableCell>
                  <TableCell>
                    <RecommendationBadge value={s.recommendation} />
                  </TableCell>
                </TableRow>
              ))}
              {!summaries.length ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-sm text-muted-foreground">
                    No drivers match this view yet.
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
