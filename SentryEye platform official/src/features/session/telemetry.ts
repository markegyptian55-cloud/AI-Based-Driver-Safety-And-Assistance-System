// Turns the in-memory capture profile into the numbers we persist.
//
// Averages hide stutter: a run can average 12 FPS and still freeze for a
// second every ten. So the row stores medians *and* 95th percentiles, plus
// the drop rate and the worst stall — the three figures that actually explain
// "it felt laggy".

import { quantiles, type CaptureProfileStats, type CaptureSample } from "./capture-profiler";
import type { SessionTelemetry } from "./session-recorder";

export function telemetryFromProfile(
  stats: CaptureProfileStats,
  samples: CaptureSample[],
): SessionTelemetry {
  const fps = quantiles(samples.map((s) => s.analysedFps).filter((v) => v > 0));
  return {
    // p50/p95 on FPS are inverted in meaning: p50 is the typical rate, p95 the
    // best case, so the *low* end matters. We keep both and chart them.
    fps_p50: round2(fps.p50 || stats.analysedFps),
    fps_p95: round2(fps.p95 || stats.analysedFps),
    latency_p50_ms: round2(stats.latency.p50),
    latency_p95_ms: round2(stats.latency.p95),
    infer_p50_ms: round2(stats.inferMs.p50),
    infer_p95_ms: round2(stats.inferMs.p95),
    drop_rate: round3(stats.dropRate),
    dropped_frames: Math.round(stats.droppedFrames),
    worst_stall_ms: Math.round(stats.worstGapMs),
  };
}

function round2(v: number) {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function round3(v: number) {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
}
