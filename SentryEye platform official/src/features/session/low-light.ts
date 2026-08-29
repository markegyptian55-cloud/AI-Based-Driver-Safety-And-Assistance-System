// Low-light capture mode.
//
// Auto-gain in the preprocessing step brightens the *pixels we already got*.
// That only goes so far: if the sensor exposed for 4 ms, the detail simply is
// not there. Where the browser exposes MediaStreamTrack capabilities we push
// the sensor itself — longer exposure, higher ISO, brightness compensation,
// lower frame rate so each frame gets more light — and only then lean on the
// software gain.
//
// Every capability here is optional and vendor-dependent (Chrome on Android
// exposes most, Safari almost none), so each is applied independently and
// failures are reported rather than thrown.

export interface LowLightOutcome {
  /** Constraints the browser accepted. */
  applied: string[];
  /** Capabilities the device does not expose. */
  unsupported: string[];
  /** True when at least one sensor-level control took effect. */
  hardware: boolean;
  /** Extra software gain to request from the preprocessing pipeline. */
  softwareGain: number;
  message: string;
}

interface ExtendedCapabilities {
  exposureMode?: string[];
  exposureTime?: { min: number; max: number; step?: number };
  exposureCompensation?: { min: number; max: number; step?: number };
  iso?: { min: number; max: number; step?: number };
  brightness?: { min: number; max: number; step?: number };
  frameRate?: { min: number; max: number };
  torch?: boolean;
}

const HIGH = (r: { min: number; max: number }, frac: number) =>
  r.min + (r.max - r.min) * frac;

/**
 * Pushes the sensor toward a brighter exposure. Returns what actually stuck so
 * the UI can be honest about which knobs the device supports.
 */
export async function applyLowLightCapture(
  track: MediaStreamTrack,
  opts: { torch?: boolean } = {},
): Promise<LowLightOutcome> {
  const applied: string[] = [];
  const unsupported: string[] = [];

  const caps = (
    typeof track.getCapabilities === "function" ? track.getCapabilities() : {}
  ) as ExtendedCapabilities;

  const attempts: Array<[string, Record<string, unknown> | null]> = [
    [
      "exposureMode",
      caps.exposureMode?.includes("continuous")
        ? { exposureMode: "continuous" }
        : null,
    ],
    [
      "exposureCompensation",
      caps.exposureCompensation
        ? { exposureCompensation: HIGH(caps.exposureCompensation, 0.85) }
        : null,
    ],
    ["iso", caps.iso ? { iso: HIGH(caps.iso, 0.8) } : null],
    ["brightness", caps.brightness ? { brightness: HIGH(caps.brightness, 0.7) } : null],
    [
      "exposureTime",
      caps.exposureTime ? { exposureTime: HIGH(caps.exposureTime, 0.6) } : null,
    ],
    // A slower stream means a longer per-frame exposure budget on most sensors,
    // and the model does not need 30 fps to score a 500 ms closure.
    [
      "frameRate",
      caps.frameRate ? { frameRate: Math.max(caps.frameRate.min, 12) } : null,
    ],
    ["torch", opts.torch && caps.torch ? { torch: true } : null],
  ];

  for (const [name, constraint] of attempts) {
    if (!constraint) {
      unsupported.push(name);
      continue;
    }
    try {
      await track.applyConstraints({
        advanced: [constraint as unknown as MediaTrackConstraintSet],
      } as MediaTrackConstraints);
      applied.push(name);
    } catch {
      unsupported.push(name);
    }
  }

  const hardware = applied.some((a) => a !== "frameRate");
  return {
    applied,
    unsupported,
    hardware,
    // When the sensor refuses to cooperate, software gain has to do all the work.
    softwareGain: hardware ? 1.6 : 2.4,
    message: hardware
      ? `Sensor tuned for low light (${applied.join(", ")}).`
      : "This device doesn't expose exposure controls — using boosted software gain only.",
  };
}

/** Reverts to the browser default exposure behaviour. */
export async function clearLowLightCapture(track: MediaStreamTrack): Promise<void> {
  try {
    await track.applyConstraints({
      advanced: [{ exposureMode: "continuous" } as unknown as MediaTrackConstraintSet],
    } as MediaTrackConstraints);
  } catch {
    /* device may not support it — nothing to revert */
  }
}

const STORAGE_KEY = "dds.lowLightCapture";

export function readLowLightPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeLowLightPreference(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked */
  }
}
