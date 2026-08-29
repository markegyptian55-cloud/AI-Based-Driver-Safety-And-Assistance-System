// Worker start-up debug panel.
//
// Every stage the inference worker reported, in order, with the millisecond it
// arrived — plus any runtime/import error. This is what turns "it just hangs on
// my Android" into an actionable report, and it can be copied in one tap.

import { useState } from "react";
import { Bug, Copy, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatStartupLog } from "@/features/inference/startup-log";
import { useStartupSnapshot } from "./startup-stage-timeline";

export function WorkerDebugPanel({
  className,
  onHardRetry,
  defaultOpen = false,
}: {
  className?: string;
  /** One-tap recovery: restarts the worker and clears the runtime cache. */
  onHardRetry?: () => void;
  defaultOpen?: boolean;
}) {
  const snap = useStartupSnapshot();
  const [open, setOpen] = useState(defaultOpen);
  const errors = snap.entries.filter((e) => e.level === "error");

  if (!snap.startedAt) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatStartupLog());
      toast.success("Start-up log copied");
    } catch {
      toast.error("Clipboard is blocked in this browser");
    }
  }

  return (
    <Card className={cn("border-border/60 bg-card/60 p-4", className)}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-center gap-2">
          <Bug className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Worker debug
          </span>
          <span
            className={cn(
              "font-mono text-[10px]",
              errors.length ? "text-destructive" : "text-muted-foreground/80",
            )}
          >
            {snap.entries.length} stages{errors.length ? ` · ${errors.length} error` : ""}
          </span>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-[11px]">
              {open ? "Hide" : "Show"}
            </Button>
          </CollapsibleTrigger>
        </div>

        {errors.length ? (
          <p className="mt-2 break-words font-mono text-[11px] text-destructive" role="alert">
            {String(errors[errors.length - 1]?.detail?.["message"] ?? "worker error")}
          </p>
        ) : null}

        <CollapsibleContent>
          <ol className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-md border border-border/60 bg-background/40 p-2">
            {snap.entries.map((e, i) => (
              <li
                key={`${e.stage}-${e.at}-${i}`}
                className={cn(
                  "flex gap-2 font-mono text-[11px]",
                  e.level === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                <span className="w-16 shrink-0 tabular-nums text-right">+{e.t} ms</span>
                <span className="min-w-0 flex-1 break-words">
                  {e.stage}
                  {e.detail ? (
                    <span className="text-muted-foreground/70"> {JSON.stringify(e.detail)}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Copy log
            </Button>
            {onHardRetry ? (
              <Button variant="outline" size="sm" onClick={onHardRetry}>
                <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Restart worker
              </Button>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
