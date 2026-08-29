// Analytics data access + pure aggregation over stored session summaries.
// No inference, no recomputation of per-frame data — every number here comes
// from the persisted `sessions` row written when a session completes.

import { supabase } from "@/integrations/supabase/client";
import type { FatigueLevel } from "../drowsiness/safety-score";
import type { AlertSeverity } from "../session/session-stats";

export interface AnalyticsSession {
  id: string;
  startedAt: string;
  driverLabel: string;
  driverId: string;
  analysisType: string;
  modelId: string | null;
  modelLabel: string;
  durationSec: number;
  processingTimeMs: number;
  eyeClosureRatio: number;
  yawnPerMin: number;
  safetyScore: number;
  fatigueLevel: FatigueLevel;
  alerts: Record<AlertSeverity, number>;
  totalAlerts: number;
  /** Speed telemetry recorded when the session ended. */
  telemetry: SessionTelemetryPoint;
}

export interface SessionTelemetryPoint {
  fpsP50: number;
  fpsP95: number;
  latencyP50: number;
  latencyP95: number;
  inferP50: number;
  inferP95: number;
  dropRate: number;
  droppedFrames: number;
  worstStallMs: number;
  avgFps: number;
  avgLatencyMs: number;
}

export interface AnalyticsFilters {
  driver: string; // "all" | driver_label
  model: string; // "all" | model id
  analysisType: string; // "all" | source
  from: string | null; // ISO date (yyyy-mm-dd)
  to: string | null;
}

export const DEFAULT_FILTERS: AnalyticsFilters = {
  driver: "all",
  model: "all",
  analysisType: "all",
  from: null,
  to: null,
};

const SELECT =
  "id,user_id,driver_label,source,started_at,duration_sec,processing_time_ms," +
  "eye_closure_ratio,perclos,yawn_per_min,safety_score,fatigue_level," +
  "alerts_low,alerts_medium,alerts_high,alerts_critical,total_alerts," +
  "avg_fps,avg_latency_ms,fps_p50,fps_p95,latency_p50_ms,latency_p95_ms," +
  "infer_p50_ms,infer_p95_ms,drop_rate,dropped_frames,worst_stall_ms," +
  "model_id,model_registry(name,version)";

/** Loads every completed session visible to the current user (RLS-scoped). */
export async function fetchCompletedSessions(): Promise<AnalyticsSession[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select(SELECT)
    .eq("status", "completed")
    .order("started_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((r) => mapRow(r as unknown as Record<string, unknown>));
}

function mapRow(row: Record<string, unknown>): AnalyticsSession {
  const num = (k: string) => Number(row[k] ?? 0) || 0;
  const model = (row["model_registry"] ?? null) as { name?: string; version?: string } | null;
  const alerts = {
    low: num("alerts_low"),
    medium: num("alerts_medium"),
    high: num("alerts_high"),
    critical: num("alerts_critical"),
  };
  return {
    id: String(row["id"]),
    startedAt: String(row["started_at"]),
    driverLabel: (row["driver_label"] as string | null) ?? "Driver",
    driverId: String(row["user_id"] ?? ""),
    analysisType: (row["source"] as string | null) ?? "unknown",
    modelId: (row["model_id"] as string | null) ?? null,
    modelLabel: model?.name ? `${model.name} ${model.version ?? ""}`.trim() : "Unknown model",
    durationSec: num("duration_sec"),
    processingTimeMs: num("processing_time_ms"),
    eyeClosureRatio: num("eye_closure_ratio") || num("perclos"),
    yawnPerMin: num("yawn_per_min"),
    safetyScore: num("safety_score"),
    fatigueLevel: ((row["fatigue_level"] as FatigueLevel | null) ?? "low") as FatigueLevel,
    alerts,
    totalAlerts: num("total_alerts") || alerts.low + alerts.medium + alerts.high + alerts.critical,
    telemetry: {
      // Older rows predate the telemetry columns; fall back to the averages so
      // historical sessions still plot instead of dropping to zero.
      fpsP50: num("fps_p50") || num("avg_fps"),
      fpsP95: num("fps_p95") || num("avg_fps"),
      latencyP50: num("latency_p50_ms") || num("avg_latency_ms"),
      latencyP95: num("latency_p95_ms") || num("avg_latency_ms"),
      inferP50: num("infer_p50_ms"),
      inferP95: num("infer_p95_ms"),
      dropRate: num("drop_rate"),
      droppedFrames: num("dropped_frames"),
      worstStallMs: num("worst_stall_ms"),
      avgFps: num("avg_fps"),
      avgLatencyMs: num("avg_latency_ms"),
    },
  };
}

export function applyFilters(
  sessions: AnalyticsSession[],
  f: AnalyticsFilters,
): AnalyticsSession[] {
  const fromTs = f.from ? new Date(`${f.from}T00:00:00`).getTime() : null;
  const toTs = f.to ? new Date(`${f.to}T23:59:59.999`).getTime() : null;
  return sessions.filter((s) => {
    if (f.driver !== "all" && s.driverLabel !== f.driver) return false;
    if (f.model !== "all" && (s.modelId ?? "none") !== f.model) return false;
    if (f.analysisType !== "all" && s.analysisType !== f.analysisType) return false;
    const ts = new Date(s.startedAt).getTime();
    if (fromTs != null && ts < fromTs) return false;
    if (toTs != null && ts > toTs) return false;
    return true;
  });
}

export interface AnalyticsKpis {
  sessionCount: number;
  safetyScore: number;
  fatigueLevel: FatigueLevel;
  totalAlerts: number;
  eyeClosureRatio: number;
  yawnPerMin: number;
  processingTimeMs: number;
  durationSec: number;
  model: string;
}

const FATIGUE_RANK: Record<FatigueLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const FATIGUE_BY_RANK: FatigueLevel[] = ["low", "medium", "high", "critical"];

/** Averages across the filtered set; fatigue is the dominant (worst-mode) level. */
export function computeKpis(sessions: AnalyticsSession[]): AnalyticsKpis {
  const n = sessions.length;
  if (!n) {
    return {
      sessionCount: 0,
      safetyScore: 0,
      fatigueLevel: "low",
      totalAlerts: 0,
      eyeClosureRatio: 0,
      yawnPerMin: 0,
      processingTimeMs: 0,
      durationSec: 0,
      model: "—",
    };
  }
  const avg = (pick: (s: AnalyticsSession) => number) =>
    sessions.reduce((a, s) => a + pick(s), 0) / n;

  const models = new Map<string, number>();
  for (const s of sessions) models.set(s.modelLabel, (models.get(s.modelLabel) ?? 0) + 1);
  const model =
    models.size === 1
      ? [...models.keys()][0]
      : `${models.size} models`;

  const avgFatigueRank = avg((s) => FATIGUE_RANK[s.fatigueLevel] ?? 0);

  return {
    sessionCount: n,
    safetyScore: round1(avg((s) => s.safetyScore)),
    fatigueLevel: FATIGUE_BY_RANK[Math.round(avgFatigueRank)] ?? "low",
    totalAlerts: sessions.reduce((a, s) => a + s.totalAlerts, 0),
    eyeClosureRatio: avg((s) => s.eyeClosureRatio),
    yawnPerMin: round1(avg((s) => s.yawnPerMin)),
    processingTimeMs: Math.round(avg((s) => s.processingTimeMs)),
    durationSec: Math.round(avg((s) => s.durationSec)),
    model,
  };
}

export interface TrendPoint {
  id: string;
  label: string;
  index: number;
  safetyScore: number;
  fatigueRank: number;
  fatigueLevel: FatigueLevel;
  eyeClosureRatio: number;
  yawnPerMin: number;
}

export function buildTrend(sessions: AnalyticsSession[]): TrendPoint[] {
  return sessions.map((s, i) => ({
    id: s.id,
    index: i + 1,
    label: new Date(s.startedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    safetyScore: s.safetyScore,
    fatigueRank: FATIGUE_RANK[s.fatigueLevel] ?? 0,
    fatigueLevel: s.fatigueLevel,
    eyeClosureRatio: round1(s.eyeClosureRatio * 100),
    yawnPerMin: s.yawnPerMin,
  }));
}

export function buildAlertDistribution(sessions: AnalyticsSession[]) {
  const totals: Record<AlertSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const s of sessions) {
    totals.low += s.alerts.low;
    totals.medium += s.alerts.medium;
    totals.high += s.alerts.high;
    totals.critical += s.alerts.critical;
  }
  return (Object.keys(totals) as AlertSeverity[]).map((severity) => ({
    severity,
    label: severity[0].toUpperCase() + severity.slice(1),
    count: totals[severity],
  }));
}

// ---------------------------------------------------------------------------
// Speed trends
//
// Charted separately from safety because they answer a different question:
// not "was the driver tired" but "was the measurement trustworthy on this
// device". p95 is plotted alongside p50 so a run that was mostly fine but
// stuttered badly cannot hide behind its median.
// ---------------------------------------------------------------------------

export interface TelemetryTrendPoint {
  id: string;
  index: number;
  label: string;
  model: string;
  fpsP50: number;
  fpsP95: number;
  latencyP50: number;
  latencyP95: number;
  inferP50: number;
  inferP95: number;
  dropPct: number;
}

export function buildTelemetryTrend(sessions: AnalyticsSession[]): TelemetryTrendPoint[] {
  return sessions
    .filter((s) => s.telemetry.fpsP50 > 0 || s.telemetry.latencyP50 > 0)
    .map((s, i) => ({
      id: s.id,
      index: i + 1,
      label: new Date(s.startedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      model: s.modelLabel,
      fpsP50: round1(s.telemetry.fpsP50),
      fpsP95: round1(s.telemetry.fpsP95),
      latencyP50: Math.round(s.telemetry.latencyP50),
      latencyP95: Math.round(s.telemetry.latencyP95),
      inferP50: Math.round(s.telemetry.inferP50),
      inferP95: Math.round(s.telemetry.inferP95),
      dropPct: round1(s.telemetry.dropRate * 100),
    }));
}

export interface ModelTelemetryRow {
  model: string;
  sessions: number;
  fpsP50: number;
  latencyP95: number;
  inferP50: number;
  dropPct: number;
}

/** Per-model averages, ranked fastest first, for side-by-side comparison. */
export function buildModelTelemetry(sessions: AnalyticsSession[]): ModelTelemetryRow[] {
  const byModel = new Map<string, AnalyticsSession[]>();
  for (const s of sessions) {
    if (s.telemetry.fpsP50 <= 0 && s.telemetry.latencyP50 <= 0) continue;
    const list = byModel.get(s.modelLabel) ?? [];
    list.push(s);
    byModel.set(s.modelLabel, list);
  }
  const mean = (rows: AnalyticsSession[], pick: (s: AnalyticsSession) => number) =>
    rows.reduce((a, s) => a + pick(s), 0) / rows.length;

  return [...byModel.entries()]
    .map(([model, rows]) => ({
      model,
      sessions: rows.length,
      fpsP50: round1(mean(rows, (s) => s.telemetry.fpsP50)),
      latencyP95: Math.round(mean(rows, (s) => s.telemetry.latencyP95)),
      inferP50: Math.round(mean(rows, (s) => s.telemetry.inferP50)),
      dropPct: round1(mean(rows, (s) => s.telemetry.dropRate) * 100),
    }))
    .sort((a, b) => b.fpsP50 - a.fpsP50);
}

export function fatigueRank(level: FatigueLevel): number {
  return FATIGUE_RANK[level] ?? 0;
}

export function fatigueFromRank(rank: number): FatigueLevel {
  return FATIGUE_BY_RANK[Math.max(0, Math.min(3, Math.round(rank)))];
}

/** Distinct filter options derived from the loaded sessions. */
export function buildFilterOptions(sessions: AnalyticsSession[]) {
  const drivers = new Map<string, string>();
  const models = new Map<string, string>();
  const types = new Set<string>();
  for (const s of sessions) {
    drivers.set(s.driverLabel, s.driverLabel);
    models.set(s.modelId ?? "none", s.modelLabel);
    types.add(s.analysisType);
  }
  return {
    drivers: [...drivers.keys()].sort(),
    models: [...models.entries()].map(([id, label]) => ({ id, label })),
    analysisTypes: [...types].sort(),
  };
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}
