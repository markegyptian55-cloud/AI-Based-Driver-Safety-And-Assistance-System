// In-Live benchmark panel.
//
// The phone and the laptop fail for different reasons, so the numbers that
// matter must be captured *per device class* and kept side by side: this device
// measured now, and the most recent stored run from the other class. Every run
// is saved with its device fingerprint, so repeated runs on the same footage
// expose regressions in both speed and in how many boxes the model finds.

import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge, Loader2, Smartphone, Monitor, Upload, Video } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useModelContext } from "@/features/inference/model-context";
import { liveProviderConfig, resolveLivePreset } from "@/features/inference/live-config";
import { runBenchmark, type BenchResult } from "@/features/inference/benchmark";
import {
  closeFrames,
  sampleFromCamera,
  sampleFromImage,
  sampleFromVideo,
} from "@/features/inference/frame-sampler";
import {
  collectDeviceStats,
  listBenchmarkRuns,
  saveBenchmarkRun,
  type BenchmarkRun,
} from "@/features/benchmark/benchmark-runs";
import {
  compareRuns,
  deviceClassOfRun,
  type RunComparison,
} from "@/features/benchmark/run-comparison";
import {
  currentPerformanceProfile,
  readPerformanceMode,
  writePerformanceMode,
  type PerformanceMode,
} from "@/features/inference/performance-mode";
import { errorMessage } from "@/lib/format-error";

const FRAMES = 10;
const ACCEPT = "image/*,video/mp4,video/webm,video/quicktime";

function classIcon(cls: string) {
  return cls === "desktop" ? Monitor : Smartphone;
}

function detectionRate(r: BenchResult): number {
  // "Success" here means the model produced at least the eyes it should on an
  // average frame; mean boxes per frame normalised against the 3 expected.
  return Math.max(0, Math.min(1, r.meanDetections / 3));
}

export function LiveBenchmarkPanel() {
  const { selected, models } = useModelContext();
  const [mode, setMode] = useState<PerformanceMode>(() => readPerformanceMode());
  const profile = currentPerformanceProfile(mode);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<BenchResult[] | null>(null);
  const [history, setHistory] = useState<BenchmarkRun[]>([]);
  const [comparison, setComparison] = useState<RunComparison | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await listBenchmarkRuns(20));
    } catch {
      /* visitors have no history */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const run = useCallback(
    async (source: string, getFrames: () => Promise<ImageBitmap[]>) => {
      if (!selected) {
        toast.error("Choose a model first.");
        return;
      }
      setBusy(true);
      setResults(null);
      setComparison(null);
      setProgress(0);
      let frames: ImageBitmap[] = [];
      try {
        frames = await getFrames();
        const ctx = resolveLivePreset();
        const candidates = models.flatMap((model) => {
          const config = liveProviderConfig(model, ctx.preset);
          return [
            {
              id: `${model.id}:webgpu`,
              label: `${model.modelName} · GPU`,
              kind: "on-device" as const,
              overrides: { ...config, enginePreference: "webgpu" as const },
            },
            {
              id: `${model.id}:wasm`,
              label: `${model.modelName} · CPU`,
              kind: "on-device" as const,
              overrides: { ...config, enginePreference: "wasm" as const },
            },
          ];
        });
        const out = await runBenchmark({
          frames,
          baseConfig: liveProviderConfig(selected, ctx.preset),
          candidates,
          onProgress: ({ done, total }) => setProgress(done / total),
        });
        setResults(out);

        const device = collectDeviceStats({
          engine: out.find((r) => r.ok)?.engine ?? null,
          constrained: profile.deviceClass !== "desktop",
        });
        const previousSameClass = history.find(
          (h) => deviceClassOfRun(h) === profile.deviceClass && h.frameSource === source,
        );
        const saved = await saveBenchmarkRun({
          frameSource: source,
          frameCount: frames.length,
          device,
          results: out,
        }).catch(() => null);
        if (saved && previousSameClass) setComparison(compareRuns(previousSameClass, saved));
        if (saved) void loadHistory();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        closeFrames(frames);
        setBusy(false);
        setProgress(0);
      }
    },
    [history, loadHistory, models, profile.deviceClass, selected],
  );

  const otherClassRun = history.find((h) => deviceClassOfRun(h) !== profile.deviceClass);
  const ThisIcon = classIcon(profile.deviceClass);

  return (
    <Card className="space-y-3 border-border/60 bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Gauge className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Device benchmark
        </span>
        <Badge variant="outline" className="gap-1 text-[10px]">
          <ThisIcon className="h-3 w-3" aria-hidden="true" />
          {profile.label}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Measures this device on the same frames every time: frames per second, inference time and
        detection success rate. Runs are stored per device, so a phone result is never compared
        against a computer result.
      </p>

      <div className="space-y-1 rounded-md border border-border/60 p-2">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Performance mode
        </p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "auto", label: "Automatic" },
              { id: "balanced", label: "Battery saver" },
              { id: "quality", label: "Max quality" },
            ] as const
          ).map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={mode === option.id ? "default" : "outline"}
              onClick={() => {
                setMode(option.id);
                writePerformanceMode(option.id);
                toast.success("Applies the next time detection starts.");
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{profile.reason}</p>
        <p className="font-mono text-[10px] text-muted-foreground">
          {profile.wasmThreads} CPU threads · {profile.nmsCandidateCap} candidates ·{" "}
          {profile.maxDetections} boxes max · up to {profile.imgszCeiling}px
        </p>
      </div>



      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run("camera", async () => (await sampleFromCamera({ count: FRAMES })).frames)
          }
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {Math.round(progress * 100)}%
            </>
          ) : (
            <>
              <Video className="mr-2 h-4 w-4" /> Benchmark the camera
            </>
          )}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" /> Use a clip or photo
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            void run("file", async () =>
              f.type.startsWith("video")
                ? sampleFromVideo(f, { count: FRAMES })
                : sampleFromImage(f, FRAMES),
            );
          }}
        />
      </div>

      {results && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1">Path</th>
                <th>FPS</th>
                <th>Inference</th>
                <th>Detection</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {results.map((r) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="py-1 pr-3">{r.label}</td>
                  <td className="pr-3">{r.ok ? r.fps.toFixed(1) : "—"}</td>
                  <td className="pr-3">{r.ok ? `${r.latencyP50.toFixed(0)} ms` : "—"}</td>
                  <td className="pr-3">
                    {r.ok ? `${(detectionRate(r) * 100).toFixed(0)}%` : (r.error ?? "failed")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {otherClassRun && (
        <p className="text-xs text-muted-foreground">
          Last {deviceClassOfRun(otherClassRun)} run:{" "}
          <span className="font-mono">
            {otherClassRun.bestFps?.toFixed(1) ?? "—"} fps ·{" "}
            {otherClassRun.bestLatencyP95Ms?.toFixed(0) ?? "—"} ms p95
          </span>{" "}
          ({otherClassRun.bestModelLabel ?? "unknown model"})
        </p>
      )}

      {comparison && (
        <div className="space-y-1 rounded-md border border-border/60 p-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Versus the previous run on this {comparison.deviceClass}
          </p>
          {comparison.models.map((m) => (
            <p
              key={m.id}
              className={m.regressed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
            >
              {m.label}: {m.note}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}
