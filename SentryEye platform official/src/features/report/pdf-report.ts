// Professional A4 PDF generation for a completed driver session.
// Pure presentation: it consumes an already-loaded DriverReport plus the
// existing timeline events. It never runs inference and never mutates data.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { DriverReport } from "@/features/session/driver-report";
import {
  TIMELINE_TYPE_LABEL,
  formatTimelineClock,
  type TimelineEvent,
} from "@/features/session/session-timeline";
import { buildReportNarrative, formatDurationWords } from "./report-narrative";
import {
  describeEngineAttempt,
  readEngineAttempts,
  type EngineAttempt,
} from "@/features/inference/engine-attempts";

const BRAND = "SentryEye";
const TAGLINE = "AI Driver Drowsiness Monitoring";

const INK: [number, number, number] = [16, 24, 34];
const MUTED: [number, number, number] = [110, 122, 138];
const LINE: [number, number, number] = [222, 228, 236];
const ACCENT: [number, number, number] = [8, 145, 178];
const SAFE: [number, number, number] = [22, 143, 96];
const WARN: [number, number, number] = [193, 132, 12];
const DANGER: [number, number, number] = [198, 52, 52];

const MARGIN = 44;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

const ANALYSIS_LABEL: Record<string, string> = {
  webcam: "Live camera",
  "video-upload": "Video upload",
  "image-upload": "Image upload",
};

interface Cursor {
  y: number;
}

export interface PdfReportInput {
  report: DriverReport;
  events: TimelineEvent[];
}

export function buildDriverReportPdf({ report, events }: PdfReportInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const generatedAt = new Date();
  const cur: Cursor = { y: 0 };

  drawHeader(doc, report, generatedAt);
  cur.y = 148;

  cur.y = drawInfoGrid(doc, report, generatedAt, cur.y);
  cur.y = drawExecutiveSummary(doc, report, cur.y);
  cur.y = drawDetectionSummary(doc, report, cur.y);
  cur.y = drawAlertSummary(doc, report, cur.y);
  cur.y = drawNarrative(doc, report, cur.y);
  drawTimeline(doc, events, cur.y);
  drawEngineSelection(doc, readEngineAttempts(), finalY(doc) || cur.y + 40);

  paginate(doc, report, generatedAt);
  return doc;
}

export function driverReportFileName(report: DriverReport): string {
  const date = new Date(report.startedAt).toISOString().slice(0, 10);
  const driver = report.driverLabel.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return `sentryeye-report_${driver || "driver"}_${date}_${report.sessionId.slice(0, 8)}.pdf`;
}

/* ------------------------------------------------------------------ header */

function drawHeader(doc: jsPDF, report: DriverReport, generatedAt: Date) {
  doc.setFillColor(...INK);
  doc.rect(0, 0, PAGE_W, 112, "F");
  doc.setFillColor(...ACCENT);
  doc.rect(0, 112, PAGE_W, 4, "F");

  // Logo mark: rounded square with a stylised eye.
  doc.setFillColor(...ACCENT);
  doc.roundedRect(MARGIN, 32, 34, 34, 8, 8, "F");
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(1.6);
  doc.circle(MARGIN + 17, 49, 9, "S");
  doc.setFillColor(255, 255, 255);
  doc.circle(MARGIN + 17, 49, 3.6, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(BRAND, MARGIN + 48, 46);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(168, 182, 196);
  doc.text(TAGLINE, MARGIN + 48, 60);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("Driver Session Report", MARGIN, 94);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(168, 182, 196);
  const right = PAGE_W - MARGIN;
  doc.text(`Generated ${formatDateTime(generatedAt)}`, right, 88, { align: "right" });
  doc.text(`Session ${report.sessionId}`, right, 100, { align: "right" });
}

/* ------------------------------------------------------------ info section */

function drawInfoGrid(doc: jsPDF, report: DriverReport, generatedAt: Date, y: number): number {
  const driverRows: [string, string][] = [
    ["Driver", report.driverLabel],
    ["Driver ID", report.driverId || "—"],
    ["Session ID", report.sessionId],
    ["Status", capitalise(report.status)],
  ];
  const sessionRows: [string, string][] = [
    ["Analysis type", ANALYSIS_LABEL[report.analysisType] ?? report.analysisType],
    ["Started", formatDateTime(new Date(report.startedAt))],
    ["Ended", report.endedAt ? formatDateTime(new Date(report.endedAt)) : "—"],
    ["Report date", formatDateTime(generatedAt)],
  ];
  const modelRows: [string, string][] = [
    ["Model", `${report.model.name} ${report.model.version}`.trim()],
    ["Framework", report.model.framework],
    ["Head format", report.model.headFormat],
    ["Input size", report.model.imgsz ? `${report.model.imgsz} px` : "—"],
    ["Provider", `${report.provider} / ${report.engineKind}`],
  ];

  const colW = (CONTENT_W - 16) / 2;
  const topA = sectionTitle(doc, "Driver information", y);
  const endA = keyValueTable(doc, driverRows, MARGIN, topA, colW);
  const topB = sectionTitle(doc, "Session information", y, MARGIN + colW + 16);
  const endB = keyValueTable(doc, sessionRows, MARGIN + colW + 16, topB, colW);

  let next = Math.max(endA, endB) + 18;
  next = sectionTitle(doc, "Model & analysis", next);
  next = keyValueTable(doc, modelRows, MARGIN, next, CONTENT_W, true);
  return next + 20;
}

/* ------------------------------------------------------- executive summary */

function drawExecutiveSummary(doc: jsPDF, report: DriverReport, y: number): number {
  let top = sectionTitle(doc, "Executive summary", y);
  const cards: KpiCard[] = [
    {
      label: "Safety score",
      value: `${report.safetyScore.toFixed(0)}`,
      sub: "/ 100",
      color: scoreColor(report.safetyScore),
    },
    {
      label: "Fatigue level",
      value: capitalise(report.fatigueLevel),
      sub: "derived",
      color: fatigueColor(report.fatigueLevel),
    },
    { label: "Duration", value: formatDurationWords(report.durationSec), sub: "session", color: INK },
    {
      label: "Processing",
      value: `${(report.processingTimeMs / 1000).toFixed(1)} s`,
      sub: `${report.frames.avgFps.toFixed(1)} fps avg`,
      color: INK,
    },
    {
      label: "Total alerts",
      value: String(report.totalAlerts),
      sub: report.maxRiskLevel ? `peak ${report.maxRiskLevel}` : "no peak",
      color: report.totalAlerts > 0 ? DANGER : SAFE,
    },
  ];
  top = kpiRow(doc, cards, top);
  return top + 20;
}

/* -------------------------------------------------------- detection tables */

function drawDetectionSummary(doc: jsPDF, report: DriverReport, y: number): number {
  const top = sectionTitle(doc, "Detection summary", y, MARGIN, 95);
  const rows: string[][] = [
    ["Total frames", report.frames.total.toLocaleString()],
    ["Analysed frames", report.frames.analysed.toLocaleString()],
    ["Open eye frames", report.frames.openEye.toLocaleString()],
    ["Closed eye frames", report.frames.closedEye.toLocaleString()],
    ["Yawning frames", report.frames.yawning.toLocaleString()],
    ["Eye closure ratio", `${(report.eyeClosureRatio * 100).toFixed(1)} %`],
    ["Yawning frequency", `${report.yawnPerMin.toFixed(2)} / min`],
    ["Longest eye closure", `${(report.longestEyeClosureMs / 1000).toFixed(2)} s`],
    ["Average eye closure", `${(report.avgEyeClosureMs / 1000).toFixed(2)} s`],
  ];
  return dataTable(doc, ["Metric", "Value"], rows, top) + 20;
}

function drawAlertSummary(doc: jsPDF, report: DriverReport, y: number): number {
  const top = sectionTitle(doc, "Alert summary", y, MARGIN, 95);
  const total = Math.max(1, report.totalAlerts);
  const rows: string[][] = [
    ["Low", String(report.alerts.low), pct(report.alerts.low, total)],
    ["Medium", String(report.alerts.medium), pct(report.alerts.medium, total)],
    ["High", String(report.alerts.high), pct(report.alerts.high, total)],
    ["Critical", String(report.alerts.critical), pct(report.alerts.critical, total)],
    ["Total", String(report.totalAlerts), "100.0 %"],
  ];
  return dataTable(doc, ["Severity", "Count", "Share"], rows, top, [0.5, 0.25, 0.25]) + 20;
}

function pct(n: number, total: number): string {
  return `${((n / total) * 100).toFixed(1)} %`;
}

/* -------------------------------------------------------------- narrative */

function drawNarrative(doc: jsPDF, report: DriverReport, y: number): number {
  const text = buildReportNarrative(report);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const lines = doc.splitTextToSize(text, CONTENT_W - 28) as string[];
  const boxH = lines.length * 13 + 24;

  let top = sectionTitle(doc, "Automated summary", y, MARGIN, boxH + 20);
  doc.setFillColor(244, 248, 251);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.6);
  doc.roundedRect(MARGIN, top, CONTENT_W, boxH, 5, 5, "FD");
  doc.setFillColor(...ACCENT);
  doc.rect(MARGIN, top, 3, boxH, "F");

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(lines, MARGIN + 14, top + 18);
  top += boxH + 20;
  return top;
}

/* --------------------------------------------------------------- timeline */

function drawTimeline(doc: jsPDF, events: TimelineEvent[], y: number) {
  const top = sectionTitle(doc, "Event timeline", y, MARGIN, 70);
  if (events.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    doc.text("No detection events were recorded for this session.", MARGIN, top + 12);
    return;
  }
  const rows = events.map((e) => [
    formatTimelineClock(e.tMs),
    TIMELINE_TYPE_LABEL[e.type],
    capitalise(e.severity),
    e.durationMs != null ? `${(e.durationMs / 1000).toFixed(2)} s` : "—",
    `${(e.confidence * 100).toFixed(0)} %`,
  ]);
  dataTable(doc, ["Time", "Event", "Severity", "Duration", "Confidence"], rows, top, [
    0.16, 0.3, 0.18, 0.18, 0.18,
  ]);
}

/* -------------------------------------------------------- engine selection */

function drawEngineSelection(doc: jsPDF, attempts: EngineAttempt[], y: number) {
  if (!attempts.length) return;
  const top = sectionTitle(doc, "Engine selection", y + 24, MARGIN, 80);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(
    "Execution providers attempted on this device, in order, and why each was rejected.",
    MARGIN,
    top + 10,
  );
  dataTable(
    doc,
    ["Provider", "Stage reached", "Cause", "Error"],
    attempts.map((a) => [
      a.engine,
      a.stage === "ready" ? "selected" : a.stage,
      a.cause ?? "—",
      a.error ?? describeEngineAttempt(a),
    ]),
    top + 22,
    [0.16, 0.18, 0.2, 0.46],
  );
}

/* --------------------------------------------------------------- helpers */

interface KpiCard {
  label: string;
  value: string;
  sub: string;
  color: [number, number, number];
}

function kpiRow(doc: jsPDF, cards: KpiCard[], y: number): number {
  const gap = 10;
  const w = (CONTENT_W - gap * (cards.length - 1)) / cards.length;
  const h = 62;
  cards.forEach((card, i) => {
    const x = MARGIN + i * (w + gap);
    doc.setFillColor(250, 251, 253);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    doc.roundedRect(x, y, w, h, 5, 5, "FD");
    doc.setFillColor(...card.color);
    doc.roundedRect(x, y, w, 3, 1.5, 1.5, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.6);
    doc.setTextColor(...MUTED);
    doc.text(card.label.toUpperCase(), x + 9, y + 19);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(fitFontSize(doc, card.value, w - 18, 15));
    doc.setTextColor(...card.color);
    doc.text(card.value, x + 9, y + 41);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(truncate(doc, card.sub, w - 18, 7), x + 9, y + 53);
  });
  return y + h;
}

function fitFontSize(doc: jsPDF, text: string, maxW: number, start: number): number {
  let size = start;
  doc.setFontSize(size);
  while (size > 8 && doc.getTextWidth(text) > maxW) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  return size;
}

function truncate(doc: jsPDF, text: string, maxW: number, size: number): string {
  doc.setFontSize(size);
  if (doc.getTextWidth(text) <= maxW) return text;
  let out = text;
  while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxW) out = out.slice(0, -1);
  return `${out}…`;
}

/** Draws a section heading, breaking to a new page when the block won't fit. */
function sectionTitle(doc: jsPDF, title: string, y: number, x = MARGIN, needed = 120): number {
  let top = y;
  if (top + needed > PAGE_H - 60) {
    doc.addPage();
    top = 72;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(title, x, top);
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(1.2);
  doc.line(x, top + 5, x + 26, top + 5);
  return top + 16;
}

function keyValueTable(
  doc: jsPDF,
  rows: [string, string][],
  x: number,
  y: number,
  width: number,
  twoCols = false,
): number {
  autoTable(doc, {
    startY: y,
    margin: { left: x, right: PAGE_W - x - width, top: 72, bottom: 56 },
    tableWidth: width,
    body: rows.map(([k, v]) => [k, v]),
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: { top: 4, bottom: 4, left: 6, right: 6 },
      textColor: INK,
      lineColor: LINE,
      lineWidth: { bottom: 0.5, top: 0, left: 0, right: 0 },
      overflow: "linebreak",
    },
    columnStyles: {
      0: { cellWidth: twoCols ? 130 : width * 0.42, textColor: MUTED },
      1: { fontStyle: "bold" },
    },
  });
  return finalY(doc);
}

function dataTable(
  doc: jsPDF,
  head: string[],
  rows: string[][],
  y: number,
  ratios?: number[],
): number {
  const columnStyles: Record<number, { cellWidth: number }> = {};
  if (ratios) ratios.forEach((r, i) => (columnStyles[i] = { cellWidth: CONTENT_W * r }));

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 72, bottom: 56 },
    tableWidth: CONTENT_W,
    head: [head],
    body: rows,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: { top: 5, bottom: 5, left: 7, right: 7 },
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0.5,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: INK,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: ratios ? columnStyles : { 0: { cellWidth: CONTENT_W * 0.55, textColor: MUTED }, 1: { fontStyle: "bold" } },
  });
  return finalY(doc);
}

function finalY(doc: jsPDF): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable;
  return last ? last.finalY : 0;
}

/** Footer with page numbers, added once every page exists. */
function paginate(doc: jsPDF, report: DriverReport, generatedAt: Date) {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, PAGE_H - 44, PAGE_W - MARGIN, PAGE_H - 44);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      `${BRAND} · ${report.driverLabel} · ${formatDateTime(generatedAt)}`,
      MARGIN,
      PAGE_H - 30,
    );
    doc.text(`Page ${p} of ${total}`, PAGE_W - MARGIN, PAGE_H - 30, { align: "right" });
  }
}

function scoreColor(score: number): [number, number, number] {
  if (score >= 80) return SAFE;
  if (score >= 60) return WARN;
  return DANGER;
}

function fatigueColor(level: string): [number, number, number] {
  if (level === "low") return SAFE;
  if (level === "medium") return WARN;
  return DANGER;
}

function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function formatDateTime(d: Date): string {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
