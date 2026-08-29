// Live event rail: the chronological list of drowsiness episodes detected in
// the current run. It exists so a user can VERIFY the detector — every
// microsleep and yawn shows its timestamp and duration, and clicking an entry
// seeks the video back to that moment.

import { AlertTriangle, Eye, Moon, Siren, Wind } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SemanticEvent, SemanticEventKind } from "@/features/drowsiness/types";
import { cn } from "@/lib/utils";

const META: Record<
  SemanticEventKind,
  { label: string; icon: typeof Eye; tone: "safe" | "warn" | "danger" }
> = {
  eye_closed_sustained: { label: "Eyes closed", icon: Eye, tone: "warn" },
  microsleep: { label: "Microsleep", icon: Moon, tone: "danger" },
  critical_microsleep: { label: "Critical microsleep", icon: Siren, tone: "danger" },
  yawn_started: { label: "Mouth opening", icon: Wind, tone: "safe" },
  yawn: { label: "Yawn", icon: Wind, tone: "warn" },
  long_yawn: { label: "Long yawn", icon: Wind, tone: "warn" },
  drowsy_yawn: { label: "Yawn + eyes closing", icon: AlertTriangle, tone: "danger" },
  drowsy: { label: "Drowsy", icon: AlertTriangle, tone: "danger" },
  alert_cleared: { label: "Alert cleared", icon: Eye, tone: "safe" },
};

const TONE_CLASS: Record<"safe" | "warn" | "danger", string> = {
  safe: "text-muted-foreground",
  warn: "text-amber-400",
  danger: "text-destructive",
};

function fmtClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export interface LiveEventTimelineProps {
  events: SemanticEvent[];
  /** Session start (epoch ms) used to render relative timestamps. */
  startedAt: number | null;
  /** Seek handler; when provided, entries become clickable. */
  onSeek?: (offsetSeconds: number) => void;
  className?: string;
}

export function LiveEventTimeline({
  events,
  startedAt,
  onSeek,
  className,
}: LiveEventTimelineProps) {
  // Noise control: the "mouth opening" probe is useful for tuning but would
  // swamp the rail, so it only appears when nothing else has happened yet.
  const meaningful = events.filter((e) => e.kind !== "yawn_started");
  const shown = meaningful.length ? meaningful : events;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span>Event timeline</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {shown.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {shown.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No drowsiness episodes detected yet.
          </p>
        ) : (
          <ScrollArea className="h-64 pr-3">
            <ol className="relative space-y-2 border-l border-border pl-4">
              {shown.map((e, i) => {
                const meta = META[e.kind] ?? META.drowsy;
                const Icon = meta.icon;
                const offsetMs = startedAt ? Math.max(0, e.ts - startedAt) : 0;
                const durationMs = Number(e.metadata?.["durationMs"] ?? 0);
                const clickable = !!onSeek && !!startedAt;
                return (
                  <li key={`${e.kind}-${e.ts}-${i}`} className="relative">
                    <span
                      className={cn(
                        "absolute -left-[21px] top-2 size-2 rounded-full bg-current",
                        TONE_CLASS[meta.tone],
                      )}
                      aria-hidden
                    />
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => onSeek?.(offsetMs / 1000)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                        clickable ? "hover:bg-muted" : "cursor-default",
                      )}
                    >
                      <Icon className={cn("size-3.5 shrink-0", TONE_CLASS[meta.tone])} />
                      <span className="flex-1 truncate font-medium">{meta.label}</span>
                      {durationMs > 0 ? (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {(durationMs / 1000).toFixed(1)}s
                        </span>
                      ) : null}
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {fmtClock(offsetMs)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
