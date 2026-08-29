// What actually goes into the exported PDF/CSV.
//
// A run can hold thousands of timeline rows and hundreds of events, and the
// person exporting rarely wants all of it: sometimes it is "the two minutes
// where it went wrong", sometimes it is only the speed numbers for a model
// comparison. So the export is filtered here, in one place, and both writers
// consume the same filtered view.

import type { LastSessionRecord } from "@/features/session/last-session";
import { telemetryRows } from "./last-session-report";

export interface ExportOptions {
  /** Seconds from run start; null means "from the beginning". */
  fromSec: number | null;
  /** Seconds from run start; null means "to the end". */
  toSec: number | null;
  /** Telemetry metric labels to keep (as produced by telemetryRows). */
  metrics: string[];
  includeDetectionHistory: boolean;
  includeTimeline: boolean;
}

export function allMetricLabels(record: LastSessionRecord): string[] {
  return telemetryRows(record).map(([label]) => label);
}

export function defaultExportOptions(record: LastSessionRecord): ExportOptions {
  return {
    fromSec: null,
    toSec: null,
    metrics: allMetricLabels(record),
    includeDetectionHistory: true,
    includeTimeline: true,
  };
}

function inRange(tsMs: number, startedAt: number, opts: ExportOptions): boolean {
  const sec = (tsMs - startedAt) / 1000;
  if (opts.fromSec != null && sec < opts.fromSec) return false;
  if (opts.toSec != null && sec > opts.toSec) return false;
  return true;
}

/** Applies the options, returning a record the writers can use unchanged. */
export function applyExportOptions(
  record: LastSessionRecord,
  opts: ExportOptions,
): LastSessionRecord {
  const events = opts.includeDetectionHistory
    ? record.events.filter((e) => inRange(e.ts, record.startedAt, opts))
    : [];
  const timeline = opts.includeTimeline
    ? record.timeline.filter((s) => inRange(s.ts, record.startedAt, opts))
    : [];
  return { ...record, events, timeline };
}

export function selectedTelemetryRows(
  record: LastSessionRecord,
  opts: ExportOptions,
): [string, string][] {
  const keep = new Set(opts.metrics);
  return telemetryRows(record).filter(([label]) => keep.has(label));
}

export function describeRange(opts: ExportOptions, durationSec: number): string {
  const from = opts.fromSec ?? 0;
  const to = opts.toSec ?? durationSec;
  if (opts.fromSec == null && opts.toSec == null) return "Whole run";
  return `${from.toFixed(0)}s – ${to.toFixed(0)}s of the run`;
}
