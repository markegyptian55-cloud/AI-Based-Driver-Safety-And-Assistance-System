import { describe, it, expect } from "vitest";
import { classAwareNms } from "@/features/inference/postprocess";
import { createDetectionTracker } from "@/features/inference/detection-tracker";
import { pickDefaultModel } from "@/features/inference/model-context";
import type { ModelMetadata } from "@/features/drowsiness/labels";

describe("classAwareNms", () => {
  it("collapses a stack of same-class boxes on one eye", () => {
    // Three near-identical "open eye" boxes — the Android cluster.
    const boxes = [0.1, 0.1, 0.1, 0.05, 0.11, 0.1, 0.1, 0.05, 0.105, 0.102, 0.1, 0.05];
    const keep = classAwareNms(boxes, [0.73, 0.66, 0.61], [1, 1, 1], 0.5, 100);
    expect(keep).toEqual([0]);
  });

  it("keeps two genuinely separate eyes", () => {
    const boxes = [0.1, 0.1, 0.08, 0.05, 0.4, 0.1, 0.08, 0.05];
    expect(classAwareNms(boxes, [0.8, 0.7], [1, 1], 0.5, 100)).toHaveLength(2);
  });

  it("drops an overlapping opposite-class box (an eye cannot be open and closed)", () => {
    const boxes = [0.1, 0.1, 0.1, 0.05, 0.102, 0.101, 0.1, 0.05];
    expect(classAwareNms(boxes, [0.8, 0.6], [1, 0], 0.5, 100)).toEqual([0]);
  });
});

const det = (semantic: string, x: number) => ({
  classId: 1,
  label: semantic,
  semantic,
  confidence: 0.9,
  bbox: [x, 0.1, 0.1, 0.05] as [number, number, number, number],
});

describe("time-based track expiry", () => {
  const cfg = {
    iouMatchThreshold: 0.2,
    smoothing: 0.5,
    maxMissedFrames: 5,
    maxMissedMs: 500,
    minHits: 1,
    labelFlipFrames: 2,
    intakeConfThreshold: 0.2,
    displayConfThreshold: 0.3,
  };

  it("drops a coasting box once it is older than maxMissedMs, even at 2 fps", () => {
    const t = createDetectionTracker(cfg);
    t.update([det("eye_open", 0.1)], 1000);
    expect(t.update([], 1400)).toHaveLength(1); // still fresh
    expect(t.update([], 2000)).toHaveLength(0); // >500 ms stale
  });
});

const model = (modelName: string, imgsz = 960, bestFor: string | null = null): ModelMetadata =>
  ({ id: modelName, modelName, imgsz, bestFor }) as unknown as ModelMetadata;

describe("device-aware default model", () => {
  const models = [
    model("yolo26n-960-high", 960, "high-quality"),
    model("yolo26n-480-fast", 480, "default"),
  ];
  it("gives phones the 480 model", () => {
    expect(pickDefaultModel(models, true)?.modelName).toBe("yolo26n-480-fast");
  });
  it("keeps desktops on the most accurate model", () => {
    expect(pickDefaultModel(models, false)?.modelName).toBe("yolo26n-960-high");
  });
  it("falls back to size ordering when bestFor is absent", () => {
    const bare = [model("big", 960), model("small", 480)];
    expect(pickDefaultModel(bare, true)?.modelName).toBe("small");
    expect(pickDefaultModel(bare, false)?.modelName).toBe("big");
  });
});

