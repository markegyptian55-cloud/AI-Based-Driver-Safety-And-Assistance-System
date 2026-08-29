// Driver report data access + row → report mapping. Keeps Supabase specifics
// out of the report UI; the view renders a plain DriverReport object so the
// same report can be reproduced from any persisted session row.

import { supabase } from "@/integrations/supabase/client";
import type { FatigueLevel } from "../drowsiness/safety-score";
import type { AlertSeverity } from "./session-stats";

const SELECT =
  "id,user_id,driver_label,status,source,provider,engine_kind,started_at,ended_at,duration_sec,processing_time_ms,frames_processed,total_frames,analysed_frames,open_eye_frames,closed_eye_frames,yawn_frames,eye_closure_ratio,yawn_per_min,total_alerts,alerts_low,alerts_medium,alerts_high,alerts_critical,longest_eye_closure_ms,avg_eye_closure_ms,fatigue_level,safety_score,perclos,avg_fps,avg_latency_ms,max_risk_level,closed_eye_events,yawn_events,model_id,model_registry(name,version,engine_kind,framework,imgsz,head_format)";

export interface DriverReport {
  sessionId: string;
  driverLabel: string;
  driverId: string;
  status: string;
  analysisType: string;
  provider: string;
  engineKind: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number;
  processingTimeMs: number;
  model: {
    name: string;
    version: string;
    framework: string;
    headFormat: string;
    imgsz: number | null;
  };
  frames: {
    total: number;
    analysed: number;
    openEye: number;
    closedEye: number;
    yawning: number;
    avgFps: number;
    avgLatencyMs: number;
  };
  eyeClosureRatio: number;
  yawnPerMin: number;
  longestEyeClosureMs: number;
  avgEyeClosureMs: number;
  alerts: Record<AlertSeverity, number>;
  totalAlerts: number;
  safetyScore: number;
  fatigueLevel: FatigueLevel;
  maxRiskLevel: string | null;
}

type ModelJoin = {
  name: string | null;
  version: string | null;
  framework: string | null;
  head_format: string | null;
  imgsz: number | null;
} | null;

function mapRow(row: Record<string, unknown>): DriverReport {
  const model = (row["model_registry"] ?? null) as ModelJoin;
  const num = (k: string) => Number(row[k] ?? 0) || 0;
  return {
    sessionId: String(row["id"]),
    driverLabel: (row["driver_label"] as string | null) ?? "Driver",
    driverId: String(row["user_id"] ?? ""),
    status: (row["status"] as string | null) ?? "completed",
    analysisType: (row["source"] as string | null) ?? "unknown",
    provider: (row["provider"] as string | null) ?? "-",
    engineKind: (row["engine_kind"] as string | null) ?? "-",
    startedAt: String(row["started_at"]),
    endedAt: (row["ended_at"] as string | null) ?? null,
    durationSec: num("duration_sec"),
    processingTimeMs: num("processing_time_ms"),
    model: {
      name: model?.name ?? "Unknown model",
      version: model?.version ?? "-",
      framework: model?.framework ?? "-",
      headFormat: model?.head_format ?? "-",
      imgsz: model?.imgsz ?? null,
    },
    frames: {
      total: num("total_frames") || num("frames_processed"),
      analysed: num("analysed_frames") || num("frames_processed"),
      openEye: num("open_eye_frames"),
      closedEye: num("closed_eye_frames"),
      yawning: num("yawn_frames"),
      avgFps: num("avg_fps"),
      avgLatencyMs: num("avg_latency_ms"),
    },
    eyeClosureRatio: num("eye_closure_ratio") || num("perclos"),
    yawnPerMin: num("yawn_per_min"),
    longestEyeClosureMs: num("longest_eye_closure_ms"),
    avgEyeClosureMs: num("avg_eye_closure_ms"),
    alerts: {
      low: num("alerts_low"),
      medium: num("alerts_medium"),
      high: num("alerts_high"),
      critical: num("alerts_critical"),
    },
    totalAlerts: num("total_alerts"),
    safetyScore: num("safety_score"),
    fatigueLevel: ((row["fatigue_level"] as FatigueLevel | null) ?? "low") as FatigueLevel,
    maxRiskLevel: (row["max_risk_level"] as string | null) ?? null,
  };
}

export async function fetchDriverReport(sessionId: string): Promise<DriverReport | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select(SELECT)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as unknown as Record<string, unknown>) : null;
}

export async function fetchLatestCompletedReport(userId: string): Promise<DriverReport | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select(SELECT)
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as unknown as Record<string, unknown>) : null;
}

/**
 * Builds a DriverReport straight from an in-memory session summary. Used by the
 * visitor (guest) flow, where nothing is written to the database but the user
 * must still get the exact same professional report as a signed-in driver.
 */
export function buildLocalReport(input: {
  sessionId: string;
  driverLabel?: string;
  source: string;
  provider: string;
  engineKind: string;
  startedAt: string;
  endedAt?: string | null;
  processingTimeMs?: number;
  modelName: string;
  modelVersion: string;
  avgFps: number;
  avgLatencyMs: number;
  perclos: number;
  maxRiskLevel?: string | null;
  summary: {
    totalFrames: number;
    analysedFrames: number;
    openEyeFrames: number;
    closedEyeFrames: number;
    yawnFrames: number;
    eyeClosureRatio: number;
    yawnPerMin: number;
    totalAlerts: number;
    alerts: Record<AlertSeverity, number>;
    longestEyeClosureMs: number;
    avgEyeClosureMs: number;
    safetyScore: number;
    fatigueLevel: FatigueLevel;
    durationSec: number;
  };
}): DriverReport {
  const s = input.summary;
  return {
    sessionId: input.sessionId,
    driverLabel: input.driverLabel ?? "Visitor",
    driverId: "guest",
    status: "completed",
    analysisType: input.source,
    provider: input.provider,
    engineKind: input.engineKind,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    durationSec: s.durationSec,
    processingTimeMs: input.processingTimeMs ?? 0,
    model: {
      name: input.modelName || "Unknown model",
      version: input.modelVersion || "-",
      framework: "onnx",
      headFormat: "-",
      imgsz: null,
    },
    frames: {
      total: s.totalFrames,
      analysed: s.analysedFrames,
      openEye: s.openEyeFrames,
      closedEye: s.closedEyeFrames,
      yawning: s.yawnFrames,
      avgFps: input.avgFps,
      avgLatencyMs: input.avgLatencyMs,
    },
    eyeClosureRatio: s.eyeClosureRatio || input.perclos,
    yawnPerMin: s.yawnPerMin,
    longestEyeClosureMs: s.longestEyeClosureMs,
    avgEyeClosureMs: s.avgEyeClosureMs,
    alerts: s.alerts,
    totalAlerts: s.totalAlerts,
    safetyScore: s.safetyScore,
    fatigueLevel: s.fatigueLevel,
    maxRiskLevel: input.maxRiskLevel ?? null,
  };
}
