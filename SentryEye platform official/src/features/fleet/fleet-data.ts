// Read layer for the manager and driver dashboards.
//
// Everything that spans more than a single shift is read from
// driver_daily_stats — the manager dashboard never scans raw safety_events.
// RLS scopes every query: drivers see only their own rows, managers see only
// their organization.

import { supabase } from "@/integrations/supabase/client";
import { RISK_ORDER, recommendFor, trendDirection, trendPct, type TrendDirection } from "./safety-score";
import type { PeriodKey, Recommendation, RiskLevel, ShiftReport } from "./types";
import { PERIODS } from "./types";
import { mapReportRow } from "./shift-sync";

export interface DailyStatRow {
  date: string;
  driverId: string;
  monitoredSeconds: number;
  completedShifts: number;
  totalEvents: number;
  criticalEvents: number;
  drowsinessEvents: number;
  eyesClosedEvents: number;
  yawningEvents: number;
  phoneUsageEvents: number;
  eventRate: number;
  drowsinessRate: number;
  safetyScore: number;
  riskLevel: RiskLevel;
}

export interface DriverRow {
  id: string;
  fullName: string;
  employeeRef: string | null;
  status: string;
  userId: string;
}

export interface DriverSummary extends DriverRow {
  safetyScore: number;
  riskLevel: RiskLevel;
  drowsinessRate: number;
  avgAlertsPerDay: number;
  criticalEvents: number;
  monitoredHours: number;
  completedShifts: number;
  trend: TrendDirection;
  trendPct: number | null;
  recommendation: Recommendation;
  lastShiftAt: string | null;
  daysAtRisk: number;
}

export function periodDays(key: PeriodKey): number {
  return PERIODS.find((p) => p.key === key)?.days ?? 30;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function periodRange(key: PeriodKey) {
  const days = periodDays(key);
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  return {
    days,
    from: isoDate(start),
    to: isoDate(end),
    prevFrom: isoDate(prevStart),
    prevTo: isoDate(prevEnd),
  };
}

function mapDaily(row: Record<string, unknown>): DailyStatRow {
  const n = (k: string) => Number(row[k] ?? 0) || 0;
  return {
    date: String(row["date"]),
    driverId: String(row["driver_id"]),
    monitoredSeconds: n("monitored_seconds"),
    completedShifts: n("completed_shifts"),
    totalEvents: n("total_events"),
    criticalEvents: n("critical_events"),
    drowsinessEvents: n("drowsiness_events"),
    eyesClosedEvents: n("eyes_closed_events"),
    yawningEvents: n("yawning_events"),
    phoneUsageEvents: n("phone_usage_events"),
    eventRate: n("event_rate"),
    drowsinessRate: n("drowsiness_rate"),
    safetyScore: n("safety_score"),
    riskLevel: (row["risk_level"] as RiskLevel) ?? "low",
  };
}

export async function fetchDailyStats(
  from: string,
  to: string,
  driverId?: string,
): Promise<DailyStatRow[]> {
  let q = supabase
    .from("driver_daily_stats")
    .select("*")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });
  if (driverId) q = q.eq("driver_id", driverId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => mapDaily(r as Record<string, unknown>));
}

export async function fetchDrivers(): Promise<DriverRow[]> {
  const { data, error } = await supabase
    .from("drivers")
    .select("id, full_name, employee_ref, status, user_id")
    .order("full_name");
  if (error) throw error;
  return (data ?? []).map((d) => ({
    id: d.id,
    fullName: d.full_name,
    employeeRef: d.employee_ref,
    status: d.status,
    userId: d.user_id,
  }));
}

export async function fetchRecentReports(limit = 10, driverId?: string): Promise<ShiftReport[]> {
  let q = supabase
    .from("shift_reports")
    .select("*, shifts(started_at, ended_at, duration_seconds)")
    .order("finalized_at", { ascending: false })
    .limit(limit);
  if (driverId) q = q.eq("driver_id", driverId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => mapReportRow(r as Record<string, unknown>));
}

/**
 * Most recent finalized report timestamp per driver. Used to order the manager
 * dashboard newest-first without pulling every report body.
 */
export async function fetchLatestReportTimes(): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("shift_reports")
    .select("driver_id, finalized_at")
    .order("finalized_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const id = String((row as Record<string, unknown>)["driver_id"] ?? "");
    const at = String((row as Record<string, unknown>)["finalized_at"] ?? "");
    if (id && at && !map[id]) map[id] = at;
  }
  return map;
}

export async function fetchActiveShiftCount(): Promise<number> {
  const { count, error } = await supabase
    .from("shifts")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  if (error) throw error;
  return count ?? 0;
}

export interface PeriodTotals {
  monitoredHours: number;
  completedShifts: number;
  totalEvents: number;
  criticalEvents: number;
  drowsinessEvents: number;
  eyesClosedEvents: number;
  yawningEvents: number;
  phoneUsageEvents: number;
  eventRate: number;
  drowsinessRate: number;
  safetyScore: number;
  riskLevel: RiskLevel;
  days: number;
}

export function totalsFor(rows: DailyStatRow[]): PeriodTotals {
  const monitoredSeconds = rows.reduce((a, r) => a + r.monitoredSeconds, 0);
  const totalEvents = rows.reduce((a, r) => a + r.totalEvents, 0);
  const drowsy = rows.reduce((a, r) => a + r.drowsinessEvents + r.eyesClosedEvents, 0);
  const hours = Math.max(monitoredSeconds / 3600, 1 / 60);
  const weighted = rows.reduce((a, r) => a + r.safetyScore * Math.max(r.completedShifts, 1), 0);
  const weight = rows.reduce((a, r) => a + Math.max(r.completedShifts, 1), 0);
  const safetyScore = weight ? weighted / weight : 100;
  const riskLevel: RiskLevel =
    safetyScore >= 85 ? "low" : safetyScore >= 70 ? "moderate" : safetyScore >= 50 ? "high" : "critical";
  return {
    monitoredHours: monitoredSeconds / 3600,
    completedShifts: rows.reduce((a, r) => a + r.completedShifts, 0),
    totalEvents,
    criticalEvents: rows.reduce((a, r) => a + r.criticalEvents, 0),
    drowsinessEvents: rows.reduce((a, r) => a + r.drowsinessEvents, 0),
    eyesClosedEvents: rows.reduce((a, r) => a + r.eyesClosedEvents, 0),
    yawningEvents: rows.reduce((a, r) => a + r.yawningEvents, 0),
    phoneUsageEvents: rows.reduce((a, r) => a + r.phoneUsageEvents, 0),
    eventRate: totalEvents / hours,
    drowsinessRate: drowsy / hours,
    safetyScore,
    riskLevel,
    days: rows.length,
  };
}

export function summariseDriver(
  driver: DriverRow,
  current: DailyStatRow[],
  previous: DailyStatRow[],
  days: number,
  lastShiftAt: string | null,
): DriverSummary {
  const now = totalsFor(current);
  const before = totalsFor(previous);
  const pct = trendPct(now.drowsinessRate, before.drowsinessRate);
  const daysAtRisk = current.filter(
    (r) => RISK_ORDER.indexOf(r.riskLevel) >= RISK_ORDER.indexOf("high"),
  ).length;

  let recommendation = recommendFor(now.riskLevel);
  if (recommendation === "needs_attention" && daysAtRisk >= Math.ceil(days * 0.5)) {
    recommendation = "high_risk";
  }

  return {
    ...driver,
    safetyScore: now.safetyScore,
    riskLevel: now.riskLevel,
    drowsinessRate: now.drowsinessRate,
    avgAlertsPerDay: days ? now.totalEvents / days : 0,
    criticalEvents: now.criticalEvents,
    monitoredHours: now.monitoredHours,
    completedShifts: now.completedShifts,
    trend: trendDirection(pct),
    trendPct: pct,
    recommendation,
    lastShiftAt,
    daysAtRisk,
  };
}

/** Plain-language evidence behind a classification — never a bare verdict. */
export function explainRisk(summary: DriverSummary, days: number): string[] {
  const lines: string[] = [];
  lines.push(
    `Drowsiness rate ${summary.drowsinessRate.toFixed(1)} events/hour across ${summary.monitoredHours.toFixed(1)} monitored hours.`,
  );
  if (summary.trendPct !== null) {
    const dir = summary.trendPct >= 0 ? "up" : "down";
    lines.push(
      `Drowsiness is ${dir} ${Math.abs(summary.trendPct).toFixed(0)}% versus the previous ${days} days.`,
    );
  } else {
    lines.push(`No comparable data for the previous ${days} days.`);
  }
  if (summary.criticalEvents > 0) {
    lines.push(`${summary.criticalEvents} critical event(s) recorded in this period.`);
  }
  if (summary.daysAtRisk > 0) {
    lines.push(`${summary.daysAtRisk} of the last ${days} days were classified high or critical.`);
  }
  lines.push(`${summary.completedShifts} completed shift(s) contributed to this score.`);
  return lines;
}

export async function fetchShiftHistory(driverId?: string, limit = 50) {
  let q = supabase
    .from("shifts")
    .select(
      "id, started_at, ended_at, duration_seconds, monitored_seconds, status, model_name, execution_provider, sync_status, shift_reports(safety_score, risk_level, total_events, drowsiness_events, critical_events, recommendation)",
    )
    .order("started_at", { ascending: false })
    .limit(limit);
  if (driverId) q = q.eq("driver_id", driverId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchSafetyEvents(limit = 100, driverId?: string) {
  let q = supabase
    .from("safety_events")
    .select("id, event_type, severity, confidence, started_at, duration_seconds, driver_id, shift_id")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (driverId) q = q.eq("driver_id", driverId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Fleet sync health
//
// Shifts are recorded offline first, so "pending" means the cloud copy has not
// reached its final state yet: a shift row that never finished uploading
// (sync_status other than `synced`), a completed shift with no finalised
// report, or an "active" shift that has been running far longer than a real
// driving shift — the usual signature of a phone that went offline mid-shift.
// ---------------------------------------------------------------------------

const STALE_ACTIVE_HOURS = 12;

export interface PendingDriverSync {
  driverId: string;
  driverName: string;
  pendingShifts: number;
  erroredShifts: number;
  oldestPendingAt: string | null;
}

export interface FleetSyncHealth {
  driversWithPending: number;
  pendingShifts: number;
  erroredShifts: number;
  staleActiveShifts: number;
  syncedLast24h: number;
  lastSyncedAt: string | null;
  oldestPendingAt: string | null;
  drivers: PendingDriverSync[];
}

export async function fetchFleetSyncHealth(): Promise<FleetSyncHealth> {
  const since = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  const { data, error } = await supabase
    .from("shifts")
    .select("id, driver_id, status, sync_status, started_at, finalized_at, drivers(full_name)")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  const staleBefore = Date.now() - STALE_ACTIVE_HOURS * 3600_000;
  const dayAgo = Date.now() - 24 * 3600_000;
  const perDriver = new Map<string, PendingDriverSync>();
  let pendingShifts = 0;
  let erroredShifts = 0;
  let staleActiveShifts = 0;
  let syncedLast24h = 0;
  let lastSyncedAt: string | null = null;
  let oldestPendingAt: string | null = null;

  for (const raw of data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const status = String(row["status"] ?? "");
    const sync = String(row["sync_status"] ?? "");
    const startedAt = String(row["started_at"] ?? "");
    const finalizedAt = (row["finalized_at"] as string | null) ?? null;
    const startedMs = Date.parse(startedAt);

    const stale = status === "active" && Number.isFinite(startedMs) && startedMs < staleBefore;
    if (stale) staleActiveShifts += 1;

    const errored = sync === "sync_error";
    const unsynced = sync !== "synced" || (status === "completed" && !finalizedAt);
    const pending = unsynced || stale;

    if (finalizedAt) {
      const ms = Date.parse(finalizedAt);
      if (Number.isFinite(ms) && ms > dayAgo) syncedLast24h += 1;
      if (!lastSyncedAt || ms > Date.parse(lastSyncedAt)) lastSyncedAt = finalizedAt;
    }

    if (!pending) continue;
    pendingShifts += 1;
    if (errored) erroredShifts += 1;
    if (!oldestPendingAt || startedMs < Date.parse(oldestPendingAt)) oldestPendingAt = startedAt;

    const driverId = String(row["driver_id"] ?? "");
    const joined = (row["drivers"] ?? null) as { full_name?: string } | null;
    const entry = perDriver.get(driverId) ?? {
      driverId,
      driverName: joined?.full_name ?? "Driver",
      pendingShifts: 0,
      erroredShifts: 0,
      oldestPendingAt: null,
    };
    entry.pendingShifts += 1;
    if (errored) entry.erroredShifts += 1;
    if (!entry.oldestPendingAt || startedMs < Date.parse(entry.oldestPendingAt)) {
      entry.oldestPendingAt = startedAt;
    }
    perDriver.set(driverId, entry);
  }

  return {
    driversWithPending: perDriver.size,
    pendingShifts,
    erroredShifts,
    staleActiveShifts,
    syncedLast24h,
    lastSyncedAt,
    oldestPendingAt,
    drivers: [...perDriver.values()].sort((a, b) => b.pendingShifts - a.pendingShifts),
  };
}
