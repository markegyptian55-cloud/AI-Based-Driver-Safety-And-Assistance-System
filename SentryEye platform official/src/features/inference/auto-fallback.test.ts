import { describe, expect, it } from "vitest";

import {
  createFallbackMonitor,
  thresholdById,
} from "@/features/inference/auto-fallback";
import { meanInterval, wilsonInterval } from "@/features/inference/confidence-interval";

describe("fallback monitor", () => {
  const t = thresholdById("balanced");

  it("ignores the start-up grace window", () => {
    const m = createFallbackMonitor(t);
    expect(m.observe({ t: 1000, fps: 1, latencyMs: 2000 })).toBe(false);
  });

  it("switches only after sustained bad performance", () => {
    const m = createFallbackMonitor(t);
    expect(m.observe({ t: 5000, fps: 2, latencyMs: 900 })).toBe(false);
    expect(m.observe({ t: 9000, fps: 2, latencyMs: 900 })).toBe(false);
    expect(m.observe({ t: 11500, fps: 2, latencyMs: 900 })).toBe(true);
  });

  it("resets the streak when performance recovers", () => {
    const m = createFallbackMonitor(t);
    m.observe({ t: 5000, fps: 2, latencyMs: 900 });
    m.observe({ t: 8000, fps: 20, latencyMs: 80 });
    expect(m.badForMs()).toBe(0);
    expect(m.observe({ t: 12000, fps: 2, latencyMs: 900 })).toBe(false);
  });

  it("never switches when disabled", () => {
    const m = createFallbackMonitor(thresholdById("off"));
    expect(m.observe({ t: 60000, fps: 0.2, latencyMs: 5000 })).toBe(false);
  });
});

describe("confidence intervals", () => {
  it("keeps a zero-count proportion inside [0,1]", () => {
    const i = wilsonInterval(0, 10);
    expect(i.value).toBe(0);
    expect(i.low).toBe(0);
    expect(i.high).toBeGreaterThan(0);
    expect(i.high).toBeLessThan(1);
  });

  it("narrows as the sample grows", () => {
    const small = wilsonInterval(5, 10);
    const large = wilsonInterval(500, 1000);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("returns null for an empty confidence sample", () => {
    expect(meanInterval([])).toBeNull();
  });

  it("computes a mean interval around the sample mean", () => {
    const i = meanInterval([0.5, 0.6, 0.7])!;
    expect(i.value).toBeCloseTo(0.6, 5);
    expect(i.low).toBeLessThan(0.6);
    expect(i.high).toBeGreaterThan(0.6);
  });
});
