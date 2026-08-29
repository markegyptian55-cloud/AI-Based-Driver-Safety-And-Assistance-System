// Pure session statistics accumulator. Consumes the same frame summaries and
// semantic events the live pipeline already produces and turns them into the
// driver-session summary. No browser APIs, no persistence — fully unit
// testable and reusable by any frame source (live camera or uploaded video).

import type { FrameSummary, SemanticEvent } from "../drowsiness/types";
import { computeSafety, type FatigueLevel } from "../drowsiness/safety-score";

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export interface SessionSummary {
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
}

/** Semantic event -> alert severity. Single source of truth for the report. */
export function severityOf(event: SemanticEvent): AlertSeverity {
  switch (event.kind) {
    case "drowsy":
      return "critical";
    case "critical_microsleep":
      return "critical";
    case "microsleep":
      return "high";
    case "eye_closed_sustained":
      return "high";
    case "yawn":
      return "medium";
    case "alert_cleared":
      return "low";
    default:
      return event.riskLevel === "danger" ? "critical" : event.riskLevel === "warn" ? "medium" : "low";
  }
}

export class SessionStats {
  private totalFrames = 0;
  private analysedFrames = 0;
  private openEyeFrames = 0;
  private closedEyeFrames = 0;
  private yawnFrames = 0;
  private alerts: Record<AlertSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  private closureStart: number | null = null;
  private closureDurations: number[] = [];
  private lastTs: number | null = null;

  /** Frames delivered by the source, including ones skipped by backpressure. */
  setTotalFrames(n: number) {
    this.totalFrames = Math.max(this.totalFrames, n, this.analysedFrames);
  }

  onFrame(summary: FrameSummary) {
    this.analysedFrames++;
    this.lastTs = summary.ts;
    if (summary.eyeClosed) this.closedEyeFrames++;
    else if (summary.eyeOpen) this.openEyeFrames++;
    if (summary.yawning) this.yawnFrames++;

    // Track continuous eye-closure spells to derive longest/average closure.
    if (summary.eyeClosed) {
      if (this.closureStart == null) this.closureStart = summary.ts;
    } else if (this.closureStart != null) {
      this.closureDurations.push(Math.max(0, summary.ts - this.closureStart));
      this.closureStart = null;
    }
  }

  onEvent(event: SemanticEvent) {
    this.alerts[severityOf(event)]++;
  }

  /** Close any open closure spell (called when the session ends). */
  private finalizeClosure() {
    if (this.closureStart != null && this.lastTs != null) {
      this.closureDurations.push(Math.max(0, this.lastTs - this.closureStart));
      this.closureStart = null;
    }
  }

  summarize(durationSec: number): SessionSummary {
    this.finalizeClosure();
    const analysed = this.analysedFrames;
    const eyeFrames = this.openEyeFrames + this.closedEyeFrames;
    const eyeClosureRatio = eyeFrames > 0 ? this.closedEyeFrames / eyeFrames : 0;
    const minutes = Math.max(durationSec / 60, 1 / 60);
    const yawnPerMin = this.alerts.medium / minutes;
    const totalAlerts =
      this.alerts.low + this.alerts.medium + this.alerts.high + this.alerts.critical;
    const longest = this.closureDurations.length ? Math.max(...this.closureDurations) : 0;
    const avg = this.closureDurations.length
      ? this.closureDurations.reduce((a, b) => a + b, 0) / this.closureDurations.length
      : 0;

    const safety = computeSafety({
      eyeClosureRatio,
      yawnPerMin,
      alerts: this.alerts,
      durationSec,
    });

    return {
      totalFrames: Math.max(this.totalFrames, analysed),
      analysedFrames: analysed,
      openEyeFrames: this.openEyeFrames,
      closedEyeFrames: this.closedEyeFrames,
      yawnFrames: this.yawnFrames,
      eyeClosureRatio,
      yawnPerMin,
      totalAlerts,
      alerts: { ...this.alerts },
      longestEyeClosureMs: Math.round(longest),
      avgEyeClosureMs: Math.round(avg),
      safetyScore: safety.safetyScore,
      fatigueLevel: safety.fatigueLevel,
      durationSec,
    };
  }

  reset() {
    this.totalFrames = 0;
    this.analysedFrames = 0;
    this.openEyeFrames = 0;
    this.closedEyeFrames = 0;
    this.yawnFrames = 0;
    this.alerts = { low: 0, medium: 0, high: 0, critical: 0 };
    this.closureStart = null;
    this.closureDurations = [];
    this.lastTs = null;
  }
}
