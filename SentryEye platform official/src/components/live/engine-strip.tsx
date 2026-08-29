import { Badge } from "@/components/ui/badge";
import type { LiveSessionState } from "@/features/session/use-live-session";
import { describeEngine } from "@/features/inference/engine-preference";
import { Cpu, Gauge, Layers, Zap } from "lucide-react";

/**
 * Compact truth strip: which model is running, on which execution provider,
 * whether frames are prepared on the GPU, and the measured cost. Every number
 * here is measured on this device — nothing is inferred from the device class.
 */
export function EngineStrip({ state }: { state: LiveSessionState }) {
  const fps = state.inferenceFps || (state.benchmarkMs ? 1000 / state.benchmarkMs : 0);
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/60 px-3 py-2 backdrop-blur"
      aria-label="Inference engine status"
    >
      <Badge variant="outline" className="gap-1 font-mono text-[10px] uppercase">
        <Layers className="h-3 w-3" />
        {state.modelName}
      </Badge>
      <Badge variant="outline" className="gap-1 font-mono text-[10px] uppercase">
        <Cpu className="h-3 w-3" />
        {describeEngine(state.engine)}
      </Badge>
      {state.preprocess ? (
        <Badge
          variant={state.preprocess === "gpu" ? "default" : "outline"}
          className="gap-1 font-mono text-[10px] uppercase"
        >
          <Zap className="h-3 w-3" />
          {state.preprocess === "gpu" ? "zero-copy" : "cpu prep"}
        </Badge>
      ) : null}
      <span className="ml-auto flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
        {state.benchmarkMs != null ? <span>bench {state.benchmarkMs.toFixed(1)} ms</span> : null}
        <span>infer {state.inferMs.toFixed(1)} ms</span>
        <span>pre {state.preprocessMs.toFixed(1)} ms</span>
        <span className="flex items-center gap-1 text-foreground" title="Model runs per second">
          <Gauge className="h-3 w-3" />
          {fps.toFixed(0)} infer/s
        </span>
        {state.cameraFps ? (
          <span title="Camera preview frames per second">
            preview {state.cameraFps.toFixed(0)} fps
          </span>
        ) : null}
      </span>
    </div>
  );
}
