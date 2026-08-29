import { OfflineDataNotice } from "@/components/fleet/offline-data-notice";
import { SyncHealthCard } from "@/components/fleet/sync-health-card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { ManagerOnly } from "@/components/fleet/manager-only";
import { recordDashboardRefresh } from "@/lib/manager.functions";

import { ManagerCharts } from "@/components/fleet/manager-charts";


import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PeriodTabs } from "@/components/fleet/period-tabs";
import { RiskBadge, RecommendationBadge, TrendPill } from "@/components/fleet/risk-badge";
import { useShift } from "@/features/fleet/shift-context";
import {
  fetchActiveShiftCount,
  fetchDailyStats,
  fetchDrivers,
  fetchLatestReportTimes,
  periodDays,
  periodRange,
  summariseDriver,
  totalsFor,
  type DailyStatRow,
} from "@/features/fleet/fleet-data";
import { RISK_ORDER, trendDirection, trendPct } from "@/features/fleet/safety-score";
import type { PeriodKey, RiskLevel } from "@/features/fleet/types";

/** Timestamp of the last time this browser looked at the reports card. */
const SEEN_KEY = "sentryeye.fleet.reports-seen";

// Toast throttling. A fleet coming back online can sync a dozen shifts at
// once; individual toasts for each would bury the screen, so past three in a
// two-second window they collapse into a single grouped notice.
let burstCount = 0;
let burstResetAt = 0;
let groupedPending = 0;
let groupedTimer: ReturnType<typeof setTimeout> | null = null;

function announceReport(row: Record<string, unknown>, names: Record<string, string>) {
  const now = Date.now();
  if (now > burstResetAt) {
    burstCount = 0;
    burstResetAt = now + 2000;
  }
  burstCount += 1;

  if (burstCount > 3) {
    groupedPending += 1;
    if (groupedTimer) clearTimeout(groupedTimer);
    groupedTimer = setTimeout(() => {
      toast.info(`${groupedPending} new shift reports synced`);
      groupedPending = 0;
      groupedTimer = null;
    }, 1200);
    return;
  }

  const driverId = String(row["driver_id"] ?? "");
  const name = names[driverId] ?? "A driver";
  const score = Number(row["safety_score"] ?? 0);
  const events = Number(row["total_events"] ?? 0);
  const risk = String(row["risk_level"] ?? "low");
  const message = `New shift report — ${name}`;
  const description = `Safety score ${score.toFixed(0)} · ${events} alerts · ${risk} risk`;
  if (risk === "critical" || risk === "high") toast.warning(message, { description });
  else toast.success(message, { description });
}

/** "2 min ago" / "Today 14:22" / "Aug 20" — short and unambiguous. */
function relativeTime(iso: string | null): string {
  if (!iso) return "No reports yet";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "No reports yet";
  const diff = Date.now() - then;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  const d = new Date(then);
  const sameDay = new Date().toDateString() === d.toDateString();
  if (sameDay) return `Today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (diff < 7 * 86_400_000)
    return d.toLocaleDateString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const DATE_WINDOWS: Record<"all" | "today" | "7d" | "30d", number> = {
  all: Number.POSITIVE_INFINITY,
  today: 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

const RISK_LEVELS: RiskLevel[] = ["low", "moderate", "high", "critical"];


export const Route = createFileRoute("/_authenticated/manager/")({
  head: () => ({
    meta: [
      { title: "Fleet safety dashboard — drowsiness risk across drivers | SentryEye" },
      {
        name: "description",
        content:
          "Manager view of fleet-wide drowsiness risk: safety scores, alert rates, high-risk drivers and trends across any reporting period.",
      },
      { property: "og:title", content: "Fleet safety dashboard — SentryEye" },
      {
        property: "og:description",
        content: "Fleet-wide drowsiness risk, safety scores and driver trends for managers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ManagerOnly>
      <ManagerDashboard />
    </ManagerOnly>
  ),
});

function ManagerDashboard() {
  const { identity } = useShift();
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const range = periodRange(period);
  const days = periodDays(period);
  const isManager = identity?.role === "manager" || identity?.role === "admin";

  // Polling fallback: even if the realtime socket drops (captive wifi, mobile
  // background tab, proxy), the dashboard is never more than 30s stale, and it
  // refetches the moment the window regains focus.
  const live = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const;

  const drivers = useQuery({
    queryKey: ["fleet-drivers"],
    enabled: isManager,
    queryFn: fetchDrivers,
    ...live,
  });
  const current = useQuery({
    queryKey: ["fleet-daily", period],
    enabled: isManager,
    queryFn: () => fetchDailyStats(range.from, range.to),
    ...live,
  });
  const previous = useQuery({
    queryKey: ["fleet-daily-prev", period],
    enabled: isManager,
    queryFn: () => fetchDailyStats(range.prevFrom, range.prevTo),
    ...live,
  });
  const activeShifts = useQuery({
    queryKey: ["fleet-active"],
    enabled: isManager,
    queryFn: fetchActiveShiftCount,
    ...live,
  });
  // Newest finalized report per driver — drives the "Latest" ordering and the
  // unread counter on the reports card.
  const latestReports = useQuery({
    queryKey: ["fleet-latest-reports"],
    enabled: isManager,
    queryFn: fetchLatestReportTimes,
    ...live,
  });

  const [sortMode, setSortMode] = useState<"latest" | "score">("latest");
  const [driverFilter, setDriverFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<RiskLevel[]>([]);
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "7d" | "30d">("all");
  const [lastSeen, setLastSeen] = useState<number>(() => {
    if (typeof localStorage === "undefined") return Date.now();
    return Number(localStorage.getItem(SEEN_KEY) ?? 0) || Date.now();
  });

  const markSeen = () => {
    const now = Date.now();
    setLastSeen(now);
    try {
      localStorage.setItem(SEEN_KEY, String(now));
    } catch {
      /* private mode — the badge just resets per session */
    }
  };

  // Names for realtime toasts: the socket payload only carries driver_id.
  const driverNames = useRef<Record<string, string>>({});
  driverNames.current = Object.fromEntries((drivers.data ?? []).map((d) => [d.id, d.fullName]));


  // Manual refresh: refetch every fleet query behind this page (drivers, both
  // period windows, live shift count and the sync-health card).
  const queryClient = useQueryClient();
  const logRefresh = useServerFn(recordDashboardRefresh);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());

  const reload = async (manual: boolean) => {
    await queryClient.refetchQueries({
      predicate: (q) => String(q.queryKey[0] ?? "").startsWith("fleet-"),
    });
    setUpdatedAt(new Date());
    try {
      await logRefresh({ data: { manual } });
    } catch {
      /* audit logging must never break the dashboard */
    }
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await reload(true);
    } finally {
      setRefreshing(false);
    }
  };

  // Realtime: any new shift, finalized report or safety event pushes fresh
  // numbers into the dashboard within a second — no clicking required.
  useEffect(() => {
    if (!isManager) return;
    const channel = supabase
      .channel("fleet-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => {
        void reload(false);
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "shift_reports" },
        (payload) => {
          announceReport(payload.new as Record<string, unknown>, driverNames.current);
          void reload(false);
        },
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shift_reports" }, () => {
        void reload(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_daily_stats" }, () => {
        void reload(false);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager]);


  if (!isManager) {

    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="text-base">Manager access required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>This workspace is limited to fleet managers in your organization.</p>
          <Button asChild size="sm" variant="outline">
            <Link to="/live">Go to Live detection</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // The manager's own account also owns a driver record (it is how the fleet
  // schema links people to an organization). It is not a monitored driver, so
  // it is excluded from every list, chart and KPI on this page.
  const driverList = (drivers.data ?? []).filter((d) => d.userId !== identity?.userId);
  const selfDriverIds = new Set(
    (drivers.data ?? []).filter((d) => d.userId === identity?.userId).map((d) => d.id),
  );
  const notSelf = (r: DailyStatRow) => !selfDriverIds.has(r.driverId);

  const rows = (current.data ?? []).filter(notSelf);
  const prevRows = (previous.data ?? []).filter(notSelf);
  const totals = totalsFor(rows);
  const before = totalsFor(prevRows);
  const pct = trendPct(totals.drowsinessRate, before.drowsinessRate);

  const byDriver = (list: DailyStatRow[]) => {
    const map = new Map<string, DailyStatRow[]>();
    for (const r of list) map.set(r.driverId, [...(map.get(r.driverId) ?? []), r]);
    return map;
  };
  const nowMap = byDriver(rows);
  const prevMap = byDriver(prevRows);

  const reportTimes = latestReports.data ?? {};
  const summaries = driverList
    .map((d) => summariseDriver(d, nowMap.get(d.id) ?? [], prevMap.get(d.id) ?? [], days, null))
    .filter((s) => s.completedShifts > 0 || s.monitoredHours > 0)
    .sort((a, b) => a.safetyScore - b.safetyScore);

  // Reports feed: newest finalized report first by default, with the old
  // score ranking one click away. Filters apply to this list only.
  const reportedAt = (id: string) => {
    const at = reportTimes[id];
    return at ? new Date(at).getTime() : 0;
  };
  const window = DATE_WINDOWS[dateFilter];
  const feed = summaries
    .filter((s) => (driverFilter === "all" ? true : s.id === driverFilter))
    .filter((s) => (riskFilter.length ? riskFilter.includes(s.riskLevel) : true))
    .filter((s) => {
      if (!Number.isFinite(window)) return true;
      const at = reportedAt(s.id);
      return at > 0 && Date.now() - at <= window;
    })
    .sort((a, b) =>
      sortMode === "latest"
        ? reportedAt(b.id) - reportedAt(a.id)
        : a.safetyScore - b.safetyScore,
    );
  const unread = feed.filter((s) => reportedAt(s.id) > lastSeen).length;
  const toggleRisk = (level: RiskLevel) =>
    setRiskFilter((prev) =>
      prev.includes(level) ? prev.filter((r) => r !== level) : [...prev, level],
    );


  const atRisk = summaries.filter(
    (s) => RISK_ORDER.indexOf(s.riskLevel) >= RISK_ORDER.indexOf("high"),
  );

  const trendChart = Object.values(
    rows.reduce<Record<string, { date: string; events: number; score: number; n: number }>>(
      (acc, r) => {
        const key = r.date;
        acc[key] ??= { date: key.slice(5), events: 0, score: 0, n: 0 };
        acc[key]!.events += r.totalEvents;
        acc[key]!.score += r.safetyScore;
        acc[key]!.n += 1;
        return acc;
      },
      {},
    ),
  ).map((d) => ({ date: d.date, events: d.events, score: Math.round(d.score / Math.max(d.n, 1)) }));

  const worst = summaries.slice(0, 8).map((s) => ({
    name: s.fullName.split(" ")[0] ?? s.fullName,
    score: Math.round(s.safetyScore),
  }));

  return (
    <div className="space-y-6">
      <OfflineDataNotice />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Fleet safety</h1>
          <p className="text-sm text-muted-foreground">
            Your organization · AI-derived estimates, not medical
            or disciplinary determinations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[11px] text-muted-foreground">
            Updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <PeriodTabs value={period} onChange={setPeriod} />
        </div>
      </header>


      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Active shifts now" value={String(activeShifts.data ?? 0)} />
        <Kpi label="Drivers monitored" value={String(summaries.length)} />
        <Kpi label="Fleet safety score" value={totals.safetyScore.toFixed(0)} />
        <Kpi label="High-risk drivers" value={String(atRisk.length)} />
        <Kpi label="Monitored hours" value={totals.monitoredHours.toFixed(1)} />
        <Kpi label="Total alerts" value={String(totals.totalEvents)} />
        <Kpi label="Critical events" value={String(totals.criticalEvents)} />
        <Kpi
          label="Drowsiness trend"
          value={pct === null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`}
        />
      </div>

      <ManagerCharts rows={rows} summaries={summaries} />

      <SyncHealthCard />



      <Card onMouseEnter={unread ? markSeen : undefined}>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              Drivers needing attention
              {unread ? (
                <Badge className="rounded-full px-2" aria-label={`${unread} new reports`}>
                  {unread} new
                </Badge>
              ) : null}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Sort reports">
                {(["latest", "score"] as const).map((mode) => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={sortMode === mode ? "secondary" : "ghost"}
                    className="h-7 px-3 text-xs"
                    aria-pressed={sortMode === mode}
                    onClick={() => setSortMode(mode)}
                  >
                    {mode === "latest" ? "Latest" : "Score"}
                  </Button>
                ))}
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/manager/drivers">All drivers</Link>
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select value={driverFilter} onValueChange={setDriverFilter}>
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="Filter by driver">
                <SelectValue placeholder="All drivers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All drivers</SelectItem>
                {driverList.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={dateFilter}
              onValueChange={(v) => setDateFilter(v as typeof dateFilter)}
            >
              <SelectTrigger className="h-8 w-36 text-xs" aria-label="Filter by report date">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by risk level">
              {RISK_LEVELS.map((level) => (
                <Button
                  key={level}
                  size="sm"
                  variant={riskFilter.includes(level) ? "secondary" : "ghost"}
                  className="h-7 px-2 text-xs capitalize"
                  aria-pressed={riskFilter.includes(level)}
                  onClick={() => toggleRisk(level)}
                >
                  {level}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {feed.length ? (
            feed.slice(0, 8).map((s) => (
              <Link
                key={s.id}
                to="/manager/drivers/$driverId"
                params={{ driverId: s.id }}
                onClick={markSeen}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/50"
              >
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    {s.fullName}
                    {reportedAt(s.id) > lastSeen ? (
                      <span className="h-2 w-2 rounded-full bg-primary" aria-label="New report" />
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {relativeTime(reportTimes[s.id] ?? null)} · {s.drowsinessRate.toFixed(1)}{" "}
                    drowsiness events/hour · {s.completedShifts} shifts
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{s.safetyScore.toFixed(0)}</span>
                  <TrendPill trend={s.trend} pct={s.trendPct} />
                  <RiskBadge level={s.riskLevel} />
                  <RecommendationBadge value={s.recommendation} />
                </div>
              </Link>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No driver reports match these filters in this period.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyHint() {
  return (
    <p className="text-sm text-muted-foreground">
      No finalized shifts in this period yet. Data appears once drivers complete monitored shifts.
    </p>
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
