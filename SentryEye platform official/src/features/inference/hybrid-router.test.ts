import { describe, expect, it } from "vitest";
import { decideRoute, DEFAULT_ROUTE_POLICY, type RouteMetrics } from "./hybrid-router";
import { scoreCandidate, agreementScore, type BenchResult } from "./benchmark";
import type { Detection } from "./types";

const healthy: RouteMetrics = {
  fps: 24,
  latencyMs: 40,
  trackConfidence: 0.8,
  errors: 0,
  remoteAvailable: true,
  degradedForMs: 0,
  sinceSwitchMs: 60_000,
};

describe("decideRoute", () => {
  it("stays on-device while the phone keeps up", () => {
    expect(decideRoute("on-device", healthy).route).toBe("on-device");
  });

  it("never leaves the device when no remote service is configured", () => {
    const d = decideRoute("on-device", {
      ...healthy,
      fps: 1.8,
      remoteAvailable: false,
      degradedForMs: 30_000,
    });
    expect(d.route).toBe("on-device");
  });

  it("switches to remote when fps collapses for long enough", () => {
    const d = decideRoute("on-device", { ...healthy, fps: 2, degradedForMs: 5000 });
    expect(d).toMatchObject({ route: "remote", changed: true });
    expect(d.reason).toContain("2.0 fps");
  });

  it("switches to remote when tracking confidence sags", () => {
    const d = decideRoute("on-device", {
      ...healthy,
      trackConfidence: 0.2,
      degradedForMs: 5000,
    });
    expect(d.route).toBe("remote");
    expect(d.reason).toContain("confidence");
  });

  it("does not flap: brief degradation is ignored", () => {
    const d = decideRoute("on-device", { ...healthy, fps: 2, degradedForMs: 800 });
    expect(d.changed).toBe(false);
  });

  it("respects the cooldown after a recent switch", () => {
    const d = decideRoute("on-device", {
      ...healthy,
      fps: 2,
      degradedForMs: 9000,
      sinceSwitchMs: 1000,
    });
    expect(d.changed).toBe(false);
  });

  it("returns to the device immediately when remote keeps failing", () => {
    const d = decideRoute("remote", {
      ...healthy,
      errors: DEFAULT_ROUTE_POLICY.maxRemoteErrors,
      sinceSwitchMs: 100,
    });
    expect(d).toMatchObject({ route: "on-device", changed: true });
  });

  it("returns to the device when the service goes unhealthy mid-session", () => {
    const d = decideRoute("remote", { ...healthy, remoteAvailable: false, sinceSwitchMs: 100 });
    expect(d.route).toBe("on-device");
  });
});

function bench(over: Partial<BenchResult>): BenchResult {
  return {
    id: "x",
    label: "x",
    kind: "on-device",
    ok: true,
    engine: "wasm",
    imgsz: 320,
    frames: 20,
    fps: 15,
    latencyP50: 60,
    latencyP95: 90,
    latencyStdDev: 8,
    meanDetections: 2,
    meanConfidence: 0.7,
    agreement: 0.9,
    score: 0,
    verdict: "",
    ...over,
  };
}

describe("benchmark scoring", () => {
  it("scores a real-time, accurate path highly", () => {
    expect(scoreCandidate(bench({}))).toBeGreaterThan(80);
  });

  it("punishes a fast path that disagrees with the reference", () => {
    const fastGarbage = scoreCandidate(bench({ agreement: 0.05 }));
    expect(fastGarbage).toBeLessThan(scoreCandidate(bench({})));
  });

  it("punishes a slow path even when it is accurate", () => {
    expect(scoreCandidate(bench({ fps: 2, latencyP95: 500 }))).toBeLessThan(60);
  });

  it("scores a failed candidate as zero", () => {
    expect(scoreCandidate(bench({ ok: false }))).toBe(0);
  });
});

const det = (classId: number, bbox: Detection["bbox"]): Detection => ({
  classId,
  label: "l",
  semantic: "s",
  confidence: 0.9,
  bbox,
});

describe("agreementScore", () => {
  it("is 1 for identical streams", () => {
    const frames = [[det(0, [0.1, 0.1, 0.2, 0.2])], [det(1, [0.4, 0.4, 0.1, 0.1])]];
    expect(agreementScore(frames, frames)).toBe(1);
  });

  it("is 0 when the classes never match", () => {
    const a = [[det(0, [0.1, 0.1, 0.2, 0.2])]];
    const b = [[det(2, [0.1, 0.1, 0.2, 0.2])]];
    expect(agreementScore(a, b)).toBe(0);
  });

  it("credits partial overlap between streams", () => {
    const a = [[det(0, [0.1, 0.1, 0.2, 0.2]), det(1, [0.5, 0.5, 0.2, 0.2])]];
    const b = [[det(0, [0.1, 0.1, 0.2, 0.2])]];
    const score = agreementScore(a, b);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });
});
