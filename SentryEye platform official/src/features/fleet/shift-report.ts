// Local (offline-capable) report builder. Mirrors the database's finalize_shift
// routine so the driver sees the finalized numbers immediately, with or without
// a network, and the synced report matches what they were shown.

import { scoreShift, tallyEvents } from "./safety-score";
import type { LocalShift, ScoringConfig, ShiftReport } from "./types";

export function buildLocalReport(
  shift: LocalShift,
  opts?: { longestClosureMs?: number; config?: ScoringConfig; driverName?: string },
): ShiftReport {
  const totals = tallyEvents(shift.events);
  const scored = scoreShift({
    monitoredSeconds: shift.monitoredSeconds,
    totals,
    longestClosureMs: opts?.longestClosureMs ?? 0,
    config: opts?.config ?? undefined,
  });
  const endedAt = shift.endedAt ?? new Date().toISOString();
  const durationSeconds = Math.max(
    0,
    (new Date(endedAt).getTime() - new Date(shift.startedAt).getTime()) / 1000,
  );

  return {
    shiftId: shift.remoteId ?? shift.clientShiftId,
    driverId: shift.driverId ?? "",
    driverName: opts?.driverName,
    startedAt: shift.startedAt,
    endedAt,
    durationSeconds,
    monitoredSeconds: shift.monitoredSeconds,
    totalEvents: totals.total,
    criticalEvents: totals.critical,
    drowsinessEvents: totals.drowsiness,
    eyesClosedEvents: totals.eyesClosed,
    yawningEvents: totals.yawning,
    phoneUsageEvents: totals.phoneUsage,
    otherEvents: totals.other,
    eventRate: scored.eventRate,
    drowsinessRate: scored.drowsinessRate,
    avgConfidence: totals.avgConfidence,
    safetyScore: scored.safetyScore,
    riskLevel: scored.riskLevel,
    recommendation: scored.recommendation,
    factors: scored.factors,
    modelName: shift.modelName,
    modelVersion: shift.modelVersion,
    executionProvider: shift.executionProvider,
    sync: shift.sync,
  };
}
