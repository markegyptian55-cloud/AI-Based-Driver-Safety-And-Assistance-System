// Automatic calibration for recorded clips.
//
// The interactive wizard cannot run on an uploaded video — nobody is there to
// blink on cue. But the clip itself contains everything the wizard measures:
// the driver blinks, opens their mouth, the cabin has a brightness, and the
// face sits at a distance. This accumulator watches the first few seconds of
// analysed frames, extracts exactly the same samples the wizard collects, and
// hands them to the SAME `computeCalibration()` maths.
//
// The result: a clip recorded on a dark 12 fps phone and the same clip
// recorded on a bright laptop converge on comparable thresholds, instead of
// one of them firing a microsleep on every blink.
//
// Pure and DOM-free.

import {
  computeCalibration,
  faceRatioFromBoxes,
  spellDurations,
  type CalibrationProfile,
  type CalibrationSamples,
} from "./calibration";
import type { Detection } from "../inference/types";

export interface AutoCalibrateOptions {
  /** Minimum analysed frames before a profile may be produced. */
  minFrames?: number;
  /** Minimum wall-clock span (ms) of observed frames. */
  minSpanMs?: number;
  /** Hard cap — never spend more than this observing before committing. */
  maxSpanMs?: number;
}

export interface AutoCalibrator {
  /** Feeds one analysed frame. Returns a profile the moment one is ready. */
  ingest(tsMs: number, detections: Detection[], luma: number): CalibrationProfile | null;
  /** Forces a profile from whatever was collected (clip ended early). */
  finish(): CalibrationProfile | null;
  frames(): number;
  done(): boolean;
}

const DEFAULTS: Required<AutoCalibrateOptions> = {
  minFrames: 45,
  minSpanMs: 5000,
  maxSpanMs: 12000,
};

function isEye(semantic: string) {
  return semantic.startsWith("eye");
}
function isMouth(semantic: string) {
  return semantic === "yawn" || semantic.startsWith("mouth");
}

export function createAutoCalibrator(opts: AutoCalibrateOptions = {}): AutoCalibrator {
  const cfg = { ...DEFAULTS, ...opts };
  const samples: CalibrationSamples = {
    luma: [],
    faceRatio: [],
    eyeConfidence: [],
    blinkDurationsMs: [],
    yawnDurationMs: null,
    mouthAspects: [],
    mouthConfidences: [],
  };

  // Boolean-per-frame timelines, collapsed into spells at the end.
  const closedFrames: Array<{ ts: number; active: boolean }> = [];
  const mouthFrames: Array<{ ts: number; active: boolean }> = [];
  let firstTs: number | null = null;
  let lastTs = 0;
  let count = 0;
  let finished = false;

  function build(): CalibrationProfile | null {
    if (!count) return null;
    finished = true;
    samples.blinkDurationsMs = spellDurations(closedFrames).filter((d) => d > 40 && d < 1500);
    const mouthSpells = spellDurations(mouthFrames);
    samples.yawnDurationMs = mouthSpells.length ? Math.max(...mouthSpells) : null;
    return computeCalibration(samples);
  }

  return {
    ingest(tsMs, detections, luma) {
      if (finished) return null;
      if (firstTs == null) firstTs = tsMs;
      lastTs = tsMs;
      count++;

      samples.luma.push(luma);
      samples.faceRatio.push(faceRatioFromBoxes(detections));

      const eyes = detections.filter((d) => isEye(d.semantic));
      const mouths = detections.filter((d) => isMouth(d.semantic));
      if (eyes.length) {
        samples.eyeConfidence.push(Math.max(...eyes.map((d) => d.confidence)));
      }
      // "Closed" only when every visible eye reads closed — one flickering eye
      // must not manufacture a blink that inflates the closure threshold.
      const closed = eyes.length > 0 && eyes.every((d) => d.semantic === "eye_closed");
      closedFrames.push({ ts: tsMs, active: closed });

      const openMouth = mouths.length > 0;
      mouthFrames.push({ ts: tsMs, active: openMouth });
      if (mouths.length) {
        samples.mouthConfidences?.push(Math.max(...mouths.map((m) => m.confidence)));
      }
      for (const m of mouths) {
        const [, , w, h] = m.bbox;
        if (w > 0) samples.mouthAspects.push(h / w);
      }


      const span = lastTs - (firstTs ?? lastTs);
      const enough = count >= cfg.minFrames && span >= cfg.minSpanMs;
      const timedOut = span >= cfg.maxSpanMs && count >= 12;
      return enough || timedOut ? build() : null;
    },
    finish: () => (finished ? null : build()),
    frames: () => count,
    done: () => finished,
  };
}
