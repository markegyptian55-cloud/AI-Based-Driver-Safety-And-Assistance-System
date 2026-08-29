import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LiveSessionState } from "@/features/session/use-live-session";
import { describeEngine } from "@/features/inference/engine-preference";

import { Cpu, Gauge } from "lucide-react";

export function ProviderStatus({ state }: { state: LiveSessionState }) {
  return (
    <Card className="border-border/60 bg-card/60 p-5">
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-primary" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Provider
        </span>
        <Badge variant="outline" className="ml-auto font-mono text-[10px] uppercase">
          {describeEngine(state.engine)}
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Row label="Model" value={`${state.modelName} v${state.modelVersion}`} />
        <Row label="Latency" value={`${state.latencyMs.toFixed(0)} ms`} />
        <Row label="Inference FPS" value={state.inferenceFps.toString()} icon={Gauge} />
        <Row label="Camera FPS" value={state.cameraFps.toString()} />
        <Row label="Processed FPS" value={state.processedFps.toString()} />
        <Row label="Frames" value={String(state.snapshot?.framesProcessed ?? 0)} />
      </div>
      {state.rejectedFrames > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {state.rejectedFrames} frame{state.rejectedFrames === 1 ? "" : "s"} discarded — the
          backend returned implausible output. If this keeps rising, switch the execution backend
          to CPU in Settings.
        </p>
      ) : null}
    </Card>
  );
}


function Row({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 font-mono text-[10px] uppercase text-muted-foreground">
        {Icon ? <Icon className="h-3 w-3" /> : null}
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-sm">{value}</div>
    </div>
  );
}
