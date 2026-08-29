// Single source of truth for the runtime configuration live detection hands to
// an inference provider. Quick test, warm-up and the live session all build the
// config here, so a pre-start measurement uses byte-identical preprocessing
// (resize, normalisation, auto-gain, thresholds) to the real run.

import type { ModelMetadata } from "@/features/drowsiness/labels";
import { readCalibration, applyCalibrationToPreset } from "@/features/session/calibration";
import { readLowLightPreference } from "@/features/session/low-light";
import {
  readPresetPreference,
  selectPreset,
  type InferencePreset,
} from "./mobile-presets";
import { isConstrainedDevice } from "./engine-preference";
import { effectiveEnginePreference } from "./engine-memory";
import { readRemoteBaseUrl, readRemoteEnabled } from "./remote-endpoint";
import type { ProviderConfig } from "./types";

export interface LivePresetContext {
  preset: InferencePreset;
  constrained: boolean;
  lowLight: boolean;
  calibrated: boolean;
}

/** Preset the next live run would use, with calibration and low-light applied. */
export function resolveLivePreset(): LivePresetContext {
  const constrained =
    typeof navigator !== "undefined" && isConstrainedDevice(navigator as never);
  const calibration = readCalibration();
  const lowLight = readLowLightPreference();
  const calibrated = applyCalibrationToPreset(
    selectPreset(readPresetPreference(), constrained),
    calibration,
  );
  const preset: InferencePreset = lowLight
    ? {
        ...calibrated,
        autoGain: true,
        autoGainTargetLuma: Math.max(calibrated.autoGainTargetLuma, 0.42),
      }
    : calibrated;
  return { preset, constrained, lowLight, calibrated: Boolean(calibration) };
}

/** Provider config for a model under a given live preset. */
export function liveProviderConfig(
  meta: ModelMetadata,
  preset: InferencePreset,
): ProviderConfig {
  return {
    modelId: meta.id,
    modelUrl: meta.modelUrl,
    ...(meta.cpuModelUrl ? { cpuModelUrl: meta.cpuModelUrl } : {}),
    imgsz: meta.imgsz,
    labels: meta.labels,
    semanticMap: meta.semanticMap,
    confThreshold: preset.confThreshold,
    iouThreshold: preset.iouThreshold,
    // This model describes one driver: two eyes plus one mouth. Leave a small
    // diagnostic margin, but never allow the registry's generic top-N limit
    // to feed a tracker flood on mobile.
    maxDetections: Math.min(meta.postprocessConfig.maxDetections, 12),
    modelName: meta.modelName,
    modelVersion: meta.version,
    headFormat: meta.headFormat,
    classIdOffset: meta.postprocessConfig.classIdOffset,
    resize: meta.postprocessConfig.resize,
    normalize: meta.postprocessConfig.normalize,
    // Measured per-class operating points from the export. They are the floor;
    // the preset slider may only tighten detection, never loosen below them.
    ...(meta.postprocessConfig.classThresholds
      ? { classThresholds: meta.postprocessConfig.classThresholds }
      : {}),
    enginePreference: effectiveEnginePreference(),
    remoteBaseUrl: readRemoteEnabled() ? readRemoteBaseUrl() : undefined,
    autoGain: preset.autoGain,
    autoGainTargetLuma: preset.autoGainTargetLuma,
    yawnCandidateConf: Math.min(0.15, preset.confThreshold),
    yawnProbe: true,
  };
}

/** Human-readable summary of the preprocessing a run will apply. */
export function describePreprocessing(meta: ModelMetadata, ctx: LivePresetContext): string[] {
  return [
    `${meta.imgsz}×${meta.imgsz} ${meta.postprocessConfig.resize}`,
    `${meta.postprocessConfig.normalize} normalisation`,
    `conf ${ctx.preset.confThreshold.toFixed(2)} · IoU ${ctx.preset.iouThreshold.toFixed(2)}`,
    ctx.preset.autoGain ? "auto-gain on" : "auto-gain off",
    `${ctx.preset.id} preset`,
  ];
}
