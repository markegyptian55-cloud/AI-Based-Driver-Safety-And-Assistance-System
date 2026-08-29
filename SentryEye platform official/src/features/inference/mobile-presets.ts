// Inference presets.
//
// A phone camera is not a laptop camera: it delivers fewer frames, darker
// pixels, and a smaller face. Running the desktop thresholds there produces
// exactly the failure the driver sees — boxes that flicker, eyes that "open"
// for one frame mid-blink, and closures that are never long enough to count.
//
// A preset bundles every knob that has to move together for a given class of
// device. Pure data + pure selection so it can be unit-tested.

import type { TrackerConfig } from "./detection-tracker";

export type PresetId = "desktop" | "mobile-lowlight";
export type PresetPreference = "auto" | PresetId;

export interface InferencePreset {
  id: PresetId;
  label: string;
  description: string;
  /** Confidence floor sent to the decoder (intake — the tracker filters again). */
  confThreshold: number;
  /** Confidence a track must reach before it is drawn and scored. */
  displayConfThreshold: number;
  /** NMS overlap. Higher keeps two adjacent eyes from being merged. */
  iouThreshold: number;
  tracker: TrackerConfig;
  /** Timing overrides, in ms, so decisions are frame-rate independent. */
  scoring: {
    eyeClosedMsThreshold: number;
    eventCooldownMs: number;
    yawnStartMs: number;
    yawnConfirmMs: number;
    longYawnMs: number;
  };
  /** Brighten dark frames before inference instead of feeding a near-black image. */
  autoGain: boolean;
  /** Target mean luma (0..1) for auto-gain. */
  autoGainTargetLuma: number;
  /** Mean luma below which the preflight lighting check fails. */
  minSceneLuma: number;
}

export const DESKTOP_PRESET: InferencePreset = {
  id: "desktop",
  label: "Desktop",
  description: "Full-rate webcam in normal light.",
  confThreshold: 0.35,
  displayConfThreshold: 0.35,
  iouThreshold: 0.5,
  tracker: {
    iouMatchThreshold: 0.3,
    smoothing: 0.5,
    maxMissedFrames: 2,
    maxMissedMs: 200,
    minHits: 2,
    labelFlipFrames: 2,
    intakeConfThreshold: 0.3,
    displayConfThreshold: 0.35,
  },
  scoring: {
    eyeClosedMsThreshold: 400,
    eventCooldownMs: 2000,
    yawnStartMs: 400,
    yawnConfirmMs: 1200,
    longYawnMs: 2500,
  },
  autoGain: false,
  autoGainTargetLuma: 0.35,
  minSceneLuma: 0.12,
};

export const MOBILE_LOWLIGHT_PRESET: InferencePreset = {
  id: "mobile-lowlight",
  label: "Mobile / low light",
  description: "Lower confidence floor, stronger smoothing, longer hold times.",
  // The model under-scores in dim light, so we take weaker boxes in and let
  // the tracker (not the raw threshold) decide what is real.
  confThreshold: 0.22,
  displayConfThreshold: 0.3,
  // Never relax NMS to compensate for dim light: a high IoU threshold is what
  // let several boxes survive on a single eye. Stay at the validated value and
  // let the tracker, not the decoder, deal with weak frames.
  iouThreshold: 0.5,
  tracker: {
    iouMatchThreshold: 0.2,
    smoothing: 0.35,
    // A 10 fps stream loses a whole eye for 300 ms after two missed frames —
    // coast longer so boxes survive a dropout instead of blinking out.
    maxMissedFrames: 5,
    // A coasting box may never outlive half a second of real time, whatever
    // the analysed frame rate happens to be.
    maxMissedMs: 500,
    minHits: 2,
    labelFlipFrames: 2,
    intakeConfThreshold: 0.2,
    displayConfThreshold: 0.3,
  },
  scoring: {
    eyeClosedMsThreshold: 500,
    eventCooldownMs: 2500,
    yawnStartMs: 500,
    yawnConfirmMs: 1400,
    longYawnMs: 2800,
  },
  autoGain: true,
  autoGainTargetLuma: 0.38,
  minSceneLuma: 0.1,
};

export const PRESETS: Record<PresetId, InferencePreset> = {
  desktop: DESKTOP_PRESET,
  "mobile-lowlight": MOBILE_LOWLIGHT_PRESET,
};

/** Resolves the active preset from the stored preference and the device class. */
export function selectPreset(pref: PresetPreference, constrained: boolean): InferencePreset {
  if (pref === "desktop") return DESKTOP_PRESET;
  if (pref === "mobile-lowlight") return MOBILE_LOWLIGHT_PRESET;
  return constrained ? MOBILE_LOWLIGHT_PRESET : DESKTOP_PRESET;
}

const STORAGE_KEY = "dds.presetPreference";

export function readPresetPreference(): PresetPreference {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "auto" || v === "desktop" || v === "mobile-lowlight") return v;
  } catch {
    /* storage blocked */
  }
  return "auto";
}

export function writePresetPreference(pref: PresetPreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* storage blocked */
  }
}
