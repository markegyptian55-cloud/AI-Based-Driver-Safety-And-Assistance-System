// Expandable performance breakdown for one history row.
//
// Answers, at a glance: where did the time go before detection started, which
// route did the video take, and did the model come from the local store or the
// network. Pure presentation — all numbers arrive already measured.

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CONVERSION_PATH_LABEL,
  CONVERSION_PATH_NOTE,
  totalStageMs,
  type SessionPipelineTrace,
} from "@/features/session/pipeline-trace";

function ms(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(2)} s`;
}

function mb(bytes: number | null): string {
  if (!bytes) return "—";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PerformanceTimeline({ trace }: { trace: SessionPipelineTrace | null }) {
  if (!trace) {
    return (
      <p className="text-sm text-muted-foreground">
        No performance trace was recorded for this session.
      </p>
    );
  }

  const total = totalStageMs(trace);
  const model = trace.model;
  const cacheHit = model?.cache === "hit";

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-3">
        <header className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">Stage timings</h4>
          <span className="font-mono text-xs text-muted-foreground">{ms(total)} total</span>
        </header>
        {trace.stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Live capture — no preparation stages to report.
          </p>
        ) : (
          <ul className="space-y-2">
            {trace.stages.map((s) => (
              <li key={s.id} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate">{s.label}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {s.status === "skipped" ? "skipped" : ms(s.durationMs)}
                  </span>
                </div>
                <Progress
                  value={total > 0 ? ((s.durationMs ?? 0) / total) * 100 : 0}
                  className="h-1"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Conversion path</h4>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={trace.conversionPath === "ffmpeg" ? "destructive" : "secondary"}>
              {CONVERSION_PATH_LABEL[trace.conversionPath]}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {ms(trace.conversionMs)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {CONVERSION_PATH_NOTE[trace.conversionPath]}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold">Model load</h4>
            <Badge variant={cacheHit ? "default" : "outline"}>
              {model?.cache === "hit"
                ? "Cache hit"
                : model?.cache === "miss"
                  ? "Cold fetch"
                  : "Unknown"}
            </Badge>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Model</dt>
            <dd className="truncate">{model?.modelName ?? model?.modelId ?? "—"}</dd>
            <dt className="text-muted-foreground">Engine</dt>
            <dd>{model?.engine ?? "—"}</dd>
            <dt className="text-muted-foreground">Weights</dt>
            <dd>{mb(model?.bytes ?? null)}</dd>
            <dt className="text-muted-foreground">
              {cacheHit ? "Cache read" : "Download"}
            </dt>
            <dd className="font-mono">{ms(model?.fetchMs)}</dd>
            <dt className="text-muted-foreground">Session build</dt>
            <dd className="font-mono">{ms(model?.sessionMs)}</dd>
            <dt className="text-muted-foreground">Warm-up</dt>
            <dd className="font-mono">{ms(model?.warmupMs)}</dd>
            <dt className="text-muted-foreground">Ready after</dt>
            <dd className="font-mono">{ms(model?.totalMs)}</dd>
          </dl>
        </div>
      </section>
    </div>
  );
}
