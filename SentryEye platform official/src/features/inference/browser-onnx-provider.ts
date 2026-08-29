// Browser ONNX provider — a thin RPC bridge over a Web Worker. Implements the
// InferenceProvider contract identically to the future RemoteFastApiProvider.

import type {
  Detection,
  Frame,
  InferenceProvider,
  InferenceResult,
  InitOptions,
  ProviderConfig,
  ProviderMeta,
  ProviderStatus,
  TunableConfig,
  YawnProbeFrame,
} from "./types";


type WorkerMsg =
  | { type: "ready"; engine: string; benchmarkMs?: number; preprocess?: "gpu" | "cpu" }
  | { type: "stage"; stage: string; detail?: Record<string, unknown> }
  | {
      type: "result";
      id: number;
      ts: number;
      detections: Detection[];
      providerLatencyMs: number;
      engine: string;
      degenerate?: boolean;
      rejectedFrames?: number;
      luma?: number;
      gain?: number;
      preprocessMs?: number;
      inferMs?: number;
      postprocessMs?: number;
      yawnProbe?: YawnProbeFrame;
    }


  | { type: "error"; id?: number; message: string; stack?: string };

interface Pending {
  resolve: (r: InferenceResult) => void;
  reject: (e: Error) => void;
  captureStart: number;
  ts: number;
}

/** Factory allows unit tests to inject a mock worker. */
export type WorkerFactory = () => Worker;

const defaultWorkerFactory: WorkerFactory = () =>
  new Worker(new URL("./browser-worker.ts", import.meta.url), { type: "module" });

export class BrowserOnnxProvider implements InferenceProvider {
  readonly id = "browser-onnx" as const;
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private cfg: ProviderConfig | null = null;
  private engine = "wasm";
  private benchmarkMs: number | undefined;
  private preprocess: "gpu" | "cpu" | undefined;
  private readyPromise: Promise<void> | null = null;
  private latencySamples: number[] = [];
  private fpsWindow: number[] = [];
  private lastError: string | undefined;
  private onStage?: InitOptions["onStage"];
  private rejectInit: ((error: Error) => void) | null = null;
  private initTimer: ReturnType<typeof setTimeout> | null = null;
  private initSettled = false;

  constructor(private factory: WorkerFactory = defaultWorkerFactory) {}

  init(cfg: ProviderConfig, opts?: InitOptions): Promise<void> {
    this.cfg = cfg;
    this.onStage = opts?.onStage;
    this.emitStage("creating-worker");
    console.info("[provider] creating worker");
    this.worker = this.factory();
    this.emitStage("worker-created");
    console.info("[provider] worker created, attaching listeners");
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onWorkerError);
    this.worker.addEventListener("messageerror", this.onWorkerError);
    this.initSettled = false;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.rejectInit = reject;
      const onReady = (e: MessageEvent<WorkerMsg>) => {
        const msg = e.data;
        if (msg.type === "ready") {
          this.engine = msg.engine;
          this.benchmarkMs = msg.benchmarkMs;
          this.preprocess = msg.preprocess;
          console.info("[provider] worker ready, engine=%s", msg.engine);
          this.emitStage("provider-ready", {
            engine: msg.engine,
            benchmarkMs: msg.benchmarkMs,
            preprocess: msg.preprocess,
          });
          this.worker?.removeEventListener("message", onReady);
          this.settleInit();
          resolve();
        } else if (msg.type === "error" && msg.id === undefined) {
          this.lastError = msg.message;
          console.error("[provider] init error", msg);
          this.worker?.removeEventListener("message", onReady);
          this.settleInit();
          reject(new Error(msg.message));
        }
      };
      this.worker!.addEventListener("message", onReady);
    });
    console.info("[provider] posting init to worker", { modelUrl: cfg.modelUrl, imgsz: cfg.imgsz });
    this.emitStage("posting-init");
    this.worker.postMessage({ type: "init", cfg });
    // If the module cannot evaluate on an Android browser, no worker code runs
    // and therefore no stage can be posted. Fail that handshake promptly.
    this.initTimer = setTimeout(() => {
      this.failInit(new Error("Inference worker did not start within 8s"));
    }, 8_000);
    return this.readyPromise;
  }

  async infer(frame: Frame, ts: number): Promise<InferenceResult> {
    if (!this.worker || !this.cfg) throw new Error("provider not initialized");
    await this.readyPromise;
    const id = this.nextId++;
    const captureStart = performance.now();
    const p = new Promise<InferenceResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, captureStart, ts });
    });
    this.worker.postMessage({ type: "infer", id, ts, frame }, [frame]);
    return p;
  }

  reconfigure(cfg: TunableConfig): void {
    if (!this.worker) return;
    this.cfg = this.cfg ? { ...this.cfg, ...cfg } : this.cfg;
    this.worker.postMessage({ type: "configure", cfg });
  }

  async dispose(): Promise<void> {
    if (!this.initSettled) this.failInit(new Error("provider disposed during initialization"));
    // Reject any in-flight inferences so awaiters never hang.
    for (const [, p] of this.pending) p.reject(new Error("provider disposed"));
    this.pending.clear();
    this.worker?.postMessage({ type: "dispose" });
    this.worker?.removeEventListener("message", this.onMessage);
    this.worker?.removeEventListener("error", this.onWorkerError);
    this.worker?.removeEventListener("messageerror", this.onWorkerError);
    this.worker?.terminate();
    this.worker = null;
    this.readyPromise = null;
    this.rejectInit = null;
    this.cfg = null;
  }

  status(): ProviderStatus {
    return {
      id: this.id,
      ready: !!this.worker && !!this.cfg,
      engine: this.engine,
      modelName: this.cfg?.modelName ?? "",
      modelVersion: this.cfg?.modelVersion ?? "",
      avgLatencyMs: avg(this.latencySamples),
      fps: this.currentFps(),
      lastError: this.lastError,
      ...(this.benchmarkMs != null ? { benchmarkMs: this.benchmarkMs } : {}),
      ...(this.preprocess ? { preprocess: this.preprocess } : {}),
    };
  }

  private emitStage(stage: string, detail?: Record<string, unknown>) {
    try {
      this.onStage?.(stage, detail);
    } catch (err) {
      console.warn("[provider] onStage handler threw", err);
    }
  }

  private settleInit() {
    this.initSettled = true;
    if (this.initTimer) clearTimeout(this.initTimer);
    this.initTimer = null;
    this.rejectInit = null;
  }

  private failInit(error: Error) {
    if (this.initSettled) return;
    this.lastError = error.message;
    const reject = this.rejectInit;
    this.settleInit();
    this.worker?.terminate();
    this.worker = null;
    reject?.(error);
  }

  private onWorkerError = (e: Event) => {
    // ErrorEvent from module load / uncaught in worker.
    const errEvt = e as ErrorEvent;
    const message = errEvt.message || "worker crashed";
    this.lastError = message;
    console.error("[provider] worker error event", errEvt);
    for (const [, p] of this.pending) p.reject(new Error(message));
    this.pending.clear();
    this.failInit(new Error(`Inference worker failed to start: ${message}`));
  };

  private onMessage = (e: MessageEvent<WorkerMsg>) => {
    const msg = e.data;
    if (msg.type === "stage") {
      // Any worker stage proves the module evaluated and the message loop is alive.
      if (this.initTimer) clearTimeout(this.initTimer);
      this.initTimer = null;
      console.info("[provider←worker] stage=%s", msg.stage, msg.detail ?? "");
      this.emitStage(msg.stage, msg.detail);
      return;
    }
    if (msg.type === "error") {
      this.lastError = msg.message;
      console.error("[provider←worker] error", msg);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        p?.reject(new Error(msg.message));
      }
      return;
    }
    if (msg.type === "result") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      const latencyMs = performance.now() - p.captureStart;
      this.pushLatency(latencyMs);
      this.pushFps(performance.now());
      const meta: ProviderMeta = {
        fps: this.currentFps(),
        engine: msg.engine,
        modelName: this.cfg?.modelName ?? "",
        modelVersion: this.cfg?.modelVersion ?? "",
        providerLatencyMs: msg.providerLatencyMs,
        degenerate: msg.degenerate ?? false,
        rejectedFrames: msg.rejectedFrames ?? 0,
        luma: msg.luma,
        gain: msg.gain,
        preprocessMs: msg.preprocessMs,
        inferMs: msg.inferMs,
        postprocessMs: msg.postprocessMs,
        yawnProbe: msg.yawnProbe,
        route: "on-device",

      };

      p.resolve({ ts: msg.ts, latencyMs, detections: msg.detections, meta });
    }
  };

  private pushLatency(v: number) {
    this.latencySamples.push(v);
    if (this.latencySamples.length > 30) this.latencySamples.shift();
  }
  private pushFps(now: number) {
    this.fpsWindow.push(now);
    const cutoff = now - 1000;
    while (this.fpsWindow.length && this.fpsWindow[0] < cutoff) this.fpsWindow.shift();
  }
  private currentFps() {
    return this.fpsWindow.length;
  }
}

function avg(arr: number[]) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

