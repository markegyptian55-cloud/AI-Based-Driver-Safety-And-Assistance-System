// Replay buffer — the frame-by-frame record behind scrub mode.
//
// The live loop already computes, per analysed frame, the stabilized
// detections and the risk state. Keeping a compact copy of that lets the user
// drag a slider afterwards and inspect exactly what the model saw at 00:37,
// instead of trusting a summary number.
//
// Memory is bounded: frames are appended and the oldest dropped past the cap,
// which at ~10 fps analysed keeps roughly the last 20 minutes.

import type { Detection } from "../inference/types";
import type { RiskLevel } from "../drowsiness/types";

export interface ReplayFrame {
  /** Milliseconds since session start. */
  t: number;
  /** Position inside the source clip (ms), when the source is a video file. */
  mediaMs?: number;
  detections: Detection[];
  risk: RiskLevel;
  riskScore: number;
  perclos: number;
  /** Current continuous eye-closure length at this frame (ms). */
  closureMs: number;
  eyesClosed: boolean;
  yawning: boolean;
}

const CAP = 12_000;

export interface ReplayBuffer {
  push(frame: ReplayFrame): void;
  frames(): ReplayFrame[];
  clear(): void;
}

export function createReplayBuffer(cap = CAP): ReplayBuffer {
  let frames: ReplayFrame[] = [];
  return {
    push(frame) {
      frames.push(frame);
      if (frames.length > cap) frames = frames.slice(frames.length - cap);
    },
    frames: () => frames,
    clear: () => {
      frames = [];
    },
  };
}

/** Nearest recorded frame to a timeline position (ms since start). */
export function frameAt(frames: ReplayFrame[], t: number): ReplayFrame | null {
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = frames[Math.max(0, lo - 1)];
  const b = frames[lo];
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
}
