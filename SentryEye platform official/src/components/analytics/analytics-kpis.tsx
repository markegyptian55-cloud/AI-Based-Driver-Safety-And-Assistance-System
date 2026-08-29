import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  AlertTriangle,
  Clock,
  Cpu,
  Eye,
  Gauge,
  Timer,
  Wind,
} from "lucide-react";
import type { AnalyticsKpis } from "@/features/analytics/analytics-data";
import type { FatigueLevel } from "@/features/drowsiness/safety-score";

export const FATIGUE_TONE: Record<FatigueLevel, string> = {
  low: "text-safe border-safe/40",
  medium: "text-warn border-warn/40",
  high: "text-warn border-warn/40",
  critical: "text-danger border-danger/40",
};

function scoreTone(score: number) {
  if (score >= 80) return "text-safe";
  if (score >= 60) return "text-warn";
  return "text-danger";
}

function formatDuration(sec: number) {
  if (!sec) return "0s";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: string;
}) {
  return (
    <Card className="border-border/60 bg-card/60 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className={`mt-2 truncate text-xl font-semibold sm:text-2xl ${tone ?? ""}`}>
            {value}
          </div>
          {hint ? <div className="mt-1 truncate text-xs text-muted-foreground">{hint}</div> : null}
        </div>
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      </div>
    </Card>
  );
}

export function AnalyticsKpiGrid({ kpis }: { kpis: AnalyticsKpis }) {
  const avgHint = kpis.sessionCount > 1 ? `avg over ${kpis.sessionCount} sessions` : undefined;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Safety score"
        value={kpis.safetyScore.toFixed(1)}
        hint={avgHint}
        icon={Gauge}
        tone={scoreTone(kpis.safetyScore)}
      />
      <KpiCard
        label="Fatigue level"
        value={
          <Badge
            variant="outline"
            className={`font-mono text-[11px] uppercase ${FATIGUE_TONE[kpis.fatigueLevel]}`}
          >
            {kpis.fatigueLevel}
          </Badge>
        }
        hint={kpis.sessionCount > 1 ? "dominant level" : undefined}
        icon={Activity}
      />
      <KpiCard
        label="Total alerts"
        value={kpis.totalAlerts}
        hint={kpis.sessionCount > 1 ? "across filtered sessions" : undefined}
        icon={AlertTriangle}
      />
      <KpiCard
        label="Eye closure ratio"
        value={`${(kpis.eyeClosureRatio * 100).toFixed(1)}%`}
        hint={avgHint}
        icon={Eye}
      />
      <KpiCard
        label="Yawning frequency"
        value={`${kpis.yawnPerMin.toFixed(1)} /min`}
        hint={avgHint}
        icon={Wind}
      />
      <KpiCard
        label="Processing time"
        value={`${(kpis.processingTimeMs / 1000).toFixed(1)}s`}
        hint={avgHint}
        icon={Timer}
      />
      <KpiCard
        label="Session duration"
        value={formatDuration(kpis.durationSec)}
        hint={avgHint}
        icon={Clock}
      />
      <KpiCard label="Selected model" value={kpis.model} icon={Cpu} />
    </div>
  );
}

export { formatDuration };
