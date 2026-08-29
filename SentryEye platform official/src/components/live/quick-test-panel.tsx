// Quick test mode.
//
// Runs the selected model over a short clip or a photo using the *same*
// provider configuration live detection would use (resolution, resize mode,
// normalisation, auto-gain, preset thresholds), then reports per-class
// detection rates with 95% confidence intervals so a small sample is not
// mistaken for a verdict.

import { useCallback, useRef, useState } from "react";
import { FlaskConical, Loader2, Upload } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useModelContext } from "@/features/inference/model-context";
import { acquireProvider, releaseProvider } from "@/features/inference/provider-cache";
import {
  describePreprocessing,
  liveProviderConfig,
  resolveLivePreset,
} from "@/features/inference/live-config";
import { wilsonInterval, meanInterval } from "@/features/inference/confidence-interval";
import type { Detection } from "@/features/inference/types";
import { errorMessage } from "@/lib/format-error";

const ACCEPT = "image/*,video/mp4,video/webm,video/quicktime";
/** Cap the probe so a long upload cannot stall the page. */
const MAX_FRAMES = 45;
const MAX_SECONDS = 8;

interface ClassStat {
  /** Frames in which at least one box of this class appeared. */
  frames: number;
  /** Total boxes across all frames. */
  count: number;
  /** Detection rate with a 95% Wilson interval. */
  rate: { value: number; low: number; high: number };
  /** Mean confidence with a 95% normal interval (null when never detected). */
  conf: { value: number; low: number; high: number } | null;
}

interface QuickTestResult {
  frames: number;
  avgLatencyMs: number;
  fps: number;
  engine: string;
  modelName: string;
  preprocessing: string[];
  stats: Record<string, ClassStat>;
}

const TRACKED = [
  { semantic: "eye_open", label: "Open eyes" },
  { semantic: "eye_closed", label: "Closed eyes" },
  { semantic: "yawn", label: "Yawning" },
] as const;

function collect(frames: Detection[][]): Record<string, ClassStat> {
  const out: Record<string, ClassStat> = {};
  const confs: Record<string, number[]> = {};
  for (const t of TRACKED) {
    out[t.semantic] = {
      frames: 0,
      count: 0,
      rate: { value: 0, low: 0, high: 0 },
      conf: null,
    };
    confs[t.semantic] = [];
  }
  for (const dets of frames) {
    const seen = new Set<string>();
    for (const d of dets) {
      const s = out[d.semantic];
      if (!s) continue;
      s.count += 1;
      confs[d.semantic]!.push(d.confidence);
      seen.add(d.semantic);
    }
    for (const sem of seen) out[sem]!.frames += 1;
  }
  const n = frames.length;
  for (const t of TRACKED) {
    const s = out[t.semantic]!;
    s.rate = wilsonInterval(s.frames, n);
    s.conf = meanInterval(confs[t.semantic]!);
  }
  return out;
}

function verdict(r: QuickTestResult, constrained: boolean): { text: string; tone: string } {
  const eyes = (r.stats["eye_open"]?.frames ?? 0) + (r.stats["eye_closed"]?.frames ?? 0);
  const yawn = r.stats["yawn"]?.frames ?? 0;
  if (r.fps < (constrained ? 5 : 10)) {
    return {
      tone: "text-destructive",
      text: `Only ${r.fps.toFixed(1)} FPS on this device — too slow for reliable live alerts. Try a smaller model.`,
    };
  }
  if (!eyes) {
    return {
      tone: "text-destructive",
      text: "No eyes detected in this clip. Check framing, lighting and that the face fills the frame.",
    };
  }
  if (!yawn) {
    return {
      tone: "text-muted-foreground",
      text: "Eyes detected. No yawns in this clip — test with a clip containing a yawn to verify that class.",
    };
  }
  return {
    tone: "text-safe",
    text: "Eye states and yawning both detected at usable speed — good to start live detection.",
  };
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

export function QuickTestPanel() {
  const { selected, providerId, warmup, constrained } = useModelContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickTestResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const run = useCallback(
    async (file: File) => {
      if (!selected) return;
      setBusy(true);
      setError(null);
      setResult(null);
      setProgress(0);
      setFileName(file.name);

      let url: string | null = null;
      let video: HTMLVideoElement | null = null;
      let provider: Awaited<ReturnType<typeof acquireProvider>> | null = null;
      try {
        const ctx = resolveLivePreset();
        provider = await acquireProvider(providerId, liveProviderConfig(selected, ctx.preset));
        const frames: Detection[][] = [];
        let latencySum = 0;
        const startedAt = performance.now();

        if (file.type.startsWith("image/")) {
          const bitmap = await createImageBitmap(file);
          const res = await provider.infer(bitmap, Date.now());
          bitmap.close?.();
          frames.push(res.detections);
          latencySum += res.latencyMs;
          setProgress(1);
        } else {
          url = URL.createObjectURL(file);
          video = document.createElement("video");
          video.muted = true;
          video.playsInline = true;
          video.preload = "auto";
          video.src = url;
          await new Promise<void>((resolve, reject) => {
            video!.onloadeddata = () => resolve();
            video!.onerror = () => reject(new Error("This video format cannot be decoded here."));
          });
          await video.play().catch(() => undefined);

          const deadline = performance.now() + MAX_SECONDS * 1000;
          while (frames.length < MAX_FRAMES && performance.now() < deadline && !video.ended) {
            const bitmap = await createImageBitmap(video);
            const res = await provider.infer(bitmap, Date.now());
            bitmap.close?.();
            frames.push(res.detections);
            latencySum += res.latencyMs;
            setProgress(frames.length / MAX_FRAMES);
          }
          video.pause();
        }

        const elapsed = (performance.now() - startedAt) / 1000;
        const status = provider.status();
        setResult({
          frames: frames.length,
          avgLatencyMs: frames.length ? latencySum / frames.length : 0,
          fps: elapsed > 0 ? frames.length / elapsed : 0,
          engine: status.engine,
          modelName: selected.modelName,
          preprocessing: describePreprocessing(selected, ctx),
          stats: collect(frames),
        });
      } catch (err) {
        console.error("[quick-test] failed", err);
        setError(errorMessage(err));
      } finally {
        if (provider) releaseProvider(provider);
        if (video) video.removeAttribute("src");
        if (url) URL.revokeObjectURL(url);
        setBusy(false);
      }
    },
    [providerId, selected],
  );

  const ready = warmup.status === "ready";
  const v = result ? verdict(result, constrained) : null;

  return (
    <Card className="space-y-3 border-border/60 bg-card/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Quick test
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run(f);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={busy || !ready}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Testing {Math.round(progress * 100)}%
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" /> Test a clip or photo
            </>
          )}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Runs {selected?.modelName ?? "the selected model"} over a short video or a photo with the
        exact preprocessing live detection uses, and reports how reliably it finds open eyes,
        closed eyes and yawning.
        {ready ? "" : " Waiting for the model to finish loading…"}
      </p>

      {error ? (
        <p className="break-words text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
            <Badge variant="outline" className="max-w-[12rem] truncate">
              {fileName}
            </Badge>
            <span>{result.frames} frames</span>
            <span aria-hidden="true">·</span>
            <span>{result.avgLatencyMs.toFixed(0)} ms/frame</span>
            <span aria-hidden="true">·</span>
            <span>{result.fps.toFixed(1)} FPS</span>
            <span aria-hidden="true">·</span>
            <span>{result.engine}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {TRACKED.map((t) => {
              const s = result.stats[t.semantic]!;
              return (
                <div key={t.semantic} className="rounded-lg border border-border/60 p-2">
                  <div className="font-mono text-[10px] uppercase text-muted-foreground">
                    {t.label}
                  </div>
                  <div className="mt-1 font-mono text-lg">{pct(s.rate.value)}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    95% CI {pct(s.rate.low)}–{pct(s.rate.high)}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {s.frames}/{result.frames} frames · {s.count} boxes
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {s.conf
                      ? `conf ${pct(s.conf.value)} (${pct(s.conf.low)}–${pct(s.conf.high)})`
                      : "conf —"}
                  </div>
                </div>
              );
            })}
          </div>

          {v ? <p className={`text-xs ${v.tone}`}>{v.text}</p> : null}
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Settings used: {result.preprocessing.join(" · ")}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
