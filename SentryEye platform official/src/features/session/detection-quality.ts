// Live detection quality score.
//
// A drowsiness number produced from an unusable frame is not a number, it is a
// liability. This turns the signals we already collect (scene luma, image
// sharpness, face coverage, track confidence, frame rate) into one 0-100 score
// with a single dominant reason and the fix for it, so the driver is told
// "you're backlit, move the light" instead of watching silent bad output.
//
// Pure functions only — no DOM, no React. Testable and reusable server-side.

export type QualityReasonId =
  | "lighting-dark"
  | "lighting-bright"
  | "blur"
  | "distance"
  | "occlusion"
  | "framerate"
  | "confidence";

export interface QualityInput {
  /** Mean scene luma, 0..1. */
  luma: number;
  /** Normalized sharpness estimate, 0..1 (variance of Laplacian, scaled). */
  sharpness: number;
  /** Share of the frame covered by the face region, 0..1. 0 = no face found. */
  faceRatio: number;
  /** Highest tracked-eye confidence on the last analysed frame, 0..1. */
  eyeConfidence: number;
  /** Number of active tracks (2 eyes + mouth is the healthy case). */
  activeTracks: number;
  /** Frames per second actually reaching the model. */
  analysedFps: number;
  /** Calibrated minimum face coverage, when the driver has calibrated. */
  minFaceRatio?: number;
}

export interface QualityFactor {
  id: QualityReasonId;
  label: string;
  /** 0..1, higher is better. */
  score: number;
  /** What the driver should do when this factor is the weakest. */
  fix: string;
  measured: string;
}

export interface QualityAssessment {
  /** 0..100 overall — the weakest factor dominates. */
  score: number;
  /** true when the score is high enough to trust the analysis. */
  usable: boolean;
  /** The single worst factor, or null when everything is fine. */
  reason: QualityFactor | null;
  factors: QualityFactor[];
}

/** Below this the analysis is blocked / flagged as untrustworthy. */
export const QUALITY_BLOCK_SCORE = 45;
/** Between block and this, results are shown but marked degraded. */
export const QUALITY_WARN_SCORE = 65;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Linear ramp: 0 at `bad`, 1 at `good` (works in either direction). */
function ramp(v: number, bad: number, good: number): number {
  if (bad === good) return v >= good ? 1 : 0;
  return clamp01((v - bad) / (good - bad));
}

export function assessQuality(input: QualityInput): QualityAssessment {
  const minFace = input.minFaceRatio ?? 0.05;
  const factors: QualityFactor[] = [];

  // Lighting — too dark and too blown out are different problems.
  if (input.luma < 0.5) {
    factors.push({
      id: "lighting-dark",
      label: "Lighting",
      score: ramp(input.luma, 0.04, 0.18),
      fix: "Cabin is too dark — turn on the interior light, face a window, or enable low-light capture.",
      measured: `${(input.luma * 100).toFixed(0)}% brightness`,
    });
  } else {
    factors.push({
      id: "lighting-bright",
      label: "Lighting",
      score: ramp(input.luma, 0.98, 0.8),
      fix: "Frame is blown out — move the bright light from behind you or lower the sun visor.",
      measured: `${(input.luma * 100).toFixed(0)}% brightness`,
    });
  }

  factors.push({
    id: "blur",
    label: "Sharpness",
    score: ramp(input.sharpness, 0.05, 0.3),
    fix: "Image is blurry — clean the lens, mount the phone so it stops shaking, and let it refocus.",
    measured: `${(input.sharpness * 100).toFixed(0)}% sharpness`,
  });

  factors.push({
    id: "distance",
    label: "Distance",
    score: input.faceRatio > 0 ? ramp(input.faceRatio, minFace * 0.4, minFace * 1.6) : 0.35,
    fix: "You're too far from the camera — move the phone closer so your face fills the guide box.",
    measured:
      input.faceRatio > 0 ? `face covers ${(input.faceRatio * 100).toFixed(0)}%` : "face not sized",
  });

  factors.push({
    id: "occlusion",
    label: "Eye visibility",
    score: clamp01(input.activeTracks / 2),
    fix: "Both eyes aren't visible — remove sunglasses, lift the mask, and face the camera squarely.",
    measured: `${input.activeTracks} tracked region${input.activeTracks === 1 ? "" : "s"}`,
  });

  factors.push({
    id: "confidence",
    label: "Detector confidence",
    score: ramp(input.eyeConfidence, 0.15, 0.45),
    fix: "The model is unsure about your eyes — improve lighting and framing, then retry.",
    measured: `${(input.eyeConfidence * 100).toFixed(0)}% top eye confidence`,
  });

  factors.push({
    id: "framerate",
    label: "Frame rate",
    score: ramp(input.analysedFps, 2, 8),
    fix: "Too few frames are reaching the model — close other apps or switch the execution backend in Settings.",
    measured: `${input.analysedFps.toFixed(1)} analysed fps`,
  });

  // Weakest link dominates: the mean would hide one fatal factor behind five
  // healthy ones, and one fatal factor is enough to invalidate the score.
  const worst = factors.reduce((a, b) => (b.score < a.score ? b : a));
  const avg = factors.reduce((a, f) => a + f.score, 0) / factors.length;
  const score = Math.round(clamp01(worst.score * 0.65 + avg * 0.35) * 100);

  return {
    score,
    usable: score >= QUALITY_BLOCK_SCORE,
    reason: score >= QUALITY_WARN_SCORE ? null : worst,
    factors,
  };
}

/**
 * Normalized sharpness of an RGBA buffer via a 4-neighbour Laplacian variance.
 * Scaled so ~0.3+ is a crisp face and <0.05 is unusable motion blur.
 */
export function sharpnessFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (width < 3 || height < 3) return 0;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) / 255;
  }
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const variance = sumSq / n - (sum / n) ** 2;
  // Empirical scaling: a sharp 128px preview lands around 0.02-0.05 variance.
  return clamp01(Math.sqrt(variance) * 6);
}
