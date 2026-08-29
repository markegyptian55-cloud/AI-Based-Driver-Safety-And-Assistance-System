// Automatic performance mode.
//
// Mobile and desktop fail in opposite directions: a phone stalls when it is
// given desktop-sized thread pools and an unbounded NMS candidate list, while a
// desktop loses accuracy when it is handed a phone's defensive caps. So the
// runtime knobs that are *purely* about cost — WASM thread count, NMS candidate
// intake, tracked-box ceiling — are derived from the device class here, in one
// place, and never from a guess made at the call site.
//
// Detection quality is deliberately NOT traded away: confidence and IoU
// thresholds are untouched by this module.

import { isMobileDevice } from "./engine-preference";

export type DeviceClass = "mobile" | "tablet" | "desktop";
export type PerformanceMode = "auto" | "balanced" | "quality";

export interface DeviceInfo {
  userAgent?: string;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
}

export interface PerformanceProfile {
  deviceClass: DeviceClass;
  mode: PerformanceMode;
  /** ORT WASM thread pool size (only used when cross-origin isolated). */
  wasmThreads: number;
  /** Upper bound on anchors admitted to NMS. NMS is quadratic. */
  nmsCandidateCap: number;
  /** Hard ceiling on kept boxes for one driver (2 eyes + 1 mouth + margin). */
  maxDetections: number;
  /** Largest model input this class should auto-select. */
  imgszCeiling: number;
  label: string;
  reason: string;
}

const STORAGE_KEY = "dds.performanceMode";

export function classifyDevice(nav: DeviceInfo): DeviceClass {
  const ua = nav.userAgent ?? "";
  if (/iPad/i.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return "tablet";
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "tablet";
  return isMobileDevice(nav) ? "mobile" : "desktop";
}

/** Cost-only tuning for a device class. Accuracy thresholds are never changed. */
export function resolvePerformanceProfile(
  nav: DeviceInfo,
  mode: PerformanceMode = "auto",
): PerformanceProfile {
  const deviceClass = classifyDevice(nav);
  const cores = Math.max(1, nav.hardwareConcurrency ?? 4);
  const memory = nav.deviceMemory ?? null;

  const base: Omit<PerformanceProfile, "mode"> =
    deviceClass === "desktop"
      ? {
          deviceClass,
          wasmThreads: Math.max(1, Math.min(4, cores - 1)),
          nmsCandidateCap: 200,
          maxDetections: 12,
          imgszCeiling: 640,
          label: "Desktop performance",
          reason: `${cores} cores — full thread pool and wide candidate intake.`,
        }
      : deviceClass === "tablet"
        ? {
            deviceClass,
            wasmThreads: Math.max(1, Math.min(3, cores - 1)),
            nmsCandidateCap: 128,
            maxDetections: 10,
            imgszCeiling: 640,
            label: "Tablet performance",
            reason: `${cores} cores — moderate thread pool, trimmed candidate intake.`,
          }
        : {
            deviceClass,
            wasmThreads: Math.max(1, Math.min(2, cores - 1)),
            nmsCandidateCap: 64,
            maxDetections: 8,
            // The current low-device export is 480px. Keeping the retired
            // 320px ceiling made the UI classify every available model as too
            // heavy even when the correct phone model was selected.
            imgszCeiling: 480,
            label: "Mobile performance",
            reason:
              "Phone CPUs throttle under wide thread pools; threads and NMS intake are capped to keep frames flowing.",
          };

  // A very small phone (<=4 cores or <=2 GB) gets one more notch of headroom.
  if (deviceClass !== "desktop" && (cores <= 4 || (memory != null && memory <= 2))) {
    base.wasmThreads = Math.max(1, Math.min(base.wasmThreads, 2));
    base.nmsCandidateCap = Math.min(base.nmsCandidateCap, 48);
    base.reason = "Low-power device detected — minimal thread pool and tight candidate intake.";
  }

  if (mode === "quality") {
    // Explicit user choice: spend more of the device on accuracy headroom.
    return {
      ...base,
      mode,
      nmsCandidateCap: Math.max(base.nmsCandidateCap, 200),
      maxDetections: Math.max(base.maxDetections, 12),
      imgszCeiling: 640,
      label: `${base.label} · quality`,
      reason: "Quality mode: wider candidate intake, no resolution ceiling.",
    };
  }
  if (mode === "balanced") {
    return {
      ...base,
      mode,
      wasmThreads: Math.max(1, base.wasmThreads - 1) || 1,
      nmsCandidateCap: Math.min(base.nmsCandidateCap, 64),
      label: `${base.label} · battery`,
      reason: "Battery mode: fewer threads and a tighter candidate intake.",
    };
  }
  return { ...base, mode };
}

export function readPerformanceMode(): PerformanceMode {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "auto" || v === "balanced" || v === "quality") return v;
  } catch {
    /* storage blocked */
  }
  return "auto";
}

export function writePerformanceMode(mode: PerformanceMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage blocked */
  }
}

function navInfo(): DeviceInfo {
  const nav = (globalThis as unknown as { navigator?: DeviceInfo }).navigator;
  return nav ?? {};
}

/** Profile for the current runtime (works in window and worker scopes). */
export function currentPerformanceProfile(mode?: PerformanceMode): PerformanceProfile {
  return resolvePerformanceProfile(navInfo(), mode ?? readPerformanceMode());
}
