import { describe, expect, it } from "vitest";
import { computeSafety, fatigueFromScore } from "../drowsiness/safety-score";
import { SessionStats } from "./session-stats";
import type { FrameSummary, SemanticEvent } from "../drowsiness/types";

const frame = (ts: number, p: Partial<FrameSummary> = {}): FrameSummary => ({
  ts,
  eyeClosed: false,
  eyeOpen: true,
  yawning: false,
  topEyeConf: 0.9,
  topYawnConf: 0,
  ...p,
});

const event = (kind: SemanticEvent["kind"], ts: number): SemanticEvent => ({
  kind,
  ts,
  confidence: 0.9,
  riskLevel: kind === "drowsy" ? "danger" : kind === "alert_cleared" ? "safe" : "warn",
});

describe("safety score", () => {
  it("is 100 for a perfectly alert session", () => {
    const r = computeSafety({
      eyeClosureRatio: 0,
      yawnPerMin: 0,
      alerts: { low: 0, medium: 0, high: 0, critical: 0 },
      durationSec: 120,
    });
    expect(r.safetyScore).toBe(100);
    expect(r.fatigueLevel).toBe("low");
  });

  it("is deterministic and clamped", () => {
    const input = {
      eyeClosureRatio: 1,
      yawnPerMin: 20,
      alerts: { low: 10, medium: 10, high: 10, critical: 10 },
      durationSec: 60,
    };
    const a = computeSafety(input);
    const b = computeSafety(input);
    expect(a).toEqual(b);
    expect(a.safetyScore).toBe(0);
    expect(a.fatigueLevel).toBe("critical");
  });

  it("maps score to fatigue bands", () => {
    expect(fatigueFromScore(95)).toBe("low");
    expect(fatigueFromScore(70)).toBe("medium");
    expect(fatigueFromScore(45)).toBe("high");
    expect(fatigueFromScore(10)).toBe("critical");
  });
});

describe("session stats", () => {
  it("derives counts, ratios and closure durations from frames only", () => {
    const s = new SessionStats();
    s.onFrame(frame(0));
    s.onFrame(frame(100, { eyeClosed: true, eyeOpen: false }));
    s.onFrame(frame(600, { eyeClosed: true, eyeOpen: false }));
    s.onFrame(frame(700));
    s.onFrame(frame(800, { yawning: true }));
    s.setTotalFrames(10);
    s.onEvent(event("yawn", 800));
    s.onEvent(event("drowsy", 900));

    const sum = s.summarize(60);
    expect(sum.totalFrames).toBe(10);
    expect(sum.analysedFrames).toBe(5);
    expect(sum.closedEyeFrames).toBe(2);
    expect(sum.openEyeFrames).toBe(3);
    expect(sum.yawnFrames).toBe(1);
    expect(sum.eyeClosureRatio).toBeCloseTo(0.4);
    expect(sum.longestEyeClosureMs).toBe(600);
    expect(sum.alerts).toEqual({ low: 0, medium: 1, high: 0, critical: 1 });
    expect(sum.totalAlerts).toBe(2);
    expect(sum.safetyScore).toBeLessThan(100);
  });
});
