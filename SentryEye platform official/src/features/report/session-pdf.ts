// Session diagnostics PDF — the "what actually happened" sheet.
//
// The driver report answers "was this driver drowsy?". This one answers
// "can I trust the measurement?": the quality score and its weakest factor,
// the PERCLOS and eye-closure curves over the whole run, the events that
// fired, and the concrete fixes. That is what makes it useful for
// troubleshooting a bad mobile run or for a clinician sanity-checking a claim.
//
// Pure presentation: it consumes already-computed session artefacts.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { TimelineSample } from "@/features/session/session-csv";
import type { SemanticEvent } from "@/features/drowsiness/types";
import type { QualityAssessment } from "@/features/session/detection-quality";
import type { CalibrationProfile } from "@/features/session/calibration";
import {
  describeEngineAttempt,
  readEngineAttempts,
  type EngineAttempt,
} from "@/features/inference/engine-attempts";

const INK: [number, number, number] = [16, 24, 34];
const MUTED: [number, number, number] = [110, 122, 138];
const LINE: [number, number, number] = [222, 228, 236];
const ACCENT: [number, number, number] = [10, 150, 90];
const DANGER: [number, number, number] = [198, 52, 52];
const WARN: [number, number, number] = [193, 132, 12];

const MARGIN = 44;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

export interface SessionPdfMeta {
  sessionId?: string | null;
  driverLabel?: string | null;
  source: string;
  modelName: string;
  modelVersion: string;
  engine: string;
  preset: string;
  fileName?: string | null;
}

export interface SessionPdfInput {
  meta: SessionPdfMeta;
  startedAt: number;
  timeline: TimelineSample[];
  events: SemanticEvent[];
  quality: QualityAssessment | null;
  calibration: CalibrationProfile | null;
  autoCalibrated: boolean;
}

export function sessionPdfFileName(meta: SessionPdfMeta): string {
  const who = (meta.driverLabel ?? "session").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const day = new Date().toISOString().slice(0, 10);
  return `sentryeye-session-${who}-${day}.pdf`;
}

export function buildSessionDiagnosticPdf(input: SessionPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const generatedAt = new Date();

  drawHeader(doc, input, generatedAt);
  let y = 140;
  y = drawQuality(doc, input, y);
  y = drawMetrics(doc, input, y);
  y = drawChart(doc, input.timeline, y);
  y = drawCalibration(doc, input, y);
  y = drawEngineSelection(doc, readEngineAttempts(), y);
  drawEvents(doc, input, y);
  paginate(doc, generatedAt);
  return doc;
}

function drawHeader(doc: jsPDF, input: SessionPdfInput, at: Date) {
  doc.setFillColor(11, 18, 15);
  doc.rect(0, 0, PAGE_W, 110, "F");
  doc.setTextColor(0, 255, 102);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("SentryEye", MARGIN, 46);
  doc.setTextColor(235, 245, 238);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Session quality & diagnostics report", MARGIN, 66);
  doc.setFontSize(9);
  doc.setTextColor(170, 190, 178);
  const right = [
    `Generated ${at.toLocaleString()}`,
    input.meta.sessionId ? `Session ${input.meta.sessionId}` : "Unsaved session",
    `${input.meta.modelName} ${input.meta.modelVersion} · ${input.meta.engine}`,
  ];
  right.forEach((line, i) => doc.text(line, PAGE_W - MARGIN, 40 + i * 13, { align: "right" }));
  doc.setTextColor(...INK);
}

function sectionTitle(doc: jsPDF, title: string, y: number): number {
  const top = ensureSpace(doc, y, 90);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(title, MARGIN, top);
  doc.setDrawColor(...LINE);
  doc.line(MARGIN, top + 6, PAGE_W - MARGIN, top + 6);
  return top + 22;
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - 60) {
    doc.addPage();
    return 70;
  }
  return y;
}

function drawQuality(doc: jsPDF, input: SessionPdfInput, y0: number): number {
  let y = sectionTitle(doc, "Detection quality", y0);
  const q = input.quality;
  const score = q?.score ?? averageQuality(input.timeline);
  const color = score >= 65 ? ACCENT : score >= 45 ? WARN : DANGER;

  doc.setFillColor(...color);
  doc.roundedRect(MARGIN, y, 96, 56, 6, 6, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text(String(Math.round(score)), MARGIN + 48, y + 32, { align: "center" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("quality / 100", MARGIN + 48, y + 46, { align: "center" });

  doc.setTextColor(...INK);
  doc.setFontSize(10);
  const headline = q?.reason
    ? `Weakest factor: ${q.reason.label} (${q.reason.measured})`
    : score >= 65
      ? "No blocking quality issues were detected during this run."
      : "Quality varied during this run; see the per-factor breakdown below.";
  doc.text(doc.splitTextToSize(headline, CONTENT_W - 116), MARGIN + 112, y + 18);
  if (q?.reason) {
    doc.setTextColor(...MUTED);
    doc.setFontSize(9);
    doc.text(doc.splitTextToSize(`Fix: ${q.reason.fix}`, CONTENT_W - 116), MARGIN + 112, y + 40);
  }
  y += 74;

  if (q?.factors.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [["Factor", "Score", "Measured", "Recommended fix"]],
      body: q.factors.map((f) => [
        f.label,
        `${Math.round(f.score * 100)}`,
        f.measured,
        f.fix,
      ]),
      styles: { fontSize: 8, cellPadding: 4, textColor: INK },
      headStyles: { fillColor: [24, 34, 28], textColor: [235, 245, 238], fontSize: 8 },
      columnStyles: { 1: { halign: "right", cellWidth: 40 } },
      theme: "grid",
    });
    y = finalY(doc) + 18;
  }
  return y;
}

function drawMetrics(doc: jsPDF, input: SessionPdfInput, y0: number): number {
  const y = sectionTitle(doc, "Run summary", y0);
  const t = input.timeline;
  const durationMs = t.length ? t[t.length - 1].t : 0;
  const peakPerclos = t.reduce((m, s) => Math.max(m, s.perclos), 0);
  const longestClosure = t.reduce((m, s) => Math.max(m, s.closureMs), 0);
  const microsleeps = input.events.filter(
    (e) => e.kind === "microsleep" || e.kind === "critical_microsleep",
  ).length;
  const yawns = input.events.filter((e) => e.kind.includes("yawn")).length;

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    body: [
      ["Driver", input.meta.driverLabel ?? "—", "Source", input.meta.source],
      [
        "Analysed duration",
        formatClock(durationMs),
        "Analysed frames",
        String(t.length),
      ],
      ["Peak PERCLOS", `${Math.round(peakPerclos * 100)}%`, "Longest eye closure", `${Math.round(longestClosure)} ms`],
      ["Microsleep events", String(microsleeps), "Yawn events", String(yawns)],
      ["Preset", input.meta.preset, "File", input.meta.fileName ?? "—"],
    ],
    styles: { fontSize: 9, cellPadding: 5, textColor: INK },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 110 },
      2: { fontStyle: "bold", cellWidth: 110 },
    },
    theme: "plain",
  });
  return finalY(doc) + 18;
}

/** PERCLOS + eye-closure curve, drawn as plain vector lines (no chart lib). */
function drawChart(doc: jsPDF, timeline: TimelineSample[], y0: number): number {
  if (timeline.length < 2) return y0;
  let y = sectionTitle(doc, "PERCLOS and eye-closure timeline", y0);
  y = ensureSpace(doc, y, 190);
  const h = 130;
  const w = CONTENT_W;
  doc.setDrawColor(...LINE);
  doc.setFillColor(250, 251, 250);
  doc.rect(MARGIN, y, w, h, "FD");

  // Gridlines at 25 / 50 / 75 %.
  doc.setTextColor(...MUTED);
  doc.setFontSize(7);
  for (const frac of [0.25, 0.5, 0.75]) {
    const gy = y + h - h * frac;
    doc.setDrawColor(235, 238, 236);
    doc.line(MARGIN, gy, MARGIN + w, gy);
    doc.text(`${Math.round(frac * 100)}%`, MARGIN - 4, gy + 3, { align: "right" });
  }

  const step = Math.max(1, Math.floor(timeline.length / 600));
  const span = timeline[timeline.length - 1].t || 1;
  const maxClosure = Math.max(1000, ...timeline.map((s) => s.closureMs));
  const xOf = (t: number) => MARGIN + (t / span) * w;

  // Eye closure (scaled to its own max), then PERCLOS on top.
  doc.setDrawColor(...WARN);
  doc.setLineWidth(0.7);
  let prev: [number, number] | null = null;
  for (let i = 0; i < timeline.length; i += step) {
    const s = timeline[i];
    const p: [number, number] = [xOf(s.t), y + h - (s.closureMs / maxClosure) * h];
    if (prev) doc.line(prev[0], prev[1], p[0], p[1]);
    prev = p;
  }
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(1);
  prev = null;
  for (let i = 0; i < timeline.length; i += step) {
    const s = timeline[i];
    const p: [number, number] = [xOf(s.t), y + h - Math.min(1, s.perclos) * h];
    if (prev) doc.line(prev[0], prev[1], p[0], p[1]);
    prev = p;
  }

  // Microsleep bands.
  doc.setFillColor(...DANGER);
  for (let i = 0; i < timeline.length; i += step) {
    if (!timeline[i].microsleepActive) continue;
    doc.rect(xOf(timeline[i].t), y + h - 6, 2, 6, "F");
  }

  y += h + 14;
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `PERCLOS (green) · eye closure scaled to ${Math.round(maxClosure)} ms (amber) · microsleep marks (red) · 0 to ${formatClock(span)}`,
    MARGIN,
    y,
  );
  return y + 18;
}

function drawCalibration(doc: jsPDF, input: SessionPdfInput, y0: number): number {
  const c = input.calibration;
  if (!c) return y0;
  const y = sectionTitle(
    doc,
    input.autoCalibrated ? "Calibration (auto-derived from this run)" : "Calibration profile",
    y0,
  );
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    body: [
      ["Eye-closure threshold", `${c.eyeClosedMsThreshold} ms`, "Yawn confirm", `${c.yawnConfirmMs} ms`],
      ["Confidence floor", c.displayConfThreshold.toFixed(2), "Min face coverage", c.minFaceRatio.toFixed(3)],
      ["Baseline luma", c.baselineLuma.toFixed(3), "Base gain", `${c.baseGain}x`],
      ["Frames sampled", String(c.frames), "Complete", c.partial ? "Partial" : "Yes"],
    ],
    styles: { fontSize: 9, cellPadding: 5, textColor: INK },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 110 },
      2: { fontStyle: "bold", cellWidth: 110 },
    },
    theme: "plain",
  });
  return finalY(doc) + 18;
}

function drawEngineSelection(doc: jsPDF, attempts: EngineAttempt[], y0: number): number {
  if (!attempts.length) return y0;
  const y = sectionTitle(doc, "Engine selection", y0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(
    "Execution providers attempted on this device, in order, and why each was rejected.",
    MARGIN,
    y,
  );
  autoTable(doc, {
    startY: y + 10,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Provider", "Stage reached", "Cause", "Error"]],
    body: attempts.map((a) => [
      a.engine,
      a.stage === "ready" ? "selected" : a.stage,
      a.cause ?? "—",
      a.error ?? describeEngineAttempt(a),
    ]),
    styles: { fontSize: 7.5, cellPadding: 4, textColor: INK, overflow: "linebreak" },
    headStyles: { fillColor: [24, 34, 28], textColor: [235, 245, 238], fontSize: 8 },
    columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 80 }, 2: { cellWidth: 90 } },
    theme: "grid",
  });
  return finalY(doc) + 18;
}

function drawEvents(doc: jsPDF, input: SessionPdfInput, y0: number) {
  const y = sectionTitle(doc, "Event log", y0);
  if (!input.events.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text("No drowsiness events were recorded during this run.", MARGIN, y);
    return;
  }
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Time", "Event", "Risk", "Confidence"]],
    body: [...input.events]
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 120)
      .map((e) => [
        formatClock(Math.max(0, e.ts - input.startedAt)),
        e.kind.replace(/_/g, " "),
        e.riskLevel,
        e.confidence.toFixed(2),
      ]),
    styles: { fontSize: 8, cellPadding: 4, textColor: INK },
    headStyles: { fillColor: [24, 34, 28], textColor: [235, 245, 238], fontSize: 8 },
    theme: "grid",
  });
}

function paginate(doc: jsPDF, at: Date) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`SentryEye · generated ${at.toLocaleDateString()}`, MARGIN, PAGE_H - 28);
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 28, { align: "right" });
  }
}

function finalY(doc: jsPDF): number {
  const anyDoc = doc as unknown as { lastAutoTable?: { finalY: number } };
  return anyDoc.lastAutoTable?.finalY ?? 0;
}

function averageQuality(timeline: TimelineSample[]): number {
  if (!timeline.length) return 0;
  return timeline.reduce((a, s) => a + (s.qualityScore ?? 0), 0) / timeline.length;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
