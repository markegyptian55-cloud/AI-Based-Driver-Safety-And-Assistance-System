import { cn } from "@/lib/utils";
import type { LiveSessionState } from "@/features/session/use-live-session";

type Tone = "good" | "warn" | "bad" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  good: "text-primary",
  warn: "text-amber-400",
  bad: "text-destructive",
  muted: "text-muted-foreground",
};

/**
 * Thresholds are the ones that matter perceptually for this pipeline, not
 * round numbers: under ~60 ms end-to-end the overlay tracks the face without a
 * visible lag, past ~120 ms boxes visibly trail the driver's head.
 */
function latencyTone(ms: number): Tone {
  if (ms <= 0) return "muted";
  if (ms <= 60) return "good";
  if (ms <= 120) return "warn";
  return "bad";
}

function fpsTone(fps: number): Tone {
  if (fps <= 0) return "muted";
  if (fps >= 40) return "good";
  if (fps >= 20) return "warn";
  return "bad";
}

function dropTone(rate: number): Tone {
  if (rate <= 0.35) return "good";
  if (rate <= 0.65) return "warn";
  return "bad";
}

function Metric({
  label,
  value,
  unit,
  tone = "muted",
  hint,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={hint}>
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={cn("font-mono text-sm tabular-nums leading-none", TONE_CLASS[tone])}>
        {value}
        {unit ? <span className="ml-0.5 text-[10px] text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}

/**
 * Live performance HUD for Live Detection and Video Upload runs.
 *
 * It reports the pipeline's own numbers — end-to-end latency percentiles,
 * inference FPS against the adaptive target, pipeline occupancy and the share
 * of source frames deliberately skipped — so a slow run can be attributed to
 * the model, the queue or the capture path without guesswork.
 */
export function PerfMetricsBar({
  state,
  className,
}: {
  state: LiveSessionState;
  className?: string;
}) {
  const {
    latencyP50Ms,
    latencyP95Ms,
    inferenceFps,
    targetInferenceFps,
    queuedFrames,
    inFlightFrames,
    pipelineDepth,
    dropRate,
    cameraFps,
    inferMs,
    captureHeight,
  } = state;

  const dropPct = Math.round(dropRate * 100);

  return (
    <section
      aria-label="Performance metrics"
      className={cn(
        "rounded-xl border border-border/60 bg-card/70 px-3 py-2 backdrop-blur-sm",
        className,
      )}
    >
      {/* Screen-reader summary: the grid below is dense numeric telemetry that
          would be tedious to traverse cell by cell. */}
      <p className="sr-only" aria-live="polite">
        {`Median latency ${Math.round(latencyP50Ms)} milliseconds, inference ${Math.round(
          inferenceFps,
        )} frames per second, ${dropPct} percent of source frames skipped.`}
      </p>
      <div
        aria-hidden="true"
        className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6"
      >
        <Metric
          label="Latency p50"
          value={Math.round(latencyP50Ms)}
          unit="ms"
          tone={latencyTone(latencyP50Ms)}
          hint="Median capture-to-result time over the last 5 seconds"
        />
        <Metric
          label="Latency p95"
          value={Math.round(latencyP95Ms)}
          unit="ms"
          tone={latencyTone(latencyP95Ms)}
          hint="Worst-case capture-to-result time over the last 5 seconds"
        />
        <Metric
          label="Infer FPS"
          value={Math.round(inferenceFps)}
          unit={targetInferenceFps ? `/ ${Math.round(targetInferenceFps)}` : undefined}
          tone={fpsTone(inferenceFps)}
          hint="Analysed frames per second against the adaptive target"
        />
        <Metric
          label="Preview"
          value={Math.round(cameraFps)}
          unit="fps"
          tone={fpsTone(cameraFps)}
          hint="Frames the camera or video is delivering per second"
        />
        <Metric
          label="Queue"
          value={`${queuedFrames}+${inFlightFrames}`}
          unit={`/${pipelineDepth}`}
          tone={inFlightFrames >= pipelineDepth && queuedFrames > 0 ? "warn" : "muted"}
          hint="Frames waiting plus frames in flight, against the pipeline depth"
        />
        <Metric
          label="Skipped"
          value={dropPct}
          unit="%"
          tone={dropTone(dropRate)}
          hint="Source frames not analysed — expected, the sampler runs below preview rate"
        />
      </div>
      <p aria-hidden="true" className="mt-1.5 text-[10px] text-muted-foreground">
        {inferMs ? `Model ${Math.round(inferMs)} ms` : "Model — ms"}
        {captureHeight ? ` · capture ${captureHeight}p` : ""}
      </p>
    </section>
  );
}
