// Pure scoring layer. The exact same normalisation runs in the database
// (finalize_shift) so an offline-computed report and the synced report agree.
// Weights live in the organization's scoring_config, never in components.

import {
  DEFAULT_SCORING,
  type Recommendation,
  type ReportFactor,
  type RiskLevel,
  type SafetyEventInput,
  type ScoringConfig,
} from "./types";

const DROWSY_TYPES = new Set(["drowsiness", "microsleep"]);

export interface EventTotals {
  total: number;
  critical: number;
  drowsiness: number;
  eyesClosed: number;
  yawning: number;
  phoneUsage: number;
  other: number;
  avgConfidence: number;
}

export function tallyEvents(events: SafetyEventInput[]): EventTotals {
  let critical = 0;
  let drowsiness = 0;
  let eyesClosed = 0;
  let yawning = 0;
  let phoneUsage = 0;
  let other = 0;
  let conf = 0;
  for (const e of events) {
    if (e.severity === "critical") critical += 1;
    if (DROWSY_TYPES.has(e.eventType)) drowsiness += 1;
    else if (e.eventType === "eyes_closed") eyesClosed += 1;
    else if (e.eventType === "yawning") yawning += 1;
    else if (e.eventType === "phone_usage") phoneUsage += 1;
    else other += 1;
    conf += e.confidence;
  }
  return {
    total: events.length,
    critical,
    drowsiness,
    eyesClosed,
    yawning,
    phoneUsage,
    other,
    avgConfidence: events.length ? conf / events.length : 0,
  };
}

export interface ScoreInput {
  monitoredSeconds: number;
  totals: EventTotals;
  longestClosureMs?: number;
  config?: ScoringConfig;
}

export interface ScoreResult {
  safetyScore: number;
  riskLevel: RiskLevel;
  recommendation: Recommendation;
  eventRate: number;
  drowsinessRate: number;
  criticalRate: number;
  factors: ReportFactor[];
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export function scoreShift(input: ScoreInput): ScoreResult {
  const cfg = input.config ?? DEFAULT_SCORING;
  const hours = Math.max(input.monitoredSeconds, 60) / 3600;
  const t = input.totals;

  const eventRate = t.total / hours;
  const drowsinessRate = (t.drowsiness + t.eyesClosed) / hours;
  const criticalRate = t.critical / hours;
  const closure = clamp01((input.longestClosureMs ?? 0) / cfg.caps.longestClosureMs);

  const penalty =
    cfg.weights.eventRate * clamp01(eventRate / cfg.caps.eventRatePerHour) +
    cfg.weights.drowsinessRate * clamp01(drowsinessRate / cfg.caps.drowsinessRatePerHour) +
    cfg.weights.criticalDensity * clamp01(criticalRate / cfg.caps.criticalPerHour) +
    cfg.weights.closureSeverity * closure;

  const safetyScore = Math.max(0, Math.min(100, 100 - 100 * penalty));

  const riskLevel: RiskLevel =
    safetyScore >= cfg.thresholds.low
      ? "low"
      : safetyScore >= cfg.thresholds.moderate
        ? "moderate"
        : safetyScore >= cfg.thresholds.high
          ? "high"
          : "critical";

  const recommendation = recommendFor(riskLevel);

  const factors: ReportFactor[] = [
    {
      label: "Safety events per hour",
      value: round2(eventRate),
      cap: cfg.caps.eventRatePerHour,
      unit: "/h",
    },
    {
      label: "Drowsiness events per hour",
      value: round2(drowsinessRate),
      cap: cfg.caps.drowsinessRatePerHour,
      unit: "/h",
    },
    {
      label: "Critical events per hour",
      value: round2(criticalRate),
      cap: cfg.caps.criticalPerHour,
      unit: "/h",
    },
    { label: "Monitored minutes", value: round2(input.monitoredSeconds / 60), unit: "min" },
  ];
  if (input.longestClosureMs) {
    factors.push({
      label: "Longest eye closure",
      value: round2(input.longestClosureMs / 1000),
      cap: cfg.caps.longestClosureMs / 1000,
      unit: "s",
    });
  }

  return { safetyScore, riskLevel, recommendation, eventRate, drowsinessRate, criticalRate, factors };
}

export function recommendFor(level: RiskLevel): Recommendation {
  switch (level) {
    case "low":
      return "excellent";
    case "moderate":
      return "monitor";
    case "high":
      return "needs_attention";
    default:
      return "management_review";
  }
}

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  excellent: "Excellent",
  monitor: "Monitor",
  needs_attention: "Needs attention",
  high_risk: "High risk",
  management_review: "Management review",
};

export const RECOMMENDATION_BLURB: Record<Recommendation, string> = {
  excellent: "No significant safety concerns detected in this period.",
  monitor: "Minor or occasional safety concerns. Keep observing.",
  needs_attention: "Repeated safety events or a worsening trend. Manager review recommended.",
  high_risk: "Persistent safety concerns. Review and corrective coaching recommended.",
  management_review:
    "Severe or repeated safety concerns. Immediate management review recommended — the manager remains the decision-maker.",
};

export const RISK_LABEL: Record<RiskLevel, string> = {
  low: "Low risk",
  moderate: "Moderate risk",
  high: "High risk",
  critical: "Critical risk",
};

export const RISK_ORDER: RiskLevel[] = ["low", "moderate", "high", "critical"];

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Percentage change of `current` vs `previous`, null when there is no baseline. */
export function trendPct(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

export type TrendDirection = "improving" | "stable" | "worsening" | "unknown";

/** Trend of a *risk* indicator: lower is better. */
export function trendDirection(pct: number | null): TrendDirection {
  if (pct === null || !Number.isFinite(pct)) return "unknown";
  if (pct <= -10) return "improving";
  if (pct >= 10) return "worsening";
  return "stable";
}
