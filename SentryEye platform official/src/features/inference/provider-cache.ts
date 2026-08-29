// Warm provider cache. Keeps the worker + ONNX session alive between runs so a
// model is downloaded and compiled exactly once per (provider, model) pair.
// Sessions acquire/release; only a model switch or page unload disposes.

import { createProvider } from "./registry";
import type { InferenceProvider, InitOptions, ProviderConfig } from "./types";

interface Entry {
  key: string;
  modelId: string;
  provider: InferenceProvider;
  ready: Promise<void>;
  config: ProviderConfig;
  inUse: boolean;
  state: "initializing" | "ready" | "failed";
}

let entry: Entry | null = null;
/** Providers evicted while a session still held them; disposed on release. */
const orphaned = new Set<InferenceProvider>();

function keyOf(providerId: string, modelId: string) {
  return `${providerId}:${modelId}`;
}

/** True when a warm provider for this pair already exists (no download needed). */
export function isWarm(providerId: string, modelId: string): boolean {
  return entry?.key === keyOf(providerId, modelId) && entry.state === "ready";
}

/**
 * Model switch: unload the cached model unless it is the one being switched to.
 * A session that still owns the provider keeps it; the next acquire evicts it.
 */
export async function disposeUnlessModel(modelId: string): Promise<void> {
  if (!entry || entry.modelId === modelId || entry.inUse) return;
  await disposeCachedProvider();
}

/**
 * Return a ready provider for the given config, reusing the warm one when the
 * provider id and model id match. Thresholds are applied without a reload.
 */
export async function acquireProvider(
  providerId: string,
  cfg: ProviderConfig,
  opts?: InitOptions,
): Promise<InferenceProvider> {
  const key = keyOf(providerId, cfg.modelId);

  if (entry && entry.key === key && entry.state !== "failed") {
    opts?.onStage?.("provider-cache-hit", { key });
    await entry.ready;
    entry.inUse = true;
    entry.provider.reconfigure({
      confThreshold: cfg.confThreshold,
      iouThreshold: cfg.iouThreshold,
      maxDetections: cfg.maxDetections,
    });
    entry.config = { ...entry.config, ...cfg };
    opts?.onStage?.("provider-ready", { engine: entry.provider.status().engine, cached: true });
    return entry.provider;
  }

  if (entry) {
    opts?.onStage?.("provider-cache-evict", { previous: entry.key, next: key });
    if (entry.inUse) {
      // A live session still owns this worker. Tearing it down mid-flight kills
      // the running run and leaves the overlay frozen on the old model's boxes,
      // so orphan it and dispose only once the session releases it.
      orphaned.add(entry.provider);
      entry = null;
    } else {
      await disposeCachedProvider();
    }
  }

  opts?.onStage?.("provider-cache-miss", { key });
  const provider = createProvider(providerId);
  const ready = provider.init(cfg, opts);
  const next: Entry = {
    key,
    modelId: cfg.modelId,
    provider,
    ready,
    config: cfg,
    inUse: true,
    state: "initializing",
  };
  entry = next;
  try {
    await ready;
    if (entry === next) next.state = "ready";
  } catch (err) {
    next.state = "failed";
    if (entry === next) entry = null;
    await provider.dispose().catch(() => {});
    throw err;
  }
  return provider;
}

/** Session finished — keep the provider warm, just mark it free. */
export function releaseProvider(provider: InferenceProvider | null) {
  if (!provider) return;
  if (entry && provider === entry.provider) {
    entry.inUse = false;
    return;
  }
  // Released a provider that was already replaced by a model switch.
  if (orphaned.delete(provider)) void provider.dispose().catch(() => {});
}

/** Hard teardown: terminates the worker and releases the ONNX session. */
export async function disposeCachedProvider(): Promise<void> {
  const current = entry;
  entry = null;
  if (!current) return;
  try {
    await current.provider.dispose();
  } catch (err) {
    console.warn("[provider-cache] dispose failed", err);
  }
}

/** Cancel initialization too; unlike model switching this never preserves an in-use entry. */
export async function abortCachedProvider(): Promise<void> {
  await disposeCachedProvider();
}

/** Cancel only a half-started provider; safe to call from model selection. */
export async function abortInitializingProvider(): Promise<void> {
  if (entry?.state === "initializing") await disposeCachedProvider();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void disposeCachedProvider();
  });
}

/** Read-only snapshot of the warm cache for system-health reporting. */
export function cacheStatus(): {
  warm: boolean;
  providerId: string | null;
  modelId: string | null;
  inUse: boolean;
  engine: string | null;
} {
  if (!entry) {
    return { warm: false, providerId: null, modelId: null, inUse: false, engine: null };
  }
  let engine: string | null = null;
  try {
    engine = entry.provider.status().engine ?? null;
  } catch {
    engine = null;
  }
  return {
    warm: true,
    providerId: entry.key.split(":")[0] ?? null,
    modelId: entry.modelId,
    inUse: entry.inUse,
    engine,
  };
}
