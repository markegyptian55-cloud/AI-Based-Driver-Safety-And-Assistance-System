// Smile vs yawn discrimination.
//
// The detector exposes a single "yawn" class and happily fires it on a wide
// smile or on speech. Two model-agnostic signals separate the two without
// retraining:
//
//  1. GEOMETRY — mouth aspect ratio (MAR) = box height / box width.
//     A yawn is a tall, vertically open mouth (MAR high). A smile is wide and
//     short (MAR low). Anything below `yawnMinAspect` is a smile, never a yawn.
//  2. CONFIDENCE — a dedicated, higher floor for the mouth class than for eyes.
//
// Time is the third signal and lives in the aggregator (a yawn must be *held*).

import type { Detection } from "../inference/types";

export interface MouthConfig {
  /** Absolute floor on height/width ratio. Below this it is never a yawn. */
  yawnMinAspect: number;
  /** Minimum detector confidence for a mouth box to be considered at all. */
  yawnConfThreshold: number;
  /**
   * How much taller than the driver's own resting mouth a box must be to count
   * as a yawn when it sits between the floor and the "obvious yawn" ratio.
   */
  baselineMultiplier?: number;
  /** Aspect at/above which a box is a yawn regardless of baseline. */
  obviousYawnAspect?: number;
}

export const MOUTH_DEFAULTS: MouthConfig = {
  // Lowered from 0.55: dashcam / phone angles and the 320 px export flatten the
  // mouth box, so a hard 0.55 veto silently discarded real yawns. The time gate
  // in the aggregator is what rejects smiles and speech now.
  yawnMinAspect: 0.38,
  // Matches the eye-class floor; a stricter bar for the noisier class is what
  // made mouth detection lag behind eye detection.
  yawnConfThreshold: 0.35,
  baselineMultiplier: 1.35,
  obviousYawnAspect: 0.6,
};

export type MouthState = "none" | "smile" | "yawn_candidate";

/** Why a mouth box did not become a yawn candidate. */
export type MouthReject = "none" | "no_box" | "low_confidence" | "low_aspect";

export interface MouthReading {
  state: MouthState;
  /** Confidence of the strongest mouth box (0 when there is none). */
  confidence: number;
  /** Aspect ratio (h/w) of the strongest mouth box. */
  aspect: number;
  /** Diagnostic: which gate rejected this frame. */
  reject: MouthReject;
  /** Resting mouth aspect the decision was compared against (0 when unknown). */
  baseline: number;
}

export function boxAspect(d: Detection): number {
  const [, , w, h] = d.bbox;
  return w > 0 ? h / w : 0;
}

/** True when this mouth detection has yawn geometry (tall, open mouth). */
export function isYawnShape(d: Detection, cfg: MouthConfig = MOUTH_DEFAULTS): boolean {
  return boxAspect(d) >= cfg.yawnMinAspect;
}

/**
 * Running estimate of the driver's resting mouth shape. A median over the most
 * recent mouth boxes is robust to the few tall frames a yawn contributes.
 */
export class MouthBaseline {
  private samples: number[] = [];
  constructor(private readonly size = 60) {}

  push(aspect: number) {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    this.samples.push(aspect);
    if (this.samples.length > this.size) this.samples.shift();
  }

  /** Median resting aspect, or 0 while there is not enough evidence. */
  value(): number {
    if (this.samples.length < 8) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  reset() {
    this.samples = [];
  }
}

/**
 * Classifies the mouth for a single frame. A box is a yawn candidate when it
 * clears the absolute aspect floor AND is either obviously tall or clearly
 * taller than this driver's resting mouth. Everything else that is open and
 * confident is a smile.
 */
export function readMouth(
  detections: Detection[],
  cfg: MouthConfig = MOUTH_DEFAULTS,
  baseline = 0,
): MouthReading {
  let best: Detection | null = null;
  for (const d of detections) {
    if (d.semantic !== "yawn") continue;
    if (!best || d.confidence > best.confidence) best = d;
  }
  if (!best) return { state: "none", confidence: 0, aspect: 0, reject: "no_box", baseline };
  const aspect = boxAspect(best);
  if (best.confidence < cfg.yawnConfThreshold) {
    return {
      state: "none",
      confidence: best.confidence,
      aspect,
      reject: "low_confidence",
      baseline,
    };
  }
  const obvious = cfg.obviousYawnAspect ?? 0.6;
  const mult = cfg.baselineMultiplier ?? 1.35;
  const relative = baseline > 0 && aspect >= baseline * mult;
  const isYawn = aspect >= cfg.yawnMinAspect && (aspect >= obvious || relative);
  return {
    state: isYawn ? "yawn_candidate" : "smile",
    confidence: best.confidence,
    aspect,
    reject: isYawn ? "none" : "low_aspect",
    baseline,
  };
}

