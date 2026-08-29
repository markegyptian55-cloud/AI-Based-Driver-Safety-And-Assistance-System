// Deterministic, template-based narrative for the PDF report. No LLM, no
// invented information — every sentence is derived from stored values only.

import type { DriverReport } from "@/features/session/driver-report";

const FATIGUE_PHRASE: Record<string, string> = {
  low: "a Low fatigue level",
  medium: "a Medium fatigue level",
  high: "a High fatigue level",
  critical: "a Critical fatigue level",
};

/** Builds a short factual summary from already-calculated session values. */
export function buildReportNarrative(report: DriverReport): string {
  const sentences: string[] = [];

  sentences.push(
    `The analysed session shows ${FATIGUE_PHRASE[report.fatigueLevel] ?? "an unknown fatigue level"} with a Safety Score of ${report.safetyScore.toFixed(0)}/100.`,
  );

  const closed = report.frames.closedEye;
  const yawns = report.frames.yawning;
  if (closed > 0 || yawns > 0) {
    const parts: string[] = [];
    if (closed > 0)
      parts.push(
        `${closed.toLocaleString()} closed-eye frames (${(report.eyeClosureRatio * 100).toFixed(1)}% eye closure ratio)`,
      );
    if (yawns > 0)
      parts.push(
        `${yawns.toLocaleString()} yawning frames (${report.yawnPerMin.toFixed(2)} per minute)`,
      );
    sentences.push(`Detection recorded ${parts.join(" and ")}.`);
  } else {
    sentences.push("No closed-eye or yawning frames were recorded during this session.");
  }

  if (report.totalAlerts > 0) {
    sentences.push(
      `${report.totalAlerts} alert${report.totalAlerts === 1 ? "" : "s"} were raised (${report.alerts.low} low, ${report.alerts.medium} medium, ${report.alerts.high} high, ${report.alerts.critical} critical).`,
    );
  } else {
    sentences.push("No fatigue alerts were raised during this session.");
  }

  if (report.longestEyeClosureMs > 0) {
    sentences.push(
      `The longest continuous eye closure lasted ${(report.longestEyeClosureMs / 1000).toFixed(2)} seconds.`,
    );
  }

  sentences.push(
    `The session lasted ${formatDurationWords(report.durationSec)} and was processed in ${(report.processingTimeMs / 1000).toFixed(1)} seconds using ${report.model.name} ${report.model.version}.`,
  );

  return sentences.join(" ");
}

export function formatDurationWords(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m === 0) return `${rest} s`;
  return `${m} min ${rest} s`;
}
