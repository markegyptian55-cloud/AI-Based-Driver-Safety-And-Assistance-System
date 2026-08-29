// One-click model sweep.
//
// Compatibility tells you which models *can* run here; it cannot tell you which
// one is fast enough, because that depends on the phone in your hand. This runs
// every compatible model over the same frames and ranks them by measured
// throughput, so the choice before a session is evidence rather than a guess.
//
// Heavy models are included but tested last and with fewer frames — the point
// is to find the fastest usable one, not to make a slow phone chew through a
// 40 MB graph twelve times.

import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Crown, ListOrdered, Play, Wifi } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useModelContext } from "@/features/inference/model-context";
import { providerConfigFromModel } from "@/features/inference/model-context";
import { checkModelCompatibility, estimateCost } from "@/features/inference/model-compatibility";
import {
  runBenchmark,
  REALTIME_FPS,
  type BenchCandidate,
  type BenchResult,
} from "@/features/inference/benchmark";
import {
  closeFrames,
  sampleFromCamera,
  sampleFromImage,
  sampleFromVideo,
} from "@/features/inference/frame-sampler";
import {
  collectDeviceStats,
  saveBenchmarkRun,
} from "@/features/benchmark/benchmark-runs";
import { BENCHMARK_RUNS_KEY } from "./benchmark-history";
import { errorMessage } from "@/lib/format-error";
import { cn } from "@/lib/utils";

/** Fewer frames than the engine A/B: this sweep runs many more candidates. */
const FRAME_COUNT = 6;

export function ModelBenchmarkPanel() {
  const { models, selected, select, constrained } = useModelContext();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ label: "", value: 0 });
  const [results, setResults] = useState<BenchResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const qc = useQueryClient();

  const compatible = useMemo(
    () =>
      models
        .filter((m) => checkModelCompatibility(m, { constrained }).ok)
        // Cheapest first, so the useful answer arrives before the slow ones run.
        .sort((a, b) => estimateCost(a) - estimateCost(b)),
    [models, constrained],
  );

  const sweep = useCallback(
    async (
      getFrames: () => Promise<ImageBitmap[]>,
      frameSource: "camera" | "video" | "image" = "camera",
    ) => {
      if (!compatible.length) {
        toast.error("No model passes the compatibility checks on this device.");
        return;
      }
      setRunning(true);
      setResults(null);
      setProgress({ label: "Collecting frames…", value: 2 });
      let frames: ImageBitmap[] = [];
      try {
        frames = await getFrames();
        const candidates: BenchCandidate[] = compatible.map((m) => ({
          id: m.id,
          label: `${m.modelName} ${m.version} · ${m.imgsz}px`,
          kind: "on-device",
          overrides: providerConfigFromModel(m),
        }));

        const total = candidates.length;
        let index = 0;
        const out = await runBenchmark({
          frames,
          baseConfig: providerConfigFromModel(compatible[0]),
          candidates,
          warmup: 1,
          onProgress: ({ candidate, done, total: perModel }) => {
            const pos = candidates.findIndex((c) => c.id === candidate);
            if (pos >= 0) index = pos;
            const label = candidates[index]?.label ?? candidate;
            setProgress({
              label: `Profiling ${label} — ${done}/${perModel}`,
              value: Math.round(((index + done / perModel) / total) * 100),
            });
          },
        });
        // Rank by what the driver feels: sustained frame rate, then latency.
        const ranked = [...out].sort((a, b) =>
          a.ok === b.ok ? b.fps - a.fps || a.latencyP95 - b.latencyP95 : a.ok ? -1 : 1,
        );
        setResults(ranked);
        // Stored with the device stats so a future sweep is comparable to this
        // one; a ranking without the hardware behind it proves nothing.
        try {
          const saved = await saveBenchmarkRun({
            frameSource,
            frameCount: frames.length,
            device: collectDeviceStats({
              frameSize: frames[0] ? `${frames[0].width}×${frames[0].height}` : null,
              constrained,
              engine: ranked.find((r) => r.ok)?.engine ?? null,
            }),
            results: ranked,
          });
          if (saved) void qc.invalidateQueries({ queryKey: BENCHMARK_RUNS_KEY });
        } catch (err) {
          toast.message("Ranking shown but not stored", { description: errorMessage(err) });
        }
        const winner = ranked.find((r) => r.ok);
        if (winner) {
          toast.success(`Fastest here: ${winner.label} at ${winner.fps.toFixed(1)} FPS.`);
        } else {
          toast.error("Every model failed to run on this device.");
        }
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        closeFrames(frames);
        setRunning(false);
        setProgress({ label: "", value: 0 });
      }
    },
    [compatible, constrained, qc],
  );

  const nameFor = (id: string) => models.find((m) => m.id === id)?.modelName ?? id;

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <ListOrdered className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="font-mono text-sm font-semibold">Rank the models on this device</h2>
        <Badge variant="outline" className="font-mono text-[10px]">
          {compatible.length} compatible
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Profiles every compatible model over the same {FRAME_COUNT} frames and ranks them by
        measured speed, so you can pick before starting a session instead of discovering it mid-run.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          onClick={() =>
            void sweep(
              async () => (await sampleFromCamera({ count: FRAME_COUNT })).frames,
              "camera",
            )
          }
          disabled={running}
          className="gap-2"
        >
          <Wifi className="h-4 w-4" aria-hidden="true" />
          Profile with the camera
        </Button>
        <Button
          onClick={() => fileRef.current?.click()}
          disabled={running}
          variant="secondary"
          className="gap-2"
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          Profile with a video or photo
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void sweep(
              async () =>
                file.type.startsWith("video")
                  ? await sampleFromVideo(file, { count: FRAME_COUNT })
                  : await sampleFromImage(file, FRAME_COUNT),
              file.type.startsWith("video") ? "video" : "image",
            );
          }}
        />
      </div>

      {running && (
        <div className="space-y-2">
          <Progress value={progress.value} />
          <p className="font-mono text-xs text-muted-foreground">{progress.label}</p>
        </div>
      )}

      {results && (
        <ul className="space-y-2">
          {results.map((r, i) => {
            const best = i === 0 && r.ok;
            const isSelected = selected?.id === r.id;
            return (
              <li
                key={r.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-3",
                  best ? "border-primary/50 bg-primary/5" : "border-border/60",
                )}
              >
                <span className="font-mono text-xs text-muted-foreground">#{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
                {best && (
                  <Badge className="gap-1">
                    <Crown className="h-3 w-3" aria-hidden="true" />
                    Fastest
                  </Badge>
                )}
                {r.ok ? (
                  <span
                    className={cn(
                      "font-mono text-xs",
                      r.fps >= REALTIME_FPS ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    {r.fps.toFixed(1)} FPS · p95 {r.latencyP95.toFixed(0)} ms
                  </span>
                ) : (
                  <span className="font-mono text-xs text-destructive">
                    failed — {r.error ?? "unknown error"}
                  </span>
                )}
                <Button
                  size="sm"
                  variant={isSelected ? "secondary" : "outline"}
                  disabled={!r.ok || isSelected || running}
                  onClick={() => {
                    select(r.id);
                    toast.success(`${nameFor(r.id)} selected for the next session.`);
                  }}
                >
                  {isSelected ? "Selected" : "Use this"}
                </Button>
              </li>
            );
          })}
          {results.every((r) => !r.ok || r.fps < REALTIME_FPS) && (
            <li className="text-xs text-muted-foreground">
              Nothing reached {REALTIME_FPS} FPS here. Short microsleeps may be missed — consider
              the remote inference service below.
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
