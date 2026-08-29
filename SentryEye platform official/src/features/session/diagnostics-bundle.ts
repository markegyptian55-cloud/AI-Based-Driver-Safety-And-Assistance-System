// One file to send when something looks wrong on a real phone.
//
// The v1 bundle carried the event log only. Deep troubleshooting needs the log
// *plus* the timing breakdown, per-frame quality, sensor state, model identity
// and (when it was run) the benchmark table — correlated, in one download.

import type { DiagnosticsBundle, DiagnosticsLog } from "./diagnostics-log";
import { redactDiagnostics, type RedactionReport } from "./diagnostics-redact";
import type { CaptureProfileStats, CaptureSample } from "./capture-profiler";
import type { BenchResult } from "@/features/inference/benchmark";

export interface FullDiagnosticsBundle {
  schema: "sentryeye.diagnostics.v2";
  generatedAt: string;
  app: {
    href: string;
    build: string;
  };
  model: {
    id?: string;
    name?: string;
    version?: string;
    imgsz?: number;
    headFormat?: string;
    labels?: Record<string, string>;
  };
  runtime: {
    provider?: string;
    engine?: string;
    route?: string;
    preset?: string;
    enginePreference?: string;
  };
  profile: CaptureProfileStats | null;
  /** Down-sampled per-frame timing/quality trace (bounded to keep files small). */
  frames: CaptureSample[];
  benchmark: BenchResult[] | null;
  log: DiagnosticsBundle;
}

export interface BuildBundleInput {
  log: DiagnosticsLog;
  profile?: CaptureProfileStats | null;
  frames?: CaptureSample[];
  benchmark?: BenchResult[] | null;
  model?: FullDiagnosticsBundle["model"];
  runtime?: FullDiagnosticsBundle["runtime"];
  /** Cap on frame samples written to the file. */
  maxFrames?: number;
}

export function buildFullBundle(input: BuildBundleInput): FullDiagnosticsBundle {
  const maxFrames = input.maxFrames ?? 1200;
  return {
    schema: "sentryeye.diagnostics.v2",
    generatedAt: new Date().toISOString(),
    app: {
      href: typeof location === "undefined" ? "" : location.origin,
      build: import.meta.env.MODE,
    },
    model: input.model ?? {},
    runtime: input.runtime ?? {},
    profile: input.profile ?? null,
    frames: downsample(input.frames ?? [], maxFrames),
    benchmark: input.benchmark ?? null,
    log: input.log.build(),
  };
}

/**
 * Keeps the shape of the trace while bounding the file: evenly spaced samples
 * beat the last N, which would hide the start of the session.
 */
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

/** Redacts the embedded log exactly as the share flow does before it leaves. */
export function redactFullBundle(bundle: FullDiagnosticsBundle): {
  bundle: FullDiagnosticsBundle;
  removed: string[];
} {
  const report: RedactionReport = redactDiagnostics(bundle.log);
  return {
    bundle: { ...bundle, log: report.bundle },
    removed: report.removed,
  };
}

export function downloadFullBundle(bundle: FullDiagnosticsBundle, filename?: string) {
  const name =
    filename ?? `sentryeye-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoke on the next tick: revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
