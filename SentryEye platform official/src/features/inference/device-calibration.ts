// Device calibration for the fallback bar.
//
// A fixed "below 8 FPS" bar is wrong on both ends: on a desktop it never
// fires, on a three-year-old phone it fires constantly and the run ping-pongs
// between models. What the bar should express is "noticeably worse than what
// this device can actually do", so we measure the device first — its camera
// frame size and how fast it can push those frames through preprocessing and
// the model — and derive the numbers from that measurement.

import type { FallbackPreference } from "./auto-fallback";
import { clampPreference } from "./auto-fallback";

export interface DeviceMeasurement {
  /** Camera frame size actually delivered, e.g. 1280x720. */
  frameWidth: number;
  frameHeight: number;
  /** Frames per second the device sustained end-to-end. */
  achievedFps: number;
  /** 95th percentile end-to-end latency (ms). */
  latencyP95Ms: number;
  /** Time to resize+normalise one frame (ms) — the non-model overhead. */
  preprocessMs: number;
  frames: number;
}

/** Real-time floor: below this, short microsleeps are missed regardless. */
export const MIN_USABLE_FPS = 5;

/**
 * The bar sits below what the device demonstrably manages, not at it —
 * otherwise ordinary variance trips a switch. 65% of measured throughput and
 * 150% of measured p95 latency leave headroom for a busy frame without
 * ignoring a genuine collapse.
 */
export function suggestThresholds(m: DeviceMeasurement): FallbackPreference {
  const minFps = Math.max(MIN_USABLE_FPS, Math.round(m.achievedFps * 0.65));
  const maxLatencyMs = Math.max(120, Math.round(m.latencyP95Ms * 1.5));
  return clampPreference({ enabled: true, minFps, maxLatencyMs });
}

/** Plain-language reading of the measurement for the panel. */
export function describeMeasurement(m: DeviceMeasurement): string {
  const res = `${m.frameWidth}×${m.frameHeight}`;
  if (m.achievedFps >= 15)
    return `This device handles ${res} comfortably at ${m.achievedFps.toFixed(1)} FPS.`;
  if (m.achievedFps >= MIN_USABLE_FPS)
    return `This device manages ${m.achievedFps.toFixed(1)} FPS at ${res} — usable, but keep the lighter models in reach.`;
  return `Only ${m.achievedFps.toFixed(1)} FPS at ${res}. Short microsleeps will be missed here; use the smallest model or the remote service.`;
}

/** Measures the cost of preprocessing alone, separate from the model. */
export async function measurePreprocess(frame: ImageBitmap, imgsz: number, passes = 8) {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(imgsz, imgsz)
      : Object.assign(document.createElement("canvas"), { width: imgsz, height: imgsz });
  const ctx = (canvas as OffscreenCanvas).getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) return 0;
  const times: number[] = [];
  for (let i = 0; i < passes; i++) {
    const t0 = performance.now();
    ctx.drawImage(frame as unknown as CanvasImageSource, 0, 0, imgsz, imgsz);
    ctx.getImageData(0, 0, imgsz, imgsz);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)] * 100) / 100;
}
