// Per-device model report.
//
// The Live page needs one honest answer to "which model holds up on the thing
// in my hand?". A phone number and a laptop number averaged together answer
// nothing, so runs are grouped by device class first and only then by model
// path. Within a class the most recent measurement of each path wins: older
// runs describe a device state (thermals, browser version) that no longer
// exists.

import type { BenchResult } from "@/features/inference/benchmark";
import type { BenchmarkRun } from "./benchmark-runs";
import { deviceClassOfRun } from "./run-comparison";
import type { DeviceClass } from "@/features/inference/performance-mode";

export type ReportDeviceClass = DeviceClass | "unknown";

export interface ModelReportRow {
  /** Candidate id, e.g. "<model-uuid>:wasm". */
  id: string;
  label: string;
  engine: string;
  imgsz: number;
  fps: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  /** 0..1 — mean boxes per frame against the 3 a driver frame should yield. */
  detectionRate: number;
  meanDetections: number;
  measuredAt: string;
  frameSource: string;
  realtime: boolean;
}

export interface DeviceReport {
  deviceClass: ReportDeviceClass;
  measuredAt: string;
  rows: ModelReportRow[];
  /** Fastest row that still detects something. */
  best: ModelReportRow | null;
}

/** Expected boxes on a healthy driver frame: two eyes plus one mouth. */
export const EXPECTED_BOXES = 3;
/** Below this the pipeline misses microsleeps. */
export const REPORT_REALTIME_FPS = 10;

export function detectionRateOf(r: Pick<BenchResult, "meanDetections">): number {
  return Math.max(0, Math.min(1, r.meanDetections / EXPECTED_BOXES));
}

function toRow(r: BenchResult, run: BenchmarkRun): ModelReportRow {
  return {
    id: r.id,
    label: r.label,
    engine: r.engine,
    imgsz: r.imgsz,
    fps: r.fps,
    latencyP50Ms: r.latencyP50,
    latencyP95Ms: r.latencyP95,
    detectionRate: detectionRateOf(r),
    meanDetections: r.meanDetections,
    measuredAt: run.createdAt,
    frameSource: run.frameSource,
    realtime: r.fps >= REPORT_REALTIME_FPS,
  };
}

/**
 * Build one report per device class from stored runs, newest measurement per
 * model path. Failed candidates are dropped: a path that errored has no
 * throughput to report and would otherwise sort as "0 fps, 0% detection",
 * which reads like a slow model rather than a broken one.
 */
export function buildDeviceReports(runs: BenchmarkRun[]): DeviceReport[] {
  const byClass = new Map<ReportDeviceClass, Map<string, ModelReportRow>>();

  const newestFirst = [...runs].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  for (const run of newestFirst) {
    const cls = deviceClassOfRun(run);
    let rows = byClass.get(cls);
    if (!rows) {
      rows = new Map();
      byClass.set(cls, rows);
    }
    for (const result of run.results ?? []) {
      if (!result.ok) continue;
      if (rows.has(result.id)) continue; // newest wins
      rows.set(result.id, toRow(result, run));
    }
  }

  const reports: DeviceReport[] = [];
  for (const [deviceClass, rowMap] of byClass) {
    const rows = [...rowMap.values()].sort((a, b) => b.fps - a.fps);
    if (!rows.length) continue;
    const best = rows.find((r) => r.detectionRate > 0) ?? rows[0] ?? null;
    const measuredAt = rows.reduce(
      (latest, r) => (Date.parse(r.measuredAt) > Date.parse(latest) ? r.measuredAt : latest),
      rows[0]!.measuredAt,
    );
    reports.push({ deviceClass, measuredAt, rows, best: best ?? null });
  }

  const order: ReportDeviceClass[] = ["mobile", "tablet", "desktop", "unknown"];
  return reports.sort(
    (a, b) => order.indexOf(a.deviceClass) - order.indexOf(b.deviceClass),
  );
}
