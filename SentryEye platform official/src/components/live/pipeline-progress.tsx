// Professional multi-stage processing pipeline display.
// Pure presentation: every value comes from the analysis session context.

import { useEffect, useState } from "react";
import { Check, CircleDashed, Loader2, MinusCircle, XCircle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PipelineStage, PipelineStatus } from "@/features/session/analysis-session-context";

const STATUS_TEXT: Record<PipelineStatus, string> = {
  pending: "Pending",
  active: "In progress",
  done: "Completed",
  skipped: "Skipped",
  error: "Failed",
};

function StatusIcon({ status }: { status: PipelineStatus }) {
  if (status === "active")
    return <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />;
  if (status === "done") return <Check className="h-4 w-4 text-primary" aria-hidden="true" />;
  if (status === "skipped")
    return <MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />;
}

/** Measured wall time, in the unit a human reads without converting. */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function StageTiming({ stage }: { stage: PipelineStage }) {
  const [now, setNow] = useState(() => Date.now());
  const live = stage.status === "active" && stage.startedAt != null;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [live]);

  const ms =
    stage.durationMs ??
    (live && stage.startedAt != null ? Math.max(0, now - stage.startedAt) : null);
  if (ms == null) return null;
  return (
    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/80">
      {fmtDuration(ms)}
    </span>
  );
}

export function PipelineProgress({ stages }: { stages: PipelineStage[] }) {
  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Processing pipeline
      </div>
      <ol className="space-y-2" aria-label="Processing pipeline stages">
        {stages.map((stage, i) => (
          <li key={stage.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StatusIcon status={stage.status} />
              {i < stages.length - 1 ? (
                <span
                  className={cn(
                    "mt-1 w-px flex-1 bg-border/60",
                    stage.status === "done" && "bg-primary/40",
                  )}
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={cn(
                    "truncate text-sm",
                    stage.status === "pending" && "text-muted-foreground",
                    stage.status === "active" && "font-medium text-foreground",
                    stage.status === "done" && "text-foreground",
                    stage.status === "skipped" && "text-muted-foreground line-through",
                    stage.status === "error" && "text-destructive",
                  )}
                >
                  {i + 1}. {stage.label}
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <StageTiming stage={stage} />
                  <span
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-wider",
                      stage.status === "error" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {STATUS_TEXT[stage.status]}
                  </span>
                </span>
              </div>
              {stage.detail ? (
                <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {stage.detail}
                </div>
              ) : null}
              {stage.progress != null && stage.status === "active" ? (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/10">
                    <div
                      className="h-full bg-primary transition-[width] duration-200"
                      style={{ width: `${Math.round(stage.progress * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {Math.round(stage.progress * 100)}%
                  </span>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
