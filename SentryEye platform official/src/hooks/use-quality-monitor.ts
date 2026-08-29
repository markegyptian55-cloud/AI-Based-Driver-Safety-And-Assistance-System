// Live detection-quality monitor.
//
// Samples the video element on a slow interval (cheap: 128x96) for brightness
// and sharpness, folds in the signals the session already produces (face size,
// track count, eye confidence, analysed fps) and turns them into one score
// with a dominant reason and a fix.
//
// Kept out of the inference loop on purpose — quality must never cost frames.

import { useEffect, useRef, useState } from "react";

import {
  assessQuality,
  sharpnessFromRgba,
  type QualityAssessment,
} from "@/features/session/detection-quality";
import { meanLumaFromRgba } from "@/features/session/preflight";
import { faceRatioFromBoxes } from "@/features/session/calibration";
import type { LiveSessionState } from "@/features/session/use-live-session";

const SAMPLE_MS = 700;

export function useQualityMonitor(
  video: HTMLVideoElement | null,
  state: LiveSessionState,
  opts: { enabled: boolean; onScore?: (score: number) => void },
): QualityAssessment | null {
  const [assessment, setAssessment] = useState<QualityAssessment | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onScoreRef = useRef(opts.onScore);
  onScoreRef.current = opts.onScore;

  useEffect(() => {
    if (!opts.enabled || !video) {
      setAssessment(null);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 96;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let stopped = false;
    const timer = window.setInterval(() => {
      if (stopped || video.readyState < 2 || !video.videoWidth) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const s = stateRef.current;
      const next = assessQuality({
        luma: s.luma || meanLumaFromRgba(data, 4),
        sharpness: sharpnessFromRgba(data, canvas.width, canvas.height),
        faceRatio: faceRatioFromBoxes(s.detections),
        eyeConfidence: Math.max(
          s.topConfidence["eye_open"] ?? 0,
          s.topConfidence["eye_closed"] ?? 0,
        ),
        activeTracks: s.tracker.activeTracks,
        analysedFps: s.processedFps,
        minFaceRatio: s.calibration?.minFaceRatio,
      });
      setAssessment(next);
      onScoreRef.current?.(next.score);
    }, SAMPLE_MS);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [video, opts.enabled]);

  return assessment;
}
