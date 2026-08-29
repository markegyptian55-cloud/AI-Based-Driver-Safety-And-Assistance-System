import { describe, expect, it } from "vitest";
import { createCaptureProfiler, quantiles } from "./capture-profiler";

const sample = (over: Partial<Parameters<ReturnType<typeof createCaptureProfiler>["record"]>[0]> = {}) => ({
  captureToResultMs: 100,
  preprocessMs: 5,
  inferMs: 80,
  postprocessMs: 3,
  transportMs: 0,
  dropped: 0,
  sourceFps: 30,
  analysedFps: 10,
  luma: 0.4,
  gain: 1,
  route: "on-device",
  quality: 80,
  ...over,
});

describe("quantiles", () => {
  it("returns zeros for an empty series", () => {
    expect(quantiles([])).toEqual({ p50: 0, p95: 0, max: 0, mean: 0 });
  });

  it("ignores non-finite values instead of poisoning the mean", () => {
    expect(quantiles([10, Number.NaN, 20, Number.POSITIVE_INFINITY]).mean).toBe(15);
  });

  it("reports the tail, which is what users feel as freezing", () => {
    const q = quantiles([10, 10, 10, 10, 900]);
    expect(q.p50).toBe(10);
    expect(q.max).toBe(900);
  });
});

describe("capture profiler", () => {
  it("summarises an empty session without throwing", () => {
    const stats = createCaptureProfiler().stats();
    expect(stats.frames).toBe(0);
    expect(stats.analysedFps).toBe(0);
  });

  it("aggregates stage timings and route share", () => {
    const p = createCaptureProfiler();
    p.record(sample());
    p.record(sample({ route: "remote", transportMs: 40, inferMs: 20 }));
    const stats = p.stats();
    expect(stats.frames).toBe(2);
    expect(stats.inferMs.mean).toBe(50);
    expect(stats.routeShare["remote"]).toBeCloseTo(0.5);
  });

  it("reports the drop rate from the cumulative counter", () => {
    const p = createCaptureProfiler();
    p.record(sample({ dropped: 0 }));
    p.record(sample({ dropped: 6 }));
    expect(p.stats().droppedFrames).toBe(6);
    expect(p.stats().dropRate).toBeCloseTo(6 / 8);
  });

  it("stays bounded so a long session cannot exhaust memory", () => {
    const p = createCaptureProfiler(50);
    for (let i = 0; i < 500; i++) p.record(sample());
    expect(p.samples().length).toBe(50);
  });
});
