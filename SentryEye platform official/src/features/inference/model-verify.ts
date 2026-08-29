// Pre-start model verification.
//
// A model that loads is not the same as a model that *works*. Reduced-precision
// mobile GPU drivers happily create a session and then emit saturated, stacked
// boxes on real faces. Before live detection starts we therefore push a small
// synthetic face-like frame through the freshly warmed provider and check three
// things: it answers fast enough, it does not flood, and it does not stack many
// boxes on the same feature.

import { inspectDetections } from "./postprocess";
import type { Detection, InferenceProvider } from "./types";

export interface ModelVerification {
  status: "pass" | "warn" | "fail";
  /** Median latency of the probe frames (ms). */
  latencyMs: number;
  /** Boxes returned on the last probe frame. */
  boxes: number;
  /** Human-readable reason, always set for warn/fail. */
  reason: string | null;
}

/** A phone that needs > 400ms per frame cannot run a useful live session. */
const SLOW_MS = 400;
const VERY_SLOW_MS = 900;
/** One driver, one face: more than this on a synthetic frame means broken decode. */
const MAX_SANE_BOXES = 12;

/** Two high-contrast blobs at eye spacing plus a mouth — enough to exercise decode. */
async function faceLikeFrame(imgsz: number): Promise<ImageBitmap> {
  const size = Math.max(64, Math.min(1536, Math.round(imgsz)));
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = (canvas as OffscreenCanvas).getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("2D canvas unavailable for model verification");
  ctx.fillStyle = "#8a7c70";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#d8c3b0";
  ctx.beginPath();
  ctx.ellipse(size / 2, size / 2, size * 0.3, size * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#20242c";
  for (const cx of [0.4, 0.6]) {
    ctx.beginPath();
    ctx.ellipse(size * cx, size * 0.44, size * 0.05, size * 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(size * 0.5, size * 0.66, size * 0.08, size * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  return createImageBitmap(canvas as never);
}

/** Highest number of boxes of a single class — the "stacked on one eye" signal. */
export function maxBoxesPerClass(detections: Detection[]): number {
  const counts = new Map<string, number>();
  for (const d of detections) counts.set(d.semantic, (counts.get(d.semantic) ?? 0) + 1);
  return counts.size ? Math.max(...counts.values()) : 0;
}

/** Pure verdict over measured numbers, so it can be unit tested without a GPU. */
export function judgeVerification(input: {
  latencyMs: number;
  detections: Detection[];
}): ModelVerification {
  const { latencyMs, detections } = input;
  const health = inspectDetections(detections, MAX_SANE_BOXES);
  if (health.degenerate) {
    return {
      status: "fail",
      latencyMs,
      boxes: detections.length,
      reason: `Model output looks corrupted on this device (${health.reason}).`,
    };
  }
  if (detections.length > MAX_SANE_BOXES || maxBoxesPerClass(detections) > 2) {
    return {
      status: "fail",
      latencyMs,
      boxes: detections.length,
      reason: "Model returns stacked duplicate boxes for a single face.",
    };
  }
  if (latencyMs > VERY_SLOW_MS) {
    return {
      status: "fail",
      latencyMs,
      boxes: detections.length,
      reason: `Too slow on this device (${Math.round(latencyMs)} ms per frame).`,
    };
  }
  if (latencyMs > SLOW_MS) {
    return {
      status: "warn",
      latencyMs,
      boxes: detections.length,
      reason: `Slow on this device (${Math.round(latencyMs)} ms per frame) — expect a low frame rate.`,
    };
  }
  return { status: "pass", latencyMs, boxes: detections.length, reason: null };
}

/**
 * Run the quick check. Never throws: a probe failure downgrades to "warn" so a
 * driver is informed rather than locked out.
 */
export async function verifyModel(
  provider: InferenceProvider,
  imgsz: number,
  frames = 2,
): Promise<ModelVerification> {
  try {
    let latency = 0;
    let detections: Detection[] = [];
    for (let i = 0; i < frames; i += 1) {
      const bitmap = await faceLikeFrame(imgsz);
      const startedAt = performance.now();
      const result = await provider.infer(bitmap, Date.now());
      latency = performance.now() - startedAt;
      bitmap.close?.();
      detections = result.detections;
    }
    return judgeVerification({ latencyMs: latency, detections });
  } catch (err) {
    return {
      status: "warn",
      latencyMs: 0,
      boxes: 0,
      reason: `Verification could not run (${err instanceof Error ? err.message : "unknown error"}).`,
    };
  }
}
