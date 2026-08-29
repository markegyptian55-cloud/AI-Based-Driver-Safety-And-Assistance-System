// Real-time performance telemetry.
//
// The question this answers is "where is the delay?": is the camera starving
// the pipeline, is the model itself slow, or are frames piling up and being
// dropped? Live values come from session state; the p50/p95 distribution is
// polled from the capture profiler once a second so rendering stays cheap.

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Clock, Gauge, Layers } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LiveSessionState } from "@/features/session/use-live-session";
import type { CaptureProfileStats } from "@/features/session/capture-profiler";

export function TelemetryPanel({
  state,
  getProfile,
  className,
}: {
  state: LiveSessionState;
  getProfile: () => CaptureProfileStats;
  className?: string;
}) {
  const [profile, setProfile] = useState<CaptureProfileStats | null>(null);

  useEffect(() => {
    if (!state.running) return;
    setProfile(getProfile());
    const id = window.setInterval(() => setProfile(getProfile()), 1000);
    return () => window.clearInterval(id);
  }, [state.running, getProfile]);

  const fps = state.processedFps;
  const fpsTone = fps >= 10 ? "text-safe" : fps >= 5 ? "text-warn" : "text-destructive";
  const latencyTone =
    state.latencyMs <= 200
      ? "text-safe"
      : state.latencyMs <= 400
        ? "text-warn"
        : "text-destructive";
  const dropRate = profile?.dropRate ?? 0;

  return (
    <Card className={cn("space-y-4 border-border/60 bg-card/60 p-5", className)}>
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Performance telemetry
        </span>
        <Badge variant="outline" className="ml-auto font-mono text-[10px] uppercase">
          {state.engine || "—"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          icon={Gauge}
          label="Analysed FPS"
          value={fps.toFixed(1)}
          tone={fpsTone}
          sub={`camera ${state.cameraFps.toFixed(0)} fps`}
        />
        <Metric
          icon={Clock}
          label="End-to-end"
          value={`${state.latencyMs.toFixed(0)} ms`}
          tone={latencyTone}
          sub={
            profile
              ? `p50 ${profile.latency.p50.toFixed(0)} · p95 ${profile.latency.p95.toFixed(0)} ms`
              : "capture → overlay"
          }
        />
        <Metric
          icon={Layers}
          label="Inference"
          value={`${state.inferMs.toFixed(0)} ms`}
          sub={
            profile
              ? `p95 ${profile.inferMs.p95.toFixed(0)} ms`
              : `pre ${state.preprocessMs.toFixed(0)} · post ${state.postprocessMs.toFixed(0)} ms`
          }
        />
        <Metric
          icon={AlertTriangle}
          label="Dropped frames"
          value={String(state.droppedFrames)}
          tone={dropRate > 0.5 ? "text-destructive" : dropRate > 0.25 ? "text-warn" : undefined}
          sub={profile ? `${Math.round(dropRate * 100)}% of delivered` : "skipped while busy"}
        />
      </div>

      <div className="grid grid-cols-3 gap-3 border-t border-border/60 pt-3 font-mono text-[10px] uppercase text-muted-foreground">
        <Split label="Preprocess" value={state.preprocessMs} p95={profile?.preprocessMs.p95} />
        <Split label="Model" value={state.inferMs} p95={profile?.inferMs.p95} />
        <Split label="Postprocess" value={state.postprocessMs} p95={profile?.postprocessMs.p95} />
      </div>

      {profile && profile.worstGapMs > 1500 ? (
        <p className="text-xs text-muted-foreground">
          Longest stall this run: {(profile.worstGapMs / 1000).toFixed(1)} s. Sustained stalls
          usually mean the model is too heavy for this device — pick a smaller input resolution.
        </p>
      ) : null}
    </Card>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 font-mono text-[10px] uppercase text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("mt-1 truncate font-mono text-lg", tone)}>{value}</div>
      {sub ? (
        <div className="truncate font-mono text-[10px] text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

function Split({ label, value, p95 }: { label: string; value: number; p95?: number }) {
  return (
    <div className="min-w-0">
      <div className="truncate">{label}</div>
      <div className="mt-0.5 truncate text-foreground">
        {value.toFixed(0)} ms{p95 != null ? ` · p95 ${p95.toFixed(0)}` : ""}
      </div>
    </div>
  );
}
