// Export of the last completed run: one CSV and one PDF, both containing the
// same three things — what the model was, how fast it ran, and what it saw.
//
// The distinction from the driver report is deliberate: that one is about the
// driver, this one is about the *measurement*, which is what you need when
// comparing models or explaining a laggy run.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

import {
  buildSessionCsv,
  csvFilename,
  type CsvExportMeta,
} from "@/features/session/session-csv";
import type { LastSessionRecord } from "@/features/session/last-session";

const ACCENT: [number, number, number] = [0, 170, 90];
const INK: [number, number, number] = [16, 24, 34];
const MUTED: [number, number, number] = [110, 122, 138];
const MARGIN = 44;
const PAGE_W = 595.28;

function metaFor(record: LastSessionRecord): CsvExportMeta {
  return {
    sessionId: record.meta.sessionId,
    driverLabel: record.meta.driverLabel,
    source: record.meta.source,
    modelName: record.meta.modelName,
    modelVersion: record.meta.modelVersion,
    engine: record.meta.engine,
    preset: record.meta.preset,
  };
}

/** Telemetry rows shown identically in both exports. */
export function telemetryRows(record: LastSessionRecord): [string, string][] {
  const t = record.telemetry;
  return [
    ["Analysed frames", String(record.counts.frames)],
    ["Duration", `${record.durationSec} s`],
    ["FPS (median / best)", `${t.fps_p50.toFixed(1)} / ${t.fps_p95.toFixed(1)}`],
    ["Latency p50 / p95", `${t.latency_p50_ms.toFixed(0)} / ${t.latency_p95_ms.toFixed(0)} ms`],
    ["Model time p50 / p95", `${t.infer_p50_ms.toFixed(0)} / ${t.infer_p95_ms.toFixed(0)} ms`],
    [
      "Dropped frames",
      `${t.dropped_frames} (${Math.round((t.drop_rate ?? 0) * 100)}% of delivered)`,
    ],
    ["Longest stall", `${(t.worst_stall_ms / 1000).toFixed(2)} s`],
    ["Microsleeps", String(record.counts.microsleeps)],
    ["Alerts", String(record.counts.alerts)],
  ];
}

export function buildLastSessionCsv(
  record: LastSessionRecord,
  rows: [string, string][] = telemetryRows(record),
): string {
  const telemetry = [
    "# telemetry",
    "metric,value",
    ...rows.map(([k, v]) => `${k},"${v}"`),
    "",
  ].join("\r\n");
  const body = buildSessionCsv({
    meta: metaFor(record),
    startedAt: record.startedAt,
    events: record.events,
    timeline: record.timeline,
  });
  return [body, telemetry].join("\r\n");
}

export function lastSessionCsvName(record: LastSessionRecord): string {
  return csvFilename(metaFor(record));
}

export function lastSessionPdfName(record: LastSessionRecord): string {
  const who = record.meta.driverLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "session";
  return `sentryeye-last-session-${who}-${new Date(record.endedAt)
    .toISOString()
    .slice(0, 10)}.pdf`;
}

export function buildLastSessionPdf(
  record: LastSessionRecord,
  rows: [string, string][] = telemetryRows(record),
  subtitle?: string,
): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });

  doc.setFillColor(11, 18, 15);
  doc.rect(0, 0, PAGE_W, 96, "F");
  doc.setTextColor(0, 255, 102);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.text("SentryEye", MARGIN, 42);
  doc.setTextColor(235, 245, 238);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Last session — telemetry & detection history", MARGIN, 62);
  doc.setFontSize(9);
  doc.setTextColor(170, 190, 178);
  [
    `Generated ${new Date().toLocaleString()}`,
    record.meta.sessionId ? `Session ${record.meta.sessionId}` : "Unsaved session",
    `${record.meta.modelName} ${record.meta.modelVersion} · ${record.meta.engine}`,
  ].forEach((line, i) => doc.text(line, PAGE_W - MARGIN, 36 + i * 13, { align: "right" }));

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Run", MARGIN, 128);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(
    `${record.meta.driverLabel} · ${record.meta.source} · started ${new Date(
      record.startedAt,
    ).toLocaleString()}${subtitle ? ` · ${subtitle}` : ""}`,
    MARGIN,
    143,
  );

  autoTable(doc, {
    startY: 158,
    head: [["Metric", "Value"]],
    body: rows.length ? rows : [["—", "No telemetry columns selected"]],
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: ACCENT, textColor: 255 },
  });

  const afterTelemetry =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 300;

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Detection history", MARGIN, afterTelemetry + 28);

  const events = record.events.slice(0, 500);
  autoTable(doc, {
    startY: afterTelemetry + 40,
    head: [["Time", "Elapsed", "Event", "Risk", "Confidence"]],
    body: events.length
      ? events.map((e) => [
          new Date(e.ts).toLocaleTimeString(),
          `${Math.max(0, Math.round((e.ts - record.startedAt) / 100) / 10).toFixed(1)} s`,
          e.kind,
          e.riskLevel,
          e.confidence.toFixed(2),
        ])
      : [["—", "—", "No events were recorded in this run.", "—", "—"]],
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: ACCENT, textColor: 255 },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, 820, { align: "right" });
    doc.text("SentryEye — generated on device", MARGIN, 820);
  }
  return doc;
}
