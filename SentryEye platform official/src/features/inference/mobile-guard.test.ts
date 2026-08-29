import { describe, it, expect } from "vitest";
import { inspectDetections, inspectTensor, selectPlausibleFaceFeatures } from "@/features/inference/postprocess";
import { planExecutionProviders, isConstrainedDevice } from "@/features/inference/engine-preference";

const det = (c: number) => ({ classId: 0, label: "eye_open", semantic: "eye_open", confidence: c, bbox: [0,0,0.1,0.1] as [number,number,number,number] });

describe("guards", () => {
  it("flags a flood of boxes", () => {
    expect(inspectDetections(Array.from({length:40},()=>det(0.5))).degenerate).toBe(true);
  });
  it("flags flat confidences", () => {
    expect(inspectDetections(Array.from({length:10},(_,i)=>det(0.50+i*0.001))).reason).toBe("flat-confidence");
  });
  it("accepts a normal frame", () => {
    expect(inspectDetections([det(0.91), det(0.62), det(0.44)]).degenerate).toBe(false);
  });
  it("keeps at most two distinct eyes and one mouth", () => {
    const detections = [
      det(0.95),
      { ...det(0.9), bbox: [0.01, 0.01, 0.1, 0.1] as [number, number, number, number] },
      { ...det(0.85), bbox: [0.4, 0, 0.1, 0.1] as [number, number, number, number] },
      { ...det(0.8), semantic: "yawn", label: "yawn", bbox: [0.2, 0.4, 0.2, 0.1] as [number, number, number, number] },
      { ...det(0.7), semantic: "yawn", label: "yawn", bbox: [0.25, 0.4, 0.2, 0.1] as [number, number, number, number] },
    ];
    const selected = selectPlausibleFaceFeatures(detections);
    expect(selected.filter((d) => d.semantic.startsWith("eye"))).toHaveLength(2);
    expect(selected.filter((d) => d.semantic === "yawn")).toHaveLength(1);
  });
  it("detects NaN and constant tensors", () => {
    expect(inspectTensor(new Float32Array([1, NaN, 2])).finite).toBe(false);
    expect(inspectTensor(new Float32Array([0,0,0])).constant).toBe(true);
  });
  it("lets phones try webgpu first, with wasm as the self-test fallback", () => {
    expect(planExecutionProviders("auto", true, true)).toEqual(["webgpu","wasm"]);
    expect(planExecutionProviders("auto", true, false)).toEqual(["wasm"]);
    expect(planExecutionProviders("auto", false, true)).toEqual(["webgpu","wasm"]);
    expect(planExecutionProviders("webgpu", true, true)).toEqual(["webgpu","wasm"]);
  });
  it("recognises mobile UAs", () => {
    expect(isConstrainedDevice({ userAgent: "Mozilla/5.0 (Linux; Android 13) Mobile" })).toBe(true);
    expect(isConstrainedDevice({ userAgent: "Macintosh", hardwareConcurrency: 12 })).toBe(false);
    // A low-core desktop is still a desktop: it must not inherit phone camera
    // geometry, thresholds, or automatic model selection.
    expect(isConstrainedDevice({ userAgent: "Windows NT 10.0", hardwareConcurrency: 4 })).toBe(false);
  });
});
