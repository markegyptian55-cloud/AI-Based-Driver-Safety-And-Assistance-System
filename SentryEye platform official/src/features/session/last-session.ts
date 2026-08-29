// Last completed run, kept on the device.
//
// The Supabase row holds the summary, but the *evidence* — every event and
// the per-frame timeline — lives only in the page that produced it. Losing it
// on navigation means the driver cannot export a report after the fact, which
// is exactly when people want one. So the run is snapshotted to localStorage
// when it ends, bounded so it can never blow the storage quota.

import type { SemanticEvent } from "../drowsiness/types";
import type { TimelineSample } from "./session-csv";
import type { SessionTelemetry } from "./session-recorder";

const KEY = "sentryeye.last-session";
/** Hard cap on retained rows; the timeline is downsampled to fit. */
const MAX_TIMELINE = 3000;
const MAX_EVENTS = 500;

export interface LastSessionMeta {
  sessionId: string | null;
  driverLabel: string;
  source: string;
  modelName: string;
  modelVersion: string;
  engine: string;
  preset: string;
}

export interface LastSessionRecord {
  version: 1;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  meta: LastSessionMeta;
  telemetry: SessionTelemetry;
  /** Counters shown in the export card. */
  counts: {
    frames: number;
    microsleeps: number;
    yawns: number;
    alerts: number;
  };
  events: SemanticEvent[];
  timeline: TimelineSample[];
}

/** Evenly thins a series down to `max` rows, keeping the first and last. */
export function downsample<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(rows[Math.floor(i * step)]);
  out[out.length - 1] = rows[rows.length - 1];
  return out;
}

export function saveLastSession(record: LastSessionRecord): void {
  if (typeof window === "undefined") return;
  const trimmed: LastSessionRecord = {
    ...record,
    events: record.events.slice(-MAX_EVENTS),
    timeline: downsample(record.timeline, MAX_TIMELINE),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded: keep the summary and a coarse timeline rather than
    // dropping the whole record.
    try {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ ...trimmed, timeline: downsample(trimmed.timeline, 300) }),
      );
    } catch {
      /* storage unavailable — export stays available on the live page only */
    }
  }
}

export function readLastSession(): LastSessionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastSessionRecord;
    if (!parsed || parsed.version !== 1 || !parsed.telemetry) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLastSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
