import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDownUp, Activity, AlertTriangle, Eye, EyeOff, Wind } from "lucide-react";
import {
  applyTimelineFilters,
  DEFAULT_TIMELINE_FILTERS,
  fetchSessionTimeline,
  formatTimelineClock,
  TIMELINE_SEVERITIES,
  TIMELINE_TYPE_LABEL,
  TIMELINE_TYPES,
  type TimelineEvent,
  type TimelineEventType,
  type TimelineFilters,
  type TimelineSeverity,
} from "@/features/session/session-timeline";
import { errorMessage } from "@/lib/format-error";

const SEVERITY_TONE: Record<TimelineSeverity, string> = {
  low: "border-border/60 text-muted-foreground",
  medium: "border-warn/40 text-warn",
  high: "border-danger/40 text-danger",
  critical: "border-danger/60 text-danger",
};

const TYPE_ICON: Record<TimelineEventType, typeof Eye> = {
  eye_closed: EyeOff,
  eye_open: Eye,
  yawning: Wind,
  fatigue_alert: AlertTriangle,
};

export function SessionTimeline({
  sessionId,
  modelLabel,
}: {
  sessionId: string;
  modelLabel: string;
}) {
  const [filters, setFilters] = useState<TimelineFilters>(DEFAULT_TIMELINE_FILTERS);
  const [order, setOrder] = useState<"oldest" | "newest">("oldest");

  // Scoped to the opened session only — no cross-session preloading.
  const query = useQuery({
    queryKey: ["session_timeline", sessionId],
    queryFn: () => fetchSessionTimeline(sessionId),
    staleTime: 60_000,
  });

  const all = useMemo(() => query.data ?? [], [query.data]);
  const events = useMemo(() => {
    const filtered = applyTimelineFilters(all, filters);
    return order === "newest" ? [...filtered].reverse() : filtered;
  }, [all, filters, order]);

  return (
    <Card className="border-border/60 bg-card/60 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Event timeline
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Chronological drowsiness events recorded during this session.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOrder(order === "oldest" ? "newest" : "oldest")}
        >
          <ArrowDownUp className="mr-2 h-3.5 w-3.5" />
          {order === "oldest" ? "Oldest first" : "Newest first"}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Event type
          </Label>
          <Select value={filters.type} onValueChange={(v) => setFilters({ ...filters, type: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {TIMELINE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TIMELINE_TYPE_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Severity
          </Label>
          <Select
            value={filters.severity}
            onValueChange={(v) => setFilters({ ...filters, severity: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              {TIMELINE_SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-5">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : query.error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
            {errorMessage(query.error)}
          </div>
        ) : events.length === 0 ? (
          <TimelineEmpty filtered={all.length > 0} />
        ) : (
          <ol className="relative space-y-3 border-l border-border/60 pl-4 sm:pl-6">
            {events.map((e) => (
              <TimelineItem key={e.id} event={e} modelLabel={modelLabel} />
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function TimelineItem({ event, modelLabel }: { event: TimelineEvent; modelLabel: string }) {
  const Icon = TYPE_ICON[event.type];
  return (
    <li className="relative">
      <span
        className={`absolute -left-[1.30rem] top-4 flex h-5 w-5 items-center justify-center rounded-full border bg-background sm:-left-[1.80rem] ${SEVERITY_TONE[event.severity]}`}
      >
        <Icon className="h-3 w-3" />
      </span>
      <div className="rounded-md border border-border/60 bg-background/40 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-xs text-muted-foreground">
            {formatTimelineClock(event.tMs)}
          </span>
          <span className="text-sm font-medium">{TIMELINE_TYPE_LABEL[event.type]}</span>
          <Badge
            variant="outline"
            className={`font-mono text-[10px] uppercase ${SEVERITY_TONE[event.severity]}`}
          >
            {event.severity}
          </Badge>
          {event.durationMs != null ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {(event.durationMs / 1000).toFixed(2)} s
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
          <span className="truncate font-mono">{modelLabel}</span>
          <span className="font-mono">conf {(event.confidence * 100).toFixed(0)}%</span>
        </div>
      </div>
    </li>
  );
}

function TimelineEmpty({ filtered }: { filtered?: boolean }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-card/40 p-8 text-center">
      <Activity className="mx-auto h-6 w-6 text-muted-foreground" />
      <h3 className="mt-3 text-sm font-semibold">
        {filtered ? "No events match these filters" : "No events recorded"}
      </h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {filtered
          ? "Change the event type or severity filter to see the recorded events for this session."
          : "This session completed without any eye-closure, yawning or fatigue events being triggered."}
      </p>
    </div>
  );
}
