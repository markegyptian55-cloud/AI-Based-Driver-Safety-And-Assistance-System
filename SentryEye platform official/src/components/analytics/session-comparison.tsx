import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { AnalyticsSession } from "@/features/analytics/analytics-data";
import { FATIGUE_TONE } from "./analytics-kpis";

function sessionLabel(s: AnalyticsSession) {
  return `${new Date(s.startedAt).toLocaleString()} · ${s.analysisType}`;
}

function Row({ label, a, b }: { label: string; a: React.ReactNode; b: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 items-center gap-2 border-t border-border/60 py-2 text-sm">
      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span>{a}</span>
      <span>{b}</span>
    </div>
  );
}

export function SessionComparison({ sessions }: { sessions: AnalyticsSession[] }) {
  // Newest first for the pickers.
  const ordered = [...sessions].reverse();
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);

  if (ordered.length < 2) {
    return (
      <Card className="border-dashed border-border/60 bg-card/40 p-6 text-center text-sm text-muted-foreground">
        Session comparison needs at least two completed sessions in the current filter.
      </Card>
    );
  }

  // Selections fall back to the two most recent sessions and self-heal when the
  // filtered set changes, so the comparison never renders empty.
  const left = ordered.find((s) => s.id === leftId) ?? ordered[0];
  const right = ordered.find((s) => s.id === rightId && s.id !== left.id) ?? ordered.find((s) => s.id !== left.id)!;

  return (
    <Card className="border-border/60 bg-card/60 p-4 sm:p-5">
      <h3 className="font-semibold">Session comparison</h3>
      <p className="text-xs text-muted-foreground">Two completed sessions, side by side</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Session A
          </Label>
          <Select value={left.id} onValueChange={setLeftId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ordered.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {sessionLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Session B
          </Label>
          <Select value={right.id} onValueChange={setRightId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ordered
                .filter((s) => s.id !== left.id)
                .map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {sessionLabel(s)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-5">
        <div className="grid grid-cols-3 gap-2 pb-2 text-xs font-semibold">
          <span />
          <span className="truncate">{left.driverLabel} · A</span>
          <span className="truncate">{right.driverLabel} · B</span>
        </div>
        <Row
          label="Safety score"
          a={left.safetyScore.toFixed(1)}
          b={right.safetyScore.toFixed(1)}
        />
        <Row
          label="Fatigue level"
          a={
            <Badge
              variant="outline"
              className={`font-mono text-[10px] uppercase ${FATIGUE_TONE[left.fatigueLevel]}`}
            >
              {left.fatigueLevel}
            </Badge>
          }
          b={
            <Badge
              variant="outline"
              className={`font-mono text-[10px] uppercase ${FATIGUE_TONE[right.fatigueLevel]}`}
            >
              {right.fatigueLevel}
            </Badge>
          }
        />
        <Row
          label="Eye closure ratio"
          a={`${(left.eyeClosureRatio * 100).toFixed(1)}%`}
          b={`${(right.eyeClosureRatio * 100).toFixed(1)}%`}
        />
        <Row
          label="Yawning frequency"
          a={`${left.yawnPerMin.toFixed(1)} /min`}
          b={`${right.yawnPerMin.toFixed(1)} /min`}
        />
        <Row
          label="Alerts"
          a={`${left.totalAlerts} (C${left.alerts.critical} / H${left.alerts.high})`}
          b={`${right.totalAlerts} (C${right.alerts.critical} / H${right.alerts.high})`}
        />
        <Row
          label="Processing time"
          a={`${(left.processingTimeMs / 1000).toFixed(1)}s`}
          b={`${(right.processingTimeMs / 1000).toFixed(1)}s`}
        />
      </div>
    </Card>
  );
}
