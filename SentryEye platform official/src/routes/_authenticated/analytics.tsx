import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsKpiGrid } from "@/components/analytics/analytics-kpis";
import { AnalyticsCharts } from "@/components/analytics/analytics-charts";
import { TelemetryCharts } from "@/components/analytics/telemetry-charts";
import { AnalyticsFilterBar } from "@/components/analytics/analytics-filters";
import { SessionComparison } from "@/components/analytics/session-comparison";
import { AnalyticsEmptyState } from "@/components/analytics/analytics-empty";
import {
  applyFilters,
  computeKpis,
  DEFAULT_FILTERS,
  fetchCompletedSessions,
  type AnalyticsFilters,
} from "@/features/analytics/analytics-data";
import { errorMessage } from "@/lib/format-error";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — SentryEye" },
      {
        name: "description",
        content:
          "Safety score, fatigue trends, alert distribution and eye-closure analytics from stored driver monitoring sessions.",
      },
      { property: "og:title", content: "Analytics — SentryEye" },
      {
        property: "og:description",
        content: "Visual analytics computed from completed driver monitoring session summaries.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);

  const query = useQuery({
    queryKey: ["analytics", "completed-sessions"],
    queryFn: fetchCompletedSessions,
    staleTime: 60_000,
  });

  const all = useMemo(() => query.data ?? [], [query.data]);
  const filtered = useMemo(() => applyFilters(all, filters), [all, filters]);
  const kpis = useMemo(() => computeKpis(filtered), [filtered]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aggregated from stored session summaries — no inference is re-run.
        </p>
      </div>

      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : query.error ? (
        <Card className="border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground">
          {errorMessage(query.error)}
        </Card>
      ) : all.length === 0 ? (
        <AnalyticsEmptyState />
      ) : (
        <>
          <AnalyticsFilterBar sessions={all} filters={filters} onChange={setFilters} />
          {filtered.length === 0 ? (
            <AnalyticsEmptyState filtered />
          ) : (
            <>
              <AnalyticsKpiGrid kpis={kpis} />
              <AnalyticsCharts sessions={filtered} />
              <TelemetryCharts sessions={filtered} />
              <SessionComparison sessions={filtered} />
            </>
          )}
        </>
      )}
    </div>
  );
}
