// Mobile preflight: verify lighting, framing and a stable view BEFORE we let
// anyone start scoring their alertness. A drowsiness number computed from a
// dark, badly framed feed is worse than no number at all.
//
// The preview stream is owned entirely by this component and released before
// the real session starts, so only one camera stream is ever live.

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  evaluatePreflight,
  meanLumaFromRgba,
  type PreflightResult,
  type PreflightSample,
} from "@/features/session/preflight";
import { formatError } from "@/lib/format-error";

interface FaceDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
}

const SAMPLE_INTERVAL_MS = 400;
const MAX_SAMPLES = 12;

export function PreflightChecklist({
  video,
  onReady,
  onSkip,
}: {
  /** The same element the session will use, so the driver sees themselves. */
  video: HTMLVideoElement | null;
  /** Called with the preview released — safe to start the real session. */
  onReady: () => void;
  onSkip: () => void;
}) {
  const [samples, setSamples] = useState<PreflightSample[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectorRef = useRef<FaceDetectorLike | null>(null);

  const releasePreview = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (video) video.srcObject = null;
    setStreaming(false);
  }, [video]);

  useEffect(() => {
    if (!video) return;
    let cancelled = false;

    const FD = (window as unknown as { FaceDetector?: new (o?: unknown) => FaceDetectorLike })
      .FaceDetector;
    if (FD) {
      try {
        detectorRef.current = new FD({ fastMode: true, maxDetectedFaces: 1 });
      } catch {
        detectorRef.current = null;
      }
    }

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        video.muted = true;
        await video.play().catch(() => undefined);
        setStreaming(true);
      } catch (err) {
        if (!cancelled) setError(formatError(err).message);
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (video) video.srcObject = null;
    };
  }, [video]);

  // Sample the preview on an interval — cheap, and enough to judge a setup.
  useEffect(() => {
    if (!streaming || !video) return;
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    canvas.width = 128;
    canvas.height = 96;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let stopped = false;
    const timer = window.setInterval(() => {
      if (stopped || video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const luma = meanLumaFromRgba(ctx.getImageData(0, 0, canvas.width, canvas.height).data, 4);

      const push = (faceRatio: number | null, center: { x: number; y: number } | null) => {
        if (stopped) return;
        setSamples((prev) => [...prev, { luma, faceRatio, faceCenter: center }].slice(-MAX_SAMPLES));
      };

      const detector = detectorRef.current;
      if (!detector) {
        push(null, null);
        return;
      }
      detector
        .detect(canvas)
        .then((faces) => {
          const box = faces[0]?.boundingBox;
          if (!box) return push(0, null);
          const ratio = (box.width * box.height) / (canvas.width * canvas.height);
          push(ratio, {
            x: (box.x + box.width / 2) / canvas.width,
            y: (box.y + box.height / 2) / canvas.height,
          });
        })
        .catch(() => push(null, null));
    }, SAMPLE_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [streaming, video]);

  const result: PreflightResult = evaluatePreflight(samples, {
    streaming,
    manualFramingConfirmed: manualConfirmed,
  });

  return (
    <Card className="border-border/60 bg-card/60 p-5">
      <div className="flex items-center gap-2">
        <Camera className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Before you start</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Drowsiness scores are only meaningful when the camera can actually see your eyes.
      </p>

      {error ? (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="mt-4 space-y-2">
        {result.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-3 text-sm">
            <StatusIcon status={check.status} />
            <div className="min-w-0">
              <div
                className={cn(
                  "font-medium",
                  check.status === "fail" ? "text-destructive" : "text-foreground",
                )}
              >
                {check.label}
              </div>
              <div className="text-xs text-muted-foreground">{check.hint}</div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {result.needsManualFraming && !manualConfirmed ? (
          <Button variant="outline" size="sm" onClick={() => setManualConfirmed(true)}>
            My face fills the frame
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={!result.ready}
          onClick={() => {
            releasePreview();
            onReady();
          }}
        >
          Start analysis
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            releasePreview();
            onSkip();
          }}
        >
          Skip checks
        </Button>
      </div>
    </Card>
  );
}

function StatusIcon({ status }: { status: "pending" | "pass" | "fail" }) {
  if (status === "pass")
    return <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Passed" />;
  if (status === "fail")
    return <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Failed" />;
  return (
    <Loader2
      className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground"
      aria-label="Checking"
    />
  );
}
