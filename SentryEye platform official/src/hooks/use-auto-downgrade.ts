// Auto step-down: when the live quality score stays low, move to a lighter
// model instead of quietly missing events.
//
// A frame-starved run does not look broken — it looks like a model that misses
// short yawns and blinks. That is the worst failure mode, because the driver
// trusts a number that was computed from three frames per second. This watches
// the same quality score the UI shows and, after a sustained low stretch,
// switches down the ladder once per run.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ModelMetadata } from "@/features/drowsiness/labels";
import {
  createDowngradeMonitor,
  DOWNGRADE_QUALITY,
  DOWNGRADE_SUSTAIN_MS,
  nextLighterModel,
} from "@/features/inference/model-ladder";

export interface AutoDowngradeNotice {
  from: string;
  to: string;
  quality: number;
  at: number;
}

export interface UseAutoDowngradeArgs {
  enabled: boolean;
  running: boolean;
  quality: number | null;
  analysedFrames: number;
  models: ModelMetadata[];
  currentModelId: string | null;
  /** Same switch path the manual fallback control uses (stop → select → restart). */
  onSwitch: (modelId: string) => void;
}

export function useAutoDowngrade({
  enabled,
  running,
  quality,
  analysedFrames,
  models,
  currentModelId,
  onSwitch,
}: UseAutoDowngradeArgs) {
  const monitorRef = useRef(createDowngradeMonitor());
  const [notice, setNotice] = useState<AutoDowngradeNotice | null>(null);
  const onSwitchRef = useRef(onSwitch);
  onSwitchRef.current = onSwitch;

  // Each run gets a clean monitor: a downgrade decision must be about the model
  // that is running now, not about the last session's warm-up.
  useEffect(() => {
    if (!running) monitorRef.current.reset();
  }, [running]);

  useEffect(() => {
    if (!enabled || !running || quality == null || !currentModelId) return;
    const fire = monitorRef.current.observe({
      t: Date.now(),
      quality,
      analysedFrames,
    });
    if (!fire) return;
    const lighter = nextLighterModel(models, currentModelId);
    if (!lighter) {
      toast.warning("Quality is low but this is already the lightest model available");
      return;
    }
    const from = models.find((m) => m.id === currentModelId)?.modelName ?? currentModelId;
    setNotice({ from, to: lighter.modelName, quality, at: Date.now() });
    toast.warning(`Switching to ${lighter.modelName}`, {
      description: `Quality stayed at ${Math.round(quality)} for ${Math.round(
        DOWNGRADE_SUSTAIN_MS / 1000,
      )}s — too few frames were reaching ${from}.`,
      duration: 10_000,
    });
    onSwitchRef.current(lighter.id);
  }, [enabled, running, quality, analysedFrames, models, currentModelId]);

  const dismiss = useCallback(() => setNotice(null), []);

  return {
    notice,
    dismiss,
    lowForMs: monitorRef.current.lowForMs(),
    qualityFloor: DOWNGRADE_QUALITY,
  };
}
