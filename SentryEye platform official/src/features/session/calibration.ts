// Calibration profile — a per-device, per-driver tuning pass.
//
// The same model behaves very differently on a 12 fps phone in a dark cabin
// than on a laptop by a window: the face is smaller, the frame is darker, and
// a natural blink is only 2-3 frames long. Rather than guessing, we ask the
// driver to sit normally, blink once and yawn once, then derive the thresholds
// from what we actually measured.
//
// Everything here is pure: samples in, profile out. The wizard component owns
// the camera, this file owns the maths so it can be unit-tested and reused by
// the FastAPI provider later.

export interface CalibrationSamples {
  /** Mean scene luma (0..1) per analysed frame during the "look at camera" step. */
  luma: number[];
  /** Share of the frame covered by the face bounding region (0..1), per frame. */
  faceRatio: number[];
  /** Confidence of the strongest eye detection per frame. */
  eyeConfidence: number[];
  /** Duration (ms) of each continuous eye-closed spell seen in the blink step. */
  blinkDurationsMs: number[];
  /** Duration (ms) of the longest mouth-open spell seen in the yawn step. */
  yawnDurationMs: number | null;
  /** Mouth aspect ratios observed while the mouth was open. */
  mouthAspects: number[];
  /** Confidence of the strongest mouth detection per frame. */
  mouthConfidences?: number[];

}

export interface CalibrationProfile {
  /** ISO timestamp so a stale profile can be shown / re-run. */
  createdAt: string;
  /** Target mean luma for auto-gain. */
  autoGainTargetLuma: number;
  /** Static gain floor applied even before auto-gain reacts. */
  baseGain: number;
  /** Measured baseline scene brightness. */
  baselineLuma: number;
  /** Measured baseline face coverage — the "correct distance" for this driver. */
  baselineFaceRatio: number;
  /** Minimum face coverage before we warn the driver they moved too far away. */
  minFaceRatio: number;
  /** Closure duration that counts as a sustained closure, derived from blinks. */
  eyeClosedMsThreshold: number;
  /** Confidence a track must reach before it is drawn and scored. */
  displayConfThreshold: number;
  /** Mouth-open duration that confirms a yawn, derived from the yawn step. */
  yawnConfirmMs: number;
  /** Mouth aspect floor separating this driver's yawn from their smile. */
  yawnMinAspect: number;
  /** This driver's resting mouth aspect, measured from their own footage. */
  mouthBaseline: number;
  /** Confidence floor for the mouth class, tuned to this camera/lighting. */
  yawnConfThreshold: number;

  /** How many frames the measurement was based on — low counts are unreliable. */
  frames: number;
  /** True when the driver skipped a step and defaults were substituted. */
  partial: boolean;
}

export type CalibrationStepId = "baseline" | "blink" | "yawn";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function mean(list: number[]): number {
  if (!list.length) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function median(list: number[]): number {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Derives every driver-specific threshold from the measured samples.
 *
 * Rules of thumb encoded here:
 * - a sustained closure must be comfortably longer than this driver's own
 *   blink (1.8x the median blink), otherwise every blink is a "microsleep";
 * - face coverage may drop to ~60% of the calibrated baseline before we call
 *   it "too far away" — people lean back, that is not a fault;
 * - gain lifts a dark cabin toward a usable luma without blowing out a bright one.
 */
export function computeCalibration(samples: CalibrationSamples): CalibrationProfile {
  const baselineLuma = clamp(median(samples.luma), 0, 1);
  const faceRatios = samples.faceRatio.filter((r) => r > 0);
  const baselineFaceRatio = clamp(median(faceRatios), 0, 1);
  const eyeConf = samples.eyeConfidence.filter((c) => c > 0);
  const medBlink = median(samples.blinkDurationsMs.filter((d) => d > 40));
  const yawnMs = samples.yawnDurationMs ?? null;
  const aspects = samples.mouthAspects.filter((a) => a > 0);

  // Auto-gain target: lift dark scenes, leave well-lit ones alone.
  const autoGainTargetLuma = clamp(Math.max(0.32, baselineLuma * 1.6), 0.28, 0.55);
  const baseGain = baselineLuma > 0.02 ? clamp(0.22 / baselineLuma, 1, 2.2) : 1;

  // Confidence floor: sit just under this driver's typical eye confidence so
  // real eyes survive a bad frame, but noise at 0.5 does not get through.
  const typicalEyeConf = eyeConf.length ? median(eyeConf) : 0;
  const displayConfThreshold = typicalEyeConf
    ? clamp(typicalEyeConf * 0.7, 0.2, 0.45)
    : 0.3;

  const eyeClosedMsThreshold = medBlink
    ? clamp(Math.round(medBlink * 1.8), 260, 900)
    : 450;

  const yawnConfirmMs = yawnMs ? clamp(Math.round(yawnMs * 0.6), 700, 2200) : 1200;
  // Resting mouth for THIS driver at THIS distance. The aspect floor is set
  // just above it rather than at a fixed 0.5 that no phone-angle mouth reaches.
  const mouthBaseline = aspects.length ? median(aspects) : 0;
  const yawnMinAspect = mouthBaseline
    ? clamp(mouthBaseline * 1.15, 0.28, 0.9)
    : 0.38;
  // Mouth confidence floor from this camera's own evidence, never above the
  // eye floor — an unseen mouth cannot be confirmed by any amount of time.
  const mouthConf = (samples.mouthConfidences ?? []).filter((c) => c > 0);
  const yawnConfThreshold = mouthConf.length
    ? clamp(median(mouthConf) * 0.6, 0.12, 0.35)
    : 0.25;

  return {
    createdAt: new Date().toISOString(),
    autoGainTargetLuma,
    baseGain: Number(baseGain.toFixed(2)),
    baselineLuma: Number(baselineLuma.toFixed(3)),
    baselineFaceRatio: Number(baselineFaceRatio.toFixed(4)),
    minFaceRatio: Number(clamp(baselineFaceRatio * 0.6, 0.01, 0.4).toFixed(4)),
    eyeClosedMsThreshold,
    displayConfThreshold: Number(displayConfThreshold.toFixed(3)),
    yawnConfirmMs,
    yawnMinAspect: Number(yawnMinAspect.toFixed(3)),
    mouthBaseline: Number(mouthBaseline.toFixed(3)),
    yawnConfThreshold: Number(yawnConfThreshold.toFixed(3)),

    frames: samples.luma.length,
    partial:
      samples.luma.length < 8 ||
      samples.blinkDurationsMs.length === 0 ||
      samples.yawnDurationMs == null,
  };
}

/** Collapses a boolean-per-frame timeline into continuous spell durations (ms). */
export function spellDurations(
  frames: Array<{ ts: number; active: boolean }>,
): number[] {
  const out: number[] = [];
  let startedAt: number | null = null;
  let lastTs = 0;
  for (const f of frames) {
    if (f.active && startedAt == null) startedAt = f.ts;
    if (!f.active && startedAt != null) {
      // End on the first open frame, not the last closed one: overstating a
      // blink raises the closure threshold, which errs toward fewer false
      // microsleep alarms rather than more.
      out.push(f.ts - startedAt);
      startedAt = null;
    }
    lastTs = f.ts;
  }
  if (startedAt != null) out.push(lastTs - startedAt);
  return out.filter((d) => d > 0);
}

/** Mean face coverage of a frame, from eye/mouth boxes when no face detector exists. */
export function faceRatioFromBoxes(
  boxes: Array<{ bbox: [number, number, number, number] }>,
): number {
  if (!boxes.length) return 0;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const b of boxes) {
    const [x, y, w, h] = b.bbox;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  // Eye + mouth boxes only cover the inner face; scale up to approximate the head.
  return clamp((maxX - minX) * (maxY - minY) * 1.8, 0, 1);
}

const STORAGE_KEY = "dds.calibrationProfile";

export function readCalibration(): CalibrationProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalibrationProfile;
    return typeof parsed?.eyeClosedMsThreshold === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCalibration(profile: CalibrationProfile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* storage blocked */
  }
}

export function clearCalibration(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
}

/**
 * Folds a calibration profile into a preset. The profile always wins where it
 * measured something real; anything it could not measure keeps the preset
 * default, so a partial calibration is still an improvement.
 */
export function applyCalibrationToPreset<
  T extends {
    displayConfThreshold: number;
    autoGain: boolean;
    autoGainTargetLuma: number;
    tracker: { displayConfThreshold: number; intakeConfThreshold: number };
    scoring: { eyeClosedMsThreshold: number; yawnConfirmMs: number };
  },
>(preset: T, profile: CalibrationProfile | null): T {
  if (!profile) return preset;
  return {
    ...preset,
    displayConfThreshold: profile.displayConfThreshold,
    autoGain: preset.autoGain || profile.baseGain > 1.05,
    autoGainTargetLuma: profile.autoGainTargetLuma,
    tracker: {
      ...preset.tracker,
      displayConfThreshold: profile.displayConfThreshold,
      intakeConfThreshold: Math.min(
        preset.tracker.intakeConfThreshold,
        profile.displayConfThreshold * 0.8,
      ),
      // Mouth track keeps its own, looser evidence bar.
      mouthDisplayConfThreshold: profile.yawnConfThreshold,
      mouthIntakeConfThreshold: Math.min(0.15, profile.yawnConfThreshold * 0.6),
    },
    scoring: {
      ...preset.scoring,
      eyeClosedMsThreshold: profile.eyeClosedMsThreshold,
      yawnConfirmMs: profile.yawnConfirmMs,
      yawnMinAspect: profile.yawnMinAspect,
      yawnConfThreshold: profile.yawnConfThreshold,
    },
  };
}

