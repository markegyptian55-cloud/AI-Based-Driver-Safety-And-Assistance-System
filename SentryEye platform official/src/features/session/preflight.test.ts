import { describe, expect, it } from "vitest";

import { evaluatePreflight, meanLumaFromRgba, type PreflightSample } from "./preflight";

function samples(n: number, s: Partial<PreflightSample>): PreflightSample[] {
  return Array.from({ length: n }, () => ({
    luma: 0.4,
    faceRatio: 0.12,
    faceCenter: { x: 0.5, y: 0.5 },
    ...s,
  }));
}

const check = (r: ReturnType<typeof evaluatePreflight>, id: string) =>
  r.checks.find((c) => c.id === id)!;

describe("preflight", () => {
  it("blocks analysis until the camera is streaming", () => {
    const r = evaluatePreflight([], { streaming: false });
    expect(r.ready).toBe(false);
    expect(check(r, "camera").status).toBe("pending");
  });

  it("passes a well-lit, well-framed setup", () => {
    const r = evaluatePreflight(samples(8, {}), { streaming: true });
    expect(r.ready).toBe(true);
  });

  it("fails and explains a dark scene", () => {
    const r = evaluatePreflight(samples(8, { luma: 0.03 }), { streaming: true });
    expect(check(r, "lighting").status).toBe("fail");
    expect(check(r, "lighting").hint).toMatch(/dark/i);
    expect(r.ready).toBe(false);
  });

  it("fails and explains a blown-out backlit scene", () => {
    const r = evaluatePreflight(samples(8, { luma: 0.99 }), { streaming: true });
    expect(check(r, "lighting").hint).toMatch(/bright/i);
  });

  it("asks the driver to move closer when the face is tiny", () => {
    const r = evaluatePreflight(samples(8, { faceRatio: 0.01 }), { streaming: true });
    expect(check(r, "framing").status).toBe("fail");
    expect(check(r, "framing").hint).toMatch(/closer/i);
  });

  it("asks the driver to center themselves when off to the side", () => {
    const r = evaluatePreflight(samples(8, { faceCenter: { x: 0.05, y: 0.5 } }), {
      streaming: true,
    });
    expect(check(r, "framing").hint).toMatch(/center/i);
  });

  it("falls back to manual framing confirmation without a face detector", () => {
    const noDetector = samples(8, { faceRatio: null, faceCenter: null });
    const r = evaluatePreflight(noDetector, { streaming: true });
    expect(r.needsManualFraming).toBe(true);
    expect(r.ready).toBe(false);
    const confirmed = evaluatePreflight(noDetector, {
      streaming: true,
      manualFramingConfirmed: true,
    });
    expect(confirmed.ready).toBe(true);
  });

  it("stays pending until enough samples are collected", () => {
    const r = evaluatePreflight(samples(2, {}), { streaming: true });
    expect(check(r, "lighting").status).toBe("pending");
    expect(r.ready).toBe(false);
  });

  it("computes mean luma from an RGBA buffer", () => {
    const white = new Uint8ClampedArray(4 * 64).fill(255);
    expect(meanLumaFromRgba(white, 1)).toBeCloseTo(1, 2);
    const black = new Uint8ClampedArray(4 * 64);
    expect(meanLumaFromRgba(black, 1)).toBe(0);
  });
});
