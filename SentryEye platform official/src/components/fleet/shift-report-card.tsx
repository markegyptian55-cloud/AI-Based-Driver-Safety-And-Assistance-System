import { CloudOff, RefreshCw, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiskBadge, RecommendationBadge } from "@/components/fleet/risk-badge";
import { RECOMMENDATION_BLURB } from "@/features/fleet/safety-score";
import { eventTypeLabel } from "@/features/fleet/event-mapping";
import type { ShiftReport } from "@/features/fleet/types";

function mins(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function ShiftReportCard({ report }: { report: ShiftReport }) {
  const breakdown: [string, number][] = [
    ["drowsiness", report.drowsinessEvents],
    ["microsleep", report.criticalEvents],
    ["eyes_closed", report.eyesClosedEvents],
    ["yawning", report.yawningEvents],
    ["phone_usage", report.phoneUsageEvents],
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          Shift report
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <RiskBadge level={report.riskLevel} />
          <RecommendationBadge value={report.recommendation} />
          {report.sync !== "synced" ? (
            <Badge variant="outline" className="gap-1 text-[11px] text-warn">
              {report.sync === "sync_error" ? (
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
              ) : (
                <CloudOff className="h-3 w-3" aria-hidden="true" />
              )}
              {report.sync === "sync_error" ? "Sync failed — will retry" : "Saved offline"}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Metric label="Safety score" value={report.safetyScore.toFixed(0)} />
          <Metric label="Monitored" value={mins(report.monitoredSeconds)} />
          <Metric label="Total events" value={String(report.totalEvents)} />
          <Metric label="Critical events" value={String(report.criticalEvents)} />
          <Metric label="Events / hour" value={report.eventRate.toFixed(2)} />
          <Metric label="Drowsiness / hour" value={report.drowsinessRate.toFixed(2)} />
          <Metric
            label="Avg confidence"
            value={`${Math.round(report.avgConfidence * 100)}%`}
          />
          <Metric label="Shift length" value={mins(report.durationSeconds)} />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Behaviour breakdown</h3>
          <div className="flex flex-wrap gap-2">
            {breakdown.map(([key, n]) => (
              <Badge key={key} variant="outline" className="font-mono text-[11px]">
                {eventTypeLabel(key)}: {n}
              </Badge>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium">Why this classification</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {report.factors.map((f) => (
              <li key={f.label} className="flex justify-between gap-4">
                <span>{f.label}</span>
                <span className="font-mono text-foreground">
                  {f.value}
                  {f.unit ?? ""}
                  {f.cap ? <span className="text-muted-foreground"> / {f.cap}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            {RECOMMENDATION_BLURB[report.recommendation]} Metrics are AI-derived estimates — review
            the underlying shift history before acting.
          </p>
        </div>

        <p className="font-mono text-[11px] text-muted-foreground">
          {report.modelName ?? "model n/a"} {report.modelVersion ?? ""} ·{" "}
          {report.executionProvider ?? "engine n/a"}
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}
