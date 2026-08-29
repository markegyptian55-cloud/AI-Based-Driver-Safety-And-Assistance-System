// Calibration wizard.
//
// Three short steps — sit still, blink once, yawn once — measured with the
// real model on the real device. From those samples we derive this driver's
// own thresholds (see calibration.ts) instead of shipping laptop defaults to
// a phone in a dark cabin.
//
// The wizard owns its camera stream and its provider lease, and releases both
// on unmount, so it can never leave a second stream or a warm session behind.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatError } from "@/lib/format-error";
import { loadModelMetadata } from "@/features/drowsiness/labels";
import { acquireProvider, releaseProvider } from "@/features/inference/provider-cache";
import { readEnginePreference, isConstrainedDevice } from "@/features/inference/engine-preference";
import { readPresetPreference, selectPreset } from "@/features/inference/mobile-presets";
import type { Detection, InferenceProvider } from "@/features/inference/types";
import {
  computeCalibration,
  faceRatioFromBoxes,
  spellDurations,
  writeCalibration,
  type CalibrationProfile,
  type CalibrationSamples,
  type CalibrationStepId,
} from "@/features/session/calibration";
import { createCamera } from "@/features/session/camera";
import { readLowLightPreference } from "@/features/session/low-light";
import type { FrameSource } from "@/features/session/frame-source";

interface StepDef {
  id: CalibrationStepId;
  title: string;
  instruction: string;
  durationMs: number;
}

const STEPS: StepDef[] = [
  {
    id: "baseline",
    title: "Look at the camera",
    instruction: "Sit exactly as you would while driving and look straight at the lens.",
    durationMs: 5000,
  },
  {
    id: "blink",
    title: "Blink normally",
    instruction: "Blink two or three times at your natural speed. Don't hold your eyes shut.",
    durationMs: 6000,
  },
  {
    id: "yawn",
    title: "Yawn once",
    instruction: "Open your mouth into a full yawn and hold it, then close.",
    durationMs: 6000,
  },
];

interface FrameMark {
  ts: number;
  eyeClosed: boolean;
  mouthOpen: boolean;
}

export function CalibrationWizard({
  modelId,
  onDone,
  onCancel,
}: {
  modelId: string | null;
  onDone: (profile: CalibrationProfile) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const providerRef = useRef<InferenceProvider | null>(null);
  const sourceRef = useRef<FrameSource | null>(null);
  const stepRef = useRef<number>(-1);
  const framesRef = useRef<Record<CalibrationStepId, FrameMark[]>>({
    baseline: [],
    blink: [],
    yawn: [],
  });
  const collected = useRef<CalibrationSamples>({
    luma: [],
    faceRatio: [],
    eyeConfidence: [],
    blinkDurationsMs: [],
    yawnDurationMs: null,
    mouthAspects: [],
  });

  const [status, setStatus] = useState<"loading" | "ready" | "running" | "done" | "error">(
    "loading",
  );
  const [stepIndex, setStepIndex] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState({ luma: 0, faceRatio: 0, detections: 0 });

  const teardown = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
    releaseProvider(providerRef.current);
    providerRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  // Boot the model + camera once, then hold them for the whole wizard.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const meta = await loadModelMetadata(modelId);
        const constrained =
          typeof navigator !== "undefined" && isConstrainedDevice(navigator as never);
        const preset = selectPreset(readPresetPreference(), constrained);
        const provider = await acquireProvider(preset.id === "desktop" ? "browser-onnx" : "browser-onnx", {
          modelId: meta.id,
          modelUrl: meta.modelUrl,
          imgsz: meta.imgsz,
          labels: meta.labels,
          semanticMap: meta.semanticMap,
          // Calibration deliberately takes weak boxes in: we are measuring how
          // confident this device *can* be, not filtering by a guess.
          confThreshold: 0.15,
          iouThreshold: preset.iouThreshold,
          maxDetections: meta.postprocessConfig.maxDetections,
          modelName: meta.modelName,
          modelVersion: meta.version,
          headFormat: meta.headFormat,
          classIdOffset: meta.postprocessConfig.classIdOffset,
          resize: meta.postprocessConfig.resize,
          normalize: meta.postprocessConfig.normalize,
          enginePreference: readEnginePreference(),
          autoGain: true,
          autoGainTargetLuma: preset.autoGainTargetLuma,
        });
        if (cancelled) {
          releaseProvider(provider);
          return;
        }
        providerRef.current = provider;

        const camera = createCamera({
          video: videoRef.current!,
          lowLight: readLowLightPreference(),
          onFrame: async (bitmap, ts) => {
            const p = providerRef.current;
            if (!p) {
              bitmap.close();
              return;
            }
            const result = await p.infer(bitmap, ts);
            const dets = result.detections;
            const eyes = dets.filter((d) => d.semantic.startsWith("eye"));
            const closed = eyes.some((d) => d.semantic === "eye_closed");
            const mouth = strongestMouth(dets);
            const faceRatio = faceRatioFromBoxes(dets);
            setLive({
              luma: result.meta.luma ?? 0,
              faceRatio,
              detections: dets.length,
            });

            const idx = stepRef.current;
            if (idx >= 0 && idx < STEPS.length) {
              const step = STEPS[idx];
              framesRef.current[step.id].push({
                ts,
                eyeClosed: closed,
                mouthOpen: Boolean(mouth),
              });
              const c = collected.current;
              if (step.id === "baseline") {
                c.luma.push(result.meta.luma ?? 0);
                if (faceRatio > 0) c.faceRatio.push(faceRatio);
                const topEye = Math.max(0, ...eyes.map((d) => d.confidence));
                if (topEye > 0) c.eyeConfidence.push(topEye);
              }
              if (step.id === "yawn" && mouth) {
                c.mouthAspects.push(mouth.bbox[3] / Math.max(1e-6, mouth.bbox[2]));
              }
            }
          },
        });
        sourceRef.current = camera;
        await camera.start();
        if (cancelled) {
          camera.stop();
          return;
        }
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setError(formatError(err).message);
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const runSteps = useCallback(async () => {
    setStatus("running");
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i];
      stepRef.current = i;
      setStepIndex(i);
      const startedAt = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          const elapsed = performance.now() - startedAt;
          setProgress(Math.min(100, (elapsed / step.durationMs) * 100));
          if (elapsed >= step.durationMs) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }
    stepRef.current = -1;

    const c = collected.current;
    c.blinkDurationsMs = spellDurations(
      framesRef.current.blink.map((f) => ({ ts: f.ts, active: f.eyeClosed })),
    );
    const yawnSpells = spellDurations(
      framesRef.current.yawn.map((f) => ({ ts: f.ts, active: f.mouthOpen })),
    );
    c.yawnDurationMs = yawnSpells.length ? Math.max(...yawnSpells) : null;

    const profile = computeCalibration(c);
    writeCalibration(profile);
    teardown();
    setStatus("done");
    toast.success(
      profile.partial
        ? "Calibrated with partial data — re-run for a better fit."
        : "Calibration saved for this device.",
    );
    onDone(profile);
  }, [onDone, teardown]);

  const step = stepIndex >= 0 ? STEPS[stepIndex] : null;

  return (
    <Card className="border-primary/30 bg-card/70 p-5">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Calibration</h2>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto h-7 w-7"
          aria-label="Close calibration"
          onClick={() => {
            teardown();
            onCancel();
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Takes about 20 seconds and tunes distance, brightness and your own blink length.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative overflow-hidden rounded-lg border border-border/60 bg-black">
          <video
            ref={videoRef}
            className="aspect-video w-full object-cover"
            playsInline
            muted
          />
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[70%] w-[45%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-dashed border-primary/70"
            aria-hidden="true"
          />
        </div>

        <div className="min-w-0">
          {status === "loading" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading model and
              camera…
            </p>
          ) : status === "error" ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <>
              <ol className="space-y-2">
                {STEPS.map((s, i) => (
                  <li key={s.id} className="flex items-start gap-2 text-sm">
                    {i < stepIndex || status === "done" ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    ) : i === stepIndex ? (
                      <Loader2
                        className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary"
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className="mt-1 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <div
                        className={cn(
                          "font-medium",
                          i === stepIndex ? "text-primary" : "text-foreground",
                        )}
                      >
                        {s.title}
                      </div>
                      <div className="text-xs text-muted-foreground">{s.instruction}</div>
                    </div>
                  </li>
                ))}
              </ol>

              {step ? <Progress value={progress} className="mt-4 h-1.5" /> : null}

              <dl className="mt-4 grid grid-cols-3 gap-2 font-mono text-[11px]">
                <Stat label="Brightness" value={`${(live.luma * 100).toFixed(0)}%`} />
                <Stat label="Face" value={`${(live.faceRatio * 100).toFixed(0)}%`} />
                <Stat label="Boxes" value={String(live.detections)} />
              </dl>

              {status === "ready" ? (
                <Button size="sm" className="mt-4 w-full" onClick={() => void runSteps()}>
                  Start calibration
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function strongestMouth(dets: Detection[]): Detection | null {
  let best: Detection | null = null;
  for (const d of dets) {
    if (!/yawn|mouth/i.test(d.semantic)) continue;
    if (!best || d.confidence > best.confidence) best = d;
  }
  return best;
}
