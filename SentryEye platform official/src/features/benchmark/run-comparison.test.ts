import { describe, expect, it } from "vitest";
import { compareRuns, latestComparisons } from "./run-comparison";
import type { BenchmarkRun } from "./benchmark-runs";
import type { BenchResult } from "@/features/inference/benchmark";

const ANDROID = "Mozilla/5.0 (Linux; Android 13; SM-A125F) Chrome/120 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36";

function result(over: Partial<BenchResult> = {}): BenchResult {
  return {
    id: "m1",
    label: "Model 1",
    kind: "on-device",
    ok: true,
    engine: "wasm",
    imgsz: 320,
    frames: 10,
    fps: 20,
    latencyP50: 40,
    latencyP95: 50,
    latencyStdDev: 5,
    meanDetections: 3,
    meanConfidence: 0.8,
    agreement: 1,
    score: 90,
    verdict: "",
    ...over,
  };
}

function run(over: Partial<BenchmarkRun> = {}): BenchmarkRun {
  return {
    id: "r1",
    createdAt: "2026-08-01T00:00:00Z",
    frameSource: "camera",
    frameCount: 12,
    device: {
      userAgent: ANDROID,
      platform: "Linux",
      cores: 8,
      memoryGb: 4,
      screen: "412×915",
      dpr: 2,
      frameSize: null,
      constrained: true,
      engine: "wasm",
    },
    results: [result()],
    bestModelId: "m1",
    bestModelLabel: "Model 1",
    bestFps: 20,
    bestLatencyP95Ms: 50,
    ...over,
  };
}

describe("compareRuns", () => {
  it("flags a throughput regression", () => {
    const c = compareRuns(run(), run({ id: "r2", results: [result({ fps: 12, latencyP95: 90 })] }));
    expect(c.models[0].regressed).toBe(true);
    expect(c.regressions).toBe(1);
    expect(c.deviceClass).toBe("mobile");
  });

  it("flags an accuracy regression even when speed improved", () => {
    const c = compareRuns(
      run(),
      run({ id: "r2", results: [result({ fps: 30, latencyP95: 30, meanDetections: 1 })] }),
    );
    expect(c.models[0].regressed).toBe(true);
    expect(c.models[0].note).toMatch(/fewer boxes/);
  });

  it("stays quiet when a run matches the previous one", () => {
    const c = compareRuns(run(), run({ id: "r2" }));
    expect(c.regressions).toBe(0);
  });

  it("ignores models missing from the earlier run", () => {
    const c = compareRuns(run(), run({ id: "r2", results: [result({ id: "m2" })] }));
    expect(c.models).toHaveLength(0);
  });
});

describe("latestComparisons", () => {
  it("never compares a phone run to a desktop run", () => {
    const phoneOld = run({ id: "p1", createdAt: "2026-08-01T00:00:00Z" });
    const phoneNew = run({
      id: "p2",
      createdAt: "2026-08-05T00:00:00Z",
      results: [result({ fps: 10 })],
    });
    const desktop = run({
      id: "d1",
      createdAt: "2026-08-06T00:00:00Z",
      device: { ...run().device, userAgent: DESKTOP, constrained: false },
      results: [result({ fps: 60 })],
    });
    const comparisons = latestComparisons([phoneOld, phoneNew, desktop]);
    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].deviceClass).toBe("mobile");
    expect(comparisons[0].models[0].regressed).toBe(true);
  });
});
