// Framework-agnostic contract for any inference provider (browser or remote).
// Identical shape for BrowserOnnxProvider and RemoteFastApiProvider so Phase 2
// only swaps the factory registration.

export type BBox = [x: number, y: number, w: number, h: number];

export interface Detection {
  classId: number;
  label: string;
  semantic: string;
  confidence: number;
  /** normalized 0..1 in image space, xywh (top-left origin) */
  bbox: BBox;
  /**
   * True when the box only cleared the class-specific candidate threshold and
   * not the global confidence floor. Weak evidence: usable by the temporal
   * yawn machine, never enough on its own to confirm an event.
   */
  candidate?: boolean;
}

/**
 * Per-frame instrumentation for the yawn class. Answers "was class 2 produced
 * at all, and which gate consumed it?" without changing any behaviour.
 */
export interface YawnProbeFrame {
  /** Highest raw class-2 score across all anchors, BEFORE any threshold. */
  rawTop: number;
  /** Anchors whose winning class was class 2, before any threshold. */
  rawCount: number;
  /** Class-2 boxes that cleared the applied threshold. */
  passedConf: number;
  /** Threshold that was actually applied to class 2 this frame. */
  appliedThreshold: number;
  /** Class-2 boxes that survived NMS. */
  afterNms: number;
  /** Class-2 boxes dropped by the cross-class dedupe pass. */
  suppressedCrossClass: number;
}


export interface ProviderMeta {
  /** Rolling FPS reported by the provider (inference/s, not camera fps). */
  fps: number;
  /** Backend/engine identifier (e.g. "webgpu", "wasm", "cuda", "cpu"). */
  engine: string;
  /** Model name/version reported by the provider. */
  modelName: string;
  modelVersion: string;
  /** Provider-side latency (ms) — inference only, excludes transport. */
  providerLatencyMs: number;
  /** This frame's raw output failed the sanity guard and was discarded. */
  degenerate?: boolean;
  /** Running count of frames discarded by the sanity guard. */
  rejectedFrames?: number;
  /** Mean scene luma (0..1) measured during preprocessing. */
  luma?: number;
  /** Auto-gain multiplier applied to the frame. */
  gain?: number;
  /** Stage breakdown (ms) for the profiler: where the frame budget went. */
  preprocessMs?: number;
  inferMs?: number;
  postprocessMs?: number;
  /** Network round-trip for remote providers (ms); 0/undefined on-device. */
  transportMs?: number;
  /** Which routed path produced this result, when a router is in front. */
  route?: string;
  /** Class-2 (yawn) instrumentation for this frame; only when probing is on. */
  yawnProbe?: YawnProbeFrame;
}



export interface InferenceResult {
  /** Wall-clock timestamp (ms since epoch) when the frame was captured. */
  ts: number;
  /** End-to-end latency measured by the caller (ms). */
  latencyMs: number;
  detections: Detection[];
  meta: ProviderMeta;
}

export interface ProviderConfig {
  modelId: string;
  modelUrl: string;
  /**
   * Alternate export used when the resolved engine is CPU/WASM. fp16 weights
   * are emulated on WASM (~35% slower here), so a CPU-only device downloads
   * the fp32 twin instead. Optional: models with a single export omit it.
   */
  cpuModelUrl?: string;
  imgsz: number;
  labels: Record<string, string>; // class_id (string) -> label
  semanticMap: Record<string, string>; // label -> semantic tag
  confThreshold: number;
  iouThreshold: number;
  maxDetections: number;
  modelName: string;
  modelVersion: string;
  /** Decoder selection, from registry metadata. */
  headFormat: "ultralytics-v8" | "rf-detr" | "yolo-nms";
  /**
   * Measured per-class confidence floors keyed by class id. Present when the
   * registry records them; they take precedence over `confThreshold`.
   */
  classThresholds?: Record<string, number>;
  classIdOffset: number;
  resize: "letterbox" | "stretch";
  normalize: "unit" | "imagenet";
  /** Execution-backend preference; "auto" picks per device. */
  enginePreference?: "auto" | "webgpu" | "wasm";
  /** Base URL of the FastAPI inference service (remote + hybrid providers). */
  remoteBaseUrl?: string;
  /** Brighten dark frames before inference (low-light preset). */
  autoGain?: boolean;
  /** Target mean luma (0..1) for auto-gain. */
  autoGainTargetLuma?: number;
  /**
   * Class-specific candidate threshold for the yawn class. Lower than the
   * global floor; boxes between the two are emitted with `candidate: true`
   * and must earn an event through temporal evidence. Eye classes always use
   * `confThreshold`.
   */
  yawnCandidateConf?: number;
  /** Registry class id of the yawn class (defaults to the semantic lookup). */
  yawnClassId?: number;
  /** Emit per-frame class-2 instrumentation in `meta.yawnProbe`. */
  yawnProbe?: boolean;

}

export interface ProviderStatus {
  id: string;
  ready: boolean;
  engine: string;
  modelName: string;
  modelVersion: string;
  avgLatencyMs: number;
  fps: number;
  lastError?: string;
  /** Median session.run() cost measured right after warm-up, if benchmarked. */
  benchmarkMs?: number;
  /** Whether frames are prepared on the GPU (zero-copy) or on the CPU. */
  preprocess?: "gpu" | "cpu";
}


/** A frame is anything the provider can consume. Providers may narrow support. */
export type Frame = ImageBitmap;

export interface InitOptions {
  /** Optional progress reporter emitted during init (download, session create, etc). */
  onStage?: (stage: string, detail?: Record<string, unknown>) => void;
}

/** Runtime-tunable decode thresholds (no model reload required). */
export type TunableConfig = Pick<
  ProviderConfig,
  | "confThreshold"
  | "iouThreshold"
  | "maxDetections"
  | "yawnCandidateConf"
  | "yawnProbe"
  | "classThresholds"
>;


export interface InferenceProvider {
  readonly id: "browser-onnx" | "remote-fastapi" | "hybrid-auto";
  init(cfg: ProviderConfig, opts?: InitOptions): Promise<void>;
  infer(frame: Frame, ts: number): Promise<InferenceResult>;
  /** Update thresholds on a warm provider without reloading the model. */
  reconfigure(cfg: TunableConfig): void;
  dispose(): Promise<void>;
  status(): ProviderStatus;
}
