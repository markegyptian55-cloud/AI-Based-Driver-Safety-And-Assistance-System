// Detection-head decoding. Pure, framework-agnostic, no DOM.
// Supported head formats come from model registry metadata — the rest of the
// app never branches on architecture.

import type { BBox, Detection, YawnProbeFrame } from "./types";

export type HeadFormat = "ultralytics-v8" | "rf-detr" | "yolo-nms";

export interface DecodeConfig {
  imgsz: number;
  numClasses: number;
  labels: Record<string, string>;
  semanticMap: Record<string, string>;
  confThreshold: number;
  iouThreshold: number;
  maxDetections: number;
  headFormat: HeadFormat;
  /** Offset between model class index and registry class id (RF-DETR reserves 0 for background). */
  classIdOffset: number;
  /**
   * Yawn class id. Only this class may use the lower candidate threshold and
   * only this class is exempt from cross-class dedupe — eyes are untouched.
   */
  yawnClassId?: number;
  /** Lower, class-specific floor for the yawn class. Ignored when unset. */
  yawnCandidateConf?: number;
  /**
   * Mutable sink for class-2 instrumentation. When present the decoder fills
   * it in; when absent the decode path is identical to before.
   */
  probe?: YawnProbeFrame;
  /** Toggle set by the app; the decoder itself only reacts to `probe`. */
  yawnProbe?: boolean;
  /**
   * Upper bound on anchors admitted to NMS. Set by the automatic performance
   * mode: a phone must not pay the quadratic cost of a desktop-sized intake.
   */
  nmsCandidateCap?: number;
  /**
   * Per-class confidence floors keyed by registry class id, e.g.
   * `{ 0: 0.30, 1: 0.33, 2: 0.25 }`. These are measured operating points from
   * the model export, so they win over the generic `confThreshold` — the
   * global slider may only tighten them, never loosen below them.
   */
  classThresholds?: Record<string, number>;
}



/** A fresh, zeroed probe sink. */
export function emptyYawnProbe(): YawnProbeFrame {
  return {
    rawTop: 0,
    rawCount: 0,
    passedConf: 0,
    appliedThreshold: 0,
    afterNms: 0,
    suppressedCrossClass: 0,
  };
}


export interface GeometryParams {
  scale: number;
  scaleX: number;
  scaleY: number;
  padX: number;
  padY: number;
  srcW: number;
  srcH: number;
}

export interface RawOutput {
  data: Float32Array;
  dims: readonly number[];
}

/** Dispatch on head format. `outputs` is keyed by model output name. */
export function decodeOutputs(
  outputs: Record<string, RawOutput>,
  outputNames: readonly string[],
  cfg: DecodeConfig,
  geo: GeometryParams,
): Detection[] {
  if (cfg.headFormat === "rf-detr") {
    const boxesName = outputNames.find((n) => /det|box|pred_boxes/i.test(n)) ?? outputNames[0];
    const logitsName =
      outputNames.find((n) => /label|logit|class|score/i.test(n)) ?? outputNames[1];
    const boxes = outputs[boxesName];
    const logits = outputs[logitsName];
    if (!boxes || !logits) return [];
    return decodeRfDetr(boxes, logits, cfg);
  }
  const first = outputs[outputNames[0]];
  if (!first) return [];
  if (cfg.headFormat === "yolo-nms") {
    return decodeYoloNms(first.data, first.dims, cfg, geo);
  }
  return decodeYoloV8(first.data, first.dims, cfg, geo);
}

/**
 * NMS-baked YOLO head: [1, N, 6] rows of `[x1, y1, x2, y2, conf, class_id]` in
 * padded letterbox pixel space, already de-duplicated inside the ONNX graph.
 *
 * Consequences, all deliberate:
 *  - no NMS, no sigmoid, no cross-class dedupe — re-running any of them would
 *    delete real boxes the graph already resolved;
 *  - the tensor is a fixed 300 rows, so most rows are padding. Padding is
 *    rejected by the same filter as junk: confidence below the class floor,
 *    class id outside range, or a non-positive area;
 *  - each class uses its own measured operating point from the registry.
 */
export function decodeYoloNms(
  raw: ArrayLike<number>,
  dims: readonly number[],
  cfg: DecodeConfig,
  lb: GeometryParams,
): Detection[] {
  if (dims.length !== 3 || dims[2] < 6) return [];
  const rows = dims[1];
  const stride = dims[2];
  const out: Detection[] = [];

  // Cheapest possible rejection first: the lowest confidence any class would
  // accept. Rows under it can be dropped before any rounding, lookup or
  // geometry work, which is most rows in a 480/960 YOLO head.
  let minFloor = Number.POSITIVE_INFINITY;
  for (let c = 0; c < cfg.numClasses; c++) minFloor = Math.min(minFloor, classFloor(cfg, c));
  if (!Number.isFinite(minFloor)) minFloor = 0;

  for (let i = 0; i < rows; i++) {
    const o = i * stride;
    const conf = raw[o + 4];
    if (!Number.isFinite(conf) || conf < minFloor) continue;
    const modelCls = Math.round(raw[o + 5]);
    const classId = modelCls - cfg.classIdOffset;
    if (classId < 0 || classId >= cfg.numClasses) continue;
    const floor = classFloor(cfg, classId);
    if (conf < floor) continue;


    const x1 = raw[o];
    const y1 = raw[o + 1];
    const x2 = raw[o + 2];
    const y2 = raw[o + 3];
    if (!Number.isFinite(x1) || !Number.isFinite(y2)) continue;
    if (x2 - x1 <= 0 || y2 - y1 <= 0) continue;

    // Inverse letterbox: strip the grey padding offset, undo the resize scale,
    // then normalise against the ORIGINAL frame. Skipping this is what leaves
    // boxes visibly offset and over-sized.
    const ox = (x1 - lb.padX) / lb.scaleX;
    const oy = (y1 - lb.padY) / lb.scaleY;
    const ow = (x2 - x1) / lb.scaleX;
    const oh = (y2 - y1) / lb.scaleY;

    const left = clamp01(ox / lb.srcW);
    const top = clamp01(oy / lb.srcH);
    const right = clamp01((ox + ow) / lb.srcW);
    const bottom = clamp01((oy + oh) / lb.srcH);
    const bbox: BBox = [left, top, right - left, bottom - top];
    if (bbox[2] <= 0 || bbox[3] <= 0) continue;


    const label = cfg.labels[String(classId)] ?? `class_${classId}`;
    out.push({
      classId,
      label,
      semantic: cfg.semanticMap[label] ?? label,
      confidence: conf,
      bbox,
      ...(conf < cfg.confThreshold ? { candidate: true } : {}),
    });
  }

  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, cfg.maxDetections);
}

/**
 * Confidence floor for one class. A per-class value from the registry is the
 * measured operating point and is used verbatim; the generic slider only
 * applies to classes the registry says nothing about.
 */
export function classFloor(cfg: DecodeConfig, classId: number): number {
  const explicit = cfg.classThresholds?.[String(classId)];
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  if (classId === cfg.yawnClassId && cfg.yawnCandidateConf != null) {
    return Math.min(cfg.yawnCandidateConf, cfg.confThreshold);
  }
  return cfg.confThreshold;
}


/**
 * RF-DETR head: boxes [1, Q, 4] as normalized cxcywh, logits [1, Q, C] raw.
 * Sigmoid scores, top-k over all (query, class) pairs, no NMS.
 */
export function decodeRfDetr(
  boxes: RawOutput,
  logits: RawOutput,
  cfg: DecodeConfig,
): Detection[] {
  if (boxes.dims.length !== 3 || logits.dims.length !== 3) return [];
  const queries = boxes.dims[1];
  const classSlots = logits.dims[2];
  const out: Detection[] = [];

  const probe = cfg.probe;
  const yawnFloor =
    cfg.yawnClassId != null && cfg.yawnCandidateConf != null
      ? Math.min(cfg.yawnCandidateConf, cfg.confThreshold)
      : cfg.confThreshold;
  if (probe) probe.appliedThreshold = yawnFloor;

  for (let q = 0; q < queries; q++) {
    for (let c = 0; c < classSlots; c++) {
      const classId = c - cfg.classIdOffset;
      if (classId < 0 || classId >= cfg.numClasses) continue;
      const score = sigmoid(logits.data[q * classSlots + c]);
      const isYawn = classId === cfg.yawnClassId;
      if (probe && isYawn && score > probe.rawTop) probe.rawTop = score;
      if (score < (isYawn ? yawnFloor : cfg.confThreshold)) continue;
      if (probe && isYawn) {
        probe.passedConf++;
        probe.afterNms++;
      }

      const cx = boxes.data[q * 4];
      const cy = boxes.data[q * 4 + 1];
      const w = boxes.data[q * 4 + 2];
      const h = boxes.data[q * 4 + 3];
      const bbox: BBox = [
        clamp01(cx - w / 2),
        clamp01(cy - h / 2),
        clamp01(w),
        clamp01(h),
      ];
      const label = cfg.labels[String(classId)] ?? `class_${classId}`;
      out.push({
        classId,
        label,
        semantic: cfg.semanticMap[label] ?? label,
        confidence: score,
        bbox,
        ...(score < cfg.confThreshold ? { candidate: true } : {}),
      });
    }
  }


  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, cfg.maxDetections);
}

/**
 * Ultralytics v8/v11 head: [1, 4 + numClasses, N] with pixel-space cxcywh.
 */
export function decodeYoloV8(
  raw: Float32Array,
  dims: readonly number[],
  cfg: DecodeConfig,
  lb: GeometryParams,
): Detection[] {
  if (dims.length !== 3) return [];
  const channels = dims[1];
  const anchors = dims[2];
  const numClasses = channels - 4;
  if (numClasses <= 0) return [];

  const boxes: number[] = [];
  const scores: number[] = [];
  const classIds: number[] = [];

  // Class-2 (yawn) handling. `yawnCls` is a model-space class index — the same
  // space `bestCls` lives in — so the registry offset is applied once here.
  const yawnCls =
    cfg.yawnClassId != null ? cfg.yawnClassId + cfg.classIdOffset : null;
  const yawnFloor =
    yawnCls != null && cfg.yawnCandidateConf != null
      ? Math.min(cfg.yawnCandidateConf, cfg.confThreshold)
      : cfg.confThreshold;
  const probe = cfg.probe;
  if (probe) probe.appliedThreshold = yawnFloor;

  for (let i = 0; i < anchors; i++) {
    let bestCls = -1;
    let bestScore = 0;
    for (let c = 0; c < numClasses; c++) {
      const s = raw[(4 + c) * anchors + i];
      if (s > bestScore) {
        bestScore = s;
        bestCls = c;
      }
    }
    if (probe && yawnCls != null && yawnCls < numClasses) {
      const s2 = raw[(4 + yawnCls) * anchors + i];
      if (s2 > probe.rawTop) probe.rawTop = s2;
      if (bestCls === yawnCls) probe.rawCount++;
    }
    const floor = bestCls === yawnCls ? yawnFloor : cfg.confThreshold;
    if (bestScore < floor) continue;
    if (probe && bestCls === yawnCls) probe.passedConf++;

    const cx = raw[0 * anchors + i];
    const cy = raw[1 * anchors + i];
    const w = raw[2 * anchors + i];
    const h = raw[3 * anchors + i];
    boxes.push(cx - w / 2, cy - h / 2, w, h);
    scores.push(bestScore);
    classIds.push(bestCls);
  }

  // NMS is quadratic. A noisy/low-light frame can otherwise admit thousands
  // of weak anchors and stall a phone before maxDetections is applied. The cap
  // comes from the device's performance profile (tight on phones, wide on
  // desktops) and defaults to a value ample for one face (2 eyes + mouth).
  const MAX_NMS_CANDIDATES = Math.max(16, cfg.nmsCandidateCap ?? 100);
  if (scores.length > MAX_NMS_CANDIDATES) {
    const top = scores
      .map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_NMS_CANDIDATES);
    const limitedBoxes: number[] = [];
    const limitedScores: number[] = [];
    const limitedClassIds: number[] = [];
    for (const candidate of top) {
      const offset = candidate.index * 4;
      limitedBoxes.push(
        boxes[offset],
        boxes[offset + 1],
        boxes[offset + 2],
        boxes[offset + 3],
      );
      limitedScores.push(candidate.score);
      limitedClassIds.push(classIds[candidate.index]);
    }
    boxes.splice(0, boxes.length, ...limitedBoxes);
    scores.splice(0, scores.length, ...limitedScores);
    classIds.splice(0, classIds.length, ...limitedClassIds);
  }

  const keep = classAwareNms(
    boxes,
    scores,
    classIds,
    cfg.iouThreshold,
    cfg.maxDetections,
    {
      // A mouth box overlapping an eye box by >0.65 IoU is not a duplicate of
      // it; exempting the yawn class stops the eyes from deleting the mouth.
      crossClassExempt: yawnCls != null ? new Set([yawnCls]) : undefined,
      onCrossSuppress: probe
        ? (idx) => {
            if (classIds[idx] === yawnCls) probe.suppressedCrossClass++;
          }
        : undefined,
    },
  );

  const detections: Detection[] = [];
  for (const idx of keep) {
    const bx = boxes[idx * 4];
    const by = boxes[idx * 4 + 1];
    const bw = boxes[idx * 4 + 2];
    const bh = boxes[idx * 4 + 3];

    // Undo letterbox → original image space, then normalize.
    const ox = (bx - lb.padX) / lb.scaleX;
    const oy = (by - lb.padY) / lb.scaleY;
    const ow = bw / lb.scaleX;
    const oh = bh / lb.scaleY;

    const nbbox: BBox = [
      clamp01(ox / lb.srcW),
      clamp01(oy / lb.srcH),
      clamp01(ow / lb.srcW),
      clamp01(oh / lb.srcH),
    ];
    const modelCls = classIds[idx];
    const classId = modelCls - cfg.classIdOffset;
    const label = cfg.labels[String(classId)] ?? `class_${classId}`;
    if (probe && modelCls === yawnCls) probe.afterNms++;
    detections.push({
      classId,
      label,

      semantic: cfg.semanticMap[label] ?? label,
      confidence: scores[idx],
      bbox: nbbox,
      ...(scores[idx] < cfg.confThreshold ? { candidate: true } : {}),
    });

  }
  return detections;
}

function sigmoid(v: number) {
  return 1 / (1 + Math.exp(-v));
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function nms(
  boxes: number[],
  scores: number[],
  iouThreshold: number,
  maxDetections: number,
): number[] {
  const idxs = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const keep: number[] = [];
  const suppressed = new Uint8Array(idxs.length);
  for (let i = 0; i < idxs.length && keep.length < maxDetections; i++) {
    const a = idxs[i];
    if (suppressed[a]) continue;
    keep.push(a);
    for (let j = i + 1; j < idxs.length; j++) {
      const b = idxs[j];
      if (suppressed[b]) continue;
      if (iou(boxes, a, b) > iouThreshold) suppressed[b] = 1;
    }
  }
  return keep;
}

/**
 * Overlap threshold above which two boxes of DIFFERENT classes are treated as
 * the same physical object. A single eye cannot be both open and closed, and a
 * mouth cannot be two mouths — the weaker box is dropped.
 */
export const CROSS_CLASS_IOU = 0.65;

/**
 * Class-aware NMS with a cross-class dedupe pass.
 *
 * Plain global NMS merged an eye with its neighbour whenever the IoU threshold
 * was raised for mobile, and plain per-class NMS let "open 61%" and "open 73%"
 * stack on the same eye. Suppressing per class first (strict threshold) and
 * then removing near-identical boxes across classes gives exactly one box per
 * physical feature — the cluster in the Android screenshot.
 */
export interface ClassNmsOptions {
  /** Class ids exempt from the cross-class dedupe pass. */
  crossClassExempt?: Set<number>;
  /** Called with each index dropped by the cross-class dedupe pass. */
  onCrossSuppress?: (index: number) => void;
}

export function classAwareNms(
  boxes: number[],
  scores: number[],
  classIds: number[],
  iouThreshold: number,
  maxDetections: number,
  opts: ClassNmsOptions = {},
): number[] {
  const byClass = new Map<number, number[]>();
  scores.forEach((_, i) => {
    const bucket = byClass.get(classIds[i]);
    if (bucket) bucket.push(i);
    else byClass.set(classIds[i], [i]);
  });

  const kept: number[] = [];
  for (const indices of byClass.values()) {
    indices.sort((a, b) => scores[b] - scores[a]);
    const suppressed = new Set<number>();
    for (const a of indices) {
      if (suppressed.has(a)) continue;
      kept.push(a);
      for (const b of indices) {
        if (b === a || suppressed.has(b)) continue;
        if (iou(boxes, a, b) > iouThreshold) suppressed.add(b);
      }
    }
  }

  kept.sort((a, b) => scores[b] - scores[a]);
  const final: number[] = [];
  for (const a of kept) {
    if (final.length >= maxDetections) break;
    const exempt = opts.crossClassExempt?.has(classIds[a]) ?? false;
    const duplicate =
      !exempt &&
      final.some((b) => classIds[b] !== classIds[a] && iou(boxes, a, b) > CROSS_CLASS_IOU);
    if (duplicate) opts.onCrossSuppress?.(a);
    else final.push(a);
  }
  return final;
}


function iou(boxes: number[], i: number, j: number): number {
  const ax = boxes[i * 4], ay = boxes[i * 4 + 1], aw = boxes[i * 4 + 2], ah = boxes[i * 4 + 3];
  const bx = boxes[j * 4], by = boxes[j * 4 + 1], bw = boxes[j * 4 + 2], bh = boxes[j * 4 + 3];
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
}

// ---------------------------------------------------------------------------
// Output sanity guards.
//
// A broken backend (typically a mobile GPU driver running the graph in reduced
// precision) does not throw — it returns noise. The signature is unmistakable:
// dozens of boxes whose confidences all sit in a razor-thin band just above the
// threshold. These pure helpers detect that so the pipeline can reject the
// frame instead of painting a wall of fake detections over the driver's face.
// ---------------------------------------------------------------------------

/** Sane upper bound on simultaneous detections for a face-region model. */
export const MAX_PLAUSIBLE_DETECTIONS = 24;

export interface DegenerateVerdict {
  degenerate: boolean;
  reason?: "too-many" | "flat-confidence";
}

export function inspectDetections(
  detections: Detection[],
  maxPlausible: number = MAX_PLAUSIBLE_DETECTIONS,
): DegenerateVerdict {
  if (detections.length > maxPlausible) return { degenerate: true, reason: "too-many" };
  if (detections.length >= 8) {
    let min = Infinity;
    let max = -Infinity;
    for (const d of detections) {
      if (d.confidence < min) min = d.confidence;
      if (d.confidence > max) max = d.confidence;
    }
    if (max - min < 0.05) return { degenerate: true, reason: "flat-confidence" };
  }
  return { degenerate: false };
}

/**
 * Enforces the physical contract of this single-driver model after decoding:
 * at most two eyes and one mouth can be visible in one frame. Keeping only the
 * strongest spatially distinct features prevents weak anchors from becoming
 * independent tracker tracks on slow phones.
 */
export function selectPlausibleFaceFeatures(detections: Detection[]): Detection[] {
  const ranked = [...detections].sort((a, b) => b.confidence - a.confidence);
  const eyes: Detection[] = [];
  let mouth: Detection | null = null;
  const other: Detection[] = [];

  for (const detection of ranked) {
    if (detection.semantic.startsWith("eye")) {
      const overlapsEye = eyes.some((eye) => bboxIou(eye.bbox, detection.bbox) > 0.3);
      if (!overlapsEye && eyes.length < 2) eyes.push(detection);
    } else if (detection.semantic === "yawn" || detection.semantic.startsWith("mouth")) {
      if (!mouth) mouth = detection;
    } else if (other.length < 2) {
      other.push(detection);
    }
  }
  return [...eyes, ...(mouth ? [mouth] : []), ...other];
}

function bboxIou(a: BBox, b: BBox): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = aw * ah + bw * bh - intersection;
  return union > 0 ? intersection / union : 0;
}

export interface TensorHealth {
  finite: boolean;
  constant: boolean;
  min: number;
  max: number;
}

/** Scans a raw tensor for NaN/Inf and for an all-identical (dead) output. */
export function inspectTensor(data: ArrayLike<number>): TensorHealth {
  let min = Infinity;
  let max = -Infinity;
  let finite = true;
  const n = data.length;
  const stride = n > 200_000 ? Math.floor(n / 200_000) : 1;
  for (let i = 0; i < n; i += stride) {
    const v = data[i];
    if (!Number.isFinite(v)) {
      finite = false;
      break;
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { finite, constant: finite && max - min < 1e-6, min, max };
}
