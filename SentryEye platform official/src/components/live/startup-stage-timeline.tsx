// Real-time stage timeline for model start-up.
//
// Four named checkpoints with wall-clock timestamps, so a user whose phone is
// stuck can see instantly which one never finished instead of staring at a
// generic "preparing model" spinner.

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, CircleDashed, Loader2, MinusCircle, XCircle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  namedStages,
  startupLogSnapshot,
  subscribeStartupLog,
  type NamedStage,
} from "@/features/inference/startup-log";

const EMPTY = { startedAt: null, label: null, entries: [] as never[] };

export function useStartupSnapshot() {
  return useSyncExternalStore(subscribeStartupLog, startupLogSnapshot, () => EMPTY);
}

function StageIcon({ status }: { status: NamedStage["status"] }) {
  if (status === "active")
    return <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />;
  if (status === "done") return <Check className="h-4 w-4 text-primary" aria-hidden="true" />;
  if (status === "skipped")
    return <MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false });
}

export function StartupStageTimeline({ className }: { className?: string }) {
  const snap = useStartupSnapshot();
  const [now, setNow] = useState(() => Date.now());
  const stages = namedStages(snap);
  const anyActive = stages.some((s) => s.status === "active");

  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [anyActive]);

  if (!snap.startedAt) return null;

  return (
    <Card className={cn("border-border/60 bg-card/60 p-4", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Start-up timeline
        </span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/80">
          {clockOf(snap.startedAt)}
        </span>
      </div>
      <ol className="space-y-2" aria-label="Model start-up stages">
        {stages.map((stage) => {
          const elapsed =
            stage.durationMs ??
            (stage.status === "active" && stage.startedAt != null
              ? Math.max(0, now - stage.startedAt)
              : null);
          return (
            <li key={stage.id} className="flex items-baseline gap-3">
              <span className="translate-y-0.5">
                <StageIcon status={stage.status} />
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  stage.status === "pending" && "text-muted-foreground",
                  stage.status === "active" && "font-medium text-foreground",
                  stage.status === "error" && "text-destructive",
                )}
              >
                {stage.label}
                {stage.detail ? (
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    {stage.detail}
                  </span>
                ) : null}
              </span>
              {stage.startedAt != null ? (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/80">
                  {clockOf(stage.startedAt)}
                </span>
              ) : null}
              {elapsed != null ? (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {fmtDuration(elapsed)}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
