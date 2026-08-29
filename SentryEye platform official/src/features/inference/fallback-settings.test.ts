import { describe, expect, it } from "vitest";

import {
  DEFAULT_FALLBACK_PREFERENCE,
  clampPreference,
  resolveFallbackThreshold,
} from "./auto-fallback";

describe("fallback threshold resolution", () => {
  it("uses the account bar when no device override exists", () => {
    const t = resolveFallbackThreshold({ enabled: true, minFps: 9, maxLatencyMs: 250 }, null);
    expect(t.minFps).toBe(9);
    expect(t.maxLatencyMs).toBe(250);
  });

  it("lets the device override win over the account bar", () => {
    const t = resolveFallbackThreshold(DEFAULT_FALLBACK_PREFERENCE, {
      enabled: true,
      minFps: 4,
      maxLatencyMs: 800,
    });
    expect(t.minFps).toBe(4);
    expect(t.maxLatencyMs).toBe(800);
  });

  it("disables switching when the effective preference is off", () => {
    const t = resolveFallbackThreshold(DEFAULT_FALLBACK_PREFERENCE, {
      enabled: false,
      minFps: 10,
      maxLatencyMs: 300,
    });
    expect(t.id).toBe("off");
    expect(t.minFps).toBe(0);
  });

  it("clamps nonsense input instead of trusting it", () => {
    expect(clampPreference({ minFps: 999, maxLatencyMs: 1 })).toMatchObject({
      minFps: 30,
      maxLatencyMs: 50,
    });
    expect(clampPreference({ minFps: Number.NaN }).minFps).toBe(8);
  });
});
