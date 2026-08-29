// Regression detection across repeated benchmark runs.
//
// One run is an anecdote. The useful question is "did this device get slower or
// start seeing different boxes than it did last week, on the same footage?" —
// so runs are compared per model, per device class, and both the timing metrics
// *and* the mean box counts are diffed. A path that got faster while producing
// half the boxes is a regression, not a win.

import type { BenchResult } from "@/features/inference/benchmark";
import type { BenchmarkRun } from "./benchmark-runs";
import { classifyDevice, type DeviceClass } from "@/features/inference/performance-mode";

export interface ModelComparison {
  id: string;
  label: string;
  fpsBefore: number;
  fpsAfter: number;
  fpsDeltaPct: number;
  latencyBeforeMs: number;
  latencyAfterMs: number;
  latencyDeltaPct: number;
  boxesBefore: number;
  boxesAfter: number;
  boxDeltaPct: number;
  regressed: boolean;
  note: string;
}

export interface RunComparison {
  deviceClass: DeviceClass | "unknown";
  sameFrameSource: boolean;
  models: ModelComparison[];
  regressions: number;
}

/** Slower/less-detecting by more than this fraction counts as a regression. */
export const REGRESSION_THRESHOLD = 0.2;

export function deviceClassOfRun(run: BenchmarkRun): DeviceClass | "unknown" {
  const ua = run.device?.userAgent;
  if (!ua || ua === "unknown") return "unknown";
  return classifyDevice({ userAgent: ua, hardwareConcurrency: run.device.cores ?? undefined });
}

const pct = (after: number, before: number) =>
  before > 0 ? ((after - before) / before) * 100 : 0;

function byId(results: BenchResult[]): Map<string, BenchResult> {
  return new Map(results.filter((r) => r.ok).map((r) => [r.id, r]));
}

/** Compare a newer run against an older one taken on the same device. */
export function compareRuns(previous: BenchmarkRun, current: BenchmarkRun): RunComparison {
  const before = byId(previous.results ?? []);
  const after = byId(current.results ?? []);
  const models: ModelComparison[] = [];

  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) continue;
    const fpsDeltaPct = pct(a.fps, b.fps);
    const latencyDeltaPct = pct(a.latencyP95, b.latencyP95);
    const boxDeltaPct = pct(a.meanDetections, b.meanDetections);
    const slower = fpsDeltaPct <= -REGRESSION_THRESHOLD * 100;
    const laggier = latencyDeltaPct >= REGRESSION_THRESHOLD * 100;
    const fewerBoxes = boxDeltaPct <= -REGRESSION_THRESHOLD * 100;
    const regressed = slower || laggier || fewerBoxes;
    models.push({
      id,
      label: a.label,
      fpsBefore: b.fps,
      fpsAfter: a.fps,
      fpsDeltaPct,
      latencyBeforeMs: b.latencyP95,
      latencyAfterMs: a.latencyP95,
      latencyDeltaPct,
      boxesBefore: b.meanDetections,
      boxesAfter: a.meanDetections,
      boxDeltaPct,
      regressed,
      note: regressed
        ? fewerBoxes && !slower && !laggier
          ? `Detects ${Math.abs(boxDeltaPct).toFixed(0)}% fewer boxes than the earlier run — accuracy regression.`
          : `${Math.abs(Math.min(fpsDeltaPct, 0)).toFixed(0)}% slower and ${latencyDeltaPct.toFixed(0)}% laggier than the earlier run.`
        : "In line with the earlier run on this device.",
    });
  }

  return {
    deviceClass: deviceClassOfRun(current),
    sameFrameSource: previous.frameSource === current.frameSource,
    models: models.sort((x, y) => x.label.localeCompare(y.label)),
    regressions: models.filter((m) => m.regressed).length,
  };
}

/** Group a run history by device class so phone and desktop never mix. */
export function groupRunsByDeviceClass(
  runs: BenchmarkRun[],
): Record<string, BenchmarkRun[]> {
  const out: Record<string, BenchmarkRun[]> = {};
  for (const run of runs) {
    const key = deviceClassOfRun(run);
    (out[key] ??= []).push(run);
  }
  return out;
}

/** Newest-vs-previous comparison inside each device class. */
export function latestComparisons(runs: BenchmarkRun[]): RunComparison[] {
  const grouped = groupRunsByDeviceClass(runs);
  const out: RunComparison[] = [];
  for (const list of Object.values(grouped)) {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (sorted.length >= 2) out.push(compareRuns(sorted[1], sorted[0]));
  }
  return out;
}
