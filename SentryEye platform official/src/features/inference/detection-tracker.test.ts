import { describe, expect, it } from "vitest";

import { createDetectionTracker } from "./detection-tracker";
import { MOBILE_LOWLIGHT_PRESET, DESKTOP_PRESET, selectPreset } from "./mobile-presets";
import type { Detection } from "./types";

function det(
  bbox: [number, number, number, number],
  semantic: string,
  confidence = 0.6,
): Detection {
  return {
    bbox,
    classId: semantic === "eye_open" ? 0 : 1,
    label: semantic,
    semantic,
    confidence,
  } as Detection;
}

const cfg = MOBILE_LOWLIGHT_PRESET.tracker;

describe("detection tracker", () => {
  it("requires minHits before emitting a new box", () => {
    const t = createDetectionTracker({ ...cfg, minHits: 2 });
    expect(t.update([det([10, 10, 20, 10], "eye_open")])).toHaveLength(0);
    expect(t.update([det([10, 10, 20, 10], "eye_open")])).toHaveLength(1);
  });

  it("coasts through a dropped frame instead of blanking the overlay", () => {
    const t = createDetectionTracker({ ...cfg, minHits: 1, maxMissedFrames: 2 });
    t.update([det([10, 10, 20, 10], "eye_closed")]);
    expect(t.update([])).toHaveLength(1);
    expect(t.stats().coasting).toBe(1);
  });

  it("drops a track once it exceeds maxMissedFrames", () => {
    const t = createDetectionTracker({ ...cfg, minHits: 1, maxMissedFrames: 1 });
    t.update([det([10, 10, 20, 10], "eye_closed")]);
    t.update([]);
    expect(t.update([])).toHaveLength(0);
  });

  it("smooths jittery boxes instead of snapping to raw output", () => {
    const t = createDetectionTracker({ ...cfg, minHits: 1, smoothing: 0.5 });
    t.update([det([0, 0, 20, 10], "eye_open")]);
    const [out] = t.update([det([10, 0, 20, 10], "eye_open")]);
    expect(out.bbox[0]).toBeGreaterThan(0);
    expect(out.bbox[0]).toBeLessThan(10);
  });

  it("holds the label until the flip is confirmed over several frames", () => {
    const t = createDetectionTracker({ ...cfg, minHits: 1, labelFlipFrames: 3 });
    t.update([det([0, 0, 20, 10], "eye_open")]);
    // One noisy frame must not report the driver as asleep.
    expect(t.update([det([0, 0, 20, 10], "eye_closed")])[0].semantic).toBe("eye_open");
    t.update([det([0, 0, 20, 10], "eye_closed")]);
    expect(t.update([det([0, 0, 20, 10], "eye_closed")])[0].semantic).toBe("eye_closed");
  });

  it("filters intake noise below the preset's confidence floor", () => {
    const t = createDetectionTracker({ ...cfg, minHits: 1, intakeConfThreshold: 0.3 });
    expect(t.update([det([0, 0, 20, 10], "eye_open", 0.1)])).toHaveLength(0);
  });
});

describe("preset selection", () => {
  it("uses the low-light preset on constrained devices under auto", () => {
    expect(selectPreset("auto", true).id).toBe("mobile-lowlight");
    expect(selectPreset("auto", false).id).toBe("desktop");
  });

  it("honours an explicit override on any device", () => {
    expect(selectPreset("desktop", true).id).toBe("desktop");
    expect(selectPreset("mobile-lowlight", false).id).toBe("mobile-lowlight");
  });

  it("keeps the mobile preset more permissive and more patient", () => {
    expect(MOBILE_LOWLIGHT_PRESET.confThreshold).toBeLessThan(DESKTOP_PRESET.confThreshold);
    expect(MOBILE_LOWLIGHT_PRESET.scoring.eyeClosedMsThreshold).toBeGreaterThanOrEqual(
      DESKTOP_PRESET.scoring.eyeClosedMsThreshold,
    );
    expect(MOBILE_LOWLIGHT_PRESET.autoGain).toBe(true);
  });
});
