import { describe, expect, it } from "vitest";

import {
  MIN_USABLE_FPS,
  describeMeasurement,
  suggestThresholds,
  type DeviceMeasurement,
} from "./device-calibration";

function m(patch: Partial<DeviceMeasurement> = {}): DeviceMeasurement {
  return {
    frameWidth: 1280,
    frameHeight: 720,
    achievedFps: 20,
    latencyP95Ms: 120,
    preprocessMs: 3,
    frames: 8,
    ...patch,
  };
}

describe("device calibration", () => {
  it("sets the bar below what the device achieved", () => {
    const t = suggestThresholds(m());
    expect(t.minFps).toBe(13);
    expect(t.maxLatencyMs).toBe(180);
    expect(t.enabled).toBe(true);
  });

  it("never proposes a bar under the real-time floor", () => {
    expect(suggestThresholds(m({ achievedFps: 2 })).minFps).toBe(MIN_USABLE_FPS);
  });

  it("keeps a latency floor so fast devices do not thrash", () => {
    expect(suggestThresholds(m({ latencyP95Ms: 10 })).maxLatencyMs).toBe(120);
  });

  it("warns plainly when the device is too slow to be useful", () => {
    expect(describeMeasurement(m({ achievedFps: 3 }))).toMatch(/microsleeps will be missed/i);
    expect(describeMeasurement(m({ achievedFps: 22 }))).toMatch(/comfortably/i);
  });
});
