// CSV export of a live run: the event log and the per-frame confidence
// timeline. This is what makes the system auditable — you can open it in a
// spreadsheet, mark which microsleeps were real, and count false positives
// and misses instead of arguing from memory.

import type { SemanticEvent } from "../drowsiness/types";

/** One sampled frame of the confidence timeline. */
export interface TimelineSample {
  /** Wall-clock ms. */
  ts: number;
  /** ms since the session started. */
  t: number;
  eyeOpenConf: number;
  eyeClosedConf: number;
  yawnConf: number;
  perclos: number;
  /** Continuous eye-closure duration at this frame (ms). */
  closureMs: number;
  microsleepActive: boolean;
  risk: string;
  luma: number;
  gain: number;
  qualityScore: number;
  latencyMs: number;
  tracks: number;
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}

const iso = (ts: number) => new Date(ts).toISOString();
const r3 = (v: number) => Number((v ?? 0).toFixed(3));

export function buildEventsCsv(events: SemanticEvent[], startedAt: number): string {
  const rows = [...events]
    .sort((a, b) => a.ts - b.ts)
    .map((e) => [
      iso(e.ts),
      Math.max(0, Math.round(e.ts - startedAt)),
      e.kind,
      e.riskLevel,
      r3(e.confidence),
      e.metadata ? JSON.stringify(e.metadata) : "",
    ]);
  return toCsv(
    ["timestamp_iso", "elapsed_ms", "event_kind", "risk_level", "confidence", "metadata_json"],
    rows,
  );
}

export function buildTimelineCsv(samples: TimelineSample[]): string {
  const rows = samples.map((s) => [
    iso(s.ts),
    s.t,
    r3(s.eyeOpenConf),
    r3(s.eyeClosedConf),
    r3(s.yawnConf),
    r3(s.perclos),
    Math.round(s.closureMs),
    s.microsleepActive ? 1 : 0,
    s.risk,
    r3(s.luma),
    r3(s.gain),
    Math.round(s.qualityScore),
    Math.round(s.latencyMs),
    s.tracks,
  ]);
  return toCsv(
    [
      "timestamp_iso",
      "elapsed_ms",
      "eye_open_conf",
      "eye_closed_conf",
      "yawn_conf",
      "perclos",
      "closure_ms",
      "microsleep_active",
      "risk",
      "luma",
      "gain",
      "quality_score",
      "latency_ms",
      "tracks",
    ],
    rows,
  );
}

export interface CsvExportMeta {
  sessionId?: string | null;
  driverLabel?: string;
  source?: string;
  modelName?: string;
  modelVersion?: string;
  engine?: string;
  preset?: string;
}

/**
 * Single-file export: a short metadata header, the event log, then the frame
 * timeline. Spreadsheets handle the blank-line-separated blocks fine and it
 * keeps the driver to one download instead of three.
 */
export function buildSessionCsv(args: {
  meta: CsvExportMeta;
  startedAt: number;
  events: SemanticEvent[];
  timeline: TimelineSample[];
}): string {
  const metaRows = Object.entries({
    exported_at: new Date().toISOString(),
    started_at: iso(args.startedAt),
    session_id: args.meta.sessionId ?? "(not persisted)",
    driver: args.meta.driverLabel ?? "",
    source: args.meta.source ?? "",
    model: `${args.meta.modelName ?? ""} ${args.meta.modelVersion ?? ""}`.trim(),
    engine: args.meta.engine ?? "",
    preset: args.meta.preset ?? "",
    event_count: args.events.length,
    timeline_samples: args.timeline.length,
  }).map(([k, v]) => [k, v]);

  return [
    "# SentryEye session export",
    toCsv(["field", "value"], metaRows),
    "",
    "# events",
    buildEventsCsv(args.events, args.startedAt),
    "",
    "# confidence timeline",
    buildTimelineCsv(args.timeline),
    "",
  ].join("\r\n");
}

export function csvFilename(meta: CsvExportMeta): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const id = meta.sessionId ? meta.sessionId.slice(0, 8) : "live";
  return `sentryeye-session-${id}-${stamp}.csv`;
}

/** Triggers a CSV download. Call from a user gesture. */
export function downloadCsv(content: string, filename: string): void {
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
