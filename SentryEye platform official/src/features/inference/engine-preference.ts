// Engine preference for the browser inference provider.
//
// Mobile GPUs are the weak spot: several Android drivers run an ONNX graph in
// reduced precision (or silently return noise) while the ORT session still
// reports success. The safe default on a phone is CPU/WASM; desktops try
// WebGPU first. Users can override either way.

export type EnginePreference = "auto" | "webgpu" | "wasm";

const STORAGE_KEY = "dds.enginePreference";

export function readEnginePreference(): EnginePreference {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "webgpu" || v === "wasm" || v === "auto") return v;
  } catch {
    /* storage blocked */
  }
  return "auto";
}

export function writeEnginePreference(pref: EnginePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* storage blocked */
  }
}

/** True only for phones/tablets. Desktop CPU size must not select mobile behavior. */
export function isMobileDevice(nav: {
  userAgent?: string;
  hardwareConcurrency?: number;
  userAgentData?: { mobile?: boolean };
  maxTouchPoints?: number;
}): boolean {
  if (nav.userAgentData?.mobile) return true;
  const ua = nav.userAgent ?? "";
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua)) return true;
  // iPadOS reports a desktop UA but has touch points.
  if (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return true;
  return false;
}

/**
 * Backwards-compatible name used by presets and compatibility checks.
 * It intentionally means mobile-class now: low-core desktops keep desktop
 * camera geometry and thresholds, and performance fallback is benchmark-led.
 */
export function isConstrainedDevice(nav: Parameters<typeof isMobileDevice>[0]): boolean {
  return isMobileDevice(nav);
}

/**
 * Ordered execution providers to try, given a preference and the device.
 *
 * Phones are no longer forced onto WASM. A single-threaded WASM session on a
 * 640px graph is what produced the 2 fps Android failure; WebGPU is often 5-10x
 * faster there. The worker's self-test is the safety net: a driver that returns
 * noise fails the test and the plan falls through to WASM automatically, so the
 * constrained flag only decides ordering, never exclusion.
 */
export function planExecutionProviders(
  pref: EnginePreference,
  _constrained: boolean,
  hasWebGpu: boolean,
): ("webgpu" | "wasm")[] {
  if (pref === "wasm") return ["wasm"];
  if (!hasWebGpu) return ["wasm"];
  return ["webgpu", "wasm"];
}

/**
 * The model file this device will actually download and run.
 *
 * A model may ship two exports: fp16 for WebGPU and an fp32 twin for CPU/WASM
 * (fp16 is emulated there and roughly 2.4x slower in the browser). Cache
 * checks, the download manager and the worker must agree on which one is "the"
 * file, otherwise a phone reports "saved offline" for a file it never uses.
 */
export function runtimeModelAsset(meta: {
  id: string;
  modelUrl: string;
  cpuModelUrl?: string | null;
}): { id: string; url: string } {
  const gpu =
    typeof navigator !== "undefined" &&
    !!(navigator as unknown as { gpu?: unknown }).gpu;
  const wasmOnly = readEnginePreference() === "wasm" || !gpu;
  if (wasmOnly && meta.cpuModelUrl) {
    return { id: `${meta.id}:cpu`, url: meta.cpuModelUrl };
  }
  return { id: meta.id, url: meta.modelUrl };
}

/** Both exports that may be needed when automatic GPU → CPU recovery is enabled. */
export function runtimeModelAssets(meta: {
  id: string;
  modelUrl: string;
  cpuModelUrl?: string | null;
}): {
  gpu: { id: string; url: string };
  cpu: { id: string; url: string } | null;
} {
  return {
    gpu: { id: meta.id, url: meta.modelUrl },
    cpu: meta.cpuModelUrl ? { id: `${meta.id}:cpu`, url: meta.cpuModelUrl } : null,
  };
}


export function describeEngine(engine: string): string {
  if (engine === "webgpu") return "WebGPU (GPU)";
  if (engine === "wasm") return "CPU (WASM)";
  return engine;
}
