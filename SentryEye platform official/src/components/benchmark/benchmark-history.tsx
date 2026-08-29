// Past benchmark sweeps, on this account.
//
// Shown next to the sweep itself so a new ranking can be read against the last
// one on the same hardware: if the fastest model dropped 30% overnight, that is
// a regression worth chasing, not a number to shrug at.

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  deleteBenchmarkRun,
  fpsDelta,
  listBenchmarkRuns,
  type BenchmarkRun,
} from "@/features/benchmark/benchmark-runs";
import { errorMessage } from "@/lib/format-error";

export const BENCHMARK_RUNS_KEY = ["benchmark_runs"] as const;

function deviceLine(run: BenchmarkRun): string {
  const d = run.device ?? {};
  return [
    d.frameSize ? `${d.frameSize} frames` : null,
    d.cores ? `${d.cores} cores` : null,
    d.memoryGb ? `${d.memoryGb} GB` : null,
    d.screen ? `${d.screen} @${(d.dpr ?? 1).toFixed(1)}x` : null,
    d.engine,
    d.constrained ? "mobile-class" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function BenchmarkHistory() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: BENCHMARK_RUNS_KEY, queryFn: () => listBenchmarkRuns(20) });
  const remove = useMutation({
    mutationFn: deleteBenchmarkRun,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: BENCHMARK_RUNS_KEY });
      toast.success("Benchmark run deleted");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const runs = useMemo(() => query.data ?? [], [query.data]);

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <History className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="font-mono text-sm font-semibold">Benchmark history</h2>
        <Badge variant="outline" className="font-mono text-[10px]">
          {runs.length} stored
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Every sweep is kept with the device stats that produced it, so you can compare rankings over
        time and spot when a model got slower.
      </p>

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : query.error ? (
        <p className="text-xs text-destructive">{errorMessage(query.error)}</p>
      ) : runs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No sweeps stored yet. Run one above and it will be saved to your account.
        </p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run, i) => {
            const prev = runs[i + 1];
            const delta = fpsDelta(run.bestFps, prev?.bestFps ?? null);
            const worse = delta != null && delta < -5;
            return (
              <li key={run.id} className="rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="font-mono text-[10px] uppercase">
                    {run.frameSource}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {run.bestModelLabel ?? "no model completed"}
                  </span>
                  {run.bestFps != null && (
                    <span className="font-mono text-xs">
                      {run.bestFps.toFixed(1)} FPS · p95 {(run.bestLatencyP95Ms ?? 0).toFixed(0)} ms
                    </span>
                  )}
                  {delta != null && (
                    <span
                      className={cn(
                        "flex items-center gap-1 font-mono text-xs",
                        worse ? "text-destructive" : "text-primary",
                      )}
                    >
                      {worse ? (
                        <TrendingDown className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <TrendingUp className="h-3 w-3" aria-hidden="true" />
                      )}
                      {delta > 0 ? "+" : ""}
                      {delta.toFixed(0)}%
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(run.id)}
                    aria-label="Delete this benchmark run"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {deviceLine(run)}
                </p>
                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                  {run.results
                    .filter((r) => r.ok)
                    .slice(0, 4)
                    .map((r) => `${r.label} ${r.fps.toFixed(1)}fps`)
                    .join(" · ")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
