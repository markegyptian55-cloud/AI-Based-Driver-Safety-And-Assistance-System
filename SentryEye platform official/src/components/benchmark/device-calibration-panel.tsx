// Calibrate the fallback bar against this device.
//
// Runs a short measured burst on the selected model using the driver's own
// camera, then proposes FPS/latency thresholds derived from what the device
// actually achieved rather than a number picked in the abstract.

import { useCallback, useState } from "react";
import { Ruler, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useModelContext, providerConfigFromModel } from "@/features/inference/model-context";
import { runBenchmark } from "@/features/inference/benchmark";
import { closeFrames, sampleFromCamera } from "@/features/inference/frame-sampler";
import {
  describeMeasurement,
  measurePreprocess,
  suggestThresholds,
  type DeviceMeasurement,
} from "@/features/inference/device-calibration";
import { useFallbackSettings } from "@/features/inference/use-fallback-settings";
import { errorMessage } from "@/lib/format-error";

const FRAMES = 8;

export function DeviceCalibrationPanel() {
  const { selected } = useModelContext();
  const { effective, saveAccount, saveDevice } = useFallbackSettings();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ label: "", value: 0 });
  const [measurement, setMeasurement] = useState<DeviceMeasurement | null>(null);

  const calibrate = useCallback(async () => {
    if (!selected) {
      toast.error("Pick a model first — calibration measures the model you will actually run.");
      return;
    }
    setBusy(true);
    setMeasurement(null);
    setProgress({ label: "Opening the camera…", value: 5 });
    let frames: ImageBitmap[] = [];
    try {
      const sample = await sampleFromCamera({ count: FRAMES });
      frames = sample.frames;
      const first = frames[0];
      const settings = sample.track?.getSettings?.();
      const frameWidth = settings?.width ?? first?.width ?? 0;
      const frameHeight = settings?.height ?? first?.height ?? 0;

      setProgress({ label: "Timing preprocessing…", value: 25 });
      const preprocessMs = first ? await measurePreprocess(first, selected.imgsz) : 0;

      setProgress({ label: "Timing the model…", value: 40 });
      const [result] = await runBenchmark({
        frames,
        baseConfig: providerConfigFromModel(selected),
        candidates: [
          {
            id: selected.id,
            label: `${selected.modelName} ${selected.imgsz}px`,
            kind: "on-device",
          },
        ],
        warmup: 2,
        onProgress: ({ done, total }) =>
          setProgress({
            label: `Measuring throughput — ${done}/${total}`,
            value: 40 + Math.round((done / total) * 55),
          }),
      });
      if (!result?.ok) throw new Error(result?.error ?? "The model failed to run on this device.");

      const m: DeviceMeasurement = {
        frameWidth,
        frameHeight,
        achievedFps: result.fps,
        latencyP95Ms: result.latencyP95,
        preprocessMs,
        frames: result.frames,
      };
      setMeasurement(m);
      toast.success("Calibration finished", { description: describeMeasurement(m) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      closeFrames(frames);
      setBusy(false);
      setProgress({ label: "", value: 0 });
    }
  }, [selected]);

  const suggestion = measurement ? suggestThresholds(measurement) : null;

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Ruler className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="font-mono text-sm font-semibold">Calibrate this device</h2>
        <Badge variant="outline" className="font-mono text-[10px]">
          now: {effective.minFps} FPS / {effective.maxLatencyMs} ms
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Measures your camera frame size and how fast this device pushes those frames through
        preprocessing and {selected?.modelName ?? "the selected model"}, then proposes a fallback
        bar that sits just under what the device can really sustain.
      </p>

      <Button onClick={() => void calibrate()} disabled={busy} className="gap-2">
        <Wand2 className="h-4 w-4" aria-hidden="true" />
        {busy ? "Measuring…" : "Measure this device"}
      </Button>

      {busy && (
        <div className="space-y-2">
          <Progress value={progress.value} />
          <p className="font-mono text-xs text-muted-foreground">{progress.label}</p>
        </div>
      )}

      {measurement && suggestion && (
        <div className="space-y-3 rounded-md border border-border/60 p-3">
          <p className="text-xs">{describeMeasurement(measurement)}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {[
              ["Camera frame", `${measurement.frameWidth}×${measurement.frameHeight}`],
              ["Throughput", `${measurement.achievedFps.toFixed(1)} FPS`],
              ["Latency p95", `${measurement.latencyP95Ms.toFixed(0)} ms`],
              ["Preprocess", `${measurement.preprocessMs.toFixed(1)} ms`],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="truncate font-mono text-[10px] uppercase text-muted-foreground">
                  {k}
                </dt>
                <dd className="font-mono text-sm">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="font-mono text-xs">
            Suggested bar: below {suggestion.minFps} FPS or above {suggestion.maxLatencyMs} ms
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                saveDevice(suggestion);
                toast.success("Fallback bar updated for this device");
              }}
            >
              Apply to this device
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void saveAccount(suggestion);
                toast.success("Fallback bar updated on your account");
              }}
            >
              Apply to my account
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
