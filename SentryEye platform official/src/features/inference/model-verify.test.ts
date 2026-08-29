import { describe, expect, it } from "vitest";

import { judgeVerification, maxBoxesPerClass } from "./model-verify";
import type { Detection } from "./types";

const box = (semantic: string, confidence = 0.8): Detection =>
  ({
    label: semantic,
    semantic,
    confidence,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  }) as unknown as Detection;

describe("model verification", () => {
  it("passes a fast model with a plausible face", () => {
    const verdict = judgeVerification({
      latencyMs: 60,
      detections: [box("eye_open"), box("eye_open"), box("yawn")],
    });
    expect(verdict.status).toBe("pass");
  });

  it("fails when boxes stack on one feature", () => {
    const verdict = judgeVerification({
      latencyMs: 60,
      detections: [box("eye_open"), box("eye_open"), box("eye_open")],
    });
    expect(verdict.status).toBe("fail");
  });

  it("fails a model that is far too slow to drive with", () => {
    expect(judgeVerification({ latencyMs: 1500, detections: [box("eye_open")] }).status).toBe(
      "fail",
    );
  });

  it("warns on borderline latency", () => {
    expect(judgeVerification({ latencyMs: 600, detections: [box("eye_open")] }).status).toBe("warn");
  });

  it("counts the busiest class", () => {
    expect(maxBoxesPerClass([box("eye_open"), box("eye_open"), box("yawn")])).toBe(2);
  });
});
