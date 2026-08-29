import { describe, expect, it } from "vitest";

import type { ModelMetadata } from "@/features/drowsiness/labels";
import {
  checkModelCompatibility,
  pickLightestModel,
} from "./model-compatibility";

function model(patch: Partial<ModelMetadata> = {}): ModelMetadata {
  return {
    id: "m1",
    modelName: "yolo26n-480-fast",
    version: "5.0.0",
    engineKind: "onnx",
    headFormat: "yolo-nms",
    framework: "ultralytics",
    modelUrl: "/models/a.onnx",
    cpuModelUrl: null,
    imgsz: 480,
    numClasses: 3,
    labels: { "0": "closed_eye", "1": "open_eye", "2": "yawning" },
    semanticMap: { closed_eye: "eye_closed", open_eye: "eye_open", yawning: "yawn" },
    postprocessConfig: {
      confThreshold: 0.25,
      iouThreshold: 0.5,
      maxDetections: 300,
      classIdOffset: 0,
      resize: "letterbox",
      normalize: "unit",
      classThresholds: { "0": 0.3, "1": 0.33, "2": 0.25 },
    },
    exportPrecision: "fp16",
    accuracyUnverified: false,
    quantization: null,
    presenceMacroF1: null,
    bestFor: null,
    fileSizeBytes: 10_000_000,
    cpuFileSizeBytes: null,
    precision: null,
    recall: null,
    map50: null,
    map50Corrected: null,
    map5095: null,
    apPerClass: null,
    apPerClassCorrected: null,
    recallPerClass: null,
    f1: null,
    relativeCompute: null,
    metricsNote: null,
    evaluatedOn: null,
    trainedAt: null,
    notes: null,
    isActive: true,

    ...patch,
  };
}

describe("checkModelCompatibility", () => {
  it("accepts a well-formed mobile model", () => {
    const r = checkModelCompatibility(model(), { constrained: true });
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("blocks when no model is selected", () => {
    expect(checkModelCompatibility(null, { constrained: false }).ok).toBe(false);
  });

  it("blocks a missing file, bad stride and unknown head", () => {
    const r = checkModelCompatibility(
      model({ modelUrl: "", imgsz: 300, headFormat: "yolo-nas" as never }),
      { constrained: false },
    );
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.id).sort()).toEqual(["head-format", "imgsz-stride", "no-file"]);
  });

  it("blocks when a required semantic class is missing", () => {
    const r = checkModelCompatibility(
      model({ semanticMap: { open_eye: "eye_open", closed_eye: "eye_closed" }, numClasses: 2, labels: { "0": "closed_eye", "1": "open_eye" } }),
      { constrained: false },
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.id === "semantics")).toBe(true);
  });

  it("warns (but does not block) for heavy models on phones", () => {
    const r = checkModelCompatibility(
      model({ modelName: "yolo11m-worstcase-640-int8", imgsz: 640, fileSizeBytes: 20_462_108 }),
      { constrained: true },
    );
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.id).sort()).toEqual(["mobile-imgsz", "mobile-size"]);
  });

  it("does not warn about heavy models on desktop", () => {
    const r = checkModelCompatibility(model({ imgsz: 640 }), { constrained: false });
    expect(r.warnings).toHaveLength(0);
  });

  it("picks the smallest usable CNN model", () => {
    const lightest = pickLightestModel([
      model({ id: "a", imgsz: 640 }),
      model({ id: "b", imgsz: 320 }),
      model({ id: "c", imgsz: 384, headFormat: "rf-detr" }),
    ]);
    expect(lightest?.id).toBe("b");
  });
});
