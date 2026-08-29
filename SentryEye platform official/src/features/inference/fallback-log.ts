// Auto-fallback audit trail.
//
// A model switch mid-run is the single most surprising thing the app does to a
// driver: the picture blinks, the numbers change, and nothing on screen says
// why. A toast alone disappears in four seconds, so every switch is also
// recorded here — with the measurement that triggered it — and replayed as an
// in-app alert until the driver dismisses it.

export interface FallbackEvent {
  at: number;
  /** ms into the run when the switch fired. */
  elapsedMs: number;
  fps: number;
  latencyMs: number;
  minFps: number;
  maxLatencyMs: number;
  fromModel: string;
  toModel: string;
  toModelId: string;
  /** Which bar was breached — both can be true. */
  reason: "fps" | "latency" | "both";
}

const KEY = "sentryeye.fallback-events";
const MAX = 20;

type Listener = (events: FallbackEvent[]) => void;
const listeners = new Set<Listener>();

export function reasonFor(e: {
  fps: number;
  latencyMs: number;
  minFps: number;
  maxLatencyMs: number;
}): FallbackEvent["reason"] {
  const slowFps = e.fps > 0 && e.fps < e.minFps;
  const highLatency = e.latencyMs > 0 && e.latencyMs > e.maxLatencyMs;
  if (slowFps && highLatency) return "both";
  return slowFps ? "fps" : "latency";
}

/** One sentence a non-engineer can act on. */
export function describeFallback(e: FallbackEvent): string {
  const parts: string[] = [];
  if (e.reason !== "latency") parts.push(`${e.fps.toFixed(1)} FPS (bar: ${e.minFps})`);
  if (e.reason !== "fps")
    parts.push(`${e.latencyMs.toFixed(0)} ms latency (bar: ${e.maxLatencyMs} ms)`);
  return `${parts.join(" and ")} held for several seconds — switched from ${e.fromModel} to ${e.toModel}.`;
}

export function readFallbackEvents(): FallbackEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FallbackEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(events: FallbackEvent[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(events.slice(0, MAX)));
  } catch {
    /* storage unavailable — the in-memory listeners still fire */
  }
  for (const l of listeners) l(events);
}

export function recordFallback(event: FallbackEvent): void {
  write([event, ...readFallbackEvents()].slice(0, MAX));
}

export function clearFallbackEvents(): void {
  write([]);
}

export function subscribeFallback(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
