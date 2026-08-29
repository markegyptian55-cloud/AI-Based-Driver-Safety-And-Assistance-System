// Web worker: owns the ORT session, runs preprocess + inference + postprocess
// off the main thread. Communicates via structured messages.

import type * as Ort from "onnxruntime-web";
// Loader glue is bundled by Vite (small); the multi-megabyte binaries live on
// the app's own CDN path. Both are same-origin, which is what cross-origin
// isolation — and therefore threaded WASM — requires.
import ortMjsUrl from "./ort/ort-wasm-simd-threaded.mjs?url";
// onnxruntime-web >= 1.23 ships the WebGPU EP in the *asyncify* build; the
// legacy jsep pair does not export `webgpuInit`, which is what made every
// WebGPU session-create fail with "no available backend found".
import ortAsyncifyMjsUrl from "./ort/ort-wasm-simd-threaded.asyncify.mjs?url";

import ortWasm from "../../../public/ort/ort-wasm-simd-threaded.wasm.asset.json";
import ortAsyncifyWasm from "../../../public/ort/ort-wasm-simd-threaded.asyncify.wasm.asset.json";



import { preprocessFrame } from "./preprocess";
import { GpuPreprocessor, sampleLuma } from "./gpu-preprocess";

import {
  decodeOutputs,
  emptyYawnProbe,
  inspectDetections,
  inspectTensor,
  type DecodeConfig,
  type RawOutput,
} from "./postprocess";

import { isConstrainedDevice, planExecutionProviders } from "./engine-preference";
import { currentPerformanceProfile } from "./performance-mode";

type OrtModule = typeof Ort;

/** Cost-only tuning (threads, NMS intake) for this device class. */
const perfProfile = currentPerformanceProfile();
import { modelCacheKey, readCachedModel, writeCachedModel } from "./model-store";
import type { Detection, ProviderConfig, TunableConfig, YawnProbeFrame } from "./types";

type InitMsg = { type: "init"; cfg: ProviderConfig };
type InferMsg = { type: "infer"; id: number; ts: number; frame: ImageBitmap };
type ConfigureMsg = { type: "configure"; cfg: TunableConfig };
type DisposeMsg = { type: "dispose" };
type InMsg = InitMsg | InferMsg | ConfigureMsg | DisposeMsg;

type StageResp = { type: "stage"; stage: string; detail?: Record<string, unknown> };
type InitResp = {
  type: "ready";
  engine: string;
  /** Measured post-warm-up session.run() cost, median of the boot benchmark. */
  benchmarkMs?: number;
  /** Whether preprocessing runs on the GPU (zero-copy) or on the CPU. */
  preprocess?: "gpu" | "cpu";
};

type InferResp = {
  type: "result";
  id: number;
  ts: number;
  detections: Detection[];
  providerLatencyMs: number;
  engine: string;
  /** True when this frame's raw output failed the sanity guard and was dropped. */
  degenerate: boolean;
  /** Running count of frames dropped by the sanity guard. */
  rejectedFrames: number;
  /** Mean scene luma (0..1) of the frame before gain. */
  luma: number;
  /** Auto-gain multiplier applied to this frame. */
  gain: number;
  /** Resize + normalize cost for this frame (ms). */
  preprocessMs: number;
  /** Pure session.run() cost for this frame (ms). */
  inferMs: number;
  /** Decode + NMS + sanity-guard cost for this frame (ms). */
  postprocessMs: number;
  /** Class-2 instrumentation for this frame (only when probing is enabled). */
  yawnProbe?: YawnProbeFrame;
};

type ErrResp = { type: "error"; id?: number; message: string; stack?: string };

let ort: OrtModule | null = null;
let session: Ort.InferenceSession | null = null;
let cfg: ProviderConfig | null = null;
let decodeCfg: DecodeConfig | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let engine = "wasm";
let rejectedFrames = 0;
// Smoothed scene brightness drives auto-gain; a per-frame gain would pump.
let lumaEma: number | null = null;
// Reused across frames: a 960x960 NCHW tensor is ~11 MB, and allocating one per
// frame made the worker spend more time in GC than in the model.
let inputBuffer: Float32Array | null = null;
let inputTensor: Ort.Tensor | null = null;
// GPU-resident preprocessing. When ORT runs on WebGPU we own a compute shader
// that writes the NCHW tensor straight into a GPUBuffer ORT already sees, so a
// frame never crosses the CPU boundary: no getImageData, no JS pixel loop, no
// upload. This is the difference between ~350 ms and tens of ms at 960 px.
let gpuPre: GpuPreprocessor | null = null;
let gpuTensor: Ort.Tensor | null = null;
let lumaCanvas: OffscreenCanvas | null = null;
let lumaCtx: OffscreenCanvasRenderingContext2D | null = null;


/** WASM SIMD support — ORT no longer ships a non-SIMD binary, so this is fatal. */
function hasWasmSimd(): boolean {
  try {
    // Minimal module containing a v128 (SIMD) instruction.
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
}

/** Facts a weak-device report needs; also posted as a stage for diagnostics. */
function environmentFacts(): Record<string, unknown> {
  const g = globalThis as unknown as {
    crossOriginIsolated?: boolean;
    navigator?: { gpu?: unknown; deviceMemory?: number; hardwareConcurrency?: number; userAgent?: string };
  };
  return {
    crossOriginIsolated: g.crossOriginIsolated ?? null,
    hasWebGpu: !!g.navigator?.gpu,
    deviceMemoryGb: g.navigator?.deviceMemory ?? null,
    cores: g.navigator?.hardwareConcurrency ?? null,
    wasmSimd: hasWasmSimd(),
    deviceClass: perfProfile.deviceClass,
  };
}

/** Turn a raw runtime failure into a short, distinguishable cause. */
export function classifyInferenceFailure(message: string): string {
  const m = message.toLowerCase();
  if (/out of memory|oom|memory access out of bounds|aborted|allocation failed/.test(m))
    return "out-of-memory";
  if (/model download failed|failed to fetch|networkerror|404|403/.test(m))
    return "model-download-failed";
  if (/timed out/.test(m)) return "timeout";
  if (/adapter|webgpu|gpu device|device lost/.test(m)) return "webgpu-unavailable";
  if (/self-test|degenerate|noise/.test(m)) return "self-test-failed";
  if (/simd|sharedarraybuffer|wasm|magic word|compile/.test(m)) return "wasm-load-failed";
  return "unknown";
}

async function loadRuntime(wantsGpu: boolean): Promise<OrtModule> {
  stage("runtime-load-start", { runtime: wantsGpu ? "webgpu" : "wasm" });
  // This import must happen after the worker message loop is alive. Some
  // Android/Brave builds crash while evaluating ORT's combined GPU bundle;
  // loading the dedicated WASM entrypoint on a CPU retry avoids that bundle
  // entirely and lets the fallback actually start.
  const runtime = wantsGpu
    ? ((await import("onnxruntime-web/webgpu")) as OrtModule)
    : ((await import("onnxruntime-web/wasm")) as OrtModule);
  runtime.env.wasm.wasmPaths = wantsGpu
    ? { mjs: ortAsyncifyMjsUrl, wasm: ortAsyncifyWasm.url }
    : { mjs: ortMjsUrl, wasm: ortWasm.url };
  runtime.env.wasm.simd = true;
  const isolated = (globalThis as unknown as { crossOriginIsolated?: boolean })
    .crossOriginIsolated;
  // Android Chromium forks can report cross-origin isolation while rejecting
  // the nested module workers used by ORT's pthread pool. CPU recovery must be
  // the reliable path, so mobile/tablet WASM stays single-threaded; WebGPU and
  // desktop WASM retain the tuned thread budget.
  const weakDeviceCpu = !wantsGpu && perfProfile.deviceClass !== "desktop";
  runtime.env.wasm.numThreads = isolated && !weakDeviceCpu ? perfProfile.wasmThreads : 1;
  if (wantsGpu) {
    try {
      (runtime.env.webgpu as unknown as { powerPreference?: string }).powerPreference =
        "high-performance";
      (runtime.env.webgpu as unknown as { validateInputContent?: boolean }).validateInputContent =
        false;
    } catch {
      /* older runtimes ignore these options */
    }
  }
  stage("runtime-load-done", { runtime: wantsGpu ? "webgpu" : "wasm" });
  return runtime;
}



function post(msg: StageResp | InitResp | InferResp | ErrResp, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

/**
 * Bound a promise that a device driver may never settle. Android WebGPU
 * implementations can hang inside requestAdapter() or session creation with no
 * error and no rejection, which used to freeze the whole "preparing model"
 * screen forever. A timeout is treated exactly like a failure of that step, so
 * the plan falls through to the next execution provider.
 */
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


/**
 * Low-light auto-gain: brighten the frame toward the preset's target luma
 * instead of feeding the model a near-black image. Capped so noise in a truly
 * dark room is not amplified into false detections.
 */
function computeGain(): number {
  if (!cfg?.autoGain) return 1;
  const target = cfg.autoGainTargetLuma ?? 0.38;
  if (lumaEma === null || lumaEma <= 0.01) return 1;
  if (lumaEma >= target) return 1;
  return Math.min(2.5, target / lumaEma);
}

function stage(s: string, detail?: Record<string, unknown>) {
  post({ type: "stage", stage: s, detail });
}

async function downloadModel(modelId: string, url: string): Promise<Uint8Array> {
  // Disk first. Without this, "the model loads once" was only true within a
  // single warm provider: a reload, or switching away and back, re-downloaded
  // tens of megabytes and made the app feel broken on a phone connection.
  const cacheKey = modelCacheKey(modelId, url);
  const cached = await readCachedModel(cacheKey);
  if (cached) {
    stage("model-cache-hit", { bytes: cached.byteLength, modelId });
    return cached;
  }
  stage("model-cache-miss", { modelId });
  stage("model-download-start", { url });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model download failed: ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get("content-length") ?? "0");
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    stage("model-download-done", { bytes: buf.byteLength });
    await writeCachedModel(cacheKey, modelId, url, buf);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    const now = performance.now();
    if (now - lastReport > 250) {
      lastReport = now;
      stage("model-download-progress", { received, total });
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  stage("model-download-done", { bytes: merged.byteLength });
  // Cache write is best-effort and must never block the first inference.
  void writeCachedModel(cacheKey, modelId, url, merged).catch(() => {});
  return merged;
}


// Serial inference gate (see the "infer" branch for why). Waiters are handed
// the lock in FIFO order, so results still come back in submit order.
let inferChain: Promise<void> = Promise.resolve();

function acquireInferSlot(): Promise<() => void> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wait = inferChain.then(() => release);
  inferChain = inferChain.then(() => next);
  return wait;
}

self.addEventListener("message", async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      cfg = msg.cfg;
      rejectedFrames = 0;
      lumaEma = null;
      stage("worker-init-received");
      canvas = new OffscreenCanvas(cfg.imgsz, cfg.imgsz);
      ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const nav = (globalThis as unknown as {
        navigator?: {
          gpu?: unknown;
          userAgent?: string;
          hardwareConcurrency?: number;
          maxTouchPoints?: number;
          userAgentData?: { mobile?: boolean };
        };
      }).navigator;
      const constrained = isConstrainedDevice(nav ?? {});
      // navigator.gpu can exist while no adapter is actually available (very
      // common on Android WebViews and older phones). Probing first avoids
      // downloading the fp16 GPU export just to fail at session creation and
      // then download the fp32 twin — 5 MB of wasted mobile data.
      let gpuUsable = !!nav?.gpu;
      if (gpuUsable) {
        stage("webgpu-adapter-probe");
        try {
          const adapter = await withTimeout(
            (nav!.gpu as { requestAdapter(): Promise<unknown> }).requestAdapter(),
            3000,
            "WebGPU adapter probe",
          );
          gpuUsable = !!adapter;
        } catch {
          gpuUsable = false;
        }
        if (!gpuUsable) stage("webgpu-adapter-unavailable");
      }

      const env = environmentFacts();
      stage("environment", env);
      if (!env["wasmSimd"]) {
        // ORT no longer ships a non-SIMD binary; say so instead of failing with
        // an opaque "magic word" WebAssembly error further down.
        throw new Error(
          "This browser cannot run WebAssembly SIMD, which the inference runtime requires. Update the browser or use a newer device.",
        );
      }

      const plan = planExecutionProviders(
        cfg.enginePreference ?? "auto",
        constrained,
        gpuUsable,
      );
      stage("ep-preferred", {
        providers: plan,
        constrainedDevice: constrained,
        preference: cfg.enginePreference ?? "auto",
      });


      // Engine-aware asset choice. The low-device export ships fp16 weights,
      // which WebGPU runs natively but WASM only emulates (~35% slower here),
      // so a CPU-only device downloads the fp32 twin when the registry
      // provides one.
      const assetFor = (ep: string) =>
        ep === "wasm" && cfg!.cpuModelUrl
          ? { url: cfg!.cpuModelUrl, id: `${cfg!.modelId}:cpu` }
          : { url: cfg!.modelUrl, id: cfg!.modelId };
      const byteCache = new Map<string, Uint8Array>();
      const bytesFor = async (ep: string) => {
        const asset = assetFor(ep);
        const hit = byteCache.get(asset.id);
        if (hit) return hit;
        const bytes = await downloadModel(asset.id, asset.url);
        byteCache.set(asset.id, bytes);
        return bytes;
      };

      // The yawn class is found by semantic tag, never by a hardcoded index —
      // the app stays model-agnostic.
      const yawnClassId = Object.keys(cfg.labels)
        .map((k) => Number(k))
        .find((id) => cfg!.semanticMap[cfg!.labels[String(id)]] === "yawn");

      decodeCfg = {
        imgsz: cfg.imgsz,
        numClasses: Object.keys(cfg.labels).length,
        labels: cfg.labels,
        semanticMap: cfg.semanticMap,
        confThreshold: cfg.confThreshold,
        iouThreshold: cfg.iouThreshold,
        maxDetections: Math.min(cfg.maxDetections, perfProfile.maxDetections),
        nmsCandidateCap: perfProfile.nmsCandidateCap,
        headFormat: cfg.headFormat,
        classIdOffset: cfg.classIdOffset,
        yawnClassId: cfg.yawnClassId ?? yawnClassId,
        yawnCandidateConf: cfg.yawnCandidateConf,
        ...(cfg.classThresholds ? { classThresholds: cfg.classThresholds } : {}),
      };


      // Try each planned execution provider, and only accept one whose output
      // passes a self-test. A mobile GPU that returns noise does not throw —
      // this is the only way to catch it before the driver sees fake boxes.
      //
      // Each attempt loads its OWN runtime bundle. Loading the JSEP/GPU bundle
      // once and reusing it for the CPU retry meant the fallback inherited the
      // exact bundle that crashes on some Android/Brave builds.
      const attempts: {
        engine: string;
        asset: string;
        stage: string;
        ms: number;
        cause?: string;
        error?: string;
      }[] = [];
      session = null;
      ort = null;
      for (const ep of plan) {
        const startedAt = performance.now();
        let reached = "runtime-load";
        const asset = assetFor(ep);
        stage("session-create-start", { engine: ep, asset: asset.id });
        let runtime: OrtModule | null = null;
        let candidate: Ort.InferenceSession | null = null;
        try {
          runtime = await withTimeout(
            loadRuntime(ep === "webgpu"),
            15_000,
            `${ep === "webgpu" ? "WebGPU" : "CPU"} runtime load`,
          );
          stage("runtime-ready", { engine: ep, threads: runtime.env.wasm.numThreads });
          reached = "model-download";
          const modelBytes = await bytesFor(ep);
          reached = "session-create";
          candidate = await withTimeout(
            runtime.InferenceSession.create(modelBytes, {
              executionProviders: [ep],
              graphOptimizationLevel: "all",
              // The graph is a fixed-shape single chain, so ORT gains nothing
              // from spreading it over threads, but sequential mode removes the
              // per-run scheduling overhead on the CPU backend.
              executionMode: "sequential",
              enableCpuMemArena: true,
              enableMemPattern: true,
            }),
            ep === "webgpu" ? 12_000 : 45_000,
            `${ep} session create`,
          );

          reached = "self-test";
          const verdict = await withTimeout(
            selfTest(runtime, candidate, cfg.imgsz, decodeCfg),
            // A weak Android CPU can legitimately need 30s+ for the first run
            // (kernel compilation); the GPU path stays short so it falls back fast.
            ep === "webgpu" ? 10_000 : 40_000,
            `${ep} self-test`,
          );
          stage("engine-self-test", { engine: ep, ...verdict });

          if (verdict.ok) {
            session = candidate;
            ort = runtime;
            engine = ep;
            attempts.push({
              engine: ep,
              asset: asset.id,
              stage: "ready",
              ms: Math.round(performance.now() - startedAt),
            });
            break;
          }
          attempts.push({
            engine: ep,
            asset: asset.id,
            stage: "self-test",
            ms: Math.round(performance.now() - startedAt),
            cause: "self-test-failed",
            error: verdict.reason,
          });
          // Free GPU memory before the CPU attempt allocates its own.
          await candidate.release().catch(() => {});
          candidate = null;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          attempts.push({
            engine: ep,
            asset: asset.id,
            stage: reached,
            ms: Math.round(performance.now() - startedAt),
            cause: classifyInferenceFailure(message),
            error: message,
          });
          stage("session-create-failed", { engine: ep, stage: reached, reason: message });
          if (candidate) {
            await (candidate as Ort.InferenceSession).release().catch(() => {});
          }
        }
      }
      stage("engine-attempts", { attempts });
      if (!session || !ort) {
        // Report every attempt, not just the last one: OOM, a 404, a stalled
        // adapter and a timeout all used to render as the same sentence.
        const detail = attempts
          .map((a) => `${a.engine} (${a.asset}) failed at ${a.stage}: ${a.cause} — ${a.error}`)
          .join("; ");
        throw new Error(
          `No usable inference backend on this device. ${detail || "no execution provider was attempted."} [${
            Object.entries(env)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(", ")
          }]`,
        );
      }
      stage("session-create-done", {
        engine,
        inputs: session.inputNames,
        outputs: session.outputNames,
      });

      // GPU-resident preprocessing. ORT publishes the GPUDevice it created for
      // the WebGPU backend; reusing that exact device lets our compute shader
      // write into a buffer the session can bind with zero copies. Any failure
      // silently leaves the proven CPU path in place.
      gpuPre = null;
      gpuTensor = null;
      if (engine === "webgpu") {
        try {
          const device = (ort.env.webgpu as unknown as { device?: GPUDevice }).device;
          const fromGpu = (ort.Tensor as unknown as {
            fromGpuBuffer?: (b: unknown, o: unknown) => Ort.Tensor;
          }).fromGpuBuffer;
          if (device && typeof fromGpu === "function") {
            gpuPre = GpuPreprocessor.create(device, cfg.imgsz);
            gpuTensor = fromGpu(gpuPre.buffer, {
              dataType: "float32",
              dims: [1, 3, cfg.imgsz, cfg.imgsz],
            });
            stage("gpu-preprocess-ready", { imgsz: cfg.imgsz });
          } else {
            stage("gpu-preprocess-skipped", {
              reason: device ? "runtime has no fromGpuBuffer" : "no device on env.webgpu",
            });
          }
        } catch (err) {
          gpuPre?.dispose();
          gpuPre = null;
          gpuTensor = null;
          stage("gpu-preprocess-skipped", {
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Warm-up + honest benchmark. The first runs of an ORT session pay for
      // kernel compilation and buffer allocation; on WebGPU that can be hundreds
      // of milliseconds. We pay it here, then time six more runs so the app
      // reports (and routes on) the real steady-state cost of this exact
      // model/provider pair rather than a guess from the device class.
      let benchmarkMs: number | undefined;
      try {
        const warmStart = performance.now();
        const size = cfg.imgsz * cfg.imgsz;
        const warmData = new Float32Array(3 * size);
        for (let i = 0; i < warmData.length; i++) warmData[i] = 0.5;
        const warmTensor = gpuTensor ?? new ort.Tensor("float32", warmData, [1, 3, cfg.imgsz, cfg.imgsz]);
        for (let i = 0; i < 3; i++) {
          await withTimeout(
            session.run({ [session.inputNames[0]]: warmTensor }),
            15_000,
            "engine warm-up run",
          );
        }
        stage("engine-warmup-done", {
          engine,
          runs: 3,
          ms: Math.round(performance.now() - warmStart),
        });

        const samples: number[] = [];
        for (let i = 0; i < 6; i++) {
          const t0 = performance.now();
          await withTimeout(
            session.run({ [session.inputNames[0]]: warmTensor }),
            15_000,
            "engine benchmark run",
          );
          samples.push(performance.now() - t0);
        }
        samples.sort((a, b) => a - b);
        benchmarkMs = Math.round(samples[Math.floor(samples.length / 2)] * 10) / 10;
        stage("engine-benchmark", {
          engine,
          imgsz: cfg.imgsz,
          p50Ms: benchmarkMs,
          p95Ms: Math.round(samples[samples.length - 1] * 10) / 10,
          fps: benchmarkMs ? Math.round((1000 / benchmarkMs) * 10) / 10 : null,
          preprocess: gpuPre ? "gpu" : "cpu",
        });
      } catch (err) {
        // A failed warm-up is not fatal: the self-test already proved the
        // backend produces usable output.
        stage("engine-warmup-skipped", {
          reason: err instanceof Error ? err.message : String(err),
        });
      }


      const resp: InitResp = {
        type: "ready",
        engine,
        ...(benchmarkMs != null ? { benchmarkMs } : {}),
        preprocess: gpuPre ? "gpu" : "cpu",
      };
      post(resp);
      return;
    }


    if (msg.type === "configure") {
      if (decodeCfg) {
        decodeCfg = { ...decodeCfg, ...msg.cfg };
        stage("decode-config-updated", { ...msg.cfg });
      }
      return;
    }

    if (msg.type === "infer") {
      // Inference gate. The main thread now pipelines up to two frames so its
      // own post-processing overlaps with the model run, but the session, the
      // OffscreenCanvas, the reused input buffer and the GPU tensor are all
      // single-instance state — running two frames through them at once would
      // interleave writes. Frames therefore queue here and execute strictly in
      // arrival order; the win is overlap with the main thread, not with each
      // other.
      const release = await acquireInferSlot();
      try {
      const runtime = ort;
      if (!runtime || !session || !cfg || !ctx || !decodeCfg) {
        throw new Error("worker not initialized");
      }
      const t0 = performance.now();
      const gain = computeGain();
      let geo: {
        scale: number;
        scaleX: number;
        scaleY: number;
        padX: number;
        padY: number;
        srcW: number;
        srcH: number;
        luma: number;
        gain: number;
      };
      let input: Ort.Tensor;

      if (gpuPre && gpuTensor) {
        // Zero-copy path: frame → GPU texture → compute shader → the very
        // GPUBuffer the session reads. Only a 64×64 thumbnail is read back, to
        // drive auto-gain, because a full readback would stall the queue.
        if (!lumaCtx) {
          lumaCanvas = new OffscreenCanvas(64, 64);
          lumaCtx = lumaCanvas.getContext("2d", {
            willReadFrequently: true,
          }) as OffscreenCanvasRenderingContext2D;
        }
        const luma = cfg.autoGain ? sampleLuma(msg.frame, lumaCtx) : 0;
        const g = gpuPre.run(msg.frame, {
          resize: cfg.resize,
          normalize: cfg.normalize,
          gain,
        });
        geo = { ...g, luma, gain };
        input = gpuTensor;
      } else {
        const tensorLen = 3 * cfg.imgsz * cfg.imgsz;
        if (!inputBuffer || inputBuffer.length !== tensorLen) {
          inputBuffer = new Float32Array(tensorLen);
          inputTensor = new runtime.Tensor("float32", inputBuffer, [
            1,
            3,
            cfg.imgsz,
            cfg.imgsz,
          ]);
        }
        const cpuGeo = preprocessFrame(
          msg.frame,
          cfg.imgsz,
          ctx,
          { resize: cfg.resize, normalize: cfg.normalize, gain },
          inputBuffer,
        );
        geo = cpuGeo;
        input =
          cpuGeo.data === inputBuffer && inputTensor
            ? inputTensor
            : new runtime.Tensor("float32", cpuGeo.data, [1, 3, cfg.imgsz, cfg.imgsz]);
      }

      lumaEma = lumaEma === null ? geo.luma : lumaEma + (geo.luma - lumaEma) * 0.2;
      const tPre = performance.now();
      msg.frame.close();
      const inputName = session.inputNames[0];

      const outMap = await session.run({ [inputName]: input });
      const tInfer = performance.now();
      const raw: Record<string, RawOutput> = {};
      for (const name of session.outputNames) {
        const t = outMap[name];
        if (t) raw[name] = { data: t.data as Float32Array, dims: t.dims };
      }
      const probe = decodeCfg.yawnProbe ? emptyYawnProbe() : undefined;
      const decoded = decodeOutputs(
        raw,
        session.outputNames,
        probe ? { ...decodeCfg, probe } : decodeCfg,
        geo,
      );
      const verdict = inspectDetections(decoded);
      if (verdict.degenerate) {
        rejectedFrames++;
        if (rejectedFrames === 1 || rejectedFrames % 30 === 0) {
          stage("frame-rejected", {
            reason: verdict.reason,
            count: decoded.length,
            rejectedFrames,
            engine,
          });
        }
      }
      const detections = verdict.degenerate ? [] : decoded;
      const providerLatencyMs = performance.now() - t0;
      if (msg.id === 1) {
        stage("first-inference-done", { latencyMs: providerLatencyMs, detections: detections.length });
      }
      const resp: InferResp = {
        type: "result",
        id: msg.id,
        ts: msg.ts,
        detections,
        providerLatencyMs,
        engine,
        degenerate: verdict.degenerate,
        rejectedFrames,
        luma: geo.luma,
        gain: geo.gain,
        preprocessMs: tPre - t0,
        inferMs: tInfer - tPre,
        postprocessMs: providerLatencyMs - (tInfer - t0),
        ...(probe ? { yawnProbe: probe } : {}),
      };

      post(resp);
      return;
      } finally {
        release();
      }
    }


    if (msg.type === "dispose") {
      await session?.release();
      session = null;
      cfg = null;
      decodeCfg = null;
      inputBuffer = null;
      inputTensor = null;
      try {
        gpuPre?.dispose();
      } catch {
        /* the device may already be lost */
      }
      gpuPre = null;
      gpuTensor = null;
      lumaCanvas = null;
      lumaCtx = null;
      canvas = null;
      ctx = null;
      return;
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
    const stack = err instanceof Error ? err.stack : undefined;
    const resp: ErrResp = {
      type: "error",
      id: msg && (msg as InferMsg).type === "infer" ? (msg as InferMsg).id : undefined,
      message,
      stack,
    };
    post(resp);
  }
});

/**
 * Runs one synthetic frame through a freshly created session and checks the
 * output for NaN/Inf, a dead constant tensor, and an implausible detection
 * flood. Catches backends that "succeed" while returning noise.
 */
async function selfTest(
  runtime: OrtModule,
  candidate: Ort.InferenceSession,
  imgsz: number,
  decode: DecodeConfig,
): Promise<{ ok: boolean; reason?: string; detections?: number; min?: number; max?: number }> {
  const size = imgsz * imgsz;
  const data = new Float32Array(3 * size);
  // Deterministic, non-uniform pattern: a flat input can legitimately produce
  // a flat output, which would make the guard useless.
  for (let i = 0; i < size; i++) {
    const x = i % imgsz;
    const y = (i / imgsz) | 0;
    data[i] = (x / imgsz) * 0.9 + 0.05;
    data[i + size] = (y / imgsz) * 0.9 + 0.05;
    data[i + 2 * size] = ((x ^ y) % 255) / 255;
  }
  const input = new runtime.Tensor("float32", data, [1, 3, imgsz, imgsz]);
  const outMap = await candidate.run({ [candidate.inputNames[0]]: input });
  const raw: Record<string, RawOutput> = {};
  let min = Infinity;
  let max = -Infinity;
  for (const name of candidate.outputNames) {
    const t = outMap[name];
    if (!t) continue;
    const arr = t.data as Float32Array;
    raw[name] = { data: arr, dims: t.dims };
    const health = inspectTensor(arr);
    if (!health.finite) return { ok: false, reason: `non-finite values in "${name}"` };
    if (health.constant) return { ok: false, reason: `constant output tensor "${name}"` };
    min = Math.min(min, health.min);
    max = Math.max(max, health.max);
  }
  if (!Object.keys(raw).length) return { ok: false, reason: "no output tensors" };

  const geo = {
    luma: 0,
    gain: 1,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    padX: 0,
    padY: 0,
    srcW: imgsz,
    srcH: imgsz,
  };
  const detections = decodeOutputs(raw, candidate.outputNames, decode, geo);
  const verdict = inspectDetections(detections);
  if (verdict.degenerate) {
    return {
      ok: false,
      reason: `self-test produced ${detections.length} detections (${verdict.reason})`,
      detections: detections.length,
      min,
      max,
    };
  }
  return { ok: true, detections: detections.length, min, max };
}
