import { Link } from "@tanstack/react-router";
import { CloudOff, LogIn, Play, RefreshCw, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ShiftReportCard } from "@/components/fleet/shift-report-card";
import { useShift } from "@/features/fleet/shift-context";
import { useModelContext } from "@/features/inference/model-context";
import { errorMessage } from "@/lib/format-error";

function fmt(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Shift start/end controls, rendered inline on the detection pages so drivers
 * never have to leave Live detection to run a monitored shift.
 */
export function ShiftControlBar({ compact = false }: { compact?: boolean }) {
  const {
    identity,
    identityLoading,
    isManager,
    active,
    shift,
    starting,
    ending,
    error,
    monitoredSeconds,
    pendingCount,
    online,
    lastReport,
    startShift,
    endShift,
    retrySync,
  } = useShift();
  const { selected, providerId } = useModelContext();
  const [elapsed, setElapsed] = useState(0);
  // The driver ends a shift deliberately; auto-start must not immediately open
  // a new one on top of the report they just produced.
  const [endedHere, setEndedHere] = useState(false);

  const startInput = {
    modelId: selected?.id ?? null,
    modelName: selected?.modelName ?? null,
    modelVersion: selected?.version ?? null,
    modelImgsz: selected?.imgsz ?? null,
    executionProvider: providerId,
    precision: "fp32" as const,
  };

  // Drivers never press "Start shift": opening a detection page while signed in
  // opens the monitored shift automatically. An interrupted shift recovered
  // from IndexedDB is resumed instead of duplicated (guarded in startShift).
  useEffect(() => {
    if (identityLoading || !identity || isManager) return;
    if (active || starting || ending || endedHere) return;
    void startShift(startInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityLoading, identity, isManager, active, starting, ending, endedHere]);

  useEffect(() => {
    if (!active || !shift) return;
    const tick = () =>
      setElapsed(Math.max(0, (Date.now() - new Date(shift.startedAt).getTime()) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, shift]);

  if (identityLoading) return null;

  if (!identity) {
    return (
      <Card className="flex flex-col gap-2 border-primary/30 bg-primary/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="text-muted-foreground">
          Sign in to record this as a monitored shift and keep the safety report.
        </span>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to="/auth" search={{ mode: "signin" }}>
            <LogIn className="mr-2 h-4 w-4" aria-hidden="true" /> Sign in
          </Link>
        </Button>
      </Card>
    );
  }

  async function handleEnd() {
    setEndedHere(true);
    try {
      const report = await endShift();
      if (report) {
        toast.success(
          report.sync === "synced"
            ? "Shift finalized — sent to your manager's dashboard"
            : "Shift finalized — saved offline, will sync automatically",
        );
      }
    } catch (e) {
      setEndedHere(false);
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="space-y-3">
      <Card className="border-primary/30 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          {active ? (
            <>
              <Badge variant="outline" className="border-safe/40 text-safe">
                Shift active
              </Badge>
              <Metric label="Shift time" value={fmt(elapsed)} />
              <Metric label="Monitored" value={fmt(monitoredSeconds)} />
              <Metric label="Alerts" value={String(shift?.events.length ?? 0)} />
              {!online ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CloudOff className="h-3.5 w-3.5" aria-hidden="true" /> offline — saved locally
                </span>
              ) : null}
              <Button
                className="ml-auto"
                size={compact ? "sm" : "default"}
                variant="destructive"
                onClick={handleEnd}
                disabled={ending}
              >
                <Square className="mr-2 h-4 w-4" aria-hidden="true" />
                {ending ? "Finalizing…" : "End shift"}
              </Button>
            </>
          ) : (
            <>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {starting ? "Starting your shift…" : "Shift ended"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {starting
                    ? "Monitoring begins automatically."
                    : "Your report was sent to the fleet dashboard."}
                </p>
              </div>
              {starting ? null : (
                <Button
                  className="ml-auto"
                  size={compact ? "sm" : "lg"}
                  onClick={() => {
                    setEndedHere(false);
                    void startShift(startInput);
                  }}
                >
                  <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                  Start new shift
                </Button>
              )}
            </>
          )}
        </div>

        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

        {pendingCount > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {pendingCount} shift{pendingCount > 1 ? "s" : ""} waiting to upload.
            </span>
            <Button size="sm" variant="ghost" onClick={() => void retrySync()}>
              Sync now
            </Button>
          </div>
        ) : null}
      </Card>

      {!active && lastReport ? <ShiftReportCard report={lastReport} /> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}
