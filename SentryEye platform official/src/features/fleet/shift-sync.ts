// Cloud synchronisation for shifts. Every write is idempotent:
//   shifts        upsert on client_shift_id
//   safety_events upsert on (shift_id, client_event_id)
//   report        produced by the finalize_shift() database routine, which is
//                 unique per shift and returns the existing report on retry.
// A retried upload therefore cannot duplicate a shift, an event or a report.

import { supabase } from "@/integrations/supabase/client";
import { deleteShift, putShift, setSync } from "./offline-queue";
import type { LocalShift, ShiftReport } from "./types";
import { buildLocalReport } from "./shift-report";

export interface FleetIdentity {
  userId: string;
  organizationId: string;
  driverId: string;
  role: "driver" | "manager" | "admin";
  driverName: string;
}

export async function loadIdentity(): Promise<FleetIdentity | null> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return null;

  const [{ data: member }, { data: driver }, { data: profile }] = await Promise.all([
    supabase.from("org_members").select("organization_id, role").eq("user_id", user.id).maybeSingle(),
    supabase.from("drivers").select("id, full_name").eq("user_id", user.id).limit(1).maybeSingle(),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!member) return null;

  return {
    userId: user.id,
    organizationId: member.organization_id,
    role: member.role as FleetIdentity["role"],
    driverId: driver?.id ?? "",
    driverName: driver?.full_name ?? profile?.display_name ?? user.email ?? "Driver",
  };
}

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/** Push the shift row (create or update) and return its server id. */
export async function pushShift(shift: LocalShift): Promise<string | null> {
  if (!shift.organizationId || !shift.driverId || !shift.userId) return null;
  const payload = {
    client_shift_id: shift.clientShiftId,
    organization_id: shift.organizationId,
    driver_id: shift.driverId,
    user_id: shift.userId,
    status: shift.status,
    started_at: shift.startedAt,
    ended_at: shift.endedAt,
    monitored_seconds: Math.round(shift.monitoredSeconds),
    model_id: shift.modelId,
    model_name: shift.modelName,
    model_version: shift.modelVersion,
    model_imgsz: shift.modelImgsz,
    execution_provider: shift.executionProvider,
    precision: shift.precision,
    device_info: JSON.parse(JSON.stringify(shift.deviceInfo ?? {})),
  };
  const { data, error } = await supabase
    .from("shifts")
    .upsert(payload, { onConflict: "client_shift_id" })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function pushEvents(shift: LocalShift, remoteId: string): Promise<void> {
  if (!shift.events.length) return;
  const rows = shift.events.map((e) => ({
    client_event_id: e.clientEventId,
    organization_id: shift.organizationId!,
    shift_id: remoteId,
    driver_id: shift.driverId!,
    user_id: shift.userId!,
    event_type: e.eventType,
    severity: e.severity,
    confidence: e.confidence,
    started_at: e.startedAt,
    duration_seconds: e.durationSeconds,
    model_version: e.modelVersion ?? shift.modelVersion,
  }));
  // Chunked so a long shift never sends one oversized request.
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("safety_events")
      .upsert(rows.slice(i, i + 200), { onConflict: "shift_id,client_event_id" });
    if (error) throw error;
  }
}

/**
 * Full upload of one completed shift, in dependency order, then server-side
 * finalisation. Safe to call any number of times for the same shift.
 */
export async function syncShift(shift: LocalShift): Promise<ShiftReport | null> {
  if (!isOnline()) {
    await setSync(shift.clientShiftId, "pending_sync");
    return shift.report;
  }
  try {
    await setSync(shift.clientShiftId, "syncing");
    const remoteId = shift.remoteId ?? (await pushShift(shift));
    if (!remoteId) throw new Error("shift upload returned no id");
    await putShift({ ...shift, remoteId, sync: "syncing" });
    await pushEvents(shift, remoteId);

    if (shift.status === "completed") {
      const { error } = await supabase.rpc("finalize_shift", {
        _shift_id: remoteId,
        _monitored_seconds: Math.round(shift.monitoredSeconds),
      });
      if (error) throw error;
      const report = await fetchReport(remoteId);
      await putShift({ ...shift, remoteId, sync: "synced", report: report ?? shift.report });
      return report ?? shift.report;
    }

    await setSync(shift.clientShiftId, "synced");
    return shift.report;
  } catch {
    await setSync(shift.clientShiftId, "sync_error");
    return shift.report;
  }
}

export async function fetchReport(remoteShiftId: string): Promise<ShiftReport | null> {
  const { data } = await supabase
    .from("shift_reports")
    .select("*, shifts(started_at, ended_at, duration_seconds)")
    .eq("shift_id", remoteShiftId)
    .maybeSingle();
  if (!data) return null;
  return mapReportRow(data as Record<string, unknown>);
}

export function mapReportRow(row: Record<string, unknown>): ShiftReport {
  const shift = (row["shifts"] ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(row[k] ?? 0) || 0;
  return {
    shiftId: String(row["shift_id"] ?? row["id"]),
    driverId: String(row["driver_id"] ?? ""),
    startedAt: String(shift["started_at"] ?? row["generated_at"] ?? new Date().toISOString()),
    endedAt: (shift["ended_at"] as string | null) ?? null,
    durationSeconds: Number(shift["duration_seconds"] ?? 0) || 0,
    monitoredSeconds: n("monitored_seconds"),
    totalEvents: n("total_events"),
    criticalEvents: n("critical_events"),
    drowsinessEvents: n("drowsiness_events"),
    eyesClosedEvents: n("eyes_closed_events"),
    yawningEvents: n("yawning_events"),
    phoneUsageEvents: n("phone_usage_events"),
    otherEvents: n("other_events"),
    eventRate: n("event_rate"),
    drowsinessRate: n("drowsiness_rate"),
    avgConfidence: n("avg_confidence"),
    safetyScore: n("safety_score"),
    riskLevel: (row["risk_level"] as ShiftReport["riskLevel"]) ?? "low",
    recommendation: (row["recommendation"] as ShiftReport["recommendation"]) ?? "excellent",
    factors: Array.isArray(row["factors"]) ? (row["factors"] as ShiftReport["factors"]) : [],
    modelName: (row["model_name"] as string | null) ?? null,
    modelVersion: (row["model_version"] as string | null) ?? null,
    executionProvider: (row["execution_provider"] as string | null) ?? null,
    sync: "synced",
  };
}

/** Drain everything that has not reached the cloud yet. */
export async function syncPending(shifts: LocalShift[]): Promise<void> {
  for (const shift of shifts) {
    if (shift.sync === "synced") continue;
    await syncShift(shift);
  }
}

export { buildLocalReport, deleteShift };
