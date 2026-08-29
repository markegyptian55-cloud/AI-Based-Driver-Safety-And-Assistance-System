// Pre-flight rules for live detection.
//
// Most "the model is bad on my phone" reports are really "the phone is in a
// dark room, the face is 2 m from the lens, and half of it is off-frame".
// These pure rules turn camera samples into a pass/fail checklist with a
// concrete fix per item, so the driver corrects the setup before we start
// scoring their alertness.

export interface PreflightSample {
  /** Mean luma of the frame, 0..1. */
  luma: number;
  /**
   * Share of the frame covered by the face, 0..1, or null when the browser has
   * no face detector (the framing check then falls back to manual confirm).
   */
  faceRatio: number | null;
  /** Face center in normalized frame coordinates, or null. */
  faceCenter?: { x: number; y: number } | null;
}

export interface PreflightThresholds {
  /** Minimum mean luma for the lighting check. */
  minLuma: number;
  /** Frame is blown out above this — backlit windows read as "bright" but flat. */
  maxLuma: number;
  /** Minimum share of the frame the face must cover. */
  minFaceRatio: number;
  /** Max distance of the face center from the frame center (normalized). */
  maxCenterOffset: number;
  /** Samples needed before a check can pass. */
  minSamples: number;
  /** Share of samples that must satisfy a check. */
  passRatio: number;
}

export const PREFLIGHT_DEFAULTS: PreflightThresholds = {
  minLuma: 0.12,
  maxLuma: 0.95,
  minFaceRatio: 0.05,
  maxCenterOffset: 0.32,
  minSamples: 6,
  passRatio: 0.6,
};

export type PreflightCheckId = "camera" | "lighting" | "framing" | "stability";
export type PreflightStatus = "pending" | "pass" | "fail";

export interface PreflightCheck {
  id: PreflightCheckId;
  label: string;
  status: PreflightStatus;
  /** What to do when it fails, or what was measured when it passes. */
  hint: string;
}

export interface PreflightResult {
  checks: PreflightCheck[];
  /** True when nothing is failing and every check has resolved. */
  ready: boolean;
  /** True when a face detector was unavailable and framing needs manual confirm. */
  needsManualFraming: boolean;
}

function ratio(list: boolean[]): number {
  if (!list.length) return 0;
  return list.filter(Boolean).length / list.length;
}

export function evaluatePreflight(
  samples: PreflightSample[],
  opts: {
    streaming: boolean;
    manualFramingConfirmed?: boolean;
    thresholds?: Partial<PreflightThresholds>;
  },
): PreflightResult {
  const cfg = { ...PREFLIGHT_DEFAULTS, ...(opts.thresholds ?? {}) };
  const enough = samples.length >= cfg.minSamples;
  const hasFaceData = samples.some((s) => s.faceRatio !== null);
  const needsManualFraming = enough && !hasFaceData;

  const camera: PreflightCheck = opts.streaming
    ? { id: "camera", label: "Camera stream", status: "pass", hint: "Live frames received." }
    : {
        id: "camera",
        label: "Camera stream",
        status: "pending",
        hint: "Allow camera access to continue.",
      };

  const meanLuma = samples.length
    ? samples.reduce((a, s) => a + s.luma, 0) / samples.length
    : 0;
  const lightingOk =
    ratio(samples.map((s) => s.luma >= cfg.minLuma && s.luma <= cfg.maxLuma)) >= cfg.passRatio;
  const lighting: PreflightCheck = !enough
    ? { id: "lighting", label: "Lighting", status: "pending", hint: "Measuring…" }
    : lightingOk
      ? {
          id: "lighting",
          label: "Lighting",
          status: "pass",
          hint: `Scene brightness ${(meanLuma * 100).toFixed(0)}%.`,
        }
      : {
          id: "lighting",
          label: "Lighting",
          status: "fail",
          hint:
            meanLuma < cfg.minLuma
              ? "Too dark — turn on a light or face a window."
              : "Too bright — move the light source away from behind you.",
        };

  let framing: PreflightCheck;
  if (!enough) {
    framing = { id: "framing", label: "Face size & position", status: "pending", hint: "Looking for your face…" };
  } else if (!hasFaceData) {
    framing = opts.manualFramingConfirmed
      ? {
          id: "framing",
          label: "Face size & position",
          status: "pass",
          hint: "Framing confirmed manually.",
        }
      : {
          id: "framing",
          label: "Face size & position",
          status: "fail",
          hint: "Fill the guide box with your face, then confirm framing.",
        };
  } else {
    const withFace = samples.filter((s) => s.faceRatio !== null);
    const bigEnough = ratio(withFace.map((s) => (s.faceRatio ?? 0) >= cfg.minFaceRatio));
    const centered = ratio(
      withFace.map((s) => {
        const c = s.faceCenter;
        if (!c) return true;
        return Math.hypot(c.x - 0.5, c.y - 0.5) <= cfg.maxCenterOffset;
      }),
    );
    const maxRatio = Math.max(...withFace.map((s) => s.faceRatio ?? 0), 0);
    if (bigEnough < cfg.passRatio) {
      framing = {
        id: "framing",
        label: "Face size & position",
        status: "fail",
        hint: `Move closer — your face covers ${(maxRatio * 100).toFixed(0)}% of the frame.`,
      };
    } else if (centered < cfg.passRatio) {
      framing = {
        id: "framing",
        label: "Face size & position",
        status: "fail",
        hint: "Center your face in the frame.",
      };
    } else {
      framing = {
        id: "framing",
        label: "Face size & position",
        status: "pass",
        hint: `Face covers ${(maxRatio * 100).toFixed(0)}% of the frame.`,
      };
    }
  }

  const faceSeen = hasFaceData
    ? ratio(samples.map((s) => (s.faceRatio ?? 0) > 0))
    : ratio(samples.map((s) => s.luma > 0));
  const stability: PreflightCheck = !enough
    ? { id: "stability", label: "Steady view", status: "pending", hint: "Hold still for a moment…" }
    : faceSeen >= cfg.passRatio
      ? { id: "stability", label: "Steady view", status: "pass", hint: "View is stable." }
      : {
          id: "stability",
          label: "Steady view",
          status: "fail",
          hint: "Keep the camera steady and stay in frame.",
        };

  const checks = [camera, lighting, framing, stability];
  return {
    checks,
    ready: checks.every((c) => c.status === "pass"),
    needsManualFraming,
  };
}

/** Mean luma (0..1) of an RGBA buffer, sampled sparsely for speed. */
export function meanLumaFromRgba(rgba: Uint8ClampedArray, step = 16): number {
  let sum = 0;
  let n = 0;
  for (let p = 0; p < rgba.length; p += 4 * step) {
    sum += (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) / 255;
    n++;
  }
  return n ? sum / n : 0;
}
