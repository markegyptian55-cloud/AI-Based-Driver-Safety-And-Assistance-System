// Model metadata comes from the model_registry table. The static
// /models/labels.json is only a last-resort fallback when the registry is
// unreachable. Nothing here is model-specific — every field is data.

import { supabase } from "@/integrations/supabase/client";

export interface ModelMetadata {
  id: string;
  modelName: string;
  version: string;
  engineKind: string;
  headFormat: "ultralytics-v8" | "rf-detr" | "yolo-nms";
  framework: string;
  modelUrl: string;
  /** fp32 twin used on CPU/WASM devices where fp16 is emulated. */
  cpuModelUrl: string | null;
  imgsz: number;
  numClasses: number;
  labels: Record<string, string>;
  semanticMap: Record<string, string>;
  postprocessConfig: {
    confThreshold: number;
    iouThreshold: number;
    maxDetections: number;
    classIdOffset: number;
    resize: "letterbox" | "stretch";
    normalize: "unit" | "imagenet";
    /** Measured per-class confidence floors, keyed by class id. */
    classThresholds?: Record<string, number>;
  };
  /** Model precision as exported (fp16 / fp32) — affects WASM viability. */
  exportPrecision: string | null;
  /** True when no accuracy figure has been measured at this input size. */
  accuracyUnverified: boolean;
  /** Optional presentation metadata carried in postprocess_config. */
  quantization: string | null;
  /** Image-level presence macro F1 — the metric this product actually uses. */
  presenceMacroF1: number | null;
  bestFor: string | null;
  fileSizeBytes: number | null;
  /** Size of the fp32 twin, when one is registered. */
  cpuFileSizeBytes: number | null;
  precision: number | null;
  recall: number | null;
  /** Raw mAP@50 (standard convention, counts label-gap misses as errors). */
  map50: number | null;
  /**
   * mAP@50 after the partial-annotation correction: predictions on images that
   * were never labelled for that class are excluded instead of counted wrong.
   * Higher than `map50`; recall and false negatives are unchanged.
   */
  map50Corrected: number | null;
  map5095: number | null;
  /** Per-class AP@50, keyed by class name (raw / corrected). */
  apPerClass: Record<string, number> | null;
  apPerClassCorrected: Record<string, number> | null;
  /** Per-class recall at the evaluation operating point. */
  recallPerClass: Record<string, number> | null;
  f1: number | null;
  /** Rough live cost relative to the lightest registered model. */
  relativeCompute: number | null;
  /** How the figures above were produced, shown verbatim in the model page. */
  metricsNote: string | null;
  evaluatedOn: string | null;

  trainedAt: string | null;
  notes: string | null;
  isActive: boolean;
}

type Row = {
  id: string;
  name: string;
  version: string;
  engine_kind: string;
  head_format: string;
  framework: string;
  file_path: string | null;
  file_size_bytes: number | null;
  imgsz: number;
  num_classes: number;
  labels: unknown;
  semantic_map: unknown;
  postprocess_config: unknown;
  precision_score: number | null;
  recall_score: number | null;
  map50: number | null;
  map50_95: number | null;
  trained_at: string | null;
  notes: string | null;
  is_active: boolean;
};

function asRecord(v: unknown): Record<string, string> {
  return v && typeof v === "object" ? (v as Record<string, string>) : {};
}

/** Optional numeric field from postprocess_config. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Optional `{ className: number }` map from postprocess_config. */
function numRecord(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[k] = raw;
  }
  return Object.keys(out).length ? out : null;
}


export function mapModelRow(row: Row): ModelMetadata {
  const pp = (row.postprocess_config ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    modelName: row.name,
    version: row.version,
    engineKind: row.engine_kind,
    headFormat:
      row.head_format === "rf-detr"
        ? "rf-detr"
        : row.head_format === "yolo-nms"
          ? "yolo-nms"
          : "ultralytics-v8",
    framework: row.framework,
    modelUrl: row.file_path ?? "",
    cpuModelUrl: typeof pp["cpuFileUrl"] === "string" ? (pp["cpuFileUrl"] as string) : null,
    imgsz: row.imgsz,
    numClasses: row.num_classes,
    labels: asRecord(row.labels),
    semanticMap: asRecord(row.semantic_map),
    postprocessConfig: {
      confThreshold: Number(pp["confThreshold"] ?? 0.35),
      iouThreshold: Number(pp["iouThreshold"] ?? 0.5),
      maxDetections: Number(pp["maxDetections"] ?? 100),
      classIdOffset: Number(pp["classIdOffset"] ?? 0),
      resize: pp["resize"] === "stretch" ? "stretch" : "letterbox",
      normalize: pp["normalize"] === "imagenet" ? "imagenet" : "unit",
      ...(pp["classThresholds"] && typeof pp["classThresholds"] === "object"
        ? { classThresholds: pp["classThresholds"] as Record<string, number> }
        : {}),
    },
    exportPrecision:
      typeof pp["exportPrecision"] === "string" ? (pp["exportPrecision"] as string) : null,
    accuracyUnverified: pp["accuracyUnverified"] === true,
    quantization: typeof pp["quantization"] === "string" ? (pp["quantization"] as string) : null,
    presenceMacroF1:
      typeof pp["presenceMacroF1"] === "number" ? (pp["presenceMacroF1"] as number) : null,
    bestFor: typeof pp["bestFor"] === "string" ? (pp["bestFor"] as string) : null,
    fileSizeBytes: row.file_size_bytes,
    cpuFileSizeBytes: num(pp["cpuFileSizeBytes"]),
    precision: row.precision_score,
    recall: row.recall_score,
    map50: row.map50,
    map50Corrected: num(pp["map50Corrected"]),
    map5095: row.map50_95,
    apPerClass: numRecord(pp["apPerClass"]),
    apPerClassCorrected: numRecord(pp["apPerClassCorrected"]),
    recallPerClass: numRecord(pp["recallPerClass"]),
    f1: num(pp["f1"]),
    relativeCompute: num(pp["relativeCompute"]),
    metricsNote: typeof pp["metricsNote"] === "string" ? (pp["metricsNote"] as string) : null,
    evaluatedOn: typeof pp["evaluatedOn"] === "string" ? (pp["evaluatedOn"] as string) : null,

    trainedAt: row.trained_at,
    notes: row.notes,
    isActive: row.is_active,
  };
}

// Explicit projection: `checksum` and `notes` are not exposed to anonymous
// visitors, so `select("*")` would fail for guest sessions.
const MODEL_SELECT =
  "id,name,version,engine_kind,head_format,framework,file_path,file_size_bytes," +
  "imgsz,num_classes,labels,semantic_map,postprocess_config,precision_score," +
  "recall_score,map50,map50_95,trained_at,is_active";

export async function listModels(): Promise<ModelMetadata[]> {
  const { data, error } = await supabase
    .from("model_registry")
    .select(MODEL_SELECT)
    .eq("is_active", true)
    .order("map50", { ascending: false });
  if (error) throw new Error(`failed to load model registry: ${error.message}`);
  return (data as unknown as Row[]).map(mapModelRow);
}

/**
 * Resolve the metadata for a specific model, or the best active model when no
 * id is given.
 */
export async function loadModelMetadata(modelId?: string | null): Promise<ModelMetadata> {
  const models = await listModels();
  if (!models.length) throw new Error("No active model is registered");
  if (modelId) {
    const found = models.find((m) => m.id === modelId);
    if (found) return found;
    console.warn(`[models] selected model ${modelId} not found, using default`);
  }
  return models[0];
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

/**
 * Headline accuracy for a model, in the terms this product actually measures:
 * image-level presence F1 when it was recorded, box mAP@50 otherwise.
 */
export function modelAccuracy(m: ModelMetadata): { value: string; kind: string } {
  if (m.presenceMacroF1 != null) {
    return { value: `F1 ${m.presenceMacroF1.toFixed(3)}`, kind: "presence" };
  }
  return { value: m.map50 != null ? `mAP50 ${m.map50.toFixed(3)}` : "—", kind: "box" };
}

/** Plain-language grade so non-technical users can compare models. */
export function accuracyGrade(m: ModelMetadata): string {
  const score = m.presenceMacroF1 ?? m.map50 ?? 0;
  if (score >= 0.9) return "Excellent";
  if (score >= 0.8) return "High";
  if (score >= 0.65) return "Good";
  return "Baseline";
}

/** One-line hint on where a model runs best. */
export function modelBestFor(m: ModelMetadata): string {
  if (m.bestFor === "default") return "Recommended — fast enough for phones";
  if (m.bestFor === "high-quality") return "Most accurate — desktop / strong GPU";
  if (m.bestFor === "mobile") return "Fastest — recommended on phones";
  if (m.bestFor === "desktop") return "Best on desktop / laptop";
  if (m.bestFor === "balanced") return "Balanced — desktop or recent phones";
  return m.imgsz >= 640 ? "Best on desktop / laptop" : "Balanced";
}

/**
 * Closed-eye AP is the number that matters for microsleep detection: an eye the
 * model misses is an alarm that never fires. The aggregate mAP of the two
 * registered models is effectively tied (82.7% both), which hides a real 2.3
 * point gap on this one class — so surface the class figure, not the average.
 */
export function closedEyeAccuracy(m: ModelMetadata): number | null {
  return m.apPerClassCorrected?.["closed_eye"] ?? m.apPerClass?.["closed_eye"] ?? null;
}

/** Honest one-liner about the microsleep-detection trade-off of a model. */
export function microsleepNote(m: ModelMetadata): string | null {
  const ap = closedEyeAccuracy(m);
  const recall = m.recallPerClass?.["closed_eye"];
  if (ap == null) return null;
  const pct = `${(ap * 100).toFixed(1)}%`;
  const rec = recall != null ? `, catches ${(recall * 100).toFixed(0)}% of closed eyes` : "";
  return `Closed-eye accuracy ${pct}${rec}.`;
}

