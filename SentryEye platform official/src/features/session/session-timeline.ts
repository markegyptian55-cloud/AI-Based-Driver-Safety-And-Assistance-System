// Event timeline data access. Reads the existing `detection_events` rows for a
// single session and maps them onto the four timeline event types. Nothing is
// duplicated or written back — this is a pure read/derive layer.

import { supabase } from "@/integrations/supabase/client";

export type TimelineEventType = "eye_closed" | "eye_open" | "yawning" | "fatigue_alert";
export type TimelineSeverity = "low" | "medium" | "high" | "critical";

export interface TimelineEvent {
  id: string;
  tMs: number;
  type: TimelineEventType;
  severity: TimelineSeverity;
  confidence: number;
  /** Derived from the gap to the next resolving event; null when unknown. */
  durationMs: number | null;
}

const TYPE_BY_TAG: Record<string, TimelineEventType> = {
  eye_closed_sustained: "eye_closed",
  yawn: "yawning",
  drowsy: "fatigue_alert",
  alert_cleared: "eye_open",
};

export const TIMELINE_TYPE_LABEL: Record<TimelineEventType, string> = {
  eye_closed: "Eye Closed",
  eye_open: "Eye Open",
  yawning: "Yawning",
  fatigue_alert: "Fatigue Alert",
};

export const TIMELINE_TYPES: TimelineEventType[] = [
  "eye_closed",
  "eye_open",
  "yawning",
  "fatigue_alert",
];

export const TIMELINE_SEVERITIES: TimelineSeverity[] = ["low", "medium", "high", "critical"];

/**
 * Severity is derived from the persisted risk level: a sustained drowsiness
 * alert at danger level is critical, other danger events are high, warnings are
 * medium and cleared/safe events are low.
 */
function severityOf(riskLevel: string | null, type: TimelineEventType): TimelineSeverity {
  if (riskLevel === "danger") return type === "fatigue_alert" ? "critical" : "high";
  if (riskLevel === "warn") return "medium";
  return "low";
}

/** Loads the timeline for exactly one session — never for the whole table. */
export async function fetchSessionTimeline(sessionId: string): Promise<TimelineEvent[]> {
  const { data, error } = await supabase
    .from("detection_events")
    .select("id,t_ms,semantic_tag,class_label,confidence,risk_level")
    .eq("session_id", sessionId)
    .order("t_ms", { ascending: true })
    .limit(2000);
  if (error) throw error;

  const events: TimelineEvent[] = [];
  for (const raw of data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const tag = String(row["semantic_tag"] ?? "");
    const type = TYPE_BY_TAG[tag];
    if (!type) continue; // only the four supported event types
    events.push({
      id: String(row["id"]),
      tMs: Number(row["t_ms"] ?? 0) || 0,
      type,
      severity: severityOf((row["risk_level"] as string | null) ?? null, type),
      confidence: Number(row["confidence"] ?? 0) || 0,
      durationMs: null,
    });
  }
  return withDurations(events);
}

/**
 * An eye-closure lasts until the next event that resolves it (eyes open again).
 * That gap is the only duration recoverable from stored data; everything else
 * stays null rather than inventing a value.
 */
function withDurations(events: TimelineEvent[]): TimelineEvent[] {
  for (let i = 0; i < events.length; i++) {
    if (events[i].type !== "eye_closed") continue;
    const next = events.slice(i + 1).find((e) => e.type === "eye_open");
    if (next) events[i].durationMs = Math.max(0, next.tMs - events[i].tMs);
  }
  return events;
}

export interface TimelineFilters {
  type: string; // "all" | TimelineEventType
  severity: string; // "all" | TimelineSeverity
}

export const DEFAULT_TIMELINE_FILTERS: TimelineFilters = { type: "all", severity: "all" };

export function applyTimelineFilters(
  events: TimelineEvent[],
  f: TimelineFilters,
): TimelineEvent[] {
  return events.filter(
    (e) => (f.type === "all" || e.type === f.type) && (f.severity === "all" || e.severity === f.severity),
  );
}

/** Relative session clock, HH:MM:SS. */
export function formatTimelineClock(tMs: number): string {
  const total = Math.max(0, Math.floor(tMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
