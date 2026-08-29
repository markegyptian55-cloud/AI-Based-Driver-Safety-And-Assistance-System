import { describe, expect, it } from "vitest";

import { summarizeYawnEpisodes, yawnAuditVerdict } from "./yawn-summary";
import type { YawnEpisode } from "./types";

function ep(p: Partial<YawnEpisode>): YawnEpisode {
  return {
    startTs: 0,
    endTs: 1000,
    durationMs: 1000,
    frames: 3,
    peakConfidence: 0.6,
    peakAspect: 0.5,
    baseline: 0.3,
    confirmed: false,
    reason: "too_short",
    ...p,
  };
}

describe("summarizeYawnEpisodes", () => {
  it("reports an empty audit with no spells", () => {
    const a = summarizeYawnEpisodes([]);
    expect(a.spells).toBe(0);
    expect(a.dominantFailure).toBeNull();
    expect(yawnAuditVerdict(a)).toMatch(/never cleared/);
  });

  it("names the dominant failure gate", () => {
    const a = summarizeYawnEpisodes([
      ep({ reason: "low_confidence" }),
      ep({ reason: "low_confidence" }),
      ep({ reason: "too_short" }),
      ep({ confirmed: true, reason: "confirmed" }),
    ]);
    expect(a.confirmed).toBe(1);
    expect(a.rejected).toBe(3);
    expect(a.dominantFailure).toBe("low_confidence");
    expect(a.confirmRate).toBeCloseTo(0.25);
  });

  it("ranks near misses first", () => {
    const a = summarizeYawnEpisodes([
      ep({ durationMs: 200, peakConfidence: 0.2 }),
      ep({ durationMs: 1100, peakConfidence: 0.9 }),
    ]);
    expect(a.topFailures[0].durationMs).toBe(1100);
  });

  it("never counts a confirmed spell as a failure", () => {
    const a = summarizeYawnEpisodes([ep({ confirmed: true, reason: "confirmed" })]);
    expect(a.rejected).toBe(0);
    expect(a.dominantFailure).toBeNull();
    expect(yawnAuditVerdict(a)).toMatch(/All 1/);
  });
});
