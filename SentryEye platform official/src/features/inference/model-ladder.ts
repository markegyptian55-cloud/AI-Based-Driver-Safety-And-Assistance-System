// Automatic model step-down.
//
// A heavy model that frame-starves the pipeline is worse than a light model
// that keeps up: a real yawn that only one frame reaches is rejected as "too
// short", which looks exactly like a mis-detection but isn't one. When the live
// quality score stays low for a sustained window we stop warning and actually
// move down the ladder.
//
// Pure logic — the caller owns the model switch.

import type { ModelMetadata } from "@/features/drowsiness/labels";

/** Quality score at or below which a run counts as frame-starved. */
export const DOWNGRADE_QUALITY = 50;
/** How long quality must stay low before stepping down (ms). */
export const DOWNGRADE_SUSTAIN_MS = 5000;
/** Frames ignored after (re)start so warm-up cannot trigger a downgrade. */
export const DOWNGRADE_WARMUP_FRAMES = 10;

export interface DowngradeMonitor {
  /**
   * Feed one quality reading. Returns true exactly once when a step-down
   * should happen now; the caller must call `armed(false)` style reset via
   * `reset()` after performing the switch.
   */
  observe(sample: { t: number; quality: number; analysedFrames: number }): boolean;
  /** ms the current low-quality streak has lasted (0 when healthy). */
  lowForMs(): number;
  reset(): void;
}

export function createDowngradeMonitor(
  qualityFloor = DOWNGRADE_QUALITY,
  sustainMs = DOWNGRADE_SUSTAIN_MS,
  warmupFrames = DOWNGRADE_WARMUP_FRAMES,
): DowngradeMonitor {
  let lowSince: number | null = null;
  let last = 0;
  let fired = false;
  return {
    observe({ t, quality, analysedFrames }) {
      last = t;
      if (fired) return false;
      if (analysedFrames < warmupFrames) {
        lowSince = null;
        return false;
      }
      if (quality > qualityFloor) {
        lowSince = null;
        return false;
      }
      if (lowSince == null) lowSince = t;
      if (t - lowSince >= sustainMs) {
        fired = true;
        return true;
      }
      return false;
    },
    lowForMs() {
      return lowSince == null ? 0 : Math.max(0, last - lowSince);
    },
    reset() {
      lowSince = null;
      last = 0;
      fired = false;
    },
  };
}

/**
 * Cost proxy used to order the ladder. Input resolution dominates on-device
 * cost; transformer heads (rf-detr) are heavier per pixel than YOLO, and file
 * size stands in for parameter count.
 */
export function modelCost(m: ModelMetadata): number {
  const px = (m.imgsz || 640) ** 2;
  const headPenalty = m.headFormat === "rf-detr" ? 1.6 : 1;
  const sizePenalty = 1 + (m.fileSizeBytes ?? 0) / (64 * 1024 * 1024);
  // A CPU-fallback export is a bigger file (fp32) but the cheapest thing this
  // device can actually execute: fp16 is emulated in WASM and runs ~2.4x
  // slower. File size would otherwise sort it above the model it rescues.
  const fallbackBonus = m.bestFor === "cpu-fallback" ? 0.45 : 1;
  return px * headPenalty * sizePenalty * fallbackBonus;
}

/** Heaviest → lightest. */
export function modelLadder(models: ModelMetadata[]): ModelMetadata[] {
  return [...models].sort((a, b) => modelCost(b) - modelCost(a));
}

/** The next lighter registered model, or null when already at the bottom. */
export function nextLighterModel(
  models: ModelMetadata[],
  currentId: string,
): ModelMetadata | null {
  const ladder = modelLadder(models);
  const i = ladder.findIndex((m) => m.id === currentId);
  if (i < 0) return ladder[ladder.length - 1] ?? null;
  return ladder[i + 1] ?? null;
}
