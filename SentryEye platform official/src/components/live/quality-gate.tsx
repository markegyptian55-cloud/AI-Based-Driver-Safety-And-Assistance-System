// Detection quality gate.
//
// Two jobs: refuse to *start* an analysis the camera cannot support, and warn
// loudly (with the specific reason and fix) if quality collapses mid-run.
// A drowsiness score computed from an unusable feed is worse than none.

import { AlertTriangle, Gauge, ShieldCheck } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  QUALITY_BLOCK_SCORE,
  QUALITY_WARN_SCORE,
  type QualityAssessment,
} from "@/features/session/detection-quality";

export function QualityGate({
  assessment,
  blocked,
}: {
  assessment: QualityAssessment | null;
  /** True when analysis is currently suppressed because of quality. */
  blocked?: boolean;
}) {
  if (!assessment) return null;
  const { score, reason, factors } = assessment;
  const level = score >= QUALITY_WARN_SCORE ? "good" : score >= QUALITY_BLOCK_SCORE ? "warn" : "bad";

  return (
    <Card
      className={cn(
        "border-border/60 bg-card/60 p-4",
        level === "warn" && "border-warning/40 bg-warning/5",
        level === "bad" && "border-destructive/50 bg-destructive/10",
      )}
      role={level === "bad" ? "alert" : undefined}
    >
      <div className="flex items-center gap-2">
        {level === "good" ? (
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        ) : (
          <AlertTriangle
            className={cn("h-4 w-4", level === "bad" ? "text-destructive" : "text-warning")}
            aria-hidden="true"
          />
        )}
        <span className="text-sm font-semibold">Detection quality</span>
        <span className="ml-auto flex items-center gap-1 font-mono text-sm">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {score}
          <span className="text-muted-foreground">/100</span>
        </span>
      </div>

      <Progress value={score} className="mt-3 h-1.5" />

      {reason ? (
        <div className="mt-3 text-xs">
          <div className="font-medium text-foreground">
            {blocked ? "Low quality" : "Degraded"} — {reason.label.toLowerCase()} ({reason.measured})
          </div>
          <p className="mt-1 text-muted-foreground">
            {reason.fix} Detection keeps running.
          </p>
        </div>
      ) : (

        <p className="mt-3 text-xs text-muted-foreground">
          Frame quality is good enough to trust the drowsiness score.
        </p>
      )}

      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[10px]">
        {factors.map((f) => (
          <li key={f.id} className="flex items-baseline justify-between gap-2">
            <span className="truncate text-muted-foreground">{f.label}</span>
            <span
              className={cn(
                "shrink-0",
                f.score < 0.35 ? "text-destructive" : f.score < 0.6 ? "text-warning" : "text-foreground",
              )}
            >
              {Math.round(f.score * 100)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
