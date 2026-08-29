// Live capture profiler.
//
// "The phone is slow" is not actionable. This answers *where* the frame budget
// went: did the camera deliver fewer frames, did they queue, was preprocessing
// or the model the cost, or was the sensor exposing for 100 ms in a dark cabin?
// One bounded ring buffer, no images, safe to run for a whole session.

export interface CaptureSample {
  /** ms since the profiler started. */
  t: number;
  /** Camera-to-inference latency: capture timestamp to result (ms). */
  captureToResultMs: number;
  preprocessMs: number;
  inferMs: number;
  postprocessMs: number;
  transportMs: number;
  /** Frames the source delivered but never analysed, cumulative. */
  dropped: number;
  sourceFps: number;
  analysedFps: number;
  luma: number;
  gain: number;
  route: string;
  /** Quality score of the frame (0..100) from the quality gate, if available. */
  quality: number;
}

/** What the camera track admits about the sensor; all fields are optional. */
export interface CaptureSettingsSnapshot {
  exposureMode?: string;
  exposureTimeUs?: number;
  exposureCompensation?: number;
  iso?: number;
  frameRate?: number;
  width?: number;
  height?: number;
  focusMode?: string;
  whiteBalanceMode?: string;
  torch?: boolean;
}

export interface CaptureProfileStats {
  frames: number;
  durationMs: number;
  analysedFps: number;
  sourceFps: number;
  droppedFrames: number;
  dropRate: number;
  latency: Quantiles;
  preprocessMs: Quantiles;
  inferMs: Quantiles;
  postprocessMs: Quantiles;
  transportMs: Quantiles;
  meanLuma: number;
  meanGain: number;
  meanQuality: number;
  /** Share of frames on each route (on-device / remote). */
  routeShare: Record<string, number>;
  /** Longest stall between two analysed frames (ms) — the freeze the user felt. */
  worstGapMs: number;
  sensor: CaptureSettingsSnapshot | null;
}

export interface Quantiles {
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export interface CaptureProfiler {
  record(sample: Omit<CaptureSample, "t">): void;
  setSensor(s: CaptureSettingsSnapshot | null): void;
  samples(): CaptureSample[];
  stats(): CaptureProfileStats;
  reset(): void;
}

const LIMIT = 5000;

export function createCaptureProfiler(limit = LIMIT): CaptureProfiler {
  const started = Date.now();
  let buffer: CaptureSample[] = [];
  let sensor: CaptureSettingsSnapshot | null = null;

  return {
    record(sample) {
      buffer.push({ t: Date.now() - started, ...sample });
      if (buffer.length > limit) buffer = buffer.slice(buffer.length - limit);
    },
    setSensor(s) {
      sensor = s;
    },
    samples: () => buffer,
    reset() {
      buffer = [];
    },
    stats(): CaptureProfileStats {
      const durationMs = Date.now() - started;
      if (!buffer.length) {
        return {
          frames: 0,
          durationMs,
          analysedFps: 0,
          sourceFps: 0,
          droppedFrames: 0,
          dropRate: 0,
          latency: EMPTY,
          preprocessMs: EMPTY,
          inferMs: EMPTY,
          postprocessMs: EMPTY,
          transportMs: EMPTY,
          meanLuma: 0,
          meanGain: 1,
          meanQuality: 0,
          routeShare: {},
          worstGapMs: 0,
          sensor,
        };
      }
      const last = buffer[buffer.length - 1];
      const routeShare: Record<string, number> = {};
      for (const s of buffer) {
        routeShare[s.route] = (routeShare[s.route] ?? 0) + 1 / buffer.length;
      }
      let worstGapMs = 0;
      for (let i = 1; i < buffer.length; i++) {
        worstGapMs = Math.max(worstGapMs, buffer[i].t - buffer[i - 1].t);
      }
      const analysedSpan = last.t - buffer[0].t;
      return {
        frames: buffer.length,
        durationMs,
        analysedFps: analysedSpan > 0 ? ((buffer.length - 1) * 1000) / analysedSpan : 0,
        sourceFps: mean(buffer.map((s) => s.sourceFps)),
        droppedFrames: last.dropped,
        dropRate: last.dropped / Math.max(1, last.dropped + buffer.length),
        latency: quantiles(buffer.map((s) => s.captureToResultMs)),
        preprocessMs: quantiles(buffer.map((s) => s.preprocessMs)),
        inferMs: quantiles(buffer.map((s) => s.inferMs)),
        postprocessMs: quantiles(buffer.map((s) => s.postprocessMs)),
        transportMs: quantiles(buffer.map((s) => s.transportMs)),
        meanLuma: mean(buffer.map((s) => s.luma)),
        meanGain: mean(buffer.map((s) => s.gain)),
        meanQuality: mean(buffer.map((s) => s.quality)),
        routeShare,
        worstGapMs,
        sensor,
      };
    },
  };
}

const EMPTY: Quantiles = { p50: 0, p95: 0, max: 0, mean: 0 };

export function quantiles(values: number[]): Quantiles {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return EMPTY;
  const sorted = [...clean].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    p50: round2(at(0.5)),
    p95: round2(at(0.95)),
    max: round2(sorted[sorted.length - 1]),
    mean: round2(mean(sorted)),
  };
}

function mean(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v));
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

/**
 * Reads sensor state from a live camera track. Everything here is
 * best-effort: Android Chrome exposes exposure/ISO, desktop and iOS mostly
 * do not, and an absent field is information too (it explains why low-light
 * mode had no effect).
 */
export function readCaptureSettings(track: MediaStreamTrack | null): CaptureSettingsSnapshot | null {
  if (!track) return null;
  const s = track.getSettings() as MediaTrackSettings & {
    exposureMode?: string;
    exposureTime?: number;
    exposureCompensation?: number;
    iso?: number;
    focusMode?: string;
    whiteBalanceMode?: string;
    torch?: boolean;
  };
  const out: CaptureSettingsSnapshot = {};
  if (s.exposureMode !== undefined) out.exposureMode = s.exposureMode;
  // The spec unit is 100 µs steps; report microseconds so the number is legible.
  if (s.exposureTime !== undefined) out.exposureTimeUs = s.exposureTime * 100;
  if (s.exposureCompensation !== undefined) out.exposureCompensation = s.exposureCompensation;
  if (s.iso !== undefined) out.iso = s.iso;
  if (s.frameRate !== undefined) out.frameRate = s.frameRate;
  if (s.width !== undefined) out.width = s.width;
  if (s.height !== undefined) out.height = s.height;
  if (s.focusMode !== undefined) out.focusMode = s.focusMode;
  if (s.whiteBalanceMode !== undefined) out.whiteBalanceMode = s.whiteBalanceMode;
  if (s.torch !== undefined) out.torch = s.torch;
  return out;
}
