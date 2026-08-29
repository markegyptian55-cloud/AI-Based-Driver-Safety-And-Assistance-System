import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SessionTimeline } from "@/components/report/session-timeline";
import { EngineSelectionSection } from "@/components/report/engine-selection-section";
import type { DriverReport } from "@/features/session/driver-report";
import type { FatigueLevel } from "@/features/drowsiness/safety-score";

const ANALYSIS_LABEL: Record<string, string> = {
  webcam: "Live camera",
  "video-upload": "Video upload",
  "image-upload": "Image upload",
};

const FATIGUE_TONE: Record<FatigueLevel, string> = {
  low: "text-safe border-safe/40",
  medium: "text-warn border-warn/40",
  high: "text-danger border-danger/40",
  critical: "text-danger border-danger/60",
};

export function DriverReportView({ report }: { report: DriverReport }) {
  const scoreTone =
    report.safetyScore >= 80
      ? "text-safe"
      : report.safetyScore >= 60
        ? "text-warn"
        : "text-danger";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Driver information">
          <Row label="Driver" value={report.driverLabel} />
          <Row label="Driver ID" value={report.driverId || "—"} mono />
          <Row label="Session ID" value={report.sessionId} mono />
        </Section>

        <Section title="Session information">
          <Row label="Analysis type" value={ANALYSIS_LABEL[report.analysisType] ?? report.analysisType} />
          <Row label="Status" value={report.status} />
          <Row label="Start" value={formatTime(report.startedAt)} />
          <Row label="End" value={report.endedAt ? formatTime(report.endedAt) : "—"} />
          <Row label="Total duration" value={formatDuration(report.durationSec)} />
        </Section>

        <Section title="Model used">
          <Row label="Model" value={report.model.name} />
          <Row label="Version" value={report.model.version} mono />
          <Row label="Framework" value={report.model.framework} />
          <Row label="Head format" value={report.model.headFormat} mono />
          <Row label="Input size" value={report.model.imgsz ? `${report.model.imgsz}px` : "—"} />
        </Section>

        <Section title="Processing summary">
          <Row label="Provider" value={report.provider} mono />
          <Row label="Engine" value={report.engineKind} mono />
          <Row label="Processing time" value={`${(report.processingTimeMs / 1000).toFixed(1)} s`} />
          <Row label="Average FPS" value={report.frames.avgFps.toFixed(1)} />
          <Row label="Average latency" value={`${report.frames.avgLatencyMs.toFixed(1)} ms`} />
        </Section>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Metric label="Safety score" value={report.safetyScore.toFixed(1)} suffix="/ 100" tone={scoreTone} />
        <Card className={`border p-5 ${FATIGUE_TONE[report.fatigueLevel]}`}>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Fatigue level
          </div>
          <div className="mt-2 text-3xl font-bold capitalize">{report.fatigueLevel}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Derived from the safety score (≥80 low, ≥60 medium, ≥40 high, else critical).
          </p>
        </Card>
        <Metric
          label="Eye closure ratio"
          value={`${(report.eyeClosureRatio * 100).toFixed(1)}%`}
          suffix="of eye frames"
        />
        <Metric
          label="Yawning frequency"
          value={report.yawnPerMin.toFixed(2)}
          suffix="per minute"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Detection statistics">
          <Row label="Total frames" value={report.frames.total.toLocaleString()} />
          <Row label="Analysed frames" value={report.frames.analysed.toLocaleString()} />
          <Row label="Open eye frames" value={report.frames.openEye.toLocaleString()} />
          <Row label="Closed eye frames" value={report.frames.closedEye.toLocaleString()} />
          <Row label="Yawning frames" value={report.frames.yawning.toLocaleString()} />
          <Row label="Longest eye closure" value={`${(report.longestEyeClosureMs / 1000).toFixed(2)} s`} />
          <Row label="Average eye closure" value={`${(report.avgEyeClosureMs / 1000).toFixed(2)} s`} />
        </Section>

        <Section title="Alert summary">
          <Row label="Total alerts" value={String(report.totalAlerts)} />
          <div className="grid grid-cols-2 gap-3 pt-2">
            <AlertTile label="Low" value={report.alerts.low} tone="border-border/60 text-muted-foreground" />
            <AlertTile label="Medium" value={report.alerts.medium} tone="border-warn/40 text-warn" />
            <AlertTile label="High" value={report.alerts.high} tone="border-danger/40 text-danger" />
            <AlertTile label="Critical" value={report.alerts.critical} tone="border-danger/60 text-danger" />
          </div>
          {report.maxRiskLevel ? (
            <div className="pt-3">
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                peak risk: {report.maxRiskLevel}
              </Badge>
            </div>
          ) : null}
        </Section>
      </div>

      <EngineSelectionSection />

      <SessionTimeline
        sessionId={report.sessionId}
        modelLabel={`${report.model.name} ${report.model.version}`.trim()}
      />
    </div>

  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border/60 bg-card/60 p-5">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 truncate text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: string;
}) {
  return (
    <Card className="border-border/60 bg-card/60 p-5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-2 text-3xl font-bold ${tone ?? ""}`}>{value}</div>
      {suffix ? <div className="mt-1 text-xs text-muted-foreground">{suffix}</div> : null}
    </Card>
  );
}

function AlertTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-md border p-3 ${tone}`}>
      <div className="font-mono text-[10px] uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString();
}

function formatDuration(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
