// RemoteFastApiProvider — the same InferenceProvider contract, executed by the
// Python/YOLO service instead of the phone.
//
// Why it exists: a mid-range Android running a 640px graph in single-threaded
// WASM tops out around 2 fps. A JPEG round-trip to a GPU box is often faster
// end-to-end than local inference on those devices, so the driver gets real
// real-time detection instead of a slideshow.
//
// Model-agnostic: the service returns class ids and normalized xywh only. The
// client maps ids to labels and semantic tags from the registry metadata, so
// swapping the checkpoint never requires a client change.

import { normalizeBaseUrl } from "./remote-endpoint";
import type {
  Detection,
  Frame,
  InferenceProvider,
  InferenceResult,
  InitOptions,
  ProviderConfig,
  ProviderStatus,
  TunableConfig,
} from "./types";

interface RemoteDetection {
  class_id: number;
  confidence: number;
  /** normalized xywh, top-left origin, in original-frame space */
  bbox: [number, number, number, number];
}

interface RemoteResponse {
  detections: RemoteDetection[];
  inference_ms: number;
  model_name?: string;
  model_version?: string;
  engine?: string;
}

const JPEG_QUALITY = 0.72;
/** Hard deadline for one remote frame. Past this the result is stale, not late. */
export const REMOTE_FRAME_TIMEOUT_MS = 800;
/** Health probe must not hang the whole start-up sequence. */
const HEALTH_TIMEOUT_MS = 5000;

export class RemoteFastApiProvider implements InferenceProvider {
  readonly id = "remote-fastapi" as const;

  private cfg: ProviderConfig | null = null;
  private base = "";
  private ready = false;
  private engine = "remote";
  private lastError: string | undefined;
  private latencies: number[] = [];
  private stamps: number[] = [];
  private canvas: OffscreenCanvas | null = null;
  private inFlight = new Set<AbortController>();
  private disposed = false;

  async init(cfg: ProviderConfig, opts?: InitOptions) {
    this.cfg = cfg;
    this.disposed = false;
    this.base = normalizeBaseUrl(cfg.remoteBaseUrl ?? "");
    if (!this.base) {
      throw new Error(
        "No inference service URL is configured. Add the FastAPI service URL in Settings to use remote inference.",
      );
    }
    opts?.onStage?.("remote-probe", { baseUrl: this.base });
    const res = await fetch(`${this.base}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    }).catch((err: unknown) => {
      throw new Error(
        `The inference service at ${this.base} is unreachable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    if (!res.ok) throw new Error(`The inference service replied ${res.status}.`);
    const body = (await res.json()) as { engine?: string; modelName?: string };
    this.engine = body.engine ? `remote:${body.engine}` : "remote";
    this.ready = true;
    opts?.onStage?.("remote-ready", { engine: this.engine, model: body.modelName });
  }

  async infer(frame: Frame, ts: number): Promise<InferenceResult> {
    const cfg = this.cfg;
    if (!cfg || !this.ready) {
      frame.close();
      throw new Error("Remote provider is not initialized.");
    }
    const started = performance.now();
    let blob: Blob;
    try {
      blob = await this.encode(frame);
    } finally {
      frame.close();
    }
    const encodedAt = performance.now();

    const ctrl = new AbortController();
    this.inFlight.add(ctrl);
    // A frame that has not come back by the time the next two are due is worth
    // less than a fresh local guess, so it is abandoned rather than queued.
    // 800 ms is the point past which a box is describing a face position the
    // driver has already left; waiting longer only builds a backlog.
    const timer = setTimeout(() => ctrl.abort(), REMOTE_FRAME_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.base}/v1/detect`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/octet-stream",
          "x-conf-threshold": String(cfg.confThreshold),
          "x-iou-threshold": String(cfg.iouThreshold),
          "x-max-detections": String(cfg.maxDetections),
          "x-imgsz": String(cfg.imgsz),
        },
        body: blob,
      });
      if (!res.ok) throw new Error(`Inference service replied ${res.status}.`);
      const body = (await res.json()) as RemoteResponse;
      const finished = performance.now();
      this.lastError = undefined;
      this.pushLatency(finished - started);
      this.pushFps(finished);

      const detections: Detection[] = body.detections
        .filter((d) => d.confidence >= cfg.confThreshold)
        .map((d) => {
          const classId = d.class_id + (cfg.classIdOffset ?? 0);
          const label = cfg.labels[String(classId)] ?? `class_${classId}`;
          return {
            classId,
            label,
            semantic: cfg.semanticMap[label] ?? label,
            confidence: d.confidence,
            bbox: d.bbox,
          };
        })
        .slice(0, cfg.maxDetections);

      return {
        ts,
        latencyMs: finished - started,
        detections,
        meta: {
          fps: this.currentFps(),
          engine: body.engine ? `remote:${body.engine}` : this.engine,
          modelName: body.model_name ?? cfg.modelName,
          modelVersion: body.model_version ?? cfg.modelVersion,
          providerLatencyMs: body.inference_ms,
          preprocessMs: encodedAt - started,
          inferMs: body.inference_ms,
          transportMs: Math.max(0, finished - encodedAt - body.inference_ms),
          route: "remote",
        },
      };
    } catch (err) {
      this.lastError =
        err instanceof DOMException && err.name === "AbortError"
          ? "The inference service did not answer in time."
          : err instanceof Error
            ? err.message
            : String(err);
      throw new Error(this.lastError);
    } finally {
      clearTimeout(timer);
      this.inFlight.delete(ctrl);
    }
  }

  reconfigure(cfg: TunableConfig) {
    if (this.cfg) this.cfg = { ...this.cfg, ...cfg };
  }

  async dispose() {
    this.disposed = true;
    this.ready = false;
    for (const ctrl of this.inFlight) ctrl.abort();
    this.inFlight.clear();
    this.canvas = null;
  }

  status(): ProviderStatus {
    return {
      id: this.id,
      ready: this.ready && !this.disposed,
      engine: this.engine,
      modelName: this.cfg?.modelName ?? "",
      modelVersion: this.cfg?.modelVersion ?? "",
      avgLatencyMs: this.latencies.length
        ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length
        : 0,
      fps: this.currentFps(),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  /**
   * JPEG, not PNG: a 480p JPEG is ~30 KB and encodes in a couple of
   * milliseconds, while the equivalent PNG is ~10x larger and would make the
   * upload, not the model, the bottleneck on mobile data.
   */
  private async encode(frame: Frame): Promise<Blob> {
    const w = frame.width;
    const h = frame.height;
    if (!this.canvas || this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas = new OffscreenCanvas(w, h);
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot encode frames for upload.");
    ctx.drawImage(frame, 0, 0, w, h);
    return this.canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  }

  private pushLatency(v: number) {
    this.latencies.push(v);
    if (this.latencies.length > 30) this.latencies.shift();
  }

  private pushFps(now: number) {
    this.stamps.push(now);
    while (this.stamps.length && now - this.stamps[0] > 3000) this.stamps.shift();
  }

  private currentFps() {
    if (this.stamps.length < 2) return 0;
    const span = this.stamps[this.stamps.length - 1] - this.stamps[0];
    return span > 0 ? ((this.stamps.length - 1) * 1000) / span : 0;
  }
}
