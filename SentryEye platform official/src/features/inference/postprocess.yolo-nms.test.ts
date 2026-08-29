import { describe, expect, it } from "vitest";

import { decodeYoloNms, type DecodeConfig } from "./postprocess";

const cfg: DecodeConfig = {
  imgsz: 480,
  numClasses: 3,
  labels: { "0": "closed_eye", "1": "open_eye", "2": "yawning" },
  semanticMap: { closed_eye: "eye_closed", open_eye: "eye_open", yawning: "yawn" },
  confThreshold: 0.25,
  iouThreshold: 0.5,
  maxDetections: 12,
  headFormat: "yolo-nms",
  classIdOffset: 0,
  classThresholds: { "0": 0.3, "1": 0.33, "2": 0.25 },
};

// 640x360 source letterboxed into 480x480: scale 0.75, vertical pad 105.
const geo = { srcW: 640, srcH: 360, scale: 0.75, scaleX: 0.75, scaleY: 0.75, padX: 0, padY: 105 };

function tensor(rows: number[][], total = 300): { data: Float32Array; dims: number[] } {
  const data = new Float32Array(total * 6);
  rows.forEach((r, i) => data.set(r, i * 6));
  return { data, dims: [1, total, 6] };
}

describe("decodeYoloNms", () => {
  it("keeps only real rows out of the fixed 300-row padded tensor", () => {
    // One real eye, the remaining 299 rows are zero-filled padding.
    const t = tensor([[100, 150, 160, 190, 0.72, 0]]);
    const out = decodeYoloNms(t.data, t.dims, cfg, geo);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("closed_eye");
  });

  it("applies the inverse letterbox transform", () => {
    // Box spanning the full padded width and the whole un-padded image band.
    const t = tensor([[0, 105, 480, 375, 0.9, 1]]);
    const [d] = decodeYoloNms(t.data, t.dims, cfg, geo);
    expect(d.bbox[0]).toBeCloseTo(0, 5);
    expect(d.bbox[1]).toBeCloseTo(0, 5);
    expect(d.bbox[2]).toBeCloseTo(1, 5);
    expect(d.bbox[3]).toBeCloseTo(1, 5);
  });

  it("enforces per-class floors instead of one global threshold", () => {
    const t = tensor([
      [10, 120, 40, 150, 0.31, 0], // closed_eye floor 0.30 -> keep
      [50, 120, 80, 150, 0.31, 1], // open_eye floor 0.33 -> drop
      [90, 120, 140, 170, 0.26, 2], // yawning floor 0.25 -> keep
    ]);
    const out = decodeYoloNms(t.data, t.dims, cfg, geo);
    expect(out.map((d) => d.label).sort()).toEqual(["closed_eye", "yawning"]);
  });

  it("rejects padding rows that carry a class id but no confidence", () => {
    const t = tensor([
      [0, 0, 0, 0, 0, 2],
      [0, 0, 0, 0, 0, 7],
    ]);
    expect(decodeYoloNms(t.data, t.dims, cfg, geo)).toHaveLength(0);
  });

  it("caps output at maxDetections, highest confidence first", () => {
    const rows = Array.from({ length: 40 }, (_, i) => [
      i * 5,
      120,
      i * 5 + 20,
      150,
      0.4 + i / 1000,
      0,
    ]);
    const t = tensor(rows);
    const out = decodeYoloNms(t.data, t.dims, cfg, geo);
    expect(out).toHaveLength(12);
    expect(out[0].confidence).toBeGreaterThan(out[11].confidence);
  });
});
