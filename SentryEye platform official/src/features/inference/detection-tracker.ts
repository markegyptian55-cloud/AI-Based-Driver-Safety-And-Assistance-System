// Temporal detection tracker — the anti-jitter layer.
//
// Raw per-frame model output is independent between frames: boxes vibrate,
// a single bad frame blanks the eyes, and the open/closed label strobes.
// This tracker gives detections identity over time:
//
//  1. MATCH   each detection to last frame's track by IoU, within the same
//             semantic group (an eye never matches a mouth).
//  2. SMOOTH  the matched box with an EMA so it glides instead of vibrating.
//  3. COAST   keep a track alive for a few missed frames — one dropped frame
//             must not make an eye disappear.
//  4. HYSTERESIS a new label (open <-> closed) only wins after it holds for a
//             run of frames, which is what stops the strobing.
//  5. WARM-UP a brand new track must be seen N times before it is emitted,
//             which kills one-frame phantom boxes.
//
// Pure and DOM-free: same code runs in tests, on webcam, and on uploaded video.

import type { BBox, Detection } from "./types";

export interface TrackerConfig {
  /** Minimum IoU to consider a detection the same object as a track. */
  iouMatchThreshold: number;
  /** EMA weight of the NEW box (0 = frozen, 1 = no smoothing). */
  smoothing: number;
  /** How many consecutive misses a track survives before it is dropped. */
  maxMissedFrames: number;
  /**
   * Wall-clock ceiling (ms) on how long a track may coast without a match.
   * Frame counts are meaningless when the analysed rate swings between 2 and
   * 20 fps: five missed frames is 250 ms on a laptop and 2.5 s on a phone,
   * which is what left stale eye boxes stacked on the Android screen.
   */
  maxMissedMs?: number;
  /** Consecutive hits before a new track is emitted. */
  minHits: number;
  /** Consecutive frames a different label must hold before the track flips. */
  labelFlipFrames: number;
  /** Confidence floor to take a detection in at all. */
  intakeConfThreshold: number;
  /** Smoothed confidence a track needs to be emitted. */
  displayConfThreshold: number;
  /**
   * Mouth-class overrides. The yawn class is the weakest of the three and a
   * shared floor tuned for eyes silently deletes every yawn candidate before
   * the aggregator can apply temporal evidence. Eyes are untouched.
   */
  mouthIntakeConfThreshold?: number;
  mouthDisplayConfThreshold?: number;
  mouthMinHits?: number;
}


export interface TrackerStats {
  activeTracks: number;
  emitted: number;
  coasting: number;
}

interface Track {
  id: number;
  bbox: BBox;
  classId: number;
  label: string;
  semantic: string;
  confidence: number;
  hits: number;
  misses: number;
  lastSeenMs: number;
  pendingSemantic: string | null;
  pendingCount: number;
  /** True while the track was fed only by below-global-threshold boxes. */
  candidate: boolean;
}


/** Groups semantics that describe the same physical object. */
export function semanticGroup(semantic: string): string {
  if (semantic.startsWith("eye")) return "eye";
  if (semantic === "yawn" || semantic.startsWith("mouth")) return "mouth";
  return semantic;
}

export function iou(a: BBox, b: BBox): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const iw = x2 - x1;
  const ih = y2 - y1;
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const union = aw * ah + bw * bh - inter;
  return union > 0 ? inter / union : 0;
}

function lerpBox(prev: BBox, next: BBox, alpha: number): BBox {
  return [
    prev[0] + (next[0] - prev[0]) * alpha,
    prev[1] + (next[1] - prev[1]) * alpha,
    prev[2] + (next[2] - prev[2]) * alpha,
    prev[3] + (next[3] - prev[3]) * alpha,
  ];
}

export interface DetectionTracker {
  /**
   * Feeds one frame of raw detections, returns the stabilized detections.
   * `nowMs` is the capture timestamp; it drives time-based track expiry.
   */
  update(detections: Detection[], nowMs?: number): Detection[];
  stats(): TrackerStats;
  configure(cfg: TrackerConfig): void;
  reset(): void;
}

export function createDetectionTracker(config: TrackerConfig): DetectionTracker {
  let cfg = config;
  let tracks: Track[] = [];
  let nextId = 1;
  let lastStats: TrackerStats = { activeTracks: 0, emitted: 0, coasting: 0 };

  const isMouth = (semantic: string) => semanticGroup(semantic) === "mouth";
  const intakeFloor = (semantic: string) =>
    isMouth(semantic) ? (cfg.mouthIntakeConfThreshold ?? cfg.intakeConfThreshold) : cfg.intakeConfThreshold;
  const displayFloor = (semantic: string) =>
    isMouth(semantic)
      ? (cfg.mouthDisplayConfThreshold ?? cfg.displayConfThreshold)
      : cfg.displayConfThreshold;
  const minHitsFor = (semantic: string) =>
    isMouth(semantic) ? (cfg.mouthMinHits ?? cfg.minHits) : cfg.minHits;

  function update(detections: Detection[], nowMs?: number): Detection[] {
    const now = nowMs ?? Date.now();
    const candidates = detections.filter((d) => d.confidence >= intakeFloor(d.semantic));

    const usedDet = new Set<number>();
    const matchedTracks = new Set<number>();

    // Greedy best-IoU matching: strongest pairs first, so a confident eye box
    // claims its own track before a weaker overlapping one can steal it.
    const pairs: { t: number; d: number; score: number }[] = [];
    tracks.forEach((track, ti) => {
      candidates.forEach((det, di) => {
        if (semanticGroup(det.semantic) !== semanticGroup(track.semantic)) return;
        const score = iou(track.bbox, det.bbox);
        if (score >= cfg.iouMatchThreshold) pairs.push({ t: ti, d: di, score });
      });
    });
    pairs.sort((a, b) => b.score - a.score);

    for (const pair of pairs) {
      if (matchedTracks.has(pair.t) || usedDet.has(pair.d)) continue;
      matchedTracks.add(pair.t);
      usedDet.add(pair.d);
      const track = tracks[pair.t];
      const det = candidates[pair.d];
      track.bbox = lerpBox(track.bbox, det.bbox, cfg.smoothing);
      track.confidence = track.confidence + (det.confidence - track.confidence) * cfg.smoothing;
      track.hits++;
      track.misses = 0;
      track.lastSeenMs = now;
      if (!det.candidate) track.candidate = false;

      if (det.semantic === track.semantic) {
        track.pendingSemantic = null;
        track.pendingCount = 0;
      } else {
        if (track.pendingSemantic === det.semantic) track.pendingCount++;
        else {
          track.pendingSemantic = det.semantic;
          track.pendingCount = 1;
        }
        if (track.pendingCount >= cfg.labelFlipFrames) {
          track.semantic = det.semantic;
          track.label = det.label;
          track.classId = det.classId;
          track.pendingSemantic = null;
          track.pendingCount = 0;
        }
      }
    }

    // Unmatched tracks coast; drop once they run out of patience.
    tracks.forEach((track, ti) => {
      if (matchedTracks.has(ti)) return;
      track.misses++;
    });
    const maxAge = cfg.maxMissedMs ?? 400;
    tracks = tracks.filter(
      (t) => t.misses <= cfg.maxMissedFrames && now - t.lastSeenMs <= maxAge,
    );

    // Unmatched detections become new (not yet visible) tracks.
    candidates.forEach((det, di) => {
      if (usedDet.has(di)) return;
      tracks.push({
        id: nextId++,
        bbox: det.bbox,
        classId: det.classId,
        label: det.label,
        semantic: det.semantic,
        confidence: det.confidence,
        hits: 1,
        misses: 0,
        lastSeenMs: now,
        pendingSemantic: null,
        pendingCount: 0,
        candidate: det.candidate === true,
      });
    });

    const out: Detection[] = [];
    let coasting = 0;
    for (const t of tracks) {
      if (t.misses > 0) coasting++;
      if (t.hits < minHitsFor(t.semantic)) continue;
      if (t.confidence < displayFloor(t.semantic)) continue;
      out.push({
        classId: t.classId,
        label: t.label,
        semantic: t.semantic,
        confidence: t.confidence,
        bbox: t.bbox,
        ...(t.candidate ? { candidate: true } : {}),
      });
    }

    lastStats = { activeTracks: tracks.length, emitted: out.length, coasting };
    return out;
  }

  return {
    update,
    stats: () => lastStats,
    configure: (next) => {
      cfg = next;
    },
    reset: () => {
      tracks = [];
      lastStats = { activeTracks: 0, emitted: 0, coasting: 0 };
    },
  };
}
