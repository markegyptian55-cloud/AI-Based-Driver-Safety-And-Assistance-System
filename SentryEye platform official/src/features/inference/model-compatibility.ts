// Pre-start model compatibility check.
//
// Pure, framework-free: given registry metadata and a couple of device facts,
// answer "can live detection run with this model, and should it?". Blocking
// problems are `errors`; runtime-fit concerns are `warnings`.

import type { ModelMetadata } from "@/features/drowsiness/labels";

export interface CompatibilityIssue {
  id: string;
  message: string;
  /** Suggest swapping to a lighter model when true. */
  suggestLighter?: boolean;
}

export interface CompatibilityReport {
  ok: boolean;
  errors: CompatibilityIssue[];
  warnings: CompatibilityIssue[];
}

export interface DeviceProfile {
  /** Phone/tablet-class device (see isConstrainedDevice). */
  constrained: boolean;
  /** navigator.deviceMemory in GB, when the browser reports it. */
  memoryGb?: number | null;
}

/**
 * Rough peak working set for one inference, in GB.
 *
 * The input tensor alone is imgsz²·3·4 bytes (11 MB at 960, 2.8 MB at 480) and
 * intermediate activations are several multiples of it. The multiplier is
 * deliberately conservative: an out-of-memory abort on a phone kills the tab,
 * which is far worse than refusing the heavy model.
 */
export const ACTIVATION_MULTIPLIER = 12;

export function estimateWorkingSetGb(imgsz: number, fileSizeBytes?: number | null): number {
  const input = imgsz * imgsz * 3 * 4;
  return (input * ACTIVATION_MULTIPLIER + (fileSizeBytes ?? 0) * 2) / 1024 ** 3;
}

/** Share of reported device memory a browser tab may realistically use. */
export const USABLE_MEMORY_FRACTION = 0.35;

/** Read navigator.deviceMemory safely (browser only). */
export function readDeviceMemoryGb(): number | null {
  if (typeof navigator === "undefined") return null;
  const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof value === "number" && value > 0 ? value : null;
}

/** Semantic tags the drowsiness scoring pipeline consumes. */
export const REQUIRED_SEMANTICS = ["eye_open", "eye_closed", "yawn"] as const;

const SUPPORTED_HEADS = ["ultralytics-v8", "rf-detr", "yolo-nms"];
const SUPPORTED_RESIZE = ["letterbox", "stretch"];
const SUPPORTED_NORMALIZE = ["unit", "imagenet"];

/**
 * Above this input size a phone cannot keep up with a live camera. The
 * low-device export runs at 480, so that is the ceiling a phone may run
 * without a "too heavy" warning.
 */
export const MOBILE_IMGSZ_LIMIT = 480;
/** Above this download size, first load on mobile data is painful. */
export const MOBILE_BYTES_LIMIT = 16 * 1024 * 1024;

export function checkModelCompatibility(
  meta: ModelMetadata | null | undefined,
  device: DeviceProfile,
): CompatibilityReport {
  const errors: CompatibilityIssue[] = [];
  const warnings: CompatibilityIssue[] = [];

  if (!meta) {
    return {
      ok: false,
      errors: [{ id: "no-model", message: "No detection model is selected." }],
      warnings,
    };
  }

  if (!meta.modelUrl) {
    errors.push({
      id: "no-file",
      message: `${meta.modelName} has no model file registered, so it cannot be downloaded.`,
    });
  }

  if (!SUPPORTED_HEADS.includes(meta.headFormat)) {
    errors.push({
      id: "head-format",
      message: `This app cannot decode the "${meta.headFormat}" output format.`,
    });
  }

  if (!Number.isFinite(meta.imgsz) || meta.imgsz < 96 || meta.imgsz > 1536) {
    errors.push({
      id: "imgsz-range",
      message: `Input resolution ${meta.imgsz}px is outside the supported 96–1536px range.`,
    });
  } else if (meta.imgsz % 32 !== 0) {
    errors.push({
      id: "imgsz-stride",
      message: `Input resolution ${meta.imgsz}px is not a multiple of 32, so preprocessing cannot letterbox it correctly.`,
    });
  }

  const { resize, normalize } = meta.postprocessConfig;
  if (!SUPPORTED_RESIZE.includes(resize)) {
    errors.push({
      id: "resize",
      message: `Unsupported preprocessing resize mode "${resize}".`,
    });
  }
  if (!SUPPORTED_NORMALIZE.includes(normalize)) {
    errors.push({
      id: "normalize",
      message: `Unsupported preprocessing normalisation "${normalize}".`,
    });
  }

  const labelCount = Object.keys(meta.labels).length;
  if (labelCount === 0) {
    errors.push({ id: "no-labels", message: "This model has no class labels registered." });
  } else if (labelCount !== meta.numClasses) {
    errors.push({
      id: "label-count",
      message: `Model declares ${meta.numClasses} classes but ${labelCount} labels are registered.`,
    });
  }

  const semantics = new Set(Object.values(meta.semanticMap));
  const missing = REQUIRED_SEMANTICS.filter((tag) => !semantics.has(tag));
  if (missing.length) {
    errors.push({
      id: "semantics",
      message: `Drowsiness scoring needs eye-open, eye-closed and yawn classes. Missing: ${missing.join(", ")}.`,
    });
  }

  // Memory gate: applies wherever the browser reports deviceMemory. A 960px
  // graph on a 2 GB Android is an out-of-memory abort, not a slow path.
  const memoryGb = device.memoryGb ?? null;
  if (memoryGb != null) {
    const needGb = estimateWorkingSetGb(meta.imgsz, meta.fileSizeBytes);
    if (needGb > memoryGb * USABLE_MEMORY_FRACTION) {
      errors.push({
        id: "device-memory",
        message: `${meta.modelName} needs roughly ${needGb.toFixed(1)} GB of working memory at ${meta.imgsz}px, but this device reports only ${memoryGb} GB. Running it here would crash the tab.`,
        suggestLighter: true,
      });
    }
  }

  if (device.constrained) {
    if (meta.imgsz > MOBILE_IMGSZ_LIMIT) {
      warnings.push({
        id: "mobile-imgsz",
        message: `${meta.modelName} runs at ${meta.imgsz}px — heavy for a phone. Expect low FPS and delayed alerts.`,
        suggestLighter: true,
      });
    }
    if (meta.headFormat === "rf-detr") {
      warnings.push({
        id: "mobile-head",
        message: "Transformer detectors are slow in mobile browsers. Best used for video/image analysis.",
        suggestLighter: true,
      });
    }
    if ((meta.fileSizeBytes ?? 0) > MOBILE_BYTES_LIMIT) {
      warnings.push({
        id: "mobile-size",
        message: `First load downloads ${Math.round((meta.fileSizeBytes ?? 0) / (1024 * 1024))} MB over your connection.`,
        suggestLighter: true,
      });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Lightest live-capable model in the registry, used by the "switch" action. */
export function pickLightestModel(models: ModelMetadata[]): ModelMetadata | null {
  const usable = models.filter(
    (m) => checkModelCompatibility(m, { constrained: false }).ok && m.headFormat !== "rf-detr",
  );
  if (!usable.length) return null;
  return [...usable].sort((a, b) => a.imgsz - b.imgsz)[0];
}

// ---------------------------------------------------------------------------
// Itemised report: which specific pipeline step passes or fails, and which
// other registry models would pass instead.
// ---------------------------------------------------------------------------

export interface CompatibilityCheck {
  id: string;
  /** Pipeline step being verified, in the driver's language. */
  label: string;
  /** What this model actually declares. */
  actual: string;
  /** What the live pipeline accepts. */
  expected: string;
  status: "pass" | "fail" | "warn";
  detail?: string;
}

/** Per-step breakdown of the same rules `checkModelCompatibility` applies. */
export function compatibilityChecks(
  meta: ModelMetadata | null | undefined,
  device: DeviceProfile,
): CompatibilityCheck[] {
  if (!meta) return [];
  const report = checkModelCompatibility(meta, device);
  const failed = new Set(report.errors.map((e) => e.id));
  const warned = new Set(report.warnings.map((w) => w.id));
  const state = (ids: string[]): CompatibilityCheck["status"] =>
    ids.some((id) => failed.has(id)) ? "fail" : ids.some((id) => warned.has(id)) ? "warn" : "pass";
  const messageFor = (ids: string[]) =>
    [...report.errors, ...report.warnings].find((i) => ids.includes(i.id))?.message;

  const labelCount = Object.keys(meta.labels).length;
  const semantics = new Set(Object.values(meta.semanticMap));
  const missing = REQUIRED_SEMANTICS.filter((tag) => !semantics.has(tag));
  const sizeMb = meta.fileSizeBytes ? (meta.fileSizeBytes / (1024 * 1024)).toFixed(1) : "?";

  const ids = {
    file: ["no-file"],
    imgsz: ["imgsz-range", "imgsz-stride", "mobile-imgsz", "device-memory"],
    resize: ["resize"],
    normalize: ["normalize"],
    head: ["head-format", "mobile-head"],
    labels: ["no-labels", "label-count", "semantics"],
    size: ["mobile-size"],
  };

  return [
    {
      id: "file",
      label: "Model file",
      actual: meta.modelUrl ? `${sizeMb} MB` : "not registered",
      expected: "downloadable ONNX graph",
      status: state(ids.file),
      detail: messageFor(ids.file),
    },
    {
      id: "imgsz",
      label: "Input resolution",
      actual: `${meta.imgsz}×${meta.imgsz}`,
      expected: device.constrained
        ? `multiple of 32, ≤ ${MOBILE_IMGSZ_LIMIT}px on this device`
        : "multiple of 32, 96–1536px",
      status: state(ids.imgsz),
      detail: messageFor(ids.imgsz),
    },
    {
      id: "resize",
      label: "Preprocessing — resize",
      actual: meta.postprocessConfig.resize,
      expected: SUPPORTED_RESIZE.join(" or "),
      status: state(ids.resize),
      detail: messageFor(ids.resize),
    },
    {
      id: "normalize",
      label: "Preprocessing — normalisation",
      actual: meta.postprocessConfig.normalize,
      expected: SUPPORTED_NORMALIZE.join(" or "),
      status: state(ids.normalize),
      detail: messageFor(ids.normalize),
    },
    {
      id: "head",
      label: "Output decoder",
      actual: meta.headFormat,
      expected: SUPPORTED_HEADS.join(" or "),
      status: state(ids.head),
      detail: messageFor(ids.head),
    },
    {
      id: "labels",
      label: "Class map",
      actual: `${labelCount}/${meta.numClasses} labels${missing.length ? `, missing ${missing.join(", ")}` : ""}`,
      expected: "eye_open, eye_closed, yawn",
      status: state(ids.labels),
      detail: messageFor(ids.labels),
    },
    {
      id: "size",
      label: "Download size",
      actual: `${sizeMb} MB`,
      expected: device.constrained
        ? `≤ ${Math.round(MOBILE_BYTES_LIMIT / (1024 * 1024))} MB on mobile data`
        : "no limit",
      status: state(ids.size),
      detail: messageFor(ids.size),
    },
  ];
}

export interface ModelAlternative {
  model: ModelMetadata;
  /** Why this one is a better fit, in one line. */
  reason: string;
  /** Lower is lighter: rough live cost proxy (pixels × head penalty). */
  cost: number;
}

/** Rough relative live cost of a model on this device. */
export function estimateCost(meta: ModelMetadata): number {
  const pixels = meta.imgsz * meta.imgsz;
  const headPenalty = meta.headFormat === "rf-detr" ? 2.5 : 1;
  const sizePenalty = 1 + (meta.fileSizeBytes ?? 0) / (64 * 1024 * 1024);
  return pixels * headPenalty * sizePenalty;
}

/**
 * Registry models that pass every blocking check on this device, cheapest
 * first, excluding the current pick.
 */
export function rankAlternatives(
  models: ModelMetadata[],
  device: DeviceProfile,
  currentId?: string | null,
): ModelAlternative[] {
  return models
    .filter((m) => m.id !== currentId)
    .map((m) => ({ m, report: checkModelCompatibility(m, device) }))
    .filter(({ report }) => report.ok && report.warnings.length === 0)
    .map(({ m }) => ({
      model: m,
      cost: estimateCost(m),
      reason: `${m.imgsz}px · ${m.headFormat === "rf-detr" ? "transformer" : "YOLO"} · ${
        m.fileSizeBytes ? `${(m.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB` : "size unknown"
      }`,
    }))
    .sort((a, b) => a.cost - b.cost);
}

/** Fastest model that clears every check on this device (auto-fallback target). */
export function pickFastestCompatible(
  models: ModelMetadata[],
  device: DeviceProfile,
  currentId?: string | null,
): ModelMetadata | null {
  return rankAlternatives(models, device, currentId)[0]?.model ?? null;
}
