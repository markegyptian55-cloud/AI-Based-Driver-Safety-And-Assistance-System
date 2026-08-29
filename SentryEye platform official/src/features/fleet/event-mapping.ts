// Maps the inference layer's semantic events onto persisted safety events.
// Only meaningful state transitions cross this boundary — never per-frame
// detections — which is what keeps storage, cost and battery sane.

import type { SemanticEvent, SemanticEventKind } from "../drowsiness/types";
import type { SafetyEventInput } from "./types";

type Mapped = { eventType: string; severity: SafetyEventInput["severity"] } | null;

const MAP: Record<SemanticEventKind, Mapped> = {
  eye_closed_sustained: { eventType: "eyes_closed", severity: "medium" },
  microsleep: { eventType: "microsleep", severity: "high" },
  critical_microsleep: { eventType: "microsleep", severity: "critical" },
  yawn: { eventType: "yawning", severity: "low" },
  long_yawn: { eventType: "yawning", severity: "medium" },
  drowsy_yawn: { eventType: "drowsiness", severity: "high" },
  drowsy: { eventType: "drowsiness", severity: "high" },
  // Transient UI states — deliberately not persisted.
  yawn_started: null,
  alert_cleared: null,
};

/** Human labels for the categories we persist, derived in one place. */
export const EVENT_TYPE_LABEL: Record<string, string> = {
  eyes_closed: "Eyes closed",
  microsleep: "Microsleep",
  drowsiness: "Drowsiness",
  yawning: "Yawning",
  phone_usage: "Phone usage",
  image_detection: "Image detection",
};

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABEL[type] ?? type.replace(/_/g, " ");
}

export function mapSemanticEvent(
  event: SemanticEvent,
  modelVersion?: string | null,
): SafetyEventInput | null {
  const mapped = MAP[event.kind];
  if (!mapped) return null;
  const durationMs = Number(
    (event.metadata as Record<string, unknown> | undefined)?.["durationMs"] ?? 0,
  );
  return {
    clientEventId: `${event.kind}-${event.ts}`,
    eventType: mapped.eventType,
    severity: mapped.severity,
    confidence: Number.isFinite(event.confidence) ? event.confidence : 0,
    startedAt: new Date(event.ts).toISOString(),
    durationSeconds: Number.isFinite(durationMs) ? durationMs / 1000 : 0,
    modelVersion: modelVersion ?? null,
  };
}
