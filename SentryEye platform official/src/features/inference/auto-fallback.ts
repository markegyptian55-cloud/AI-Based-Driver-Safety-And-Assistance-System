// Automatic model fallback.
//
// A model that benchmarks fine on a laptop can collapse to 2 FPS on a phone.
// This watches the live telemetry and, when performance stays below the
// driver's chosen bar for a sustained window, names a lighter model to switch
// to. Pure decision logic — the UI owns the actual restart.

export type FallbackThresholdId = "off" | "gentle" | "balanced" | "strict" | "custom";

export interface FallbackThreshold {
  id: FallbackThresholdId;
  label: string;
  /** Analysed FPS below this counts as failing. */
  minFps: number;
  /** End-to-end latency above this counts as failing (ms). */
  maxLatencyMs: number;
}

export const FALLBACK_THRESHOLDS: FallbackThreshold[] = [
  { id: "off", label: "Off — never switch", minFps: 0, maxLatencyMs: Number.POSITIVE_INFINITY },
  { id: "gentle", label: "Below 4 FPS or 500 ms", minFps: 4, maxLatencyMs: 500 },
  { id: "balanced", label: "Below 8 FPS or 300 ms", minFps: 8, maxLatencyMs: 300 },
  { id: "strict", label: "Below 12 FPS or 200 ms", minFps: 12, maxLatencyMs: 200 },
];

export function thresholdById(id: FallbackThresholdId): FallbackThreshold {
  return FALLBACK_THRESHOLDS.find((t) => t.id === id) ?? FALLBACK_THRESHOLDS[0];
}

/** Time performance must stay bad before switching (ignores start-up spikes). */
export const SUSTAIN_MS = 6000;
/** Ignore the first seconds of a run: the camera and tracker are still settling. */
export const GRACE_MS = 4000;

export interface FallbackSample {
  /** ms since the run started. */
  t: number;
  fps: number;
  latencyMs: number;
}

export interface FallbackMonitor {
  /** Feed one telemetry tick; returns true when a switch should happen now. */
  observe(sample: FallbackSample): boolean;
  /** ms the current bad streak has lasted (0 when healthy). */
  badForMs(): number;
  reset(): void;
}

export function createFallbackMonitor(
  threshold: FallbackThreshold,
  sustainMs = SUSTAIN_MS,
  graceMs = GRACE_MS,
): FallbackMonitor {
  let badSince: number | null = null;
  let last = 0;
  return {
    observe(sample) {
      last = sample.t;
      if (threshold.id === "off" || sample.t < graceMs) {
        badSince = null;
        return false;
      }
      const failing =
        (sample.fps > 0 && sample.fps < threshold.minFps) ||
        (sample.latencyMs > 0 && sample.latencyMs > threshold.maxLatencyMs);
      if (!failing) {
        badSince = null;
        return false;
      }
      if (badSince == null) badSince = sample.t;
      return sample.t - badSince >= sustainMs;
    },
    badForMs() {
      return badSince == null ? 0 : Math.max(0, last - badSince);
    },
    reset() {
      badSince = null;
      last = 0;
    },
  };
}

const STORAGE_KEY = "sentryeye.fallback-threshold";
const DEVICE_KEY = "sentryeye.fallback-device";

export function readFallbackThreshold(): FallbackThresholdId {
  if (typeof window === "undefined") return "balanced";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const found = FALLBACK_THRESHOLDS.find((t) => t.id === raw);
    return found ? found.id : "balanced";
  } catch {
    return "balanced";
  }
}

export function writeFallbackThreshold(id: FallbackThresholdId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable — preference stays in memory */
  }
}

// ---------------------------------------------------------------------------
// Per-user + per-device thresholds
//
// The account-level numbers travel with the driver (they express what *they*
// consider unusable). The device override stays in this browser, because a
// laptop and a three-year-old phone deserve different bars — and the phone is
// the device that actually needs the escape hatch.

/** Account-level preference, mirrored from user_settings. */
export interface FallbackPreference {
  enabled: boolean;
  minFps: number;
  maxLatencyMs: number;
}

export const DEFAULT_FALLBACK_PREFERENCE: FallbackPreference = {
  enabled: true,
  minFps: 8,
  maxLatencyMs: 300,
};

/** Device-scoped override; null when this device follows the account setting. */
export type FallbackDeviceOverride = FallbackPreference | null;

export function clampPreference(p: Partial<FallbackPreference>): FallbackPreference {
  const minFps = Number(p.minFps);
  const maxLatencyMs = Number(p.maxLatencyMs);
  return {
    enabled: p.enabled !== false,
    minFps: Number.isFinite(minFps) ? Math.min(30, Math.max(0, minFps)) : 8,
    maxLatencyMs: Number.isFinite(maxLatencyMs)
      ? Math.min(5000, Math.max(50, maxLatencyMs))
      : 300,
  };
}

export function readDeviceOverride(): FallbackDeviceOverride {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEVICE_KEY);
    if (!raw) return null;
    return clampPreference(JSON.parse(raw) as Partial<FallbackPreference>);
  } catch {
    return null;
  }
}

export function writeDeviceOverride(pref: FallbackDeviceOverride): void {
  try {
    if (!pref) window.localStorage.removeItem(DEVICE_KEY);
    else window.localStorage.setItem(DEVICE_KEY, JSON.stringify(clampPreference(pref)));
  } catch {
    /* storage unavailable — the account setting still applies */
  }
}

/** The single source of truth every consumer must use. */
export function resolveFallbackThreshold(
  account: FallbackPreference,
  device: FallbackDeviceOverride,
): FallbackThreshold {
  const effective = clampPreference(device ?? account);
  if (!effective.enabled) return thresholdById("off");
  return {
    id: "custom",
    label: `Below ${effective.minFps} FPS or ${effective.maxLatencyMs} ms`,
    minFps: effective.minFps,
    maxLatencyMs: effective.maxLatencyMs,
  };
}

/** Nearest named preset, so the UI can show a friendly starting point. */
export function presetToPreference(id: FallbackThresholdId): FallbackPreference {
  const t = thresholdById(id);
  if (t.id === "off") return { ...DEFAULT_FALLBACK_PREFERENCE, enabled: false };
  return { enabled: true, minFps: t.minFps, maxLatencyMs: t.maxLatencyMs };
}

