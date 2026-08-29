// System health probes. Every value is read from a real source (browser API,
// provider cache, database) — nothing here is synthesised.

import { supabase } from "@/integrations/supabase/client";
import { cacheStatus } from "@/features/inference/provider-cache";

export type HealthState = "ok" | "warn" | "error" | "idle" | "unknown";

export interface HealthItem {
  key: string;
  label: string;
  state: HealthState;
  value: string;
  detail?: string;
}

export interface BrowserCapabilities {
  webgpu: boolean;
  webassembly: boolean;
  simd: boolean;
  sharedArrayBuffer: boolean;
  webWorker: boolean;
  offscreenCanvas: boolean;
  mediaDevices: boolean;
  requestVideoFrameCallback: boolean;
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  userAgent: string;
}

/** Feature-detects WASM SIMD support by validating a tiny SIMD module. */
function detectSimd(): boolean {
  try {
    // (module (func (result v128) (v128.const i32x4 0 0 0 0)))
    const bytes = new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0,
      65, 0, 253, 15, 253, 98, 11,
    ]);
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

export function readBrowserCapabilities(): BrowserCapabilities {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return {
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    webassembly: typeof WebAssembly !== "undefined",
    simd: typeof WebAssembly !== "undefined" && detectSimd(),
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    webWorker: typeof Worker !== "undefined",
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    mediaDevices: !!nav?.mediaDevices?.getUserMedia,
    requestVideoFrameCallback:
      typeof HTMLVideoElement !== "undefined" &&
      "requestVideoFrameCallback" in HTMLVideoElement.prototype,
    hardwareConcurrency: nav?.hardwareConcurrency ?? null,
    deviceMemoryGb:
      typeof (nav as unknown as { deviceMemory?: number })?.deviceMemory === "number"
        ? (nav as unknown as { deviceMemory: number }).deviceMemory
        : null,
    userAgent: nav?.userAgent ?? "unknown",
  };
}

export interface BackendHealth {
  database: { state: HealthState; value: string; detail?: string; latencyMs: number | null };
  storage: { state: HealthState; value: string; detail?: string };
  lastAnalysis: {
    state: HealthState;
    value: string;
    detail?: string;
    sessionId: string | null;
    at: string | null;
  };
}

/** Round-trips a cheap authenticated read to prove the database is reachable. */
export async function probeDatabase(): Promise<BackendHealth["database"]> {
  const started = performance.now();
  try {
    const { error } = await supabase
      .from("model_registry")
      .select("id", { count: "exact", head: true })
      .limit(1);
    const latencyMs = Math.round(performance.now() - started);
    if (error) {
      return { state: "error", value: "Unreachable", detail: error.message, latencyMs };
    }
    return {
      state: latencyMs > 1500 ? "warn" : "ok",
      value: "Connected",
      detail: `round-trip ${latencyMs} ms`,
      latencyMs,
    };
  } catch (err) {
    return {
      state: "error",
      value: "Unreachable",
      detail: err instanceof Error ? err.message : String(err),
      latencyMs: null,
    };
  }
}

/** Lists a single object to confirm the private model bucket answers. */
export async function probeStorage(): Promise<BackendHealth["storage"]> {
  try {
    const { error } = await supabase.storage.from("models").list("", { limit: 1 });
    if (error) {
      return { state: "warn", value: "Restricted", detail: error.message };
    }
    return { state: "ok", value: "Reachable", detail: "bucket: models (private)" };
  } catch (err) {
    return {
      state: "error",
      value: "Unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probeLastAnalysis(
  userId: string | undefined,
): Promise<BackendHealth["lastAnalysis"]> {
  if (!userId) {
    return { state: "unknown", value: "—", sessionId: null, at: null };
  }
  try {
    const { data, error } = await supabase
      .from("sessions")
      .select("id,ended_at,started_at,status,analysed_frames")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return {
        state: "error",
        value: "Unavailable",
        detail: error.message,
        sessionId: null,
        at: null,
      };
    }
    if (!data) {
      return {
        state: "idle",
        value: "No completed analysis yet",
        sessionId: null,
        at: null,
      };
    }
    const at = data.ended_at ?? data.started_at;
    return {
      state: "ok",
      value: new Date(at).toLocaleString(),
      detail: `${data.analysed_frames} frames analysed`,
      sessionId: data.id,
      at,
    };
  } catch (err) {
    return {
      state: "error",
      value: "Unavailable",
      detail: err instanceof Error ? err.message : String(err),
      sessionId: null,
      at: null,
    };
  }
}

/** Warm-cache view of the inference engine, read straight from provider-cache. */
export function readEngineStatus() {
  const cache = cacheStatus();
  return {
    warm: cache.warm,
    providerId: cache.providerId,
    modelId: cache.modelId,
    inUse: cache.inUse,
    engine: cache.engine,
  };
}
