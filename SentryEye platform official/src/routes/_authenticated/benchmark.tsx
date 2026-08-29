import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { Activity, Download, Gauge, Plug, Play, ServerCog, Wifi } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { ErrorBoundary } from "@/components/error-boundary";
import { useModelSelection } from "@/hooks/use-model-selection";
import { providerConfigFromModel } from "@/features/inference/model-context";
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
  normalizeBaseUrl,
  probeRemote,
  readRemoteBaseUrl,
  readRemoteEnabled,
  writeRemoteBaseUrl,
  writeRemoteEnabled,
  type RemoteHealth,
} from "@/features/inference/remote-endpoint";
import { createDiagnosticsLog } from "@/features/session/diagnostics-log";
import {
  buildFullBundle,
  downloadFullBundle,
  redactFullBundle,
} from "@/features/session/diagnostics-bundle";
import { errorMessage } from "@/lib/format-error";
import { ModelBenchmarkPanel } from "@/components/benchmark/model-benchmark-panel";
import { BenchmarkHistory } from "@/components/benchmark/benchmark-history";
import { DeviceCalibrationPanel } from "@/components/benchmark/device-calibration-panel";

export const Route = createFileRoute("/_authenticated/benchmark")({
  head: () => ({
    meta: [
      { title: "Engine benchmark — SentryEye" },
      {
        name: "description",
        content:
          "A/B test on-device WASM, WebGPU and remote FastAPI inference on your own device, then export one diagnostics bundle for deep troubleshooting.",
      },
      { property: "og:title", content: "Engine benchmark — SentryEye" },
      {
        property: "og:description",
        content:
          "Measure which inference path sustains real-time drowsiness detection on your phone, and share the full diagnostics bundle.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ErrorBoundary title="The benchmark page is unavailable">
      <BenchmarkPage />
    </ErrorBoundary>
  ),
});

const FRAME_COUNT = 12;

function BenchmarkPage() {
  const { selected } = useModelSelection();
  const [baseUrl, setBaseUrl] = useState(() => readRemoteBaseUrl());
  const [remoteOn, setRemoteOn] = useState(() => readRemoteEnabled());
  const [health, setHealth] = useState<RemoteHealth | null>(null);
  const [probing, setProbing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ label: string; value: number }>({
    label: "",
    value: 0,
  });
  const [results, setResults] = useState<BenchResult[] | null>(null);
  const logRef = useRef(createDiagnosticsLog());
  const fileRef = useRef<HTMLInputElement | null>(null);

  const probe = useCallback(async () => {
    setProbing(true);
    const clean = normalizeBaseUrl(baseUrl);
    writeRemoteBaseUrl(clean);
    setBaseUrl(clean);
    const result = await probeRemote(clean);
    setHealth(result);
    logRef.current.add("remote-probe", { ...result }, result.ok ? "info" : "warn");
    setProbing(false);
    if (result.ok) toast.success(`Service reachable in ${Math.round(result.rttMs)} ms.`);
    else toast.error(result.error ?? "The inference service did not answer.");
  }, [baseUrl]);

  const bench = useCallback(
    async (getFrames: () => Promise<{ frames: ImageBitmap[]; sensor?: string }>) => {
      if (!selected) {
        toast.error("No model is loaded yet. Open AI model info and pick a model first.");
        return;
      }
      setRunning(true);
      setResults(null);
      setProgress({ label: "Collecting frames…", value: 2 });
      let frames: ImageBitmap[] = [];
      try {
        ({ frames } = await getFrames());
        logRef.current.add("benchmark-frames", { frames: frames.length });

        const base = providerConfigFromModel(selected);
        const candidates: BenchCandidate[] = [
          {
            id: "wasm",
            label: "On-device · CPU (WASM)",
            kind: "on-device",
            overrides: { enginePreference: "wasm" },
          },
          {
            id: "webgpu",
            label: "On-device · GPU (WebGPU)",
            kind: "on-device",
            overrides: { enginePreference: "webgpu" },
          },
        ];
        if (health?.ok && baseUrl) {
          candidates.push({
            id: "remote",
            label: "Remote · FastAPI service",
            kind: "remote",
            overrides: { remoteBaseUrl: baseUrl },
          });
        }

        const out = await runBenchmark({
          frames,
          baseConfig: base,
          candidates,
          onProgress: ({ candidate, done, total }) =>
            setProgress({
              label: `Testing ${candidate}… ${done}/${total}`,
              value: Math.round((done / total) * 100),
            }),
        });
        setResults(out);
        logRef.current.add("benchmark-results", { results: out });
        const winner = out.find((r) => r.ok);
        if (winner) toast.success(`Best path on this device: ${winner.label}.`);
      } catch (err) {
        const message = errorMessage(err);
        logRef.current.add("benchmark-failed", { message }, "error");
        toast.error(message);
      } finally {
        closeFrames(frames);
        setRunning(false);
        setProgress({ label: "", value: 0 });
      }
    },
    [baseUrl, health, selected],
  );

  const onFile = useCallback(
    (file: File) => {
      void bench(async () => ({
        frames: file.type.startsWith("video")
          ? await sampleFromVideo(file, { count: FRAME_COUNT })
          : await sampleFromImage(file, FRAME_COUNT),
      }));
    },
    [bench],
  );

  const onCamera = useCallback(() => {
    void bench(async () => {
      const { frames } = await sampleFromCamera({ count: FRAME_COUNT });
      return { frames };
    });
  }, [bench]);

  const exportBundle = useCallback(() => {
    const bundle = buildFullBundle({
      log: logRef.current,
      benchmark: results,
      model: selected
        ? {
            id: selected.id,
            name: selected.modelName,
            version: selected.version,
            imgsz: selected.imgsz,
            headFormat: selected.headFormat,
            labels: selected.labels,
          }
        : {},
      runtime: { route: health?.ok ? "remote-available" : "on-device" },
    });
    const { bundle: safe, removed } = redactFullBundle(bundle);
    downloadFullBundle(safe);
    toast.success(
      removed.length
        ? `Bundle downloaded. Removed before export: ${removed.join(", ")}.`
        : "Diagnostics bundle downloaded.",
    );
  }, [health, results, selected]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 font-mono text-xl font-semibold sm:text-2xl">
          <Gauge className="h-5 w-5 text-primary" aria-hidden="true" />
          Engine benchmark
        </h1>
        <p className="text-sm text-muted-foreground">
          Runs the same frames through every available inference path on this device and reports
          which one sustains real-time detection ({REALTIME_FPS} fps or better) without losing
          accuracy.
        </p>
      </header>

      <DeviceCalibrationPanel />

      <ModelBenchmarkPanel />

      <BenchmarkHistory />

      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <ServerCog className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="font-mono text-sm font-semibold">Remote inference service</h2>
          {health && (
            <Badge
              variant="outline"
              className={
                health.ok
                  ? "border-safe/40 bg-safe/10 text-safe"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }
            >
              {health.ok ? `online · ${Math.round(health.rttMs)} ms` : "unreachable"}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Optional. When a phone cannot keep up on its own, the hybrid engine automatically sends
          frames to this FastAPI service instead — and switches back when the device recovers.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="remote-url" className="text-xs">
              Service URL
            </Label>
            <Input
              id="remote-url"
              inputMode="url"
              placeholder="https://inference.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <Button onClick={probe} disabled={probing || !baseUrl.trim()} className="gap-2">
            <Plug className="h-4 w-4" aria-hidden="true" />
            {probing ? "Checking…" : "Test connection"}
          </Button>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
          <div>
            <Label htmlFor="remote-on" className="text-sm">
              Use remote fallback in live sessions
            </Label>
            <p className="text-xs text-muted-foreground">
              Frames leave the device only while the fallback is active.
            </p>
          </div>
          <Switch
            id="remote-on"
            checked={remoteOn}
            onCheckedChange={(v) => {
              setRemoteOn(v);
              writeRemoteEnabled(v);
            }}
          />
        </div>
        {health?.ok && (
          <p className="font-mono text-xs text-muted-foreground">
            {health.modelName ?? "model"} {health.modelVersion ?? ""} · engine {health.engine} ·{" "}
            {health.imgsz ?? "?"}px
          </p>
        )}
      </Card>

      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="font-mono text-sm font-semibold">Run the A/B test</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Use your own footage: {FRAME_COUNT} frames are sampled across the clip, then replayed
          identically through every path.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => fileRef.current?.click()} disabled={running} className="gap-2">
            <Play className="h-4 w-4" aria-hidden="true" />
            Benchmark a video or photo
          </Button>
          <Button onClick={onCamera} disabled={running} variant="secondary" className="gap-2">
            <Wifi className="h-4 w-4" aria-hidden="true" />
            Benchmark the camera
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="video/*,image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onFile(file);
            }}
          />
        </div>
        {running && (
          <div className="space-y-2">
            <Progress value={progress.value} />
            <p className="font-mono text-xs text-muted-foreground">{progress.label}</p>
          </div>
        )}
      </Card>

      {results && (
        <Card className="space-y-3 p-4 sm:p-5">
          <h2 className="font-mono text-sm font-semibold">Results</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-2">Path</th>
                  <th>Score</th>
                  <th>FPS</th>
                  <th>p50 / p95 ms</th>
                  <th>Agreement</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {results.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="py-2 pr-3">{r.label}</td>
                    <td className="pr-3">
                      <Badge
                        variant="outline"
                        className={
                          r.score >= 70
                            ? "border-safe/40 bg-safe/10 text-safe"
                            : r.score >= 40
                              ? "border-warning/40 bg-warning/10 text-warning"
                              : "border-destructive/40 bg-destructive/10 text-destructive"
                        }
                      >
                        {r.score}
                      </Badge>
                    </td>
                    <td className="pr-3">{r.fps.toFixed(1)}</td>
                    <td className="pr-3">
                      {r.latencyP50.toFixed(0)} / {r.latencyP95.toFixed(0)}
                    </td>
                    <td className="pr-3">{(r.agreement * 100).toFixed(0)}%</td>
                    <td className="whitespace-normal font-sans text-muted-foreground">
                      {r.ok ? r.verdict : (r.error ?? "Failed")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h2 className="font-mono text-sm font-semibold">Diagnostics bundle</h2>
          <p className="text-xs text-muted-foreground">
            Logs, timing statistics, per-frame quality, model identity and the benchmark table in
            one file. Emails, tokens, URLs and identifiers are stripped before export.
          </p>
        </div>
        <Button onClick={exportBundle} variant="secondary" className="gap-2">
          <Download className="h-4 w-4" aria-hidden="true" />
          Export bundle
        </Button>
      </Card>
    </div>
  );
}
