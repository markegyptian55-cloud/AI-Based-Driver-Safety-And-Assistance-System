import { describe, expect, it } from "vitest";

import {
  computeCalibration,
  spellDurations,
  faceRatioFromBoxes,
  applyCalibrationToPreset,
} from "./calibration";
import { assessQuality, sharpnessFromRgba, QUALITY_BLOCK_SCORE } from "./detection-quality";
import { buildSessionCsv } from "./session-csv";
import { redactDiagnostics, coarseUserAgent } from "./diagnostics-redact";
import { MOBILE_LOWLIGHT_PRESET } from "../inference/mobile-presets";

describe("calibration", () => {
  it("derives a closure threshold well above the driver's own blink", () => {
    const p = computeCalibration({
      luma: [0.1, 0.12, 0.11],
      faceRatio: [0.2, 0.22, 0.21],
      eyeConfidence: [0.6, 0.55, 0.62],
      blinkDurationsMs: [120, 140, 130],
      yawnDurationMs: 2000,
      mouthAspects: [0.8, 0.9],
    });
    expect(p.eyeClosedMsThreshold).toBeGreaterThan(200);
    expect(p.eyeClosedMsThreshold).toBeLessThan(400);
    expect(p.baseGain).toBeGreaterThan(1);
    expect(p.autoGainTargetLuma).toBeGreaterThan(0.15);
  });

  it("marks a run with no blink data as partial and falls back to defaults", () => {
    const p = computeCalibration({
      luma: [0.4],
      faceRatio: [],
      eyeConfidence: [],
      blinkDurationsMs: [],
      yawnDurationMs: null,
      mouthAspects: [],
    });
    expect(p.partial).toBe(true);
    expect(p.eyeClosedMsThreshold).toBe(450);
  });

  it("measures continuous spells", () => {
    expect(
      spellDurations([
        { ts: 0, active: false },
        { ts: 100, active: true },
        { ts: 200, active: true },
        { ts: 300, active: false },
      ]),
    ).toEqual([200]);
  });

  it("estimates face coverage from eye/mouth boxes", () => {
    const r = faceRatioFromBoxes([
      { bbox: [0.4, 0.4, 0.05, 0.03] },
      { bbox: [0.55, 0.4, 0.05, 0.03] },
    ]);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });

  it("overrides preset thresholds with measured values", () => {
    const p = computeCalibration({
      luma: [0.3],
      faceRatio: [0.2],
      eyeConfidence: [0.5],
      blinkDurationsMs: [200],
      yawnDurationMs: 1800,
      mouthAspects: [0.7],
    });
    const merged = applyCalibrationToPreset(MOBILE_LOWLIGHT_PRESET, p);
    expect(merged.scoring.eyeClosedMsThreshold).toBe(p.eyeClosedMsThreshold);
    expect(merged.tracker.displayConfThreshold).toBe(p.displayConfThreshold);
    expect(applyCalibrationToPreset(MOBILE_LOWLIGHT_PRESET, null)).toBe(MOBILE_LOWLIGHT_PRESET);
  });
});

describe("detection quality", () => {
  const good = {
    luma: 0.35,
    sharpness: 0.4,
    faceRatio: 0.2,
    eyeConfidence: 0.7,
    activeTracks: 2,
    analysedFps: 12,
  };

  it("passes a healthy frame", () => {
    const q = assessQuality(good);
    expect(q.usable).toBe(true);
    expect(q.reason).toBeNull();
  });

  it("blames darkness in a dark cabin", () => {
    const q = assessQuality({ ...good, luma: 0.03 });
    expect(q.score).toBeLessThan(QUALITY_BLOCK_SCORE);
    expect(q.reason?.id).toBe("lighting-dark");
    expect(q.reason?.fix).toMatch(/dark/i);
  });

  it("blames blur, distance and occlusion independently", () => {
    expect(assessQuality({ ...good, sharpness: 0.01 }).reason?.id).toBe("blur");
    expect(assessQuality({ ...good, faceRatio: 0.01 }).reason?.id).toBe("distance");
    expect(assessQuality({ ...good, activeTracks: 0 }).reason?.id).toBe("occlusion");
  });

  it("scores a flat grey image as unsharp", () => {
    const flat = new Uint8ClampedArray(16 * 16 * 4).fill(120);
    expect(sharpnessFromRgba(flat, 16, 16)).toBeLessThan(0.05);
  });
});

describe("csv export", () => {
  it("emits metadata, events and timeline blocks", () => {
    const csv = buildSessionCsv({
      meta: { sessionId: "abc", source: "webcam" },
      startedAt: 1000,
      events: [{ kind: "microsleep", ts: 2000, confidence: 0.9, riskLevel: "danger" }],
      timeline: [
        {
          ts: 1500,
          t: 500,
          eyeOpenConf: 0.1,
          eyeClosedConf: 0.9,
          yawnConf: 0,
          perclos: 0.5,
          closureMs: 600,
          microsleepActive: true,
          risk: "danger",
          luma: 0.2,
          gain: 1.4,
          qualityScore: 72,
          latencyMs: 40,
          tracks: 2,
        },
      ],
    });
    expect(csv).toContain("# events");
    expect(csv).toContain("microsleep");
    expect(csv).toContain("# confidence timeline");
    expect(csv).toContain("1000");
  });
});

describe("diagnostics redaction", () => {
  it("strips identifiers, emails and urls before sharing", () => {
    const { bundle, removed } = redactDiagnostics({
      schema: "sentryeye.diagnostics.v1",
      generatedAt: new Date().toISOString(),
      durationMs: 1000,
      meta: { sessionId: "1e3f", source: "webcam" },
      device: { userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537" },
      entries: [
        {
          t: 1,
          level: "info",
          kind: "stage:acquiring-provider",
          data: {
            modelUrl: "https://cdn.example.com/best.onnx",
            note: "driver a@b.com id 123e4567-e89b-12d3-a456-426614174000",
          },
        },
      ],
      truncatedEntries: 0,
    });
    const json = JSON.stringify(bundle);
    expect(json).not.toContain("a@b.com");
    expect(json).not.toContain("cdn.example.com");
    expect(json).not.toContain("123e4567");
    expect(bundle.meta.sessionId).toBeNull();
    expect(removed.length).toBeGreaterThan(0);
  });

  it("coarsens the user agent", () => {
    expect(coarseUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17) Version/17.0 Safari/605")).toBe(
      "Safari 17 on iOS",
    );
  });
});
