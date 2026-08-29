// Benchmark router — measure the phone instead of guessing about it.
//
// Runs the same captured frames through each candidate execution path
// (on-device WASM, on-device WebGPU, remote FastAPI) and reports which one
// actually sustains real-time throughput *and* agrees with the reference
// decode. Latency alone is a trap: a path can be fast because it is silently
// producing garbage, so agreement is scored too.

import { BrowserOnnxProvider } from "./browser-onnx-provider";
import { RemoteFastApiProvider } from "./remote-fastapi-provider";
import type { Detection, InferenceProvider, ProviderConfig } from "./types";

export interface BenchCandidate {
  id: string;
  label: string;
  kind: "on-device" | "remote";
  /** Overrides applied on top of the base config for this candidate. */
  overrides?: Partial<ProviderConfig>;
}

export interface BenchResult {
  id: string;
  label: string;
  kind: BenchCandidate["kind"];
  ok: boolean;
  error?: string;
  engine: string;
  imgsz: number;
  frames: number;
  fps: number;
  latencyP50: number;
  latencyP95: number;
  /** Standard deviation of latency — the jitter the driver perceives as freezing. */
  latencyStdDev: number;
  meanDetections: number;
  meanConfidence: number;
  /** 0..1 detection agreement with the reference path (1 = identical boxes). */
  agreement: number;
  /** 0..100 overall: throughput, stability and agreement combined. */
  score: number;
  /** Plain-language summary for the report. */
  verdict: string;
}

export interface BenchOptions {
  frames: ImageBitmap[];
  baseConfig: ProviderConfig;
  candidates: BenchCandidate[];
  /** Warm-up frames excluded from the statistics (first runs are always slow). */
  warmup?: number;
  onProgress?: (info: { candidate: string; done: number; total: number }) => void;
}

/** Real-time bar for drowsiness: below this, microsleeps get missed. */
export const REALTIME_FPS = 10;
const REALTIME_P95_MS = 220;

export async function runBenchmark(opts: BenchOptions): Promise<BenchResult[]> {
  const { frames, baseConfig, candidates, onProgress } = opts;
  const warmup = opts.warmup ?? 2;
  if (!frames.length) throw new Error("No frames were captured for the benchmark.");

  const results: BenchResult[] = [];
  const perFrameDetections = new Map<string, Detection[][]>();

  for (const candidate of candidates) {
    const cfg: ProviderConfig = { ...baseConfig, ...candidate.overrides };
    let provider: InferenceProvider | null = null;
    const latencies: number[] = [];
    const counts: number[] = [];
    const confidences: number[] = [];
    const captured: Detection[][] = [];
    let engine = "unknown";

    try {
      provider =
        candidate.kind === "remote" ? new RemoteFastApiProvider() : new BrowserOnnxProvider();
      await provider.init(cfg);
      engine = provider.status().engine;

      const total = frames.length + warmup;
      for (let i = 0; i < total; i++) {
        const source = frames[i % frames.length];
        // Providers consume (close) the bitmap, so every pass gets a copy.
        const clone = await createImageBitmap(source);
        const t0 = performance.now();
        const res = await provider.infer(clone, Date.now());
        const dt = performance.now() - t0;
        if (i >= warmup) {
          latencies.push(dt);
          counts.push(res.detections.length);
          for (const d of res.detections) confidences.push(d.confidence);
          captured.push(res.detections);
        }
        onProgress?.({ candidate: candidate.id, done: i + 1, total });
      }

      perFrameDetections.set(candidate.id, captured);
      const fps = latencies.length ? 1000 / mean(latencies) : 0;
      results.push({
        id: candidate.id,
        label: candidate.label,
        kind: candidate.kind,
        ok: true,
        engine,
        imgsz: cfg.imgsz,
        frames: latencies.length,
        fps: round(fps),
        latencyP50: round(percentile(latencies, 0.5)),
        latencyP95: round(percentile(latencies, 0.95)),
        latencyStdDev: round(stdDev(latencies)),
        meanDetections: round(mean(counts)),
        meanConfidence: round(mean(confidences), 3),
        agreement: 0,
        score: 0,
        verdict: "",
      });
    } catch (err) {
      results.push({
        id: candidate.id,
        label: candidate.label,
        kind: candidate.kind,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        engine,
        imgsz: cfg.imgsz,
        frames: 0,
        fps: 0,
        latencyP50: 0,
        latencyP95: 0,
        latencyStdDev: 0,
        meanDetections: 0,
        meanConfidence: 0,
        agreement: 0,
        score: 0,
        verdict: "Did not run.",
      });
    } finally {
      await provider?.dispose();
    }
  }

  // The reference is the highest-resolution path that ran successfully: it is
  // the closest thing available to ground truth on this device.
  const reference = [...results]
    .filter((r) => r.ok)
    .sort((a, b) => b.imgsz - a.imgsz || b.meanConfidence - a.meanConfidence)[0];

  for (const r of results) {
    if (!r.ok) continue;
    r.agreement =
      reference && reference.id !== r.id
        ? round(
            agreementScore(
              perFrameDetections.get(reference.id) ?? [],
              perFrameDetections.get(r.id) ?? [],
            ),
            3,
          )
        : 1;
    r.score = scoreCandidate(r);
    r.verdict = verdictFor(r);
  }

  return results.sort((a, b) => b.score - a.score);
}

export function scoreCandidate(r: BenchResult): number {
  if (!r.ok) return 0;
  const throughput = clamp01(r.fps / REALTIME_FPS);
  const stability = clamp01(1 - r.latencyStdDev / Math.max(1, r.latencyP50));
  const responsiveness = clamp01(REALTIME_P95_MS / Math.max(1, r.latencyP95));
  const accuracy = clamp01(r.agreement);
  return Math.round(
    100 * (0.4 * throughput + 0.2 * stability + 0.15 * responsiveness + 0.25 * accuracy),
  );
}

function verdictFor(r: BenchResult): string {
  if (r.fps >= REALTIME_FPS && r.latencyP95 <= REALTIME_P95_MS && r.agreement >= 0.7) {
    return `Real-time and accurate: ${r.fps.toFixed(1)} fps, ${r.latencyP95.toFixed(0)} ms worst case.`;
  }
  if (r.fps >= REALTIME_FPS && r.agreement < 0.7) {
    return `Fast but disagrees with the reference decode (${(r.agreement * 100).toFixed(0)}% match) — likely degraded output.`;
  }
  if (r.fps >= REALTIME_FPS) {
    return `Fast on average but stutters (p95 ${r.latencyP95.toFixed(0)} ms).`;
  }
  return `Too slow for live detection: ${r.fps.toFixed(1)} fps (needs ${REALTIME_FPS}).`;
}

/** Mean per-frame F1 between two detection streams, matched by IoU + class. */
export function agreementScore(ref: Detection[][], test: Detection[][]): number {
  const n = Math.min(ref.length, test.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += frameF1(ref[i], test[i]);
  return sum / n;
}

function frameF1(ref: Detection[], test: Detection[]): number {
  if (!ref.length && !test.length) return 1;
  if (!ref.length || !test.length) return 0;
  const used = new Set<number>();
  let tp = 0;
  for (const r of ref) {
    let bestIdx = -1;
    let bestIou = 0.45;
    test.forEach((t, idx) => {
      if (used.has(idx) || t.classId !== r.classId) return;
      const i = iou(r.bbox, t.bbox);
      if (i > bestIou) {
        bestIou = i;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      tp++;
    }
  }
  const precision = tp / test.length;
  const recall = tp / ref.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function iou(a: Detection["bbox"], b: Detection["bbox"]): number {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const ih = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = iw * ih;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

function mean(v: number[]) {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

function stdDev(v: number[]) {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

function percentile(v: number[], q: number) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function clamp01(v: number) {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

function round(v: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
