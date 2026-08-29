// Application-level model ownership.
//
// The selected model, its metadata, and the warm ONNX session live here — for
// the whole application lifetime, not per page. Pages read this context; they
// never own the model. The underlying warm cache (provider-cache) is only
// evicted when the user explicitly switches model or the tab is closed.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { listModels, type ModelMetadata } from "@/features/drowsiness/labels";
import {
  acquireProvider,
  abortCachedProvider,
  abortInitializingProvider,
  disposeCachedProvider,
  disposeUnlessModel,
  isWarm,
  releaseProvider,
} from "./provider-cache";
import { normalizeProviderId, type ProviderId } from "./registry";
import {
  cachedModelStats,
  deleteCachedKey,
  modelCacheKey,
  orphanedStats,
} from "./model-store";
import {
  isConstrainedDevice,
  readEnginePreference,
  writeEnginePreference,
  type EnginePreference,
} from "./engine-preference";

import {
  checkModelCompatibility,
  readDeviceMemoryGb,
  type CompatibilityReport,
} from "./model-compatibility";
import { liveProviderConfig, resolveLivePreset } from "./live-config";
import { clearLastGoodEngine, writeLastGoodEngine } from "./engine-memory";
import {
  parseEngineAttempts,
  readEngineAttempts,
  setEngineAttempts,
  type EngineAttempt,
} from "./engine-attempts";
import {
  recordStartupError,
  recordStartupStage,
  resetStartupLog,
} from "./startup-log";
import { warmUpProvider } from "./warmup";
import { verifyModel, type ModelVerification } from "./model-verify";
import type { InferenceProvider, ProviderConfig } from "./types";
import { useUserSettings, CLIENT_DEFAULTS } from "@/hooks/use-user-settings";
import { errorMessage } from "@/lib/format-error";
import { emptyModelTrace, type ModelLoadTrace } from "@/features/session/pipeline-trace";
import { writeAutoSwitchPreference } from "@/features/session/live-preferences";

const STORAGE_KEY = "sentryeye.selected-model";
/**
 * Live view cap. A face contributes at most two eyes and one mouth, so a
 * healthy frame stays well under this; the cap only bounds a degenerate flood.
 */
const MAX_LIVE_DETECTIONS = 12;

export type WarmupStatus = "idle" | "loading" | "ready" | "error";

export interface WarmupState {
  status: WarmupStatus;
  /** Last stage emitted by the provider/worker (download, session create, …). */
  stage: string | null;
  /** 0..1 while the model file is downloading, otherwise null. */
  progress: number | null;
  /** Bytes downloaded so far / total, when the server reports a length. */
  receivedBytes: number | null;
  totalBytes: number | null;
  /** Latency of the first synthetic warm-up frame (kernel compile cost, ms). */
  firstFrameMs: number | null;
  /** Latency once kernels are compiled (ms) — the steady-state estimate. */
  steadyFrameMs: number | null;
  error: string | null;
  /** Epoch ms when the current prepare attempt began (null when idle/ready). */
  startedAt: number | null;
}

/** Hard ceiling for one prepare attempt; past this the UI must not keep spinning. */
export const PREPARE_TIMEOUT_MS = 90_000;

/** Bound a step that a device driver may never settle. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}


export interface ModelContextValue {
  models: ModelMetadata[];
  selected: ModelMetadata | null;
  selectedId: string | null;
  select: (id: string) => void;
  isLoading: boolean;
  error: Error | null;
  warmup: WarmupState;
  /** True when the warm cache already holds this model's compiled session. */
  warm: boolean;
  retryWarmup: () => void;
  /** Terminate the worker, clear the runtime cache and prepare from scratch. */
  hardRetry: () => void;
  /**
   * Abort the current attempt and retry pinned to CPU (WASM). The escape hatch
   * for phones whose GPU driver stalls during model preparation.
   */
  useCpuMode: () => void;
  /** Current engine preference ("auto" | "webgpu" | "wasm"), read after mount. */
  enginePreference: EnginePreference;
  providerId: ProviderId;

  /** True when a saved model id no longer exists and a default was used. */
  savedModelMissing: boolean;
  /** Phone/tablet-class device, resolved after hydration. */
  constrained: boolean;
  /** navigator.deviceMemory in GB, resolved after hydration (null if unreported). */
  deviceMemoryGb: number | null;
  /** Pre-start compatibility report for the selected model. */
  compatibility: CompatibilityReport;
  /** Compatibility report for any registry model, using this device's profile. */
  compatibilityFor: (model: ModelMetadata) => CompatibilityReport;
  /** Per-execution-provider attempt ledger from the last worker init. */
  engineAttempts: EngineAttempt[];
  /**
   * Last-resort recovery: pin CPU/WASM single-threaded and switch to the
   * lightest compatible model before preparing again.
   */
  useSafeMode: () => void;
  /** Quick real-output check of the warmed model; null while it has not run. */
  verification: ModelVerification | null;
  /** Re-run the quick check against the warm session (e.g. on live page open). */
  reverify: () => Promise<ModelVerification | null>;
  /** Resolve the shared, already-warm provider (awaits preload if in flight). */
  ensureProvider: () => Promise<InferenceProvider>;
  /**
   * How the currently loaded model was obtained: cache hit or cold fetch, plus
   * the wall-clock cost of each step. Sessions copy this into their trace so
   * History can show why a run started fast or slow.
   */
  loadTrace: ModelLoadTrace | null;
}

const ModelCtx = createContext<ModelContextValue | null>(null);

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Device-aware default.
 *
 * The 960px model has the best closed-eye (microsleep) accuracy and is the
 * desktop pick. The 480px model is a separate native training run, not a
 * re-export, and costs ~4x less compute per frame — the difference between a
 * usable live stream and a stuttering one on a phone. It gives up 2.3 points of
 * closed-eye AP for that, which is the right trade when the alternative is a
 * frame-starved pipeline that misses the event entirely. The user can still
 * pick any registry model manually.
 */
export function pickDefaultModel(
  models: ModelMetadata[],
  constrained = false,
): ModelMetadata | null {
  if (!models.length) return null;
  const byBestFor = (...wanted: string[]) =>
    models.find((m) => m.bestFor != null && wanted.includes(m.bestFor));
  const smallest = [...models].sort((a, b) => a.imgsz - b.imgsz)[0];
  const largest = [...models].sort((a, b) => b.imgsz - a.imgsz)[0];
  if (constrained) return byBestFor("default", "mobile") ?? smallest ?? models[0];
  return byBestFor("high-quality", "desktop") ?? largest ?? models[0];
}


/** Provider config derived purely from registry metadata + client thresholds. */
export function providerConfigFromModel(meta: ModelMetadata): ProviderConfig {
  return {
    modelId: meta.id,
    modelUrl: meta.modelUrl,
    ...(meta.cpuModelUrl ? { cpuModelUrl: meta.cpuModelUrl } : {}),
    imgsz: meta.imgsz,
    labels: meta.labels,
    semanticMap: meta.semanticMap,
    confThreshold: CLIENT_DEFAULTS.confThreshold,
    iouThreshold: CLIENT_DEFAULTS.iouThreshold,
    maxDetections: Math.min(meta.postprocessConfig.maxDetections, MAX_LIVE_DETECTIONS),
    modelName: meta.modelName,
    modelVersion: meta.version,
    headFormat: meta.headFormat,
    classIdOffset: meta.postprocessConfig.classIdOffset,
    resize: meta.postprocessConfig.resize,
    normalize: meta.postprocessConfig.normalize,
    ...(meta.postprocessConfig.classThresholds
      ? { classThresholds: meta.postprocessConfig.classThresholds }
      : {}),
  };
}

const IDLE_WARMUP: WarmupState = {
  status: "idle",
  stage: null,
  progress: null,
  receivedBytes: null,
  totalBytes: null,
  firstFrameMs: null,
  steadyFrameMs: null,
  error: null,
  startedAt: null,
};


export function ModelProvider({ children }: { children: ReactNode }) {
  const { settings, update } = useUserSettings();
  const providerId = normalizeProviderId(settings?.inference_provider ?? null);

  const [selectedId, setSelectedId] = useState<string | null>(() => readStored());
  const [warmup, setWarmup] = useState<WarmupState>(IDLE_WARMUP);
  const [verification, setVerification] = useState<ModelVerification | null>(null);
  const [engineAttempts, setEngineAttemptsState] = useState<EngineAttempt[]>([]);
  useEffect(() => {
    setEngineAttemptsState(readEngineAttempts());
  }, []);
  const [nonce, setNonce] = useState(0);
  // Read after hydration so the server and the first client render agree.
  const [constrained, setConstrained] = useState(false);
  const [deviceMemoryGb, setDeviceMemoryGb] = useState<number | null>(null);
  useEffect(() => {
    setConstrained(isConstrainedDevice(navigator as never));
    setDeviceMemoryGb(readDeviceMemoryGb());
  }, []);
  const warmKeyRef = useRef<string | null>(null);
  // Load accounting for the model currently being prepared. Rebuilt per model.
  const [loadTrace, setLoadTrace] = useState<ModelLoadTrace | null>(null);
  const loadRef = useRef<{ startedAt: number; fetchStartedAt: number; trace: ModelLoadTrace } | null>(
    null,
  );
  const inFlightRef = useRef<Promise<InferenceProvider> | null>(null);
  const cpuRecoveryRef = useRef<string | null>(null);
  const stepDownRef = useRef<string | null>(null);

  const query = useQuery<ModelMetadata[]>({
    queryKey: ["model_registry", "active"],
    queryFn: listModels,
    staleTime: 5 * 60_000,
  });

  const models = useMemo(() => query.data ?? [], [query.data]);

  // Old exports (e.g. the retired fp16 halves) keep occupying phone storage and
  // can be picked up by a stale cache hit. Once the registry is known, delete
  // every stored file no live model points at.
  const purgedRef = useRef(false);
  useEffect(() => {
    if (purgedRef.current || models.length === 0) return;
    purgedRef.current = true;
    void (async () => {
      try {
        const live = new Set<string>();
        for (const m of models) {
          live.add(modelCacheKey(m.id, m.modelUrl));
          if (m.cpuModelUrl) live.add(modelCacheKey(`${m.id}:cpu`, m.cpuModelUrl));
        }
        const stale = orphanedStats(await cachedModelStats(), live);
        for (const s of stale) await deleteCachedKey(s.key);
      } catch {
        /* cache cleanup is best-effort */
      }
    })();
  }, [models]);

  // Account-level preference wins on a fresh device; the local pick keeps
  // working for visitors and while settings are still loading.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    const saved = settings?.selected_model_id;
    if (!saved) return;
    hydratedRef.current = true;
    if (!selectedId) setSelectedId(saved);
  }, [settings?.selected_model_id, selectedId]);

  const selected = useMemo(() => {
    const chosen = models.find((m) => m.id === selectedId);
    if (chosen) return chosen;
    // Never default to a model this device cannot hold in memory.
    const runnable = models.filter(
      (m) => checkModelCompatibility(m, { constrained, memoryGb: deviceMemoryGb }).ok,
    );
    return pickDefaultModel(runnable.length ? runnable : models, constrained);
  }, [models, selectedId, constrained, deviceMemoryGb]);

  const savedModelMissing =
    !!selectedId && models.length > 0 && !models.some((m) => m.id === selectedId);

  const compatibilityFor = useCallback(
    (model: ModelMetadata) =>
      checkModelCompatibility(model, { constrained, memoryGb: deviceMemoryGb }),
    [constrained, deviceMemoryGb],
  );

  const compatibility = useMemo(
    () => checkModelCompatibility(selected, { constrained, memoryGb: deviceMemoryGb }),
    [selected, constrained, deviceMemoryGb],
  );

  // Background preload (Bug 2): the moment a model resolves, warm it up.
  // Re-runs only when the model id or the inference provider actually changes.
  useEffect(() => {
    if (!selected) return;
    const key = `${providerId}:${selected.id}`;
    if (warmKeyRef.current === key) return;
    warmKeyRef.current = key;

    let cancelled = false;
    resetStartupLog(selected.modelName);
    recordStartupStage("prepare-start", {
      model: selected.id,
      imgsz: selected.imgsz,
      provider: providerId,
    });
    setWarmup({
      ...IDLE_WARMUP,
      status: "loading",
      stage: "preloading",
      startedAt: Date.now(),
    });
    setVerification(null);
    // Nothing below is guaranteed to settle on a broken mobile driver, so the
    // whole attempt is bounded: past this point the UI shows an error with a
    // retry instead of a Start button that stays disabled forever.
    const watchdog = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      warmKeyRef.current = null;
      inFlightRef.current = null;
      recordStartupError(
        `Preparing timed out after ${Math.round(PREPARE_TIMEOUT_MS / 1000)}s`,
        "watchdog",
      );
      void abortCachedProvider();
      setWarmup((w) =>
        w.status === "loading"
          ? {
              ...IDLE_WARMUP,
              status: "error",
              stage: "timeout",
              error: `Preparing ${selected.modelName} took too long on this device (stopped at "${
                w.stage ?? "start"
              }"). Try again, or switch to CPU mode / a lighter model.`,
            }
          : w,
      );
    }, PREPARE_TIMEOUT_MS);

    const t0 = performance.now();
    loadRef.current = {
      startedAt: t0,
      fetchStartedAt: t0,
      trace: {
        ...emptyModelTrace(),
        modelId: selected.id,
        modelName: selected.modelName,
      },
    };
    setLoadTrace(null);

    const promise = acquireProvider(
      providerId,
      liveProviderConfig(selected, resolveLivePreset().preset),
      {
        onStage: (stage, detail) => {
          if (cancelled) return;
          // Download progress fires many times a second; everything else is a
          // real milestone worth a timestamped line in the startup log.
          if (stage !== "model-download-progress") recordStartupStage(stage, detail);
          if (stage === "engine-attempts") {
            const ledger = parseEngineAttempts(detail?.["attempts"]);
            setEngineAttempts(ledger);
            setEngineAttemptsState(ledger);
          }
          const load = loadRef.current;
          if (load) {
            const now = performance.now();
            if (stage === "model-cache-hit") {
              load.trace.cache = "hit";
              load.trace.bytes = Number(detail?.["bytes"] ?? 0) || null;
              load.trace.fetchMs = Math.round(now - load.fetchStartedAt);
            } else if (stage === "model-cache-miss") {
              load.trace.cache = "miss";
            } else if (stage === "model-download-done") {
              load.trace.bytes = Number(detail?.["bytes"] ?? 0) || load.trace.bytes;
              load.trace.fetchMs = Math.round(now - load.fetchStartedAt);
            } else if (stage === "session-create-done") {
              const fetched = load.trace.fetchMs ?? 0;
              load.trace.sessionMs = Math.round(now - load.startedAt - fetched);
              load.trace.engine = (detail?.["engine"] as string | undefined) ?? load.trace.engine;
            }
          }
          setWarmup((w) => {
            let progress = w.progress;
            let receivedBytes = w.receivedBytes;
            let totalBytes = w.totalBytes;
            if (stage === "model-download-progress" && detail) {
              const received = Number(detail["received"] ?? 0);
              const total = Number(detail["total"] ?? 0);
              receivedBytes = received || null;
              totalBytes = total || null;
              progress = total > 0 ? Math.min(1, received / total) : null;
            }
            if (stage === "model-download-done") progress = 1;
            return { ...w, stage, progress, receivedBytes, totalBytes };
          });
        },
      },
    );
    inFlightRef.current = promise;

    promise
      .then(async (provider) => {
        // Session created — now pay the shader/kernel compilation cost on a
        // synthetic frame so the first real camera frame is already fast.
        if (!cancelled) {
          setWarmup((w) => ({ ...w, stage: "compiling-kernels", progress: null }));
        }
        const warmStart = performance.now();
        const timing = await withTimeout(
          warmUpProvider(provider, selected.imgsz),
          20_000,
          "Kernel warm-up",
        ).catch(() => null);
        // Quick verification: does this model actually behave on this device?
        if (!cancelled) {
          setWarmup((w) => ({ ...w, stage: "verifying-model" }));
        }
        const verdict = await withTimeout(
          verifyModel(provider, selected.imgsz),
          15_000,
          "Model check",
        ).catch(() => null);
        if (!cancelled && verdict) setVerification(verdict);
        const load = loadRef.current;
        if (load) {
          load.trace.warmupMs = Math.round(performance.now() - warmStart);
          load.trace.totalMs = Math.round(performance.now() - load.startedAt);
          load.trace.engine = provider.status().engine ?? load.trace.engine;
          setLoadTrace({ ...load.trace });
        }
        // Preloading must not hold the session open — just keep it warm.
        releaseProvider(provider);
        if (inFlightRef.current === promise) inFlightRef.current = null;
        writeLastGoodEngine(provider.status().engine);
        recordStartupStage("ready", { engine: provider.status().engine });
        if (!cancelled) {
          clearTimeout(watchdog);
          setWarmup({
            ...IDLE_WARMUP,
            status: "ready",
            stage: "ready",
            firstFrameMs: timing?.firstFrameMs ?? null,
            steadyFrameMs: timing?.steadyFrameMs ?? null,
          });
        }
        return provider;
      })
      .catch((err) => {
        if (warmKeyRef.current === key) warmKeyRef.current = null;
        if (inFlightRef.current === promise) inFlightRef.current = null;
        recordStartupError(errorMessage(err), "prepare");
        // Whatever engine this attempt used is not trustworthy on this device.
        clearLastGoodEngine();
        if (!cancelled) {
          clearTimeout(watchdog);
          // A weak Android GPU gets one automatic, fresh CPU attempt. Persist
          // the working engine on this device so the next visit starts quickly.
          if (
            constrained &&
            readEnginePreference() !== "wasm" &&
            cpuRecoveryRef.current !== selected.id
          ) {
            cpuRecoveryRef.current = selected.id;
            writeEnginePreference("wasm");
            setEnginePreference("wasm");
            setWarmup((w) => ({ ...w, stage: "switching-to-cpu", error: null }));
            void abortCachedProvider().finally(() => setNonce((n) => n + 1));
            return;
          }
          // The heavy model can simply be too much for an unknown device (a
          // brand-new browser profile has no cached session and no measured
          // history). Step down to the lightest model this device can hold
          // instead of leaving the driver stuck on "failed to load".
          const lighter = models
            .filter(
              (m) =>
                m.id !== selected.id &&
                m.imgsz < selected.imgsz &&
                checkModelCompatibility(m, { constrained, memoryGb: deviceMemoryGb }).ok,
            )
            .sort((a, b) => a.imgsz - b.imgsz)[0];
          if (lighter && stepDownRef.current !== selected.id) {
            stepDownRef.current = selected.id;
            recordStartupStage("model-step-down", { from: selected.id, to: lighter.id });
            toast.warning(`${selected.modelName} could not start on this device`, {
              description: `Switched to ${lighter.modelName}, which fits this hardware. You can pick the heavier model again from the model list.`,
            });
            setWarmup({
              ...IDLE_WARMUP,
              status: "loading",
              stage: "switching-model",
              startedAt: Date.now(),
            });
            setSelectedId(lighter.id);
            try {
              window.localStorage.setItem(STORAGE_KEY, lighter.id);
            } catch {
              /* storage unavailable — selection stays in memory */
            }
            void abortCachedProvider();
            return;
          }
          setWarmup({
            ...IDLE_WARMUP,
            status: "error",
            stage: "error",
            error: errorMessage(err),
          });

        }
      });

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, [selected, providerId, nonce, constrained]);


  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      hydratedRef.current = true;
      try {
        window.localStorage.setItem(STORAGE_KEY, id);
      } catch {
        /* storage unavailable — selection stays in memory */
      }
      // A deliberate choice ends automatic model switching: the driver asked
      // for THIS model, so the app must not quietly step down to another one.
      writeAutoSwitchPreference(false);
      // Persist per user so the next session starts on the same model.
      void update({ selected_model_id: id }).catch(() => {
        /* visitor / offline — local preference still applies */
      });
      // Explicit model change is the only path that evicts the warm session.
      void abortInitializingProvider().then(() => disposeUnlessModel(id));
    },
    [update],
  );

  const retryWarmup = useCallback(() => {
    void abortCachedProvider().finally(() => {
      inFlightRef.current = null;
      warmKeyRef.current = null;
      setVerification(null);
      setNonce((n) => n + 1);
    });
  }, []);

  /**
   * Full restart: terminate the worker, drop the compiled-session cache and the
   * remembered engine, then prepare from scratch. This is the one-tap recovery
   * for an Android boot that wedged inside a broken runtime.
   */
  const hardRetry = useCallback(() => {
    resetStartupLog("hard retry");
    recordStartupStage("hard-retry");
    clearLastGoodEngine();
    cpuRecoveryRef.current = null;
    stepDownRef.current = null;
    void abortCachedProvider().finally(() => {
      inFlightRef.current = null;
      warmKeyRef.current = null;
      loadRef.current = null;
      setLoadTrace(null);
      setVerification(null);
      setWarmup({ ...IDLE_WARMUP, status: "loading", stage: "restarting", startedAt: Date.now() });
      setNonce((n) => n + 1);
    });
  }, []);

  const [enginePreference, setEnginePreference] =
    useState<EnginePreference>("auto");
  useEffect(() => {
    setEnginePreference(readEnginePreference());
  }, []);

  /**
   * Escape hatch for a stalled GPU driver: pin the runtime to CPU/WASM, throw
   * away whatever half-created session exists and prepare again.
   */
  const useCpuMode = useCallback(() => {
    writeEnginePreference("wasm");
    setEnginePreference("wasm");
    void disposeCachedProvider().finally(() => {
      inFlightRef.current = null;
      warmKeyRef.current = null;
      setVerification(null);
      setNonce((n) => n + 1);
    });
  }, []);

  /**
   * Safe mode: the combination that works on the weakest hardware — CPU/WASM
   * only, plus the lightest model that passes this device's compatibility
   * checks (which on a phone means the 480px fp32 export).
   */
  const useSafeMode = useCallback(() => {
    resetStartupLog("safe mode");
    recordStartupStage("safe-mode-requested");
    writeEnginePreference("wasm");
    setEnginePreference("wasm");
    clearLastGoodEngine();
    cpuRecoveryRef.current = null;
    stepDownRef.current = null;
    const lightest = [...models]
      .filter((m) => compatibilityFor(m).ok)
      .sort((a, b) => a.imgsz - b.imgsz)[0];
    if (lightest && lightest.id !== selected?.id) {
      select(lightest.id);
      return;
    }
    void disposeCachedProvider().finally(() => {
      inFlightRef.current = null;
      warmKeyRef.current = null;
      setVerification(null);
      setNonce((n) => n + 1);
    });
  }, [models, compatibilityFor, selected?.id, select]);



  const ensureProvider = useCallback(async () => {
    if (!selected) throw new Error("No active model is registered");
    const provider = inFlightRef.current
      ? await inFlightRef.current.catch(() => null)
      : null;
    if (provider && isWarm(providerId, selected.id)) return provider;
    return acquireProvider(providerId, providerConfigFromModel(selected));
  }, [selected, providerId]);

  /**
   * Re-run the quick sanity check against the already warm session. Cheap
   * (two synthetic frames) and re-run whenever the live page is opened, so a
   * device that has since heated up or lost its GPU context is caught before
   * the camera starts rather than after a bad run.
   */
  const reverify = useCallback(async () => {
    if (!selected) return null;
    try {
      const provider = await ensureProvider();
      const verdict = await verifyModel(provider, selected.imgsz);
      releaseProvider(provider);
      setVerification(verdict);
      return verdict;
    } catch {
      return null;
    }
  }, [selected, ensureProvider]);

  const value = useMemo<ModelContextValue>(
    () => ({
      models,
      selected,
      selectedId: selected?.id ?? null,
      select,
      isLoading: query.isLoading,
      error: (query.error as Error | null) ?? null,
      warmup,
      warm: selected ? isWarm(providerId, selected.id) : false,
      retryWarmup,
      hardRetry,
      useCpuMode,
      enginePreference,
      providerId,
      loadTrace,
      savedModelMissing,
      constrained,
      deviceMemoryGb,
      compatibility,
      compatibilityFor,
      engineAttempts,
      useSafeMode,
      verification,
      reverify,
      ensureProvider,
    }),
    [
      models,
      selected,
      select,
      query.isLoading,
      query.error,
      warmup,
      providerId,
      retryWarmup,
      hardRetry,
      useCpuMode,
      enginePreference,
      loadTrace,
      savedModelMissing,
      constrained,
      compatibility,
      engineAttempts,
      verification,
      reverify,
      ensureProvider,
    ],
  );


  return <ModelCtx.Provider value={value}>{children}</ModelCtx.Provider>;
}

export function useModelContext(): ModelContextValue {
  const ctx = useContext(ModelCtx);
  if (!ctx) throw new Error("useModelContext must be used inside <ModelProvider>");
  return ctx;
}
