import { describe, expect, it } from "vitest";
import {
  classifyDevice,
  resolvePerformanceProfile,
} from "./performance-mode";

const ANDROID =
  "Mozilla/5.0 (Linux; Android 13; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

describe("classifyDevice", () => {
  it("separates phones, tablets and desktops", () => {
    expect(classifyDevice({ userAgent: ANDROID })).toBe("mobile");
    expect(classifyDevice({ userAgent: DESKTOP, hardwareConcurrency: 4 })).toBe("desktop");
    expect(classifyDevice({ userAgent: IPAD })).toBe("tablet");
  });

  it("does not misread a low-core desktop as mobile", () => {
    expect(classifyDevice({ userAgent: DESKTOP, hardwareConcurrency: 2 })).toBe("desktop");
  });
});

describe("resolvePerformanceProfile", () => {
  it("caps threads and NMS intake harder on phones than desktops", () => {
    const phone = resolvePerformanceProfile({ userAgent: ANDROID, hardwareConcurrency: 8 });
    const desk = resolvePerformanceProfile({ userAgent: DESKTOP, hardwareConcurrency: 8 });
    expect(phone.wasmThreads).toBeLessThan(desk.wasmThreads);
    expect(phone.nmsCandidateCap).toBeLessThan(desk.nmsCandidateCap);
    expect(phone.imgszCeiling).toBe(480);
    expect(desk.imgszCeiling).toBe(640);
  });

  it("never drops below one thread", () => {
    const p = resolvePerformanceProfile({ userAgent: ANDROID, hardwareConcurrency: 1 }, "balanced");
    expect(p.wasmThreads).toBeGreaterThanOrEqual(1);
  });

  it("tightens further on low-memory phones", () => {
    const weak = resolvePerformanceProfile({
      userAgent: ANDROID,
      hardwareConcurrency: 4,
      deviceMemory: 2,
    });
    expect(weak.nmsCandidateCap).toBeLessThanOrEqual(48);
  });

  it("quality mode widens intake without lowering thresholds", () => {
    const q = resolvePerformanceProfile({ userAgent: ANDROID, hardwareConcurrency: 8 }, "quality");
    expect(q.nmsCandidateCap).toBeGreaterThanOrEqual(200);
    expect(q.imgszCeiling).toBe(640);
  });

  it("keeps a plausible detection ceiling for a single driver everywhere", () => {
    for (const ua of [ANDROID, DESKTOP, IPAD]) {
      const p = resolvePerformanceProfile({ userAgent: ua, hardwareConcurrency: 8 });
      expect(p.maxDetections).toBeGreaterThanOrEqual(8);
      expect(p.maxDetections).toBeLessThanOrEqual(12);
    }
  });
});
