// Centralised, deterministic driver safety scoring.
//
// Pure functions only — no browser APIs, no persistence, no React. Both the
// live pipeline and the stored driver report use this single implementation so
// a report is always reproducible from the persisted session summary.

export type FatigueLevel = "low" | "medium" | "high" | "critical";

export interface SafetyInputs {
  /** Ratio 0..1 of analysed frames where the eyes were closed (PERCLOS). */
  eyeClosureRatio: number;
  /** Yawns per minute over the session. */
  yawnPerMin: number;
  /** Alert counts by severity over the session. */
  alerts: { low: number; medium: number; high: number; critical: number };
  /** Session duration in seconds (used to normalise alert frequency). */
  durationSec: number;
}

export interface SafetyResult {
  safetyScore: number;
  fatigueLevel: FatigueLevel;
  breakdown: {
    eyeClosurePenalty: number;
    yawnPenalty: number;
    alertPenalty: number;
  };
}

/**
 * SAFETY SCORE FORMULA (0 = unsafe, 100 = fully alert)
 * ----------------------------------------------------
 *   safetyScore = 100 - (eyeClosurePenalty + yawnPenalty + alertPenalty)
 *
 *   eyeClosurePenalty = min(50, eyeClosureRatio * 50)
 *       PERCLOS is the strongest fatigue indicator, so it owns half the scale.
 *       A driver with eyes closed 100% of analysed frames loses 50 points.
 *
 *   yawnPenalty       = min(25, yawnPerMin * 5)
 *       5 yawns/min or more is treated as fully saturated (25 points).
 *
 *   alertPenalty      = min(25, weightedAlertsPerMin * 2.5)
 *       weightedAlerts = low*0.5 + medium*1 + high*2 + critical*4
 *       weightedAlertsPerMin = weightedAlerts / max(durationMin, 1/6)
 *       (a floor of 10 s prevents very short sessions from exploding the rate)
 *
 * The result is rounded to one decimal and clamped to 0..100. Given the same
 * inputs it always yields the same score — no randomness, no time dependency.
 *
 * FATIGUE LEVEL is derived from the score alone:
 *   >= 80 low | >= 60 medium | >= 40 high | < 40 critical
 */
export function computeSafety(input: SafetyInputs): SafetyResult {
  const ratio = clamp(input.eyeClosureRatio, 0, 1);
  const eyeClosurePenalty = round1(Math.min(50, ratio * 50));
  const yawnPenalty = round1(Math.min(25, Math.max(0, input.yawnPerMin) * 5));

  const weighted =
    input.alerts.low * 0.5 +
    input.alerts.medium * 1 +
    input.alerts.high * 2 +
    input.alerts.critical * 4;
  const durationMin = Math.max(input.durationSec / 60, 1 / 6);
  const alertPenalty = round1(Math.min(25, (weighted / durationMin) * 2.5));

  const safetyScore = round1(
    clamp(100 - (eyeClosurePenalty + yawnPenalty + alertPenalty), 0, 100),
  );

  return {
    safetyScore,
    fatigueLevel: fatigueFromScore(safetyScore),
    breakdown: { eyeClosurePenalty, yawnPenalty, alertPenalty },
  };
}

export function fatigueFromScore(score: number): FatigueLevel {
  if (score >= 80) return "low";
  if (score >= 60) return "medium";
  if (score >= 40) return "high";
  return "critical";
}

function clamp(v: number, min: number, max: number) {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}
