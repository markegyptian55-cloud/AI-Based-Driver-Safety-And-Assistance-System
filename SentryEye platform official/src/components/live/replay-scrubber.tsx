// Replay scrubber — frame-by-frame review of a finished (or paused) run.
//
// Analysis is only trustworthy if you can go back and look. The scrubber
// replays the recorded per-frame state: drag the slider, see the tracked
// boxes for that instant, the eye/mouth status, PERCLOS and the closure
// length. When the source is an uploaded clip the underlying <video> is
// seeked to the same position, so boxes sit on the real picture.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { frameAt, type ReplayFrame } from "@/features/session/replay-buffer";
import type { Detection } from "@/features/inference/types";

const RISK_TONE: Record<string, string> = {
  safe: "bg-primary/15 text-primary",
  low: "bg-primary/15 text-primary",
  medium: "bg-amber-500/15 text-amber-400",
  high: "bg-orange-500/15 text-orange-400",
  critical: "bg-destructive/15 text-destructive",
};

function clock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function ReplayScrubber({
  frames,
  video,
  onSeekDetections,
}: {
  frames: ReplayFrame[];
  /** Optional media element to keep in sync with the scrub position. */
  video?: HTMLVideoElement | null;
  /** Pushes the replayed detections into the shared overlay ref. */
  onSeekDetections?: (dets: Detection[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef(0);

  const duration = frames.length ? frames[frames.length - 1].t : 0;
  const current = frames[Math.min(index, Math.max(0, frames.length - 1))] ?? null;

  // Keep the index inside the buffer when a new run replaces the old one.
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, frames.length - 1)));
  }, [frames.length]);

  // Push the replayed frame into the live overlay + seek the clip.
  useEffect(() => {
    if (!current) return;
    onSeekDetections?.(current.detections);
    if (video && current.mediaMs != null && Number.isFinite(video.duration)) {
      const target = current.mediaMs / 1000;
      if (Math.abs(video.currentTime - target) > 0.15) {
        try {
          video.currentTime = target;
        } catch {
          /* seeking not possible yet */
        }
      }
    }
  }, [current, video, onSeekDetections]);

  // Soft playback of the recorded frames at their own pace.
  useEffect(() => {
    if (!playing || !frames.length) return;
    let last = performance.now();
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (now - last < 60) return;
      last = now;
      setIndex((i) => {
        if (i >= frames.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, frames.length]);

  const stats = useMemo(() => {
    if (!current) return [];
    return [
      { label: "PERCLOS", value: `${Math.round(current.perclos * 100)}%` },
      { label: "Closure", value: `${Math.round(current.closureMs)} ms` },
      { label: "Eyes", value: current.eyesClosed ? "closed" : "open" },
      { label: "Mouth", value: current.yawning ? "open / yawn" : "neutral" },
      { label: "Tracks", value: String(current.detections.length) },
    ];
  }, [current]);

  if (!frames.length) {
    return (
      <Card className="border-border/60 bg-card/60 p-4 text-sm text-muted-foreground">
        Replay becomes available once a run has produced analysed frames.
      </Card>
    );
  }

  return (
    <Card className="space-y-3 border-border/60 bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Replay</h3>
          <Badge variant="secondary" className="text-[10px]">
            {frames.length} frames
          </Badge>
        </div>
        {current ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${RISK_TONE[current.risk] ?? "bg-muted text-muted-foreground"}`}
          >
            {current.risk}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label="Previous frame"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label={playing ? "Pause replay" : "Play replay"}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label="Next frame"
          onClick={() => setIndex((i) => Math.min(frames.length - 1, i + 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <div className="flex-1 px-2">
          <Slider
            value={[current?.t ?? 0]}
            min={0}
            max={Math.max(1, duration)}
            step={1}
            aria-label="Replay position"
            onValueChange={([t]) => {
              const f = frameAt(frames, t);
              if (f) setIndex(frames.indexOf(f));
            }}
          />
        </div>
        <span className="w-20 text-right font-mono text-xs text-muted-foreground">
          {clock(current?.t ?? 0)} / {clock(duration)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-md border border-border/50 bg-background/40 p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="text-sm font-semibold">{s.value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
