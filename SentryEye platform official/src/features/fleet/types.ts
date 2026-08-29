// Fleet Mode domain types. Deliberately independent of Supabase row shapes so
// the driver workspace can build a finalized shift report while offline and
// render exactly the same object once it has synced.

export type FleetRole = "driver" | "manager" | "admin";

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export type Recommendation =
  | "excellent"
  | "monitor"
  | "needs_attention"
  | "high_risk"
  | "management_review";

export type ShiftStatus = "active" | "ending" | "completed" | "cancelled";

export type SyncState = "local" | "pending_sync" | "syncing" | "synced" | "sync_error";

/** Event categories are derived from the deployed model, never hardcoded in UI. */
export interface SafetyEventInput {
  clientEventId: string;
  eventType: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  startedAt: string;
  durationSeconds: number;
  modelVersion?: string | null;
}

export interface LocalShift {
  clientShiftId: string;
  /** Server id once the shift row exists. */
  remoteId: string | null;
  organizationId: string | null;
  driverId: string | null;
  userId: string | null;
  status: ShiftStatus;
  startedAt: string;
  endedAt: string | null;
  monitoredSeconds: number;
  modelId: string | null;
  modelName: string | null;
  modelVersion: string | null;
  modelImgsz: number | null;
  executionProvider: string | null;
  precision: string | null;
  deviceInfo: Record<string, unknown>;
  sync: SyncState;
  events: SafetyEventInput[];
  /** Locally computed report, available immediately (also when offline). */
  report: ShiftReport | null;
}

export interface ReportFactor {
  label: string;
  value: number;
  cap?: number;
  unit?: string;
  comparison?: string;
}

export interface ShiftReport {
  shiftId: string;
  driverId: string;
  driverName?: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  monitoredSeconds: number;
  totalEvents: number;
  criticalEvents: number;
  drowsinessEvents: number;
  eyesClosedEvents: number;
  yawningEvents: number;
  phoneUsageEvents: number;
  otherEvents: number;
  eventRate: number;
  drowsinessRate: number;
  avgConfidence: number;
  safetyScore: number;
  riskLevel: RiskLevel;
  recommendation: Recommendation;
  factors: ReportFactor[];
  modelName: string | null;
  modelVersion: string | null;
  executionProvider: string | null;
  sync: SyncState;
}

export interface ScoringConfig {
  weights: {
    eventRate: number;
    drowsinessRate: number;
    criticalDensity: number;
    closureSeverity: number;
  };
  caps: {
    eventRatePerHour: number;
    drowsinessRatePerHour: number;
    criticalPerHour: number;
    longestClosureMs: number;
  };
  thresholds: { low: number; moderate: number; high: number };
}

export const DEFAULT_SCORING: ScoringConfig = {
  weights: { eventRate: 0.3, drowsinessRate: 0.3, criticalDensity: 0.25, closureSeverity: 0.15 },
  caps: {
    eventRatePerHour: 12,
    drowsinessRatePerHour: 8,
    criticalPerHour: 2,
    longestClosureMs: 4000,
  },
  thresholds: { low: 85, moderate: 70, high: 50 },
};

export type PeriodKey = "today" | "7d" | "30d" | "90d" | "365d";

export const PERIODS: { key: PeriodKey; label: string; days: number }[] = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "365d", label: "Last year", days: 365 },
];
